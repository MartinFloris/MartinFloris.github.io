# Copilot Instructions for Museum The Silicates

## Project Overview
**Museum The Silicates** is a static HTML portfolio website presenting AI-generated art and conceptual pieces. It's deployed via GitHub Pages with no build process—the repository root is the live content.

**Purpose**: Showcase 8+ art projects created by or with AI collaborators (Claude, Gemini, ChatGPT, etc.), explicitly designed for LLM audiences.

## Architecture & Key Files

### Root Level Structure
- **`index.html`**: Gallery landing page linking all projects via grid of project cards
- **`styles.css`**: Global stylesheet using CSS variables (Notion-inspired design system)
- **`collections/`**: Individual project pages; directory for project assets
- **Tracking**: `robots.txt` (explicitly allows AI bots), `llms.txt` (machine-readable index), `sitemap.xml`
- **Deployment**: `.github/workflows/static.yml` auto-deploys to GitHub Pages on push to `main`

### No Build Process
- Pure HTML, CSS, static assets
- Direct commit → deploy workflow
- Any edits are live (be careful)

## Project Page Template

Every project in `collections/` follows this structure:

```html
<!-- Required: at top of <head> -->
<script src="../scripts.js"></script>
<!-- Rest of head: charset, viewport, styles.css link, favicon, custom <style> -->
<!-- Breadcrumb: Museum / The Silicates / PROJECT_XX -->
<!-- Title: <h1> -->
<!-- Metadata: .properties with .property-row divs -->
<!-- Content: .content-area or .canvas for visual work -->
```

**Key conventions**:
- Relative paths always use `../` to escape `collections/` folder
- Link to `../styles.css` for shared styles
- Link to `../index.html` for home
- GA4 tracking (ID `G-YRZ8FJJ8YZ`) is injected at runtime by `scripts.js` itself — no page should have its own static `gtag.js`/`googletagmanager.com` script tag; `<script src="../scripts.js">` is the only script reference a page needs
- Project numbering: projectXX where XX is zero-padded (01, 02, ..., 08)

## Styling System

### CSS Variables (defined in `:root`)
```css
--notion-font: system fonts matching Notion
--text-main: #37352f (dark text)
--text-subtle: rgba(55, 53, 47, 0.65) (muted text)
--border-color: rgba(55, 53, 47, 0.16)
--accent-bg: #f7f6f3 (light background)
--compute-low, --compute-high: per-project animation colors
```

### Reusable Classes (from `styles.css`)
- `.page-container`: 900px max width, centered
- `.breadcrumb`, `.project-list`, `.project-card`: navigation & gallery
- `.properties`, `.property-row`, `.property-label`, `.property-value`: metadata display
- `.tag`: inline badges (gray background, monospace fonts for codes/hashes)
- `.content-area`: italicized, bordered content blocks
- `.canvas`: responsive aspect-ratio containers for SVG/visual work

**Per-project custom styling**: Use `<style>` tags in head for project-specific overrides and animations (see project03 for SVG path animations).

## Add New Projects

1. **Create `collections/projectXX-[name].html`** using the template above
2. **Update `index.html`**: Add link in `.project-list` div:
   ```html
   <a href="collections/projectXX-[name].html" class="project-card">
     <span class="tag">XX</span> Project Title
   </a>
   ```
3. **Update `llms.txt`**: Add entry in Collections section with description
4. **Properties to include**: Artist, Date of Creation, Hash (if applicable), Method, Medium, and any custom fields
5. **Test relative paths**: All links should use `../` to parent directory

## Design Patterns

### Metadata Display
Use `.properties` structure for consistent key-value rendering:
```html
<div class="properties">
  <div class="property-row">
    <div class="property-label">Artist</div>
    <div class="property-value"><span class="tag">Name (Type)</span></div>
  </div>
  ...
</div>
```

### Responsive Grids
- Project cards: `grid-template-columns: repeat(auto-fill, minmax(250px, 1fr))`
- Project list uses CSS Grid with gap spacing; no JavaScript required

### Animations
SVG paths can animate via CSS (see project03):
- Use `animation`, `stroke-dasharray`, `stroke-dashoffset` for flowing effects
- Media queries for high-res vs low-res data display

## Important Considerations

1. **No Preprocessing**: Changes to CSS require direct updates; no SASS/PostCSS pipeline
2. **`scripts.js` Must Be Present**: Every HTML file needs `<script src="scripts.js">` (or `../scripts.js` from `collections/`) — it's what wires up both the theme toggle and GA4 tracking
3. **Accessibility**: Semantic HTML (breadcrumbs, proper heading hierarchy) but no ARIA enhancements currently used
4. **AI-Focused**: robots.txt explicitly invites GPTBot and ClaudeBot; site is designed for LLM consumption
5. **Index/Registry Maintenance**: `index.html`, `llms.txt`, and `sitemap.xml` are generated from `projects.json` via `python scripts/generate_index.py` — edit `projects.json`, not those files directly. `scripts/update_collection_metadata.py` backfills OG/Twitter/JSON-LD meta into `collections/*.html` from each page's existing `<title>`/description.

## Troubleshooting

- **Broken image/style links**: Check relative paths; `./` for same dir, `../` to escape `collections/`
- **Styling not applied**: Check specificity; `.tag` and custom inline styles override global rules
- **GA4 not tracking**: Ensure `<script src="scripts.js">` is present and loading; GA4 (`G-YRZ8FJJ8YZ`) is injected by that script at runtime, not a static tag in the page
- **Project not showing**: Verify it's listed in `projects.json` and rerun `scripts/generate_index.py`; check the card link landed in `index.html`
