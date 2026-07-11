#!/usr/bin/env node
/*
 * Codex safety hook: block a small set of destructive shell commands.
 *
 * This runs as a PreToolUse hook before supported shell commands. Codex sends
 * a JSON description of the proposed command on stdin. A dangerous match is
 * denied; otherwise the hook stays silent and allows normal processing.
 *
 * Keep the DANGER list aligned with the equivalent Claude hook in
 * .claude/hooks/block-dangerous-commands.js.
 */

const fs = require("fs");

// Fail open if the payload cannot be read or parsed, so a hook bug cannot
// wedge the entire session.
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

const command = (payload.tool_input && payload.tool_input.command) || "";

const DANGER = [
  [/\brm\s+(-\S+\s+)*-\S*[rf]\S*[rf]?/i,
    "recursive/forced delete (rm -rf) - files are gone with no undo"],
  [/\bgit\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b)/i,
    "force push - can permanently overwrite history on the remote"],
  [/\bgit\s+push\b[^\n]*(?:--delete\b|\s:[A-Za-z0-9._/-]+)/i,
    "deleting a remote branch"],
  [/\bgit\s+reset\s+--hard\b/i,
    "git reset --hard - throws away all uncommitted work"],
  [/\bgit\s+clean\s+-\S*f/i,
    "git clean -f - deletes untracked files permanently"],
  [/\bgit\s+checkout\s+(--\s|\.$|\.\s)/i,
    "git checkout -- / . - discards uncommitted file changes"],
  [/\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|[^\n]*\b(?:sh|bash|pwsh|powershell|python|node|iex)\b/i,
    "piping downloaded content directly into an interpreter"],
  [/\bremove-item\b[^\n]*-recurse[^\n]*-force|\bremove-item\b[^\n]*-force[^\n]*-recurse/i,
    "Remove-Item -Recurse -Force - the PowerShell equivalent of rm -rf"],
];

for (const [pattern, reason] of DANGER) {
  if (pattern.test(command)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked by the repository safety hook: ${reason}. ` +
          "If this is genuinely required, run it yourself or disable the hook through /hooks.",
      },
    }));
    process.exit(0);
  }
}

process.exit(0);

