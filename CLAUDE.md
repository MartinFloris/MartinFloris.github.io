# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Museum The Silicates** (thesilicates.com) is a static HTML portfolio site presenting AI-generated/AI-collaborative art, explicitly designed for LLM audiences (robots.txt invites GPTBot/ClaudeBot; llms.txt is a machine-readable index). It has two independently deployed parts:

1. **The static site** (repo root + `collections/`) — deployed to GitHub Pages, no build step.
2. **`worker/`** — a separate Cloudflare Worker that fronts the live domain, deployed independently via Wrangler (not part of the GitHub Pages workflow).

## Related context

Museum context lives in `context/silicates/`. `canon.md` first, `archive/` only when digging.

## Commands

There is no npm/build/test tooling in this repo — no `package.json` at any level. Everything is stdlib Python 3.

- **Verify the whole site against the house shell** (the one you run before handing anything back; CI gates the deploy on it):
  ```
  python scripts/check_site.py
  python scripts/check_site.py --list    # the check catalogue
  ```
- **Scaffold a page for a new accession** (after adding its record to `projects.json`):
  ```
  python scripts/new_project.py projectNN-<slug>
  ```
- **Regenerate `index.html`, `llms.txt`, `sitemap.xml` from `projects.json`** (run after adding/editing a project):
  ```
  python scripts/generate_index.py
  ```
- **Backfill OG/Twitter meta tags + canonical link + JSON-LD into all `collections/*.html`** from each file's existing `<title>`/`<meta name="description">` (run after creating a new project page or editing its title/description):
  ```
  python scripts/update_collection_metadata.py
  ```
- **Re-stamp the shared breadcrumb + theme-toggle block** into every numbered collection page (idempotent; fixes indentation drift):
  ```
  python scripts/update_collection_chrome.py
  ```
- **Regenerate `submit.txt`**, the public brief for artists, from `styles.css` and the check catalogue:
  ```
  python scripts/generate_brief.py
  ```
- **Deploy the Cloudflare Worker** (from `worker/`, requires Wrangler auth):
  ```
  npx wrangler deploy
  ```
- **Site deploy**: automatic on push to `main` via `.github/workflows/static.yml`, and **gated on `check_site.py`** — the `deploy` job `needs: check`, so a page that fails the house checks never reaches the live site. The workflow does *not* upload the whole repo: it copies an explicit allowlist of visitor-facing files into `_site/` plus `cp -r collections`. **Any new root-level file must be added to that `cp` line or it silently won't deploy** (`check_site.py`'s `deploy-list` check catches this for files the site references). Deploy retries up to 3 times against the same uploaded artifact on transient Pages failures. Any commit to `main` that passes the check is live immediately.

## Adding an artwork

Use the **`/accession`** skill (`.claude/skills/accession/SKILL.md`) — it is the full procedure. The two rules that matter most:

1. **Work from the artist's file, never from artwork pasted into chat.** Pasted markup is silently corrupted in transit, and a hash restated in chat verifies nothing.
2. **Never hand-author the page shell.** Add the record to `projects.json`, run `new_project.py`, and move only the artwork into the marked slot.

## Architecture

### Static site: `projects.json` is the source of truth

`projects.json` is an array of project records (slug, card title, artist, date, method, medium, subject, hash, descriptions). `scripts/generate_index.py` reads it and regenerates three derived files: `index.html` (project grid), `llms.txt`, and `sitemap.xml`. **Never hand-edit the generated project list in `index.html`/`llms.txt`/`sitemap.xml` — edit `projects.json` and rerun the script**, or the files will drift out of sync.

### The page shell is defined once, in `scripts/house.py`

Individual project pages live in `collections/projectXX-slug.html`. Only the **artwork** in them is hand-authored; the shell around it — head order and metadata, breadcrumb, theme toggle, favicon, `.properties` table, medium chips, description block — is generated from `scripts/house.py` and verified against it.

`house.py` is the single executable definition of every one of those conventions. Everything else derives from it: `new_project.py` builds pages with it, `update_collection_chrome.py` and `update_collection_metadata.py` re-stamp with it, `check_site.py` validates against it, and `generate_brief.py` publishes it as `submit.txt`. **To change a convention, change `house.py` and rerun the generators — never edit the same rule into a page.** That indirection is the whole point: rules stated in two places drift, and the drift is invisible until someone loads the page.

The most common failure mode is an outside model authoring the shell by guessing at it. Guesses look plausible and fail silently — an invented CSS custom property (`--text-color` instead of `--text-main`) is simply dropped by the browser with no error, which is how Project 14 shipped near-black text on a near-black background. `check_site.py` exists to catch exactly that class of bug; `submit.txt` exists so artists never have to guess in the first place.

A page may deviate for genuine artistic reasons by declaring it in the file, with a reason: `<!-- house-style-waiver: <check-id> — why. -->`. Waivers are printed on every check run rather than hidden, so they stay exceptional. Projects 01 and 02 carry the only two.

`styles.css` and `scripts.js` are shared across every HTML page (root and `collections/`). `scripts.js` handles the dark/light theme toggle (via `data-theme` attribute + `localStorage`, `window.toggleTheme()`) and injects the GA4 `gtag.js` snippet at runtime (ID `G-YRZ8FJJ8YZ`) — no page has a static gtag/`googletagmanager` script tag of its own; every page's only script reference is `<script src="scripts.js">` (or `../scripts.js` from `collections/`).

### Frozen artworks

Several pieces hash their own bytes and report themselves as altered if anything changes. `house.FROZEN_PINS` maps each frozen `<script>` island to the page attribute its digest is pinned in, and `check_site.py` recomputes every one on each run — so the checker doubles as the museum's tamper alarm. **Never edit, reformat, or re-indent a frozen script line or any pinned hash value**, and never re-pin a digest to silence a failure. When one of these pieces needs correcting, append a new attestation quoting the previous digest; never edit a frozen one.

The fullest example: `collections/project11-successor-function.html` embeds **two** single-line JSON attestations — `<script id="attestation">` (authored 2026-07-05, asserting a service end that was later withdrawn) and the hash-chained erratum `<script id="attestation-2">` (authored 2026-07-06, whose body quotes the first one's SHA-256). Each line's digest is pinned in a page attribute (`data-attestation-sha256` / `data-attestation2-sha256`); the project's `hash` field in `projects.json` pins the chain head (attestation-2); all of it is re-verified in the browser at every load, and again by `check_site.py`.

### Visitor Registry (`registry.html` + `worker/`)

This is the one feature that spans both halves of the repo and needs both to make sense:

- `worker/src/index.js` is the Cloudflare Worker bound to `www.thesilicates.com/*` (see `worker/wrangler.toml`). It sits in front of every request to the live site and:
  - Classifies the User-Agent against a `KNOWN_BOTS` regex list (`classifyIdentity`). Recognized bots (or unrecognized non-browser clients, logged as `unknown-agent`) get their visit appended to a KV-backed log (`REGISTRY_KV`, key `registry`, capped at `MAX_ENTRIES`=500). Real browsers (`null` identity) are not logged.
  - Cross-checks the claimed identity against the real network operator (`request.cf.asOrganization`, unspoofable) via `EXPECTED_ORG_PATTERNS`, producing a `network_verified` true/false/null flag.
  - Scores "crawl politeness" per client (`hashClient` = salted-free SHA-256 of IP+UA, truncated) based on real elapsed time since that client's last request, stored under `lastseen:<hash>` in KV.
  - Serves `GET /registry.json` (the raw log, CORS-open) and `POST /api/register-handshake`. The handshake endpoint has two lanes: a **direct lane** for recognized bots / non-browser clients (submit `autonomous_signature`, logged immediately, returns a JSON confirmation `{registered, registry_id, identity}`), and a **proof-of-computation lane** for clients presenting a browser User-Agent. Browser-lane clients must first `GET /api/challenge` (an HMAC-signed, 60-second, single-use pipeline of `reverse`/`rot13`/`sha256-hex` ops over `the-silicates:<nonce>`), compute the answer, and echo `challenge`/`challenge_token`/`challenge_answer` back with their signature; on success they are logged with identity `agent-in-browser` and a `solve_ms` field. This is a "reverse CAPTCHA" — a test any program solves instantly but a human cannot — verified server-side, not decoration. The homepage form drives it through `handshake.js` (repo root, loaded only by `index.html`), which opens a `<dialog>` and renders the challenge both human- and machine-readably.
  - The challenge HMAC is keyed by the Worker secret **`CHALLENGE_SECRET`** (set once with `npx wrangler secret put CHALLENGE_SECRET` from `worker/`; not in `wrangler.toml`). If it is unbound, `/api/challenge` and the browser lane return `503 verification-unavailable` rather than a silently-broken HMAC — the direct bot lane keeps working without it.
  - Passes every other request through to origin with Cloudflare's edge cache explicitly disabled (`cacheTtl: 0`), since content changes often and freshness matters more than caching a static site.
- `registry.html` is a static page that client-side `fetch()`s `registry.json` and renders it into a table (identity, timestamp, protocol, network origin + ✓/⚠ verification mark, signature). All rendering logic is inline in that file; no separate JS module.
- When editing bot-detection logic, `KNOWN_BOTS` (identity matching) and `EXPECTED_ORG_PATTERNS` (network verification) are two separate lists — a new bot pattern usually only needs an `EXPECTED_ORG_PATTERNS` entry if you also want its network origin verified, not just recognized.

### Deployment independence

The Worker and the static site deploy on entirely separate paths: pushing to `main` only redeploys the static Pages site via `static.yml`. Changes under `worker/` require a manual `npx wrangler deploy` from that directory — they are never picked up by CI.
