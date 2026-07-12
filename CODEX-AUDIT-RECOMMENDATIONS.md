# Codebase audit recommendations

Audit date: 2026-07-11

This note records the follow-up work identified during a repository-wide review. It is advisory only; no implementation changes were made as part of the audit.

## Highest priority

- Make Visitor Registry writes lossless. `worker/src/index.js` currently performs a KV read-modify-write on one array, so concurrent visits can overwrite one another. Use a Durable Object for serialized writes, or redesign storage around one key per entry plus an index.
- Protect the handshake endpoint. Add a maximum signature length, content-type validation, rate limiting/cooldowns, and a policy for duplicate/spam submissions. Avoid calling a User-Agent classification `verified_autonomous`; it is spoofable. Use a name such as `classified_as_machine`.
- Add automated validation before Pages deployment: generated-file drift, theme sync, link/JSON-LD validation, Python/JavaScript syntax, and all artwork hash/integrity checks.
- Publish a curated site artifact instead of `path: '.'` from `.github/workflows/static.yml`; keep Worker source, maintenance scripts, and internal project notes out of the public Pages artifact where possible.

## Privacy, rights, and security

- Document Google Analytics, registry data, retention, visitor correlation, and the handshake in a privacy/data-use page. Review the arrangement for applicable EU/Netherlands requirements.
- Replace the public truncated SHA-256 of IP + User-Agent with a secret HMAC (with a documented rotation/retention policy) if repeat-client correlation is still needed.
- Review the rights and provenance of the large Quote Atlas embedded in `collections/the-unlocated.html`, especially Goodreads quotations and modern translations. Record source/licensing/takedown information.
- Add Worker security headers where compatible: Content Security Policy, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`. Inline scripts/styles may need extraction or a carefully scoped policy first.
- Pin GitHub Actions to commit SHAs and add Worker tests for classification, network verification, malformed KV data, rate limiting, and concurrent writes.

## Performance and operations

- Replace the current blanket origin cache bypass with differentiated caching: long-lived static assets, short-lived collection HTML, and no/short caching for the registry API.
- Add an explicit Worker deployment workflow or documented release procedure, with version/build visibility so the live Worker and static site can be identified independently.
- Consider exposing a small deployment/version diagnostic endpoint that does not reveal secrets.

## Accessibility and maintainability

- Add a real `<label>` for the temperature range input in `collections/project05-the-entropy-of-inference.html`.
- Do a focused keyboard/screen-reader pass over the interactive SVG/canvas works and registry updates; preserve the strong no-JavaScript fallbacks.
- Make `localStorage` theme access exception-safe for restrictive browser/privacy modes.
- Add explicit accession numbers and optional `updated` dates to `projects.json`; avoid deriving numbering from slug slicing and avoid using creation dates as sitemap modification dates.
- Add `--check`/dry-run modes to the generator scripts so CI can detect drift without rewriting files.

## Verified during the audit

- `index.html`, `llms.txt`, and `sitemap.xml` reproduce exactly from `projects.json`.
- Local HTML references and JSON-LD parse cleanly; no duplicate IDs were found.
- Theme synchronization and Python/JavaScript syntax checks pass.
- The frozen Project 11 attestation chain, Project 12 MRZ hash, and The Unlocated catalogue hash all verify.
- No implementation changes were made during this audit.
