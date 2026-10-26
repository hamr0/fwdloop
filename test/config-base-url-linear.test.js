// borrowed-from: bareloop tests/config-providers.test.js@v0.48.0 (ed3a110), adjusted: also covers resolveSlot's stored address.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanBaseUrl } from '../src/config.js';
import { resolveSlot } from '../src/provider.js';

const BOUND_MS = 100;
const mid = `https://x.example${'/'.repeat(20000)}v1`;

test('cleanBaseUrl: 20000 slashes inside a Base URL is linear (the trailing-slash regex was quadratic), and only trailing slashes are dropped', () => {
  const t0 = performance.now();
  assert.equal(cleanBaseUrl(mid), mid);
  assert.equal(cleanBaseUrl(`${mid}${'/'.repeat(20000)}`), mid);
  const ms = performance.now() - t0;
  assert.ok(ms < BOUND_MS, `took ${ms} ms`);
});

test('cleanBaseUrl: normal inputs come out as the old regex gave them', () => {
  for (const v of ['https://x/v1/', 'https://x/v1//', 'https://x/v1', 'https://x/', '', '/', '///', 'a//b//']) {
    assert.equal(cleanBaseUrl(v), v.replace(/\/+$/, ''), JSON.stringify(v));
  }
});

test('resolveSlot: the stored address is trimmed linearly too, same result as before for a normal one', () => {
  const at = (u) => resolveSlot('DEEPSEEK_API_KEY', { config: { providers: { DEEPSEEK_API_KEY: { baseUrl: u } } } }).baseUrl;
  assert.equal(at('https://x/v1/'), 'https://x/v1');
  const t0 = performance.now();
  assert.equal(at(mid), mid);
  assert.equal(at(`${mid}${'/'.repeat(20000)}`), mid);
  const ms = performance.now() - t0;
  assert.ok(ms < BOUND_MS, `took ${ms} ms`);
});
