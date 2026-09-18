// Unit tests for the pure parts of the registry Worker.
// Run from the repo root with:  node --test "worker/test/*.test.mjs"
// No package.json, no installs: node:test, node:assert and WebCrypto are built in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIdentity,
  networkInfo,
  runPipeline,
  hmacSign,
  timingSafeEqualHex,
  makeChallenge,
} from '../src/index.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const GPTBOT_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fakeRequest({ cf, headers = {} } = {}) {
  return { cf, headers: new Headers(headers) };
}

// ---- classifyIdentity ------------------------------------------------------

test('classifyIdentity: a real browser UA is not logged (null)', () => {
  assert.equal(classifyIdentity(BROWSER_UA), null);
});

test('classifyIdentity: curl is an unknown-agent', () => {
  assert.equal(classifyIdentity('curl/8.0'), 'unknown-agent');
});

test('classifyIdentity: an empty UA is an unknown-agent', () => {
  assert.equal(classifyIdentity(''), 'unknown-agent');
});

test('classifyIdentity: GPTBot is recognised even with a Mozilla prefix', () => {
  assert.equal(classifyIdentity(GPTBOT_UA), 'gptbot');
});

test('classifyIdentity: ClaudeBot is recognised', () => {
  assert.equal(classifyIdentity('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'), 'claudebot');
});

// ---- networkInfo -----------------------------------------------------------

test('networkInfo: verified true when the ASN org matches the expected pattern', () => {
  const req = fakeRequest({ cf: { asn: 396982, asOrganization: 'Google LLC' } });
  assert.deepEqual(networkInfo(req, 'googlebot'), { asn: 396982, org: 'Google LLC', verified: true });
});

test('networkInfo: verified false when the ASN org does not match', () => {
  const req = fakeRequest({ cf: { asn: 16509, asOrganization: 'Amazon.com, Inc.' } });
  assert.equal(networkInfo(req, 'googlebot').verified, false);
});

test('networkInfo: verified null when there is no expectation for the identity', () => {
  const req = fakeRequest({ cf: { asn: 16509, asOrganization: 'Amazon.com, Inc.' } });
  assert.equal(networkInfo(req, 'unknown-agent').verified, null);
});

test('networkInfo: verified null when Cloudflare gave no ASN organisation', () => {
  const req = fakeRequest({ cf: {} });
  assert.deepEqual(networkInfo(req, 'googlebot'), { asn: null, org: null, verified: null });
});

test('networkInfo: verified null when request.cf is absent entirely', () => {
  assert.equal(networkInfo(fakeRequest(), 'googlebot').verified, null);
});

// ---- runPipeline -----------------------------------------------------------

test('runPipeline: sha256-hex alone matches a WebCrypto vector', async () => {
  const input = 'the-silicates:0123456789abcdef01234567';
  assert.equal(await runPipeline(['sha256-hex'], input), await sha256Hex(input));
});

test('runPipeline: reverse then sha256-hex', async () => {
  const input = 'the-silicates:abc';
  const expected = await sha256Hex('cba:setacilis-eht');
  assert.equal(await runPipeline(['reverse', 'sha256-hex'], input), expected);
});

test('runPipeline: rot13 then reverse then sha256-hex', async () => {
  const input = 'the-silicates:abc';
  // rot13('the-silicates:abc') = 'gur-fvyvpngrf:nop', reversed = 'pon:frgnpvyvf-rug'
  const expected = await sha256Hex('pon:frgnpvyvf-rug');
  assert.equal(await runPipeline(['rot13', 'reverse', 'sha256-hex'], input), expected);
});

test('runPipeline: rejects an unknown op', async () => {
  await assert.rejects(() => runPipeline(['md5'], 'x'), /unknown op: md5/);
});

// ---- hmacSign / timingSafeEqualHex ----------------------------------------

test('hmacSign: deterministic for the same secret and text, 64 lowercase hex', async () => {
  const a = await hmacSign('secret', 'text');
  const b = await hmacSign('secret', 'text');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('hmacSign: changes with the secret', async () => {
  assert.notEqual(await hmacSign('secret-1', 'text'), await hmacSign('secret-2', 'text'));
});

test('timingSafeEqualHex: equal strings compare true', () => {
  assert.equal(timingSafeEqualHex('abcd', 'abcd'), true);
});

test('timingSafeEqualHex: rejects a length mismatch and non-strings', () => {
  assert.equal(timingSafeEqualHex('abcd', 'abc'), false);
  assert.equal(timingSafeEqualHex('abcd', 'abce'), false);
  assert.equal(timingSafeEqualHex(undefined, 'abcd'), false);
  assert.equal(timingSafeEqualHex('abcd', 1234), false);
});

// ---- makeChallenge ---------------------------------------------------------

test('makeChallenge: always ends in sha256-hex with 1 or 2 transforms before it', () => {
  for (let i = 0; i < 50; i++) {
    const c = makeChallenge();
    assert.equal(c.v, 1);
    assert.match(c.nonce, /^[0-9a-f]{24}$/);
    assert.equal(typeof c.issued_at, 'number');
    assert.equal(c.ops[c.ops.length - 1], 'sha256-hex');
    const transforms = c.ops.slice(0, -1);
    assert.ok(transforms.length === 1 || transforms.length === 2, `got ${c.ops}`);
    for (const t of transforms) assert.ok(['reverse', 'rot13'].includes(t));
    assert.equal(c.input, `the-silicates:${c.nonce}`);
    // Key order is part of the signed contract.
    assert.deepEqual(Object.keys(c), ['v', 'nonce', 'issued_at', 'ops', 'input']);
  }
});
