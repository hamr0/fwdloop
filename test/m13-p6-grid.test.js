// M13 piece 6 (item 8, mock Part 3 variant B): the Result tab's ONE grid of a job, server side. Pure grid first (buckets, newest first with a tie, the stats line's
// money), then through the real panel over REAL runs: two skipped ticket runs (`#<n>` names, reason, Run it anyway) and a plain passed run (`run-<n>`, books balance).
// Must fail when: a run lands in the wrong bucket; a tie on time orders run-9 after run-10; a partial or unknown cost reads as exact or as $0; the stats money is not
// the sum of the runs' history totals; a ticket run is not named `#<n>`; a skipped row loses its reason or its Run it anyway.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { createPanelServer } from '../src/panel/server.js';
import { buildJobGrid, bucketOf, checkCells, moneyWords } from '../src/panel/jobgrid.js';
import { skippedWorld } from './m12-p3-world.mjs';
import { buildWorld } from './m4d-am29-world.mjs';

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));
const open = async (root, home) => {
  const h = await createPanelServer({ port: 0, root, settings: { home: path.join(home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 } });
  HANDLES.push(h);
  return h;
};
const run = (runId, glyph, extra = {}) => ({
  runId, glyph, ticket: null, at: 1000, history: { spentUsd: 0.01, spendComplete: true, wallMs: 5000 }, spendRows: [], diary: [], steps: [], reason: null, ...extra,
});
const keys = (g) => Object.fromEntries(g.groups.map((x) => [x.key, x.rows.map((r) => r.runId)]));

test('each run lands in the bucket its glyph names; the fold labels are the mock\'s', () => {
  const g = buildJobGrid({ runs: [run('run-1', '[✓]'), run('run-2', '[✗]'), run('run-3', '[■]'), run('run-4', '[·]'), run('run-5', '[–]', { history: { spentUsd: 0, spendComplete: true, wallMs: 3 } }), run('run-6', '[▶]')] });
  assert.deepEqual(g.groups.map((x) => x.label), ['Needs you', 'Stopped', 'Passed', 'Skipped']);
  assert.deepEqual(keys(g), { wait: ['run-6', 'run-4'], stop: ['run-3', 'run-2'], done: ['run-1'], skip: ['run-5'] });
  assert.equal(bucketOf('[✓]'), 'done');
  assert.deepEqual(g.stats.counts, { wait: 2, stop: 2, done: 1, skip: 1 });
});

test('newest first inside a bucket; identical times fall back to the run NUMBER, not the text (run-10 before run-9)', () => {
  const g = buildJobGrid({ runs: [run('run-9', '[✓]'), run('run-10', '[✓]'), run('run-2', '[✓]', { at: 5000 })] });
  assert.deepEqual(keys(g).done, ['run-2', 'run-10', 'run-9']);
});

test('the stats money is the sum of the runs\' totals; a floor or an unknown run makes it "at least"; unknown is never $0', () => {
  const exact = buildJobGrid({ runs: [run('run-1', '[✓]'), run('run-2', '[✓]', { history: { spentUsd: 0.02, spendComplete: true, wallMs: 1 } })] });
  assert.equal(exact.stats.spent, '$0.0300');
  assert.equal(exact.stats.spentComplete, true);
  const floor = buildJobGrid({ runs: [run('run-1', '[✓]'), run('run-2', '[✗]', { history: { spentUsd: 0.02, spendComplete: false, wallMs: 1 } })] });
  assert.equal(floor.stats.spent, 'at least $0.0300');
  const unknown = buildJobGrid({ runs: [run('run-1', '[✓]'), run('run-2', '[▶]', { history: null })] });
  assert.equal(unknown.stats.spent, 'at least $0.0100', 'a run with no figure keeps the sum a floor');
  const row = unknown.groups.find((x) => x.key === 'wait').rows[0];
  assert.deepEqual(row.cost, { mark: 'q', value: '—' });
  assert.ok(row.lines.includes('cost unknown, not shown as $0'));
  assert.equal(buildJobGrid({ runs: [run('run-1', '[▶]', { history: null })] }).stats.spent, null, 'nothing known: no figure, not $0');
  assert.equal(moneyWords(0, true), '$0');
  assert.equal(moneyWords(0, false), 'at least $0.0000');
  // a run with no history row but priced spend rows shows the priced floor
  const waiting = buildJobGrid({ runs: [run('run-1', '[·]', { history: null, spendRows: [{ costUsd: 0.01 }, { costUsd: 0.02 }, {}] })] });
  assert.equal(waiting.groups[0].rows[0].cost.value, 'at least $0.0300');
});

test('check cells: green when every step\'s newest try passed; red on a failed check; nothing ran = a dot; red with no record = ?', () => {
  const steps = [{ emits: 'a', goal: 'Read the ticket,' }, { emits: 'b', goal: 'Write the note.' }];
  const d = (step, tr, checks) => ({ step, try: tr, checks });
  const ok = (n, text, source) => ({ n, text, ok: true, result: null, source });
  const bad = (n, text, source) => ({ n, text, ok: false, result: '812 words', source });
  const green = checkCells({ diary: [d('a', 1, [ok(1, 'exists', 'every step'), ok(2, 'done', 'every step')]), d('b', 1, [ok(1, 'exists', 'every step'), ok(3, 'words', 'line 2 ~')])], steps, ended: true, red: false, skipped: false });
  assert.deepEqual([green.ex, green.oj], ['g', 'g']);
  assert.deepEqual(green.lines.slice(0, 2), ['step 1 Read the ticket: exists, done', 'step 2 Write the note: exists, done']);
  const red = checkCells({ diary: [d('b', 1, [ok(1, 'exists', 'every step'), bad(3, 'under 600 words', 'line 2 ~')]), d('b', 2, [ok(1, 'exists', 'every step'), bad(3, 'under 600 words', 'line 2 ~')])], steps, ended: true, red: true, skipped: false });
  assert.deepEqual([red.ex, red.oj], ['g', 'r']);
  const older = checkCells({ diary: [d('b', 1, [bad(2, 'the model said done: true', 'every step')]), d('b', 2, [ok(1, 'exists', 'every step'), ok(2, 'done', 'every step')])], steps, ended: true, red: false, skipped: false });
  assert.equal(older.ex, 'g', 'only the newest try of a step counts');
  const only12 = checkCells({ diary: [d('a', 1, [ok(1, 'exists', 'every step'), ok(2, 'done', 'every step')]), d('b', 1, [ok(1, 'exists', 'every step'), ok(2, 'done', 'every step')])], steps, ended: true, red: false, skipped: false });
  assert.deepEqual([only12.ex, only12.oj], ['g', 'none'], 'steps ran with only #1 and #2: the job has no output check');
  const mixed = checkCells({ diary: [d('a', 1, [ok(1, 'exists', 'every step'), ok(2, 'done', 'every step')]), d('b', 1, [ok(1, 'exists', 'every step'), ok(3, 'words', 'line 2 ~')])], steps, ended: true, red: false, skipped: false });
  assert.equal(mixed.oj, 'g', 'one #3 anywhere means the job has an output check');
  assert.deepEqual(checkCells({ diary: [], steps, ended: false, red: false, skipped: false }), { ex: 'n', oj: 'n', lines: [] });
  assert.deepEqual(checkCells({ diary: [], steps, ended: true, red: true, skipped: false }), { ex: 'q', oj: 'q', lines: [] });
  assert.deepEqual(checkCells({ diary: [], steps, ended: true, red: false, skipped: true }), { ex: 'n', oj: 'n', lines: [] });
});

test('through the real panel: skipped ticket runs are named #<n>, carry reason, $0 and Run it anyway; the stats line counts them', async (t) => {
  const w = await skippedWorld(t);
  const h = await open(w.root, w.home);
  const g = await (await fetch(`http://127.0.0.1:${h.port}/api/runs/tick/run-1/grid`)).json();
  const skip = g.groups.find((x) => x.key === 'skip').rows;
  assert.deepEqual(skip.map((r) => [r.name, r.reason, r.cost.value, r.anyway]).sort(), [['#102', 'priority P3, not P1 or P2', '$0', true], ['#103', 'closed', '$0', true]]);
  assert.equal(g.anywayRunId, 'run-1');
  assert.deepEqual(g.stats.counts, { wait: 0, stop: 0, done: 0, skip: 2 });
  assert.equal(g.stats.spent, '$0');
  assert.equal((await fetch(`http://127.0.0.1:${h.port}/api/runs/nojob/run-1/grid`)).status, 404);
});

test('through the real panel: a plain job\'s run is named run-<n>, no ticket schedule means no Run it anyway, and the books balance', async () => {
  const w = await buildWorld();
  {
    const h = await open(w.root, w.home);
    const g = await (await fetch(`http://127.0.0.1:${h.port}/api/runs/job2/run-1/grid`)).json();
    const rows = g.groups.flatMap((x) => x.rows);
    assert.deepEqual(rows.map((r) => [r.name, r.bucket]), [['run-1', 'done']]);
    assert.equal(g.anywayRunId, null);
    const hist = readFileSync(path.join(w.root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const total = hist.reduce((a, r) => a + r.spentUsd, 0);
    assert.ok(total > 0, 'the fake provider priced the run');
    assert.ok(Math.abs(g.stats.spentUsd - total) < 1e-9, `grid ${g.stats.spentUsd} vs history ${total}`);
    assert.equal(g.stats.spent, moneyWords(total, hist.every((r) => r.spendComplete !== false)));
    assert.deepEqual([rows[0].ex, rows[0].oj], ['g', 'g']);
  }
});

test('Run it anyway is offered only for a ticket the ticket list holds skipped (a later run of that ticket takes it away) and never without a ticket schedule', () => {
  const runs = [run('run-1', '[–]', { ticket: 5 }), run('run-2', '[–]', { ticket: 6 })];
  const row = (g, n) => g.groups.flatMap((x) => x.rows).find((r) => r.number === n);
  const g = buildJobGrid({ runs, anyway: { runId: 'run-1', numbers: new Set([5]) } });
  assert.deepEqual([row(g, 5).anyway, row(g, 6).anyway], [true, false]);
  assert.equal(row(buildJobGrid({ runs }), 5).anyway, false);
});
