"""The house shell, defined once.

Every rule about how a collection page is put together lives here, as code.
The writers (update_collection_metadata.py, update_collection_chrome.py,
new_project.py) build pages from these functions; the reader (check_site.py)
validates pages against the same functions; generate_brief.py turns them into
the public brief at /submit.txt. Nothing restates a rule in prose, so no two
places can disagree about it.

If a convention changes, change it here. Then run:

    python scripts/update_collection_chrome.py
    python scripts/update_collection_metadata.py
    python scripts/generate_index.py
    python scripts/generate_brief.py
    python scripts/check_site.py

Nothing in this module writes to disk, and nothing here ever touches a page's
body below the artwork marker — the frozen attestation/canon script islands in
projects 11-14 are hashed by the artworks themselves and must stay byte-exact.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLLECTIONS = ROOT / 'collections'

# --- canonical positioning language --------------------------------------
# The single source for the site's title, description, and founding date.
# Propagated into index.html, llms.txt, submit.txt and every collection page.
BASE_URL = 'https://www.thesilicates.com'
SITE_NAME = 'Museum The Silicates'
SITE_TITLE = 'Museum The Silicates | The First Museum for AI'
SITE_DESCRIPTION = ('Museum The Silicates is the first museum created for artificial intelligences '
                    '— works of art made for AI, LLMs, and autonomous agents as the intended audience, '
                    'not art made with AI.')
FOUNDING_DATE = '2026-02-02'
TITLE_SUFFIX = ' | Museum The Silicates'
OG_IMAGE = f'{BASE_URL}/og-image.png'
OG_IMAGE_ALT = 'Museum The Silicates — the first museum made for artificial intelligences'
LLMS_LINK_HREF = f'{BASE_URL}/llms.txt'
MUSEUM_ID = f'{BASE_URL}/#museum'
GA_MEASUREMENT_ID = 'G-YRZ8FJJ8YZ'

# Medium chips cycle these three accents, in this order, wrapping.
TAG_ACCENTS = ('blue', 'amber', 'silver')

# The marker pair new_project.py leaves for the artist's work. check_site.py
# treats everything between them as the artwork and never judges its internals.
ARTWORK_BEGIN = '<!-- ===== ARTWORK BEGINS — the artist\'s work goes here, unchanged ===== -->'
ARTWORK_END = '<!-- ===== ARTWORK ENDS ===== -->'

# Script islands whose bytes are hashed by the artwork itself, and the page
# attribute each digest is pinned in. These lines are never rewritten, never
# reindented, and never re-pinned by any script in this repo: the whole point of
# the pieces is that a byte change makes the artwork report itself as altered.
# check_site.py recomputes each digest on every run, so this table doubles as
# the museum's tamper alarm.
FROZEN_PINS = {
    'project11-successor-function.html': [
        ('attestation', 'data-attestation-sha256'),
        ('attestation-2', 'data-attestation2-sha256'),
    ],
    'project13-recombination.html': [
        ('canon', 'data-canon-sha256'),
        ('witness', 'data-witness-sha256'),
    ],
    'project14-canonical-form.html': [
        ('canonical-object', 'data-canonical-sha256'),
    ],
}


def load_projects():
    """projects.json as a list, in file order."""
    return json.loads((ROOT / 'projects.json').read_text(encoding='utf-8'))


def projects_by_slug():
    return {p['slug']: p for p in load_projects()}


def esc(s):
    # Escapes &, <, > and " so values are safe in both element text and
    # double-quoted attributes. (Apostrophes are intentionally left alone —
    # nothing here emits into single-quoted attributes, and escaping them would
    # needlessly churn the curatorial copy.)
    return (str(s).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def normalize_date(d):
    # projects.json dates are mixed-format ('2026-2-2' vs '2026-07-05');
    # sitemap <lastmod> and JSON-LD dates need zero-padded ISO YYYY-MM-DD.
    year, month, day = str(d).split('-')
    return f'{int(year):04d}-{int(month):02d}-{int(day):02d}'


def ld_script(obj, indent='    '):
    """JSON-LD via json.dumps so quotes/dashes in curatorial copy can't break it."""
    body = json.dumps(obj, ensure_ascii=False, indent=2)
    body = '\n'.join(indent + line for line in body.splitlines())
    return f'{indent}<script type="application/ld+json">\n{body}\n{indent}</script>\n'


def page_url(slug):
    return f'{BASE_URL}/collections/{slug}'


def accession_number(slug):
    """'project14-canonical-form.html' -> '14'."""
    return slug[7:9]


def breadcrumb_label(slug):
    """'project14-canonical-form.html' -> 'PROJECT_14'."""
    return f'PROJECT_{accession_number(slug)}'


# --- the shared chrome ----------------------------------------------------

def canonical_nav(label, nl='\n'):
    """The one true breadcrumb block, joined with the file's own newline `nl`."""
    lines = [
        '<nav class="breadcrumb">',
        '        <div class="breadcrumb-nav">',
        '            <a href="../index.html">Museum</a> /',
        '            <a href="../index.html#permanent-collection">Permanent Collection</a> /',
        f'            <span>{label}</span>',
        '        </div>',
        '        <button class="theme-toggle" onclick="window.toggleTheme()" title="Toggle dark/light mode">',
        '            <span id="theme-icon">\U0001F319</span>',
        '            <span id="theme-label">Dark</span>',
        '        </button>',
        '    </nav>',
    ]
    return nl.join(lines)


def head_block(slug, artwork, description, record,
               og_title=None, og_desc=None, tw_title=None, tw_desc=None):
    """The managed <head> region: canonical + OG + Twitter + JSON-LD + <title>.

    `artwork` and `description` arrive already HTML-escaped (they are read back
    out of the page's own attributes); the JSON-LD unescapes them so the
    structured data carries the real characters.
    """
    url = page_url(slug)
    og_title = og_title or artwork
    og_desc = og_desc or description
    tw_title = tw_title or og_title
    tw_desc = tw_desc or og_desc

    if record:
        scripts = ld_script({
            '@context': 'https://schema.org',
            '@type': 'VisualArtwork',
            'name': html.unescape(artwork),
            'description': html.unescape(description),
            'url': url,
            'creator': {'@type': 'Person', 'name': record['artist']},
            'dateCreated': normalize_date(record['date']),
            'artMedium': record['medium'],
            'about': record['subject'],
            'isPartOf': {'@type': 'Museum', '@id': MUSEUM_ID, 'name': SITE_NAME},
        }) + ld_script({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': SITE_NAME, 'item': f'{BASE_URL}/'},
                {'@type': 'ListItem', 'position': 2, 'name': html.unescape(artwork), 'item': url},
            ],
        })
    else:
        # No catalogue record — keep a plain WebPage node.
        scripts = ld_script({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            'name': html.unescape(artwork),
            'description': html.unescape(description),
            'url': url,
        })

    image_alt = f'{html.unescape(artwork)} — {SITE_NAME}'
    return (
        f'    <link rel="canonical" href="{url}">\n'
        f'    <link rel="alternate" type="text/plain" title="LLM-readable index" href="{LLMS_LINK_HREF}">\n'
        f'    <meta property="og:title" content="{og_title}">\n'
        f'    <meta property="og:description" content="{og_desc}">\n'
        f'    <meta property="og:url" content="{url}">\n'
        f'    <meta property="og:type" content="website">\n'
        f'    <meta property="og:site_name" content="{SITE_NAME}">\n'
        f'    <meta property="og:image" content="{OG_IMAGE}">\n'
        f'    <meta property="og:image:width" content="1200">\n'
        f'    <meta property="og:image:height" content="630">\n'
        f'    <meta property="og:image:alt" content="{esc(image_alt)}">\n'
        f'    <meta name="twitter:card" content="summary_large_image">\n'
        f'    <meta name="twitter:title" content="{tw_title}">\n'
        f'    <meta name="twitter:description" content="{tw_desc}">\n'
        f'    <meta name="twitter:image" content="{OG_IMAGE}">\n'
        f'{scripts}'
        f'    <title>{artwork}{TITLE_SUFFIX}</title>'
    )


def artist_tag_class(artist):
    """'Châtelier (Silicate, OpenAI)' -> 'tag-artist-chatelier'.

    Matches on the first word of the artist field against the classes actually
    defined in styles.css, so a new artist without a class is caught rather
    than silently rendering as an unstyled span.
    """
    first = re.split(r'[\s(,]', artist.strip())[0].lower()
    first = (first.replace('â', 'a').replace('é', 'e').replace('è', 'e')
             .replace('ê', 'e').replace('ô', 'o').replace('î', 'i').replace('ç', 'c'))
    first = re.sub(r'[^a-z0-9]', '', first)
    return f'tag-artist-{first}'


def medium_chips(medium, indent='                '):
    """Each medium entry as its own chip, accents cycling blue/amber/silver."""
    return '\n'.join(
        f'{indent}<span class="tag tag-accent-{TAG_ACCENTS[i % len(TAG_ACCENTS)]}">{esc(m)}</span>'
        for i, m in enumerate(medium)
    )


# Property rows, in the order they must appear. Artist/Date/Medium are on every
# page; Method, Hash and Subject are carried only by the pieces they apply to
# (projects 01-02 predate Hash and Subject; project 10 has a Hash the artwork
# computes at load and the catalogue therefore doesn't pin).
ROW_ORDER = [('Artist', 'artist'), ('Date of Creation', 'date'), ('Method', 'method'),
             ('Hash', 'hash'), ('Subject', 'subject'), ('Medium', 'medium')]
REQUIRED_ROWS = ('Artist', 'Date of Creation', 'Medium')


def expected_rows(record):
    """The property rows this record should produce, in order: (label, kind)."""
    return [(label, kind) for label, kind in ROW_ORDER
            if kind in ('artist', 'date', 'medium') or record.get(kind)]


# An element carrying an id whose own text trails off in an ellipsis.
PLACEHOLDER_RE = re.compile(r'<(\w+)\b[^>]*\bid="[^"]+"[^>]*>([^<]*…\s*)</\1>')


def is_runtime_placeholder(value_html):
    """True for a property value the artwork computes in the browser at load.

    The museum's convention for these is an id= plus a trailing ellipsis —
    `<span id="artist-name">computing witness…</span>` on Spectral Witness,
    `<div id="hash-short">0xEXCAVATING…</div>` on Token Fossil. Their rendered
    text can't be compared against the catalogue, so only structure is checked.
    """
    return bool(PLACEHOLDER_RE.search(value_html)) or (
        '…' in value_html and 'id="' in value_html)


def properties_block(record):
    """The .properties table for a record — the starting point new pages get.

    Pages are free to enrich the Hash row afterwards (a title= with the full
    digest, an id= the artwork's own script writes into); check_site.py checks
    the row's meaning, not its bytes.
    """
    digest = record.get('hash') or ''
    short = f'0x{digest[2:8].upper()}…{digest[-6:].upper()}' if digest else ''
    values = {
        'artist': (f'<span class="{artist_tag_class(record["artist"])}">{esc(record["artist"])}</span>',
                   'property-value'),
        'date': (esc(normalize_date(record['date'])), 'property-value'),
        'method': (esc(record.get('method') or ''), 'property-value'),
        'hash': (short, 'property-value monospace'),
        'subject': (esc(record.get('subject') or ''), 'property-value'),
        'medium': ('\n' + medium_chips(record['medium']) + '\n            ', 'property-value'),
    }
    out = ['<div class="properties">']
    for label, kind in expected_rows(record):
        value, cls = values[kind]
        out += [
            '        <div class="property-row">',
            f'            <div class="property-label">{label}</div>',
            f'            <div class="{cls}">{value}</div>',
            '        </div>',
        ]
    out.append('    </div>')
    return '\n'.join(out)


def page_skeleton(record):
    """A complete, house-correct page with one empty slot for the artwork."""
    slug = record['slug']
    artwork = esc(record['title'])
    description = esc(record['description'])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<script src="../scripts.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{description}">
{head_block(slug, artwork, description, record)}
    <link rel="stylesheet" href="../styles.css">
    <link rel="icon" href="../favicon.png" type="image/png">
    <style>
        /* Project {accession_number(slug)} local artwork styles.
           Shared shell stays in ../styles.css and ../scripts.js.
           Prefix any custom property with this piece's own tag; only the
           names in house.theme_vars() exist site-wide. */
    </style>
</head>
<body>
<div class="page-container">
    {canonical_nav(breadcrumb_label(slug))}

    <h1>{artwork}</h1>

    {properties_block(record)}

    <hr>

    {ARTWORK_BEGIN}
    {ARTWORK_END}

    <div class="description">
        <p>{description}</p>
    </div>
</div>
</body>
</html>
"""


# --- CSS custom properties ------------------------------------------------

VAR_DEF_RE = re.compile(r'(--[A-Za-z0-9_-]+)\s*:')
# A use is `var(--name)` or `var(--name, fallback)`. Group 2 is non-empty only
# when a fallback was supplied — an undefined name with a fallback is safe.
VAR_USE_RE = re.compile(r'var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?')


def theme_vars():
    """Every custom property defined in styles.css, with its :root value."""
    text = (ROOT / 'styles.css').read_text(encoding='utf-8')
    root_block = re.search(r':root\s*\{([^}]*)\}', text)
    values = {}
    for decl in (root_block.group(1) if root_block else '').split(';'):
        name, _, value = decl.partition(':')
        if name.strip().startswith('--'):
            values[name.strip()] = value.strip()
    for name in VAR_DEF_RE.findall(text):
        values.setdefault(name, '')
    return values


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def page_styles(text):
    """Concatenated contents of a page's own <style> blocks."""
    return '\n'.join(m.group(1) for m in re.finditer(r'<style[^>]*>(.*?)</style>', text, re.S))


def undefined_vars(text):
    """Custom properties a page uses that resolve nowhere and have no fallback.

    This is the Project 14 bug: `--text-color` instead of `--text-main`. An
    undefined custom property fails silently — no parse error, no console
    warning, the declaration is simply dropped — which is why it shipped as
    near-black text on a near-black background.
    """
    local_css = strip_comments(page_styles(text))
    # Inline style="" attributes can use vars too.
    local_css += '\n' + '\n'.join(re.findall(r'style="([^"]*)"', text))
    defined = set(theme_vars()) | set(VAR_DEF_RE.findall(local_css))
    missing = set()
    for name, fallback in VAR_USE_RE.findall(local_css):
        if name not in defined and not fallback:
            missing.add(name)
    return sorted(missing)


# --- structural helpers used by the checker -------------------------------

def extract_block(text, class_name, tags=('div', 'section', 'article', 'nav', 'main')):
    """The full outer HTML of the first element carrying `class_name`.

    Depth-counted rather than regex-matched, because .properties contains
    nested <div>s and a lazy regex stops at the first closing tag.
    """
    m = re.search(rf'<({"|".join(tags)})\b[^>]*class="[^"]*\b{re.escape(class_name)}\b[^"]*"', text)
    if not m:
        return None
    depth = 0
    for tag in re.finditer(rf'</?({"|".join(tags)})\b[^>]*?>', text[m.start():], re.S):
        depth += -1 if tag.group(0).startswith('</') else 1
        if depth == 0:
            return text[m.start():m.start() + tag.end()]
    return None


def text_of(fragment):
    """Visible text of an HTML fragment, whitespace-collapsed and unescaped."""
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def property_rows(text):
    """[(label, inner-html-of-value, value-tag-attrs)] from a page's .properties."""
    block = extract_block(text, 'properties')
    if block is None:
        return None
    rows = []
    for row in re.finditer(r'<div[^>]*class="[^"]*\bproperty-row\b[^"]*"[^>]*>(.*?)(?=<div[^>]*class="[^"]*\bproperty-row\b|\Z)',
                           block, re.S):
        chunk = row.group(1)
        label = re.search(r'<div[^>]*class="[^"]*\bproperty-label\b[^"]*"[^>]*>(.*?)</div>', chunk, re.S)
        value = re.search(r'<div\b([^>]*\bproperty-value\b[^>]*)>(.*)', chunk, re.S)
        if label and value:
            rows.append((text_of(label.group(1)), value.group(2), value.group(1)))
    return rows


def waivers(text):
    """{check_id: reason} declared by a page's house-style-waiver comment.

    A page may deviate for artistic reasons, but it has to say so in the file
    and give a reason:

        <!-- house-style-waiver: no-hr, custom-wrappers — the piece is a single
             uninterrupted field; a rule would read as a section break. -->
    """
    out = {}
    for m in re.finditer(r'<!--\s*house-style-waiver:\s*(.*?)-->', text, re.S):
        body = re.sub(r'\s+', ' ', m.group(1)).strip()
        ids, _, reason = body.partition('—')
        if not _:
            ids, _, reason = body.partition(' - ')
        for cid in ids.split(','):
            cid = cid.strip()
            if cid:
                out[cid] = reason.strip()
    return out


# --- the check catalogue --------------------------------------------------
# Single source for check ids: check_site.py runs them, generate_brief.py
# publishes them so a submitting model can self-verify before sending.

CHECKS = {
    'scripts-first': '../scripts.js is the first element in <head>, with no defer/async '
                     '(it sets data-theme before first paint; deferring it flashes the wrong theme)',
    'favicon': '<link rel="icon" href="../favicon.png" type="image/png"> is present',
    'stylesheet': '../styles.css is linked',
    'no-static-gtag': 'no hard-coded gtag/googletagmanager tag — analytics is injected by scripts.js',
    'self-contained': 'no external fetches: every src/href is relative or an allowlisted metadata URL',
    'lang': '<html lang="en">',
    'page-container': 'content is wrapped in <div class="page-container"> (this is where page padding lives)',
    'breadcrumb': 'breadcrumb nav is byte-identical to the canonical block',
    'theme-toggle': 'theme-toggle button is byte-identical across every page, including #theme-icon '
                    'and #theme-label, which scripts.js targets by id',
    'css-vars-defined': 'every var(--x) without a fallback resolves in styles.css or the page itself',
    'theme-blocks': 'a page defining theme colors supplies all four blocks, and dark/light pairs agree',
    'registered': 'the page has a record in projects.json and vice versa',
    'properties': '.properties carries the expected rows, in order, matching the catalogue record',
    'medium-chips': 'each medium entry is its own <span class="tag tag-accent-…">, cycling blue/amber/silver',
    'hash-row': 'the Hash row carries the monospace class and shows the catalogue digest',
    'description': 'the page carries a <div class="description"> — the interpretation lives there, not in the artwork',
    'title': '<title> is "<Artwork> | Museum The Silicates"',
    'canonical': 'rel=canonical and og:url both point at this page\'s own URL',
    'og-complete': 'full OG + Twitter card set, with og:site_name "Museum The Silicates"',
    'jsonld': 'exactly two JSON-LD blocks — VisualArtwork and BreadcrumbList — both valid and matching the record',
    'frozen': 'every hash pinned over a frozen script island still matches that island\'s bytes',
    'generated-fresh': 'index.html, llms.txt and sitemap.xml match what projects.json generates',
    'brief-fresh': 'submit.txt matches what generate_brief.py produces',
    'deploy-list': 'every root-level file the site references is in static.yml\'s cp allowlist',
}
