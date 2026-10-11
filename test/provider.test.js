// Tests for src/provider.js — M2 piece 2. $0: no real provider call, no key
// read from a real secret store (checkKeyPreflight is tested against an
// injected env object, never process.env).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { OpenAI } from 'bare-agent/providers';
import { tickedHome } from './fixtures/m4d-ticked.mjs';

import {
  PROVIDER_SLOTS, ceilingCostUsd,
  classifyModelId, sumMeterings, appendSpendRow, assertUnderGlobalCap, checkKeyPreflight,
  makeProvider, spendRowCost,
} from '../src/provider.js';

function tmpFile(name) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-provider-'));
  return path.join(dir, name);
}

// M4d am5 item 1/4: the code table, lookupRate and resolveModelRate are gone (their tests are replaced by the am5
// tests in test/m4d-am5.test.js: no model/price in src/, one usable-model decision, the hold from a line's own prices).
test('ceilingCostUsd: the hold is the rates it is given times the token bounds - no table, no fallback', () => {
  assert.equal(ceilingCostUsd({ in: 0.001, out: 0.002 }), (32000 / 1000) * 0.001 + (16000 / 1000) * 0.002);
  assert.equal(ceilingCostUsd({ in: 0, out: 0 }), 0); // a typed 0 / 0 is a chosen price
});

test('classifyModelId: match, prefix, substituted, unreported (the syn: alias rule was a per-model rule, deleted by M4d am5)', () => {
  assert.equal(classifyModelId('deepseek-flash', 'deepseek-flash'), 'match');
  assert.equal(classifyModelId('hf:openai/x', 'openai/x'), 'prefix');
  assert.equal(classifyModelId('some-alias', 'concrete-model'), 'substituted');
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
  appendSpendRow(spendPath, { model: 'deepseek-flash', modelReturned: null, costUsd: null, price: { inPerM: 0.3, outPerM: 1.2, source: { in: 'model', out: 'model' } } });
  assert.throws(() => assertUnderGlobalCap(spendPath, 0.000001), /global spend cap reached/);
});

// M4d am5 item 6: a null-cost row that recorded NO price (an old row) can no longer be priced from a code table. It
// counts its floor only and reads incomplete, so every figure that holds it says "at least", never a clean total.
test('spendRowCost: a null-cost row with no recorded price is incomplete (reads "at least"), not priced from code', () => {
  assert.deepEqual(spendRowCost({ model: 'deepseek-flash', costUsd: null }), { usd: 0, complete: false });
  assert.deepEqual(spendRowCost({ model: 'deepseek-flash', costUsd: 0.002, spendComplete: false, calls: 2, rounds: 1 }), { usd: 0.002, complete: false });
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
    const built = makeProvider('deepseek', { model: 'deepseek-flash', configHome: tickedHome() });
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

// BA-27 / 0.48 validation: the REAL wrapper from makeProvider, pointed at a
// local server whose tool-call `arguments` is malformed JSON. Revert-proof:
// removing `exposeMalformedArgs: true` from makeProvider makes rawArguments
// undefined here.
async function withMalformedServer(args, fn) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'emit_x', arguments: args } }],
        },
        finish_reason: 'tool_calls',
      }],
      model: 'deepseek-flash',
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-fake-test-key';
  try {
    await fn(port);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
    await new Promise((resolve) => server.close(resolve));
  }
}
const EMIT_X = [{ name: 'emit_x', description: 'd', parameters: { type: 'object', properties: {} } }];

test('makeProvider("deepseek")\'s real wrapper: malformed args come back verbatim in lastMalformedToolCall.rawArguments, usage metered', async () => {
  await withMalformedServer('{"a":1}}', async (port) => {
    const built = makeProvider('deepseek', { model: 'deepseek-flash', configHome: tickedHome() });
    built.provider.baseUrl = `http://127.0.0.1:${port}`;
    const result = await built.provider.generate([{ role: 'user', content: 'hi' }], EMIT_X);
    assert.deepEqual(result.toolCalls, []);
    assert.equal(built.provider.lastMalformedToolCall.name, 'emit_x');
    assert.match(built.provider.lastMalformedToolCall.error, /JSON/);
    assert.equal(built.provider.lastMalformedToolCall.rawArguments, '{"a":1}}');
    assert.ok(!built.provider.lastMalformedToolCall.rawTruncated);
    assert.equal(result.usage.inputTokens, 100);
  });
});

test('makeProvider("deepseek")\'s real wrapper: 800-char malformed args are capped upstream at 500 with rawTruncated:true', async () => {
  await withMalformedServer(`{"a":"${'x'.repeat(790)}"}}`, async (port) => {
    const built = makeProvider('deepseek', { model: 'deepseek-flash', configHome: tickedHome() });
    built.provider.baseUrl = `http://127.0.0.1:${port}`;
    await built.provider.generate([{ role: 'user', content: 'hi' }], EMIT_X);
    assert.equal(built.provider.lastMalformedToolCall.rawArguments.length, 500);
    assert.equal(built.provider.lastMalformedToolCall.rawTruncated, true);
  });
});

test('upstream default: bare-agent OpenAI built WITHOUT exposeMalformedArgs returns malformedToolCall with no rawArguments', async () => {
  await withMalformedServer('{"a":1}}', async (port) => {
    const provider = new OpenAI({ apiKey: 'sk-fake-test-key', model: 'deepseek-flash', baseUrl: `http://127.0.0.1:${port}` });
    const result = await provider.generate([{ role: 'user', content: 'hi' }], EMIT_X);
    assert.ok(result.malformedToolCall);
    assert.equal(result.malformedToolCall.name, 'emit_x');
    assert.equal(result.malformedToolCall.rawArguments, undefined);
  });
});

// F49 / bare-agent 0.49: `thinking` reaches body.thinking only when passed.
async function sentBody(options) {
  let body;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'deepseek-flash',
        usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-fake-test-key';
  try {
    const built = makeProvider('deepseek', { model: 'deepseek-flash', configHome: tickedHome(), ...options });
    built.provider.baseUrl = `http://127.0.0.1:${server.address().port}`;
    await built.provider.generate([{ role: 'user', content: 'hi' }], []);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
    await new Promise((resolve) => server.close(resolve));
  }
  return body;
}

test('makeProvider("deepseek") with no thinking option: the sent body has no thinking key', async () => {
  const body = await sentBody({});
  assert.equal('thinking' in body, false);
});

test('makeProvider("deepseek", {thinking}) sends body.thinking verbatim', async () => {
  const body = await sentBody({ thinking: { type: 'disabled' } });
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

// M4c-fix item 18 / negative (vii): an incomplete spend row never counts below the ceiling price.
test('negative (vii): readSpendTotal counts a spendComplete:false row at floor + ceiling, never only its floor', () => {
  const spendPath = tmpFile('spend.jsonl');
  // a live row records the price it was booked at (M4d), and its ceiling is read off THAT price
  const price = { inPerM: 0.3, outPerM: 1.2, source: { in: 'model', out: 'model' } };
  const ceiling = ceilingCostUsd({ in: 0.0003, out: 0.0012 });
  appendSpendRow(spendPath, { model: 'deepseek-flash', modelReturned: 'deepseek-flash', costUsd: 0.000001, spendComplete: false, calls: 2, rounds: 1, price });
  // floor alone (1e-6) is far under this cap; floor + one unmetered ceiling is not
  assert.throws(() => assertUnderGlobalCap(spendPath, ceiling / 2), /global spend cap reached/);
  const total = assertUnderGlobalCap(spendPath, 100);
  assert.ok(total >= ceiling, `total ${total} must be at least one ceiling`);
});
