// Tests for the two registry repairs of 2026-09-18: logging unknown agents only
// on real pages (shouldLog) and verifying OpenAI's crawlers by published IP
// range (ipInCidr, verifyOpenAIRange, networkInfo, buildEntry).
// Run from the repo root with:  node --test "worker/test/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldLog,
  ipInCidr,
  ipInRanges,
  verifyOpenAIRange,
  networkInfo,
  buildEntry,
} from '../src/index.js';

const GPTBOT_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const RANGES_KEY = 'openai-ranges:v1';

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

// ---- verifyOpenAIRange -----------------------------------------------------

test('verifyOpenAIRange: uses the cached list without fetching', async () => {
  const kv = fakeKv({ [RANGES_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  await withFetch(() => { throw new Error('fetch must not be called'); }, async () => {
    assert.equal(await verifyOpenAIRange('20.171.206.4', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyOpenAIRange('8.8.8.8', { REGISTRY_KV: kv }), false);
  });
  assert.equal(kv.puts.length, 0);
});

test('verifyOpenAIRange: fetches, merges and caches the three files on a cold cache', async () => {
  const kv = fakeKv();
  const requested = [];
  const stub = async (url) => {
    requested.push(url);
    let body;
    if (url.endsWith('gptbot.json')) {
      body = { creationTime: 'x', prefixes: [{ ipv4Prefix: '20.171.206.0/24' }] };
    } else if (url.endsWith('searchbot.json')) {
      body = { creationTime: 'x', prefixes: [{ ipv4Prefix: '135.234.64.0/24' }, { ipv4Prefix: '20.171.206.0/24' }] };
    } else {
      body = { creationTime: 'x', prefixes: [{ ipv4Prefix: '13.65.138.112/28' }, { ipv6Prefix: '2001:db8::/32' }] };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
  await withFetch(stub, async () => {
    assert.equal(await verifyOpenAIRange('135.234.64.9', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyOpenAIRange('2001:db8::5', { REGISTRY_KV: kv }), true);
    assert.equal(await verifyOpenAIRange('9.9.9.9', { REGISTRY_KV: kv }), false);
  });
  assert.equal(requested.length, 3, 'each file fetched exactly once; later calls hit the cache');
  assert.deepEqual(requested.sort(), [
    'https://openai.com/chatgpt-user.json',
    'https://openai.com/gptbot.json',
    'https://openai.com/searchbot.json',
  ]);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, RANGES_KEY);
  assert.equal(kv.puts[0].opts.expirationTtl, 86400);
  const stored = JSON.parse(kv.puts[0].value);
  assert.deepEqual(stored.cidrs, ['20.171.206.0/24', '135.234.64.0/24', '13.65.138.112/28', '2001:db8::/32']);
});

test('verifyOpenAIRange: null (never false) when a range file is unreachable, and the failure is cached briefly', async () => {
  const kv = fakeKv();
  let calls = 0;
  const stub = async () => { calls++; return new Response('nope', { status: 503 }); };
  await withFetch(stub, async () => {
    assert.equal(await verifyOpenAIRange('20.171.206.4', { REGISTRY_KV: kv }), null);
    assert.equal(await verifyOpenAIRange('20.171.206.4', { REGISTRY_KV: kv }), null);
  });
  assert.equal(calls, 3, 'the second visit did not refetch');
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].opts.expirationTtl, 3600);
  assert.equal(JSON.parse(kv.puts[0].value).unavailable, true);
});

test('verifyOpenAIRange: null when fetch throws or the JSON has no prefixes', async () => {
  await withFetch(async () => { throw new Error('network down'); }, async () => {
    assert.equal(await verifyOpenAIRange('20.171.206.4', { REGISTRY_KV: fakeKv() }), null);
  });
  await withFetch(async () => new Response('{"creationTime":"x"}', { status: 200 }), async () => {
    assert.equal(await verifyOpenAIRange('20.171.206.4', { REGISTRY_KV: fakeKv() }), null);
  });
});

test('verifyOpenAIRange: null when KV itself throws', async () => {
  const brokenKv = {
    async get() { throw new Error('kv down'); },
    async put() { throw new Error('kv down'); },
  };
  await withFetch(async () => { throw new Error('network down'); }, async () => {
    assert.equal(await verifyOpenAIRange('20.171.206.4', { REGISTRY_KV: brokenKv }), null);
  });
});

test('verifyOpenAIRange: null for a missing or unknown IP', async () => {
  const kv = fakeKv({ [RANGES_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  assert.equal(await verifyOpenAIRange('unknown', { REGISTRY_KV: kv }), null);
  assert.equal(await verifyOpenAIRange('', { REGISTRY_KV: kv }), null);
});

// ---- networkInfo for OpenAI identities ------------------------------------

test('networkInfo: OpenAI identities take the range verdict, not the ASN pattern', () => {
  const req = fakeRequest({ cf: { asn: 8075, asOrganization: 'Microsoft Corporation' } });
  assert.deepEqual(networkInfo(req, 'gptbot', true), { asn: 8075, org: 'Microsoft Corporation', verified: true });
  assert.equal(networkInfo(req, 'oai-searchbot', false).verified, false);
  assert.equal(networkInfo(req, 'chatgpt-user', null).verified, null);
  assert.equal(networkInfo(req, 'chatgpt-user', undefined).verified, null);
});

test('networkInfo: a non-OpenAI identity ignores the range argument', () => {
  const req = fakeRequest({ cf: { asn: 8075, asOrganization: 'Microsoft Corporation' } });
  assert.equal(networkInfo(req, 'bingbot', false).verified, true);
});

// ---- buildEntry ------------------------------------------------------------

test('buildEntry: canonical shape and key order for a passive visit', async () => {
  const req = fakeRequest({
    cf: { asn: 8075, asOrganization: 'Microsoft Corporation', httpProtocol: 'HTTP/2' },
    headers: { 'User-Agent': GPTBOT_UA, 'CF-Connecting-IP': '20.171.206.4', Accept: '*/*' },
  });
  const kv = fakeKv({ [RANGES_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
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

test('buildEntry: an OpenAI visit from outside the published ranges is marked false', async () => {
  const req = fakeRequest({
    cf: { asn: 8075, asOrganization: 'Microsoft Corporation' },
    headers: { 'User-Agent': GPTBOT_UA, 'CF-Connecting-IP': '40.1.2.3' },
  });
  const kv = fakeKv({ [RANGES_KEY]: JSON.stringify({ cidrs: ['20.171.206.0/24'] }) });
  const entry = await buildEntry(req, { REGISTRY_KV: kv }, 'gptbot', '/');
  assert.equal(entry.handshake.network_verified, false);
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
