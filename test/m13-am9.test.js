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
import { runFlow, resumeRun, makeParkingAskStep, readAsk } from '../src/runner.js';
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
// M15 am3: the send writes `<job>-YYYY-MM-DD.md` (title, Passed line, the accepted body); SEND_DIR is this process's own folder, emptied after every test
const shipped = () => (existsSync(SEND_DIR) ? readdirSync(SEND_DIR) : []);
const clean = () => { for (const f of shipped()) rmSync(path.join(SEND_DIR, f), { force: true }); };
/** the accepted body of a written report: everything under the title and the Passed line */
const bodyOf = (file) => readFileSync(path.join(SEND_DIR, file), 'utf8').split('\n\n').slice(1).join('\n\n').replace(/\n$/, '');
const NOT_CHECKED = "### The AI's answer (not checked — you judge it at Accept)";
const NOCTX = { ok: true, jobLines: [], tables: {}, okIdsOf: () => null };

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
const WANT = `## 1. Write the first note\n\n${NOT_CHECKED}\nTEXT ONE\n\nLine 2: you accepted this at the Ask.\n\n## 3. Write the second note\n\n${NOT_CHECKED}\nTEXT TWO`;

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
  const r = root(); clean(); modelRound = 0;
  sign(r, 'j');
  const a = asker();
  const res = await runFlow(args(r, 'j', 'am9-text', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  assert.equal(a.shown.length, 2);
  assert.deepEqual(a.shown[0].artifact, { text: 'TEXT ONE' }, 'an earlier Ask shows its one step, as today');
  assert.deepEqual(a.shown[1].artifact, { text: WANT });
  assert.equal(readJson(path.join(res.runDir, 'artifacts', 'a2.json')).text, WANT, 'the accepted artifact is the whole text');
  const files = shipped();
  assert.equal(files.length, 1);
  assert.match(files[0], /^j-\d{4}-\d{2}-\d{2}\.md$/, 'M15 am3 item 1: <job name>-YYYY-MM-DD.md');
  assert.equal(bodyOf(files[0]), WANT, 'the send writes exactly the accepted whole text under its title and Passed line');
  assert.match(readFileSync(path.join(SEND_DIR, files[0]), 'utf8'), /^# j\nPassed · \d{1,2} \w{3} \d{4}\n\n## 1\. /, 'no run number can be read from this run id: the title carries none');
  clean();
});

test('the last line is already an Ask: it is the last Ask (no second one), same text', async () => {
  const r = root(); clean();
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
  clean();
});

test('a work step with no readable saved output: the Ask refuses, naming the step; nothing is shown or sent', () => {
  const steps = declaration([]).steps;
  const askLines = new Map([[2, {}], [4, {}]]);
  const read = (id) => (id === 'n2' ? { ok: false, missing: true } : { ok: true, value: { text: 'x' } });
  const out = wholeJobText({ steps, askLines, lastAskIndex: 3, readResult: read, context: NOCTX });
  assert.equal(out.ok, false);
  assert.equal(out.red, 'ask: the saved output "n2" of step "Write the second note" is missing — refusing to show the whole job');
  const red = wholeJobText({ steps, askLines, lastAskIndex: 3, readResult: (id) => (id === 'n1' ? { ok: false, missing: false, red: 'artifact "n1" is not valid JSON' } : { ok: true, value: { text: 'x' } }), context: NOCTX });
  assert.equal(red.red, 'ask: the saved output "n1" of step "Write the first note" — artifact "n1" is not valid JSON');
});

test('the run refuses at the last Ask when a step output is gone, naming the step; the Ask is never shown, nothing is sent', async () => {
  const r = root(); clean(); modelRound = 0;
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
  assert.deepEqual(shipped(), []);
});

test('redo rebuilds the text from the redone step (in-process)', async () => {
  const r = root(); clean(); modelRound = 0;
  sign(r, 'j');
  const a = asker({ redoOnce: true });
  const res = await runFlow(args(r, 'j', 'am9-redo', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  const last = a.shown.filter((s) => s.question === 'check the result with me');
  assert.equal(last.length, 2);
  assert.equal(last[0].artifact.text, WANT);
  assert.equal(last[1].artifact.text, WANT.replace('TEXT TWO', 'TEXT TWO REDONE'));
  const files = shipped();
  assert.equal(bodyOf(files[0]), WANT.replace('TEXT TWO', 'TEXT TWO REDONE'));
  clean();
});

test('resume rebuilds the text: parked ask.json holds it, the accept ships it byte for byte', async () => {
  const r = root(); clean(); modelRound = 0;
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
  const files = shipped();
  assert.equal(bodyOf(files[0]), WANT.replace('TEXT TWO', 'TEXT TWO REDONE'));
  clean();
});

test('a 1-byte change to the output of a step after the accept stops the run once at the send (M13 am11: "This changed since you accepted it."); nothing is written', async () => {
  const r = root(); clean(); modelRound = 0;
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
  assert.equal(res.outcome, 'paused', res.red);
  assert.equal(readAsk(res.runDir).question, 'This changed since you accepted it.');
  assert.deepEqual(shipped(), []);
});

test('a plan signed with the Ask reading one step (before am9) is unchanged: the Ask shows its one step, whatever the action line\'s words', async () => {
  const r = root(); clean(); modelRound = 0;
  const prose = PROSE('4. ask 1h: check it with me\n5. and write the result out');
  const decl = declaration(['n2']); decl.steps[3].goal = 'check it with me'; decl.steps[4].goal = 'and write the result out';
  sign(r, 'j', prose, decl);
  const a = asker();
  const res = await runFlow(args(r, 'j', 'am9-old', { askStep: a.fn, sources: [] }));
  assert.equal(res.outcome, 'complete', res.red);
  assert.deepEqual(a.shown[1].artifact, { text: 'TEXT TWO' });
  const files = shipped();
  assert.equal(bodyOf(files[0]), `## 3. Write the second note\n\n${NOT_CHECKED}\nTEXT TWO`);
  assert.equal(wholeJobAskIndex({ steps: decl.steps, askLines: new Map([[2, {}], [4, {}]]), sendLines: new Map([[5, { line: 5 }]]) }), -1);
  clean();
});

test('plan: code sets the Ask right before the action to read every work step (nearest first); validateDeclaration accepts it', () => {
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
  assert.deepEqual(readEveryStep(oldSteps, old.arbiter)[3].reads, ['n2', 'n1'], 'M13 am11: the action line\'s words no longer matter (a stored plan is never rewritten: this runs at draft time only)');
});
