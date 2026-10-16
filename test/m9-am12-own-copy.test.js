// M9 amendment 12 (docs/wiki/the-module-ladder.md): a waiting run answers from its OWN kept copy of the job, checked against that copy's own
// signature, never the workflow's current one. In-process, $0, a fake modelStep. A Cancel / Edit of the workflow is stood in for by re-signing
// it (`writeFlow` with `replaces`), the very thing that used to strand a waiting run ("signature mismatch ... the flow changed while parked").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow, writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, continueRun, makeParkingAskStep, requestStop } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { getRunControls } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

/** A signed job2 (own folder), run until it parks at its ask. `goals` collects every model goal seen. */
async function parkedRun(tag, { stopAtAsk = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m9am12-${tag}-`));
  const w = { base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'), goals: [] };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  w.prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({ root: w.root, name: 'job2', proseText: w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  w.modelStep = async (ctx) => {
    w.goals.push(ctx.goal);
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    if (stopAtAsk && emits === 'resume-summary') requestStop(w.runDir);
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  w.args = { root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: w.modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01 };
  const run = await runFlow({ ...w.args, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }] });
  assert.equal(run.outcome, stopAtAsk ? 'stopped' : 'paused', run.red);
  w.askId = run.askId;
  return w;
}
/** The workflow is re-signed under the run (what a Cancel or an Edit does). */
function resign(w, prose) {
  const oldHash = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  const r = writeFlow({ root: w.root, name: 'job2', proseText: prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash } });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
}

test('Must fail: a run waiting at its ask cannot carry on after the workflow was re-signed (am12)', async () => {
  const w = await parkedRun('cancel');
  resign(w, w.prose.replace('cap $0.25', 'cap $0.30'));
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.equal(done.outcome, 'complete', done.red);
});

test('Must fail: a run whose own copy fails its signature carries on (am12)', async () => {
  const w = await parkedRun('tamper');
  const f = path.join(w.runDir, 'job', 'prose.txt');
  writeFileSync(f, readFileSync(f, 'utf8').replace('Read my resume', 'Read my resumE'));
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.askId, decision: 'accept' }).ok, true);
  const r = await resumeRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.red, /saved copy of its job/, r.red);
});

test('Must fail: a resumed run uses the workflow\'s current job instead of its own copy (am12)', async () => {
  const w = await parkedRun('own-step');
  resign(w, w.prose.replace('write me a summary resume:', 'write me a summary resume NOTE-FROM-THE-FLOW:'));
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.askId, decision: 'redo', reason: 'again' }).ok, true);
  w.goals.length = 0;
  const r = await resumeRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.equal(r.outcome, 'paused', r.red);
  const summaryGoal = w.goals.find((g) => g.includes('summary resume'));
  assert.ok(summaryGoal, `the summary step ran again: ${JSON.stringify(w.goals)}`);
  assert.ok(!summaryGoal.includes('NOTE-FROM-THE-FLOW'), 'the resumed step is the run\'s own, not the flow\'s');
});

test('Must fail: a run with no saved copy (before M6) is refused by name, not run on the flow\'s job (am12)', async () => {
  const w = await parkedRun('nocopy');
  const { rmSync } = await import('node:fs');
  rmSync(path.join(w.runDir, 'job'), { recursive: true, force: true });
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.askId, decision: 'accept' }).ok, true);
  const r = await resumeRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.red, /no saved copy of its job/, r.red);
});

test('Must fail: a stopped run whose workflow was re-signed loses Resume, or Continue refuses it on the signature (am12)', async () => {
  const w = await parkedRun('stopped', { stopAtAsk: true });
  resign(w, w.prose.replace('cap $0.25', 'cap $0.30'));
  const c = getRunControls({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(c.canResume, true, JSON.stringify(c));
  const r = await continueRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.ok(!/signature mismatch|saved copy of its job/.test(String(r.red ?? '')), `carried on from its own copy: ${r.red}`);
});

test('Must fail: a stopped run with no saved copy shows no Resume AND no sentence (it must say why, one owner for the words)', async () => {
  const { rmSync } = await import('node:fs');
  const { NO_COPY_SAY } = await import('../src/summary-words.js');
  const w = await parkedRun('nocopysay', { stopAtAsk: true });
  const own = getRunControls({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(own.canResume, true, 'a run with its copy resumes');
  assert.equal(own.noCopySay, null, 'and says nothing');
  rmSync(path.join(w.runDir, 'job'), { recursive: true, force: true });
  const c = getRunControls({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(c.canResume, false);
  assert.equal(c.noCopySay, 'This run started before runs kept their own copy of the job, so it cannot carry on. Start a new run.');
  assert.equal(c.noCopySay, NO_COPY_SAY);
  const page = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  assert.match(page, /c\.noCopySay[\s\S]{0,300}run-no-copy-say/, 'the Run tab draws it where Resume would be');
});
