// F48 round 4 (redesign) defense in depth: src/send.js's sendViaPrimitive
// must never again paper over missing/refused content with `?? null` — that
// is exactly what turned a swapped/deleted accepted artifact into a
// recorded-green 4-byte `null` shipped to the signed destination. These are
// unit tests of sendViaPrimitive alone (never through the full runner fold,
// which src/runner.js's own send-slot gate now halts before ever reaching
// this function) — the destination target resolves inside the repo
// (poc/m0/out, already used elsewhere as a test send target) but every
// scenario below refuses BEFORE any write, so nothing is ever written here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sendViaPrimitive } from '../src/send.js';

const TARGET = 'file:poc/m0/out';

test('sendViaPrimitive: refuses undefined content (missing/refused read) — writes nothing', async () => {
  const result = await sendViaPrimitive(TARGET, 'f48-r4-undefined-should-never-exist.json', undefined);
  assert.equal(result.ok, false);
  assert.match(result.red, /no content to send/);
});

test('sendViaPrimitive: refuses null content — writes nothing', async () => {
  const result = await sendViaPrimitive(TARGET, 'f48-r4-null-should-never-exist.json', null);
  assert.equal(result.ok, false);
  assert.match(result.red, /not an artifact object/);
});

test('sendViaPrimitive: refuses non-object content (string/number/array) — writes nothing', async () => {
  for (const bad of ['a string', 42, ['array']]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sendViaPrimitive(TARGET, 'f48-r4-nonobject-should-never-exist.json', bad);
    assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(bad)}`);
    assert.match(result.red, /not an artifact object/);
  }
});
