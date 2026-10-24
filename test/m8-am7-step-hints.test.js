// M8 am7 (docs/wiki/the-module-ladder.md "M8 amendment 7"): a step's retry, redo or rerun try is handed the drafter's ONE block of earlier-run learnings, whole;
// a first try never is (not even with the Chat "Thinking on" box ticked); OFF hands nothing; each try that got a block keeps the exact text and its count.
// $0: a fake model step, in-process runs on job2's fixture, scratch config homes (mkdtemp, cleaned up). The ledger row is the real card folded by the real ledger code.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, runStepRalph, makeParkingAskStep, LEARN_ERROR_FILE } from '../src/runner.js';
import { readAudit } from '../src/books.js';
import { hintsForRun, writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { readStepLearnings, STEP_LEARNINGS_PREFIX, writeRunThinking } from '../src/flowmodel.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8am7-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';
const NOW = new Date();
const STEP = 'summary';

/** the ledger row of the real card, for job2 (lastSeen set to now: the age is not under test) */
const row = () => ({
  ...countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW }).rows[0],
  lastSeen: NOW.toISOString(),
});

/** a config home with `learningHints` as given and the one row in the ledger */
function homeWith(on) {
  const h = tmp('home');
  if (on !== null) writeFileSync(path.join(h, 'config.json'), JSON.stringify({ learningHints: on }));
  writeLedger({ ...emptyLedger(), rows: [row()] }, h);
  return h;
}

/** a model step that records the context of every call; the summary step is red on the tries in `redOn` and good on the rest */
function recordingModel(seen, redOn) {
  let n = 0;
  return async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      n += 1;
      seen.push({ n, hints: ctx.hints, gap: ctx.gap });
      return { ok: true, costUsd: 0.001, artifact: { text: redOn.includes(n) ? BAD : GOOD, done: true } };
    }
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
}

function world(tag, on) {
  const home = homeWith(on);
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
  const run = (modelStep) => runFlow({
    root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(), sources,
  });
  return { home, root, sources, run, runDir: path.join(root, 'job2', 'runs', 'run-1') };
}

/** the block the DRAFTER's function makes for this job at this moment (authoring.js calls hintsForRun with exactly this spec shape) */
const drafterBlock = (home, source) => hintsForRun({ home, spec: { job: 'job2', inputs: [{ value: source }] }, specHash: null, now: new Date() });

test('a retry (try 2) is handed the drafter\'s block whole; the first try is not; the record and the audit row agree', async () => {
  const w = world('retry', true);
  const seen = [];
  const r = await w.run(recordingModel(seen, [1]));
  assert.notEqual(r.outcome, 'refused', r.red);
  assert.ok(seen.length >= 2, `two summary tries ran: ${JSON.stringify(seen)}`);
  const want = drafterBlock(w.home, w.sources[0].path);
  assert.ok(want && want.text.length > 0, 'the drafter would be handed a block');
  assert.equal(seen[0].hints, null, 'a first try never gets a block');
  assert.equal(seen[1].hints, want.text, 'the retry gets exactly the drafter\'s block');
  const recs = readStepLearnings(w.runDir);
  assert.equal(recs.length, 1, 'one record: only the retry was handed a block');
  assert.deepEqual([recs[0].try, recs[0].text, recs[0].ids], [2, want.text, want.ids]);
  const rows = readAudit(w.runDir).filter((x) => typeof x.step === 'string' && x.attempt !== undefined);
  const t1 = rows.find((x) => x.attempt === 1 && x.step === recs[0].step);
  const t2 = rows.find((x) => x.attempt === 2 && x.step === recs[0].step);
  assert.equal(Object.hasOwn(t1, 'hints'), false, 'a try handed nothing has no count');
  assert.equal(t2.hints, want.ids.length);
});

test('one block means one call: a row of this workflow signed under another hash is in the step\'s block exactly as in the drafter\'s', async () => {
  const w = world('hash', true);
  const base = row();
  // a second row of this workflow, signed under a DIFFERENT hash, ranked first; the drafter (specHash null) keeps it, so the step must too
  writeLedger({ ...emptyLedger(), rows: [base, { ...base, id: `${base.id}~other`, specHash: 'otherhash0000', count: base.count + 5, lesson: `${base.lesson} OTHERVERSION` }] }, w.home);
  const want = drafterBlock(w.home, w.sources[0].path);
  assert.ok(want && want.ids.includes(`${base.id}~other`), 'the drafter\'s block holds the other-hash row');
  const seen = [];
  await w.run(recordingModel(seen, [1]));
  assert.ok(seen.length >= 2);
  assert.equal(seen[1].hints, want.text, 'the retry gets the drafter\'s block at that moment, not a second filter\'s');
});

test('OFF: nothing is handed anywhere - no context, no record, no count, no error', async () => {
  for (const on of [false, null]) {
    const w = world('off', on);
    const seen = [];
    await w.run(recordingModel(seen, [1]));
    assert.ok(seen.length >= 2);
    assert.ok(seen.every((s) => s.hints === null), `OFF hands nothing: ${JSON.stringify(seen)}`);
    assert.deepEqual(readdirSync(w.runDir).filter((x) => x.startsWith(STEP_LEARNINGS_PREFIX)), []);
    assert.equal(existsSync(path.join(w.runDir, LEARN_ERROR_FILE)), false);
    assert.ok(readAudit(w.runDir).every((x) => !Object.hasOwn(x, 'hints')));
  }
});

// the loop itself, with the box ticked, a redo's numbering and a rerun's reason (the three places thinking switches on, minus the box)
const STEP_DEF = { goal: 'Draft it', emits: 'doc', primitives: [], close: { class: 'green', shape: { sections: ['a'] } } };
async function loop({ box = false, initialGap = null, attemptOffset = 0, asked, runDir = null }) {
  const calls = [];
  const out = await runStepRalph({
    step: STEP_DEF, primitivesMap: {}, readsMap: {}, businessDate: '2026-06-01', spent: { value: 0 }, capUsd: 1, ceilingUsd: 0.01, recordAudit: () => {},
    initialGap, attemptOffset, thinkingBox: box, runDir, learnHints: () => { asked.push(1); return { text: 'BLOCK', ids: ['x'] }; },
    modelStep: async (ctx) => { calls.push(ctx.hints); return { ok: false, red: 'stop here', costUsd: 0.001, transport: false, model: 'm', tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 } }; },
    now: () => new Date().toISOString(),
  });
  return { calls, out };
}

test('the Chat "Thinking on" box forces thinking on every try but a first try still gets no block', async () => {
  const asked = [];
  const { calls } = await loop({ box: true, asked });
  assert.equal(calls[0], null, 'first try: no block even with the box ticked');
  assert.equal(asked.length, calls.length - 1, 'the block is asked only for the tries after the first');
  assert.ok(calls.slice(1).every((h) => h === 'BLOCK'));
});

test('a redo at an ask (numbered after the last try) and a rerun run (its run folder says so; M4d am34) are handed the block', async () => {
  const redo = await loop({ initialGap: 'fix it', attemptOffset: 2, asked: [] });
  assert.equal(redo.calls[0], 'BLOCK', 'a redo\'s first new try');
  const runDir = tmp('rerun-dir');
  writeRunThinking(tmp('rerun-flow'), runDir, true);
  const rerun = await loop({ attemptOffset: 0, asked: [], runDir });
  assert.equal(rerun.calls[0], 'BLOCK', 'a rerun run\'s first try');
  const reason = await loop({ initialGap: 'start over', attemptOffset: 0, asked: [] });
  assert.equal(reason.calls[0], null, 'a gap alone is not a rerun: only the run\'s own record is');
  const plain = await loop({ asked: [] });
  assert.equal(plain.calls[0], null, 'a plain first try');
});

test('a ledger that cannot be read hands nothing, records why, and the step still runs', async () => {
  const w = world('bad', true);
  writeFileSync(path.join(w.home, 'learn', 'ledger.json'), '{ not json');
  const seen = [];
  const r = await w.run(recordingModel(seen, [1]));
  assert.notEqual(r.outcome, 'refused', r.red);
  assert.ok(seen.length >= 2 && seen.every((s) => s.hints === null));
  assert.equal(existsSync(path.join(w.runDir, LEARN_ERROR_FILE)), true);
});
