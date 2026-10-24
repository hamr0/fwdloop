// hamr 2026-10-24: no new file kinds in a run folder. A rerun run and a plain run with a retry leave exactly the names below: no rerun.json, no learnings-try-*.
// $0: a fake model step, in-process runs on job2's fixture, scratch config homes (mkdtemp, cleaned up).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { readAudit } from '../src/books.js';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-runnames-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';
const NOW = new Date();
const row = () => ({
  ...countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW }).rows[0],
  lastSeen: NOW.toISOString(),
});

/** a job2 world with learningHints ON and one ledger row; `thinkingBox` is the job's Chat box (kept in model.json is not needed: the run copy defaults off) */
function world(tag) {
  const home = tmp('home');
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
  writeLedger({ ...emptyLedger(), rows: [row()] }, home);
  process.env.FWDLOOP_CONFIG_HOME = home;
  const root = tmp(`${tag}-root`);
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  const args = (modelStep, runId = 'run-1', extra = {}) => ({
    root, name: 'job2', runId, catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(), sources, ...extra,
  });
  return { root, args, runDir: (id = 'run-1') => path.join(root, 'job2', 'runs', id) };
}

/** every model call is noted as {step, attempt, mode, hints}; the summary step is red on the summary tries in `redOn` */
function recorder(calls, redOn = []) {
  let n = 0;
  return async (ctx, _granted, meta) => {
    const step = ctx.goal.includes('resume .docx') ? 'resume' : ctx.goal.includes('job description markdown') ? 'jd' : 'summary';
    calls.push({ step, attempt: meta.attempt, mode: meta.thinkingMode, hints: ctx.hints });
    if (step === 'resume') return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (step === 'jd') return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    n += 1;
    return { ok: true, costUsd: 0.001, artifact: { text: redOn.includes(n) ? BAD : GOOD, done: true } };
  };
}
// hamr 2026-10-24: no new file kinds in a run folder. The exact names this fixture's run folder held before the learnings work: a rerun run and a plain run with a retry make no other.
const RUN_FOLDER_NAMES = ['artifacts', 'ask.json', 'asks', 'audit.jsonl', 'checks.jsonl', 'inputs', 'inputs.json', 'job', 'log.json', 'pids.jsonl', 'state.json', 'thinking.json'];

test('no new file kinds: a rerun run and a plain run with retries leave no rerun.json, no learnings-try-*', async () => {
  for (const [tag, extra, id] of [['names-rerun', { initialGap: 'start over' }, 'run-1-rerun-1'], ['names-plain', {}, 'run-1']]) {
    const w = world(tag);
    const r = await runFlow(w.args(recorder([], [1]), id, extra));
    assert.notEqual(r.outcome, 'refused', r.red);
    const names = readdirSync(w.runDir(id));
    assert.ok(names.includes('thinking.json') && names.includes('audit.jsonl'), `${tag}: ${names}`);
    assert.deepEqual([...names].sort(), RUN_FOLDER_NAMES, `${tag}: no rerun.json, no learnings-try-*, no new name`);
    // the retry was handed its block on the audit row, not in a file
    assert.ok(readAudit(w.runDir(id)).some((x) => typeof x.hintsText === 'string' && x.hintsText !== ''), `${tag}: the block rides the try's audit row`);
  }
});
