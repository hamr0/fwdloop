// M9 amendment 10, the two cases test/m9-am10-cancel.test.js names but never ran (fix ledger 2026-10-16): Cancel while a run is STARTING, and Cancel while a
// run is [II] stuck. In-process, $0, a fake modelStep. Cancel is stood in for by re-signing the workflow without its trigger line (what `set` does).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow, writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { readHistory } from '../src/books.js';
import { proseWithTrigger } from '../src/trigger-line.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const DAILY = { kind: 'daily', hour: 9, minute: 0 };

/** A signed job2 WITH a daily trigger line, in its own folder. */
function scheduledJob(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m9am10e-${tag}-`));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  w.plain = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  w.prose = proseWithTrigger(w.plain, DAILY);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({ root: w.root, name: 'job2', proseText: w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  w.args = { root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: w.modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01 };
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}
/** Cancel: the workflow re-signed with its trigger line removed (the very write the trigger door makes). */
function cancel(w) {
  const oldHash = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  const r = writeFlow({ root: w.root, name: 'job2', proseText: w.plain, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash } });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
}

// M9 am10 (ruled 2026-10-16): Cancel "only stops future runs from starting: runs already going or waiting stay as they are". A Cancel that lands between the run's
// read of the job and its job copy (a trigger-only re-sign) must NOT stop that run. M6 F3 stays: any other change to the job in that window still halts it.
test('Cancel while a run is STARTING: the run is not stopped, keeps a job copy, reaches its ask; the schedule is gone', async () => {
  const w = scheduledJob('starting');
  let cancelled = false;
  // the existing seam (m6-runcopy F3): runFlow reads `primitiveReds.length` after reading the job and before writing its copy
  const primitiveReds = { get length() { cancel(w); cancelled = true; return 0; } };
  const r = await runFlow({ ...w.args, primitiveReds, askStep: makeParkingAskStep(), sources: w.sources });
  assert.equal(cancelled, true, 'the Cancel landed while the run was starting');
  assert.equal(r.outcome, 'paused', JSON.stringify(r));
  assert.equal(existsSync(path.join(w.runDir, 'job', 'prose.txt')), true, 'the run kept its job copy');
  const now = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  assert.equal(now.ok, true, 'the cancelled job reads and verifies');
  assert.equal(now.arbiter.trigger, null, 'the schedule is cancelled');
  assert.equal(answerAsk({ runDir: w.runDir, askId: r.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.equal(done.outcome, 'complete', done.red);
});

// M6 F3 stays: a real change to the steps while the run is starting still stops it preflight-red, at $0, keeping no copy.
test('a real step edit while a run is STARTING still halts it preflight-red (M6 F3), keeping no copy', async () => {
  const w = scheduledJob('starting-edit');
  let edited = false;
  const primitiveReds = {
    get length() {
      const oldHash = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
      const r = writeFlow({ root: w.root, name: 'job2', proseText: w.prose.replace('cap $0.25 per run', 'cap $0.20 per run'), declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash } });
      edited = r.ok;
      return 0;
    },
  };
  const r = await runFlow({ ...w.args, primitiveReds, askStep: makeParkingAskStep(), sources: w.sources });
  assert.equal(edited, true, 'the edit landed while the run was starting');
  assert.equal(r.outcome, 'preflight-red', JSON.stringify(r));
  assert.match(r.red, /the job was replaced while this run was starting/);
  assert.equal(existsSync(path.join(w.runDir, 'job')), false, 'no mismatched copy is kept');
  assert.equal(readHistory(w.flowDir).at(-1).spentUsd ?? 0, 0, 'nothing was spent');
});

test('Cancel while a run is [II] stuck (answer saved, no process): the stuck run still resumes from its own copy and completes', async () => {
  const w = scheduledJob('stuck');
  const parked = await runFlow({ ...w.args, askStep: makeParkingAskStep(), sources: w.sources });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(answerAsk({ runDir: w.runDir, askId: parked.askId, decision: 'accept' }).ok, true);   // saved, and no resume was started: stuck
  const copyBefore = readFileSync(path.join(w.runDir, 'job', 'prose.txt'), 'utf8');
  cancel(w);
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).arbiter.trigger, null, 'the schedule is cancelled');
  assert.equal(readFileSync(path.join(w.runDir, 'job', 'prose.txt'), 'utf8'), copyBefore, 'the Cancel did not touch the run\'s own copy');
  const done = await resumeRun({ ...w.args, askStep: makeParkingAskStep() });
  assert.equal(done.outcome, 'complete', done.red);
});
