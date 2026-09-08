import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpendTotal, assertUnderGlobalCap, appendSpendRow } from './spend.mjs';

test('readSpendTotal sums costUsd across rows; empty file is 0 and known', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  assert.deepEqual(readSpendTotal(path), { totalUsd: 0, unknown: false, rows: 0 });
  appendSpendRow(path, { runId: 'r1', costUsd: 0.001 });
  appendSpendRow(path, { runId: 'r1', costUsd: 0.002 });
  const { totalUsd, unknown, rows } = readSpendTotal(path);
  assert.ok(Math.abs(totalUsd - 0.003) < 1e-9);
  assert.equal(unknown, false);
  assert.equal(rows, 2);
});

test('PROOF the test can fail: a null costUsd row is flagged unknown, never treated as $0', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.001 });
  appendSpendRow(path, { runId: 'r1', costUsd: null });
  const { unknown } = readSpendTotal(path);
  assert.equal(unknown, true);
});

test('assertUnderGlobalCap throws once the tally reaches the cap', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 5.00 });
  assert.throws(() => assertUnderGlobalCap(path, 5.00), /global spend cap reached/);
});

test('assertUnderGlobalCap throws when any row is unpriced, even under the numeric cap', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.01 });
  appendSpendRow(path, { runId: 'r1', costUsd: null });
  assert.throws(() => assertUnderGlobalCap(path, 5.00), /unpriced round/);
});

test('assertUnderGlobalCap passes through the total when comfortably under cap', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.01 });
  assert.equal(assertUnderGlobalCap(path, 5.00), 0.01);
});
