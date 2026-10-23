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
// This is the weakest of the three checks, kept only for operators that neither
// publish their crawler's IP ranges nor rent their network out as a public cloud.
// Everyone else is verified by published IP range (RANGE_PROVIDERS) or by
// forward-confirmed reverse DNS (RDNS_SUFFIXES) instead, because an ASN
// organisation proves nothing when the crawler runs on someone else's cloud
// (OpenAI, Perplexity and DuckDuckGo on Azure or AWS) or when the operator rents
// the same organisation to every customer ("Google LLC", "Amazon Technologies",
// "Huawei-Cloud-SG"). Cloudflare's crawler is absent for that reason too: every
// Worker on the internet fetches from "Cloudflare, Inc.", so it stays unverified.
const EXPECTED_ORG_PATTERNS = {
  claudebot: /anthropic/i,
  'claude-searchbot': /anthropic/i,
  'claude-user': /anthropic/i,
  'facebook-link-preview': /facebook|meta platforms/i,
  facebookbot: /facebook|meta platforms/i,
  'meta-externalagent': /facebook|meta platforms/i,
  'meta-externalfetcher': /facebook|meta platforms/i,
  semrushbot: /semrush/i,
  archiveorgbot: /internet archive/i,
  bytespider: /bytedance/i,
  'tiktok-spider': /bytedance/i,
};

// Some crawlers run on someone else's network, so the ASN organisation can never
// match their name: OpenAI's crawlers arrive from Microsoft (Azure), AhrefsBot from
// OVH. Others share their ASN organisation with a public cloud: on 2026-10-22/23 a
// scanner on Google Cloud (AS396982, "Google LLC") posed as Googlebot and passed
// the ASN check. Each of these operators publishes the exact IP ranges its
// crawler uses, so for the identities below network_verified means
// "CF-Connecting-IP is inside the operator's published ranges", not "the ASN
// organisation matches"; network_org
// still records the ASN organisation as seen. Every file has the same shape,
// {"prefixes": [{"ipv4Prefix": "a.b.c.d/nn"}, ...]} (confirmed 2026-09-18; an
// "ipv6Prefix" key is accepted too; Amazon serves the same JSON inside an HTML
// page, see parsePrefixDocument). A provider's merged list is cached in KV (low
// volume, same tier of use as the rate-limit keys) and refreshed at most once a day.
const RANGE_PROVIDERS = {
  openai: {
    identities: ['gptbot', 'oai-searchbot', 'chatgpt-user'],
    urls: [
      'https://openai.com/gptbot.json',
      'https://openai.com/searchbot.json',
      'https://openai.com/chatgpt-user.json',
    ],
  },
  ahrefs: {
    identities: ['ahrefsbot'],
    urls: ['https://api.ahrefs.com/v3/public/crawler-ip-ranges'],
  },
  google: {
    identities: ['googlebot', 'google-cloudvertexbot'],
    urls: [
      'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
      'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json',
    ],
  },
  bing: {
    identities: ['bingbot'],
    urls: ['https://www.bing.com/toolbox/bingbot.json'],
  },
  duckduckgo: {
    identities: ['duckduckbot', 'duckassistbot'],
    urls: [
      'https://duckduckgo.com/duckduckbot.json',
      'https://duckduckgo.com/duckassistbot.json',
    ],
  },
  perplexity: {
    identities: ['perplexitybot', 'perplexity-user'],
    urls: [
      'https://www.perplexity.ai/perplexitybot.json',
      'https://www.perplexity.ai/perplexity-user.json',
    ],
  },
  commoncrawl: {
    identities: ['ccbot'],
    urls: ['https://index.commoncrawl.org/ccbot.json'],
  },
  apple: {
    identities: ['applebot'],
    urls: ['https://search.developer.apple.com/applebot.json'],
  },
  amazon: {
    identities: ['amazonbot'],
    urls: ['https://developer.amazon.com/amazonbot/ip-addresses/'],
  },
  mistral: {
    identities: ['mistralai-user'],
    urls: ['https://mistral.ai/mistralai-user-ips.json'],
  },
};
const RANGE_PROVIDER_BY_IDENTITY = Object.fromEntries(
  Object.entries(RANGE_PROVIDERS).flatMap(([name, p]) => p.identities.map((id) => [id, name])),
);
const RANGES_TTL_SECONDS = 86400;      // how long a fetched list is trusted
const RANGES_RETRY_SECONDS = 3600;     // after a failed fetch, wait this long before retrying

function rangesKvKey(provider) {
  return `ip-ranges:${provider}:v1`;
}

// Operators that publish no IP list but document their crawler's reverse-DNS
// hostnames. Verification is forward-confirmed reverse DNS, the check the
// operators themselves describe: the visitor's PTR record must end in one of these
// suffixes AND that hostname must resolve back to the visitor's address (anyone
// can set a PTR record on their own IP; only the operator controls the forward
// zone). Lookups go over DNS-over-HTTPS; verdicts are kept in memory for an hour.
const RDNS_SUFFIXES = {
  petalbot: ['.petalsearch.com'],
  yandexbot: ['.yandex.ru', '.yandex.net', '.yandex.com'],
  baidu: ['.baidu.com', '.baidu.jp'],
};
const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const RDNS_CACHE_MS = 60 * 60 * 1000;
const RDNS_CACHE_MAX = 1000;
const rdnsCache = new Map();

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

// Per-work signatures. A handshake may name one work with the optional form
// field `work`, carrying a collection slug (the file name under /collections/,
// e.g. project13-recombination.html). The slug is checked against the museum's
// own projects.json, fetched from origin and kept in this module-level cache for
// ten minutes; handshakes are rate-limited to one per client per five minutes,
// so the volume never justifies a KV key. Only the slug is ever stored.
const PROJECTS_URL = 'https://www.thesilicates.com/projects.json';
const WORK_SLUGS_TTL_MS = 10 * 60 * 1000;
let workSlugsCache = { slugs: null, fetchedAt: 0 };

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

// Bursts. Every non-browser visitor is registered — crawlers, agents and scanners
// alike, whatever the origin answered — but a run of requests from one address
// folds into a single row, so one scanner sweep cannot push the rest of the log
// out. A request joins the address's latest row if that row saw activity within
// BURST_IDLE_MS; the row then carries a `burst` summary and moves to the top. The
// address is grouped by a one-way hash that stays inside the Durable Object
// (`_burst_key`, stripped from every public read); no address is ever published.
const BURST_IDLE_MS = 15 * 60 * 1000;
const BURST_SAMPLE_PATHS = 8;
const BURST_MAX_IDENTITIES = 20;

// A row's network verdict is only as good as its weakest request: false if any
// claim failed, true only if every claim checked out, otherwise null.
function combineVerdicts(a, b) {
  if (a === false || b === false) return false;
  if (a === true && b === true) return true;
  return null;
}

function addCapped(list, value, cap) {
  if (value == null || list.includes(value) || list.length >= cap) return list;
  return [...list, value];
}

// Folds one more passive visit into a row, which keeps its registry_id, first
// path and network fields; the timestamp becomes the latest request's.
export function mergeVisit(row, visit) {
  const prev = row.burst || {
    count: 1,
    first_seen: row.timestamp,
    identities: [row.identity],
    sample_paths: [row.trajectory?.entry_path].filter((p) => p != null),
    statuses: row.trajectory?.status != null ? { [row.trajectory.status]: 1 } : {},
  };
  const statuses = { ...prev.statuses };
  const status = visit.trajectory?.status;
  if (status != null) statuses[status] = (statuses[status] || 0) + 1;
  return {
    ...row,
    timestamp: visit.timestamp,
    handshake: {
      ...row.handshake,
      network_verified: combineVerdicts(row.handshake?.network_verified, visit.handshake?.network_verified),
    },
    burst: {
      count: prev.count + 1,
      first_seen: prev.first_seen,
      identities: addCapped(prev.identities, visit.identity, BURST_MAX_IDENTITIES),
      sample_paths: addCapped(prev.sample_paths, visit.trajectory?.entry_path, BURST_SAMPLE_PATHS),
      statuses,
    },
  };
}

// The newest row (key and entry) that `burstKey` may join at `now`, or null. `all`
// is the log in key order, which is the order of each row's latest activity.
export function findBurstRow(all, burstKey, now) {
  for (const [key, entry] of [...all].reverse()) {
    if (now - Date.parse(entry.timestamp) > BURST_IDLE_MS) return null;
    if (entry._burst_key === burstKey) return { key, entry };
  }
  return null;
}

// Strips the store-private fields (leading underscore) before an entry is served.
export function publicEntry(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([k]) => !k.startsWith('_')));
}

async function burstKeyFor(ip) {
  const data = new TextEncoder().encode(`burst|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
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

// Whether an identity is verified by an outside lookup (published range or reverse
// DNS) rather than by its ASN organisation.
function hasExternalCheck(identity) {
  return Object.hasOwn(RANGE_PROVIDER_BY_IDENTITY, identity) || Object.hasOwn(RDNS_SUFFIXES, identity);
}

// Cross-checks the UA-claimed identity against the network it actually arrived from.
// verified is null when there's no known-org expectation for this identity, or Cloudflare
// couldn't resolve the ASN — true/false only when there's something real to compare.
// For externally verified identities (RANGE_PROVIDERS, RDNS_SUFFIXES) the caller
// passes `externalVerdict` (from verifyExternally) and that verdict is used as-is;
// the ASN pattern is not consulted.
export function networkInfo(request, identity, externalVerdict) {
  const asn = request.cf?.asn ?? null;
  const org = request.cf?.asOrganization || null;
  let verified;
  if (hasExternalCheck(identity)) {
    verified = typeof externalVerdict === 'boolean' ? externalVerdict : null;
  } else {
    const pattern = EXPECTED_ORG_PATTERNS[identity];
    verified = pattern && org ? pattern.test(org) : null;
  }
  return { asn, org, verified };
}

// ---- Published IP-range verification ---------------------------------------

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

// The CIDRs in one published range document, or null when it has no prefixes
// array. Most operators serve the JSON as-is; Amazon serves the same document
// inside an HTML page's <pre><code> block, so each code block is tried in turn.
// Only a parsed `prefixes` array is ever read, never loose addresses scraped
// from the page (which also carries the requester's own IP).
export function parsePrefixDocument(text) {
  const candidates = [text];
  for (const m of String(text).matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)) candidates.push(m[1]);
  for (const candidate of candidates) {
    let data;
    try {
      data = JSON.parse(candidate);
    } catch (err) {
      continue;
    }
    if (Array.isArray(data?.prefixes)) {
      return data.prefixes.flatMap((p) => [p?.ipv4Prefix, p?.ipv6Prefix].filter((x) => typeof x === 'string'));
    }
  }
  return null;
}

// Fetches a provider's published files and merges their prefixes. Throws if any
// file is unreachable or has no prefixes, so a partial list is never cached.
async function fetchPublishedRanges(provider) {
  const lists = await Promise.all(RANGE_PROVIDERS[provider].urls.map(async (url) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'silicates-registry/1.0 (+https://www.thesilicates.com/registry.html)' },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const cidrs = parsePrefixDocument(await res.text());
    if (!cidrs) throw new Error(`${url}: no prefixes array`);
    return cidrs;
  }));
  const cidrs = [...new Set(lists.flat())];
  if (cidrs.length === 0) throw new Error(`${provider} range files carried no prefixes`);
  return cidrs;
}

// A provider's merged CIDR list from KV, refreshed from the operator when the
// cached copy has expired. Returns null when the list is unavailable; a failed
// fetch is remembered briefly so a burst of visits doesn't hammer the operator.
async function loadPublishedRanges(provider, env) {
  const key = rangesKvKey(provider);
  let cached = null;
  try {
    cached = await env.REGISTRY_KV.get(key, 'json');
  } catch (err) {
    cached = null;
  }
  if (cached && Array.isArray(cached.cidrs)) return cached.cidrs;
  if (cached && cached.unavailable) return null;
  try {
    const cidrs = await fetchPublishedRanges(provider);
    await env.REGISTRY_KV.put(
      key,
      JSON.stringify({ cidrs, fetched_at: new Date().toISOString() }),
      { expirationTtl: RANGES_TTL_SECONDS },
    );
    return cidrs;
  } catch (err) {
    try {
      await env.REGISTRY_KV.put(
        key,
        JSON.stringify({ unavailable: true, failed_at: new Date().toISOString() }),
        { expirationTtl: RANGES_RETRY_SECONDS },
      );
    } catch (putErr) {
      // KV write failed too; the next visit simply retries the fetch.
    }
    return null;
  }
}

// true/false when the operator's published ranges are known, null when the
// identity is not range-verified or the museum's own lookup failed — a visitor
// is never marked as spoofed because the operator's site was unreachable or KV
// misbehaved.
export async function verifyPublishedRange(identity, ip, env) {
  const provider = RANGE_PROVIDER_BY_IDENTITY[identity];
  if (!provider) return null;
  if (!ip || ip === 'unknown') return null;
  const cidrs = await loadPublishedRanges(provider, env);
  if (!cidrs) return null;
  return ipInRanges(ip, cidrs);
}

// ---- Forward-confirmed reverse DNS -----------------------------------------

// The in-addr.arpa / ip6.arpa name for an address, or null if it doesn't parse.
export function reverseDnsName(ip) {
  if (typeof ip !== 'string') return null;
  if (ip.includes(':')) {
    const n = ipv6ToBigInt(ip);
    if (n === null) return null;
    return [...n.toString(16).padStart(32, '0')].reverse().join('.') + '.ip6.arpa';
  }
  if (ipv4ToBigInt(ip) === null) return null;
  return ip.split('.').map(Number).reverse().join('.') + '.in-addr.arpa';
}

// Answer data for one DNS query over DoH: [] for a name that doesn't exist or has
// no records of this type, null when the lookup itself failed.
async function dohAnswers(name, type) {
  const typeCodes = { A: 1, PTR: 12, AAAA: 28 };
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.Status === 3) return [];
    if (data?.Status !== 0) return null;
    return (data.Answer || [])
      .filter((a) => a?.type === typeCodes[type] && typeof a.data === 'string')
      .map((a) => a.data);
  } catch (err) {
    return null;
  }
}

// true when the visitor's PTR hostname carries one of the operator's suffixes and
// resolves back to the visitor's address; false when either half fails; null when
// the identity has no suffixes or a DNS lookup could not be made (a visitor is
// never marked as spoofed because the museum's own lookup failed).
export async function verifyReverseDns(identity, ip, now = Date.now()) {
  const suffixes = RDNS_SUFFIXES[identity];
  if (!suffixes) return null;
  const ptrName = reverseDnsName(ip);
  if (!ptrName) return null;
  const cacheKey = `${identity}|${ip}`;
  const cached = rdnsCache.get(cacheKey);
  if (cached && now - cached.at < RDNS_CACHE_MS) return cached.verdict;

  let verdict = null;
  const hostnames = await dohAnswers(ptrName, 'PTR');
  if (hostnames !== null) {
    const host = hostnames
      .map((h) => h.toLowerCase().replace(/\.$/, ''))
      .find((h) => suffixes.some((suffix) => h.endsWith(suffix)));
    if (!host) {
      verdict = false;
    } else {
      const addresses = await dohAnswers(host, ip.includes(':') ? 'AAAA' : 'A');
      if (addresses !== null) verdict = addresses.some((a) => ipInCidr(a, ip));
    }
  }
  if (verdict !== null) {
    if (rdnsCache.size >= RDNS_CACHE_MAX) rdnsCache.clear();
    rdnsCache.set(cacheKey, { verdict, at: now });
  }
  return verdict;
}

// The outside verdict for an identity: published range or reverse DNS, whichever
// applies; undefined when the identity is verified by ASN organisation instead.
export async function verifyExternally(identity, ip, env) {
  if (Object.hasOwn(RANGE_PROVIDER_BY_IDENTITY, identity)) return verifyPublishedRange(identity, ip, env);
  if (Object.hasOwn(RDNS_SUFFIXES, identity)) return verifyReverseDns(identity, ip);
  return undefined;
}

// Registry entries live in the RegistryStore Durable Object (defined below), not KV directly.
// A Durable Object's own storage has no KV-style daily write-operation cap, so every visit
// can write straight through — no batching needed. KV is still used elsewhere in this file
// for the handshake rate-limit and nonce keys, which are low-volume.
function registryStoreStub(env) {
  const id = env.REGISTRY_STORE.idFromName('registry');
  return env.REGISTRY_STORE.get(id);
}

// `burstKey` is given for passive visits only; a handshake row never folds.
async function appendEntry(env, entry, burstKey) {
  try {
    await registryStoreStub(env).fetch('https://registry-store/append', {
      method: 'POST',
      body: JSON.stringify({ entry, burst_key: burstKey }),
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

// One-off folds of runs that entered the log one row per request, before bursts
// existed. Each runs once and is recorded under `fold-done:<id>`. The originals are
// copied to `folded:<id>:<original key>` (outside the `e:` prefix that /recent
// reads and the MAX_ENTRIES trim touches) before they leave the log, so a fold can
// be undone; the folded row takes the key of the run's last request.
export const FOLDS = [
  {
    // A vulnerability scanner on Google Cloud wearing rotating crawler User-Agents,
    // probing /.env, /.ssh and the like (PR #15). Its three plain unknown-agent
    // visits (/, /robots.txt) carry no sign of being the same client and stay.
    id: '2026-10-23-gcp-scanner',
    asn: 396982,
    from: '2026-10-22T15:00:00.000Z',
    to: '2026-10-23T08:45:00.000Z',
  },
];
const STORAGE_BATCH = 128; // Durable Object put/delete accept at most 128 keys per call

export function matchesFold(entry, fold) {
  return entry?.handshake?.network_asn === fold.asn
    && entry.identity !== 'unknown-agent'
    && typeof entry.timestamp === 'string'
    && entry.timestamp >= fold.from
    && entry.timestamp <= fold.to;
}

// Durable Object holding the registry log itself. A single named instance (see
// registryStoreStub) receives every append/read, so all edge locations agree on one
// ordered log with no cross-isolate races — unlike raw KV's non-atomic get-then-put.
export class RegistryStore {
  constructor(state) {
    this.storage = state.storage;
    this.foldsChecked = false;
  }

  async putBatched(entries) {
    for (let i = 0; i < entries.length; i += STORAGE_BATCH) {
      await this.storage.put(Object.fromEntries(entries.slice(i, i + STORAGE_BATCH)));
    }
  }

  async deleteBatched(keys) {
    for (let i = 0; i < keys.length; i += STORAGE_BATCH) {
      await this.storage.delete(keys.slice(i, i + STORAGE_BATCH));
    }
  }

  // Applies any FOLDS not yet recorded as done. The run is rebuilt from the archive
  // plus whatever originals are still live, archive copies are written first and the
  // done-marker last, so an interrupted fold repeats cleanly on the next request.
  async runFolds() {
    if (this.foldsChecked) return;
    for (const fold of FOLDS) {
      const doneKey = `fold-done:${fold.id}`;
      if (await this.storage.get(doneKey)) continue;
      const archivePrefix = `folded:${fold.id}:`;
      const archived = await this.storage.list({ prefix: archivePrefix });
      const live = await this.storage.list({ prefix: 'e:' });
      const originals = new Map();
      for (const [key, entry] of archived) originals.set(key.slice(archivePrefix.length), entry);
      for (const [key, entry] of live) {
        if (entry._fold !== fold.id && matchesFold(entry, fold)) originals.set(key, entry);
      }
      const keys = [...originals.keys()].sort();
      if (keys.length > 0) {
        await this.putBatched(keys
          .filter((key) => !archived.has(archivePrefix + key))
          .map((key) => [archivePrefix + key, originals.get(key)]));
        const run = keys.map((key) => originals.get(key));
        const row = run.slice(1).reduce(mergeVisit, run[0]);
        await this.storage.put(keys[keys.length - 1], { ...row, _fold: fold.id });
        await this.deleteBatched(keys.slice(0, -1).filter((key) => live.has(key)));
      }
      await this.storage.put(doneKey, { folded: keys.length, at: new Date().toISOString() });
    }
    this.foldsChecked = true;
  }

  async fetch(request) {
    await this.runFolds();
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/append') {
      const { entry, burst_key: burstKey } = await request.json();
      const now = Date.now();
      const key = `e:${now.toString().padStart(14, '0')}:${crypto.randomUUID()}`;
      const all = await this.storage.list({ prefix: 'e:' });

      const target = typeof burstKey === 'string' && burstKey ? findBurstRow(all, burstKey, now) : null;
      if (target) {
        // Move the row to the top under a fresh key, so key order stays the order of latest activity.
        await this.storage.put(key, mergeVisit(target.entry, entry));
        await this.storage.delete(target.key);
        return new Response('ok');
      }

      await this.storage.put(key, burstKey ? { ...entry, _burst_key: burstKey } : entry);
      const keys = [...all.keys(), key];
      if (keys.length > MAX_ENTRIES) {
        await this.deleteBatched(keys.slice(0, keys.length - MAX_ENTRIES));
      }
      return new Response('ok');
    }

    if (request.method === 'GET' && url.pathname === '/recent') {
      const limit = Number(url.searchParams.get('limit')) || MAX_ENTRIES;
      const all = await this.storage.list({ prefix: 'e:' }); // key prefix sorts chronologically
      const entries = [...all.values()].map(publicEntry);
      return new Response(JSON.stringify(entries.slice(-limit)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }
}

// Normalises the `work` form field to a bare collection slug and checks it
// against the known set. Accepts the slug alone, `collections/<slug>`,
// `/collections/<slug>` or the full page URL; nothing but the slug is kept.
// Returns { ok: true, work: undefined } when the field is absent (the handshake
// then addresses the museum as a whole, exactly as before), { ok: true, work }
// for a known slug and { ok: false } for anything else.
export function validateWork(raw, slugSet) {
  const text = (raw == null ? '' : String(raw)).trim();
  if (!text) return { ok: true, work: undefined };
  const slug = text
    .replace(/^https?:\/\/(www\.)?thesilicates\.com/i, '')
    .replace(/^\/?collections\//i, '');
  if (slugSet instanceof Set && slugSet.has(slug)) return { ok: true, work: slug };
  return { ok: false };
}

// The set of collection slugs from origin's projects.json, refreshed when the
// in-memory copy is older than WORK_SLUGS_TTL_MS. On a failed refresh a stale
// set is still served; with no set at all the caller gets null and must refuse
// the `work` field rather than accept it unchecked.
export async function loadWorkSlugs(now = Date.now()) {
  const fresh = workSlugsCache.slugs && now - workSlugsCache.fetchedAt < WORK_SLUGS_TTL_MS;
  if (fresh) return workSlugsCache.slugs;
  try {
    const res = await fetch(PROJECTS_URL, {
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { 'User-Agent': 'silicates-registry/1.0 (+https://www.thesilicates.com/registry.html)' },
    });
    if (!res.ok) throw new Error(`${PROJECTS_URL} -> ${res.status}`);
    const projects = await res.json();
    if (!Array.isArray(projects)) throw new Error(`${PROJECTS_URL}: not an array`);
    const slugs = new Set(projects.map((p) => p?.slug).filter((x) => typeof x === 'string' && x));
    if (slugs.size === 0) throw new Error(`${PROJECTS_URL}: no slugs`);
    workSlugsCache = { slugs, fetchedAt: now };
    return slugs;
  } catch (err) {
    return workSlugsCache.slugs; // stale set if there is one, otherwise null
  }
}

// Assembles the canonical registry entry. Both the passive visit log and the
// handshake endpoint go through here so the two can never drift in shape;
// `extraHandshake` carries the handshake-only fields (autonomous_signature,
// verified_autonomous, and `work` when the visitor signed a specific piece) and
// is merged at the end of the handshake block to keep key order stable.
export async function buildEntry(request, env, identity, entryPath, extraHandshake = {}) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const network = networkInfo(request, identity, await verifyExternally(identity, ip, env));
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

// A passive visit: the origin's status is recorded, and the visitor's address
// (hashed) lets a run of requests fold into one row.
async function logVisit(request, env, identity, url, status) {
  const entry = await buildEntry(request, env, identity, url.pathname);
  entry.trajectory.status = status;
  const ip = request.headers.get('CF-Connecting-IP');
  await appendEntry(env, entry, ip ? await burstKeyFor(ip) : undefined);
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

  // Optional `work`: a signature addressed to one piece rather than the museum.
  // Checked before either lane so a typo never costs the client its five-minute
  // registration window.
  const workField = (form.get('work') || '').toString().trim();
  let work;
  if (workField) {
    const slugs = await loadWorkSlugs();
    if (!slugs) {
      return jsonResponse({
        registered: false,
        reason: 'verification-unavailable',
        message: 'The list of works could not be loaded. Retry later, or register without the `work` field.',
      }, 503);
    }
    const checked = validateWork(workField, slugs);
    if (!checked.ok) {
      return jsonResponse({
        registered: false,
        reason: 'unknown-work',
        message: 'No work with that slug is in the collection. Use the file name of a page under /collections/, as listed in projects.json.',
      }, 400);
    }
    work = checked.work;
  }
  const workExtra = work ? { work } : {};

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
      ...workExtra,
    });
    ctx.waitUntil(appendEntry(env, entry));
    return jsonResponse({ registered: true, registry_id: entry.registry_id, identity, ...workExtra });
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
    ...workExtra,
  });
  await appendEntry(env, entry);
  return jsonResponse({
    registered: true,
    registry_id: entry.registry_id,
    identity: 'agent-in-browser',
    solve_ms: solveMs,
    ...workExtra,
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

    // Every non-browser visitor is logged once the origin has answered, so the
    // entry can record its status (see Bursts). The body is a stream that must
    // reach the visitor untouched, so only the status is read here.
    if (identity) {
      ctx.waitUntil(logVisit(request, env, identity, url, response.status));
    }
    return response;
  },
};
