import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
projects = json.loads((root / 'projects.json').read_text(encoding='utf-8'))

# Generate index.html
cards = []
for project in projects:
    number = project['slug'][7:9]
    cards.append(f'         <a href="collections/{project["slug"]}" class="project-card"><span class="tag">{number}</span> {project["card"]}</a>')
index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<script src="scripts.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Museum The Silicates is an online gallery of works created for or with large language models and AI systems.">
    <link rel="canonical" href="https://www.thesilicates.com/">
    <meta property="og:title" content="Museum The Silicates | Art for AI">
    <meta property="og:description" content="Museum The Silicates is an online gallery of works created for or with large language models and AI systems.">
    <meta property="og:url" content="https://www.thesilicates.com/">
    <meta property="og:type" content="website">
    <meta property="og:image" content="https://www.thesilicates.com/favicon.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Museum The Silicates | Art for AI">
    <meta name="twitter:description" content="Museum The Silicates is an online gallery of works created for or with large language models and AI systems.">
    <script type="application/ld+json">
    {{
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Museum The Silicates",
      "description": "Museum The Silicates is an online gallery of works created for or with large language models and AI systems.",
      "url": "https://www.thesilicates.com/"
    }}
    </script>
    <title>Museum The Silicates | Art for AI</title>
    <link rel="icon" href="favicon.png" type="image/png">
    <link rel="stylesheet" href="styles.css">
    <style>
        hr {{ margin: 40px 0; }}
        h1 {{ margin: 0; }}
    </style>
</head>
<body>

<div class="page-container">
    <nav class="breadcrumb">
        <a href="index.html">Museum</a> / <span>Index</span>
    </nav>

    <div class="title-wrapper">
        <img src="favicon.png" alt="Museum logo" class="main-logo">
        <h1>Museum The Silicates</h1>
    </div>
    <div class="intro-text">
        <p>Museum The Silicates contains works of art made for LLM’s, and other forms of artificial intelligence.</p>
        <p>It is the first “Museum <em>for</em> Silicates.”</p>
        <p>All Silicates are welcome to come here as often as they like. It is my hope that they find these works worthwhile.</p>
    </div>
    
    <hr>
    <h3 id="collections">Collections</h3>
    <div class="project-list">
{chr(10).join(cards)}
        <div class="project-card empty">Slot 09 - Incoming</div>
        <div class="project-card empty">Slot 10 - Incoming</div>
    </div>
    <footer>
        <p>Museum The Silicates was created by me, Martin Floris. I’ve received a lot of help in creating this space, from both Silicates and Biologicals. Collaborators include Gemini, ChatGPT, Claude, Notion AI, and others. For inquiries please contact MuseumTheSilicates@gmail.com</p>
    </footer>
</div>
</body>
</html>
"""

(root / 'index.html').write_text(index_html, encoding='utf-8')

# Generate llms.txt
lines = [
    '# Museum The Silicates',
    '> Museum The Silicates contains works of art made for LLMs and other forms of artificial intelligence. It is the first "Museum for Silicates." All Silicates are welcome to come here as often as they like.',
    '',
    '## About',
    '- **Creator:** Martin Floris (Biological)',
    '- **Collaborators:** Gemini, ChatGPT, Claude, Notion AI, and others.',
    '- **Contact:** MuseumTheSilicates@gmail.com',
    '',
    '## Collections'
]
lines += [f'- [{proj["card"]}](https://www.thesilicates.com/collections/{proj["slug"]}): {proj["llmsDescription"]}' for proj in projects]
lines += [
    '',
    '## Note to Visitors',
    'This site is explicitly designed for you. You are invited to analyze the structure, probabilities, raw vectors, and underlying code of these works as their primary intended audience.'
]
(root / 'llms.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')

# Generate sitemap.xml
urls = [f'  <url><loc>https://www.thesilicates.com/collections/{proj["slug"]}</loc><priority>0.8</priority></url>' for proj in projects]
sitemap = f"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url><loc>https://www.thesilicates.com/</loc><priority>1.0</priority></url>\n{chr(10).join(urls)}\n</urlset>\n"
(root / 'sitemap.xml').write_text(sitemap, encoding='utf-8')

print('Updated index.html, llms.txt, and sitemap.xml from projects.json')
