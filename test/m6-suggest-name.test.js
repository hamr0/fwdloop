// M6 am5 item 2: a changed job is a new workflow named `<name>-N`, the next free number; a trailing -N of the old name is stripped first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { suggestFlowName } from '../src/flow.js';

const root = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-suggest-'));

test('suggestFlowName: the first free -N from 2, never an existing entry (folder or file)', () => {
  const r = root();
  mkdirSync(path.join(r, 'aging'));
  assert.equal(suggestFlowName(r, 'aging'), 'aging-2');
  mkdirSync(path.join(r, 'aging-2'));
  assert.equal(suggestFlowName(r, 'aging'), 'aging-3');
  writeFileSync(path.join(r, 'aging-3'), 'a file still takes the name');
  assert.equal(suggestFlowName(r, 'aging'), 'aging-4');
});

test('suggestFlowName: a trailing -N is stripped (aging-live-4-2 -> aging-live-4-3), a gap is not reused backwards', () => {
  const r = root();
  for (const n of ['aging-live-4', 'aging-live-4-2']) mkdirSync(path.join(r, n));
  assert.equal(suggestFlowName(r, 'aging-live-4-2'), 'aging-live-4-3');
  assert.equal(suggestFlowName(r, 'aging-live-4'), 'aging-live-4-3');
  mkdirSync(path.join(r, 'x-5'));
  assert.equal(suggestFlowName(r, 'x-5'), 'x-2', 'base x has no x entry required; first free of x-2.. is x-2');
});

test('suggestFlowName: the suggestion always passes the name check (length 64 base is shortened)', () => {
  const r = root();
  const long = 'a'.repeat(64);
  const s = suggestFlowName(r, long);
  assert.ok(s.length <= 64 && /-2$/.test(s), s);
});
