// M14 items 9 and 10 (docs/wiki/the-module-ladder.md): on bare-agent 0.59 a cut-off try's gap names bare-agent's facts (output tokens, how many were thinking, the limit), `checkArgs`
// keeps a wrong-typed or missing tool value from ever running the tool, and `badCalls` ride the try's audit row. Metering still sums every round. $0: a fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { makeLiveModelStep } from '../src/model-step.js';
import { runStepRalph } from '../src/runner.js';
import { appendAudit, readAudit } from '../src/books.js';

const RATES = { in: 0.001, out: 0.002 };
const CTX = { goal: 'draft a thing', primitives: [], reads: {}, gap: null };
const dir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m14p5-'));
const spendRows = (d) => (existsSync(path.join(d, 'spend.jsonl')) ? readFileSync(path.join(d, 'spend.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** a provider that answers from a script, one entry per call; after the script a plain stop */
function scripted(steps) {
  let n = 0;
  return { generate: async () => { const s = steps[Math.min(n, steps.length - 1)]; n += 1; return s; } };
}
const call = (name, args, id = 'c1') => ({ text: '', toolCalls: [{ id, name, arguments: args }], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'tool_calls', model: 'm-1' });
const stop = { text: 'done', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', model: 'm-1' };

test('a cut-off try: the red names output tokens, thinking tokens and the limit, from bare-agent\'s cutOff; every round is still metered', async () => {
  const d = dir();
  const cut = { text: '', toolCalls: [], usage: { inputTokens: 100, outputTokens: 16000, reasoningTokens: 15000 }, stopReason: 'max_tokens', model: 'm-1' };
  const step = makeLiveModelStep({ spendPath: path.join(d, 'spend.jsonl'), provider: scripted([cut]), rates: RATES, modelId: 'm-1' });
  const r = await step(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, false);
  assert.equal(r.red, 'truncated: cut off at the output limit with no tool call — 16000 output tokens, 15000 of them thinking; the limit was 16000');
  // books: the cut round's cost is the try's cost, and the spend row says the same
  const rows = spendRows(d);
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(r.costUsd - rows.reduce((a, x) => a + x.costUsd, 0)) < 1e-9, 'the try\'s cost is the sum of every metered round');
  assert.ok(r.costUsd > 0.03, `the 16000 output tokens are priced: ${r.costUsd}`);
});

test('a cut-off whose thinking tokens bare-agent did not report says so, never a number', async () => {
  const d = dir();
  const cut = { text: '', toolCalls: [], usage: { inputTokens: 100, outputTokens: 16000 }, stopReason: 'max_tokens', model: 'm-1' };
  const step = makeLiveModelStep({ spendPath: path.join(d, 'spend.jsonl'), provider: scripted([cut]), rates: RATES, modelId: 'm-1' });
  const r = await step(CTX, {}, { class: 'hitl' });
  assert.equal(r.red, 'truncated: cut off at the output limit with no tool call — 16000 output tokens, thinking tokens not reported; the limit was 16000');
});

test('a wrong-typed tool value never runs the tool, rides badCalls onto the audit row, and the next round can still finish the step', async () => {
  const d = dir();
  let ran = 0;
  const stash = { name: 'stash', description: 'keep a value', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, execute: async () => { ran += 1; return { ok: true }; } };
  const provider = scripted([call('stash', { key: 42 }, 's1'), call('emit_artifact', { text: 'fine', done: true }, 'e1'), stop]);
  const modelStep = makeLiveModelStep({ spendPath: path.join(d, 'spend.jsonl'), provider, rates: RATES, modelId: 'm-1' });
  const out = await runStepRalph({
    step: { goal: 'g', emits: 'one', primitives: ['stash'], reads: [], close: { class: 'hitl' } }, primitivesMap: { stash }, readsMap: {}, businessDate: '2026-06-01', modelStep, spent: { value: 0 }, capUsd: 5, ceilingUsd: 0.01, runDir: d,
    recordAudit: (row) => appendAudit(d, row), now: () => '2026-10-18T18:50:00.000Z',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(ran, 0, 'the tool never ran on a wrong-typed value');
  const [row] = readAudit(d);
  assert.equal(row.badCalls.length, 1);
  assert.deepEqual({ kind: row.badCalls[0].kind, tool: row.badCalls[0].tool, param: row.badCalls[0].param }, { kind: 'arg-type', tool: 'stash', param: 'key' });
  // the books still balance: the audit row's cost is the spend ledger's sum
  assert.ok(Math.abs(row.usd - spendRows(d).reduce((a, x) => a + x.costUsd, 0)) < 1e-9);
});

test('a missing required value is refused the same way; a good call runs the tool and leaves no badCalls key', async () => {
  const d = dir();
  let ran = 0;
  const stash = { name: 'stash', description: 'keep a value', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, execute: async () => { ran += 1; return { ok: true }; } };
  const modelStep = (script) => makeLiveModelStep({ spendPath: path.join(d, 'spend.jsonl'), provider: scripted(script), rates: RATES, modelId: 'm-1' });
  const missing = await modelStep([call('stash', {}, 's1'), call('emit_artifact', { text: 'x', done: true }, 'e1'), stop])(CTX, { stash }, { class: 'hitl' });
  assert.equal(ran, 0);
  assert.equal(missing.badCalls[0].kind, 'arg-missing');
  const good = await modelStep([call('stash', { key: 'k' }, 's2'), call('emit_artifact', { text: 'x', done: true }, 'e2'), stop])(CTX, { stash }, { class: 'hitl' });
  assert.equal(ran, 1, 'a good call runs the tool');
  assert.equal(good.ok, true);
  assert.equal(Object.hasOwn(good, 'badCalls'), false);
});
