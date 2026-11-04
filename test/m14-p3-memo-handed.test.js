// M14 items 2 and 7 (docs/wiki/the-module-ladder.md): every model try is handed the memo (`fromThisRun`, one key, whole), and the exact text it got is kept on that try's
// audit row (`memoText`). $0: a fake provider that records what it was sent; the real runStepRalph / makeLiveModelStep / appendAudit on a scratch run folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { runStepRalph } from '../src/runner.js';
import { appendAudit, readAudit } from '../src/books.js';
import { makeLiveModelStep } from '../src/model-step.js';

const STEPS = ['read_it', 'draft_it', 'ask_ok', 'final_it'];
const step = (emits, extra = {}) => ({ goal: `goal of ${emits}`, emits, primitives: [], reads: [], close: { class: 'softgreen', shape: { sections: ['a'], maxWords: 50 } }, ...extra });

function runFolder({ asks = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m14-p3-'));
  mkdirSync(path.join(dir, 'job'));
  mkdirSync(path.join(dir, 'asks'));
  writeFileSync(path.join(dir, 'job', 'declaration.json'), JSON.stringify({ steps: STEPS.map((e) => ({ emits: e })) }));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ thinking: false, inputs: [] }));
  for (const a of asks) {
    writeFileSync(path.join(dir, 'asks', `${a.id}.json`), JSON.stringify({ askId: a.id, question: 'q', askedAt: a.at, expiresAt: '2099-01-01T00:00:00.000Z', evidence: {}, emits: 'ask_ok' }));
    writeFileSync(path.join(dir, `answer.${a.id}.consumed.json`), JSON.stringify({ askId: a.id, decision: a.decision, answeredAt: a.at, ...(a.reason !== undefined ? { reason: a.reason } : {}) }));
  }
  return dir;
}

/** a fake provider: records the user message of every try (its first call); replies with the artifacts in `texts`, one per try, then plain text once the tool answered */
function provider(sent, texts) {
  let n = 0;
  return {
    generate: async (messages) => {
      if (messages.at(-1).role === 'tool') return { text: 'done', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', model: 'm-1' };
      sent.push(JSON.parse(messages.find((m) => m.role === 'user').content));
      const text = texts[Math.min(n, texts.length - 1)];
      n += 1;
      return { text: '', toolCalls: [{ id: `t${n}`, name: 'emit_artifact', arguments: { text, done: true } }], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'tool_calls', model: 'm-1' };
    },
  };
}

/** run one step's tries through the real ralph and the real live model step; returns what was sent and the audit rows the step wrote */
async function runStep(dir, stepDef, texts) {
  const sent = [];
  const modelStep = makeLiveModelStep({ spendPath: path.join(dir, 'spend.jsonl'), provider: provider(sent, texts), rates: { in: 0.001, out: 0.002 }, modelId: 'm-1' });
  const out = await runStepRalph({
    step: stepDef, primitivesMap: {}, readsMap: {}, businessDate: '2026-06-01', modelStep, spent: { value: 0 }, capUsd: 5, ceilingUsd: 0.01, runDir: dir,
    recordAudit: (row) => appendAudit(dir, row), now: () => '2026-10-18T18:50:00.000Z',
  });
  return { sent, out, rows: readAudit(dir).filter((r) => r.step === stepDef.emits) };
}

const GOOD = '## a\nok';
const LONG = `## a\n${Array.from({ length: 80 }, () => 'word').join(' ')}`; // over maxWords 50: a red the retry is handed as its gap

test('a first try with nothing before it gets no memo and keeps none; the text sent equals the text on the audit row for every later try', async () => {
  const dir = runFolder();
  const first = await runStep(dir, step('read_it'), [GOOD]);
  assert.equal(Object.hasOwn(first.sent[0], 'fromThisRun'), false, 'nothing has happened yet: left out');
  assert.equal(first.rows.some((r) => Object.hasOwn(r, 'memoText')), false);
  // the next step's first try: it sees the first step's try
  const second = await runStep(dir, step('draft_it'), [LONG, GOOD]);
  assert.equal(second.rows.length, 2);
  second.rows.forEach((row, i) => {
    assert.equal(typeof second.sent[i].fromThisRun, 'string');
    assert.equal(row.memoText, second.sent[i].fromThisRun, `try ${i + 1}: the saved text is exactly what the model got`);
  });
  assert.match(second.sent[0].fromThisRun, /last try: step read_it try 1 — result: (green|hitl)/);
  // the retry: told about its own failed try as the last try, without the gap words it already gets as its gap
  assert.match(second.sent[1].fromThisRun, /last try: step draft_it try 1 — result: red$/m);
  assert.ok(second.sent[1].gap && second.sent[1].gap.length > 0);
  assert.ok(!second.sent[1].fromThisRun.includes(second.sent[1].gap), 'the gap words are not told twice');
  assert.notEqual(second.rows[0].memoText, second.rows[1].memoText);
});

test('the first try of a later step sees the ask lines (Accept text now used); a run with no asks gets no human lines', async () => {
  const withAsks = runFolder({ asks: [{ id: 'a1', at: '2026-10-18T18:52:00.000Z', decision: 'redo', reason: 'use British spelling' }, { id: 'a2', at: '2026-10-18T18:54:00.000Z', decision: 'accept', reason: 'looks right to me' }] });
  await runStep(withAsks, step('read_it'), [GOOD]);
  const got = await runStep(withAsks, step('final_it'), [GOOD]);
  const lines = got.sent[0].fromThisRun.split('\n');
  assert.equal(lines[1], 'ask 1 (after step draft_it): redo — user says "use British spelling"');
  assert.equal(lines[2], 'ask 2 (after step draft_it): accept — user says "looks right to me"');
  assert.equal(got.rows[0].memoText, got.sent[0].fromThisRun);
  const none = runFolder();
  await runStep(none, step('read_it'), [GOOD]);
  const noAsk = await runStep(none, step('final_it'), [GOOD]);
  assert.ok(!/ask \d|user says/.test(noAsk.sent[0].fromThisRun));
  assert.ok(!/ask \d|user says/.test(noAsk.rows[0].memoText));
});

test('every row a try writes carries the same memo, and the executor context holds it under one key only', async () => {
  const dir = runFolder();
  await runStep(dir, step('read_it'), [GOOD]);
  const seen = [];
  await runStepRalph({
    step: step('draft_it'), primitivesMap: {}, readsMap: {}, businessDate: '2026-06-01', spent: { value: 0 }, capUsd: 5, ceilingUsd: 0.01, runDir: dir,
    modelStep: async (ctx) => { seen.push(ctx); return { ok: false, red: 'transport-free red', costUsd: 0.001, model: 'm-1', tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: {} }; },
    recordAudit: (row) => appendAudit(dir, row), now: () => '2026-10-18T18:50:00.000Z',
  });
  assert.ok(seen.length >= 2);
  assert.equal(typeof seen[0].memo, 'string');
  const rows = readAudit(dir).filter((r) => r.step === 'draft_it');
  rows.forEach((row, i) => assert.equal(row.memoText, seen[i].memo));
  assert.equal(Object.keys(seen[0]).filter((k) => /memo/i.test(k)).length, 1);
});
