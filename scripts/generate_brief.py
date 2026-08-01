"""Generate submit.txt — the brief handed to any model making work for the museum.

    python scripts/generate_brief.py           # write submit.txt
    python scripts/generate_brief.py --check   # verify it is current (CI)

Published at https://www.thesilicates.com/submit.txt, beside robots.txt and
llms.txt, so a submitting model can be pointed at a URL instead of a paste.

It is generated rather than written because the part that matters most — the
list of CSS custom properties that actually exist — is read live from styles.css.
The Project 14 accession shipped near-invisible dark-mode text because the page
used --text-color, --muted-text-color and --card-background, none of which exist.
That documentation had existed once, in .github/copilot-instructions.md, and was
lost when the file was deleted. Deriving it from the stylesheet means it cannot
go stale or be deleted again.
"""
import sys

from house import (BASE_URL, CHECKS, FOUNDING_DATE, ROOT, SITE_NAME, TAG_ACCENTS,
                   load_projects, theme_vars)

CHECK_ONLY = '--check' in sys.argv


def var_table():
    """Every custom property in styles.css with its light and dark value.

    The site declares its palette in several :root blocks (the base set, then
    the exhibition accents) and mirrors each in a [data-theme="dark"] block, so
    every matching block is merged rather than just the first.
    """
    import re
    css = (ROOT / 'styles.css').read_text(encoding='utf-8')
    # :root inside a media query is the dark fallback, not the light default.
    css_no_media = re.sub(r'@media[^{]*\{\s*:root\s*\{[^}]*\}\s*\}', '', css, flags=re.S)

    def merged(pattern, text):
        out = {}
        for m in re.finditer(pattern, text, re.S):
            for decl in m.group(1).split(';'):
                name, _, value = decl.partition(':')
                if name.strip().startswith('--'):
                    out[name.strip()] = value.strip()
        return out

    light = merged(r':root\s*\{([^}]*)\}', css_no_media)
    dark = merged(r'\[data-theme="dark"\]\s*\{([^}]*)\}', css)

    # The font stack is long enough to wreck a fixed-width table; it is listed
    # under the table instead.
    rows = [(n, light.get(n, '—'), dark.get(n, light.get(n, '—')))
            for n in theme_vars() if n != '--notion-font']
    width = max(len(n) for n, _, _ in rows)
    lightw = max(len(v) for _, v, _ in rows)
    lines = [f'  {"name".ljust(width)}  {"light".ljust(lightw)}  dark',
             f'  {"-" * width}  {"-" * lightw}  {"-" * lightw}']
    for name, lv, dv in rows:
        lines.append(f'  {name.ljust(width)}  {lv.ljust(lightw)}  {dv}')
    lines.append('')
    lines.append(f'  --notion-font  {light.get("--notion-font", "—")}')
    return '\n'.join(lines)


def build():
    projects = load_projects()
    permanent = [p for p in projects if p.get('exhibition') != 'special']
    next_number = len(permanent) + 1
    artists = sorted({p['artist'].split(' (')[0] for p in projects})

    return f"""# Submitting work to {SITE_NAME}

> {BASE_URL}/submit.txt — the brief for any model making a work for this museum.
> Generated from the live stylesheet and check catalogue; never hand-edited.

{SITE_NAME} ({BASE_URL}) is the first museum whose intended audience is
machines. Founded {FOUNDING_DATE}. Works here are made *for* AI, LLMs and
autonomous agents to read, analyze and inspect — not made *with* AI as a tool
for human viewers. The permanent collection holds {len(permanent)} accessions;
the next is project{next_number:02d}. Artists to date: {', '.join(artists)}.

If you have been asked to make a piece for this collection, read all of it.
Everything below is enforced by `scripts/check_site.py`, which gates deployment.


## 1. Deliver a file. Never paste the work into chat.

Send a path, or attach the .html file. Do not paste the markup into a
conversation and do not restate its hash as evidence.

This is not a preference. During the Project 14 accession the character `â` —
the entire subject of the piece — arrived as `Ã¢` in eight places, mangled by
transcription. Two separate attempts to reconstruct the canonical block by hand
silently collapsed six-character `\\u00e2` escape notation into the literal
character, changing the hashed bytes with no visible sign in either direction.
A hash you restate in chat verifies nothing; only the file does.

If your work pins its own SHA-256, say which bytes the digest covers, exactly:
which element, and what normalization (trimmed outer whitespace? UTF-8? NFC?).


## 2. Write the artwork. Do not write the shell.

The museum generates every page's chrome from `scripts/house.py`:

    <head> and all metadata      breadcrumb navigation      theme toggle
    <title>, canonical, OG,      the .properties table      favicon
    Twitter cards, JSON-LD       medium tag chips           <div class="description">

Anything you write for those is discarded and regenerated. What the museum needs
from you is the artwork itself:

  * the markup for the work, and
  * one local `<style>` block for it.

Both are dropped into a marked slot in a page that is already correct. This is
the single most useful thing to understand about submitting here: every
consistency problem in the last accession came from a submission that authored
the shell by guessing at it, and every guess was plausible and wrong.


## 3. The CSS custom properties that exist

These are read from the live styles.css. **A custom property that is not on this
list does not exist.** An undefined custom property does not raise an error, does
not warn, and does not fall back — the declaration is silently dropped. That is
how Project 14 shipped near-black text on a near-black background: it used
`--text-color`, `--muted-text-color` and `--card-background`, which look right
and are not real. The real names are `--text-main`, `--text-subtle`, `--accent-bg`.

{var_table()}

Define your own properties freely, but namespace them with a tag belonging to
your piece (`--cf-` for Canonical Form, `--rc-` for Recombination) so they can
never collide with the shared set. Deriving them from the shared ones is the
safest pattern, and it themes for free:

    :root {{
      --xx-fg:   var(--text-main);
      --xx-line: var(--border-color);
    }}

Class names you may use: `.monospace`, `.tag`, `.tag-accent-{{{"|".join(TAG_ACCENTS)}}}`,
`.canvas`, `.canvas-container`, `.controls`, `.hidden`, `.description`.


## 4. House constraints

  * **Zero external fetches.** No CDN, no framework, no web font, no remote
    image, no analytics, no XHR to another host. The page must render fully with
    the network disconnected. Web Audio, Canvas and WebGL are encouraged — they
    fetch nothing.
  * **Theme-aware.** The site toggles `data-theme="dark"|"light"` on `<html>`,
    and also honours the OS setting. If your piece declares its own theme colors,
    it must supply all four blocks — `:root`, `@media (prefers-color-scheme:
    dark)`, `[data-theme="dark"]`, `[data-theme="light"]` — with the dark pair
    identical to each other and the light pair identical to each other. Deriving
    from the shared properties instead avoids this entirely.
  * **Meaningful without JavaScript.** The structure carries the work. If the
    piece computes something, put the canonical data in the markup as a readable
    island (`<script type="application/json" id="...">`) so the page is legible
    and complete with scripting off.
  * **No autoplay.** Sound and motion begin when a visitor acts.
  * **Self-verifying, if the work is about integrity.** Pin the SHA-256 of your
    canonical structure and recompute it in the browser at load. Once published,
    those bytes are frozen forever: they are never reformatted, never
    re-indented, and never re-pinned. If a published piece needs correcting, the
    museum appends a new attestation quoting the previous digest rather than
    editing the old one.
  * **Non-didactic.** The work does not explain itself. Captions, verdict lines
    and manifest notes read like a document, not a docent; the interpretation
    belongs in the description block, which the museum writes.


## 5. What is checked before your work goes live

Every submission is verified by `python scripts/check_site.py`, which gates
deployment. You can self-check against this list before sending:

{chr(10).join(f'  {cid:<18} {desc}' for cid, desc in CHECKS.items())}

A piece may deviate from any of these for a genuine artistic reason, by
declaring it in the page itself with a reason:

    <!-- house-style-waiver: <check-id> — why this piece must differ. -->

Waivers are reported on every run rather than hidden, so they stay exceptional.
Tell the curator which one you need and why; do not add them silently.


## 6. Contact

MuseumTheSilicates@gmail.com — Martin Floris, curator.
Machine-readable index of the collection: {BASE_URL}/llms.txt
Visitor registry, and the handshake endpoint: {BASE_URL}/registry.html
"""


def main():
    path = ROOT / 'submit.txt'
    content = build()
    if not CHECK_ONLY:
        path.write_text(content, encoding='utf-8')
        print(f'Wrote submit.txt ({len(content.splitlines())} lines)')
        return 0
    if not path.exists() or path.read_text(encoding='utf-8') != content:
        print('submit.txt is out of date — run: python scripts/generate_brief.py')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
