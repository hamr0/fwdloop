// M4e amendment 13 (SIGNED 2026-10-07): a Stop waits for the turn in flight, then stops; if that turn leads to an ask, or the run
// already waits at one, the run stops AT the ask — rows "stop asked (you) at <time>" then "stopped at the ask of step N", no ask waits,
// no wait expires. Resume asks again, fresh, on the same output, with no model call ($0). An answer to the old ask is never used.
// `not honoured` stays for a run that completes or halts first. $0: a fake modelStep; the door test drives the real panel over HTTP
// with the gated test model step. Every temp dir is removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import * as R from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import {
  getRunControls, getRunDetail, getRunAsks, listStops,
} from '../src/panel/data.js';
import {
  GATED_STEP, killChildrenAfter, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

const {
  runFlow, resumeRun, continueRun, makeParkingAskStep, STOP_FILE, HALT_FILE, requestStop, readHaltRecord,
} = R;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CAT = cat.primitives;

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am13-${tag}-`));
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
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const AT_ASK = 'stopped at the ask of step 4';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** The shape every stop-at-ask must leave: the two rows, no ask waiting, a halt record at the ask, books balanced. */
function assertStoppedAtAsk(w, label) {
  const rows = stopRows(w.runDir);
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stopped'], `${label}: rows ${JSON.stringify(rows.map((x) => x.gap))}`);
  assert.match(rows[0].gap, /^stop asked \(you\) at \d{4}-\d\d-\d\dT/, label);
  assert.equal(rows[1].gap, AT_ASK, label);
  assert.equal(existsSync(path.join(w.runDir, 'ask.json')), false, `${label}: no ask.json left waiting`);
  assert.equal(existsSync(path.join(w.runDir, STOP_FILE)), false, `${label}: the request is consumed`);
  const halt = readHaltRecord(w.runDir);
  assert.equal(halt.ok && halt.halt.stepIndex, 3, `${label}: resumable at the ask step`);
  assert.equal(halt.halt.outcome, 'stopped');
  const hist = readHistory(w.flowDir).at(-1);
  assert.equal(hist.outcome, 'stopped', label);
  assert.ok(Math.abs(hist.spentUsd - auditSum(w.runDir)) < 1e-9, `${label}: books balance, history ${hist.spentUsd} vs audit ${auditSum(w.runDir)}`);
  assert.equal(readJson(path.join(w.runDir, 'log.json')).outcome, 'stopped', `${label}: log.json kept`);
}

/** Park job2 at its ask (no Stop). */
async function parked(tag) {
  const w = mk(tag);
  const f = fake();
  const r = await runFlow({ ...args(w, f.fn), sources: w.sources });
  assert.equal(r.outcome, 'paused', r.red);
  w.model = f;
  w.ask = readJson(path.join(w.runDir, 'ask.json'));
  return w;
}
/** The Stop on a run that already waits: the door writes the request, then stops the parked run. */
async function stopWaiting(w) {
  requestStop(w.runDir);
  assert.equal(typeof R.stopParkedRun, 'function', 'the runner exports stopParkedRun');
  return R.stopParkedRun({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT,
  });
}

test('am13 (a) a Stop pending when the turn leads to the ask: the run ends stopped AT the ask of step 4 — rows, no ask.json, no paused row', async () => {
  const w = mk('a1');
  const { fn } = fake({ onCall: (n) => { if (n === 1) requestStop(w.runDir); } });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assertStoppedAtAsk(w, 'a1');
  assert.ok(!readAudit(w.runDir).some((x) => x.verdict === 'paused'), 'no ask was ever parked');
  assert.deepEqual(existsSync(path.join(w.runDir, 'asks')) ? readdirSync(path.join(w.runDir, 'asks')) : [], [], 'no ask archived either');
  assert.equal(existsSync(path.join(w.runDir, 'artifacts', 'resume-summary.json')), true, 'step 3 closed cleanly');
});

test('am13 (a) a Stop that lands inside the ask step itself (as it parks) also stops at the ask — not "paused", not "not honoured"', async () => {
  const w = mk('a2');
  const { fn } = fake();
  const parkAndStop = async () => { requestStop(w.runDir); return { decision: 'park' }; };
  const r = await runFlow({ ...args(w, fn, { askStep: parkAndStop }), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assertStoppedAtAsk(w, 'a2');
});

test('am13 (a) the post-park race: a Stop that lands after the ask is written but before the park returns still stops at the ask, ask archived and set aside', async () => {
  const w = mk('a3');
  const { fn } = fake();
  let fired = false;
  const clock = () => {
    if (!fired && existsSync(path.join(w.runDir, 'ask.json')) && existsSync(path.join(w.runDir, 'state.json'))) { fired = true; requestStop(w.runDir); }
    return new Date().toISOString();
  };
  const r = await runFlow({ ...args(w, fn, { clock }), sources: w.sources });
  assert.equal(fired, true, 'the stop was fired after the ask was written');
  assert.equal(r.outcome, 'stopped', r.red);
  assertStoppedAtAsk(w, 'a3');
});

test('am13 (a) a Stop during a human-redo re-run whose turn leads back to the ask stops at the ask', async () => {
  const w = await parked('a4');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'redo', reason: 'again please' }).ok, true);
  const redo = fake({ onCall: () => { requestStop(w.runDir); } });
  const r = await resumeRun(args(w, redo.fn));
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(stopRows(w.runDir).at(-1).gap, AT_ASK);
  const d = getRunDetail({
    root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(d.glyph, '[■]', 'the old, answered ask is not left waiting');
  assert.equal(d.controls.canResume, true);
  assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 3);
});

test('am13 (b) Stop on a run already waiting at its ask: it is offered, and stops the run at the ask — same rows, no ask.json, $0', async () => {
  const w = await parked('b1');
  const before = auditSum(w.runDir);
  const controls = getRunControls({
    root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(controls.canStop, true, 'the Stop control is offered on a waiting run');
  assert.equal(controls.stopRequested, false);
  const r = await stopWaiting(w);
  assert.equal(r.outcome, 'stopped', r.red);
  assertStoppedAtAsk(w, 'b1');
  assert.equal(auditSum(w.runDir), before, 'a stop spends nothing');
  assert.equal(w.model.calls.length, 3, 'no model call');
  const d = getRunDetail({
    root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(d.glyph, '[■]');
  assert.equal(d.controls.canStop, false);
  assert.equal(d.controls.canResume, true);
});

test('am13 (b) Stop is refused for a run that is not waiting (answer already consumed / ended): nothing is converted', async () => {
  const w = await parked('b2');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun(args(w, w.model.fn));
  assert.equal(done.outcome, 'complete', done.red);
  const r = await R.stopParkedRun?.({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.ok(r && r.outcome === 'refused', `a finished run is not stopped: ${JSON.stringify(r)}`);
  assert.equal(readHistory(w.flowDir).at(-1).outcome, 'complete');
  assert.equal(existsSync(path.join(w.runDir, HALT_FILE)), false);
});

test('am13 (b) the Stop door over HTTP: a waiting run -> 202, the run ends [■] stopped with Resume offered, no ask.json; the Stop control was on the page data first', async () => {
  const w = await world({ step: GATED_STEP });
  await w.signedFlow();
  writeFileSync(w.gate, 'go'); // the gated step runs straight through to the ask
  const runDir = path.join(w.root, 'job2', 'runs', 'r2');
  const start = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r2' })).json();
  await until(async () => { const j = (await w.get(`/api/author/start/${start.startId}`)).json(); return j?.phase === 'started' && j.state === 'parked' ? j : null; });
  const shown = (await w.get('/api/runs/job2/r2')).json();
  assert.equal(shown.controls.canStop, true, 'a waiting run shows Stop');
  const ok = await w.post('/api/stop', { flow: 'job2', runId: 'r2' });
  assert.equal(ok.status, 202, ok.text);
  const end = (await w.get('/api/runs/job2/r2')).json();
  assert.equal(end.glyph, '[■]');
  assert.equal(end.controls.canResume, true);
  assert.equal(end.controls.canStop, false);
  assert.equal(existsSync(path.join(runDir, 'ask.json')), false);
  assert.deepEqual(stopRows(runDir).map((x) => x.verdict), ['stop-asked', 'stopped']);
  assert.match(stopRows(runDir)[1].gap, /^stopped at the ask of step \d+$/);
  const again = await w.post('/api/stop', { flow: 'job2', runId: 'r2' });
  assert.equal(again.status, 409, 'a second Stop on the stopped run is refused in words');
});

test('am13 (c) a stopped-at-ask run never expires: even with the old deadline in the past, the ask reads stopped, the Inbox holds no open row, answering and resuming refuse, no ask-expired row', async () => {
  const w = await parked('c1');
  const r = await stopWaiting(w);
  assert.equal(r.outcome, 'stopped', r.red);
  // time passes: the archived ask's deadline is now long gone
  const archive = path.join(w.runDir, 'asks', `${w.ask.askId}.json`);
  writeFileSync(archive, JSON.stringify({ ...readJson(archive), expiresAt: '2020-01-01T00:00:00.000Z' }));
  const asks = getRunAsks({
    root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(asks.asks[0].status, 'stopped', `the stopped ask is not "expired": ${asks.asks[0].status}`);
  assert.equal(asks.asks.some((a) => a.open || a.waiting), false);
  assert.equal(listStops({ root: w.root }).some((s) => s.runId === 'run-1' && s.open), false, 'no open Inbox row');
  const late = answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' });
  assert.equal(late.ok, false, 'no answer can be written to a stopped ask');
  assert.doesNotMatch(late.red, /expired/);
  const tryResume = await resumeRun(args(w, w.model.fn));
  assert.equal(tryResume.outcome, 'refused');
  assert.ok(!readAudit(w.runDir).some((x) => x.verdict === 'ask-expired'), 'the expiry path never touched it');
  assert.equal(readHistory(w.flowDir).filter((h) => h.outcome === 'ask-expired').length, 0);
});

test('am13 (d) Resume of a stopped-at-ask run asks again, fresh: a NEW askId on the SAME artifact, its own wait from the signed wait, zero model calls, $0 booked', async () => {
  const w = await parked('d1');
  const first = w.ask;
  const waitMs = Date.parse(first.expiresAt) - Date.parse(first.askedAt);
  const spentBefore = auditSum(w.runDir);
  assert.equal((await stopWaiting(w)).outcome, 'stopped');
  const calls0 = w.model.calls.length;
  const r = await continueRun(args(w, w.model.fn));
  assert.equal(r.outcome, 'paused', r.red);
  assert.equal(w.model.calls.length, calls0, 'zero provider calls on Resume');
  assert.equal(auditSum(w.runDir), spentBefore, '$0 booked');
  const ask = readJson(path.join(w.runDir, 'ask.json'));
  assert.notEqual(ask.askId, first.askId, 'a new ask');
  assert.deepEqual(ask.evidence.artifact, first.evidence.artifact, 'on the same output');
  assert.equal(Date.parse(ask.expiresAt) - Date.parse(ask.askedAt), waitMs, 'its own wait, the signed one');
  assert.ok(Date.parse(ask.askedAt) > Date.parse(first.askedAt) - 1, 'asked fresh');
  const d = getRunDetail({
    root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(d.glyph, '[·]', 'waiting again');
  assert.equal(d.controls.canStop, true, 'and Stop is offered again');
  // and the new ask answers normally
  assert.equal(answerAsk({ runDir: w.runDir, askId: ask.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun(args(w, w.model.fn));
  assert.equal(done.outcome, 'complete', done.red);
});

test('am13 (d) the same for a stop that never parked (turn led to the ask): Resume asks, once, fresh, without a model call', async () => {
  const w = mk('d2');
  const a = fake({ onCall: (n) => { if (n === 1) requestStop(w.runDir); } });
  assert.equal((await runFlow({ ...args(w, a.fn), sources: w.sources })).outcome, 'stopped');
  const calls0 = a.calls.length;
  const r = await continueRun(args(w, a.fn));
  assert.equal(r.outcome, 'paused', r.red);
  assert.equal(a.calls.length, calls0, 'zero model calls');
  const ask = readJson(path.join(w.runDir, 'ask.json'));
  assert.equal(ask.evidence.artifact.text, GOOD);
  assert.equal(readAudit(w.runDir).filter((x) => x.verdict === 'paused').length, 1, 'one park');
  assert.ok(Math.abs(readHistory(w.flowDir).filter((h) => h.runId === 'run-1').at(0).spentUsd - auditSum(w.runDir)) < 1e-9, 'books balance');
});

test('am13 (d) a redo counted before the stop is still counted after Resume (the redo cap is not reset by a Stop)', async () => {
  const w = await parked('d3');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'redo', reason: 'again please' }).ok, true);
  const redo = fake({ onCall: () => { requestStop(w.runDir); } });
  assert.equal((await resumeRun(args(w, redo.fn))).outcome, 'stopped');
  const r = await continueRun(args(w, redo.fn));
  assert.equal(r.outcome, 'paused', r.red);
  assert.equal(readJson(path.join(w.runDir, 'state.json')).redone, 1, 'one redo already spent');
});

test('am13 (e) an answer saved to the OLD ask is never used: Stop moves it aside, Resume does not consume it, a hand-placed one is refused by name', async () => {
  const w = await parked('e1');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
  requestStop(w.runDir);
  const r = await R.stopParkedRun?.({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(r?.outcome, 'stopped', JSON.stringify(r));
  assert.equal(existsSync(path.join(w.runDir, 'answer.json')), false, 'the old answer is not left to be applied');
  assert.equal(existsSync(path.join(w.runDir, `answer.${w.ask.askId}.consumed.json`)), false, 'and was never consumed');
  assert.ok(readdirSync(w.runDir).some((n) => n.startsWith(`answer.${w.ask.askId}.late.`)), 'kept as a record, set aside');
  const c = await continueRun(args(w, w.model.fn));
  assert.equal(c.outcome, 'paused', c.red);
  const fresh = readJson(path.join(w.runDir, 'ask.json'));
  // someone drops the old answer back in
  writeFileSync(path.join(w.runDir, 'answer.json'), JSON.stringify({ askId: w.ask.askId, decision: 'accept', answeredAt: new Date().toISOString() }));
  const refused = await resumeRun(args(w, w.model.fn));
  assert.equal(refused.outcome, 'refused');
  assert.match(refused.red, /does not match open askId/);
  assert.equal(existsSync(path.join(w.runDir, `answer.${w.ask.askId}.consumed.json`)), false);
  assert.equal(readJson(path.join(w.runDir, 'ask.json')).askId, fresh.askId);
  assert.equal(existsSync(path.join(w.dest, 'job2-run-1-send.json')) || readdirSync(w.dest).length > 0, false, 'nothing was sent');
});

test('am13 (f) the race: a Stop request that landed right after the park, then the answer-Resume: the run is stopped AT the ask — never halted "before step N", the answer unused, nothing sent', async () => {
  const w = await parked('f1');
  requestStop(w.runDir); // landed after the park settled
  await sleep(15);
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
  const r = await resumeRun(args(w, w.model.fn));
  assert.equal(r.outcome, 'stopped', r.red);
  assert.doesNotMatch(r.red, /before step/);
  const rows = stopRows(w.runDir);
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stopped']);
  assert.equal(rows[1].gap, AT_ASK);
  assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 3, 'not step 5');
  assert.equal(existsSync(path.join(w.runDir, `answer.${w.ask.askId}.consumed.json`)), false, 'the answer was not used');
  assert.deepEqual(readdirSync(w.dest), [], 'nothing shipped');
  assert.equal(existsSync(path.join(w.runDir, 'ask.json')), false);
});

/** Park, then save an answer at a fixed instant and write a Stop request stamped `stopAt(answeredAt)` — no wall-clock luck. */
async function stopVsAnswer(tag, stopAt) {
  const w = await parked(tag);
  const answeredAt = new Date(Date.parse(w.ask.askedAt ?? new Date().toISOString()) + 1000).toISOString();
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept', clock: () => answeredAt }).ok, true);
  writeFileSync(path.join(w.runDir, STOP_FILE), `${JSON.stringify(stopAt === undefined ? {} : { at: stopAt(answeredAt) })}\n`);
  return { w, answeredAt, r: await resumeRun(args(w, w.model.fn)) };
}

test('am13 (h) a Stop and an answer in the SAME millisecond: the answer wins — applied, and the fold seam stops BEFORE the send (hamr, 2026-10-07)', async () => {
  const { w, r } = await stopVsAnswer('h1', (a) => a);
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 4, 'resumable at the send step: the answer was applied');
  assert.equal(existsSync(path.join(w.runDir, `answer.${w.ask.askId}.consumed.json`)), true, 'the answer was consumed');
  assert.equal(readdirSync(w.runDir).some((n) => n.startsWith(`answer.${w.ask.askId}.late.`)), false, 'not set aside');
  assert.deepEqual(readdirSync(w.dest), [], 'nothing shipped');
});

test('am13 (h) a Stop asked 1 ms BEFORE the answer was saved still stops AT the ask, the answer set aside (unchanged)', async () => {
  const { w, r } = await stopVsAnswer('h2', (a) => new Date(Date.parse(a) - 1).toISOString());
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 3, 'stopped at the ask');
  assert.equal(existsSync(path.join(w.runDir, `answer.${w.ask.askId}.consumed.json`)), false, 'the answer was not used');
  assert.deepEqual(readdirSync(w.dest), [], 'nothing shipped');
});

test('am13 (h) a Stop whose time is missing (`at` null) still stops AT the ask (conservative, unchanged)', async () => {
  for (const [tag, at] of [['h4', undefined]]) {
    const { w, r } = await stopVsAnswer(tag, at);
    assert.equal(r.outcome, 'stopped', r.red);
    assert.equal(readHaltRecord(w.runDir).halt.stepIndex, 3, `${tag}: stopped at the ask`);
    assert.equal(existsSync(path.join(w.runDir, `answer.${w.ask.askId}.consumed.json`)), false, `${tag}: the answer was not used`);
    assert.deepEqual(readdirSync(w.dest), [], `${tag}: nothing shipped`);
  }
});

test('am13 (g) not honoured stays for a run that COMPLETES first: a Stop landing as the signed send closes leaves "not honoured: the run ended (complete) first"', async () => {
  const w = await parked('g1');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
  const send = async (...a) => { requestStop(w.runDir); return sendViaPrimitive(...a); };
  const done = await resumeRun(args(w, w.model.fn, { sendStep: send }));
  assert.equal(done.outcome, 'complete', done.red);
  const rows = stopRows(w.runDir);
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stop-not-honoured']);
  assert.equal(rows[1].gap, 'not honoured: the run ended (complete) first');
});

test('am13 (g) not honoured stays for a run that HALTS first: a Stop during the try that strikes the step out leaves "(struck-out)"', async () => {
  const w = mk('g2');
  const { fn } = fake({ plan: () => 'red', onCall: (n) => { if (n === 3) requestStop(w.runDir); } });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'struck-out', r.red);
  const rows = stopRows(w.runDir);
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stop-not-honoured']);
  assert.equal(rows[1].gap, 'not honoured: the run ended (struck-out) first');
});

test('am13 control: a run with no Stop parks as before — ask written, no stop rows, the paused row present', async () => {
  const w = await parked('ctl');
  assert.deepEqual(stopRows(w.runDir), []);
  assert.equal(readAudit(w.runDir).filter((x) => x.verdict === 'paused').length, 1);
  assert.equal(existsSync(path.join(w.runDir, HALT_FILE)), false);
});
