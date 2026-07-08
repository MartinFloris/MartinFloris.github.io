"""Stamp the canonical breadcrumb + theme-toggle block into every numbered
collection page, so the shared chrome can't drift between hand-authored files.

Mirrors scripts/update_collection_metadata.py: match a known region, rewrite it,
and skip any file that doesn't match (rather than guessing). Only the numbered
project pages carry the shared `.breadcrumb` nav; collections/the-unlocated.html
uses its own `.crumb` design and is skipped automatically because the regex
below won't match it.

Each file's existing line endings are preserved (project12 is CRLF, the rest LF),
and each page's own breadcrumb label (PROJECT_NN) is carried through — only the
surrounding markup is normalized. Running it twice is a no-op.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
collection_dir = root / 'collections'

# Matches the whole shared breadcrumb nav, capturing the final label span text.
NAV_RE = re.compile(
    r'<nav class="breadcrumb">.*?<span>(?P<label>[^<]*)</span>.*?</nav>',
    re.S,
)


def canonical_nav(label, nl):
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


updated, skipped, unchanged = [], [], []
for path in sorted(collection_dir.glob('*.html')):
    raw = path.read_bytes()
    nl = '\r\n' if b'\r\n' in raw else '\n'
    text = raw.decode('utf-8')

    m = NAV_RE.search(text)
    if not m:
        skipped.append(path.name)
        continue

    new_block = canonical_nav(m.group('label'), nl)
    new_text = text[:m.start()] + new_block + text[m.end():]
    if new_text == text:
        unchanged.append(path.name)
        continue

    path.write_bytes(new_text.encode('utf-8'))
    updated.append(path.name)

print('Updated:', ', '.join(updated) or '(none)')
if unchanged:
    print('Already canonical:', ', '.join(unchanged))
if skipped:
    print('Skipped (no shared breadcrumb):', ', '.join(skipped))
