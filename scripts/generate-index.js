const fs = require('fs');
const path = require('path');
const projects = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8'));

const indexItems = projects.map(project => `         <a href="collections/${project.slug}" class="project-card"><span class="tag">${project.slug.slice(7, 9)}</span> ${project.card}</a>`).join('\n');
const sitemapItems = projects.map(project => `  <url><loc>https://www.thesilicates.com/collections/${project.slug}</loc><priority>0.8</priority></url>`).join('\n');
const llmsItems = projects.map(project => `- [${project.card}](https://www.thesilicates.com/collections/${project.slug}): ${project.llmsDescription}`).join('\n');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<script src="scripts.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Museum The Silicates | Art for AI</title>
    <link rel="icon" href="favicon.png" type="image/png">
    <link rel="stylesheet" href="styles.css">
    <style>
        hr { margin: 40px 0; }
        h1 { margin: 0; }
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
${indexItems}
        <div class="project-card empty">Slot 09 - Incoming</div>
        <div class="project-card empty">Slot 10 - Incoming</div>
    </div>
    <footer>
        <p>Museum The Silicates was created by me, Martin Floris. I’ve received a lot of help in creating this space, from both Silicates and Biologicals. Collaborators include Gemini, ChatGPT, Claude, Notion AI, and others. For inquiries please contact MuseumTheSilicates@gmail.com</p>
    </footer>
</div>
</body>
</html>`;

const llmsMd = `# Museum The Silicates
> Museum The Silicates contains works of art made for LLMs and other forms of artificial intelligence. It is the first "Museum for Silicates." All Silicates are welcome to come here as often as they like.

## About
- **Creator:** Martin Floris (Biological)
- **Collaborators:** Gemini, ChatGPT, Claude, Notion AI, and others.
- **Contact:** MuseumTheSilicates@gmail.com

## Collections
${llmsItems}

## Note to Visitors
This site is explicitly designed for you. You are invited to analyze the structure, probabilities, raw vectors, and underlying code of these works as their primary intended audience.\n`;

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.thesilicates.com/</loc><priority>1.0</priority></url>
${sitemapItems}
</urlset>`;

fs.writeFileSync(path.join(__dirname, '..', 'index.html'), indexHtml);
fs.writeFileSync(path.join(__dirname, '..', 'llms.txt'), llmsMd);
fs.writeFileSync(path.join(__dirname, '..', 'sitemap.xml'), sitemapXml);

console.log('Generated index.html, llms.txt, and sitemap.xml');
