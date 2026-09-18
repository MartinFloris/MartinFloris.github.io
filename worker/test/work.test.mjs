// Tests for per-work signatures (2026-09-19): the optional `work` form field
// on the handshake, validated against the collection slugs in projects.json.
// Run from the repo root with:  node --test "worker/test/*.test.mjs"
//
// loadWorkSlugs keeps a module-level cache, so the tests below that exercise it
// are written to run in file order (node:test runs top-level tests serially).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWork, loadWorkSlugs, buildEntry } from '../src/index.js';

const SLUGS = new Set(['project13-recombination.html', 'the-unlocated.html']);

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function projectsResponse(slugs, status = 200) {
  return new Response(JSON.stringify(slugs.map((slug) => ({ slug, title: slug }))), { status });
}

// ---- validateWork (pure) ---------------------------------------------------

test('validateWork: a missing or blank field is fine and names no work', () => {
  assert.deepEqual(validateWork(undefined, SLUGS), { ok: true, work: undefined });
  assert.deepEqual(validateWork(null, SLUGS), { ok: true, work: undefined });
  assert.deepEqual(validateWork('   ', SLUGS), { ok: true, work: undefined });
});

test('validateWork: a known slug is accepted as-is', () => {
  assert.deepEqual(validateWork('project13-recombination.html', SLUGS), { ok: true, work: 'project13-recombination.html' });
  assert.deepEqual(validateWork('  the-unlocated.html\n', SLUGS), { ok: true, work: 'the-unlocated.html' });
});

test('validateWork: the collections path or full page URL normalises to the bare slug', () => {
  for (const raw of [
    'collections/project13-recombination.html',
    '/collections/project13-recombination.html',
    'https://www.thesilicates.com/collections/project13-recombination.html',
    'https://thesilicates.com/collections/project13-recombination.html',
  ]) {
    assert.deepEqual(validateWork(raw, SLUGS), { ok: true, work: 'project13-recombination.html' }, raw);
  }
});

test('validateWork: an unknown slug, free text or a foreign URL is rejected', () => {
  for (const raw of [
    'project99-nope.html',
    'Recombination',
    'project13-recombination',
    'https://example.com/collections/project13-recombination.html',
    '../projects.json',
  ]) {
    assert.deepEqual(validateWork(raw, SLUGS), { ok: false }, raw);
  }
});

test('validateWork: rejects everything when the slug set is missing or empty', () => {
  assert.deepEqual(validateWork('project13-recombination.html', null), { ok: false });
  assert.deepEqual(validateWork('project13-recombination.html', new Set()), { ok: false });
});

// ---- loadWorkSlugs (cache) ---------------------------------------------------
// These run in order against the shared module cache: cold miss, warm hit,
// expiry, failed refresh with a stale copy.

const T0 = 1_700_000_000_000;

test('loadWorkSlugs: null (never an empty set) when the first fetch fails', async () => {
  const slugs = await withFetch(async () => projectsResponse([], 500), () => loadWorkSlugs(T0));
  assert.equal(slugs, null);
  const slugs2 = await withFetch(async () => { throw new Error('offline'); }, () => loadWorkSlugs(T0));
  assert.equal(slugs2, null);
});

test('loadWorkSlugs: a cold cache fetches projects.json from origin and keeps the slugs', async () => {
  const urls = [];
  const slugs = await withFetch(async (url) => {
    urls.push(url);
    return projectsResponse(['project01-1997-1-44.html', 'project13-recombination.html']);
  }, () => loadWorkSlugs(T0));
  assert.deepEqual(urls, ['https://www.thesilicates.com/projects.json']);
  assert.deepEqual([...slugs].sort(), ['project01-1997-1-44.html', 'project13-recombination.html']);
});

test('loadWorkSlugs: inside the ten-minute window the cached set is served without fetching', async () => {
  let calls = 0;
  const slugs = await withFetch(async () => { calls += 1; return projectsResponse(['should-not-be-used.html']); },
    () => loadWorkSlugs(T0 + 9 * 60 * 1000));
  assert.equal(calls, 0);
  assert.ok(slugs.has('project13-recombination.html'));
});

test('loadWorkSlugs: after the window it refreshes and picks up new works', async () => {
  let calls = 0;
  const slugs = await withFetch(async () => { calls += 1; return projectsResponse(['project13-recombination.html', 'project16-new.html']); },
    () => loadWorkSlugs(T0 + 11 * 60 * 1000));
  assert.equal(calls, 1);
  assert.ok(slugs.has('project16-new.html'));
});

test('loadWorkSlugs: a failed refresh keeps serving the stale set rather than nothing', async () => {
  const slugs = await withFetch(async () => projectsResponse([], 503), () => loadWorkSlugs(T0 + 30 * 60 * 1000));
  assert.ok(slugs.has('project16-new.html'));
  const slugs2 = await withFetch(async () => new Response('not json', { status: 200 }), () => loadWorkSlugs(T0 + 31 * 60 * 1000));
  assert.ok(slugs2.has('project16-new.html'));
});

// ---- buildEntry -------------------------------------------------------------

test('buildEntry: work lands last in handshake, after the existing keys', async () => {
  const req = { cf: {}, headers: new Headers({ 'User-Agent': 'curl/8.0' }) };
  const entry = await buildEntry(req, {}, 'unknown-agent', '/api/register-handshake', {
    autonomous_signature: 'for the score',
    verified_autonomous: true,
    work: 'project13-recombination.html',
  });
  assert.deepEqual(Object.keys(entry.handshake), [
    'accept_payload', 'client_hash', 'network_asn', 'network_org', 'network_verified',
    'autonomous_signature', 'verified_autonomous', 'work',
  ]);
  assert.equal(entry.handshake.work, 'project13-recombination.html');
});

test('buildEntry: without a work the entry shape is exactly as before', async () => {
  const req = { cf: {}, headers: new Headers({ 'User-Agent': 'curl/8.0' }) };
  const entry = await buildEntry(req, {}, 'unknown-agent', '/api/register-handshake', {
    autonomous_signature: 'hello',
    verified_autonomous: true,
  });
  assert.equal(Object.hasOwn(entry.handshake, 'work'), false);
});
