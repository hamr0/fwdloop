// M4e amendment 16, group 3 "Panel" (SIGNED 2026-10-08): C1, C9, C16, I4. $0: no model call, no network. Fixture runs are made with a
// fake model step; the I4 widths (1280, 390, 320) are a browser walk, not this file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sendViaPrimitive } from '../src/send.js';
import * as R from '../src/runner.js';
import {
  getRunAsks, getRunAudit, getRunDetail, listRuns, listStops,
} from '../src/panel/data.js';
import { createAuthor } from '../src/panel/author.js';
import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();
const { runFlow, makeParkingAskStep, requestStop } = R;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const CAT = loadCatalogue().primitives;
const cut = (name) => {
  const start = PAGE.indexOf(`\n  function ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};

// ---- C1 ------------------------------------------------------------------------------------------------------------------------------
const OUTSIDE_WORDS = "This flow is outside the panel's folder.";
const OTHER_403_WORDS = 'The panel does not recognise this page. Reload it.';
/** The page's real getJSON + loadFailureText, run against a stubbed fetch that answers `status` with `body`. */
async function pageFailure(status, body) {
  const fetchStub = async () => ({ ok: false, status, json: async () => body });
  const { getJSON, loadFailureText } = new Function('fetch', `${cut('getJSON')}\n${cut('loadFailureText')}\nreturn { getJSON, loadFailureText };`)(fetchStub);
  try { await getJSON('/api/x'); } catch (e) { return loadFailureText(e); }
  return assert.fail('getJSON should have thrown');
}

test('C1 the server refuses a flow outside the panel folder with the name flow-outside-root (403)', async () => {
  const w = await world();
  const outside = mkdtempSync(path.join(tmpdir(), 'fwdloop-am16p-out-'));
  symlinkSync(outside, path.join(w.root, 'evil'));
  const r = await w.get('/api/runs/evil/run-1');
  assert.equal(r.status, 403);
  assert.equal(r.json().refused, 'flow-outside-root');
});

test('C1 the page says "This flow is outside the panel\'s folder." for that 403, and keeps its words for the other 403', async () => {
  assert.equal(await pageFailure(403, { ok: false, refused: 'flow-outside-root', red: 'flow-outside-root: x' }), OUTSIDE_WORDS);
  assert.equal(await pageFailure(403, { ok: false, refused: 'host-not-own-address', red: 'x' }), OTHER_403_WORDS);
  assert.equal(await pageFailure(403, null), OTHER_403_WORDS, 'a 403 whose body cannot be read keeps the old words');
  assert.equal(await pageFailure(404, { ok: false }), 'This run is no longer there.');
});

// ---- C9 ------------------------------------------------------------------------------------------------------------------------------
test('C9 a draft that finishes between the two reads is "done" (green), never "ended before it finished"', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am16p-c9-'));
  const id = 'd-0000000001-abcd';
  const dir = path.join(root, '.drafts', id);
  mkdirSync(path.join(dir, 'draft'), { recursive: true });
  writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ flowName: 'job2' }));
  // INJECTED TIMING: the child is "running" when asked, and finishes (writes its result) the moment it is asked — no sleeps.
  // Read order matters: asked first, the answer "finished" means the result is already on disk; result first, it is not yet.
  let asked = 0;
  const childRunning = () => {
    asked += 1;
    writeFileSync(path.join(dir, 'draft', 'spec.hash'), 'a'.repeat(64));
    writeFileSync(path.join(dir, 'draft', 'readout.txt'), 'readout');
    return false;
  };
  const author = createAuthor({
    root, home: undefined, skipMonthly: true, loadEnv: () => ({ ok: true, env: {}, refusal: null }), childRunning,
  });
  const got = author.get(id);
  assert.equal(got.status, 200);
  assert.ok(asked >= 1, 'the running check was made');
  assert.equal(got.body.phase, 'green', `phase ${got.body.phase}: ${got.body.say ?? ''}`);
  assert.doesNotMatch(JSON.stringify(got.body), /ended before it finished/);
});

// ---- C16 -----------------------------------------------------------------------------------------------------------------------------
const row = (kind, over = {}) => ({
  kind, n: 0, at: '2026-10-06T10:00:00.000Z', model: 'deepseek-flash', costUsd: 0.01, spendComplete: true, verdict: 'green', hash: 'abcdef012345', gap: null, ...over,
});
const cardRow = (n, at) => ({ kind: 'card', n, at, card: { flowName: 'job2', job: 'x', capUsd: 0.25 } });
const signRow = { kind: 'sign', n: 0, at: '2026-10-06T10:05:00.000Z', signedBy: 'hamr', hash: 'abcdef012345abcdef', flowHash: null };
async function auditOf(rows) {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  mkdirSync(path.join(flowDir, 'runs', 'run-1'), { recursive: true });
  writeFileSync(path.join(flowDir, 'setup.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { audit: getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1' }), detail: getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }) };
}

test('C16 no revise = 1 human check; one revise = 2 (header and card read the same count)', async () => {
  const none = await auditOf([cardRow(0, '2026-10-06T09:58:00.000Z'), row('draft'), signRow]);
  assert.equal(none.audit.draft.summary.humanChecks, 1);
  const one = await auditOf([
    cardRow(0, '2026-10-06T09:58:00.000Z'), row('draft'), cardRow(1, '2026-10-06T10:01:00.000Z'), row('revise', { n: 1, at: '2026-10-06T10:02:00.000Z' }), signRow,
  ]);
  assert.equal(one.audit.draft.summary.humanChecks, 2, 'one revise shows +1');
  assert.equal(one.detail.draft.humanChecks, 2);
});

// ---- I4 ------------------------------------------------------------------------------------------------------------------------------
function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am16p-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
const stepFn = (onCall) => async (ctx) => {
  const emits = emitsOf(ctx);
  if (onCall) onCall(emits);
  return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
};
const args = (w, modelStep, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});
const AT_ASK = 'stopped at the ask of step 4';
const AFTER_STEP = 'stopped — after the step that was running; Resume to go on';
const view = (w) => ({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });

/** A run parked at its ask, then stopped there (the ask is archived and set aside: status `stopped`). */
async function stoppedAtAsk(tag) {
  const w = mk(tag);
  const r = await runFlow({ ...args(w, stepFn()), sources: w.sources });
  assert.equal(r.outcome, 'paused', r.red);
  requestStop(w.runDir);
  const s = await R.stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(s.outcome, 'stopped', s.red);
  return w;
}
/** A run stopped between steps, before it reached the ask. */
async function stoppedAfterStep(tag) {
  const w = mk(tag);
  const r = await runFlow({ ...args(w, stepFn((e) => { if (e === 'resume-text') requestStop(w.runDir); })), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  return w;
}

test('I4 a run stopped at its ask reads `stopped at the ask of step N` in Runs, the run header, the Ask tab and the Inbox', async () => {
  const w = await stoppedAtAsk('i4a');
  const runs = listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
  assert.equal(runs.glyph, '[■]');
  assert.ok(`${runs.word ?? ''} ${runs.line ?? runs.label}`.includes(AT_ASK) || runs.label.includes(AT_ASK), `Runs: ${JSON.stringify(runs)}`);
  const d = getRunDetail(view(w));
  assert.ok(d.label.includes(AT_ASK), `header: ${d.label}`);
  assert.equal(d.word, null, 'the words are drawn whole, not split after a bold "stopped —"');
  const ask = getRunAsks(view(w)).asks[0];
  assert.equal(ask.status, 'stopped', 'the status word itself is unchanged');
  assert.equal(ask.statusText, AT_ASK, 'Ask tab');
  const inbox = listStops({ root: w.root }).find((x) => x.runId === 'run-1');
  assert.equal(inbox.statusText, AT_ASK, 'Inbox');
});

test('I4 a run stopped after a step keeps its label, and its asks (none) gain no words', async () => {
  const w = await stoppedAfterStep('i4b');
  const runs = listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
  assert.equal(runs.glyph, '[■]');
  assert.equal(runs.label, AFTER_STEP);
  const d = getRunDetail(view(w));
  assert.equal(d.label, AFTER_STEP);
  assert.equal(d.word, 'stopped');
  assert.deepEqual(getRunAsks(view(w)).asks, []);
  assert.equal(existsSync(path.join(w.runDir, 'ask.json')), false);
});

test('I4 the page draws the Inbox and Ask-tab status from statusText when the server gives it', () => {
  const stopStatusLine = new Function(`${cut('stopStatusLine')}\nreturn stopStatusLine;`)();
  assert.equal(stopStatusLine({ status: 'stopped', statusText: AT_ASK }), AT_ASK);
  assert.equal(stopStatusLine({ status: 'accepted' }), 'accepted');
  assert.match(cut('askStatusBlock'), /statusText/);
  assert.match(PAGE, /ask\.statusText \|\| ask\.status/);
});
