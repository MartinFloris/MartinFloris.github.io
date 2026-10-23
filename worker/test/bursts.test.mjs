// Tests for bursts (a run of requests from one address folds into one registry
// row) and the one-off fold of the 2026-10-22/23 scanner run: mergeVisit,
// findBurstRow, publicEntry, FOLDS/matchesFold and RegistryStore.
// Run from the repo root with:  node --test "worker/test/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVisit, findBurstRow, publicEntry, FOLDS, matchesFold, RegistryStore } from '../src/index.js';

const SCANNER = FOLDS.find((f) => f.id === '2026-10-23-gcp-scanner');
const MIN = 60 * 1000;

// A Durable Object storage double: sorted list({ prefix }), and put/delete that
// accept a single key or a batch of at most 128, like the real API.
function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async put(keyOrEntries, value) {
      if (typeof keyOrEntries === 'string') {
        store.set(keyOrEntries, structuredClone(value));
        return;
      }
      const entries = Object.entries(keyOrEntries);
      if (entries.length > 128) throw new Error('put: more than 128 keys');
      for (const [k, v] of entries) store.set(k, structuredClone(v));
    },
    async delete(keyOrKeys) {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      if (keys.length > 128) throw new Error('delete: more than 128 keys');
      for (const k of keys) store.delete(k);
    },
    async list({ prefix = '' } = {}) {
      return new Map([...store].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)));
    },
  };
}

function visit(identity, timestamp, { path = '/', status = 200, asn = 396982, verified = false, id = '0x000001' } = {}) {
  return {
    registry_id: id,
    identity,
    timestamp,
    trajectory: { entry_path: path, protocol: 'HTTP/2', header_weight_bytes: 500, status },
    handshake: { accept_payload: '*/*', client_hash: 'abc', network_asn: asn, network_org: 'Google LLC', network_verified: verified },
  };
}

async function append(store, entry, burstKey, at) {
  const realNow = Date.now;
  Date.now = () => at;
  try {
    await store.fetch(new Request('https://registry-store/append', {
      method: 'POST',
      body: JSON.stringify({ entry, burst_key: burstKey }),
    }));
  } finally {
    Date.now = realNow;
  }
}

async function recent(store) {
  const res = await store.fetch(new Request('https://registry-store/recent'));
  return res.json();
}

// ---- mergeVisit ------------------------------------------------------------

test('mergeVisit: a second request turns a row into a burst', () => {
  const row = visit('claudebot', '2026-10-23T08:41:24.000Z', { path: '/.env', status: 404, id: '0xaaaaaa' });
  const merged = mergeVisit(row, visit('gptbot', '2026-10-23T08:41:25.000Z', { path: '/.ssh/id_rsa', status: 404, id: '0xbbbbbb' }));
  assert.equal(merged.registry_id, '0xaaaaaa', 'the row keeps its first registry_id');
  assert.equal(merged.identity, 'claudebot');
  assert.equal(merged.timestamp, '2026-10-23T08:41:25.000Z', 'timestamp is the latest request');
  assert.equal(merged.trajectory.entry_path, '/.env');
  assert.deepEqual(merged.burst, {
    count: 2,
    first_seen: '2026-10-23T08:41:24.000Z',
    identities: ['claudebot', 'gptbot'],
    sample_paths: ['/.env', '/.ssh/id_rsa'],
    statuses: { 404: 2 },
  });
  assert.deepEqual(Object.keys(merged), ['registry_id', 'identity', 'timestamp', 'trajectory', 'handshake', 'burst']);
});

test('mergeVisit: counts every request but keeps names and paths distinct and capped', () => {
  let row = visit('googlebot', '2026-10-23T08:00:00.000Z', { path: '/p0' });
  for (let i = 1; i < 40; i++) {
    row = mergeVisit(row, visit(`bot${i % 25}`, `2026-10-23T08:00:${String(i).padStart(2, '0')}.000Z`, { path: `/p${i % 12}`, status: i % 2 ? 404 : 200 }));
  }
  assert.equal(row.burst.count, 40);
  assert.equal(row.burst.identities.length, 20);
  assert.deepEqual(row.burst.sample_paths, ['/p0', '/p1', '/p2', '/p3', '/p4', '/p5', '/p6', '/p7']);
  assert.deepEqual(row.burst.statuses, { 200: 20, 404: 20 });
});

test('mergeVisit: the row is verified only if every request checked out', () => {
  const t = '2026-10-23T08:00:00.000Z';
  const v = (verified) => visit('googlebot', t, { verified });
  assert.equal(mergeVisit(v(true), v(true)).handshake.network_verified, true);
  assert.equal(mergeVisit(v(true), v(false)).handshake.network_verified, false);
  assert.equal(mergeVisit(v(false), v(true)).handshake.network_verified, false);
  assert.equal(mergeVisit(v(true), v(null)).handshake.network_verified, null);
});

// ---- findBurstRow / publicEntry --------------------------------------------

test('findBurstRow: the newest row for this address while it is still active', () => {
  const now = Date.parse('2026-10-23T09:00:00.000Z');
  const all = new Map([
    ['e:1', { ...visit('a', '2026-10-23T08:50:00.000Z'), _burst_key: 'k1' }],
    ['e:2', { ...visit('b', '2026-10-23T08:55:00.000Z'), _burst_key: 'k2' }],
    ['e:3', visit('agent-in-browser', '2026-10-23T08:58:00.000Z')],
  ]);
  assert.equal(findBurstRow(all, 'k1', now).key, 'e:1');
  assert.equal(findBurstRow(all, 'k2', now).key, 'e:2');
  assert.equal(findBurstRow(all, 'k3', now), null);
  assert.equal(findBurstRow(all, 'k1', now + 6 * MIN), null, 'more than 15 minutes idle starts a new row');
});

test('publicEntry: store-private fields never leave the store', () => {
  const entry = { ...visit('a', '2026-10-23T08:50:00.000Z'), _burst_key: 'k1', _fold: 'x' };
  assert.deepEqual(Object.keys(publicEntry(entry)), ['registry_id', 'identity', 'timestamp', 'trajectory', 'handshake']);
});

// ---- RegistryStore: bursts --------------------------------------------------

test('RegistryStore: requests from one address fold into one row that moves to the top', async () => {
  const storage = fakeStorage({ 'fold-done:2026-10-23-gcp-scanner': { folded: 0 } });
  const store = new RegistryStore({ storage });
  const t0 = Date.parse('2026-10-23T10:00:00.000Z');
  await append(store, visit('claudebot', '2026-10-23T10:00:00.000Z', { path: '/.env', status: 404 }), 'scanner', t0);
  await append(store, visit('googlebot', '2026-10-23T10:00:01.000Z', { asn: 15169, verified: true }), 'google', t0 + 1000);
  await append(store, visit('gptbot', '2026-10-23T10:00:02.000Z', { path: '/.aws/credentials', status: 404 }), 'scanner', t0 + 2000);
  // A handshake row (no burst key) neither joins nor is joined.
  await append(store, visit('agent-in-browser', '2026-10-23T10:00:03.000Z'), undefined, t0 + 3000);

  const rows = await recent(store);
  assert.deepEqual(rows.map((r) => r.identity), ['googlebot', 'claudebot', 'agent-in-browser']);
  assert.equal(rows[1].burst.count, 2);
  assert.deepEqual(rows[1].burst.identities, ['claudebot', 'gptbot']);
  assert.ok(rows.every((r) => !('_burst_key' in r)), 'the address hash is never served');
  assert.equal([...storage.store.keys()].filter((k) => k.startsWith('e:')).length, 3);
});

test('RegistryStore: after 15 idle minutes the same address starts a new row', async () => {
  const storage = fakeStorage({ 'fold-done:2026-10-23-gcp-scanner': { folded: 0 } });
  const store = new RegistryStore({ storage });
  const t0 = Date.parse('2026-10-23T10:00:00.000Z');
  await append(store, visit('petalbot', '2026-10-23T10:00:00.000Z'), 'k', t0);
  await append(store, visit('petalbot', '2026-10-23T10:14:00.000Z'), 'k', t0 + 14 * MIN);
  await append(store, visit('petalbot', '2026-10-23T10:30:00.000Z'), 'k', t0 + 30 * MIN);
  const rows = await recent(store);
  assert.deepEqual(rows.map((r) => r.burst?.count ?? 1), [2, 1]);
});

// ---- RegistryStore: the scanner fold ---------------------------------------

function scannerLog() {
  const initial = {
    'e:00001761145000000:a': visit('googlebot', '2026-10-22T15:03:20.000Z', { asn: 15169, verified: true }),
    'e:00001761145100000:b': visit('unknown-agent', '2026-10-22T16:31:43.829Z'),
    'e:00001761209000000:z': visit('petalbot', '2026-10-23T08:43:20.000Z', { asn: 136907, verified: true }),
  };
  // 300 scanner rows (more than two storage batches), old shape: no status.
  for (let i = 0; i < 300; i++) {
    const e = visit(i % 2 ? 'claudebot' : 'gptbot', `2026-10-23T08:${String(10 + Math.floor(i / 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`, { path: `/probe${i}` });
    delete e.trajectory.status;
    initial[`e:00001761200000${String(i).padStart(3, '0')}:s${i}`] = e;
  }
  return initial;
}

test('matchesFold: only crawler-UA entries from the scanner network inside the window', () => {
  assert.equal(matchesFold(visit('claudebot', '2026-10-23T08:41:24.000Z'), SCANNER), true);
  assert.equal(matchesFold(visit('googlebot', '2026-10-23T05:14:29.000Z', { asn: 15169 }), SCANNER), false);
  assert.equal(matchesFold(visit('unknown-agent', '2026-10-22T20:26:36.469Z'), SCANNER), false);
  assert.equal(matchesFold(visit('claudebot', '2026-10-23T09:00:00.000Z'), SCANNER), false);
  assert.equal(matchesFold(visit('claudebot', '2026-10-22T14:59:59.999Z'), SCANNER), false);
  assert.equal(matchesFold({ identity: 'claudebot' }, SCANNER), false);
});

test('RegistryStore: the scanner run folds into one row, once, with the originals archived', async () => {
  const storage = fakeStorage(scannerLog());
  const rows = await recent(new RegistryStore({ storage }));
  assert.deepEqual(rows.map((r) => r.identity), ['googlebot', 'unknown-agent', 'gptbot', 'petalbot']);
  const folded = rows[2];
  assert.equal(folded.burst.count, 300);
  assert.deepEqual(folded.burst.identities, ['gptbot', 'claudebot']);
  assert.equal(folded.burst.first_seen, '2026-10-23T08:10:00.000Z');
  assert.equal(folded.timestamp, '2026-10-23T08:39:59.000Z');
  assert.equal(folded.handshake.network_verified, false);
  assert.ok(!('_fold' in folded));
  assert.equal([...storage.store.keys()].filter((k) => k.startsWith(`folded:${SCANNER.id}:e:`)).length, 300);
  assert.equal(storage.store.get(`fold-done:${SCANNER.id}`).folded, 300);

  // A fresh instance sees the marker and leaves the log alone.
  await recent(new RegistryStore({ storage }));
  assert.equal([...storage.store.keys()].filter((k) => k.startsWith('e:')).length, 4);
});

test('RegistryStore: an interrupted fold finishes on the next request without double counting', async () => {
  const storage = fakeStorage(scannerLog());
  const realDelete = storage.delete;
  let deletes = 0;
  storage.delete = async (keys) => {
    if (++deletes === 2) throw new Error('storage hiccup'); // after the first batch of 128
    return realDelete(keys);
  };
  await assert.rejects(recent(new RegistryStore({ storage })));
  assert.equal(storage.store.get(`fold-done:${SCANNER.id}`), undefined);
  storage.delete = realDelete;

  const rows = await recent(new RegistryStore({ storage }));
  assert.equal(rows.length, 4);
  assert.equal(rows[2].burst.count, 300);
});
