"""Patch SEO/social metadata into every collections/*.html page.

Re-runnable: handles both fresh pages (description meta directly before
<title>, nothing patched yet) and already-patched pages (the managed block
between the description meta and <title> is fully rebuilt each run).

Hand-tuned copy is preserved verbatim: any existing og:title, og:description,
twitter:title, or twitter:description is captured and re-emitted unchanged
(og and twitter are captured independently — some pages tune them differently).
Fallbacks from <title>/description are used only when a tag is absent.

Pages whose JSON-LD is already hand-authored as something richer than the
generated WebPage node (e.g. the-unlocated.html's VisualArtwork) take a
light-touch path: only the missing tags are inserted, the JSON-LD and the
rest of the head are left untouched.

Never touches anything outside <head> — in particular the frozen attestation
scripts in project11-successor-function.html's body stay byte-identical.
"""
import html
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
collection_dir = root / 'collections'

BASE_URL = 'https://www.thesilicates.com'
SITE_NAME = 'Museum The Silicates'
TITLE_SUFFIX = ' | Museum The Silicates'
OG_IMAGE = f'{BASE_URL}/og-image.png'
LLMS_LINK_HREF = f'{BASE_URL}/llms.txt'
MUSEUM_ID = f'{BASE_URL}/#museum'

projects = {p['slug']: p for p in json.loads((root / 'projects.json').read_text(encoding='utf-8'))}


def esc(s):
    # Escapes &, <, > and " so values are safe in double-quoted attributes.
    return (str(s).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def normalize_date(d):
    # projects.json dates are mixed-format ('2026-2-2' vs '2026-07-05').
    year, month, day = str(d).split('-')
    return f'{int(year):04d}-{int(month):02d}-{int(day):02d}'


def ld_script(obj):
    # JSON-LD via json.dumps so quotes/dashes in curatorial copy can't break it.
    body = json.dumps(obj, ensure_ascii=False, indent=2)
    body = '\n'.join('    ' + line for line in body.splitlines())
    return f'    <script type="application/ld+json">\n{body}\n    </script>\n'


def grab(pattern, text):
    m = re.search(pattern, text)
    return m.group(1) if m else None


def rebuild_page(text, slug, desc_match, title_match):
    """Full rebuild of the managed block between the description meta and <title>."""
    description = desc_match.group(1).strip()
    head_block = text[desc_match.end():title_match.start()]
    title_text = title_match.group(1).strip()
    artwork = title_text[:-len(TITLE_SUFFIX)] if title_text.endswith(TITLE_SUFFIX) else title_text
    url = f'{BASE_URL}/collections/{slug}'

    # Preserve hand-tuned social copy verbatim; og and twitter independently.
    og_title = grab(r'<meta property="og:title" content="(.*?)">', head_block) or artwork
    og_desc = grab(r'<meta property="og:description" content="(.*?)">', head_block) or description
    tw_title = grab(r'<meta name="twitter:title" content="(.*?)">', head_block) or og_title
    tw_desc = grab(r'<meta name="twitter:description" content="(.*?)">', head_block) or og_desc

    record = projects.get(slug)
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
        # No catalogue record (none currently) — keep a plain WebPage node.
        scripts = ld_script({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            'name': html.unescape(artwork),
            'description': html.unescape(description),
            'url': url,
        })

    image_alt = f'{html.unescape(artwork)} — {SITE_NAME}'
    block = (
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
    return text[:desc_match.end()] + '\n' + block + text[title_match.end():]


def light_touch_page(text, slug, title_match):
    """Insert only the missing tags; leave hand-authored JSON-LD and layout alone."""
    title_text = title_match.group(1).strip()
    if not title_text.endswith(TITLE_SUFFIX):
        text = text[:title_match.start()] + f'<title>{title_text}{TITLE_SUFFIX}</title>' + text[title_match.end():]

    def insert_after(anchor_pattern, new_line, absent_pattern):
        # Adds new_line directly under the anchor line, reusing its indentation.
        nonlocal text
        if re.search(absent_pattern, text):
            return
        m = re.search(anchor_pattern, text)
        if not m:
            return
        indent = re.match(r'[ \t]*', text[text.rfind('\n', 0, m.start()) + 1:m.start()]).group(0)
        indented = '\n'.join(indent + line for line in new_line.splitlines())
        text = text[:m.end()] + '\n' + indented + text[m.end():]

    insert_after(r'<link rel="canonical"[^>]*>',
                 f'<link rel="alternate" type="text/plain" title="LLM-readable index" href="{LLMS_LINK_HREF}">',
                 r'<link rel="alternate" type="text/plain"')
    insert_after(r'<meta property="og:type"[^>]*>',
                 f'<meta property="og:site_name" content="{SITE_NAME}">',
                 r'<meta property="og:site_name"')
    text = re.sub(r'(<meta property="og:image" content=")[^"]*(">)',
                  rf'\g<1>{OG_IMAGE}\g<2>', text, count=1)
    og_title = grab(r'<meta property="og:title" content="(.*?)">', text) or title_text
    image_alt = f'{html.unescape(og_title)} — {SITE_NAME}'
    insert_after(r'<meta property="og:image" content="[^"]*">',
                 f'<meta property="og:image:width" content="1200">\n'
                 f'<meta property="og:image:height" content="630">\n'
                 f'<meta property="og:image:alt" content="{esc(image_alt)}">',
                 r'<meta property="og:image:width"')
    insert_after(r'<meta name="twitter:description"[^>]*>',
                 f'<meta name="twitter:image" content="{OG_IMAGE}">',
                 r'<meta name="twitter:image"')
    return text


updated = []
skipped = []
for path in sorted(collection_dir.glob('*.html')):
    text = path.read_text(encoding='utf-8')
    title_match = re.search(r'<title>(.*?)</title>', text, re.S)
    desc_match = re.search(r'<meta name="description" content="(.*?)">', text, re.S)
    if not title_match or not desc_match:
        skipped.append(path.name)
        continue

    standard_shape = desc_match.end() <= title_match.start()
    head_block = text[desc_match.end():title_match.start()] if standard_shape else ''
    hand_authored_ld = ('<script type="application/ld+json"' in head_block
                        and '"@type": "WebPage"' not in head_block) or not standard_shape

    if hand_authored_ld:
        new_text = light_touch_page(text, path.name, title_match)
    else:
        new_text = rebuild_page(text, path.name, desc_match, title_match)

    if new_text != text:
        path.write_text(new_text, encoding='utf-8')
        updated.append(path.name)

print('Updated:', ', '.join(updated) if updated else '(none — all pages already current)')
if skipped:
    print('Skipped:', ', '.join(skipped))
