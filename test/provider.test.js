// Tests for src/provider.js — M2 piece 2. $0: no real provider call, no key
// read from a real secret store (checkKeyPreflight is tested against an
// injected env object, never process.env).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  PROVIDER_SLOTS, RATES_BY_SUFFIX, lookupRate, resolveModelRate, ceilingCostUsd,
  classifyModelId, sumMeterings, appendSpendRow, assertUnderGlobalCap, checkKeyPreflight,
  makeProvider,
} from '../src/provider.js';

function tmpFile(name) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-provider-'));
  return path.join(dir, name);
}

test('lookupRate: known suffix resolves, unknown returns null (never a 0 rate)', () => {
  assert.equal(lookupRate('deepseek-flash').suffix, 'deepseek-flash');
  assert.equal(lookupRate('nonexistent-model-xyz'), null);
  assert.equal(lookupRate('hf:Qwen/Qwen3.8-27B').suffix, 'Qwen/Qwen3.8-27B');
});

test('lookupRate: a suffix named after an inherited Object.prototype member is never treated as known', () => {
  assert.equal(lookupRate('constructor'), null);
  assert.equal(lookupRate('toString'), null);
});

test('resolveModelRate: throws on an unrated model rather than returning undefined', () => {
  assert.throws(() => resolveModelRate('not-a-real-model'), /no hand-entered rate/);
});

test('ceilingCostUsd: an unknown model prices at the table\'s highest in/out rate, never 0', () => {
  const known = ceilingCostUsd('deepseek-flash');
  const unknown = ceilingCostUsd('totally-unknown-model-id');
  assert.ok(known > 0);
  assert.ok(unknown > 0);
  const highestIn = Math.max(...Object.values(RATES_BY_SUFFIX).map((r) => r.in));
  const highestOut = Math.max(...Object.values(RATES_BY_SUFFIX).map((r) => r.out));
  const expected = (32000 / 1000) * highestIn + (16000 / 1000) * highestOut;
  assert.equal(unknown, expected);
});

test('classifyModelId: match, prefix, alias, substituted, unreported', () => {
  assert.equal(classifyModelId('deepseek-flash', 'deepseek-flash'), 'match');
  assert.equal(classifyModelId('hf:openai/x', 'openai/x'), 'prefix');
  assert.equal(classifyModelId('syn:large:text', 'zai-org/GLM-5.2'), 'alias');
  assert.equal(classifyModelId('deepseek-flash', 'deepseek-v4-pro'), 'substituted');
  assert.equal(classifyModelId('deepseek-flash', null), 'unreported');
  assert.equal(classifyModelId(null, 'deepseek-flash'), 'unreported');
});

test('sumMeterings: sums every round, never last-round-only', () => {
  const events = [
    { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001, model: 'deepseek-flash' },
    { usage: { inputTokens: 20, outputTokens: 10 }, costUsd: 0.0005, model: 'deepseek-flash' },
  ];
  const summed = sumMeterings(events);
  assert.equal(summed.rounds, 2);
  assert.equal(summed.tokens.inputTokens, 120);
  assert.equal(summed.tokens.outputTokens, 60);
  assert.ok(Math.abs(summed.costUsd - 0.0015) < 1e-9);
});

test('sumMeterings: any round with an unpriced cost makes the total null, never a partial sum', () => {
  const events = [
    { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001, model: 'deepseek-flash' },
    { usage: { inputTokens: 20, outputTokens: 10 }, costUsd: null, model: 'deepseek-flash' },
  ];
  const summed = sumMeterings(events);
  assert.equal(summed.costUsd, null);
  assert.equal(summed.rounds, 2);
});

test('appendSpendRow: stamps modelMatch, never overwrites a caller-supplied field silently', () => {
  const spendPath = tmpFile('spend.jsonl');
  appendSpendRow(spendPath, { model: 'deepseek-flash', modelReturned: 'deepseek-flash', costUsd: 0.001 });
  const row = JSON.parse(readFileSync(spendPath, 'utf8').trim());
  assert.equal(row.modelMatch, 'match');
  assert.equal(row.costUsd, 0.001);
});

test('assertUnderGlobalCap: a null-cost row reprices at its ceiling and still counts toward the cap', () => {
  const spendPath = tmpFile('spend.jsonl');
  appendSpendRow(spendPath, { model: 'deepseek-flash', modelReturned: null, costUsd: null });
  assert.throws(() => assertUnderGlobalCap(spendPath, 0.000001), /global spend cap reached/);
});

test('assertUnderGlobalCap: passes (does not throw) with plenty of headroom', () => {
  const spendPath = tmpFile('spend.jsonl');
  appendSpendRow(spendPath, { model: 'deepseek-flash', modelReturned: 'deepseek-flash', costUsd: 0.001 });
  assert.doesNotThrow(() => assertUnderGlobalCap(spendPath, 5.0));
});

test('checkKeyPreflight: refuses an unset key at $0, before any ledger write', () => {
  const result = checkKeyPreflight('deepseek', {});
  assert.equal(result.ok, false);
  assert.match(result.message, /DEEPSEEK_API_KEY is not set/);
});

test('checkKeyPreflight: refuses an empty-string key', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: '' });
  assert.equal(result.ok, false);
});

test('checkKeyPreflight: refuses a key with a trailing newline (F26 — a two-line pass entry)', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: 'sk-real-key\n' });
  assert.equal(result.ok, false);
  assert.match(result.message, /newline/);
});

test('checkKeyPreflight: refuses a key with embedded whitespace', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: 'sk-real key' });
  assert.equal(result.ok, false);
  assert.match(result.message, /whitespace/);
});

test('checkKeyPreflight: refuses an unknown slot name', () => {
  const result = checkKeyPreflight('not-a-slot', { DEEPSEEK_API_KEY: 'sk-x' });
  assert.equal(result.ok, false);
  assert.match(result.message, /unknown provider slot/);
});

test('checkKeyPreflight: accepts a clean key', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: 'sk-clean-key-value' });
  assert.equal(result.ok, true);
});

test('makeProvider: throws (never silently proceeds) when the slot\'s key is missing from process.env', () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    assert.throws(() => makeProvider('deepseek', {}), /DEEPSEEK_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('makeProvider: throws on an unknown slot before touching any key', () => {
  assert.throws(() => makeProvider('not-a-real-slot', {}), /unknown provider slot/);
});

test('makeProvider: with a key present, builds a provider for the requested model without any network call', () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-fake-test-key';
  try {
    const built = makeProvider('deepseek', { model: 'deepseek-flash' });
    assert.equal(built.modelId, 'deepseek-flash');
    assert.equal(built.slot, 'deepseek');
    assert.ok(built.provider);
    assert.ok(built.rates.in > 0);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
  }
});

test('PROVIDER_SLOTS: deepseek carries legacyMaxTokens (F11 — it ignores max_completion_tokens)', () => {
  assert.equal(PROVIDER_SLOTS.deepseek.legacyMaxTokens, true);
  assert.equal(PROVIDER_SLOTS.synthetic.legacyMaxTokens, false);
});
