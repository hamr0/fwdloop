// M8 items 2, 3 and 4 wired into the run path: a run's notes are made at run end ($0, no model call) and held until its LAST signed
// ask is accepted. In-process runs on job2's fixture with a fake modelStep (the step "resume-summary" is red on its first try and
// passes on its second, so there is a FIXED note to hold). The ledger lives in a scratch FWDLOOP_CONFIG_HOME (test door), never the real one.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep, LEARN_ERROR_FILE } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { readLedger, releaseRun } from '../src/learnstore.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8wire-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';

/** job2's fake modelStep; `redSummary` = how many tries of the summary step come back red before one passes (Infinity = never) */
function modelStepFor(redSummary) {
  let summaryTries = 0;
  const calls = { model: 0 };
  const fn = async (ctx) => {
    calls.model += 1;
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      summaryTries += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: summaryTries <= redSummary ? BAD : GOOD, done: true } };
    }
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
  return { fn, calls };
}

function setup(tag, { redSummary = 1, flowName = 'job2' } = {}) {
  process.env.FWDLOOP_CONFIG_HOME = tmp(`${tag}-home`);
  const root = tmp(`${tag}-root`);
  const w = writeFlow({
    root, name: flowName, proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const { fn, calls } = modelStepFor(redSummary);
  const args = (extra = {}) => ({
    root, name: flowName, runId: 'run-1', catalogue: CATALOGUE, modelStep: fn, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', ...extra,
  });
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  return { root, args, sources, calls, home: process.env.FWDLOOP_CONFIG_HOME, flowName };
}
const ledger = (home) => readLedger(home).ledger;

test('item 4: a run parked at its ask is not an end (no note); the Accept ends it and its note counts', async () => {
  const s = setup('accept');
  const parked = await runFlow({ ...s.args({ askStep: makeParkingAskStep() }), sources: s.sources });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(readLedger(s.home).exists, false, 'parked = not a run end: the ledger is not even created');
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun(s.args());
  assert.equal(done.outcome, 'complete', done.red);
  const L = ledger(s.home);
  assert.equal(L.pending.length, 0, 'released at the Accept, nothing left held');
  assert.equal(L.rows.length, 1);
  assert.equal(L.rows[0].sample.kind, 'FIXED');
  assert.equal(L.rows[0].workflow, 'job2');
  assert.deepEqual(L.rows[0].runIds, ['job2/run-1']);
  assert.equal(existsSync(path.join(done.runDir, LEARN_ERROR_FILE)), false);
});

test('item 4 negative: a run that ends before its ask is accepted is HELD, never released', async () => {
  const s = setup('before-ask', { redSummary: Infinity });
  const r = await runFlow({ ...s.args({ askStep: makeParkingAskStep() }), sources: s.sources });
  assert.notEqual(r.outcome, 'paused');
  assert.notEqual(r.outcome, 'complete');
  const L = ledger(s.home);
  assert.equal(L.rows.length, 0, 'not counted');
  assert.deepEqual(L.pending.map((p) => p.runid), ['job2/run-1'], 'held');
  assert.equal(L.pending[0].cards[0].kind, 'NEVER_FIXED');
});

test('item 4 negative: a redo never releases (the re-park is no end); an expired ask holds the note and never releases it', async () => {
  const s = setup('redo-expire');
  const CLOCK = () => '2000-01-01T00:00:00.000Z';
  const parked = await runFlow({ ...s.args({ askStep: makeParkingAskStep(), clock: CLOCK }), sources: s.sources });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'redo', reason: 'tighten it', clock: CLOCK }).ok, true);
  const again = await resumeRun(s.args({ clock: CLOCK }));
  assert.equal(again.outcome, 'paused', again.red);
  assert.equal(readLedger(s.home).exists, false, 'a redo is no run end: nothing made, nothing released');
  writeFileSync(path.join(parked.runDir, 'answer.json'), JSON.stringify({ askId: again.askId, decision: 'accept', answeredAt: '2000-01-01T05:00:00.000Z' }));
  const expired = await resumeRun(s.args({ clock: CLOCK }));
  assert.equal(expired.outcome, 'ask-expired');
  const L = ledger(s.home);
  assert.equal(L.rows.length, 0, 'an expired ask never counts the note');
  assert.deepEqual(L.pending.map((p) => p.runid), ['job2/run-1'], 'it stays held (dropped after 60 days)');
});

test('item 3: "this job" is the workflow name: run-1 of two different workflows keep separate rows', async () => {
  const a = setup('wf-a', { flowName: 'aging-1' });
  const pa = await runFlow({ ...a.args({ askStep: async () => ({ decision: 'accept' }) }), sources: a.sources });
  assert.equal(pa.outcome, 'complete', pa.red);
  // a second workflow into the SAME ledger home
  const b = setup('wf-b', { flowName: 'aging-2' });
  process.env.FWDLOOP_CONFIG_HOME = a.home;
  const pb = await runFlow({ ...b.args({ askStep: async () => ({ decision: 'accept' }) }), sources: b.sources });
  assert.equal(pb.outcome, 'complete', pb.red);
  const rows = ledger(a.home).rows;
  assert.deepEqual(rows.map((r) => r.workflow).sort(), ['aging-1', 'aging-2']);
  assert.deepEqual(rows.map((r) => r.runIds[0]).sort(), ['aging-1/run-1', 'aging-2/run-1']);
});

test('item 5 / OFF: notes are made whatever learningHints says (absent here = OFF)', async () => {
  const s = setup('off');
  assert.equal(existsSync(path.join(s.home, 'config.json')), false, 'no learningHints line anywhere');
  const r = await runFlow({ ...s.args({ askStep: async () => ({ decision: 'accept' }) }), sources: s.sources });
  assert.equal(r.outcome, 'complete', r.red);
  assert.equal(ledger(s.home).rows.length, 1);
});

test('item 4: a failure of the note code never fails the run, and is recorded in the run folder', async () => {
  const s = setup('fail');
  // a ledger that is not a ledger: the tally reports a problem and writes nothing
  mkdirSync(path.join(s.home, 'learn'));
  writeFileSync(path.join(s.home, 'learn', 'ledger.json'), '{ not json');
  const r = await runFlow({ ...s.args({ askStep: async () => ({ decision: 'accept' }) }), sources: s.sources });
  assert.equal(r.outcome, 'complete', r.red);
  const rec = JSON.parse(readFileSync(path.join(r.runDir, LEARN_ERROR_FILE), 'utf8').trim());
  assert.match(rec.error, /not readable JSON/);
  assert.equal(readFileSync(path.join(s.home, 'learn', 'ledger.json'), 'utf8'), '{ not json', 'the bad ledger is not reset');
});

test('no test-door home: nothing is written and nothing real is read', async () => {
  const s = setup('nohome');
  delete process.env.FWDLOOP_CONFIG_HOME;
  const r = await runFlow({ ...s.args({ askStep: async () => ({ decision: 'accept' }) }), sources: s.sources });
  assert.equal(r.outcome, 'complete', r.red);
  assert.equal(readLedger(s.home).exists, false);
  assert.equal(existsSync(path.join(r.runDir, LEARN_ERROR_FILE)), false);
});

test('item 4: a held note older than 60 days is dropped, not counted, when a late release comes', async () => {
  const s = setup('sixty', { redSummary: Infinity });
  const r = await runFlow({ ...s.args({ askStep: makeParkingAskStep() }), sources: s.sources });
  assert.equal(ledger(s.home).pending.length, 1, `held (${r.outcome})`);
  const later = new Date(Date.now() + 61 * 86_400_000);
  assert.deepEqual(releaseRun({ home: s.home, runid: 'job2/run-1', now: later }), { released: 0, problem: null });
  assert.equal(ledger(s.home).rows.length, 0);
  assert.equal(ledger(s.home).pending.length, 0, 'dropped');
});

// A run with no signed ask: job2's first three lines, no ask mark, no send.
test('item 4: a run with no ask counts at run end', async () => {
  process.env.FWDLOOP_CONFIG_HOME = tmp('noask-home');
  const home = process.env.FWDLOOP_CONFIG_HOME;
  const root = tmp('noask-root');
  const prose = sandboxSend(fixture('job2-with-sources.signed.txt'))
    .replace(/4\. ask: check it with me,\n\s+guardrail: nothing goes out before I accept\n5\. and once I accept, write it out\.\n/, '')
    .replace(/guardrail: send at line 5 to [^\n]*\n/, '');
  const decl = JSON.parse(fixture('job2.m1.declaration.json'));
  decl.steps = decl.steps.slice(0, 3);
  decl.guardrailClasses = { 3: 'softgreen' };
  const w = writeFlow({ root, name: 'noask', proseText: prose, declaration: decl, signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const src = tmp('noask-src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const { fn } = modelStepFor(1);
  const r = await runFlow({
    root, name: 'noask', runId: 'run-1', catalogue: CATALOGUE, modelStep: fn, primitives: {}, businessDate: '2026-06-01',
    sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  });
  assert.equal(r.outcome, 'complete', r.red);
  const L = ledger(home);
  assert.deepEqual([L.rows.length, L.pending.length], [1, 0], 'counted at run end, never held');
  assert.equal(L.rows[0].trust, 'deterministic');
});
