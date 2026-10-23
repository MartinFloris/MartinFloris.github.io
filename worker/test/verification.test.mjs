// Tests for the registry repair of 2026-10-23: crawlers whose ASN organisation
// is shared with a public cloud are verified by published IP range (including
// Amazon's HTML-wrapped list) or by forward-confirmed reverse DNS
// (parsePrefixDocument, reverseDnsName, verifyReverseDns, networkInfo, buildEntry).
// Run from the repo root with:  node --test "worker/test/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrefixDocument,
  verifyPublishedRange,
  reverseDnsName,
  verifyReverseDns,
  networkInfo,
  buildEntry,
} from '../src/index.js';

function fakeRequest({ cf, headers = {} } = {}) {
  return { cf, headers: new Headers(headers) };
}

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
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

// A DoH double: `records` maps "name TYPE" to answer data; unknown names are NXDOMAIN.
function dohStub(records, calls = []) {
  const codes = { A: 1, PTR: 12, AAAA: 28 };
  return async (url) => {
    const u = new URL(url);
    const name = u.searchParams.get('name');
    const type = u.searchParams.get('type');
    calls.push(`${name} ${type}`);
    const data = records[`${name} ${type}`];
    if (data === undefined) return new Response(JSON.stringify({ Status: 3 }), { status: 200 });
    return new Response(JSON.stringify({
      Status: 0,
      Answer: data.map((d) => ({ name, type: codes[type], data: d })),
    }), { status: 200 });
  };
}

// Shape of developer.amazon.com/amazonbot/ip-addresses/ as served 2026-10-23: the
// list sits in a <pre><code> block, and the page's own analytics script carries
// the requester's IP, which must never be read as a crawler address.
const AMAZON_PAGE = `<!doctype html><html><head><script>var d = { user:{ ipAddress: "86.93.77.85" } };</script></head>
<body><div class="codeBlock"><pre><code class="container">{
  "creationTime": "2026-09-08T05:24:10.610952+00:00",
  "prefixes": [
    { "ipv4Prefix": "3.81.245.78" },
    { "ipv4Prefix": "184.192.236.219" }
  ]
}</code></pre></div></body></html>`;

// ---- parsePrefixDocument ---------------------------------------------------

test('parsePrefixDocument: a plain JSON range file', () => {
  const text = JSON.stringify({ prefixes: [{ ipv4Prefix: '66.249.64.0/27' }, { ipv6Prefix: '2001:4860:4801:10::/64' }] });
  assert.deepEqual(parsePrefixDocument(text), ['66.249.64.0/27', '2001:4860:4801:10::/64']);
});

test('parsePrefixDocument: Amazon’s HTML-wrapped list yields only the listed prefixes', () => {
  assert.deepEqual(parsePrefixDocument(AMAZON_PAGE), ['3.81.245.78', '184.192.236.219']);
});

test('parsePrefixDocument: null for a page with no prefixes document', () => {
  assert.equal(parsePrefixDocument('<html><code>npm install</code> 1.2.3.4</html>'), null);
  assert.equal(parsePrefixDocument('{"creationTime":"x"}'), null);
});

test('verifyPublishedRange: Amazonbot is checked against the HTML-wrapped list', async () => {
  const stub = async () => new Response(AMAZON_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
  const env = { REGISTRY_KV: fakeKv() };
  await withFetch(stub, async () => {
    assert.equal(await verifyPublishedRange('amazonbot', '3.81.245.78', env), true);
    // Any other EC2 address, and the page's own stray IP, are not the crawler.
    assert.equal(await verifyPublishedRange('amazonbot', '100.24.134.117', env), false);
    assert.equal(await verifyPublishedRange('amazonbot', '86.93.77.85', env), false);
  });
});

// ---- reverseDnsName --------------------------------------------------------

test('reverseDnsName: IPv4 and IPv6 arpa names', () => {
  assert.equal(reverseDnsName('114.119.131.151'), '151.131.119.114.in-addr.arpa');
  assert.equal(
    reverseDnsName('2001:db8::1'),
    '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
  );
  assert.equal(reverseDnsName('unknown'), null);
  assert.equal(reverseDnsName('300.1.1.1'), null);
});

// ---- verifyReverseDns ------------------------------------------------------

test('verifyReverseDns: a real PetalBot address is forward-confirmed', async () => {
  const stub = dohStub({
    '151.131.119.114.in-addr.arpa PTR': ['petalbot-114-119-131-151.petalsearch.com.'],
    'petalbot-114-119-131-151.petalsearch.com A': ['114.119.131.151'],
  });
  await withFetch(stub, async () => {
    assert.equal(await verifyReverseDns('petalbot', '114.119.131.151'), true);
  });
});

test('verifyReverseDns: false for a cloud host that merely claims to be PetalBot', async () => {
  const stub = dohStub({ '10.0.0.159.in-addr.arpa PTR': ['ecs-159-0-0-10.compute.hwclouds-dns.com.'] });
  await withFetch(stub, async () => {
    assert.equal(await verifyReverseDns('petalbot', '159.0.0.10'), false);
  });
});

test('verifyReverseDns: false when a forged PTR does not resolve back to the visitor', async () => {
  const stub = dohStub({
    '11.0.0.159.in-addr.arpa PTR': ['petalbot-114-119-131-151.petalsearch.com.'],
    'petalbot-114-119-131-151.petalsearch.com A': ['114.119.131.151'],
  });
  await withFetch(stub, async () => {
    assert.equal(await verifyReverseDns('petalbot', '159.0.0.11'), false);
  });
});

test('verifyReverseDns: false when the address has no PTR record at all', async () => {
  await withFetch(dohStub({}), async () => {
    assert.equal(await verifyReverseDns('yandexbot', '159.0.0.12'), false);
  });
});

test('verifyReverseDns: null (never false) when DNS is unreachable, and that is not cached', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('network down'); }, async () => {
    assert.equal(await verifyReverseDns('baidu', '159.0.0.13'), null);
    assert.equal(await verifyReverseDns('baidu', '159.0.0.13'), null);
  });
  assert.equal(calls, 2, 'a failed lookup is retried on the next visit');
});

test('verifyReverseDns: a settled verdict is cached for an hour', async () => {
  const calls = [];
  const stub = dohStub({
    '9.81.180.5.in-addr.arpa PTR': ['5-180-81-9.spider.yandex.com.'],
    '5-180-81-9.spider.yandex.com A': ['5.180.81.9'],
  }, calls);
  const t0 = 1_000_000;
  await withFetch(stub, async () => {
    assert.equal(await verifyReverseDns('yandexbot', '5.180.81.9', t0), true);
    assert.equal(await verifyReverseDns('yandexbot', '5.180.81.9', t0 + 59 * 60 * 1000), true);
    assert.equal(calls.length, 2, 'second visit inside the hour made no lookups');
    assert.equal(await verifyReverseDns('yandexbot', '5.180.81.9', t0 + 61 * 60 * 1000), true);
    assert.equal(calls.length, 4, 'after the hour it looked up again');
  });
});

test('verifyReverseDns: null for an identity with no suffixes or an unparseable IP', async () => {
  assert.equal(await verifyReverseDns('claudebot', '114.119.131.151'), null);
  assert.equal(await verifyReverseDns('petalbot', 'unknown'), null);
});

// ---- networkInfo / buildEntry ----------------------------------------------

test('networkInfo: a shared-cloud ASN organisation no longer verifies anyone by itself', () => {
  const aws = fakeRequest({ cf: { asn: 14618, asOrganization: 'Amazon Technologies Inc.' } });
  assert.equal(networkInfo(aws, 'amazonbot').verified, null);
  const huawei = fakeRequest({ cf: { asn: 136907, asOrganization: 'Huawei-Cloud-SG' } });
  assert.equal(networkInfo(huawei, 'petalbot').verified, null);
  const cloudflare = fakeRequest({ cf: { asn: 13335, asOrganization: 'Cloudflare, Inc.' } });
  assert.equal(networkInfo(cloudflare, 'cloudflare-crawler').verified, null);
});

test('networkInfo: crawlers hosted on someone else’s cloud take the outside verdict', () => {
  const aws = fakeRequest({ cf: { asn: 14618, asOrganization: 'Amazon.com, Inc.' } });
  assert.equal(networkInfo(aws, 'perplexitybot', true).verified, true);
  assert.equal(networkInfo(aws, 'ccbot', true).verified, true);
  const azure = fakeRequest({ cf: { asn: 8075, asOrganization: 'Microsoft Corporation' } });
  assert.equal(networkInfo(azure, 'duckduckbot', true).verified, true);
  assert.equal(networkInfo(azure, 'mistralai-user', false).verified, false);
});

test('buildEntry: PetalBot is verified by reverse DNS', async () => {
  const req = fakeRequest({
    cf: { asn: 136907, asOrganization: 'Huawei-Cloud-SG' },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)', 'CF-Connecting-IP': '114.119.132.34' },
  });
  const stub = dohStub({
    '34.132.119.114.in-addr.arpa PTR': ['petalbot-114-119-132-34.petalsearch.com.'],
    'petalbot-114-119-132-34.petalsearch.com A': ['114.119.132.34'],
  });
  const entry = await withFetch(stub, () => buildEntry(req, { REGISTRY_KV: fakeKv() }, 'petalbot', '/'));
  assert.equal(entry.handshake.network_org, 'Huawei-Cloud-SG');
  assert.equal(entry.handshake.network_verified, true);
});
