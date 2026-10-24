// M8 am8 (docs/wiki/the-module-ladder.md "M8 amendment 8"): a run's place is its first input as the run actually reads it, not the path written in the signed job.
// One function (`placeSpecOf`, src/learnstore.js) gives the spec; a step's retry and the run-end tally both use it. $0: fake model step, in-process runs on job2's fixture, scratch config homes.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import { hintsForRun, writeLedger, readLedger, placeSpecOf, resolvePlace } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { parseSignedText } from '../src/signed-text.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8am8-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';
const NOW = new Date();
const SIGNED = sandboxSend(fixture('job2-with-sources.signed.txt'));
/** the path written in the signed job (the first source) */
const SIGNED_PATH = (() => { const f = parseSignedText(SIGNED); assert.equal(f.ok, true); return f.arbiter.sources[0].path; })();

/** three OTHER workflows' rows of the real card, all at `place`: the climb to "this place" (CLIMB_AT = 3) */
const climbedAt = (place) => ['otherA', 'otherB', 'otherC'].map((w, i) => ({
  ...countLedger(emptyLedger(), { runid: `${w}/run-1`, cards: cardsOf('ms2c0ls7').cards, workflow: w, place, specHash: null, trust: 'deterministic', now: NOW }).rows[0], id: `row${i}`, lastSeen: NOW.toISOString(),
}));

function world(rows) {
  const home = tmp('home');
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
  writeLedger({ ...emptyLedger(), rows }, home);
  process.env.FWDLOOP_CONFIG_HOME = home;
  const root = tmp('root');
  const w = writeFlow({ root, name: 'job2', proseText: SIGNED, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true);
  const src = tmp('src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  assert.notEqual(sources[0].path, SIGNED_PATH, 'the run reads a file other than the signed path');
  const seen = [];
  let n = 0;
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    n += 1;
    seen.push(ctx.hints);
    return { ok: true, costUsd: 0.001, artifact: { text: n === 1 ? BAD : GOOD, done: true } };
  };
  const run = () => runFlow({ root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(), sources });
  const resume = () => resumeRun({ root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01' });
  return { home, run, resume, seen, runPath: sources[0].path, runDir: path.join(root, 'job2', 'runs', 'run-1') };
}

test('placeSpecOf: the run\'s first input, no input is no place', () => {
  assert.deepEqual(placeSpecOf('j', '/a/b.csv'), { job: 'j', inputs: [{ value: '/a/b.csv' }] });
  assert.deepEqual(placeSpecOf('j', null), { job: 'j', inputs: [] });
  assert.deepEqual(placeSpecOf('j', ''), { job: 'j', inputs: [] });
});

test('step: a run on another file than the signed path is handed THAT file\'s place learnings, the same text the function makes for the run\'s path', async () => {
  const w = world([]);
  writeLedger({ ...emptyLedger(), rows: climbedAt(resolvePlace(w.runPath)) }, w.home);
  await w.run();
  assert.ok(w.seen.length >= 2 && w.seen[0] === null);
  const want = hintsForRun({ home: w.home, spec: placeSpecOf('job2', w.runPath), specHash: null, now: new Date() });
  assert.ok(want && /\[this place, seen/.test(want.text), 'the run\'s place climbed');
  assert.equal(w.seen[1], want.text, 'the retry gets the block of the run\'s place');
  const rec = readAudit(w.runDir).find((x) => Object.hasOwn(x, 'hints'));
  assert.equal(rec.hintsText, want.text);
});

test('step: a place climbed only at the SIGNED path is not handed to a run on another file', async () => {
  const w = world(climbedAt(resolvePlace(SIGNED_PATH)));
  await w.run();
  assert.ok(w.seen.length >= 2);
  assert.ok(w.seen.slice(1).every((h) => h === null || !/this place/.test(h)), `no signed-path place handed: ${JSON.stringify(w.seen)}`);
});

test('run end: the learnings are saved under the file the run read, never the signed path', async () => {
  const w = world([]);
  const parked = await w.run();
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' }).ok, true);
  const done = await w.resume();
  assert.equal(done.outcome, 'complete', done.red);
  const { ledger } = readLedger(w.home);
  const places = ledger.rows.map((r) => r.place);
  assert.ok(places.length >= 1, 'the run left a note');
  assert.ok(places.every((p) => p === resolvePlace(w.runPath)), `places: ${JSON.stringify(places)}`);
  assert.ok(!places.includes(resolvePlace(SIGNED_PATH)));
});

test('the drafter uses the same function (a draft has no run input: the signed prose path is its only file)', () => {
  const src = readFileSync(path.join(HERE, '..', 'src', 'authoring.js'), 'utf8');
  assert.match(src, /hintsForRun\(\{ home: door\.home, spec: placeSpecOf\(/);
});
