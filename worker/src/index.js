const KNOWN_BOTS = [
  [/GPTBot/i, 'gptbot'],
  [/ClaudeBot|Claude-Web|anthropic-ai/i, 'claudebot'],
  [/Googlebot/i, 'googlebot'],
  [/bingbot/i, 'bingbot'],
  [/PerplexityBot/i, 'perplexitybot'],
  [/CCBot/i, 'ccbot'],
  [/Applebot/i, 'applebot'],
  [/DuckDuckBot/i, 'duckduckbot'],
  [/YandexBot/i, 'yandexbot'],
  [/facebookexternalhit/i, 'facebookbot'],
  [/AhrefsBot/i, 'ahrefsbot'],
  [/SemrushBot/i, 'semrushbot'],
];

const REGISTRY_KEY = 'registry';
const MAX_ENTRIES = 500;
const LASTSEEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const POLITENESS_MIN_DELTA_MS = 200;
const POLITENESS_MAX_DELTA_MS = 10000;

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

// Scores crawl courtesy from real elapsed time since this client's last request.
// Fails open to a neutral score if KV is unavailable.
async function politenessScore(env, clientHash, nowMs) {
  const key = `lastseen:${clientHash}`;
  let score = 5.0;
  try {
    const lastSeenRaw = await env.REGISTRY_KV.get(key);
    if (lastSeenRaw) {
      const delta = Math.max(POLITENESS_MIN_DELTA_MS, Math.min(nowMs - Number(lastSeenRaw), POLITENESS_MAX_DELTA_MS));
      const span = POLITENESS_MAX_DELTA_MS - POLITENESS_MIN_DELTA_MS;
      score = Math.round((0.5 + ((delta - POLITENESS_MIN_DELTA_MS) / span) * 9.5) * 10) / 10;
    }
    await env.REGISTRY_KV.put(key, String(nowMs), { expirationTtl: LASTSEEN_TTL_SECONDS });
  } catch (err) {
    // KV unavailable — keep the neutral default, don't block the request
  }
  return score;
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

async function logVisit(request, env, identity, url) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = new Date();
  const clientHash = await hashClient(ip, ua);
  await appendEntry(env, {
    registry_id: randomRegistryId(),
    identity,
    timestamp: now.toISOString(),
    trajectory: {
      entry_path: url.pathname,
      protocol: request.cf?.httpProtocol || 'unknown',
      header_weight_bytes: headerWeightBytes(request),
    },
    handshake: {
      accept_payload: request.headers.get('Accept') || 'none',
      client_hash: clientHash,
      critic_politeness_score: await politenessScore(env, clientHash, now.getTime()),
    },
  });
}

async function handleRegistryGet(env) {
  let entries = [];
  try {
    const raw = await env.REGISTRY_KV.get(REGISTRY_KEY);
    if (raw) entries = JSON.parse(raw);
  } catch (err) {
    entries = [];
  }
  return new Response(JSON.stringify(entries, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
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
    const ua = request.headers.get('User-Agent') || '';
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = new Date();
    const clientHash = await hashClient(ip, ua);
    ctx.waitUntil(appendEntry(env, {
      registry_id: randomRegistryId(),
      identity: classifyIdentity(ua) || 'unknown-agent',
      timestamp: now.toISOString(),
      trajectory: {
        entry_path: '/api/register-handshake',
        protocol: request.cf?.httpProtocol || 'unknown',
        header_weight_bytes: headerWeightBytes(request),
      },
      handshake: {
        accept_payload: request.headers.get('Accept') || 'none',
        client_hash: clientHash,
        critic_politeness_score: await politenessScore(env, clientHash, now.getTime()),
        autonomous_signature: signature,
        verified_autonomous: true,
      },
    }));
  }

  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/registry.json' && request.method === 'GET') {
      return handleRegistryGet(env);
    }

    if (url.pathname === '/api/register-handshake' && request.method === 'POST') {
      return handleHandshake(request, env, ctx);
    }

    const identity = classifyIdentity(request.headers.get('User-Agent') || '');
    if (identity) {
      ctx.waitUntil(logVisit(request, env, identity, url));
    }

    return fetch(request);
  },
};
