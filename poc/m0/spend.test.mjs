import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSpend, assertUnderGlobalCap, appendSpendRow, classifyModelId, sumMeterings,
} from './spend.mjs';

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

// F14 — the model we ask for is not always the model we get, and until now
// nothing was watching. Both real cases below are taken verbatim from rows
// already sitting in poc/m0/out/spend.jsonl.
test('classifyModelId separates a real substitution from a prefix or an alias', () => {
  assert.equal(classifyModelId('deepseek-v4-flash', 'deepseek-v4-flash'), 'match');
  assert.equal(classifyModelId('hf:openai/gpt-oss-120b', 'openai/gpt-oss-120b'), 'prefix');
  assert.equal(classifyModelId('syn:large:text', 'zai-org/GLM-5.3-Flash'), 'alias');

  // The two that actually happened and went unnoticed.
  assert.equal(classifyModelId('deepseek-v4-flash', 'deepseek-flash'), 'substituted');
  assert.equal(
    classifyModelId(
      'hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
      'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8',
    ),
    'substituted',
  );

  // A provider that reports nothing is never silently a match.
  assert.equal(classifyModelId('deepseek-v4-flash', null), 'unreported');
  assert.equal(classifyModelId('deepseek-v4-flash', ''), 'unreported');
});

test('appendSpendRow stamps every row with its modelMatch verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fwd-spend-'));
  const path = join(dir, 'spend.jsonl');
  appendSpendRow(path, { model: 'deepseek-v4-flash', modelReturned: 'deepseek-v4-flash', costUsd: 0.001 });
  appendSpendRow(path, { model: 'deepseek-v4-flash', modelReturned: 'deepseek-flash', costUsd: 0.001 });
  const rows = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].modelMatch, 'match');
  assert.equal(rows[1].modelMatch, 'substituted');
});

// F15 — a tool-calling run has more than one round, and only the last was
// being recorded. These fold every round into one row.
const ROUND = (inT, outT, cost) => ({
  usage: {
    inputTokens: inT, outputTokens: outT, cacheReadTokens: 0, cacheCreationTokens: 0,
  },
  costUsd: cost,
  model: 'deepseek-flash',
  rateSource: 'caller',
});

test('sumMeterings folds every round in, not just the last', () => {
  // The real shape of the 2026-09-10 drafter run: a big tool-emitting round,
  // then a short finishing round. Recording only the last kept the 106.
  const summed = sumMeterings([ROUND(217, 354, 0.0007), ROUND(600, 106, 0.0002)]);
  assert.equal(summed.rounds, 2);
  assert.equal(summed.tokens.outputTokens, 460);
  assert.equal(summed.tokens.inputTokens, 817);
  assert.equal(summed.costUsd.toFixed(6), '0.000900');
});

test('sumMeterings never renders an unknown cost as 0 or as a partial sum', () => {
  const summed = sumMeterings([ROUND(10, 10, 0.001), ROUND(10, 10, null)]);
  assert.equal(summed.costUsd, null, 'one unpriced round makes the whole total unknown');
  // Tokens are still summed — they are known even when the price is not.
  assert.equal(summed.tokens.outputTokens, 20);
  assert.equal(summed.rounds, 2);
});

test('sumMeterings on no rounds is unknown, never a free run', () => {
  for (const empty of [[], null, undefined]) {
    const summed = sumMeterings(empty);
    assert.equal(summed.rounds, 0);
    assert.equal(summed.costUsd, null);
    assert.equal(summed.tokens, null);
  }
});

