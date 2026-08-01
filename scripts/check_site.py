"""Verify the whole site against the house shell. Writes nothing; exits 1 on failure.

    python scripts/check_site.py          # run every check
    python scripts/check_site.py --list   # print the check catalogue

This is what CI gates the deploy on. Every check here exists because something
actually went wrong once — most of them during the Project 14 accession, where
a page passed hash verification, tag-balance and JSON validation while shipping
a dead theme toggle, near-invisible dark-mode text, and a missing tab icon.

A page may deviate deliberately by declaring a waiver in the file itself:

    <!-- house-style-waiver: description — the piece is its own commentary;
         a prose block would explain what the work already says. -->

Waived checks are reported as ACCEPTED DEVIATION rather than failures, so the
exceptions stay visible instead of quietly becoming the norm.

Special exhibitions (exhibition: "special" in projects.json) are shown in their
own design language and are exempt from the shell checks by definition; they
are still checked for self-containment and catalogue registration.
"""
import html
import json
import re
import subprocess
import sys
from pathlib import Path

import house
from house import (BASE_URL, COLLECTIONS, ROOT, SITE_NAME, TAG_ACCENTS, TITLE_SUFFIX,
                   CHECKS, canonical_nav, breadcrumb_label, extract_block,
                   normalize_date, property_rows, text_of, waivers)

problems = []      # (scope, check_id, message)
deviations = []    # (scope, check_id, reason)


def fail(scope, check_id, message):
    problems.append((scope, check_id, message))


# --- shared chrome --------------------------------------------------------

def check_head(name, text):
    head = text[:text.find('</head>')] if '</head>' in text else text

    first_script = re.search(r'<script\b[^>]*>', head)
    if not first_script or 'src="../scripts.js"' not in first_script.group(0):
        fail(name, 'scripts-first', '../scripts.js must be the first script in <head> '
                                    '(it sets data-theme before first paint)')
    elif re.search(r'\b(defer|async)\b', first_script.group(0)):
        fail(name, 'scripts-first', 'scripts.js must not be defer/async — deferring it '
                                    'flashes the wrong theme on load')

    if '<link rel="icon" href="../favicon.png" type="image/png">' not in head:
        fail(name, 'favicon', 'missing <link rel="icon" href="../favicon.png" type="image/png"> '
                              '— the browser tab falls back to a nonexistent /favicon.ico')

    if 'href="../styles.css"' not in head:
        fail(name, 'stylesheet', 'missing <link rel="stylesheet" href="../styles.css">')

    if re.search(r'googletagmanager|gtag\(', head):
        fail(name, 'no-static-gtag', 'analytics is injected at runtime by scripts.js; '
                                     'no page carries its own gtag tag')

    if not re.search(r'<html\s+lang="en">', text):
        fail(name, 'lang', 'missing <html lang="en">')


def check_self_contained(name, text):
    """No external fetches. Outbound <a href> links are fine; loaded resources are not."""
    allowed = (BASE_URL, 'https://schema.org', 'http://schema.org',
               'https://www.sitemaps.org', 'https://www.w3.org')
    offenders = set()
    for m in re.finditer(r'\bsrc="(https?://[^"]+)"', text):
        offenders.add(m.group(1))
    for m in re.finditer(r'<link\b[^>]*\bhref="(https?://[^"]+)"[^>]*>', text):
        if 'rel="canonical"' in m.group(0) or 'rel="alternate"' in m.group(0):
            continue
        offenders.add(m.group(1))
    for m in re.finditer(r'@import\s+[^;]*?(https?://[^\s\'")]+)', text):
        offenders.add(m.group(1))
    for m in re.finditer(r'url\(\s*[\'"]?(https?://[^\s\'")]+)', text):
        offenders.add(m.group(1))
    for m in re.finditer(r'fetch\(\s*[\'"](https?://[^\'"]+)', text):
        offenders.add(m.group(1))
    external = sorted(u for u in offenders if not u.startswith(allowed))
    if external:
        fail(name, 'self-contained', f'external resource(s) loaded: {", ".join(external)}')


def check_chrome(name, text, canonical_toggle):
    if 'class="page-container"' not in text:
        fail(name, 'page-container', 'content is not wrapped in <div class="page-container"> '
                                     '— this is where the page padding lives')

    nav = re.search(r'<nav class="breadcrumb">.*?</nav>', text, re.S)
    if not nav:
        fail(name, 'breadcrumb', 'no <nav class="breadcrumb"> block')
    else:
        expected = canonical_nav(breadcrumb_label(name))
        if nav.group(0).replace('\r\n', '\n') != expected:
            fail(name, 'breadcrumb', 'breadcrumb markup differs from the canonical block — '
                                     'run: python scripts/update_collection_chrome.py')

    toggle = re.search(r'<button class="theme-toggle".*?</button>', text, re.S)
    if not toggle:
        fail(name, 'theme-toggle', 'no theme-toggle button')
    elif toggle.group(0).replace('\r\n', '\n') != canonical_toggle:
        fail(name, 'theme-toggle', 'theme-toggle markup differs from index.html — scripts.js '
                                   'targets #theme-icon/#theme-label by id and calls '
                                   'window.toggleTheme(); a variant silently does nothing')


def check_css_vars(name, text):
    missing = house.undefined_vars(text)
    if missing:
        fail(name, 'css-vars-defined',
             f'undefined custom propert{"y" if len(missing) == 1 else "ies"} with no fallback: '
             f'{", ".join(missing)} — undefined vars fail silently (this is how Project 14 '
             f'shipped near-black text on a near-black background)')


# --- theme block duplication (ported from the retired check_theme_sync.py) --

def norm_val(v):
    """Collapse internal whitespace so 'rgba(1, 2, 3)' == 'rgba(1,2,3)'; real
    color drift still shows, trivial reformatting doesn't."""
    return re.sub(r'\s+', '', v.strip())


def parse_decls(block):
    out = {}
    for decl in block.split(';'):
        name, _, value = decl.partition(':')
        name = name.strip()
        if name.startswith('--'):
            out[name] = norm_val(value)
    return out


def aggregate(pattern, text):
    merged = {}
    for m in re.finditer(pattern, text, re.S):
        merged.update(parse_decls(m.group(1)))
    return merged


def check_theme_blocks(name, text):
    if '[data-theme="dark"]' not in text:
        return  # not part of the toggle system (e.g. project03/04 OS-only accents)

    dark_media = aggregate(
        r'@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}', text)
    dark_attr = aggregate(r'\[data-theme="dark"\]\s*\{([^}]*)\}', text)
    light_attr = aggregate(r'\[data-theme="light"\]\s*\{([^}]*)\}', text)
    text_no_media = re.sub(
        r'@media[^{]*\{\s*:root\s*\{[^}]*\}\s*\}', '', text, flags=re.S)
    light_root = aggregate(r':root\s*\{([^}]*)\}', text_no_media)

    for k in sorted(set(dark_media) | set(dark_attr)):
        if dark_media.get(k) != dark_attr.get(k):
            fail(name, 'theme-blocks', f'dark drift on {k}: @media={dark_media.get(k)!r} '
                                       f'vs [data-theme=dark]={dark_attr.get(k)!r}')
    for k, v in light_attr.items():
        if light_root.get(k) != v:
            fail(name, 'theme-blocks', f'light drift on {k}: :root={light_root.get(k)!r} '
                                       f'vs [data-theme=light]={v!r}')
    missing_light = set(dark_attr) - (set(light_attr) | set(light_root))
    if missing_light:
        fail(name, 'theme-blocks',
             f'dark-overridden vars with no light value: {sorted(missing_light)}')


# --- page against its catalogue record ------------------------------------

def check_properties(name, text, record):
    rows = property_rows(text)
    if rows is None:
        fail(name, 'properties', 'no .properties block')
        return

    # Rows must appear in the canonical order, and every required row must be
    # there. Method/Hash/Subject are optional — a piece carries them only if it
    # has them — but a row that is present has to be in the right place.
    labels = [label for label, _ in house.ROW_ORDER]
    got_labels = [label for label, _, _ in rows]
    unknown = [label for label in got_labels if label not in labels]
    if unknown:
        fail(name, 'properties', f'unrecognized property row(s) {unknown}; the museum uses '
                                 f'{labels}')
        return
    if got_labels != sorted(got_labels, key=labels.index):
        fail(name, 'properties', f'property rows are {got_labels}, which is out of order; '
                                 f'the canonical order is {labels}')
        return
    missing = [label for label in house.REQUIRED_ROWS if label not in got_labels]
    if missing:
        fail(name, 'properties', f'missing required property row(s) {missing}')
        return

    kind_of = dict(house.ROW_ORDER)
    label_of = {kind: label for label, kind in house.ROW_ORDER}
    by_kind = {kind_of[label]: row for label, row in zip(got_labels, rows)}

    def compare(kind, transform=lambda s: s):
        """Row text must equal the catalogue, unless the artwork fills it at load."""
        if kind not in by_kind or not record.get(kind):
            return
        _, value, _ = by_kind[kind]
        if house.is_runtime_placeholder(value):
            return
        shown = text_of(value)
        if transform(shown) != transform(str(record[kind]).strip()):
            fail(name, 'properties', f'{label_of[kind]} row reads {shown!r}, '
                                     f'projects.json says {record[kind]!r}')

    _, artist_value, _ = by_kind['artist']
    if not re.search(r'class="tag-artist-[a-z0-9-]+"', artist_value):
        fail(name, 'properties', 'Artist row has no <span class="tag-artist-…"> chip')
    else:
        compare('artist')
    compare('date', normalize_date)
    compare('subject')
    compare('method')

    if 'hash' in by_kind:
        _, hash_value, hash_attrs = by_kind['hash']
        if 'monospace' not in hash_attrs:
            fail(name, 'hash-row', 'Hash row is missing the monospace class')
        shown = text_of(hash_value)
        if not shown.startswith('0x'):
            fail(name, 'hash-row', f'Hash row reads {shown!r}, expected a 0x… digest')
        elif record.get('hash'):
            # Pages whose artwork computes its own digest ship a placeholder
            # (0xVERIFYING…, 0xEXCAVATING…) that JS replaces at load, so only a
            # genuinely hex-looking prefix is worth comparing.
            digest = record['hash'].lower().removeprefix('0x')
            prefix = re.match(r'0x([0-9a-fA-F]*)', shown)
            literal = prefix.group(1).lower() if prefix else ''
            if len(literal) >= 6 and not digest.startswith(literal):
                fail(name, 'hash-row', f'Hash row shows 0x{literal.upper()}…, but projects.json '
                                       f'pins 0x{digest[:len(literal)].upper()}…')

    check_medium_chips(name, by_kind['medium'][1], record)


def check_medium_chips(name, medium_value, record):
    chips = re.findall(r'<span class="tag tag-accent-([a-z]+)"[^>]*>(.*?)</span>', medium_value, re.S)
    expected = record['medium']
    if len(chips) != len(expected):
        fail(name, 'medium-chips',
             f'{len(chips)} medium chip(s), expected {len(expected)} — each entry in the '
             f'record\'s medium[] gets its own <span class="tag tag-accent-…">, not one '
             f'joined string')
        return
    for i, ((accent, label), want) in enumerate(zip(chips, expected)):
        if html.unescape(text_of(label)) != want:
            fail(name, 'medium-chips', f'chip {i + 1} reads {text_of(label)!r}, '
                                       f'projects.json says {want!r}')
        want_accent = TAG_ACCENTS[i % len(TAG_ACCENTS)]
        if accent != want_accent:
            fail(name, 'medium-chips', f'chip {i + 1} uses tag-accent-{accent}, expected '
                                       f'tag-accent-{want_accent} (accents cycle '
                                       f'{"/".join(TAG_ACCENTS)})')


def check_metadata(name, text, record):
    url = f'{BASE_URL}/collections/{name}'

    title = re.search(r'<title>(.*?)</title>', text, re.S)
    if not title:
        fail(name, 'title', 'no <title>')
    else:
        want = f'{html.escape(record["title"], quote=False)}{TITLE_SUFFIX}'
        if title.group(1).strip() != want:
            fail(name, 'title', f'<title> is {title.group(1).strip()!r}, expected {want!r}')

    canonical = re.search(r'<link rel="canonical" href="([^"]+)">', text)
    if not canonical or canonical.group(1) != url:
        fail(name, 'canonical', f'rel=canonical is '
                                f'{canonical.group(1) if canonical else "missing"!r}, expected {url!r}')
    og_url = re.search(r'<meta property="og:url" content="([^"]+)">', text)
    if not og_url or og_url.group(1) != url:
        fail(name, 'canonical', f'og:url is {og_url.group(1) if og_url else "missing"!r}, '
                                f'expected {url!r}')

    required = {
        'og:title': None, 'og:description': None, 'og:type': 'website',
        'og:site_name': SITE_NAME, 'og:image': f'{BASE_URL}/og-image.png',
        'og:image:width': '1200', 'og:image:height': '630', 'og:image:alt': None,
    }
    for prop, want in required.items():
        m = re.search(rf'<meta property="{re.escape(prop)}" content="([^"]*)">', text)
        if not m:
            fail(name, 'og-complete', f'missing <meta property="{prop}">')
        elif want is not None and m.group(1) != want:
            fail(name, 'og-complete', f'{prop} is {m.group(1)!r}, expected {want!r}')
    for prop, want in {'twitter:card': 'summary_large_image', 'twitter:title': None,
                       'twitter:description': None,
                       'twitter:image': f'{BASE_URL}/og-image.png'}.items():
        m = re.search(rf'<meta name="{re.escape(prop)}" content="([^"]*)">', text)
        if not m:
            fail(name, 'og-complete', f'missing <meta name="{prop}">')
        elif want is not None and m.group(1) != want:
            fail(name, 'og-complete', f'{prop} is {m.group(1)!r}, expected {want!r}')


def check_jsonld(name, text, record):
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
    parsed = []
    for i, block in enumerate(blocks):
        try:
            parsed.append(json.loads(block))
        except json.JSONDecodeError as exc:
            fail(name, 'jsonld', f'JSON-LD block {i + 1} is not valid JSON: {exc}')
    types = [p.get('@type') for p in parsed]
    if types != ['VisualArtwork', 'BreadcrumbList']:
        fail(name, 'jsonld', f'JSON-LD blocks are {types}, expected '
                             f"['VisualArtwork', 'BreadcrumbList'] — run: "
                             f'python scripts/update_collection_metadata.py')
        return

    art = parsed[0]
    if art.get('name') != record['title']:
        fail(name, 'jsonld', f'VisualArtwork name is {art.get("name")!r}, '
                             f'projects.json says {record["title"]!r}')
    if art.get('artMedium') != record['medium']:
        fail(name, 'jsonld', f'VisualArtwork artMedium is {art.get("artMedium")!r}, expected the '
                             f'record\'s medium array {record["medium"]!r} (an array, not a '
                             f'joined string)')
    if art.get('dateCreated') != normalize_date(record['date']):
        fail(name, 'jsonld', f'VisualArtwork dateCreated is {art.get("dateCreated")!r}, '
                             f'expected {normalize_date(record["date"])!r}')
    creator = art.get('creator') or {}
    if creator.get('@type') != 'Person' or creator.get('name') != record['artist']:
        fail(name, 'jsonld', f'VisualArtwork creator is {creator!r}, expected '
                             f'{{"@type": "Person", "name": {record["artist"]!r}}}')
    part = art.get('isPartOf') or {}
    if part.get('@id') != house.MUSEUM_ID:
        fail(name, 'jsonld', f'VisualArtwork isPartOf is {part!r}, expected the museum node '
                             f'{{"@type": "Museum", "@id": {house.MUSEUM_ID!r}, ...}} — this is '
                             f'what links the piece to the collection in structured data')


def check_description(name, text):
    if not extract_block(text, 'description'):
        fail(name, 'description', 'no <div class="description"> — the interpretation belongs '
                                  'there, not inside the artwork')


# --- frozen artworks ------------------------------------------------------

def check_frozen(name, text, record):
    """Re-verify every pinned digest. The checker only ever reads these bytes."""
    import hashlib
    pins = house.FROZEN_PINS.get(name, [])
    page_digests = set()
    for script_id, attr in pins:
        island = re.search(
            rf'<script[^>]*\bid="{re.escape(script_id)}"[^>]*>(.*?)</script>', text, re.S)
        if not island:
            fail(name, 'frozen', f'frozen script island #{script_id} is gone')
            continue
        computed = hashlib.sha256(island.group(1).strip().encode('utf-8')).hexdigest()
        pinned = re.search(rf'{re.escape(attr)}="(?:0x)?([0-9a-fA-F]{{64}})"', text)
        if not pinned:
            fail(name, 'frozen', f'#{script_id} has no pinned {attr} attribute')
        elif pinned.group(1).lower() != computed:
            fail(name, 'frozen', f'#{script_id} no longer matches its pinned {attr}: '
                                 f'computed {computed}, pinned {pinned.group(1).lower()} — the '
                                 f'artwork will report itself as altered. Restore the original '
                                 f'bytes; never re-pin to silence this.')
        else:
            page_digests.add(computed)

    digest = (record.get('hash') or '').lower().removeprefix('0x')
    if pins and len(digest) == 64:
        all_pinned = {m.lower() for m in re.findall(r'data-[a-z0-9-]*sha256="(?:0x)?([0-9a-fA-F]{64})"', text)}
        if digest not in all_pinned:
            fail(name, 'frozen', f'projects.json pins hash 0x{digest[:12]}… for this piece, but no '
                                 f'data-*-sha256 attribute on the page carries that digest')


# --- repo-level -----------------------------------------------------------

def check_generated_fresh():
    for script, check_id in (('generate_index.py', 'generated-fresh'),
                             ('generate_brief.py', 'brief-fresh')):
        path = ROOT / 'scripts' / script
        if not path.exists():
            continue
        result = subprocess.run([sys.executable, str(path), '--check'],
                                capture_output=True, text=True, cwd=str(ROOT))
        if result.returncode != 0:
            fail('repo', check_id, (result.stdout + result.stderr).strip())


def check_deploy_list():
    workflow = (ROOT / '.github' / 'workflows' / 'static.yml').read_text(encoding='utf-8')
    cp = re.search(r'^\s*cp ([^\n]*) _site/$', workflow, re.M)
    if not cp:
        fail('repo', 'deploy-list', 'could not find the cp allowlist in static.yml')
        return
    shipped = set(cp.group(1).split()) | {'collections'}

    ext = r'(?:js|css|png|txt|xml|json|html)'
    referenced = set()
    for path in [ROOT / 'index.html', ROOT / 'registry.html', ROOT / '404.html']:
        text = path.read_text(encoding='utf-8')
        for m in re.finditer(rf'(?:src|href)="/?([A-Za-z0-9._-]+\.{ext})"', text):
            referenced.add(m.group(1))
    for path in sorted(COLLECTIONS.glob('*.html')):
        text = path.read_text(encoding='utf-8')
        for m in re.finditer(rf'(?:src|href)="\.\./([A-Za-z0-9._-]+\.{ext})"', text):
            referenced.add(m.group(1))
        for m in re.finditer(r'fetch\(\s*[\'"](?:\.\./)?/?([A-Za-z0-9._-]+\.json)[\'"]', text):
            referenced.add(m.group(1))
    # The text surfaces point at each other by absolute URL, not by href — this
    # is how submit.txt is advertised from robots.txt and llms.txt, and it is
    # exactly the kind of reference that would otherwise 404 in production
    # without anything failing.
    for name in ('robots.txt', 'llms.txt', 'sitemap.xml'):
        path = ROOT / name
        if not path.exists():
            continue
        for m in re.finditer(rf'{re.escape(BASE_URL)}/([A-Za-z0-9._-]+\.{ext})', path.read_text(encoding='utf-8')):
            referenced.add(m.group(1))

    missing = sorted(f for f in referenced if f not in shipped and (ROOT / f).exists())
    if missing:
        fail('repo', 'deploy-list', f'referenced by the site but not in static.yml\'s cp list, '
                                    f'so they will silently 404 in production: {", ".join(missing)}')


# --- driver ---------------------------------------------------------------

def main():
    if '--list' in sys.argv:
        print('Check catalogue — python scripts/check_site.py\n')
        for check_id, description in CHECKS.items():
            print(f'  {check_id:<18} {description}')
        return 0

    records = {p['slug']: p for p in house.load_projects()}
    index_text = (ROOT / 'index.html').read_text(encoding='utf-8')
    canonical_toggle = re.search(r'<button class="theme-toggle".*?</button>',
                                 index_text, re.S).group(0)

    pages = sorted(COLLECTIONS.glob('*.html'))
    page_names = {p.name for p in pages}

    for slug in records:
        if slug not in page_names:
            fail('repo', 'registered', f'projects.json lists {slug} but collections/{slug} does not exist')
    for name in sorted(page_names):
        if name not in records:
            fail(name, 'registered', 'page has no record in projects.json — it will not appear '
                                     'in index.html, llms.txt or sitemap.xml')

    for path in pages:
        name = path.name
        text = path.read_text(encoding='utf-8')
        record = records.get(name)

        check_self_contained(name, text)
        if record:
            check_frozen(name, text, record)
        # Special exhibitions are shown in their own design language by design.
        if not record or record.get('exhibition') == 'special':
            continue

        check_head(name, text)
        check_chrome(name, text, canonical_toggle)
        check_css_vars(name, text)
        check_theme_blocks(name, text)
        check_properties(name, text, record)
        check_metadata(name, text, record)
        check_jsonld(name, text, record)
        check_description(name, text)

    check_theme_blocks('styles.css', (ROOT / 'styles.css').read_text(encoding='utf-8'))
    check_theme_blocks('registry.html', (ROOT / 'registry.html').read_text(encoding='utf-8'))
    check_generated_fresh()
    check_deploy_list()

    # Apply per-page waivers.
    waived = {p.name: waivers(p.read_text(encoding='utf-8')) for p in pages}
    kept = []
    for scope, check_id, message in problems:
        reason = waived.get(scope, {}).get(check_id)
        if reason is not None:
            deviations.append((scope, check_id, reason))
        else:
            kept.append((scope, check_id, message))

    for scope, check_id, reason in deviations:
        print(f'ACCEPTED DEVIATION  {scope} [{check_id}] — {reason or "(no reason given)"}')
        if not reason:
            kept.append((scope, check_id, 'waiver gives no reason; add one after an em dash'))
    if deviations:
        print()

    unknown = sorted({c for _, c, _ in problems} - set(CHECKS))
    if unknown:
        print(f'(internal: check ids missing from house.CHECKS: {unknown})\n')

    if kept:
        print('SITE CHECK FAILED:\n')
        for scope, check_id, message in kept:
            print(f'  {scope}')
            print(f'    [{check_id}] {message}\n')
        print(f'{len(kept)} problem(s). Run "python scripts/check_site.py --list" for the '
              f'full catalogue.')
        return 1

    print(f'Site check OK — {len(pages)} pages, {len(CHECKS)} checks, '
          f'{len(deviations)} accepted deviation(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
