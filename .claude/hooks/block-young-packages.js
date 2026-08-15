#!/usr/bin/env node
/*
 * Safety hook: block `npm install` of packages published in the last 14 days.
 * ---------------------------------------------------------------------------
 * Claude Code runs this as a PreToolUse hook before EVERY Bash / PowerShell
 * command (wired up in .claude/settings.json), alongside
 * block-dangerous-commands.js. It receives a JSON description of the
 * command on stdin.
 *
 * Freshly published package versions are a common supply-chain attack vector
 * (typosquats, compromised maintainer accounts, malicious version bumps).
 * Registries and the community typically catch and pull these within days,
 * so a 14-day cool-off gives that window time to work before this project
 * ever runs the code. For every package named in an `npm install` / `npm i`
 * command, we ask the npm registry when that exact resolved version was
 * published and DENY the command if any of them are younger than that.
 *
 * Fails OPEN on anything ambiguous or broken: unreachable registry, an
 * unresolvable semver range, a malformed response, no npm install in the
 * command at all. This is a best-effort supply-chain guard, not an airtight
 * gate — a bug or a flaky network call here should never wedge a session.
 * To adjust it, edit THRESHOLD_DAYS below. To turn it off temporarily, open
 * /hooks in Claude Code and disable it.
 */

const fs = require("fs");
const https = require("https");

const THRESHOLD_DAYS = 14;
const REGISTRY = "https://registry.npmjs.org/";
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function allow() {
  process.exit(0);
}

function deny(reason) {
  const decision = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(decision));
  process.exit(0);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout: 4000, headers: { "user-agent": "safety-hook-package-age-check" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("status " + res.statusCode));
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// Splits a package spec like "@scope/name@1.2.3" into { name, version }.
// Returns null for specs we shouldn't ask the registry about (local paths,
// git/tarball URLs).
function parseSpec(spec) {
  if (/^[./]|^https?:|^git(\+|:)|\.tgz$|\.tar\.gz$/i.test(spec)) return null;

  let scope = "";
  let rest = spec;
  if (rest.startsWith("@")) {
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    scope = rest.slice(0, slash + 1);
    rest = rest.slice(slash + 1);
  }
  const at = rest.indexOf("@");
  const name = scope + (at === -1 ? rest : rest.slice(0, at));
  const version = at === -1 ? null : rest.slice(at + 1);
  return { name, version };
}

// Resolves a spec to a concrete published version + date, and flags it if
// that version is younger than the threshold. Returns null (not young /
// can't tell) or a human-readable description of the offending package.
async function checkSpec(spec) {
  const parsed = parseSpec(spec);
  if (!parsed) return null;

  let data;
  try {
    data = await fetchJson(REGISTRY + encodeURIComponent(parsed.name));
  } catch {
    return null; // registry unreachable / package not found — fail open
  }

  let resolvedVersion;
  if (!parsed.version) {
    resolvedVersion = data["dist-tags"] && data["dist-tags"].latest;
  } else if (EXACT_VERSION.test(parsed.version)) {
    resolvedVersion = parsed.version;
  } else if (data["dist-tags"] && data["dist-tags"][parsed.version]) {
    resolvedVersion = data["dist-tags"][parsed.version]; // e.g. "next", "beta"
  } else {
    // A semver range (^, ~, *, ||, ...): resolving the true max-satisfying
    // version needs a semver library we can't rely on being installed yet.
    // Skip rather than guess.
    return null;
  }

  const publishedAt = resolvedVersion && data.time && data.time[resolvedVersion];
  if (!publishedAt) return null;

  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86400000;
  if (Number.isFinite(ageDays) && ageDays < THRESHOLD_DAYS) {
    return `${parsed.name}@${resolvedVersion} (published ${ageDays.toFixed(1)} days ago)`;
  }
  return null;
}

(async () => {
  const raw = readStdin();
  if (!raw) return allow();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return allow();
  }

  const command = (payload.tool_input && payload.tool_input.command) || "";
  if (!/\bnpm\s+(install|i)\b/i.test(command)) return allow();

  // Only the install segment, so a chained unrelated command isn't scanned
  // for package names too.
  const installMatch = command.match(/\bnpm\s+(?:install|i)\b([^&|;\n]*)/i);
  if (!installMatch) return allow();

  const FLAGS_WITH_VALUE = new Set(["--registry", "--tag", "-t"]);
  const rawArgs = installMatch[1].trim().split(/\s+/).filter(Boolean);
  const specs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("-")) {
      if (FLAGS_WITH_VALUE.has(arg)) i++;
      continue;
    }
    specs.push(arg);
  }

  // Bare "npm install" / "npm ci" installs only from package.json/lockfile —
  // nothing new to vet.
  if (specs.length === 0) return allow();

  const results = await Promise.all(specs.map(checkSpec));
  const young = results.filter(Boolean);

  if (young.length > 0) {
    return deny(
      "Blocked by your local safety hook: package(s) published less than " +
        THRESHOLD_DAYS +
        " days ago — " +
        young.join(", ") +
        ". Freshly published versions are a common supply-chain attack " +
        "vector (typosquats, compromised maintainer accounts); wait for the " +
        "cool-off window, or confirm explicitly with the user before " +
        "overriding via /hooks in Claude Code."
    );
  }

  return allow();
})().catch(() => process.exit(0)); // fail open on any unexpected error
