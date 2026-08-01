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

The shape of the managed block is defined once in house.head_block(); this
script only decides where to put it, and check_site.py validates against the
same function.
"""
import html
import re

from house import (COLLECTIONS, LLMS_LINK_HREF, OG_IMAGE, SITE_NAME, TITLE_SUFFIX,
                   esc, head_block, projects_by_slug)

projects = projects_by_slug()


def grab(pattern, text):
    m = re.search(pattern, text)
    return m.group(1) if m else None


def rebuild_page(text, slug, desc_match, title_match):
    """Full rebuild of the managed block between the description meta and <title>."""
    description = desc_match.group(1).strip()
    existing = text[desc_match.end():title_match.start()]
    title_text = title_match.group(1).strip()
    artwork = title_text[:-len(TITLE_SUFFIX)] if title_text.endswith(TITLE_SUFFIX) else title_text

    # Preserve hand-tuned social copy verbatim; og and twitter independently.
    block = head_block(
        slug, artwork, description, projects.get(slug),
        og_title=grab(r'<meta property="og:title" content="(.*?)">', existing),
        og_desc=grab(r'<meta property="og:description" content="(.*?)">', existing),
        tw_title=grab(r'<meta name="twitter:title" content="(.*?)">', existing),
        tw_desc=grab(r'<meta name="twitter:description" content="(.*?)">', existing),
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
for path in sorted(COLLECTIONS.glob('*.html')):
    text = path.read_text(encoding='utf-8')
    title_match = re.search(r'<title>(.*?)</title>', text, re.S)
    desc_match = re.search(r'<meta name="description" content="(.*?)">', text, re.S)
    if not title_match or not desc_match:
        skipped.append(path.name)
        continue

    standard_shape = desc_match.end() <= title_match.start()
    managed = text[desc_match.end():title_match.start()] if standard_shape else ''
    hand_authored_ld = ('<script type="application/ld+json"' in managed
                        and '"@type": "WebPage"' not in managed) or not standard_shape

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
