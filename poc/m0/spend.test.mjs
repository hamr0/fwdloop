import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpend, assertUnderGlobalCap, appendSpendRow } from './spend.mjs';

test('readSpend sums costUsd across rows; empty file is 0 and known', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  assert.deepEqual(readSpend(path), {
    total: 0, estimatedPortion: 0, unknown: false, rows: 0,
  });
  appendSpendRow(path, { runId: 'r1', costUsd: 0.001 });
  appendSpendRow(path, { runId: 'r1', costUsd: 0.002 });
  const {
    total, estimatedPortion, unknown, rows,
  } = readSpend(path);
  assert.ok(Math.abs(total - 0.003) < 1e-9);
  assert.equal(estimatedPortion, 0);
  assert.equal(unknown, false);
  assert.equal(rows, 2);
});

test('PROOF the test can fail: a null costUsd row is flagged unknown, never treated as $0', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.001 });
  appendSpendRow(path, { runId: 'r1', costUsd: null });
  const { unknown } = readSpend(path);
  assert.equal(unknown, true);
});

test('a row with estimated:true counts its full cost and does NOT set unknown', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.001 });
  appendSpendRow(path, {
    runId: 'r1', costUsd: 0.036526, rateSource: 'ceiling', estimated: true,
  });
  const {
    total, estimatedPortion, unknown, rows,
  } = readSpend(path);
  assert.ok(Math.abs(total - 0.037526) < 1e-9);
  assert.ok(Math.abs(estimatedPortion - 0.036526) < 1e-9);
  assert.equal(unknown, false);
  assert.equal(rows, 2);
});

test('assertUnderGlobalCap does not block on an estimated row alone (unlike a null row)', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, {
    runId: 'r1', costUsd: 0.036526, rateSource: 'ceiling', estimated: true,
  });
  assert.equal(assertUnderGlobalCap(path, 5.00), 0.036526);
});

test('assertUnderGlobalCap still throws once an estimated total reaches the cap', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 5.00, estimated: true });
  assert.throws(() => assertUnderGlobalCap(path, 5.00), /global spend cap reached/);
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

test('a null costUsd row still blocks even alongside an estimated row (unrecoverable stays unpriced)', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.036526, estimated: true });
  appendSpendRow(path, { runId: 'r1', costUsd: null });
  assert.throws(() => assertUnderGlobalCap(path, 5.00), /unpriced round/);
});

test('assertUnderGlobalCap passes through the total when comfortably under cap', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  appendSpendRow(path, { runId: 'r1', costUsd: 0.01 });
  assert.equal(assertUnderGlobalCap(path, 5.00), 0.01);
});
