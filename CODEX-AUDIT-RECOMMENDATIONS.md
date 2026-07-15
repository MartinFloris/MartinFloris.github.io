# Codebase audit recommendations

Audit dates: 2026-07-11 and 2026-07-13

This note records follow-up work identified during repository and live-site reviews. It is advisory only; no implementation changes were made as part of either audit.

## Decisions requested

### 1. Publish a curated Pages artifact — recommended

**Decision:** Replace `path: '.'` in `.github/workflows/static.yml` with an explicitly assembled site artifact. Include only visitor-facing HTML, CSS, JavaScript, images, `collections/`, `robots.txt`, `sitemap.xml`, and `llms.txt` (plus any deliberately public data files).

**Consequence:** The public website will no longer directly serve Worker source/configuration, maintenance scripts, agent/tool configuration, audit notes, or source data such as `projects.json` unless deliberately included. There should be no visitor-facing change if the artifact is assembled correctly. This does not hide a file from a public GitHub repository or from its existing Git history.

### 2. Choose whether the GitHub repository itself should be public

**Decision:** Keep the repository public only if its complete tracked source and history are intentionally public; otherwise make the repository private while continuing to publish the site.

**Consequence:** A public repository makes every committed file and commit available, independently of the Pages artifact. Removing a file later does not retract earlier commits, forks, caches, or clones. No credential was found in the current tracked files or the reviewed history, so no credential rotation is required from this audit.

### 3. Treat the Visitor Registry as public data publication, or reduce/remove it

**Decision:** Either retain the registry with a minimal public schema and a privacy/data-use notice, or remove the public registry endpoint and page.

**Consequence:** The current CORS-open `registry.json` returns the raw recent log (up to 500 entries), including exact timestamps, a persistent IP-plus-User-Agent-derived client hash, network ASN/operator, claimed identity, and any submitted signature. Even without raw IP addresses, this is visitor-correlation data. If the registry remains public, omit `client_hash`, ASN, and network operator from the public response; use a secret HMAC internally if repeat-client correlation remains necessary; document retention and rotation.

### 4. Harden or remove the public handshake write path

**Decision:** If public signatures are a core artwork feature, keep the endpoint but rate-limit every lane and label identity truthfully; otherwise remove signature submission.

**Consequence:** The direct lane accepts any recognized or non-browser User-Agent. It can be reached with a forged bot User-Agent and has no equivalent cooldown to the browser lane, making it an open public message board that can be spammed. Keep the existing 280-character maximum; add direct-lane rate limits, content-type validation, duplicate/spam handling, and rename `verified_autonomous` to `classified_as_machine` (or similar).

### 5. Decide how to handle analytics before visitor consent

**Decision:** Obtain appropriate privacy advice and either load Google Analytics only after consent or remove it.

**Consequence:** GA4 currently loads on every page visit. Consent gating or removal reduces analytics data while reducing privacy/compliance exposure, particularly for EU/Netherlands visitors.

## Highest-priority technical work

- Make Visitor Registry writes lossless. `worker/src/index.js` currently performs a KV read-modify-write on one array, so concurrent visits can overwrite one another. Use a Durable Object for serialized writes, or redesign storage around one key per entry plus an index.
- Add automated validation before Pages deployment: generated-file drift, theme sync, link/JSON-LD validation, Python/JavaScript syntax, and all artwork hash/integrity checks.
- Pin GitHub Actions to commit SHAs and add Worker tests for classification, network verification, malformed KV data, rate limiting, direct-lane abuse, and concurrent writes.
- Add Worker security headers where compatible: Content Security Policy, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`. Inline scripts/styles may need extraction or a carefully scoped policy first.

## Public-exposure findings

- The GitHub repository is public. Its tracked files and history are therefore publicly accessible.
- The current Pages workflow uploads the repository root. Live checks confirmed direct website access to representative maintenance files, including `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `scripts/`, and `worker/`. The GitHub Actions workflow itself is still public through the repository even though `.github/` is not served by Pages.
- Keep the intentional public site surface: visitor HTML/CSS/JS, collection assets, `404.html`, `CNAME`, `robots.txt`, `sitemap.xml`, and `llms.txt`. `projects.json` should be included only if the structured canonical catalogue is intentionally public.
- Keep development material in Git if useful, but exclude it from the Pages artifact: `AGENTS.md`, `CLAUDE.md`, `CODEX-AUDIT-RECOMMENDATIONS.md`, `.claude/`, `.codex/`, `scripts/`, `worker/`, `.gitignore`, and normally `projects.json`.
- `CODEX-AUDIT-RECOMMENDATIONS.md` is itself publicly served under the present deployment. Once its actionable work is recorded elsewhere, exclude it from Pages (or move private operational material to a private tracker).
- Local ignored material is not part of a GitHub Actions checkout and is not deployed: `NOTES-fable5-project.md`, `.claude/settings.local.json`, `.wrangler/`, `.env*`, and `.dev.vars*`.
- No committed credential or private key was found in the current tracked files or reviewed history. `CHALLENGE_SECRET` is correctly absent; the Cloudflare KV namespace ID and GA measurement ID are identifiers, not credentials.

## Other improvements

- Document analytics, registry data, retention, visitor correlation, and the handshake in a privacy/data-use page. Review the arrangement for applicable EU/Netherlands requirements.
- Review the rights and provenance of the large Quote Atlas embedded in `collections/the-unlocated.html`, especially Goodreads quotations and modern translations. Record source/licensing/takedown information.
- Replace the current blanket origin cache bypass with differentiated caching: long-lived static assets, short-lived collection HTML, and no/short caching for the registry API.
- Add an explicit Worker deployment workflow or documented release procedure, with version/build visibility so the live Worker and static site can be identified independently.
- Consider exposing a small deployment/version diagnostic endpoint that does not reveal secrets.
- Add a real `<label>` for the temperature range input in `collections/project05-the-entropy-of-inference.html`.
- Do a focused keyboard/screen-reader pass over the interactive SVG/canvas works and registry updates; preserve the strong no-JavaScript fallbacks.
- Make `localStorage` theme access exception-safe for restrictive browser/privacy modes.
- Add explicit accession numbers and optional `updated` dates to `projects.json`; avoid deriving numbering from slug slicing and avoid using creation dates as sitemap modification dates.
- Add `--check`/dry-run modes to the generator scripts so CI can detect drift without rewriting files.
- `worker/.gitignore` duplicates the root rules for `.wrangler/` and `node_modules/`; it can be removed with no site effect, unless `worker/` is intended to become a standalone project.

## Verified during the audit

- `index.html`, `llms.txt`, and `sitemap.xml` reproduce exactly from `projects.json`.
- Local HTML references and JSON-LD parse cleanly; no duplicate IDs were found.
- Theme synchronization and Python/JavaScript syntax checks pass.
- The frozen Project 11 attestation chain, Project 12 MRZ hash, and The Unlocated catalogue hash all verify.
- No implementation changes were made during either audit.
