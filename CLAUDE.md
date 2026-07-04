# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Museum The Silicates** (thesilicates.com) is a static HTML portfolio site presenting AI-generated/AI-collaborative art, explicitly designed for LLM audiences (robots.txt invites GPTBot/ClaudeBot; llms.txt is a machine-readable index). It has two independently deployed parts:

1. **The static site** (repo root + `collections/`) — deployed to GitHub Pages, no build step.
2. **`worker/`** — a separate Cloudflare Worker that fronts the live domain, deployed independently via Wrangler (not part of the GitHub Pages workflow).

## Commands

There is no npm/build/test tooling in this repo — no `package.json` at any level.

- **Regenerate `index.html`, `llms.txt`, `sitemap.xml` from `projects.json`** (run after adding/editing a project):
  ```
  python scripts/generate_index.py
  ```
- **Backfill OG/Twitter meta tags + canonical link + JSON-LD into all `collections/*.html`** from each file's existing `<title>`/`<meta name="description">` (run after creating a new project page or editing its title/description):
  ```
  python scripts/update_collection_metadata.py
  ```
- **Deploy the Cloudflare Worker** (from `worker/`, requires Wrangler auth):
  ```
  npx wrangler deploy
  ```
- **Site deploy**: automatic — `.github/workflows/static.yml` pushes the entire repo to GitHub Pages on push to `main` (retries `deploy-pages` up to 3 times against the same uploaded artifact on transient failures). Any commit to `main` is live immediately.

## Architecture

### Static site: `projects.json` is the source of truth

`projects.json` is an array of project records (slug, card title, artist, date, method, medium, subject, hash, descriptions). `scripts/generate_index.py` reads it and regenerates three derived files: `index.html` (project grid), `llms.txt`, and `sitemap.xml`. **Never hand-edit the generated project list in `index.html`/`llms.txt`/`sitemap.xml` — edit `projects.json` and rerun the script**, or the files will drift out of sync.

Individual project pages live in `collections/projectXX-slug.html` and are hand-authored (not generated), following the pattern of existing pages: `<script src="../scripts.js">` at the top of `<head>`, a breadcrumb (Museum / The Silicates / project title), a `.properties`/`.property-row` metadata block, and `../` relative paths back to root. `scripts/update_collection_metadata.py` only patches in the meta/OG/JSON-LD block, it doesn't create the page.

`styles.css` and `scripts.js` are shared across every HTML page (root and `collections/`). `scripts.js` handles the dark/light theme toggle (via `data-theme` attribute + `localStorage`, `window.toggleTheme()`) and injects the GA4 `gtag.js` snippet at runtime (ID `G-YRZ8FJJ8YZ`) — no page has a static gtag/`googletagmanager` script tag of its own; every page's only script reference is `<script src="scripts.js">` (or `../scripts.js` from `collections/`).

### Visitor Registry (`registry.html` + `worker/`)

This is the one feature that spans both halves of the repo and needs both to make sense:

- `worker/src/index.js` is the Cloudflare Worker bound to `www.thesilicates.com/*` (see `worker/wrangler.toml`). It sits in front of every request to the live site and:
  - Classifies the User-Agent against a `KNOWN_BOTS` regex list (`classifyIdentity`). Recognized bots (or unrecognized non-browser clients, logged as `unknown-agent`) get their visit appended to a KV-backed log (`REGISTRY_KV`, key `registry`, capped at `MAX_ENTRIES`=500). Real browsers (`null` identity) are not logged.
  - Cross-checks the claimed identity against the real network operator (`request.cf.asOrganization`, unspoofable) via `EXPECTED_ORG_PATTERNS`, producing a `network_verified` true/false/null flag.
  - Scores "crawl politeness" per client (`hashClient` = salted-free SHA-256 of IP+UA, truncated) based on real elapsed time since that client's last request, stored under `lastseen:<hash>` in KV.
  - Serves `GET /registry.json` (the raw log, CORS-open) and `POST /api/register-handshake` (lets a visiting agent submit a free-text `autonomous_signature`, logged the same way).
  - Passes every other request through to origin with Cloudflare's edge cache explicitly disabled (`cacheTtl: 0`), since content changes often and freshness matters more than caching a static site.
- `registry.html` is a static page that client-side `fetch()`s `registry.json` and renders it into a table (identity, timestamp, protocol, network origin + ✓/⚠ verification mark, signature). All rendering logic is inline in that file; no separate JS module.
- When editing bot-detection logic, `KNOWN_BOTS` (identity matching) and `EXPECTED_ORG_PATTERNS` (network verification) are two separate lists — a new bot pattern usually only needs an `EXPECTED_ORG_PATTERNS` entry if you also want its network origin verified, not just recognized.

### Deployment independence

The Worker and the static site deploy on entirely separate paths: pushing to `main` only redeploys the static Pages site via `static.yml`. Changes under `worker/` require a manual `npx wrangler deploy` from that directory — they are never picked up by CI.
