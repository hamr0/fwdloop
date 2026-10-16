// M11 amendment 15 (docs/wiki/the-module-ladder.md): a job's top row is its waiting run, if it has one. A stuck run that has left Needs you
// (RUNS_LIST_LIMITS.needsYouDays, M11 am3 item 5) is no longer the top row; the newest run by time is. orderRuns is the ONE decider: the job
// card head (the page's first run of a job) and the Scheduled card's runId (listScheduled's first row of that job) both read its order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { orderRuns, listScheduled, needsYouTag, RUNS_LIST_LIMITS } from '../src/panel/data.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
// `needs` is what listRuns stamps from needsYouOf: the tag while the card is in Needs you, null once it has left.
const stuck = (runId, daysAgo) => ({
  flow: 'f', runId, glyph: '[II]', stuck: true, waiting: false, at: null, needs: needsYouTag('[II]', { atAsk: false, canResume: true }, iso(daysAgo), NOW),
});
const passed = (runId, daysAgo) => ({ flow: 'f', runId, glyph: '[✓]', waiting: false, at: iso(daysAgo), needs: null });
const waiting = (runId) => ({ flow: 'f', runId, glyph: '[·]', waiting: true, timeLeftMs: 600_000, at: null, needs: 'Answer' });
const top = (rows) => orderRuns(rows)[0].runId;

test('(a) a stuck run past the Needs-you days is not the top row; the newer passed run is', () => {
  const rows = [passed('run-9', 1), stuck('run-2', RUNS_LIST_LIMITS.needsYouDays + 1)];
  assert.equal(rows[1].needs, null, 'fixture: the stuck run has left Needs you');
  assert.deepEqual(orderRuns(rows).map((r) => r.runId), ['run-9', 'run-2']);
});

test('(b) a stuck run still inside its days stays the top row', () => {
  const rows = [passed('run-9', 1), stuck('run-2', RUNS_LIST_LIMITS.needsYouDays - 1)];
  assert.equal(rows[1].needs, 'Resume');
  assert.equal(top(rows), 'run-2');
});

test('(c) a waiting-at-ask run stays top whatever else is there, stuck or not', () => {
  assert.equal(top([passed('run-9', 0), stuck('run-2', 30), waiting('run-5')]), 'run-5');
  assert.equal(top([passed('run-9', 0), stuck('run-3', 1), waiting('run-5')]), 'run-5');
});

test('the Scheduled card follows the same top row (listScheduled reads orderRuns order)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m11am15-'));
  mkdirSync(path.join(root, 'f'));
  const reads = { f: { trigger: { kind: 'daily', hour: 9, minute: 0 }, armed: true, nextSlotMs: NOW + DAY, lastOutcome: null } };
  const card = (rows) => listScheduled({ root, triggerRead: (f) => reads[f], now: () => NOW, rows: orderRuns(rows) })[0].runId;
  assert.equal(card([passed('run-9', 1), stuck('run-2', 30)]), 'run-9');
  assert.equal(card([passed('run-9', 1), stuck('run-2', 1)]), 'run-2');
});

// Ledger (2026-10-16): the fixtures above stamp `needs` themselves. These go through the REAL listRuns -> needsYouOf path, so a needsYouOf that stopped
// nulling an aged or Removed stuck run breaks am15 here.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { listRuns } from '../src/panel/data.js';
import { removeFromNeedsYou } from '../src/panel/needsyou.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

/** A real signed job whose run parks at its ask, then has a saved answer `answeredDaysAgo` old and no live process: a stuck [II] run. */
async function stuckWorld(tag, answeredDaysAgo) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m11am15-${tag}-`));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(),
    sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  assert.equal(run.outcome, 'paused', run.red);
  const runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const ask = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8'));
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ askId: ask.askId, decision: 'accept', answeredAt: new Date(Date.now() - answeredDaysAgo * DAY).toISOString() }));
  w.row = () => listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
  return w;
}
// the job's page order: the real list row for the stuck run, beside a newer passed run (the stuck run is the top row only while it is in Needs you)
const topOf = (w) => orderRuns([passed('run-9', 0), w.row()])[0].runId;

test('through listRuns: a stuck run aged past the Needs-you days is not the top row; the newer passed run is', async () => {
  const w = await stuckWorld('aged', RUNS_LIST_LIMITS.needsYouDays + 1);
  assert.equal(w.row().glyph, '[II]');
  assert.equal(w.row().needs, null, 'listRuns (needsYouOf) took it out of Needs you by age');
  assert.equal(topOf(w), 'run-9');
});

test('through listRuns: a stuck run a human Removed is not the top row', async () => {
  const w = await stuckWorld('removed', 0);
  assert.equal(w.row().needs, 'Resume', 'fixture: a fresh stuck run is in Needs you before the Remove');
  assert.equal(removeFromNeedsYou({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }).ok, true);
  assert.equal(w.row().glyph, '[II]', 'Remove changes nothing else');
  assert.equal(w.row().needs, null);
  assert.equal(topOf(w), 'run-9');
});

test('through listRuns: a fresh stuck run is the top row', async () => {
  const w = await stuckWorld('fresh', 0);
  assert.equal(w.row().needs, 'Resume');
  assert.equal(topOf(w), 'run-1');
});
