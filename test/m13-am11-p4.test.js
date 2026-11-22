// M13 am11 P4 + am11a: before the action writes or sends, what goes out is compared by sha256 with what was accepted at the last Ask in this run. Same: it goes, no stop.
// Changed, or nothing accepted this run: the run stops once (an ask record with kind `action-stop`), Accept ships, Not now (the Stop) ends it with nothing written. The wait is the
// last Ask's, else the card's Ask wait kept in the signed values. Real runFlow / resumeRun / answerAsk / stopParkedRun, fake modelStep, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep, stopParkedRun, readAsk } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { decideAction, STOP_CHANGED, STOP_UNSEEN, stopWaitMs } from '../src/action-stop.js';
import { SEND_DIR } from './send-sandbox.js';

const CATALOGUE = loadCatalogue().primitives;
// M15 am3: the report is `<job>-YYYY-MM-DD.md`, so the folder (this process's own, emptied after every test) is listed whole
const shipped = () => (existsSync(SEND_DIR) ? readdirSync(SEND_DIR) : []);
const clean = () => { for (const f of shipped()) rmSync(path.join(SEND_DIR, f), { force: true }); };
const root = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-am11p4-'));
const step = (goal, fromLine, emits, reads, primitives = []) => ({ goal, primitives, reads, emits, fromLine, close: { class: 'hitl' } });
const modelStep = async (ctx) => {
  if (ctx.goal === 'Write the note') return { ok: true, costUsd: 0.001, artifact: { text: 'NOTE', done: true } };
  if (ctx.goal === 'Tidy the note') return { ok: true, costUsd: 0.001, artifact: { text: 'NOTE TIDY', done: true } };
  throw new Error(`unexpected goal: ${ctx.goal}`);
};
const args = (r, runId, extra = {}) => ({ root: r, name: 'j', runId, catalogue: CATALOGUE, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-16', sources: [], ...extra });
const sign = (r, prose, steps) => {
  const w = writeFlow({ root: r, name: 'j', proseText: prose, declaration: { guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {}, steps }, signedBy: 'hamr', signedAt: '2026-11-16T10:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
};
const ARB = `\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $1 per run\nguardrail: send at line N to file:${SEND_DIR}\n`;
// no Ask: work, work, action
const NOASK = `1. Write the note\n2. Tidy the note\n3. Write it out\n${ARB.replace('line N', 'line 3')}`;
const NOASK_STEPS = [step('Write the note', 1, 'n1', [], ['read']), step('Tidy the note', 2, 'n2', ['n1'], ['read']), step('Write it out', 3, 'out', ['n2'], ['write'])];
// Ask then work then action: the result changes after the accept
const CHANGED = `1. Write the note\n2. ask 30m: look at the note\n3. Tidy the note\n4. Write it out\n${ARB.replace('line N', 'line 4')}`;
const CHANGED_STEPS = [step('Write the note', 1, 'n1', [], ['read']), step('look at the note', 2, 'a1', ['n1']), step('Tidy the note', 3, 'n2', ['a1'], ['read']), step('Write it out', 4, 'out', ['n2'], ['write'])];
// Ask directly before the action: nothing changed
const SAME = `1. Write the note\n2. ask 30m: look at the note\n3. Write it out\n${ARB.replace('line N', 'line 3')}`;
const SAME_STEPS = [step('Write the note', 1, 'n1', [], ['read']), step('look at the note', 2, 'a1', ['n1']), step('Write it out', 3, 'out', ['a1'], ['write'])];

test('decideAction: the same sha goes; a different one says changed; none (null, empty) says unseen', () => {
  const o = { text: 'x' };
  const same = decideAction({ acceptedSha: decideAction({ acceptedSha: null, outgoing: o }).outgoingSha, outgoing: o });
  assert.equal(same.go, true);
  assert.equal(decideAction({ acceptedSha: 'abc', outgoing: o }).question, STOP_CHANGED);
  assert.equal(decideAction({ acceptedSha: null, outgoing: o }).question, STOP_UNSEEN);
  assert.equal(decideAction({ acceptedSha: '', outgoing: o }).question, STOP_UNSEEN);
});

test('stopWaitMs: the last Ask\'s wait when the job has an Ask; else the signed card wait; else 1h', () => {
  const steps = [{ fromLine: 1 }, { fromLine: 2 }, { fromLine: 3 }];
  assert.equal(stopWaitMs(steps, 2, new Map([[2, { ttlMs: 1800000 }]]), 7200000), 1800000);
  assert.equal(stopWaitMs(steps, 2, new Map(), 7200000), 7200000);
  assert.equal(stopWaitMs(steps, 2, new Map(), undefined), 3600000);
});

test('an Ask right before the action, nothing changed: it goes with no extra stop', async () => {
  const r = root(); clean(); sign(r, SAME, SAME_STEPS);
  const p1 = await runFlow(args(r, 'p4-same', { askStep: makeParkingAskStep() }));
  assert.equal(p1.outcome, 'paused', p1.red);
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const res = await resumeRun({ ...args(r, 'p4-same'), askStep: undefined });
  assert.equal(res.outcome, 'complete', res.red);
  assert.equal(shipped().length, 1);
  clean();
});

test('the result changed after the last accept: the run stops once, "This changed since you accepted it.", Accept ships what was shown', async () => {
  const r = root(); clean(); sign(r, CHANGED, CHANGED_STEPS);
  const p1 = await runFlow(args(r, 'p4-chg', { askStep: makeParkingAskStep() }));
  assert.equal(p1.outcome, 'paused', p1.red);
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const p2 = await resumeRun(args(r, 'p4-chg'));
  assert.equal(p2.outcome, 'paused', p2.red);
  assert.deepEqual(shipped(), [], 'nothing written yet');
  const ask = readAsk(p2.runDir);
  assert.equal(ask.question, STOP_CHANGED);
  assert.equal(ask.kind, 'action-stop');
  assert.deepEqual(ask.evidence.artifact, { text: 'NOTE TIDY' });
  const wait = Date.parse(ask.expiresAt) - Date.parse(ask.askedAt);
  assert.equal(wait, 1800000, 'the last Ask\'s own wait');
  assert.equal(answerAsk({ runDir: p2.runDir, askId: p2.askId, decision: 'redo', reason: 'again' }).ok, false, 'the stop takes Accept only');
  assert.equal(answerAsk({ runDir: p2.runDir, askId: p2.askId, decision: 'accept' }).ok, true);
  const p3 = await resumeRun(args(r, 'p4-chg'));
  assert.equal(p3.outcome, 'complete', p3.red);
  const files = shipped();
  assert.equal(files.length, 1);
  assert.match(readFileSync(path.join(SEND_DIR, files[0]), 'utf8'), /NOTE TIDY/);
  clean();
});

test('no accept in this run: "You have not seen this yet."; the wait is the card\'s 1h when the job has no Ask', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'p4-none', { askStep: makeParkingAskStep() }));
  assert.equal(p1.outcome, 'paused', p1.red);
  const ask = readAsk(p1.runDir);
  assert.equal(ask.question, STOP_UNSEEN);
  assert.equal(Date.parse(ask.expiresAt) - Date.parse(ask.askedAt), 3600000);
  assert.deepEqual(shipped(), []);
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const res = await resumeRun(args(r, 'p4-none'));
  assert.equal(res.outcome, 'complete', res.red);
  assert.equal(shipped().length, 1);
  // M15 am4: a job with no Ask writes every work line (what the stop showed and the accept hashed): line 1 and line 2
  assert.match(readFileSync(path.join(SEND_DIR, shipped()[0]), 'utf8'), /\n## 1\. Write the note\n\n### The AI's answer \(not checked — you judge it at Accept\)\nNOTE\n\n## 2\. Tidy the note\n\n### The AI's answer \(not checked — you judge it at Accept\)\nNOTE TIDY\n$/);
  clean();
});

test('Not now is the Stop: the run ends stopped, nothing written, $0; Resume asks again', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'p4-not', { askStep: makeParkingAskStep() }));
  assert.equal(p1.outcome, 'paused', p1.red);
  const stopped = await stopParkedRun({ root: r, name: 'j', runId: 'p4-not', catalogue: CATALOGUE });
  assert.equal(stopped.outcome, 'stopped', stopped.red);
  assert.deepEqual(shipped(), []);
});

test('the wait runs out: the answer is late, nothing goes to the Destination, the run is ask-expired', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'p4-late', { askStep: makeParkingAskStep() }));
  const late = new Date(Date.parse(readAsk(p1.runDir).expiresAt) + 1000).toISOString();
  const ans = answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept', clock: () => new Date(Date.parse(late) - 5000).toISOString() });
  assert.equal(ans.ok, true);
  const file = path.join(p1.runDir, 'answer.json');
  const a = JSON.parse(readFileSync(file, 'utf8')); a.answeredAt = late; writeFileSync(file, JSON.stringify(a));
  const res = await resumeRun(args(r, 'p4-late'));
  assert.equal(res.outcome, 'ask-expired');
  assert.deepEqual(shipped(), []);
});

test('what goes out is changed between the Accept and the send: refused by sha, nothing written', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'p4-tam', { askStep: makeParkingAskStep() }));
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const f = path.join(p1.runDir, 'artifacts', 'n2.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace('NOTE TIDY', 'NOTE TIDX'));
  const res = await resumeRun(args(r, 'p4-tam'));
  assert.equal(res.outcome, 'red');
  assert.match(res.red, /changed after it was accepted/);
  assert.deepEqual(shipped(), []);
});

test('am11a 2: a job with an action and no Ask keeps the card\'s Ask wait in the signed values, under the action\'s line; it reaches the stop', async () => {
  const { flowValues, applyRunValues } = await import('../src/runvalues.js');
  const { parseSignedText } = await import('../src/signed-text.js');
  const { arbiter } = parseSignedText(NOASK);
  const own = flowValues(arbiter);
  assert.deepEqual(own.askWaits, { 3: '1h' });
  const picked = { ok: true, version: 0, record: { flow: 'j', flowSignatureHash: 'h', values: { capUsd: 1, destination: SEND_DIR, askWaits: { 3: '2h' } } } };
  const applied = applyRunValues(arbiter, 'j', 'h', picked);
  assert.equal(applied.ok, true, applied.ok ? '' : applied.red);
  assert.equal(applied.arbiter.sends[0].waitMs, 7200000);
  assert.deepEqual(flowValues(parseSignedText(CHANGED).arbiter).askWaits, { 2: '30m' }, 'a job with an Ask keeps only its Ask waits');
});
