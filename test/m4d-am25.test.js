// M4d amendment 25: thinking per step, with the Chat "Thinking on" box as the hatch. $0: fake providers and fake model steps only.
// Must fail when (signed): box off + 1st try asks thinking on; box off + 2nd try or a Redo asks off; box on + any call asks off; an audit row has no thinking record.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, rmSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stepThinkingMode } from '../src/thinking.js';
import { readModelRecord, writeModelRecord, readJobThinking } from '../src/flowmodel.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { runFlow } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { draftToDir, signDraft } from '../src/authoring.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am25-${p}-`));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = (() => { const c = loadCatalogue(); assert.equal(c.ok, true); return c.primitives; })();

// ---- the one owner function --------------------------------------------------------------------------------------------------------------

test('A1: box off: the 1st try thinks off', () => {
  assert.equal(stepThinkingMode({ boxOn: false, attempt: 1 }), 'off');
});
test('A2: box off: the 2nd and later tries think on', () => {
  for (const attempt of [2, 3, 4]) assert.equal(stepThinkingMode({ boxOn: false, attempt }), 'on', `attempt ${attempt}`);
});
test('A3: box on: every try thinks on', () => {
  for (const attempt of [1, 2, 3, 4]) assert.equal(stepThinkingMode({ boxOn: true, attempt }), 'on', `attempt ${attempt}`);
});

// ---- the live model step passes the runner's mode to bareagent, and records what it asked + what came back -----------------------------------

function recordingProvider(status = 'applied') {
  const calls = [];
  return {
    calls,
    generate: async (messages, tools, options) => {
      calls.push(options);
      return {
        text: null,
        toolCalls: [{ id: 't', name: 'emit_artifact', arguments: { text: 'x', done: true } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'tool_calls',
        model: 'deepseek-flash',
        thinkingStatus: status,
        thinkingApplied: status === 'applied',
      };
    },
  };
}
const CTX = { goal: 'g', primitives: [], reads: {}, gap: null };

test('B1: the mode in stepMeta reaches the provider call as thinkingMode', async () => {
  for (const mode of ['off', 'on']) {
    const provider = recordingProvider();
    const step = makeLiveModelStep({ spendPath: path.join(tmp('b1'), 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    const r = await step(CTX, {}, { class: 'hitl', thinkingMode: mode });
    assert.equal(r.ok, true);
    assert.equal(provider.calls[0].thinkingMode, mode);
  }
});

test('B2: the step result records what was asked and what bareagent reported', async () => {
  for (const status of ['applied', 'ignored', 'unsupported']) {
    const provider = recordingProvider(status);
    const step = makeLiveModelStep({ spendPath: path.join(tmp('b2'), 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'on' });
    assert.deepEqual(r.thinking, { asked: 'on', status });
  }
});

test('B3: a call that failed before bareagent reported anything records asked and a null status (never an invented one)', async () => {
  const provider = { generate: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } };
  const step = makeLiveModelStep({ spendPath: path.join(tmp('b3'), 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  const r = await step(CTX, {}, { class: 'hitl', thinkingMode: 'off' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.thinking, { asked: 'off', status: null });
});

// ---- the runner decides per try and writes the audit row ---------------------------------------------------------------------------------

function job1Setup(name) {
  const root = tmp(name);
  const w = writeFlow({
    root, name: 'job1', proseText: fixture('job1.m1.signed.txt'), declaration: JSON.parse(fixture('job1.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${name}-src`);
  const aging = path.join(src, 'aging.csv');
  writeFileSync(aging, 'Customer,Invoice #,Invoice date,Due date,Amount,Days overdue,Current,1-30,31-60,61-90,90+\nAcme Corp,INV-1,2026-05-01,2026-05-15,150.00,,,,,,\nAcme Corp,INV-2,2026-05-05,2026-05-20,50.50,,,,,,\n');
  return { root, aging, flowDir: path.join(root, 'job1') };
}

/** job #1's goals answered correctly; the first call of `failFirstOf` (a goal fragment) returns an empty artifact (a red try). Records every call's stepMeta. */
function recordingStep({ failFirstOf = null } = {}) {
  const metas = [];
  let failed = false;
  const step = async (ctx, tools, stepMeta) => {
    metas.push({ goal: ctx.goal, ...stepMeta });
    const thinking = { asked: stepMeta.thinkingMode ?? null, status: 'applied' };
    const ok = (artifact) => ({ ok: true, costUsd: 0.001, artifact, thinking });
    if (failFirstOf && ctx.goal.includes(failFirstOf) && !failed) { failed = true; return ok({ done: true }); }
    if (ctx.goal.includes('addressable cells')) {
      return ok({ kind: 'cells', rows: [{ rowNumber: 2, cells: { A: 'Acme Corp', B: 'INV-1', C: '2026-05-01', D: '2026-05-15', E: '150.00' } }, { rowNumber: 3, cells: { A: 'Acme Corp', B: 'INV-2', C: '2026-05-05', D: '2026-05-20', E: '50.50' } }], done: true });
    }
    if (ctx.goal.includes('work out which customer')) return ok({ matchedCustomer: 'Acme Corp', done: true });
    if (ctx.goal.includes('pull their open invoices')) {
      return ok({ fields: { invoice1: { value: 150, cite: 'aging_cells!E2' }, invoice2: { value: 50.5, cite: 'aging_cells!E3' }, total_owed: { value: 200.5, cite: 'sum(#invoice1,#invoice2)' } }, done: true });
    }
    if (ctx.goal.includes('Write a short reply')) return ok({ text: 'Invoice # INV-1 Due date 2026-05-15 Amount 150\nInvoice # INV-2 Due date 2026-05-20 Amount 50.50', done: true });
    throw new Error(`unexpected goal ${ctx.goal}`);
  };
  return { step, metas };
}

async function run(s, modelStep, askStep = async () => ({ decision: 'accept' })) {
  return runFlow({
    root: s.root, name: 'job1', runId: 'run-1', sources: [{ id: 'aging', path: s.aging }], catalogue: CAT, modelStep, askStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
  });
}

test('C1: box off: every 1st try asks thinking off', async () => {
  const s = job1Setup('c1');
  const { step, metas } = recordingStep();
  const r = await run(s, step);
  assert.equal(r.outcome, 'complete', r.red);
  assert.ok(metas.length >= 4);
  for (const m of metas) assert.deepEqual([m.attempt, m.thinkingMode], [1, 'off'], m.goal);
});

test('C2: box off: a 2nd try (the 1st closed red) asks thinking on, and its 1st try asked off', async () => {
  const s = job1Setup('c2');
  const { step, metas } = recordingStep({ failFirstOf: 'work out which customer' });
  const r = await run(s, step);
  assert.equal(r.outcome, 'complete', r.red);
  const mine = metas.filter((m) => m.goal.includes('work out which customer'));
  assert.deepEqual(mine.map((m) => [m.attempt, m.thinkingMode]), [[1, 'off'], [2, 'on']]);
});

test('C3: box off: a step redone after Redo asks thinking on', async () => {
  const s = job1Setup('c3');
  const { step, metas } = recordingStep();
  let asked = 0;
  const r = await run(s, step, async () => { asked += 1; return asked === 1 ? { decision: 'reject', reason: 'add labels to each figure' } : { decision: 'accept' }; });
  assert.equal(r.outcome, 'complete', r.red);
  const compose = metas.filter((m) => m.goal.includes('Write a short reply'));
  assert.deepEqual(compose.map((m) => [m.attempt, m.thinkingMode]), [[1, 'off'], [2, 'on']]);
});

test('C4: box on (kept with the job): every call asks thinking on, on every try', async () => {
  const s = job1Setup('c4');
  writeModelRecord(s.flowDir, { slot: 'DEEPSEEK_API_KEY', model: 'm', thinking: true });
  const { step, metas } = recordingStep({ failFirstOf: 'work out which customer' });
  const r = await run(s, step);
  assert.equal(r.outcome, 'complete', r.red);
  assert.ok(metas.length >= 5);
  for (const m of metas) assert.equal(m.thinkingMode, 'on', `${m.goal} attempt ${m.attempt}`);
});

test('C5: the run reads the box from its OWN record, not the flow folder it came from', async () => {
  const s = job1Setup('c5');
  writeModelRecord(s.flowDir, { slot: 'DEEPSEEK_API_KEY', model: 'm', thinking: true });
  const { step, metas } = recordingStep();
  // the flow's record is changed to box-off after the run copied it, during the run (here: by the first model call)
  const swap = async (ctx, tools, meta) => {
    if (metas.length === 0) { rmSync(path.join(s.flowDir, 'model.json')); writeModelRecord(s.flowDir, { slot: 'DEEPSEEK_API_KEY', model: 'm' }); }
    return step(ctx, tools, meta);
  };
  const r = await run(s, swap);
  assert.equal(r.outcome, 'complete', r.red);
  assert.ok(existsSync(path.join(s.flowDir, 'runs', 'run-1', 'thinking.json')));
  for (const m of metas) assert.equal(m.thinkingMode, 'on', m.goal);
});

test('C6: every audit row of a model call carries a thinking record (asked + reported); rows with no call carry none', async () => {
  const s = job1Setup('c6');
  const { step } = recordingStep({ failFirstOf: 'work out which customer' });
  const r = await run(s, step);
  assert.equal(r.outcome, 'complete', r.red);
  const rows = readFileSync(path.join(s.flowDir, 'runs', 'run-1', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const modelRows = rows.filter((x) => x.model !== null || typeof x.attempt === 'number' && x.usd !== 0 && x.usd !== null);
  assert.ok(modelRows.length >= 5);
  for (const x of modelRows) {
    assert.ok(x.thinking, `row ${x.step}#${x.attempt} has a thinking record`);
    assert.ok(['on', 'off'].includes(x.thinking.asked));
    assert.equal(x.thinking.status, 'applied');
  }
  const retry = rows.find((x) => x.step && x.attempt === 2 && x.thinking);
  assert.equal(retry.thinking.asked, 'on');
});

// ---- the box is kept with the job ---------------------------------------------------------------------------------------------------------

test('D1: the record holds thinking only when ticked; a record without it reads as box off', () => {
  const d = tmp('d1');
  writeModelRecord(d, { slot: 'DEEPSEEK_API_KEY', model: 'm', thinking: true });
  assert.deepEqual(readModelRecord(d), { slot: 'DEEPSEEK_API_KEY', model: 'm', thinking: true });
  const e = tmp('d1b');
  writeModelRecord(e, { slot: 'DEEPSEEK_API_KEY', model: 'm' });
  assert.deepEqual(readModelRecord(e), { slot: 'DEEPSEEK_API_KEY', model: 'm' });
  assert.equal(readJobThinking(e, null), false);
  assert.equal(readJobThinking(d, null), true);
  assert.equal(readJobThinking(path.join(d, 'nope'), null), false, 'no record at all (a job signed before am25) is box off');
});

async function draftAndSign(draftThinking) {
  const fx = job2Fixture();
  const work = tmp('d2');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const dir = path.join(work, 'draft');
  const root = path.join(work, 'flows');
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY', draftThinking,
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const s = signDraft({ dir, approve: r.hash, signedBy: 'alice' });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  return { dir, flowDir: path.join(root, 'job2') };
}

test('D2: the box ticked when the job is drafted and signed is stored with the signed job', async () => {
  const { dir, flowDir } = await draftAndSign('on');
  assert.equal(readModelRecord(dir)?.thinking, true);
  assert.equal(readModelRecord(flowDir)?.thinking, true);
  assert.equal(readJobThinking(flowDir, null), true);
});

test('D3: the box unticked stores no thinking: the signed job reads as box off', async () => {
  const { flowDir } = await draftAndSign('off');
  assert.equal(readModelRecord(flowDir)?.thinking, undefined);
  assert.equal(readJobThinking(flowDir, null), false);
});
