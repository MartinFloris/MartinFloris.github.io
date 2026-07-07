"""Guard against theme drift.

The site themes itself twice over: a `@media (prefers-color-scheme: dark)` block
(the no-JS fallback) and a `[data-theme="dark"]` block (what scripts.js toggles).
The same duplication exists for light (`:root` defaults vs `[data-theme="light"]`).
Every color therefore lives in two places and must be kept identical by hand.

This script fails (exit 1) if those pairs ever disagree, in styles.css or in any
page that carries its own 4-block theme set (registry.html, projects 09-12). It
also checks that the museum-credit footer paragraph and the theme-toggle button
markup stay identical across the pages that share them. It changes nothing.

Run: python scripts/check_theme_sync.py
"""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent

problems = []


def norm_val(v):
    """Collapse internal whitespace so 'rgba(1, 2, 3)' == 'rgba(1,2,3)'; real
    color drift still shows, trivial reformatting doesn't."""
    return re.sub(r'\s+', '', v.strip())


def parse_decls(block):
    """--name: value; pairs from a declaration block -> {name: normalized value}."""
    out = {}
    for decl in block.split(';'):
        if ':' not in decl:
            continue
        name, _, value = decl.partition(':')
        name = name.strip()
        if name.startswith('--'):
            out[name] = norm_val(value)
    return out


def aggregate(pattern, text):
    """Union the declarations of every block whose selector matches `pattern`."""
    merged = {}
    for m in re.finditer(pattern, text, re.S):
        merged.update(parse_decls(m.group(1)))
    return merged


def check_theme_file(path):
    text = path.read_text(encoding='utf-8')
    if '[data-theme="dark"]' not in text:
        return  # not part of the toggle system (e.g. project03/04 OS-only accents)

    # dark via media query: @media (prefers-color-scheme: dark){ :root { ... } }
    dark_media = aggregate(
        r'@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}', text)
    dark_attr = aggregate(r'\[data-theme="dark"\]\s*\{([^}]*)\}', text)
    light_attr = aggregate(r'\[data-theme="light"\]\s*\{([^}]*)\}', text)

    # :root defaults, excluding the ones nested inside @media blocks.
    text_no_media = re.sub(
        r'@media[^{]*\{\s*:root\s*\{[^}]*\}\s*\}', '', text, flags=re.S)
    light_root = aggregate(r':root\s*\{([^}]*)\}', text_no_media)

    name = path.name

    # 1. The two dark sources must be identical.
    if dark_media != dark_attr:
        for k in sorted(set(dark_media) | set(dark_attr)):
            if dark_media.get(k) != dark_attr.get(k):
                problems.append(
                    f'{name}: dark drift on {k}: @media={dark_media.get(k)!r} '
                    f'vs [data-theme=dark]={dark_attr.get(k)!r}')

    # 2. Each themed light var must match its :root default.
    for k, v in light_attr.items():
        if light_root.get(k) != v:
            problems.append(
                f'{name}: light drift on {k}: :root={light_root.get(k)!r} '
                f'vs [data-theme=light]={v!r}')

    # 3. Every dark-overridden var must have a light value somewhere — either a
    #    [data-theme="light"] override or a :root default. (A var overridden only
    #    in dark, with no light source at all, would be stuck dark forever.)
    light_sources = set(light_attr) | set(light_root)
    missing_light = set(dark_attr) - light_sources
    if missing_light:
        problems.append(f'{name}: dark-overridden vars with no light value: {sorted(missing_light)}')


def footer_credit(path):
    text = path.read_text(encoding='utf-8')
    fm = re.search(r'<footer>(.*?)</footer>', text, re.S)
    if not fm:
        return None
    pm = re.search(r'<p>(.*?)</p>', fm.group(1), re.S)
    return pm.group(1).strip() if pm else None


def toggle_markup(text):
    m = re.search(r'<button class="theme-toggle".*?</button>', text, re.S)
    return re.sub(r'\r\n', '\n', m.group(0)) if m else None


# --- theme-block drift across every file that carries the 4-block pattern ---
theme_files = [root / 'styles.css', root / 'registry.html']
theme_files += sorted((root / 'collections').glob('project*.html'))
for p in theme_files:
    check_theme_file(p)

# --- footer credit paragraph must match between index and registry ---
idx_footer = footer_credit(root / 'index.html')
reg_footer = footer_credit(root / 'registry.html')
if idx_footer is None or reg_footer is None:
    problems.append('footer: could not find credit paragraph in index.html or registry.html')
elif idx_footer != reg_footer:
    problems.append('footer: credit paragraph differs between index.html and registry.html')

# --- theme-toggle button markup identical across all pages that have it ---
toggle_pages = [root / 'index.html', root / 'registry.html']
toggle_pages += sorted((root / 'collections').glob('project*.html'))
canonical = toggle_markup((root / 'index.html').read_text(encoding='utf-8'))
for p in toggle_pages:
    mk = toggle_markup(p.read_text(encoding='utf-8'))
    if mk != canonical:
        problems.append(f'theme-toggle: {p.name} markup differs from index.html')

if problems:
    print('THEME SYNC FAILED:\n')
    for pr in problems:
        print('  -', pr)
    sys.exit(1)

print('Theme sync OK: dark/light blocks, footer credit, and theme-toggle markup all consistent.')
