from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
collection_dir = root / 'collections'
files = sorted(collection_dir.glob('*.html'))
updated = []
skipped = []
for path in files:
    text = path.read_text(encoding='utf-8')
    title_match = re.search(r'<title>(.*?)</title>', text, re.S)
    desc_match = re.search(r'(<meta name="description" content="(.*?)">)(\s*)(<title>)', text, re.S)
    if not title_match or not desc_match:
        skipped.append(path.name)
        continue
    title = title_match.group(1).strip()
    description = desc_match.group(2).strip()
    slug = path.name
    metadata = (
        f'{desc_match.group(1)}{desc_match.group(3)}'
        f'    <link rel="canonical" href="https://www.thesilicates.com/collections/{slug}">\n'
        f'    <meta property="og:title" content="{title}">\n'
        f'    <meta property="og:description" content="{description}">\n'
        f'    <meta property="og:url" content="https://www.thesilicates.com/collections/{slug}">\n'
        f'    <meta property="og:type" content="website">\n'
        f'    <meta property="og:image" content="https://www.thesilicates.com/favicon.png">\n'
        f'    <meta name="twitter:card" content="summary_large_image">\n'
        f'    <meta name="twitter:title" content="{title}">\n'
        f'    <meta name="twitter:description" content="{description}">\n'
        '    <script type="application/ld+json">\n'
        '    {\n'
        f'      "@context": "https://schema.org",\n'
        f'      "@type": "WebPage",\n'
        f'      "name": "{title}",\n'
        f'      "description": "{description}",\n'
        f'      "url": "https://www.thesilicates.com/collections/{slug}"\n'
        '    }\n'
        '    </script>\n'
        '    <title>'
    )
    new_text = text[:desc_match.start()] + metadata + text[desc_match.end():]
    path.write_text(new_text, encoding='utf-8')
    updated.append(path.name)

print('Updated:', ', '.join(updated))
if skipped:
    print('Skipped:', ', '.join(skipped))
