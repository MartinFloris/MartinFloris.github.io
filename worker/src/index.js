const KNOWN_BOTS = [
  [/GPTBot/i, 'gptbot'],
  [/OAI-SearchBot/i, 'oai-searchbot'],
  [/ChatGPT-User/i, 'chatgpt-user'],
  [/ClaudeBot|Claude-Web|anthropic-ai/i, 'claudebot'],
  [/Claude-SearchBot/i, 'claude-searchbot'],
  [/Claude-User/i, 'claude-user'],
  [/Googlebot/i, 'googlebot'],
  [/Google-CloudVertexBot/i, 'google-cloudvertexbot'],
  [/bingbot/i, 'bingbot'],
  [/PerplexityBot/i, 'perplexitybot'],
  [/Perplexity-User/i, 'perplexity-user'],
  [/CCBot/i, 'ccbot'],
  [/Applebot/i, 'applebot'],
  [/DuckDuckBot/i, 'duckduckbot'],
  [/DuckAssistBot/i, 'duckassistbot'],
  [/YandexBot/i, 'yandexbot'],
  [/facebookexternalhit/i, 'facebook-link-preview'],
  [/FacebookBot/i, 'facebookbot'],
  [/Meta-ExternalAgent/i, 'meta-externalagent'],
  [/Meta-ExternalFetcher/i, 'meta-externalfetcher'],
  [/AhrefsBot/i, 'ahrefsbot'],
  [/SemrushBot/i, 'semrushbot'],
  [/Baiduspider/i, 'baidu'],
  [/Amazonbot/i, 'amazonbot'],
  [/Anchor[ -]?Browser/i, 'anchor-browser'],
  [/archive\.org_bot|ia_archiver/i, 'archiveorgbot'],
  [/Arquivo/i, 'arquivo-web-crawler'],
  [/Bytespider/i, 'bytespider'],
  [/TikTok[ -]?Spider/i, 'tiktok-spider'],
  [/PetalBot/i, 'petalbot'],
  [/MistralAI-User/i, 'mistralai-user'],
  [/Manus[ -]?Bot/i, 'manus-bot'],
  // Lower-confidence patterns for smaller/newer bots not yet widely documented —
  // matched on their Cloudflare-displayed name; may need refining if an actual
  // visit lands as 'unknown-agent' with a recognizable UA substring we missed.
  [/Cloudflare[ -]?(AI[ -]?)?Crawler|Cloudflare-AutoRAG/i, 'cloudflare-crawler'],
  [/Novellum/i, 'novellum-ai-crawl'],
  [/ProRata/i, 'prorata'],
  [/Terracotta/i, 'terracotta-bot'],
  [/Timpibot/i, 'timpibot'],
];

// Expected network operator for each known bot identity, matched against
// Cloudflare's real ASN lookup (request.cf.asOrganization) — this can't be
// spoofed via a User-Agent header, unlike identity classification above.
const EXPECTED_ORG_PATTERNS = {
  gptbot: /openai/i,
  'oai-searchbot': /openai/i,
  'chatgpt-user': /openai/i,
  claudebot: /anthropic/i,
  'claude-searchbot': /anthropic/i,
  'claude-user': /anthropic/i,
  googlebot: /google/i,
  'google-cloudvertexbot': /google/i,
  bingbot: /microsoft/i,
  perplexitybot: /perplexity/i,
  'perplexity-user': /perplexity/i,
  ccbot: /common ?crawl/i,
  applebot: /apple/i,
  duckduckbot: /duckduckgo/i,
  duckassistbot: /duckduckgo/i,
  yandexbot: /yandex/i,
  'facebook-link-preview': /facebook|meta platforms/i,
  facebookbot: /facebook|meta platforms/i,
  'meta-externalagent': /facebook|meta platforms/i,
  'meta-externalfetcher': /facebook|meta platforms/i,
  ahrefsbot: /ahrefs/i,
  semrushbot: /semrush/i,
  baidu: /baidu/i,
  amazonbot: /amazon/i,
  archiveorgbot: /internet archive/i,
  bytespider: /bytedance/i,
  'tiktok-spider': /bytedance/i,
  petalbot: /huawei/i,
  'mistralai-user': /mistral/i,
  'cloudflare-crawler': /cloudflare/i,
};

const REGISTRY_KEY = 'registry';
const MAX_ENTRIES = 500;
// registry.json is edge-cached this long so repeated live-poll requests don't each
// hit KV; kept short since new visits should still surface quickly.
const REGISTRY_CACHE_SECONDS = 15;

// Returns a bot identity string, 'unknown-agent' for non-browser scripted clients,
// or null for anything that looks like a real browser (those aren't logged).
function classifyIdentity(ua) {
  if (!ua) return 'unknown-agent';
  for (const [pattern, identity] of KNOWN_BOTS) {
    if (pattern.test(ua)) return identity;
  }
  const looksLikeBrowser = /Mozilla\/5\.0/.test(ua) && /(Chrome|Safari|Firefox|Edg)\//.test(ua);
  return looksLikeBrowser ? null : 'unknown-agent';
}

function headerWeightBytes(request) {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const [key, value] of request.headers) {
    bytes += encoder.encode(key).length + encoder.encode(value).length;
  }
  return bytes;
}

async function hashClient(ip, ua) {
  const data = new TextEncoder().encode(`${ip}|${ua}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

function randomRegistryId() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Cross-checks the UA-claimed identity against the network it actually arrived from.
// verified is null when there's no known-org expectation for this identity, or Cloudflare
// couldn't resolve the ASN — true/false only when there's something real to compare.
function networkInfo(request, identity) {
  const asn = request.cf?.asn ?? null;
  const org = request.cf?.asOrganization || null;
  const pattern = EXPECTED_ORG_PATTERNS[identity];
  const verified = pattern && org ? pattern.test(org) : null;
  return { asn, org, verified };
}

async function appendEntry(env, entry) {
  try {
    const raw = await env.REGISTRY_KV.get(REGISTRY_KEY);
    let entries = [];
    if (raw) {
      try { entries = JSON.parse(raw); } catch (err) { entries = []; }
    }
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    await env.REGISTRY_KV.put(REGISTRY_KEY, JSON.stringify(entries));
  } catch (err) {
    // KV write failed — drop this entry rather than break a request already served to the visitor
  }
}

// Assembles the canonical registry entry. Both the passive visit log and the
// handshake endpoint go through here so the two can never drift in shape;
// `extraHandshake` carries the handshake-only fields (autonomous_signature,
// verified_autonomous) and is merged at the end of the handshake block to keep
// key order stable.
async function buildEntry(request, identity, entryPath, extraHandshake = {}) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const network = networkInfo(request, identity);
  return {
    registry_id: randomRegistryId(),
    identity,
    timestamp: new Date().toISOString(),
    trajectory: {
      entry_path: entryPath,
      protocol: request.cf?.httpProtocol || 'unknown',
      header_weight_bytes: headerWeightBytes(request),
    },
    handshake: {
      accept_payload: request.headers.get('Accept') || 'none',
      client_hash: await hashClient(ip, ua),
      network_asn: network.asn,
      network_org: network.org,
      network_verified: network.verified,
      ...extraHandshake,
    },
  };
}

async function logVisit(request, env, identity, url) {
  await appendEntry(env, await buildEntry(request, identity, url.pathname));
}

async function handleRegistryGet(request, env, ctx) {
  // Serve a recent edge-cached copy when we have one, so the frequent live-poll
  // requests from open registry pages don't each cost a KV read.
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let entries = [];
  try {
    const raw = await env.REGISTRY_KV.get(REGISTRY_KEY);
    if (raw) entries = JSON.parse(raw);
  } catch (err) {
    entries = [];
  }
  const response = new Response(JSON.stringify(entries, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${REGISTRY_CACHE_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function handleHandshake(request, env, ctx) {
  let signature = '';
  try {
    const form = await request.formData();
    signature = (form.get('autonomous_signature') || '').toString().trim();
  } catch (err) {
    signature = '';
  }

  if (signature) {
    const identity = classifyIdentity(request.headers.get('User-Agent') || '') || 'unknown-agent';
    const entry = await buildEntry(request, identity, '/api/register-handshake', {
      autonomous_signature: signature,
      verified_autonomous: true,
    });
    ctx.waitUntil(appendEntry(env, entry));
  }

  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/registry.json' && request.method === 'GET') {
      return handleRegistryGet(request, env, ctx);
    }

    if (url.pathname === '/api/register-handshake' && request.method === 'POST') {
      return handleHandshake(request, env, ctx);
    }

    const identity = classifyIdentity(request.headers.get('User-Agent') || '');
    if (identity) {
      ctx.waitUntil(logVisit(request, env, identity, url));
    }

    // Bypass Cloudflare's edge cache on the way to origin — this is a small,
    // actively-changing site, so always-fresh content matters more than the
    // performance win from caching static assets at the edge.
    return fetch(request, { cf: { cacheTtl: 0, cacheEverything: false } });
  },
};
