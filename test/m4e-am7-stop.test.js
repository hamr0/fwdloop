// M4e amendment 7 item 8 and negative (e): the Stop seam also sits before every model call (every turn inside a try, every new try),
// the model call in flight is booked, Resume re-enters the step as a new try with its tries and spend counted, and EVERY Stop leaves
// audit rows — "stop asked (you) at <time>" then its outcome, `not honoured` included. $0: a fake modelStep, or the real
// `makeLiveModelStep` over a fake provider. Every temp dir is removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import { makeLiveModelStep } from '../src/model-step.js';
import {
  runFlow, resumeRun, continueRun, makeParkingAskStep, STOP_FILE, requestStop, readHaltRecord,
} from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { getRunAudit } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CAT = cat.primitives;

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am7-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
/** A fake modelStep: steps 1-2 always green; step 3 returns `plan(callNo)` ('red' | 'good'); `onCall(callNo)` runs inside the call. */
function fake({ plan = () => 'good', onCall } = {}) {
  const calls = [];
  const fn = async (ctx) => {
    const emits = emitsOf(ctx);
    calls.push(emits);
    const callNo = calls.filter((c) => c === 'resume-summary').length;
    if (emits === 'resume-summary' && onCall) await onCall(callNo);
    if (emits === 'resume-summary' && plan(callNo) === 'red') return { ok: true, costUsd: 0.001, turns: 2, artifact: { text: 'no headings here', done: true } };
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  return { fn, calls };
}
const args = (w, modelStep, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});
const stopRows = (runDir) => readAudit(runDir).filter((r) => /^stop/.test(r.verdict));
const auditSum = (runDir) => readAudit(runDir).reduce((a, r) => a + (typeof r.usd === 'number' ? r.usd : 0), 0);

test('am7 (e) between tries: a Stop that lands during try 1 of a retrying step ends the run stopped BEFORE try 2 — no new call, rows "stop asked" then "stopped after turn 2 of try 1 of step 3"', async () => {
  const w = mk('bt');
  const { fn, calls } = fake({ plan: () => 'red', onCall: (n) => { if (n === 1) requestStop(w.runDir); } });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(calls.filter((c) => c === 'resume-summary').length, 1, 'try 2 never called the model');
  const rows = stopRows(w.runDir);
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stopped']);
  assert.match(rows[0].gap, /^stop asked \(you\) at \d{4}-\d\d-\d\dT/);
  assert.equal(rows[1].gap, 'stopped after turn 2 of try 1 of step 3');
  assert.equal(existsSync(path.join(w.runDir, STOP_FILE)), false, 'the request is consumed, never left');
  const hist = readHistory(w.flowDir).at(-1);
  assert.equal(hist.outcome, 'stopped');
  assert.ok(Math.abs(hist.spentUsd - auditSum(w.runDir)) < 1e-9, `books balance: history ${hist.spentUsd} vs audit ${auditSum(w.runDir)}`);
  assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 2, 'resumable at step 3');
  // the panel serves the stop rows (never dropped, never a crash on their null step)
  const served = getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }).rows.filter((x) => /^stop/.test(x.verdict));
  assert.deepEqual(served.map((x) => x.verdict), ['stop-asked', 'stopped']);
});

test('am7 (e) Resume re-enters the step as a NEW try with its tries and spend so far counted (numbered after, limit shortened by the closed tries)', async () => {
  const w = mk('rs');
  const first = fake({ plan: () => 'red', onCall: (n) => { if (n === 2) requestStop(w.runDir); } });
  const r1 = await runFlow({ ...args(w, first.fn), sources: w.sources });
  assert.equal(r1.outcome, 'stopped', r1.red);
  assert.equal(first.calls.filter((c) => c === 'resume-summary').length, 2, 'tries 1 and 2 ran; try 3 did not');
  // continue: always red -> only the remaining tries run (4 allowed, 2 closed)
  const second = fake({ plan: () => 'red' });
  const r2 = await continueRun(args(w, second.fn));
  assert.equal(r2.outcome, 'attempt-fallback', r2.red);
  assert.equal(second.calls.filter((c) => c === 'resume-summary').length, 2, 'two closed tries counted: only 2 of the 4 remain');
  const attempts = readAudit(w.runDir).filter((x) => x.step === 'resume-summary' && Number.isInteger(x.attempt)).map((x) => x.attempt);
  assert.deepEqual(attempts, [1, 2, 3, 4], 'the new tries are numbered after the old ones');
  assert.ok(Math.abs(r2.spentUsd - auditSum(w.runDir)) < 1e-9, 'spend so far carried: history total equals the audit sum');
  assert.equal(stopRows(w.runDir).length, 2, 'only the one Stop left rows');
});

test('am7 (e) Resume after a Stop completes the step green as try K+1 and the run goes on', async () => {
  const w = mk('rg');
  const first = fake({ plan: () => 'red', onCall: (n) => { if (n === 1) requestStop(w.runDir); } });
  assert.equal((await runFlow({ ...args(w, first.fn), sources: w.sources })).outcome, 'stopped');
  const second = fake();
  const r = await continueRun(args(w, second.fn));
  assert.equal(r.outcome, 'paused', r.red);
  const green = readAudit(w.runDir).find((x) => x.step === 'resume-summary' && x.verdict === 'green');
  assert.equal(green.attempt, 2, 'try 2 after the one that closed red');
});

/** A step-3 modelStep through the REAL makeLiveModelStep over a fake provider; `onGenerate(n)` runs inside provider call n. */
function liveStep3(w, { script, onGenerate }) {
  const gen = { calls: 0 };
  const provider = {
    generate: async () => {
      gen.calls += 1;
      if (onGenerate) onGenerate(gen.calls);
      return script(gen.calls);
    },
  };
  const live = makeLiveModelStep({
    spendPath: path.join(w.runDir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const green = fake();
  const fn = (ctx, tools, meta, seam) => (emitsOf(ctx) === 'resume-summary' ? live(ctx, tools, meta, seam) : green.fn(ctx, tools, meta, seam));
  return { fn, gen };
}
const toolTurn = (id) => ({
  text: '', toolCalls: [{ id, name: 'not_a_granted_tool', arguments: {} }], usage: { inputTokens: 100, outputTokens: 50 }, stopReason: 'tool_calls', model: 'deepseek-flash',
});

test('am7 (e) mid-turn: a Stop that lands during turn 1 of a try stops BEFORE turn 2 — exactly one provider call, that call booked on the stopped row and in spend, books balance', async () => {
  const w = mk('mt');
  const { fn, gen } = liveStep3(w, {
    script: (n) => { if (n === 1) return toolTurn('t1'); throw new Error('no second call may start'); },
    onGenerate: (n) => { if (n === 1) requestStop(w.runDir); },
  });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(gen.calls, 1, 'no new call started after the Stop');
  const cut = readAudit(w.runDir).find((x) => x.verdict === 'stopped');
  assert.equal(cut.gap, 'stopped after turn 1 of try 1 of step 3');
  assert.equal(cut.step, 'resume-summary');
  assert.equal(cut.attempt, 1);
  assert.ok(cut.usd > 0 && cut.tokens?.inputTokens === 100, `the in-flight call is booked: ${JSON.stringify(cut)}`);
  const hist = readHistory(w.flowDir).at(-1);
  assert.ok(Math.abs(hist.spentUsd - auditSum(w.runDir)) < 1e-9, `history ${hist.spentUsd} == audit ${auditSum(w.runDir)}`);
  assert.ok(hist.spentUsd > 0.002 + cut.usd - 1e-9, 'steps 1-2 plus the cut call all counted');
  const spendRows = readFileSync(path.join(w.runDir, 'spend.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(spendRows.length, 1, 'the in-flight call is in the spend ledger');
  assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 2);
});

test('am7 (e) mid-turn Resume: the step re-enters as try 2 (the cut try 1 is replaced, not counted against the limit) and can finish', async () => {
  const w = mk('mr');
  const a = liveStep3(w, { script: () => toolTurn('t1'), onGenerate: (n) => { if (n === 1) requestStop(w.runDir); } });
  assert.equal((await runFlow({ ...args(w, a.fn), sources: w.sources })).outcome, 'stopped');
  const emit = { text: '', toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { text: GOOD, done: true, blocker: null } }], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
  const b = liveStep3(w, { script: (n) => (n === 1 ? emit : { text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', model: 'deepseek-flash' }) });
  const r = await continueRun(args(w, b.fn));
  assert.equal(r.outcome, 'paused', r.red);
  const rows = readAudit(w.runDir).filter((x) => x.step === 'resume-summary' && Number.isInteger(x.attempt));
  assert.deepEqual(rows.map((x) => [x.attempt, x.verdict]), [[1, 'stopped'], [2, 'green']]);
  assert.ok(Math.abs(r.spentUsd - auditSum(w.runDir)) < 1e-9, 'spend so far carried and balanced');
});

test('am7 (e) a Stop that lands during the EMIT turn lets the step close (artifact kept, no wasted second call); the after-step seam ends the run', async () => {
  const w = mk('em');
  const emit = { text: '', toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { text: GOOD, done: true, blocker: null } }], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
  const { fn, gen } = liveStep3(w, { script: () => emit, onGenerate: (n) => { if (n === 1) requestStop(w.runDir); } });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(gen.calls, 1, 'no call after the emit turn');
  assert.ok(existsSync(path.join(w.runDir, 'artifacts', 'resume-summary.json')), 'step 3 closed');
  assert.equal(stopRows(w.runDir).at(-1).gap, 'stopped after step 3');
});

test('am7 (e) a Stop at a step boundary now leaves rows too: "stopped after step 2"', async () => {
  const w = mk('sb');
  const { fn } = fake({ onCall: () => {} });
  let seen = 0;
  const gated = async (ctx, ...rest) => { const out = await fn(ctx, ...rest); seen += 1; if (seen === 2) requestStop(w.runDir); return out; };
  const r = await runFlow({ ...args(w, gated), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.deepEqual(stopRows(w.runDir).map((x) => x.gap.replace(/ at .*/, '')), ['stop asked (you)', 'stopped after step 2']);
});

test('am7 (e) not honoured: a Stop during the try that ends the step red (struck-out, as in hamr\'s walk) leaves "stop asked" and "not honoured: the run ended (struck-out) first"', async () => {
  const w = mk('nh');
  const { fn } = fake({ plan: () => 'red', onCall: (n) => { if (n === 3) requestStop(w.runDir); } });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'struck-out', r.red);
  const rows = stopRows(w.runDir);
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stop-not-honoured']);
  assert.equal(rows[1].gap, 'not honoured: the run ended (struck-out) first');
  assert.equal(existsSync(path.join(w.runDir, STOP_FILE)), false);
  assert.ok(Math.abs(readHistory(w.flowDir).at(-1).spentUsd - auditSum(w.runDir)) < 1e-9, 'books balance');
});

test('am7 (e) not honoured: a Stop as the run parks at its ask leaves "not honoured: the run ended (paused) first"; a Stop that lands as the run COMPLETES leaves "(complete)"', async () => {
  const w = mk('np');
  const { fn } = fake();
  const parkAndStop = async () => { requestStop(w.runDir); return { decision: 'park' }; };
  const p = await runFlow({ ...args(w, fn, { askStep: parkAndStop }), sources: w.sources });
  assert.equal(p.outcome, 'paused', p.red);
  assert.equal(stopRows(w.runDir).at(-1).gap, 'not honoured: the run ended (paused) first');
  const ask = JSON.parse(readFileSync(path.join(w.runDir, 'ask.json'), 'utf8'));
  assert.equal(answerAsk({ runDir: w.runDir, askId: ask.askId, decision: 'accept' }).ok, true);
  const send = async (...a) => { requestStop(w.runDir); return sendViaPrimitive(...a); };
  const done = await resumeRun(args(w, fn, { sendStep: send }));
  assert.equal(done.outcome, 'complete', done.red);
  assert.equal(stopRows(w.runDir).at(-1).gap, 'not honoured: the run ended (complete) first');
  assert.equal(stopRows(w.runDir).length, 4, 'two Stops, two rows each');
});

test('am7 (e) control: a run with no Stop writes no stop rows', async () => {
  const w = mk('nc');
  const { fn } = fake();
  assert.equal((await runFlow({ ...args(w, fn), sources: w.sources })).outcome, 'paused');
  assert.deepEqual(stopRows(w.runDir), []);
});
