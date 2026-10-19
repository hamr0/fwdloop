// M4d amendment 27 (signed 2026-10-18): a try that ends with no reply from the model reads `thinking <asked> (no reply)` in the Audit.
// Must fail when (signed): a try with no reply has no thinking word; it shows an example's `(no reply)` for a try that did get a reply; the word is
// written outside src/thinking.js; the word on the page differs from the audit file. $0: fake providers only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { thinkingTryWords } from '../src/thinking.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { runFlow } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getRunAudit } from '../src/panel/data.js';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am27-${p}-`));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = (() => { const c = loadCatalogue(); assert.equal(c.ok, true); return c.primitives; })();

// ---- the words (src/thinking.js) --------------------------------------------------------------------------------------------------------

test('A1: a thinking record with no status reads "thinking <asked> (no reply)", from what was asked', () => {
  assert.equal(thinkingTryWords({ asked: 'off', status: null }), 'thinking off (no reply)');
  assert.equal(thinkingTryWords({ asked: 'on', status: null }), 'thinking on (no reply)');
  assert.equal(thinkingTryWords({ asked: 'on' }), 'thinking on (no reply)', 'a missing status is no status');
});

test('A2: nothing asked, or no thinking record at all, shows nothing (am26 item 4 unchanged)', () => {
  assert.equal(thinkingTryWords({ asked: null, status: null }), null);
  assert.equal(thinkingTryWords(undefined), null);
  assert.equal(thinkingTryWords(null), null);
});

test('A3: a try that did get a reply never says (no reply)', () => {
  assert.equal(thinkingTryWords({ asked: 'off', status: 'applied' }), 'thinking off');
  assert.equal(thinkingTryWords({ asked: 'on', status: 'applied' }), 'thinking on');
  for (const status of ['ignored', 'unsupported', 'unknown']) assert.doesNotMatch(thinkingTryWords({ asked: 'on', status }), /no reply/);
});

// ---- model-step: every way a try ends without a reply keeps {asked, status:null} -----------------------------------------------------------

const CTX = { goal: 'g', primitives: [], reads: {}, gap: null };
const mk = (name, provider) => makeLiveModelStep({ spendPath: path.join(tmp(name), 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });

test('B1: a round-1 provider error (bare-agent throws it) keeps {asked, status:null}', async () => {
  const step = mk('b1', { generate: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } });
  const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'off' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.thinking, { asked: 'off', status: null });
  assert.equal(thinkingTryWords(r.thinking), 'thinking off (no reply)');
});

test('B2: the time limit (EDEADLINE) keeps {asked, status:null}', async () => {
  const step = mk('b2', { generate: async () => { throw Object.assign(new Error('deadline'), { code: 'EDEADLINE' }); } });
  const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'on' });
  assert.match(r.red, /^wall-halt/);
  assert.deepEqual(r.thinking, { asked: 'on', status: null });
});

test('B3: a transport fault keeps {asked, status:null}', async () => {
  const step = mk('b3', { generate: async () => { throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); } });
  const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'off' });
  assert.equal(r.transport, true);
  assert.deepEqual(r.thinking, { asked: 'off', status: null });
});

test('B4: a Stop before the first reply keeps {asked, status:null}, and the provider is never called', async () => {
  let called = 0;
  const step = mk('b4', { generate: async () => { called += 1; throw new Error('must not be called'); } });
  const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'off' }, { stopRequested: () => true });
  assert.equal(r.stopped, true);
  assert.equal(called, 0);
  assert.deepEqual(r.thinking, { asked: 'off', status: null });
});

test('B5: a reply that arrives still carries bareagent\'s status (no (no reply))', async () => {
  const step = mk('b5', { generate: async () => ({ text: null, toolCalls: [{ id: 't', name: 'emit_artifact', arguments: { text: 'x', done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash', thinkingStatus: 'applied', thinkingApplied: true }) });
  const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'off' });
  assert.deepEqual(r.thinking, { asked: 'off', status: 'applied' });
  assert.equal(thinkingTryWords(r.thinking), 'thinking off');
});

// ---- end to end: the audit file's row, and the Audit payload's words -----------------------------------------------------------------------

function setup(name) {
  const root = tmp(name);
  const w = writeFlow({
    root, name: 'job1', proseText: fixture('job1.m1.signed.txt'), declaration: JSON.parse(fixture('job1.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${name}-src`);
  const aging = path.join(src, 'aging.csv');
  writeFileSync(aging, 'Customer,Invoice #,Invoice date,Due date,Amount,Days overdue,Current,1-30,31-60,61-90,90+\nAcme Corp,INV-1,2026-05-01,2026-05-15,150.00,,,,,,\n');
  return { root, aging };
}

for (const [label, err] of [['a provider error', Object.assign(new Error('boom'), { status: 500 })], ['the time limit', Object.assign(new Error('deadline'), { code: 'EDEADLINE' })]]) {
  test(`C1: ${label} on a first try: the audit row holds thinking {off, null} and the Audit payload says "thinking off (no reply)"`, async () => {
    const s = setup('c1');
    const modelStep = makeLiveModelStep({ spendPath: path.join(tmp('c1-spend'), 'spend.jsonl'), provider: { generate: async () => { throw err; } }, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    await runFlow({
      root: s.root, name: 'job1', runId: 'run-1', sources: [{ id: 'aging', path: s.aging }], catalogue: CAT, modelStep, askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
    });
    const file = readFileSync(path.join(s.root, 'job1', 'runs', 'run-1', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const first = file.find((x) => x.attempt === 1 && x.thinking);
    assert.ok(first, 'a first-try row with a thinking record');
    assert.deepEqual(first.thinking, { asked: 'off', status: null });
    const payload = getRunAudit({ root: s.root, flow: 'job1', runId: 'run-1' });
    const row = payload.rows.find((x) => x.step === first.step && x.attempt === 1);
    assert.equal(row.thinkingPhrase, 'thinking off (no reply)', 'the page shows what the file holds');
    assert.ok(payload.rows.filter((x) => x.thinking && x.thinking.status === null).every((x) => x.thinkingPhrase === `thinking ${x.thinking.asked} (no reply)`));
  });
}
