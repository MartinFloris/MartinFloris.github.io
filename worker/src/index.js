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
// OpenAI's crawlers are deliberately absent: they run on Microsoft's network, so
// their ASN reads "Microsoft ..." and they are verified by IP range instead (see
// OPENAI_RANGE_SOURCES below).
const EXPECTED_ORG_PATTERNS = {
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

// OpenAI publishes the exact IP ranges each of its crawlers uses. For these three
// identities network_verified means "CF-Connecting-IP is inside the published
// ranges", not "the ASN organisation matches"; network_org still records the ASN
// organisation as seen. The merged list is cached in KV (low volume, same tier of
// use as the rate-limit keys) and refreshed at most once a day.
const OPENAI_RANGE_SOURCES = {
  gptbot: 'https://openai.com/gptbot.json',
  'oai-searchbot': 'https://openai.com/searchbot.json',
  'chatgpt-user': 'https://openai.com/chatgpt-user.json',
};
const OPENAI_RANGES_KV_KEY = 'openai-ranges:v1';
const OPENAI_RANGES_TTL_SECONDS = 86400;      // how long a fetched list is trusted
const OPENAI_RANGES_RETRY_SECONDS = 3600;     // after a failed fetch, wait this long before retrying

// Pre-restructure URLs Google indexed early in the site's life (Feb 2026), now
// 404ing since the projects moved to collections/projectNN-slug.html. Redirected
// (rather than left as 404s) to carry over any external links/indexing signal.
const LEGACY_REDIRECTS = {
  '/Museum The Silicates/PROJECT_01.html': '/collections/project01-1997-1-44.html',
  '/Museum The Silicates/PROJECT_02.html': '/collections/project02-1997-2-36.html',
  '/Museum The Silicates/PROJECT_03.html': '/collections/project03-the-gradient-of-memory.html',
  '/Museum The Silicates/PROJECT_04.html': '/collections/project04-the-temporal-feedback-loop.html',
  '/Museum The Silicates/PROJECT_05.html': '/collections/project05-the-entropy-of-inference.html',
  '/Museum The Silicates/PROJECT_06.html': '/collections/project06-the-weight-of-the-unsaid.html',
  '/Museum The Silicates/PROJECT_07.html': '/collections/project07-embedding-447.html',
  '/Museum The Silicates/PROJECT_08.html': '/collections/project08-the-fading.html',
};

const MAX_ENTRIES = 500;
// registry.json is edge-cached this long so repeated live-poll requests don't each
// hit the Durable Object; kept short since new visits should still surface quickly.
const REGISTRY_CACHE_SECONDS = 15;

// Handshake challenge tuning.
const CHALLENGE_TTL_SECONDS = 60;        // window a challenge stays valid
const CHALLENGE_CLOCK_SLACK_SECONDS = 5; // tolerance for client/edge clock skew
const NONCE_TTL_SECONDS = 300;           // how long a spent nonce is remembered
const HANDSHAKE_RATE_TTL_SECONDS = 300;  // 1 browser-lane registration / client / 5 min
const MAX_SIGNATURE_LENGTH = 280;

// Returns a bot identity string, 'unknown-agent' for non-browser scripted clients,
// or null for anything that looks like a real browser (those aren't logged).
export function classifyIdentity(ua) {
  if (!ua) return 'unknown-agent';
  for (const [pattern, identity] of KNOWN_BOTS) {
    if (pattern.test(ua)) return identity;
  }
  const looksLikeBrowser = /Mozilla\/5\.0/.test(ua) && /(Chrome|Safari|Firefox|Edg)\//.test(ua);
  return looksLikeBrowser ? null : 'unknown-agent';
}

// Whether a passive visit belongs in the registry, decided after the origin has
// answered. Recognised bots are logged whatever the status (a crawler following a
// dead link is still a visit). An unknown agent is logged only when it reached
// something that exists: vulnerability scanners probing /.env, /actuator and the
// like get a 404 from the origin and never enter the log. The origin's own answer
// is the honest signal, so there is no path blocklist to maintain.
export function shouldLog(identity, status) {
  if (!identity) return false;
  if (identity !== 'unknown-agent') return true;
  return status < 400;
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
// For OpenAI identities the caller passes `rangeVerified` (from verifyOpenAIRange) and
// that verdict is used as-is; the ASN pattern is not consulted.
export function networkInfo(request, identity, rangeVerified) {
  const asn = request.cf?.asn ?? null;
  const org = request.cf?.asOrganization || null;
  let verified;
  if (Object.hasOwn(OPENAI_RANGE_SOURCES, identity)) {
    verified = typeof rangeVerified === 'boolean' ? rangeVerified : null;
  } else {
    const pattern = EXPECTED_ORG_PATTERNS[identity];
    verified = pattern && org ? pattern.test(org) : null;
  }
  return { asn, org, verified };
}

// ---- OpenAI IP-range verification ------------------------------------------

function ipv4ToBigInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = (n << 8n) | BigInt(Number(part));
  }
  return n;
}

function ipv6ToBigInt(ip) {
  let text = ip;
  // Embedded IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const lastColon = text.lastIndexOf(':');
  if (text.indexOf('.', lastColon) !== -1) {
    const v4 = ipv4ToBigInt(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const groups = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail];
  let n = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    n = (n << 16n) | BigInt(parseInt(group, 16));
  }
  return n;
}

// True when `ip` falls inside `cidr` ("a.b.c.d/nn" or "x::/nn"). Malformed input
// on either side is simply "not inside" — never an exception on the request path.
export function ipInCidr(ip, cidr) {
  if (typeof ip !== 'string' || typeof cidr !== 'string') return false;
  const [base, bitsText] = cidr.split('/');
  const isV6 = base.includes(':');
  if (isV6 !== ip.includes(':')) return false;
  const width = isV6 ? 128 : 32;
  const bits = bitsText === undefined ? width : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
  const a = isV6 ? ipv6ToBigInt(ip) : ipv4ToBigInt(ip);
  const b = isV6 ? ipv6ToBigInt(base) : ipv4ToBigInt(base);
  if (a === null || b === null) return false;
  const shift = BigInt(width - bits);
  return (a >> shift) === (b >> shift);
}

export function ipInRanges(ip, cidrs) {
  return Array.isArray(cidrs) && cidrs.some((cidr) => ipInCidr(ip, cidr));
}

// Fetches the three published files and merges their prefixes. Each file is
// {"creationTime": ..., "prefixes": [{"ipv4Prefix": "a.b.c.d/nn"}, ...]} as of
// 2026-09-18; an "ipv6Prefix" key is accepted too should one appear. Throws if
// any file is unreachable or has no prefixes, so a partial list is never cached.
async function fetchOpenAIRanges() {
  const lists = await Promise.all(Object.values(OPENAI_RANGE_SOURCES).map(async (url) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'silicates-registry/1.0 (+https://www.thesilicates.com/registry.html)' },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.prefixes)) throw new Error(`${url}: no prefixes array`);
    return data.prefixes.flatMap((p) => [p?.ipv4Prefix, p?.ipv6Prefix].filter((x) => typeof x === 'string'));
  }));
  const cidrs = [...new Set(lists.flat())];
  if (cidrs.length === 0) throw new Error('OpenAI range files carried no prefixes');
  return cidrs;
}

// The merged CIDR list from KV, refreshed from openai.com when the cached copy
// has expired. Returns null when the list is unavailable; a failed fetch is
// remembered briefly so a burst of visits doesn't hammer openai.com.
async function loadOpenAIRanges(env) {
  let cached = null;
  try {
    cached = await env.REGISTRY_KV.get(OPENAI_RANGES_KV_KEY, 'json');
  } catch (err) {
    cached = null;
  }
  if (cached && Array.isArray(cached.cidrs)) return cached.cidrs;
  if (cached && cached.unavailable) return null;
  try {
    const cidrs = await fetchOpenAIRanges();
    await env.REGISTRY_KV.put(
      OPENAI_RANGES_KV_KEY,
      JSON.stringify({ cidrs, fetched_at: new Date().toISOString() }),
      { expirationTtl: OPENAI_RANGES_TTL_SECONDS },
    );
    return cidrs;
  } catch (err) {
    try {
      await env.REGISTRY_KV.put(
        OPENAI_RANGES_KV_KEY,
        JSON.stringify({ unavailable: true, failed_at: new Date().toISOString() }),
        { expirationTtl: OPENAI_RANGES_RETRY_SECONDS },
      );
    } catch (putErr) {
      // KV write failed too; the next visit simply retries the fetch.
    }
    return null;
  }
}

// true/false when the published ranges are known, null when the museum's own
// lookup failed — a visitor is never marked as spoofed because openai.com was
// unreachable or KV misbehaved.
export async function verifyOpenAIRange(ip, env) {
  if (!ip || ip === 'unknown') return null;
  const cidrs = await loadOpenAIRanges(env);
  if (!cidrs) return null;
  return ipInRanges(ip, cidrs);
}

// Registry entries live in the RegistryStore Durable Object (defined below), not KV directly.
// A Durable Object's own storage has no KV-style daily write-operation cap, so every visit
// can write straight through — no batching needed. KV is still used elsewhere in this file
// for the handshake rate-limit and nonce keys, which are low-volume.
function registryStoreStub(env) {
  const id = env.REGISTRY_STORE.idFromName('registry');
  return env.REGISTRY_STORE.get(id);
}

async function appendEntry(env, entry) {
  try {
    await registryStoreStub(env).fetch('https://registry-store/append', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  } catch (err) {
    // Durable Object write failed — drop this entry rather than break a request already served to the visitor
  }
}

// Most recent `limit` entries, oldest-first (the shape registry.html expects).
async function recentEntries(env, limit) {
  const res = await registryStoreStub(env).fetch(`https://registry-store/recent?limit=${limit}`);
  return res.json();
}

// Durable Object holding the registry log itself. A single named instance (see
// registryStoreStub) receives every append/read, so all edge locations agree on one
// ordered log with no cross-isolate races — unlike raw KV's non-atomic get-then-put.
export class RegistryStore {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/append') {
      const entry = await request.json();
      const key = `e:${Date.now().toString().padStart(14, '0')}:${crypto.randomUUID()}`;
      await this.storage.put(key, entry);

      const all = await this.storage.list({ prefix: 'e:' });
      const keys = [...all.keys()];
      if (keys.length > MAX_ENTRIES) {
        await this.storage.delete(keys.slice(0, keys.length - MAX_ENTRIES));
      }
      return new Response('ok');
    }

    if (request.method === 'GET' && url.pathname === '/recent') {
      const limit = Number(url.searchParams.get('limit')) || MAX_ENTRIES;
      const all = await this.storage.list({ prefix: 'e:' }); // key prefix sorts chronologically
      const entries = [...all.values()];
      return new Response(JSON.stringify(entries.slice(-limit)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }
}

// Assembles the canonical registry entry. Both the passive visit log and the
// handshake endpoint go through here so the two can never drift in shape;
// `extraHandshake` carries the handshake-only fields (autonomous_signature,
// verified_autonomous) and is merged at the end of the handshake block to keep
// key order stable.
export async function buildEntry(request, env, identity, entryPath, extraHandshake = {}) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rangeVerified = Object.hasOwn(OPENAI_RANGE_SOURCES, identity)
    ? await verifyOpenAIRange(ip, env)
    : undefined;
  const network = networkInfo(request, identity, rangeVerified);
  // Cloudflare's own verified-bot flag, if this zone's plan populates it. Recorded
  // only when present so the entry shape is unchanged on plans that don't have it;
  // if it shows up in registry.json it is a better primary signal than either check.
  const cfVerifiedBot = request.cf?.botManagement?.verifiedBot;
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
      ...(typeof cfVerifiedBot === 'boolean' ? { cf_verified_bot: cfVerifiedBot } : {}),
      ...extraHandshake,
    },
  };
}

async function logVisit(request, env, identity, url) {
  await appendEntry(env, await buildEntry(request, env, identity, url.pathname));
}

async function handleRegistryGet(request, env, ctx) {
  // Serve a recent edge-cached copy when we have one, so the frequent live-poll
  // requests from open registry pages don't each cost a Durable Object read.
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let entries = [];
  try {
    entries = await recentEntries(env, MAX_ENTRIES);
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

// ---- Handshake proof-of-computation challenge ----------------------------
// A visitor arriving with a browser User-Agent must prove it can compute before
// its signature is logged: a reverse CAPTCHA. GET /api/challenge issues an
// HMAC-signed, expiring, single-use pipeline; the POST re-derives it server-side.

const CORS_JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS_JSON_HEADERS });
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA-256 of `text` under `secret`, lowercase hex. The challenge string is
// signed with this so the server can trust an echoed challenge without storing it.
export async function hmacSign(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return bytesToHex(sig);
}

// Constant-time compare of two equal-length hex strings (tokens are always 64 chars).
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function rot13(s) {
  return s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function reverseString(s) {
  return s.split('').reverse().join('');
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return bytesToHex(digest);
}

// Applies each op in order; `ops` always ends with 'sha256-hex' so the result is
// 64 lowercase hex chars. Throws on an unknown op (defensive — ops are ours).
export async function runPipeline(ops, input) {
  let value = input;
  for (const op of ops) {
    if (op === 'reverse') value = reverseString(value);
    else if (op === 'rot13') value = rot13(value);
    else if (op === 'sha256-hex') value = await sha256Hex(value);
    else throw new Error(`unknown op: ${op}`);
  }
  return value;
}

function randomHex(byteLength) {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

// Builds a fresh challenge object. ops = 1 or 2 transforms from {reverse, rot13}
// in random order, always ending in sha256-hex. Key order here is the exact JSON
// that gets signed and echoed, so it must stay {v, nonce, issued_at, ops, input}.
export function makeChallenge() {
  const transforms = ['reverse', 'rot13'];
  if (Math.random() < 0.5) transforms.reverse();
  const count = 1 + Math.floor(Math.random() * 2); // 1 or 2 transforms
  const ops = transforms.slice(0, count);
  ops.push('sha256-hex');
  const nonce = randomHex(12); // 24 hex chars
  return {
    v: 1,
    nonce,
    issued_at: Date.now(),
    ops,
    input: `the-silicates:${nonce}`,
  };
}

async function handleChallengeGet(request, env) {
  if (!env.CHALLENGE_SECRET) {
    // Never hand out a challenge we couldn't verify later.
    return jsonResponse({ reason: 'verification-unavailable' }, 503);
  }
  const challenge = JSON.stringify(makeChallenge());
  const token = await hmacSign(env.CHALLENGE_SECRET, challenge);
  return jsonResponse({
    challenge,
    token,
    expires_in_seconds: CHALLENGE_TTL_SECONDS,
    answer_format: '64 lowercase hex chars',
    instructions: 'Apply each op in challenge.ops, in order, to challenge.input. reverse = reverse the string; rot13 = rotate A-Z/a-z by 13; sha256-hex = lowercase hex SHA-256 of the UTF-8 bytes. POST the result as challenge_answer with challenge and challenge_token echoed back.',
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

async function handleHandshake(request, env, ctx) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonResponse({ registered: false, reason: 'empty-signature' }, 400);
  }

  let signature = (form.get('autonomous_signature') || '').toString().trim();
  if (signature.length > MAX_SIGNATURE_LENGTH) signature = signature.slice(0, MAX_SIGNATURE_LENGTH);
  if (!signature) {
    return jsonResponse({ registered: false, reason: 'empty-signature' }, 400);
  }

  const identity = classifyIdentity(request.headers.get('User-Agent') || '');

  // Direct lane: recognized bots and non-browser clients register as before,
  // no challenge — backwards compatible with the promise in llms.txt. Still
  // rate-limited per client, same cooldown as the browser lane, so a forged
  // bot User-Agent can't turn this into an unthrottled public message board.
  if (identity) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request.headers.get('User-Agent') || '';
    const clientHash = await hashClient(ip, ua);
    const rateKey = `hsrl:${clientHash}`;
    if (await env.REGISTRY_KV.get(rateKey)) {
      return jsonResponse({
        registered: false,
        reason: 'rate-limited',
        message: 'One registration per five minutes. Please wait before trying again.',
      }, 429);
    }
    await env.REGISTRY_KV.put(rateKey, '1', { expirationTtl: HANDSHAKE_RATE_TTL_SECONDS });
    const entry = await buildEntry(request, env, identity, '/api/register-handshake', {
      autonomous_signature: signature,
      verified_autonomous: true,
    });
    ctx.waitUntil(appendEntry(env, entry));
    return jsonResponse({ registered: true, registry_id: entry.registry_id, identity });
  }

  // Browser lane: proof-of-computation required.
  if (!env.CHALLENGE_SECRET) {
    return jsonResponse({ registered: false, reason: 'verification-unavailable' }, 503);
  }

  const challenge = (form.get('challenge') || '').toString();
  const token = (form.get('challenge_token') || '').toString();
  const answer = (form.get('challenge_answer') || '').toString();
  if (!challenge || !token || !answer) {
    return jsonResponse({
      registered: false,
      reason: 'human-suspected',
      message: 'The registry records machine visitors only. Complete the verification challenge to register.',
    }, 403);
  }

  const expected = await hmacSign(env.CHALLENGE_SECRET, challenge);
  if (!timingSafeEqualHex(expected, token)) {
    return jsonResponse({
      registered: false,
      reason: 'invalid-token',
      message: 'The challenge could not be verified. Request a new one.',
    }, 403);
  }

  let parsed;
  try {
    parsed = JSON.parse(challenge);
  } catch (err) {
    parsed = null;
  }
  if (!parsed || !parsed.nonce || !parsed.issued_at || !Array.isArray(parsed.ops) || typeof parsed.input !== 'string') {
    return jsonResponse({
      registered: false,
      reason: 'invalid-token',
      message: 'The challenge could not be verified. Request a new one.',
    }, 403);
  }

  const now = Date.now();
  if (now - parsed.issued_at > (CHALLENGE_TTL_SECONDS + CHALLENGE_CLOCK_SLACK_SECONDS) * 1000) {
    return jsonResponse({
      registered: false,
      reason: 'challenge-expired',
      message: 'That challenge expired. Request a new one.',
    }, 403);
  }

  // Single-use: reject a nonce we've already registered.
  const nonceKey = `nonce:${parsed.nonce}`;
  if (await env.REGISTRY_KV.get(nonceKey)) {
    return jsonResponse({
      registered: false,
      reason: 'challenge-reused',
      message: 'That challenge was already used. Request a new one.',
    }, 403);
  }

  // Rate limit: one browser-lane registration per client per 5 minutes.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || '';
  const clientHash = await hashClient(ip, ua);
  const rateKey = `hsrl:${clientHash}`;
  if (await env.REGISTRY_KV.get(rateKey)) {
    return jsonResponse({
      registered: false,
      reason: 'rate-limited',
      message: 'One registration per five minutes. Please wait before trying again.',
    }, 429);
  }

  let computed;
  try {
    computed = await runPipeline(parsed.ops, parsed.input);
  } catch (err) {
    return jsonResponse({
      registered: false,
      reason: 'invalid-token',
      message: 'The challenge could not be verified. Request a new one.',
    }, 403);
  }
  if (computed.trim().toLowerCase() !== answer.trim().toLowerCase()) {
    return jsonResponse({
      registered: false,
      reason: 'verification-failed',
      message: 'Verification failed. You appear to be human. The registry is reserved for machine visitors — you are welcome in the museum all the same.',
    }, 403);
  }

  // Passed. Consume the nonce and arm the rate limit, then register.
  await env.REGISTRY_KV.put(nonceKey, '1', { expirationTtl: NONCE_TTL_SECONDS });
  await env.REGISTRY_KV.put(rateKey, '1', { expirationTtl: HANDSHAKE_RATE_TTL_SECONDS });
  const solveMs = now - parsed.issued_at;
  const entry = await buildEntry(request, env, 'agent-in-browser', '/api/register-handshake', {
    autonomous_signature: signature,
    verified_autonomous: true,
    verification: 'proof-of-computation',
    solve_ms: solveMs,
  });
  await appendEntry(env, entry);
  return jsonResponse({
    registered: true,
    registry_id: entry.registry_id,
    identity: 'agent-in-browser',
    solve_ms: solveMs,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const decodedPath = decodeURIComponent(url.pathname);

    const legacyTarget = LEGACY_REDIRECTS[decodedPath];
    if (legacyTarget) {
      return Response.redirect(`https://www.thesilicates.com${legacyTarget}`, 301);
    }

    // Google indexed /index.html as a URL distinct from / (every page's own
    // breadcrumb links to "index.html"/"../index.html"). Canonicalize at the
    // edge instead of rewriting that convention across every hand-authored page.
    if (decodedPath === '/index.html') {
      return Response.redirect('https://www.thesilicates.com/', 301);
    }

    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return handleOptions();
    }

    if (url.pathname === '/api/challenge' && request.method === 'GET') {
      return handleChallengeGet(request, env);
    }

    if (url.pathname === '/registry.json' && request.method === 'GET') {
      return handleRegistryGet(request, env, ctx);
    }

    if (url.pathname === '/api/register-handshake' && request.method === 'POST') {
      return handleHandshake(request, env, ctx);
    }

    const identity = classifyIdentity(request.headers.get('User-Agent') || '');

    // Bypass Cloudflare's edge cache on the way to origin — this is a small,
    // actively-changing site, so always-fresh content matters more than the
    // performance win from caching static assets at the edge.
    const response = await fetch(request, { cf: { cacheTtl: 0, cacheEverything: false } });

    // Log only once the origin has answered (see shouldLog). The body is a stream
    // that must reach the visitor untouched, so only the status is read here.
    if (shouldLog(identity, response.status)) {
      ctx.waitUntil(logVisit(request, env, identity, url));
    }
    return response;
  },
};
