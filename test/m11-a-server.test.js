// M11 piece A (docs/wiki/the-module-ladder.md "M11 scope", amendments 1 and 2): the SERVER gives the runs list every state, so the page never
// works one out. One function decides a run's Needs-you tag (`needsYouTag`, over the glyph and `runControls`), the Scheduled list is built from
// the same owners the run page's SCHEDULED block uses, and the response carries the two named limits (30 days, 7 runs) once. $0: a fake
// modelStep, in-process; temp dirs are removed by scripts/tmp-track.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow, writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep, requestStop, stopParkedRun } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import {
  listRuns, listScheduled, needsYouTag, RUNS_LIST_LIMITS, summarizeJobs,
} from '../src/panel/data.js';
import { nextInWords, nextTimeWords } from '../src/summary-words.js';
import { killChildrenAfter } from './m4e-world.mjs';
import { DAILY, greenWorld, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const EDITED = 'stopped — the job was edited; start a new run';

/** A signed job2 whose first run parks at its ask (`waiting`), or hits its money cap (`cap`). */
async function parkedRun(tag, kind = 'waiting') {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m11a-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const cap = kind === 'cap' ? '0.0105' : '0.25';
  w.prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`).replace('cap $0.25', `cap $${cap}`);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  assert.equal(run.outcome, kind === 'cap' ? 'cap-halt' : 'paused', run.red);
  return w;
}
const rowOf = (w) => listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
function replaceJob(w, from, to) {
  const oldHash = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: w.prose.replace(from, to), declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash },
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
}

test('needsYouTag: one rule, every sign (am1 item 2, am2)', () => {
  const none = { atAsk: false, canResume: false };
  assert.equal(needsYouTag('[·]', { atAsk: true, canResume: false }), 'Accept', 'waiting at an open ask');
  assert.equal(needsYouTag('[·]', none), null, 'answered, not resumed: not waiting on you');
  assert.equal(needsYouTag('[II]', none), 'Resume', 'stuck');
  assert.equal(needsYouTag('[■]', { atAsk: false, canResume: true }), 'Resume', 'stopped and the Resume button shows (am2 item 1)');
  assert.equal(needsYouTag('[■]', none), null, 'stopped with no Resume button (am2 item 2)');
  assert.equal(needsYouTag('[!]', { atAsk: false, canResume: true }), null, 'expired is never in Needs you (am1 item 2)');
  for (const g of ['[✓]', '[✗]', '[▶]', '[?]']) assert.equal(needsYouTag(g, { atAsk: true, canResume: true }), null, g);
});

test('listRuns: a run waiting at its ask carries Accept; the same run past its expiry is [!] and carries none', async () => {
  const w = await parkedRun('wait');
  const row = rowOf(w);
  assert.equal(row.glyph, '[·]');
  assert.equal(row.needs, 'Accept');
  assert.equal(row.live, false);
  const askPath = path.join(w.runDir, 'ask.json');
  const ask = JSON.parse(readFileSync(askPath, 'utf8'));
  writeFileSync(askPath, JSON.stringify({ ...ask, expiresAt: '2020-01-01T00:00:00.000Z' }));
  const past = rowOf(w);
  assert.equal(past.glyph, '[!]');
  assert.equal(past.needs, null);
});

test('listRuns: an answer saved and not taken, nothing carrying it on, is stuck [II] and carries Resume', async () => {
  const w = await parkedRun('stuck');
  const ask = JSON.parse(readFileSync(path.join(w.runDir, 'ask.json'), 'utf8'));
  writeFileSync(path.join(w.runDir, 'answer.json'), JSON.stringify({ askId: ask.askId, decision: 'accept', answeredAt: new Date().toISOString() }));
  const row = rowOf(w);
  assert.equal(row.glyph, '[II]', row.label);
  assert.equal(row.needs, 'Resume');
});

test('listRuns: a stopped run with the Resume button carries Resume; once the job is edited (no button) it carries none', async () => {
  const w = await parkedRun('stop');
  requestStop(w.runDir);
  const stop = await stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(stop.outcome, 'stopped', stop.red);
  const row = rowOf(w);
  assert.equal(row.glyph, '[■]');
  assert.equal(row.controls.canResume, true);
  assert.equal(row.needs, 'Resume');
  replaceJob(w, 'cap $0.25', 'cap $0.30');
  const edited = rowOf(w);
  assert.equal(edited.glyph, '[■]');
  assert.equal(edited.label, EDITED);
  assert.equal(edited.controls.canResume, false);
  assert.equal(edited.needs, null);
});

test('listRuns: a cap-halted run that can continue carries Resume (the same canResume answer)', async () => {
  const w = await parkedRun('cap', 'cap');
  const row = rowOf(w);
  assert.equal(row.glyph, '[■]');
  assert.equal(row.needs, row.controls.canResume ? 'Resume' : null);
  assert.equal(row.controls.canResume, true);
});

test('listRuns: every row carries the model its books name (null when none ran), for the run card', async () => {
  const w = await parkedRun('model');
  const row = rowOf(w);
  assert.ok('model' in row, 'model key present');
  assert.ok(row.model === null || typeof row.model === 'string');
});

test('words: next time and next in, fixed forms (am1 item 3)', () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
  const now = at(2026, 10, 13, 14, 0);
  assert.equal(nextTimeWords(at(2026, 10, 13, 17, 0), now), 'today 17:00');
  assert.equal(nextTimeWords(at(2026, 10, 14, 9, 0), now), 'tomorrow 09:00');
  assert.equal(nextTimeWords(at(2026, 10, 20, 9, 5), now), 'Tue 20 Oct, 09:05', 'later than tomorrow: the date, as the NEXT line says it');
  assert.equal(nextInWords(at(2026, 10, 13, 17, 0), now), 'next in 3h');
  assert.equal(nextInWords(at(2026, 10, 13, 14, 20), now), 'next in 20m');
  assert.equal(nextInWords(at(2026, 10, 13, 14, 0) + 5_000, now), 'next in 1m', 'never "0m"');
  assert.equal(nextInWords(at(2026, 10, 14, 9, 0), now), 'next in 19h');
  assert.equal(nextInWords(at(2026, 10, 16, 14, 0), now), 'next in 3d');
});

test('listScheduled: only jobs with a trigger, soonest first; a job with no slot sorts after those that have one', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m11a-sched-'));
  for (const f of ['aaa', 'bbb', 'ccc', 'ddd']) mkdirSync(path.join(root, f));
  const now = new Date(2026, 9, 13, 14, 0).getTime();
  const slot = (h) => new Date(2026, 9, 13, h, 0).getTime();
  const daily = (h) => ({ kind: 'daily', hour: h, minute: 0 });
  const reads = {
    aaa: { trigger: daily(20), armed: true, nextSlotMs: slot(20), lastOutcome: null },
    bbb: { trigger: null, armed: false, nextSlotMs: null, lastOutcome: null },
    ccc: { trigger: daily(17), armed: true, nextSlotMs: slot(17), lastOutcome: null },
    ddd: { trigger: { kind: 'file-updated', path: '/x/in.csv', role: 'r' }, armed: true, nextSlotMs: null, lastOutcome: null },
  };
  const got = listScheduled({ root, triggerRead: (f) => reads[f], now: () => now, home: '/h' });
  assert.deepEqual(got.map((s) => s.flow), ['ccc', 'aaa', 'ddd']);
  assert.deepEqual(got[0], { flow: 'ccc', at: 'today 17:00', in: 'next in 3h', words: 'Every day at 17:00' });
  assert.equal(got[2].at, null, 'no clock slot: no invented time');
  assert.equal(got[2].in, null);
  assert.equal(got[2].words, 'When in.csv is updated');
  assert.deepEqual(listScheduled({ root, triggerRead: () => null, now: () => now }), [], 'unreadable jobs are absent');
});

test('summarizeJobs: newest activity first; quiet only when the newest run is known and older than 30 days; unknown age is never quiet', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const day = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString();
  const rows = [
    { flow: 'old', runId: 'run-1', at: iso(now - 31 * day) },
    { flow: 'edge', runId: 'run-1', at: iso(now - 30 * day) },
    { flow: 'fresh', runId: 'run-2', at: iso(now - 2 * day) },
    { flow: 'fresh', runId: 'run-1', at: iso(now - 40 * day) },
    { flow: 'parked', runId: 'run-1', at: null, askedAt: iso(now - 1 * day) },
    { flow: 'unknown', runId: 'run-1', at: null, askedAt: null, startedAt: null },
    { flow: 'empty', runId: null, at: null },
  ];
  const got = summarizeJobs(rows, now);
  assert.deepEqual(got.map((j) => j.flow), ['parked', 'fresh', 'edge', 'old', 'empty', 'unknown']);
  const q = Object.fromEntries(got.map((j) => [j.flow, j.quiet]));
  assert.deepEqual(q, { parked: false, fresh: false, edge: false, old: true, empty: false, unknown: false });
});

test('limits: 30 days and 7 runs are named once on the server', () => {
  assert.deepEqual(RUNS_LIST_LIMITS, { quietDays: 30, olderRuns: 7 });
});

test('GET /api/runs carries rows, scheduled, jobs and limits (real HTTP); a job with a trigger is in scheduled, one without is not', async () => {
  const { w } = await greenWorld();
  const before = (await w.get('/api/runs')).json();
  assert.deepEqual(before.scheduled, []);
  assert.deepEqual(before.limits, { quietDays: 30, olderRuns: 7 });
  assert.deepEqual(before.jobs.map((j) => j.flow), ['job2']);
  const set = await setTrigger(w, DAILY);
  assert.equal(set.status, 200, set.text);
  const after = (await w.get('/api/runs')).json();
  assert.equal(after.scheduled.length, 1);
  const s = after.scheduled[0];
  assert.equal(s.flow, 'job2');
  assert.equal(s.words, 'Every day at 09:00');
  assert.match(s.at, /^(today|tomorrow) 09:00$/);
  assert.match(s.in, /^next in \d+[mhd]$/);
  assert.ok(Array.isArray(after.rows) && after.rows.length > 0);
});
