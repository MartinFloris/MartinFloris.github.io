#!/usr/bin/env node
/*
 * Safety hook: block a small set of destructive shell commands.
 * ---------------------------------------------------------------------------
 * Claude Code runs this as a PreToolUse hook before EVERY Bash / PowerShell
 * command (wired up in .claude/settings.json). It receives a JSON description
 * of the command on stdin. If the command matches one of the dangerous
 * patterns below, we tell Claude Code to DENY it — no matter what any prompt,
 * web page, or file tried to convince Claude to do. That's the whole point of
 * a hook: it's a rule Claude cannot talk its way past.
 *
 * This is intentionally short and readable. To adjust it, edit the DANGER list
 * below. To turn it off temporarily, open /hooks in Claude Code and disable it.
 *
 * Nothing here deletes or changes files. It only reads the proposed command
 * and answers "allow" (by staying silent) or "deny" (by printing a decision).
 */

const fs = require("fs");

// Read the hook payload from stdin. If anything is off, fail OPEN (allow) so a
// bug in this script can never wedge your whole session.
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

// Each entry: [pattern to match, plain-English reason shown when blocked].
// Patterns are case-insensitive and cover the usual "oops, it's gone" commands.
const DANGER = [
  [/\brm\s+(-\S+\s+)*-\S*[rf]\S*[rf]?/i,
    "recursive/forced delete (rm -rf) — files are gone with no undo"],
  [/\bgit\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b)/i,
    "force push — can permanently overwrite history on the remote"],
  [/\bgit\s+push\b[^\n]*(?:--delete\b|\s:[A-Za-z0-9._/-]+)/i,
    "deleting a remote branch"],
  [/\bgit\s+reset\s+--hard\b/i,
    "git reset --hard — throws away all uncommitted work"],
  [/\bgit\s+clean\s+-\S*f/i,
    "git clean -f — deletes untracked files permanently"],
  [/\bgit\s+checkout\s+(--\s|\.$|\.\s)/i,
    "git checkout -- / . — discards your uncommitted file changes"],
  [/\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|[^\n]*\b(?:sh|bash|pwsh|powershell|python|node|iex)\b/i,
    "piping downloaded content straight into an interpreter (classic malware vector)"],
  [/\bremove-item\b[^\n]*-recurse[^\n]*-force|\bremove-item\b[^\n]*-force[^\n]*-recurse/i,
    "Remove-Item -Recurse -Force — the PowerShell equivalent of rm -rf"],
];

for (const [pattern, reason] of DANGER) {
  if (pattern.test(command)) {
    const decision = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Blocked by your local safety hook: " + reason +
          ". If you genuinely want this, run it yourself in a terminal, or " +
          "disable this hook via /hooks in Claude Code.",
      },
    };
    process.stdout.write(JSON.stringify(decision));
    process.exit(0);
  }
}

// No match → print nothing, exit 0 → Claude Code proceeds normally.
process.exit(0);
