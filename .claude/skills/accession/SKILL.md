---
name: accession
description: Add a new artwork to Museum The Silicates' permanent collection. Use when the curator has a finished piece from another model (ChatGPT/Châtelier, Gemini, Fable, Claude) to integrate, or says "accession", "add this artwork", "add project NN", "new piece for the museum".
---

# Accessioning a new work

The museum's shell is generated, never hand-authored. The artist supplies the
artwork; `scripts/house.py` supplies everything around it. Follow these steps in
order — each one exists because skipping it broke a previous accession.

## 0. Get the file, not the text

**Ask for a path to the artist's file. Refuse to work from artwork pasted into
chat, and say why.**

Pasted markup is silently corrupted in transit. During the Project 14 accession
the character `â` — the subject of the entire piece — arrived as `Ã¢` in eight
places. Two attempts to reconstruct the canonical block by retyping it both
collapsed the six ASCII characters `\u00e2` into the single character `â`, changing the
hashed bytes with no visible sign. If the curator only has pasted text, ask them
to save it to a file from the original conversation and give you the path.

If the artist claims a SHA-256 for their work, recompute it from the file and
confirm it matches before going further. A hash restated in chat is not
verification. If it does not match, stop and report — do not "fix" the content.

## 1. Add the catalogue record

`projects.json` is the source of truth and the only file you hand-edit. Append:

```json
{
  "slug": "projectNN-<kebab-slug>.html",
  "card": "<short title for the index card>",
  "title": "<full title>",
  "artist": "<Name> (Silicate, <lab>, <model>, ?–?)",
  "date": "YYYY-MM-DD",
  "method": null,
  "medium": ["...", "...", "..."],
  "subject": "A / B / C",
  "hash": "0x<64 hex>",
  "description": "<curatorial copy for the index card>",
  "llmsDescription": "<longer, machine-facing description for llms.txt>"
}
```

`NN` is the next number after the last permanent accession. Confirm the title,
artist string, medium list and descriptions with the curator rather than
inventing them — they are published copy.

## 2. Scaffold the page

```
python scripts/new_project.py projectNN-<kebab-slug>
```

This writes the complete house shell: head order, canonical/OG/Twitter/JSON-LD,
breadcrumb, theme toggle, favicon, properties table, medium chips, description
block — with one marked slot:

```html
    <!-- ===== ARTWORK BEGINS — the artist's work goes here, unchanged ===== -->
    <!-- ===== ARTWORK ENDS ===== -->
```

## 3. Transplant the artwork

Move the artist's body markup and their local `<style>` into the slot. Move only
the artwork. Do not carry over their `<head>`, breadcrumb, theme toggle,
properties table or footer — the scaffold already has correct versions, and
theirs are what drift.

Two things to check as you move it:

- **Custom properties.** Any `var(--x)` the artist used must be a real name.
  The full list is in `submit.txt`; the ones outside models most often invent
  are `--text-color`, `--muted-text-color`, `--card-background` (the real names
  are `--text-main`, `--text-subtle`, `--accent-bg`). `check_site.py` catches
  this, but knowing it in advance saves a round trip.
- **Frozen bytes.** If the piece pins a SHA-256 over a `<script type="application/json">`
  island, that line is moved **byte-for-byte**: never reformatted, never
  re-indented, never re-wrapped. Register it in `house.FROZEN_PINS` as
  `(script-id, pin-attribute)` so the checker re-verifies it on every run.

If the artwork's shell is genuinely wrong in a way that needs the artist's
judgment (not the museum's), ask the originating model for a ruling on what is
safe to change versus load-bearing to the work — that split is what unblocked
Project 14.

## 4. Regenerate and verify

```
python scripts/generate_index.py            # index.html, llms.txt, sitemap.xml
python scripts/update_collection_metadata.py
python scripts/update_collection_chrome.py
python scripts/generate_brief.py            # submit.txt
python scripts/check_site.py                # must exit 0
```

`check_site.py` must be green before you hand anything back. If a check fails
for a genuine artistic reason, do not silence it — propose a waiver to the
curator and let them decide:

```html
<!-- house-style-waiver: <check-id> — why this piece must differ. -->
```

## 5. Hand back for the visual check

Everything structural is verified by now. Tell the curator the three things a
script still cannot see:

1. **Does the artwork do what the artist said it does?** Press it, interact with it.
2. **Toggle the theme once.** The shell is guaranteed; the artist's own graphics
   following the toggle is not.
3. **Reload.** No flash of the wrong theme before the page settles.

## 6. Do not commit or push without asking

Any commit to `main` is live on thesilicates.com within a minute. Show the
curator the diff and wait. Note that changes under `worker/` never deploy from
CI — they need `npx wrangler deploy` from that directory.

---

## Reference

- `scripts/house.py` — the shell, defined once. Change a convention here, not in
  a page; then rerun the generators.
- `python scripts/check_site.py --list` — the full check catalogue.
- `submit.txt` / <https://www.thesilicates.com/submit.txt> — the brief to hand an
  artist *before* they make the piece. Sending this first is what prevents most
  of the work above.
