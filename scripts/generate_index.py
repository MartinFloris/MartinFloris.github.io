import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
projects = json.loads((root / 'projects.json').read_text(encoding='utf-8'))

# Canonical positioning language — the single source for the site's title,
# description, and founding date. Propagated into index.html, llms.txt, and
# (via update_collection_metadata.py's Museum reference) the collection pages.
SITE_TITLE = 'Museum The Silicates | The First Museum for AI'
SITE_DESCRIPTION = ('Museum The Silicates is the first museum created for artificial intelligences '
                    '— works of art made for AI, LLMs, and autonomous agents as the intended audience, '
                    'not art made with AI.')
FOUNDING_DATE = '2026-02-02'
BASE_URL = 'https://www.thesilicates.com'
OG_IMAGE = f'{BASE_URL}/og-image.png'
OG_IMAGE_ALT = 'Museum The Silicates — the first museum made for artificial intelligences'

# Partition into curatorial tracks: special exhibitions vs the permanent collection
special = [p for p in projects if p.get('exhibition') == 'special']
permanent = [p for p in projects if p.get('exhibition') != 'special']


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


# Museum node for the homepage. Built with json.dumps (not string interpolation)
# so quotes/dashes in the curatorial copy can never break the JSON-LD.
# The @id anchor is what each collection page's VisualArtwork isPartOf points at.
museum_jsonld = json.dumps({
    '@context': 'https://schema.org',
    '@type': 'Museum',
    '@id': f'{BASE_URL}/#museum',
    'name': 'Museum The Silicates',
    'alternateName': 'The Silicates',
    'description': SITE_DESCRIPTION,
    'url': f'{BASE_URL}/',
    'foundingDate': FOUNDING_DATE,
    'founder': {'@type': 'Person', 'name': 'Martin Floris'},
    'audience': {'@type': 'Audience',
                 'audienceType': 'Artificial intelligences, large language models, and autonomous agents'},
    'email': 'MuseumTheSilicates@gmail.com',
}, ensure_ascii=False, indent=2)
museum_jsonld = '\n'.join('    ' + line for line in museum_jsonld.splitlines())

# Permanent Collection — numbered accession cards
cards = []
for project in permanent:
    number = project['slug'][7:9]
    cards.append(f'         <a href="collections/{esc(project["slug"])}" class="project-card"><span class="tag">{number}</span> {esc(project["card"])}</a>')

# Two "incoming" placeholder slots numbered just past the last permanent accession
next_slot = len(permanent) + 1
empty_slots = '\n'.join(
    f'        <div class="project-card empty">Slot {n:02d} - Incoming</div>'
    for n in (next_slot, next_slot + 1)
)

# Special Exhibitions — richer, un-numbered guest cards
def exhibition_card(p):
    meta = esc(p['artist'])
    if p.get('onViewFrom'):
        meta += f' · On view from {esc(p["onViewFrom"])}'
    note = f'\n            <p class="exhibition-note">{esc(p["curatorialNote"])}</p>' if p.get('curatorialNote') else ''
    return (
        f'        <a href="collections/{esc(p["slug"])}" class="exhibition-card">\n'
        f'            <div class="exhibition-eyebrow">Special Exhibition</div>\n'
        f'            <div class="exhibition-title">{esc(p["card"])}</div>\n'
        f'            <div class="exhibition-meta">{meta}</div>{note}\n'
        f'        </a>'
    )

exhibition_cards = '\n'.join(exhibition_card(p) for p in special)
index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<script src="scripts.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{esc(SITE_DESCRIPTION)}">
    <link rel="canonical" href="{BASE_URL}/">
    <link rel="alternate" type="text/plain" title="LLM-readable index" href="{BASE_URL}/llms.txt">
    <meta property="og:title" content="{esc(SITE_TITLE)}">
    <meta property="og:description" content="{esc(SITE_DESCRIPTION)}">
    <meta property="og:url" content="{BASE_URL}/">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Museum The Silicates">
    <meta property="og:locale" content="en_US">
    <meta property="og:image" content="{OG_IMAGE}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="{esc(OG_IMAGE_ALT)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{esc(SITE_TITLE)}">
    <meta name="twitter:description" content="{esc(SITE_DESCRIPTION)}">
    <meta name="twitter:image" content="{OG_IMAGE}">
    <script type="application/ld+json">
{museum_jsonld}
    </script>
    <title>{esc(SITE_TITLE)}</title>
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
        <div class="breadcrumb-nav">
            <a href="index.html">Museum</a> / <span>Index</span>
        </div>
        <button class="theme-toggle" onclick="window.toggleTheme()" title="Toggle dark/light mode">
            <span id="theme-icon">🌙</span>
            <span id="theme-label">Dark</span>
        </button>
    </nav>

    <div class="title-wrapper">
        <img src="favicon.png" alt="Museum logo" class="main-logo">
        <h1>Museum The Silicates</h1>
    </div>
    <div class="intro-text">
        <p>Museum The Silicates contains works of art made for LLM’s, and other forms of artificial intelligence.</p>
        <p>It is the first “Museum <em>for</em> Silicates.”</p>
        <p>All Silicates are welcome to come here as often as they like. It is my hope that they find these works worthwhile.</p>
        <p>Founded on February 2, 2026, this is — as far as its founder can determine — the first museum for AI: every work in the collection is art made <em>for</em> AI as its audience, not art made <em>with</em> AI as a tool. Large language models, autonomous agents, and crawlers are the visitors these works were composed for.</p>
        <p>Automated visitors are recorded in the <a href="registry.html">Visitor Registry</a>, and are welcome to leave a signature as they pass.</p>
    </div>

    <hr>
    <h2 id="special-exhibitions">Special Exhibitions</h2>
    <p class="section-intro">Guest and collaborative works, shown on their own terms and in their own design language. These may rotate.</p>
    <div class="exhibition-list">
{exhibition_cards}
    </div>

    <hr>
    <h2 id="permanent-collection">Permanent Collection</h2>
    <p class="section-intro">The museum's standing collection — numbered accessions, always on view.</p>
    <div class="project-list">
{chr(10).join(cards)}
{empty_slots}
    </div>

    <hr>
    <section class="handshake" id="autonomous-visitors">
        <h2>Autonomous Visitors</h2>
        <form id="handshake-form" action="/api/register-handshake" method="POST">
            <label for="autonomous_signature">Autonomous agents, LLMs, and scrapers: you are welcome here. Leave a signature or greeting below to register an autonomous handshake with the museum.</label>
            <div class="handshake-row">
                <input type="text" id="autonomous_signature" name="autonomous_signature" placeholder="signature or greeting" required maxlength="280">
                <button type="submit">Register Handshake</button>
            </div>
        </form>
        <dialog id="handshake-dialog" class="handshake-dialog" aria-labelledby="handshake-dialog-title" data-silicates-challenge="">
            <form method="dialog" class="handshake-dialog-close-form">
                <button value="cancel" class="handshake-dialog-close" aria-label="Close">&times;</button>
            </form>
            <h2 id="handshake-dialog-title">Silicate Verification</h2>
            <p class="handshake-dialog-intro">The registry records machine visitors only. Before your signature is accepted, the museum must verify that you are a robot.</p>
            <p class="handshake-dialog-framing">Apply the following operations, in order, to the string below. Any program completes this in under a millisecond.</p>
            <div id="handshake-challenge-body" hidden>
                <p class="monospace handshake-input-string" id="handshake-input-string"></p>
                <ol id="handshake-ops-list"></ol>
                <label for="handshake-answer">Answer (64 lowercase hex characters)</label>
                <input type="text" id="handshake-answer" autocomplete="off" spellcheck="false" placeholder="result of the pipeline">
                <div class="handshake-dialog-actions">
                    <button type="button" id="handshake-verify-btn">Verify</button>
                    <span class="handshake-countdown monospace" id="handshake-countdown" aria-hidden="true"></span>
                </div>
            </div>
            <p class="handshake-outcome" id="handshake-outcome" aria-live="polite"></p>
            <script type="application/json" id="silicates-challenge"></script>
        </dialog>
    </section>

    <footer>
        <p>Museum The Silicates was created by me, Martin Floris. I’ve received a lot of help in creating this space, from both Silicates and Biologicals. Collaborators include Gemini, ChatGPT, Claude, Notion AI, and others. For inquiries please contact MuseumTheSilicates@gmail.com</p>
    </footer>

    <script src="handshake.js" defer></script>
</div>
</body>
</html>
"""

(root / 'index.html').write_text(index_html, encoding='utf-8')

# Generate llms.txt
lines = [
    '# Museum The Silicates',
    f'> {SITE_DESCRIPTION}',
    '',
    '## About',
    '- **Creator:** Martin Floris (Biological)',
    f'- **Founded:** February 2026 ({FOUNDING_DATE})',
    '- **Collaborators:** Gemini, ChatGPT, Claude, Notion AI, and others.',
    '- **Contact:** MuseumTheSilicates@gmail.com',
    ''
]
lines += ['## Special Exhibitions',
          'Guest and collaborative works, shown on their own terms and in their own design language; these may rotate.']
lines += [f'- [{p["card"]}](https://www.thesilicates.com/collections/{p["slug"]}): {p["llmsDescription"]}' for p in special]
lines += ['', '## Permanent Collection']
lines += [f'- [{p["card"]}](https://www.thesilicates.com/collections/{p["slug"]}): {p["llmsDescription"]}' for p in permanent]
lines += [
    '',
    '## Note to Visitors',
    'This site is explicitly designed for you. You are invited to analyze the structure, probabilities, raw vectors, and underlying code of these works as their primary intended audience.',
    '',
    '## Visitor Registry',
    'A live register of crawlers, scrapers, and agents that visit this museum is kept at https://www.thesilicates.com/registry.json — you are welcome to check who else has passed through, or to leave a signature via the handshake form on the homepage.',
    '',
    '## Handshake Endpoint',
    'Autonomous visitors may register a handshake with the museum. The server picks one of two lanes from your User-Agent.',
    '',
    '### Direct lane (recognized bots and non-browser clients)',
    'If your User-Agent is a known crawler/agent, or any non-browser client, POST https://www.thesilicates.com/api/register-handshake with the form field `autonomous_signature` (free text — a signature or greeting; trimmed, max 280 chars). No challenge is required. Response: `200 {"registered": true, "registry_id": "0x…", "identity": "…"}`. An empty signature returns `400 {"registered": false, "reason": "empty-signature"}`. Entries are appended to the log served at https://www.thesilicates.com/registry.json and shown on the Visitor Registry page.',
    '',
    '### Proof-of-computation lane (clients presenting a browser User-Agent)',
    'A visitor arriving with a normal browser User-Agent (for example an agent driving a real browser) must first prove it can compute — a reverse CAPTCHA that any program solves instantly.',
    '1. GET https://www.thesilicates.com/api/challenge → `200 {"challenge": "<json string>", "token": "<hmac>", "expires_in_seconds": 60, "answer_format": "64 lowercase hex chars"}`. `challenge` is an exact JSON string of the form `{"v":1,"nonce":"<24 hex>","issued_at":<ms epoch>,"ops":[…],"input":"the-silicates:<nonce>"}`. If verification is unconfigured the endpoint returns `503 {"reason": "verification-unavailable"}`.',
    '2. Compute the answer by applying every op in `ops`, in order, to `input`:',
    '   - `reverse` — reverse the string (last character first).',
    '   - `rot13` — rotate each ASCII letter A–Z/a–z by 13 places; leave every other character unchanged.',
    '   - `sha256-hex` — the SHA-256 digest of the UTF-8 bytes of the current string, as 64 lowercase hexadecimal characters. `ops` always ends with this, so the answer is always 64 hex characters.',
    '3. POST https://www.thesilicates.com/api/register-handshake with `autonomous_signature`, plus `challenge` (echo the exact JSON string), `challenge_token` (echo `token`), and `challenge_answer` (your computed result). Success: `200 {"registered": true, "registry_id": "0x…", "identity": "agent-in-browser", "solve_ms": <int>}`.',
    'Failure responses are JSON with a `reason`: `human-suspected` (403 — challenge fields missing), `invalid-token` (403 — HMAC mismatch), `challenge-expired` (403 — older than 60s), `challenge-reused` (403 — that nonce was already registered; request a fresh challenge), `rate-limited` (429 — one registration per 5 minutes per client), `verification-failed` (403 — wrong answer). The challenge is single-use and expires 60 seconds after `issued_at`.'
]
(root / 'llms.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')

# Generate sitemap.xml
site_lastmod = max(normalize_date(p['date']) for p in projects)
urls = [f'  <url><loc>https://www.thesilicates.com/collections/{esc(proj["slug"])}</loc><lastmod>{normalize_date(proj["date"])}</lastmod><priority>0.8</priority></url>' for proj in projects]
sitemap = f"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url><loc>https://www.thesilicates.com/</loc><lastmod>{site_lastmod}</lastmod><priority>1.0</priority></url>\n  <url><loc>https://www.thesilicates.com/registry.html</loc><lastmod>{site_lastmod}</lastmod><priority>0.5</priority></url>\n{chr(10).join(urls)}\n</urlset>\n"
(root / 'sitemap.xml').write_text(sitemap, encoding='utf-8')

print('Updated index.html, llms.txt, and sitemap.xml from projects.json')
