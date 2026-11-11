// M13 am9: the file holds the whole job. The last Ask before the added `write it out` shows every step's result in job order (built by code from the saved
// outputs), what is accepted there is exactly what the send writes, and the plan reads every step. $0, fake modelStep.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk, sha256Hex, serializeArtifact } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { validateDeclaration } from '../src/declaration.js';
import { parseSignedText } from '../src/signed-text.js';
import { wholeJobText, wholeJobAskIndex, readEveryStep } from '../src/whole-job.js';
import { SEND_DIR } from './send-sandbox.js';

const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CATALOGUE = cat.primitives;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const shipped = (runId) => (existsSync(SEND_DIR) ? readdirSync(SEND_DIR).filter((f) => f.includes(`-${runId}-`)) : []);
const clean = (runId) => { for (const f of shipped(runId)) rmSync(path.join(SEND_DIR, f), { force: true }); };

// work, ask, work, added ask, added write
const PROSE = (last = '4. ask 1h: check the result with me\n5. write it out') => `1. Write the first note
2. ask 1h: look at the first note
3. Write the second note
${last}

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $1 per run
guardrail: send at line 5 to file:${SEND_DIR}
`;
const step = (goal, fromLine, emits, reads, primitives = []) => ({ goal, primitives, reads, emits, fromLine, close: { class: 'hitl' } });
const declaration = (lastAskReads) => ({
  guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {},
  steps: [
    step('Write the first note', 1, 'n1', [], ['read']),
    step('look at the first note', 2, 'a1', ['n1']),
    step('Write the second note', 3, 'n2', ['n1'], ['read']),
    step('check the result with me', 4, 'a2', lastAskReads),
    step('write it out', 5, 'out', ['a2'], ['write']),
  ],
});
const WANT = '## Line 1: Write the first note\nTEXT ONE\n\nLine 2: you accepted this at the Ask.\n\n## Line 3: Write the second note\nTEXT TWO';

let modelRound = 0;
const modelStep = async (ctx) => {
  if (ctx.goal === 'Write the first note') return { ok: true, costUsd: 0.001, artifact: { text: 'TEXT ONE', done: true } };
  if (ctx.goal === 'Write the second note') { modelRound += 1; return { ok: true, costUsd: 0.001, artifact: { text: modelRound === 1 ? 'TEXT TWO' : 'TEXT TWO REDONE', done: true } }; }
  throw new Error(`unexpected goal: ${ctx.goal}`);
};
const root = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-am9-'));
const sign = (r, name, prose = PROSE(), decl = declaration(['n2', 'n1'])) => {
  const w = writeFlow({ root: r, name, proseText: prose, declaration: decl, signedBy: 'hamr', signedAt: '2026-11-08T10:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
};
const args = (r, name, runId, extra = {}) => ({
  root: r, name, runId, catalogue: CATALOGUE, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-08', ...extra,
});
/** an in-process asker: accepts every ask; records the evidence each ask was shown; `redoOnce` answers the last Ask with one redo first */
const asker = ({ redoOnce = false } = {}) => {
  const shown = [];
  let redone = false;
  const fn = async ({ question, evidence }) => {
    shown.push({ question, artifact: evidence.artifact });
    if (redoOnce && question === 'check the result with me' && !redone) { redone = true; return { decision: 'redo', reason: 'again please' }; }
    return { decision: 'accept', artifactSha256: sha256Hex(serializeArtifact(evidence.artifact)) };
  };
  return { fn, shown };
};

test('the whole-job text: sections in job order, an earlier Ask one line, the last Ask and the send not sections (byte-exact)', async () => {
  const r = root(); clean('am9-text'); modelRound = 0;
  sign(r, 'j');
  const a = asker();
  const res = await runFlow(args(r, 'j', 'am9-text', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  assert.equal(a.shown.length, 2);
  assert.deepEqual(a.shown[0].artifact, { text: 'TEXT ONE' }, 'an earlier Ask shows its one step, as today');
  assert.deepEqual(a.shown[1].artifact, { text: WANT });
  assert.equal(readJson(path.join(res.runDir, 'artifacts', 'a2.json')).text, WANT, 'the accepted artifact is the whole text');
  const files = shipped('am9-text');
  assert.equal(files.length, 1);
  assert.equal(readFileSync(path.join(SEND_DIR, files[0]), 'utf8'), WANT, 'the send writes exactly the accepted whole text');
  clean('am9-text');
});

test('the last line is already an Ask: it is the last Ask (no second one), same text', async () => {
  const r = root(); clean('am9-ownask');
  const prose = `1. Write the first note
2. ask 1h: look at the first note
3. Write the second note
4. ask 1h: is this fine?
5. write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $1 per run
guardrail: send at line 5 to file:${SEND_DIR}
`;
  const decl = declaration(['n2', 'n1']); decl.steps[3].goal = 'is this fine?';
  sign(r, 'j', prose, decl); modelRound = 0;
  const a = asker();
  const res = await runFlow(args(r, 'j', 'am9-ownask', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  assert.deepEqual(a.shown[1], { question: 'is this fine?', artifact: { text: WANT } });
  clean('am9-ownask');
});

test('a work step with no readable saved output: the Ask refuses, naming the step; nothing is shown or sent', () => {
  const steps = declaration([]).steps;
  const askLines = new Map([[2, {}], [4, {}]]);
  const read = (id) => (id === 'n2' ? { ok: false, missing: true } : { ok: true, value: { text: 'x' } });
  const out = wholeJobText({ steps, askLines, lastAskIndex: 3, readResult: read });
  assert.equal(out.ok, false);
  assert.equal(out.red, 'ask: the saved output "n2" of step "Write the second note" is missing — refusing to show the whole job');
  const red = wholeJobText({ steps, askLines, lastAskIndex: 3, readResult: (id) => (id === 'n1' ? { ok: false, missing: false, red: 'artifact "n1" is not valid JSON' } : { ok: true, value: { text: 'x' } }) });
  assert.equal(red.red, 'ask: the saved output "n1" of step "Write the first note" — artifact "n1" is not valid JSON');
});

test('the run refuses at the last Ask when a step output is gone, naming the step; the Ask is never shown, nothing is sent', async () => {
  const r = root(); clean('am9-gone'); modelRound = 0;
  sign(r, 'j');
  const shown = [];
  const askStep = async ({ question, evidence, runDir }) => {
    shown.push(question);
    if (question === 'look at the first note') rmSync(path.join(runDir, 'artifacts', 'n1.json')); // gone before the last Ask builds the file
    return { decision: 'accept', artifactSha256: sha256Hex(serializeArtifact(evidence.artifact)) };
  };
  const res = await runFlow(args(r, 'j', 'am9-gone', { askStep, sources: [] }));
  assert.equal(res.outcome, 'red');
  assert.equal(res.red, 'ask: the saved output "n1" of step "Write the first note" is missing — refusing to show the whole job');
  assert.deepEqual(shown, ['look at the first note']);
  assert.deepEqual(shipped('am9-gone'), []);
});

test('redo rebuilds the text from the redone step (in-process)', async () => {
  const r = root(); clean('am9-redo'); modelRound = 0;
  sign(r, 'j');
  const a = asker({ redoOnce: true });
  const res = await runFlow(args(r, 'j', 'am9-redo', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  const last = a.shown.filter((s) => s.question === 'check the result with me');
  assert.equal(last.length, 2);
  assert.equal(last[0].artifact.text, WANT);
  assert.equal(last[1].artifact.text, WANT.replace('TEXT TWO', 'TEXT TWO REDONE'));
  const files = shipped('am9-redo');
  assert.equal(readFileSync(path.join(SEND_DIR, files[0]), 'utf8'), WANT.replace('TEXT TWO', 'TEXT TWO REDONE'));
  clean('am9-redo');
});

test('resume rebuilds the text: parked ask.json holds it, the accept ships it byte for byte', async () => {
  const r = root(); clean('am9-resume'); modelRound = 0;
  sign(r, 'j');
  const parked1 = await runFlow(args(r, 'j', 'am9-resume', { askStep: makeParkingAskStep(), sources: [] }));
  assert.equal(parked1.outcome, 'paused', parked1.red);
  assert.equal(answerAsk({ runDir: parked1.runDir, askId: parked1.askId, decision: 'accept' }).ok, true);
  const parked2 = await resumeRun(args(r, 'j', 'am9-resume'));
  assert.equal(parked2.outcome, 'paused', parked2.red);
  assert.deepEqual(readJson(path.join(parked2.runDir, 'ask.json')).evidence.artifact, { text: WANT });
  assert.equal(answerAsk({ runDir: parked2.runDir, askId: parked2.askId, decision: 'redo', reason: 'again please' }).ok, true);
  const parked3 = await resumeRun(args(r, 'j', 'am9-resume'));
  assert.equal(parked3.outcome, 'paused', parked3.red);
  assert.deepEqual(readJson(path.join(parked3.runDir, 'ask.json')).evidence.artifact, { text: WANT.replace('TEXT TWO', 'TEXT TWO REDONE') }, 'a redo on the resume path rebuilds it');
  assert.equal(answerAsk({ runDir: parked3.runDir, askId: parked3.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun(args(r, 'j', 'am9-resume'));
  assert.equal(done.outcome, 'complete', done.red);
  const files = shipped('am9-resume');
  assert.equal(readFileSync(path.join(SEND_DIR, files[0]), 'utf8'), WANT.replace('TEXT TWO', 'TEXT TWO REDONE'));
  clean('am9-resume');
});

test('a 1-byte change to the output of a step after the accept is refused at the send; nothing is written', async () => {
  const r = root(); clean('am9-tamper'); modelRound = 0;
  sign(r, 'j');
  const parked1 = await runFlow(args(r, 'j', 'am9-tamper', { askStep: makeParkingAskStep(), sources: [] }));
  assert.equal(answerAsk({ runDir: parked1.runDir, askId: parked1.askId, decision: 'accept' }).ok, true);
  const parked2 = await resumeRun(args(r, 'j', 'am9-tamper'));
  assert.equal(answerAsk({ runDir: parked2.runDir, askId: parked2.askId, decision: 'accept' }).ok, true);
  const f = path.join(parked2.runDir, 'artifacts', 'n2.json'); // after the accept, before the send: the whole text is rebuilt from what is on disk
  const before = readFileSync(f, 'utf8');
  assert.ok(before.includes('TEXT TWO'));
  writeFileSync(f, before.replace('TEXT TWO', 'TEXT TWo'));
  const res = await resumeRun(args(r, 'j', 'am9-tamper'));
  assert.equal(res.outcome, 'red');
  assert.match(res.red, /the artifact changed after it was accepted/);
  assert.deepEqual(shipped('am9-tamper'), []);
});

test('a job signed before am8 (the send line is the person\'s own words) is unchanged: the Ask shows its one step', async () => {
  const r = root(); clean('am9-old'); modelRound = 0;
  const prose = PROSE('4. ask 1h: check it with me\n5. and write the result out');
  const decl = declaration(['n2']); decl.steps[3].goal = 'check it with me'; decl.steps[4].goal = 'and write the result out';
  sign(r, 'j', prose, decl);
  const a = asker();
  const res = await runFlow(args(r, 'j', 'am9-old', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  assert.deepEqual(a.shown[1].artifact, { text: 'TEXT TWO' });
  const files = shipped('am9-old');
  assert.equal(readFileSync(path.join(SEND_DIR, files[0]), 'utf8'), 'TEXT TWO');
  assert.equal(wholeJobAskIndex({ steps: decl.steps, askLines: new Map([[2, {}], [4, {}]]), sendLines: new Map([[5, { line: 5 }]]) }), -1);
  clean('am9-old');
});

test('plan: code sets the last Ask to read every work step (nearest first), only for an am8 plan; validateDeclaration accepts it', () => {
  const p = parseSignedText(PROSE());
  assert.equal(p.ok, true);
  const model = declaration(['n2']); // what the drafter sent: one read
  const set = readEveryStep(model.steps, p.arbiter);
  assert.deepEqual(set[3].reads, ['n2', 'n1']);
  assert.deepEqual(set.filter((_, i) => i !== 3), model.steps.filter((_, i) => i !== 3), 'no other step changes');
  const v = validateDeclaration({ ...model, steps: set }, { arbiter: p.arbiter, lines: p.lines, catalogue: CATALOGUE, verbatimGoals: true, fitJobLine: true });
  assert.equal(v.ok, true, JSON.stringify(v.reds));
  const old = parseSignedText(PROSE('4. ask 1h: check it with me\n5. and write the result out'));
  const oldSteps = declaration(['n2']).steps.map((x) => (x.fromLine === 5 ? { ...x, goal: 'and write the result out' } : x));
  assert.equal(readEveryStep(oldSteps, old.arbiter), oldSteps, 'an old plan comes back as it was');
});
