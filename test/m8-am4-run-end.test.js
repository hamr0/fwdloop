// M8 am4: every run's notes COUNT when the run ends, whatever the ending and whether or not its asks were accepted. Real in-process runs
// on job2's fixture with a fake modelStep (the step "resume-summary" is the one that goes red). The ledger lives in a scratch
// FWDLOOP_CONFIG_HOME (test door), never the real one.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { answerAsk } from '../src/ask.js';
import { runFlow, continueRun, resumeRun, makeParkingAskStep, requestStop } from '../src/runner.js';
import { readLedger } from '../src/learnstore.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8am4-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';

/** `plan(n)` -> 'red' | 'good' | 'transport' for the n-th summary try; `onTry(n)` runs when that try is called */
function modelStepFor(plan, onTry = () => {}) {
  let n = 0;
  return async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      n += 1;
      onTry(n);
      const p = plan(n);
      if (p === 'transport') return { ok: false, transport: true, costUsd: 0.001, red: 'socket hang up' };
      return { ok: true, costUsd: 0.001, artifact: { text: p === 'red' ? BAD : GOOD, done: true } };
    }
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
}

function setup(tag, { cap = '0.25' } = {}) {
  process.env.FWDLOOP_CONFIG_HOME = tmp(`${tag}-home`);
  const root = tmp(`${tag}-root`);
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')).replace('cap $0.25', `cap $${cap}`), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  const args = (modelStep, extra = {}) => ({
    root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(), ...extra,
  });
  return { root, sources, args, home: process.env.FWDLOOP_CONFIG_HOME, runDir: path.join(root, 'job2', 'runs', 'run-1') };
}
const ledger = (home) => readLedger(home).ledger;

test('am4: a red run whose ask was never accepted counts its NEVER FIXED note at once', async () => {
  const s = setup('red');
  const r = await runFlow({ ...s.args(modelStepFor(() => 'red')), sources: s.sources });
  assert.notEqual(r.outcome, 'paused');
  const L = ledger(s.home);
  assert.deepEqual([L.rows.length, L.pending.length, L.rows[0].count, L.rows[0].sample.kind], [1, 0, 1, 'NEVER_FIXED']);
});

test('am4: a Stopped run has ended: its note counts then', async () => {
  const s = setup('stop');
  const r = await runFlow({ ...s.args(modelStepFor(() => 'red', (n) => { if (n === 1) requestStop(s.runDir); })), sources: s.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  const L = ledger(s.home);
  assert.deepEqual([L.rows.length, L.pending.length, L.rows[0].sample.kind, L.rows[0].runIds], [1, 0, 'NEVER_FIXED', ['job2/run-1']]);
});

test('am4: a cap-halted run has ended: its note counts then', async () => {
  const s = setup('cap', { cap: '0.0035' });
  const r = await runFlow({ ...s.args(modelStepFor(() => 'red'), { ceilingUsd: 0.001 }), sources: s.sources });
  assert.equal(r.outcome, 'cap-halt', r.red);
  const L = ledger(s.home);
  assert.deepEqual([L.rows.length, L.pending.length, L.rows[0].sample.kind], [1, 0, 'NEVER_FIXED']);
});

test('am4: a run waiting at its ask has not ended: no note yet', async () => {
  const s = setup('wait');
  const r = await runFlow({ ...s.args(modelStepFor((n) => (n === 1 ? 'red' : 'good'))), sources: s.sources });
  assert.equal(r.outcome, 'paused', r.red);
  assert.equal(readLedger(s.home).exists, false, 'not even a ledger file');
});

test('am4 noise: a provider red makes no note, even though an earlier try went red', async () => {
  const s = setup('noise');
  const r = await runFlow({ ...s.args(modelStepFor((n) => (n === 1 ? 'red' : 'transport'))), sources: s.sources });
  assert.equal(r.outcome, 'provider-red', r.red);
  const L = ledger(s.home);
  assert.equal(L.rows.length, 0);
  assert.equal(L.health['job2/run-1'].noise, 'provider-red');
});

test('am4 resume: a stopped run that is resumed folds the whole run again; one run is counted once per row, never twice', async () => {
  const s = setup('resume');
  const r1 = await runFlow({ ...s.args(modelStepFor(() => 'red', (n) => { if (n === 1) requestStop(s.runDir); })), sources: s.sources });
  assert.equal(r1.outcome, 'stopped', r1.red);
  assert.equal(ledger(s.home).rows.length, 1, 'leg 1 counted');
  // the resumed leg stays red on every try: the same NEVER FIXED row, the same run id, so the count does not move
  const r2 = await continueRun(s.args(modelStepFor(() => 'red')));
  assert.notEqual(r2.outcome, 'stopped', r2.red);
  const L = ledger(s.home);
  assert.equal(L.rows.length, 1);
  assert.equal(L.rows[0].count, 1, 'counted once');
  assert.deepEqual(L.rows[0].runIds, ['job2/run-1']);
});

test('am4 resume, bareloop-identical: stuck in leg 1, fixed in leg 2 -> the run is folded again at its true end but counts once; the row is refreshed to leg 2\'s FIXED sample (bareloop v0.47.0)', async () => {
  const s = setup('stuck-then-fixed');
  const r1 = await runFlow({ ...s.args(modelStepFor(() => 'red', (n) => { if (n === 1) requestStop(s.runDir); })), sources: s.sources });
  assert.equal(r1.outcome, 'stopped', r1.red);
  const r2 = await continueRun(s.args(modelStepFor(() => 'good')));
  assert.equal(r2.outcome, 'paused', r2.red);
  assert.equal(ledger(s.home).rows[0].count, 1, 'a run waiting at its ask made no second fold');
  assert.equal(answerAsk({ runDir: s.runDir, askId: r2.askId, decision: 'accept' }).ok, true);
  const r3 = await resumeRun(s.args(modelStepFor(() => 'good')));
  assert.equal(r3.outcome, 'complete', r3.red);
  const L = ledger(s.home);
  assert.deepEqual(L.rows.map((x) => [x.count, x.sample.kind, x.runIds]), [[1, 'FIXED', ['job2/run-1']]]);
  assert.equal(L.health['job2/run-1'].cards, 1, 'the health line is the whole run, replaced by run id');
});

test('am4: a rerun ends the run it leaves: that run\'s note counts at the rerun (the new run, parked at its ask, makes none yet)', async () => {
  const s = setup('rerun');
  const model = modelStepFor((n) => (n === 1 ? 'red' : 'good'));
  const r1 = await runFlow({ ...s.args(model), sources: s.sources });
  assert.equal(r1.outcome, 'paused', r1.red);
  assert.equal(readLedger(s.home).exists, false);
  assert.equal(answerAsk({ runDir: s.runDir, askId: r1.askId, decision: 'rerun', reason: 'start over' }).ok, true);
  const r2 = await resumeRun(s.args(model));
  assert.equal(r2.outcome, 'rerun', r2.red);
  assert.deepEqual(ledger(s.home).rows.map((x) => [x.sample.kind, x.runIds]), [['FIXED', ['job2/run-1']]]);
});
