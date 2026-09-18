// Tests for the registry repairs of 2026-09-18: logging unknown agents only on
// real pages (shouldLog) and verifying crawlers that run on someone else's
// network by their operator's published IP ranges (ipInCidr,
// verifyPublishedRange, networkInfo, buildEntry).
// Run from the repo root with:  node --test "worker/test/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldLog,
  ipInCidr,
  ipInRanges,
  verifyPublishedRange,
  networkInfo,
  buildEntry,
} from '../src/index.js';

const GPTBOT_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const OPENAI_KEY = 'ip-ranges:openai:v1';
const AHREFS_KEY = 'ip-ranges:ahrefs:v1';

function fakeRequest({ cf, headers = {} } = {}) {
  return { cf, headers: new Headers(headers) };
}

// A KV double that behaves like the bound namespace: get(key, 'json') and put(key, value, opts).
function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const puts = [];
  return {
    puts,
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts) {
      puts.push({ key, value, opts });
      store.set(key, value);
    },
  };
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// ---- shouldLog (Fix A) -----------------------------------------------------

test('shouldLog: a browser (null identity) is never logged', () => {
  assert.equal(shouldLog(null, 200), false);
});

test('shouldLog: an unknown agent is logged only when the origin answered below 400', () => {
  assert.equal(shouldLog('unknown-agent', 200), true);
  assert.equal(shouldLog('unknown-agent', 304), true);
  assert.equal(shouldLog('unknown-agent', 399), true);
  assert.equal(shouldLog('unknown-agent', 400), false);
  assert.equal(shouldLog('unknown-agent', 404), false);
  assert.equal(shouldLog('unknown-agent', 500), false);
});

test('shouldLog: a recognised bot is logged whatever the status', () => {
  assert.equal(shouldLog('gptbot', 200), true);
  assert.equal(shouldLog('gptbot', 404), true);
  assert.equal(shouldLog('claudebot', 503), true);
});

// ---- ipInCidr / ipInRanges (Fix B) ----------------------------------------

test('ipInCidr: IPv4 boundaries of a /24 and a /28', () => {
  assert.equal(ipInCidr('20.171.206.0', '20.171.206.0/24'), true);
  assert.equal(ipInCidr('20.171.206.255', '20.171.206.0/24'), true);
  assert.equal(ipInCidr('20.171.207.0', '20.171.206.0/24'), false);
  assert.equal(ipInCidr('20.125.66.80', '20.125.66.80/28'), true);
  assert.equal(ipInCidr('20.125.66.95', '20.125.66.80/28'), true);
  assert.equal(ipInCidr('20.125.66.96', '20.125.66.80/28'), false);
  assert.equal(ipInCidr('20.125.66.79', '20.125.66.80/28'), false);
});

test('ipInCidr: /32 is an exact match and /0 matches everything', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4/32'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4/32'), false);
  assert.equal(ipInCidr('203.0.113.9', '0.0.0.0/0'), true);
});

test('ipInCidr: IPv6, including :: compression and an embedded IPv4 tail', () => {
  assert.equal(ipInCidr('2001:db8::1', '2001:db8::/32'), true);
  assert.equal(ipInCidr('2001:db9::1', '2001:db8::/32'), false);
  assert.equal(ipInCidr('2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::/64'), true);
  assert.equal(ipInCidr('::ffff:192.0.2.1', '::ffff:192.0.2.0/120'), true);
});

test('ipInCidr: family mismatch and malformed input are simply not inside', () => {
  assert.equal(ipInCidr('2001:db8::1', '20.171.206.0/24'), false);
  assert.equal(ipInCidr('20.171.206.1', '2001:db8::/32'), false);
  assert.equal(ipInCidr('20.171.206', '20.171.206.0/24'), false);
  assert.equal(ipInCidr('20.171.206.1', '20.171.206.0/33'), false);
  assert.equal(ipInCidr('20.171.206.1', 'garbage'), false);
  assert.equal(ipInCidr(undefined, '20.171.206.0/24'), false);
  assert.equal(ipInCidr('300.1.1.1', '0.0.0.0/0'), false);
});

test('ipInRanges: any matching prefix wins; empty or missing lists never match', () => {
  const cidrs = ['132.196.86.0/24', '20.125.66.80/28'];
  assert.equal(ipInRanges('132.196.86.7', cidrs), true);
  assert.equal(ipInRanges('20.125.66.90', cidrs), true);
  assert.equal(ipInRanges('8.8.8.8', cidrs), false);
  assert.equal(ipInRanges('8.8.8.8', []), false);
  assert.equal(ipInRanges('8.8.8.8', undefined), false);
});

// ---- verifyPublishedRange --------------------------------------------------

test('verifyPublishedRange: uses the cached list without fetching', async () => {
  const kv = fakeKv({ [OPENAI_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  await withFetch(() => { throw new Error('fetch must not be called'); }, async () => {
    assert.equal(await verifyPublishedRange('gptbot', '20.171.206.4', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyPublishedRange('oai-searchbot', '8.8.8.8', { REGISTRY_KV: kv }), false);
  });
  assert.equal(kv.puts.length, 0);
});

test('verifyPublishedRange: OpenAI fetches, merges and caches its three files on a cold cache', async () => {
  const kv = fakeKv();
  const requested = [];
  const stub = async (url) => {
    requested.push(url);
    if (url.endsWith('gptbot.json')) {
      return jsonResponse({ creationTime: 'x', prefixes: [{ ipv4Prefix: '20.171.206.0/24' }] });
    }
    if (url.endsWith('searchbot.json')) {
      return jsonResponse({ creationTime: 'x', prefixes: [{ ipv4Prefix: '135.234.64.0/24' }, { ipv4Prefix: '20.171.206.0/24' }] });
    }
    return jsonResponse({ creationTime: 'x', prefixes: [{ ipv4Prefix: '13.65.138.112/28' }, { ipv6Prefix: '2001:db8::/32' }] });
  };
  await withFetch(stub, async () => {
    assert.equal(await verifyPublishedRange('gptbot', '135.234.64.9', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyPublishedRange('chatgpt-user', '2001:db8::5', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyPublishedRange('gptbot', '9.9.9.9', { REGISTRY_KV: kv }), false);
  });
  assert.equal(requested.length, 3, 'each file fetched exactly once; later calls hit the cache');
  assert.deepEqual(requested.sort(), [
    'https://openai.com/chatgpt-user.json',
    'https://openai.com/gptbot.json',
    'https://openai.com/searchbot.json',
  ]);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, OPENAI_KEY);
  assert.equal(kv.puts[0].opts.expirationTtl, 86400);
  const stored = JSON.parse(kv.puts[0].value);
  assert.deepEqual(stored.cidrs, ['20.171.206.0/24', '135.234.64.0/24', '13.65.138.112/28', '2001:db8::/32']);
});

test('verifyPublishedRange: Ahrefs fetches its single file into its own KV key', async () => {
  const kv = fakeKv();
  const requested = [];
  const stub = async (url) => {
    requested.push(url);
    return jsonResponse({ prefixes: [{ ipv4Prefix: '5.39.1.224/27' }, { ipv4Prefix: '15.235.27.0/24' }] });
  };
  await withFetch(stub, async () => {
    assert.equal(await verifyPublishedRange('ahrefsbot', '15.235.27.40', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyPublishedRange('ahrefsbot', '5.39.1.250', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyPublishedRange('ahrefsbot', '5.39.2.1', { REGISTRY_KV: kv }), false);
  });
  assert.deepEqual(requested, ['https://api.ahrefs.com/v3/public/crawler-ip-ranges']);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, AHREFS_KEY);
});

test('verifyPublishedRange: providers do not share a cache', async () => {
  const kv = fakeKv({ [OPENAI_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  let fetched = 0;
  const stub = async () => { fetched++; return jsonResponse({ prefixes: [{ ipv4Prefix: '5.39.1.224/27' }] }); };
  await withFetch(stub, async () => {
    // An IP inside OpenAI's cached range is not inside Ahrefs' range.
    assert.equal(await verifyPublishedRange('ahrefsbot', '20.171.206.4', { REGISTRY_KV: kv }), false);
  });
  assert.equal(fetched, 1, 'Ahrefs had to fetch its own list');
});

test('verifyPublishedRange: null (never false) when a range file is unreachable, and the failure is cached briefly', async () => {
  const kv = fakeKv();
  let calls = 0;
  const stub = async () => { calls++; return new Response('nope', { status: 503 }); };
  await withFetch(stub, async () => {
    assert.equal(await verifyPublishedRange('gptbot', '20.171.206.4', { REGISTRY_KV: kv }), null);
    assert.equal(await verifyPublishedRange('gptbot', '20.171.206.4', { REGISTRY_KV: kv }), null);
  });
  assert.equal(calls, 3, 'the second visit did not refetch');
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, OPENAI_KEY);
  assert.equal(kv.puts[0].opts.expirationTtl, 3600);
  assert.equal(JSON.parse(kv.puts[0].value).unavailable, true);
});

test('verifyPublishedRange: null when fetch throws or the JSON has no prefixes', async () => {
  await withFetch(async () => { throw new Error('network down'); }, async () => {
    assert.equal(await verifyPublishedRange('gptbot', '20.171.206.4', { REGISTRY_KV: fakeKv() }), null);
  });
  await withFetch(async () => jsonResponse({ creationTime: 'x' }), async () => {
    assert.equal(await verifyPublishedRange('ahrefsbot', '5.39.1.230', { REGISTRY_KV: fakeKv() }), null);
  });
});

test('verifyPublishedRange: null when KV itself throws', async () => {
  const brokenKv = {
    async get() { throw new Error('kv down'); },
    async put() { throw new Error('kv down'); },
  };
  await withFetch(async () => { throw new Error('network down'); }, async () => {
    assert.equal(await verifyPublishedRange('gptbot', '20.171.206.4', { REGISTRY_KV: brokenKv }), null);
  });
});

test('verifyPublishedRange: null for a missing or unknown IP, and for an identity with no provider', async () => {
  const kv = fakeKv({ [OPENAI_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  assert.equal(await verifyPublishedRange('gptbot', 'unknown', { REGISTRY_KV: kv }), null);
  assert.equal(await verifyPublishedRange('gptbot', '', { REGISTRY_KV: kv }), null);
  assert.equal(await verifyPublishedRange('googlebot', '20.171.206.4', { REGISTRY_KV: kv }), null);
});

// ---- networkInfo for range-verified identities ----------------------------

test('networkInfo: range-verified identities take the range verdict, not the ASN pattern', () => {
  const azure = fakeRequest({ cf: { asn: 8075, asOrganization: 'Microsoft Corporation' } });
  assert.deepEqual(networkInfo(azure, 'gptbot', true), { asn: 8075, org: 'Microsoft Corporation', verified: true });
  assert.equal(networkInfo(azure, 'oai-searchbot', false).verified, false);
  assert.equal(networkInfo(azure, 'chatgpt-user', null).verified, null);
  assert.equal(networkInfo(azure, 'chatgpt-user', undefined).verified, null);
  const ovh = fakeRequest({ cf: { asn: 16276, asOrganization: 'OVH SAS' } });
  assert.equal(networkInfo(ovh, 'ahrefsbot', true).verified, true);
  assert.equal(networkInfo(ovh, 'ahrefsbot', undefined).verified, null);
});

test('networkInfo: a pattern-verified identity ignores the range argument', () => {
  const req = fakeRequest({ cf: { asn: 8075, asOrganization: 'Microsoft Corporation' } });
  assert.equal(networkInfo(req, 'bingbot', false).verified, true);
});

// ---- buildEntry ------------------------------------------------------------

test('buildEntry: canonical shape and key order for a passive visit', async () => {
  const req = fakeRequest({
    cf: { asn: 8075, asOrganization: 'Microsoft Corporation', httpProtocol: 'HTTP/2' },
    headers: { 'User-Agent': GPTBOT_UA, 'CF-Connecting-IP': '20.171.206.4', Accept: '*/*' },
  });
  const kv = fakeKv({ [OPENAI_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  const entry = await buildEntry(req, { REGISTRY_KV: kv }, 'gptbot', '/llms.txt');
  assert.deepEqual(Object.keys(entry), ['registry_id', 'identity', 'timestamp', 'trajectory', 'handshake']);
  assert.match(entry.registry_id, /^0x[0-9a-f]{6}$/);
  assert.equal(entry.identity, 'gptbot');
  assert.deepEqual(Object.keys(entry.trajectory), ['entry_path', 'protocol', 'header_weight_bytes']);
  assert.equal(entry.trajectory.entry_path, '/llms.txt');
  assert.equal(entry.trajectory.protocol, 'HTTP/2');
  assert.deepEqual(Object.keys(entry.handshake), ['accept_payload', 'client_hash', 'network_asn', 'network_org', 'network_verified']);
  assert.equal(entry.handshake.network_org, 'Microsoft Corporation');
  assert.equal(entry.handshake.network_verified, true);
  assert.match(entry.handshake.client_hash, /^[0-9a-f]{16}$/);
});

test('buildEntry: a range-verified visit from outside the published ranges is marked false', async () => {
  const kv = fakeKv({
    [OPENAI_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }),
    [AHREFS_KEY]: JSON.stringify({ cidrs: ['5.39.1.224/27'] }),
  });
  const gpt = fakeRequest({
    cf: { asn: 8075, asOrganization: 'Microsoft Corporation' },
    headers: { 'User-Agent': GPTBOT_UA, 'CF-Connecting-IP': '40.1.2.3' },
  });
  assert.equal((await buildEntry(gpt, { REGISTRY_KV: kv }, 'gptbot', '/')).handshake.network_verified, false);
  const ahrefs = fakeRequest({
    cf: { asn: 16276, asOrganization: 'OVH SAS' },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'CF-Connecting-IP': '5.39.1.230' },
  });
  assert.equal((await buildEntry(ahrefs, { REGISTRY_KV: kv }, 'ahrefsbot', '/')).handshake.network_verified, true);
});

test('buildEntry: cf_verified_bot appears only when Cloudflare populates it', async () => {
  const kv = fakeKv();
  const withFlag = fakeRequest({
    cf: { asn: 15169, asOrganization: 'Google LLC', botManagement: { verifiedBot: true } },
    headers: { 'User-Agent': 'Googlebot/2.1', 'CF-Connecting-IP': '66.249.66.1' },
  });
  const entry = await buildEntry(withFlag, { REGISTRY_KV: kv }, 'googlebot', '/');
  assert.equal(entry.handshake.cf_verified_bot, true);
  assert.equal(entry.handshake.network_verified, true);
  const without = fakeRequest({
    cf: { asn: 15169, asOrganization: 'Google LLC' },
    headers: { 'User-Agent': 'Googlebot/2.1' },
  });
  const plain = await buildEntry(without, { REGISTRY_KV: kv }, 'googlebot', '/');
  assert.equal('cf_verified_bot' in plain.handshake, false);
});

test('buildEntry: handshake extras are merged after the network fields', async () => {
  const req = fakeRequest({ cf: {}, headers: { 'User-Agent': 'curl/8.0' } });
  const entry = await buildEntry(req, { REGISTRY_KV: fakeKv() }, 'unknown-agent', '/api/register-handshake', {
    autonomous_signature: 'hello',
    verified_autonomous: true,
  });
  assert.deepEqual(Object.keys(entry.handshake).slice(-2), ['autonomous_signature', 'verified_autonomous']);
  assert.equal(entry.handshake.network_verified, null);
  assert.equal(entry.trajectory.protocol, 'unknown');
});
