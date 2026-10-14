// M11 piece B (docs/wiki/the-module-ladder.md "M11 scope", amendments 1 and 2; design docs/product/m11-runs-list-mock.html, the right box):
// the left Runs list is ONE list. The page's own functions run over fake data, $0; the layout is a browser walk (piece C).
// The page never works out a state: every tag / split / order below comes from the server's payload (piece A).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
function fnSrc(name) {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(start, i + 1);
  }
  assert.fail(`function ${name} has no closing brace`);
}
const NAMES = [
  'escapeXml', 'duration', 'glyphClass', 'dotClass', 'signHtml', 'readableDateTime', 'runSpendText', 'runWallText', 'runAtText',
  'rlShortDate', 'groupRunsByFlow', 'matchesSearch', 'filterRuns', 'filterWorkflows', 'filtersActive',
  'rlModel', 'rlSectHtml', 'rlJumpCardHtml', 'rlScheduledCardHtml', 'rlRunCardHtml', 'rlJobCardHtml', 'rlTopHtml', 'rlJobsHtml',
];
const lib = new Function(`${NAMES.map(fnSrc).join('\n')}\nreturn {${NAMES.join(',')}};`)();
// the ONE short date of every card: local `MM/DD HH:MM`
const short = (iso) => { const d = new Date(iso); const t = (n) => String(n).padStart(2, '0'); return `${t(d.getMonth() + 1)}/${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}`; };
const LIMITS = { quietDays: 30, olderRuns: 7 };
const NONE = { results: [], time: 'all', search: '' };

const run = (flow, n, over = {}) => ({
  flow, runId: `run-${n}`, glyph: '[✓]', word: 'passed', line: null, label: 'passed', pulse: false, spend: '$0.0100', spendWhy: null,
  wallMs: 60_000, at: '2026-10-12T10:00:00.000Z', askedAt: null, startedAt: null, model: 'deepseek-flash', needs: null, live: false, ...over,
});
/** `k` runs of one job, newest first (run-k ... run-1). */
const runsOf = (flow, k) => Array.from({ length: k }, (_, i) => run(flow, k - i));
const meta = (flow, quiet = false) => ({ flow, quiet, activityMs: 1 });
const payload = (rows, jobs, scheduled = []) => ({ rows, jobs, scheduled, limits: LIMITS });
function model(data, { filters = NONE, sel = { flow: null, runId: null }, open = {} } = {}) {
  const groups = lib.filterWorkflows(lib.groupRunsByFlow(data.rows), filters, Date.now());
  return lib.rlModel(data, groups, filters, LIMITS, sel, open);
}
// the sign is drawn by CSS from the dot's class (as everywhere on the page): put it back as text so a card reads as the mockup does
const SIGN = {
  green: '[✓]', red: '[✗]', amber: '[▶]', grey: '[·]', magenta: '[?]', expired: '[!]', stuck: '[II]', stopped: '[■]',
};
const text = (html) => html.replace(/<span class="dot (\w+)[^"]*"><\/span>/g, (_, c) => SIGN[c]).replace(/<[^>]*>/g, '').replace(/&mdash;/g, '—').replace(/&middot;/g, '·');

test('order and hiding: Running now, Needs you, Scheduled, then Jobs, then the quiet fold; a section with 0 items draws nothing', () => {
  const rows = [
    run('aging', 5, { glyph: '[▶]', live: true, word: 'running', label: 'running', startedAt: '2026-10-13T10:00:00.000Z', at: null }),
    run('inv', 2, { glyph: '[·]', word: 'waiting', label: 'waiting on you', needs: 'Accept' }),
    run('old', 1, { at: '2026-08-01T00:00:00.000Z' }),
  ];
  const data = payload(rows, [meta('aging'), meta('inv'), meta('old', true)], [{ flow: 'aging', at: 'today 17:00', in: 'next in 3h', words: 'Weekdays at 17:00' }]);
  const m = model(data);
  const top = text(lib.rlTopHtml(m));
  const jobs = text(lib.rlJobsHtml(m));
  const at = (s, needle) => { const i = s.indexOf(needle); assert.ok(i !== -1, `"${needle}" missing from ${s}`); return i; };
  assert.ok(at(top, 'Running now (1)') < at(top, 'Needs you (1)') && at(top, 'Needs you (1)') < at(top, 'Scheduled (1)'));
  assert.ok(at(jobs, 'Jobs (2) · run in the last 30 days') < at(jobs, '▸ quiet jobs (1) · no run in 30 days'));
  // nothing running, nobody needs you, nothing scheduled, no jobs: nothing is drawn, not even a header
  const empty = model(payload([], []));
  assert.equal(lib.rlTopHtml(empty), '');
  assert.doesNotMatch(text(lib.rlJobsHtml(empty)), /Jobs \(|quiet jobs|Running now|Needs you|Scheduled/);
  const calm = model(payload([run('a', 1)], [meta('a')]));
  assert.doesNotMatch(text(lib.rlTopHtml(calm)), /Running now|Needs you|Scheduled/);
  assert.doesNotMatch(text(lib.rlJobsHtml(calm)), /quiet jobs/, 'no quiet job: no quiet line');
});

test('Must fail when a filter or search hides a Running now, Needs you or Scheduled card: they never read the filters', () => {
  const rows = [
    run('aging', 5, { glyph: '[▶]', live: true, word: 'running', label: 'running', startedAt: '2026-10-13T10:00:00.000Z' }),
    run('inv', 2, { glyph: '[·]', word: 'waiting', label: 'waiting on you', needs: 'Accept' }),
    run('kyc', 3, { glyph: '[II]', word: 'stuck', label: 'stuck', needs: 'Resume' }),
  ];
  const data = payload(rows, [meta('aging'), meta('inv'), meta('kyc')], [{ flow: 'aging', at: 'today 17:00', in: 'next in 3h', words: 'Weekdays at 17:00' }]);
  for (const filters of [{ results: ['[✗]'], time: 'all', search: '' }, { results: [], time: 'all', search: 'zzz-no-such-job' }, { results: [], time: '7d', search: 'run-99' }]) {
    const m = model(data, { filters });
    assert.equal(m.jobs.length + m.quiet.length, 0, 'the filters did hide every job');
    assert.equal(m.running.length, 1);
    assert.deepEqual(m.needs.map((r) => r.flow), ['inv', 'kyc']);
    assert.equal(m.scheduled.length, 1);
  }
});

test('the Needs-you tag is the server\'s: the page shows what `needs` says and works out nothing from the sign', () => {
  const rows = [
    run('a', 1, { glyph: '[II]', word: 'stuck', label: 'stuck', needs: null }), // the server said no: not in Needs you
    run('b', 1, { glyph: '[·]', word: 'waiting', label: 'waiting on you', needs: 'Accept' }),
    run('c', 1, { glyph: '[■]', word: 'stopped', label: 'stopped', needs: 'Resume' }),
    run('d', 1, { glyph: '[!]', word: 'expired', label: 'expired', needs: null }),
  ];
  const m = model(payload(rows, rows.map((r) => meta(r.flow))));
  assert.deepEqual(m.needs.map((r) => [r.flow, r.needs]), [['b', 'Accept'], ['c', 'Resume']]);
  const html = lib.rlTopHtml(m);
  assert.match(html, /class="rl-pill rl-pill-need"[^>]*>Accept</);
  assert.match(html, /class="rl-pill rl-pill-need"[^>]*>Resume</);
  assert.doesNotMatch(html.replace(/<span class="rl-pill[^>]*>[^<]*<\/span>/g, ''), /Accept|Resume/, 'the tag is a label, not a button');
});

test('cards: Running now / Needs you jump; the tag is a label; the Scheduled card jumps to the newest run of its job (am4 item 2); lines per am1', () => {
  const rows = [
    run('aging', 12, { glyph: '[▶]', live: true, word: 'running', label: 'running', startedAt: '2026-10-13T10:00:00.000Z', at: null, spend: 'at least $0.0042' }),
    run('inv', 2, { glyph: '[·]', word: 'waiting', label: 'waiting on you', needs: 'Accept', askedAt: null, at: '2026-10-13T19:12:00.000Z' }),
  ];
  const data = payload(rows, [meta('aging'), meta('inv')], [{ flow: 'aging', at: 'tomorrow 09:00', in: 'next in 11h', words: 'Weekdays at 09:00', runId: 'run-12' }]);
  const html = lib.rlTopHtml(model(data));
  const cards = html.split(/(?=<(?:button|div) class="rl-card)/).filter((c) => /^<(button|div) class="rl-card/.test(c));
  const [run1, need, sched] = [cards[0], cards[1], cards[2]];
  assert.match(run1, /^<button[^>]*data-rl-jump="aging\|run-12"/);
  assert.match(text(run1), /^\[▶\]aging run-12\s*·\s*·\s*at least \$0\.0042\s*running/s, 'line 1: sign job run-N · since (filled by the page) · cost (M11 am6); line 2: the why');
  assert.doesNotMatch(run1.slice(0, run1.indexOf('</button>')), /sign-word/, 'line 2 of Running now has no sign word in front');
  assert.match(run1, /data-rl-since="2026-10-13T10:00:00\.000Z"/, 'time so far ticks in place from the start time');
  assert.match(need, /^<button[^>]*data-rl-jump="inv\|run-2"/);
  assert.match(need, /class="[^"]*rl-need/);
  assert.equal(text(need.slice(0, need.indexOf('</button>'))), `[·]inv run-2Acceptwaiting on you · ${short('2026-10-13T19:12:00.000Z')}`, 'why · date, no sign word');
  assert.doesNotMatch(need.slice(0, need.indexOf('</button>')), /sign-word/);
  assert.match(sched, /^<button class="rl-card"[^>]*type="button"[^>]*data-rl-jump="aging\|run-12"/, 'same click as Running now: a button, keyboard reachable');
  assert.doesNotMatch(sched, /data-rl-run/);
  assert.equal(text(sched).replace(/\s+/g, ' ').trim(), '[·]aging · tomorrow 09:00next in 11h · Weekdays at 09:00');
  const bare = lib.rlTopHtml(model(payload(rows, [meta('aging'), meta('inv')], [{ flow: 'x', at: null, in: null, words: 'When in.csv is updated', runId: null }])));
  assert.match(bare, /<div class="rl-card" data-testid="rl-sched-x"/, 'a job with no run has nothing to open: not a button');
});

test('Running now: an unknown cost reads "unknown" (never $0, never the long reason)', () => {
  const rows = [run('aging', 5, { glyph: '[▶]', live: true, word: 'running', label: 'running', startedAt: '2026-10-13T10:00:00.000Z', at: null, spend: null, spendWhy: 'running — no priced spend yet' })];
  const t = text(lib.rlTopHtml(model(payload(rows, [meta('aging')])))).replace(/\s+/g, ' ');
  assert.match(t, /· unknown/);
  assert.doesNotMatch(t, /\$0\b|no priced spend/);
});

test('a Scheduled card with no clock slot draws no invented time', () => {
  const data = payload([run('a', 1)], [meta('a')], [{ flow: 'a', at: null, in: null, words: 'When in.csv is updated' }]);
  const t = text(lib.rlTopHtml(model(data))).replace(/\s+/g, ' ');
  assert.match(t, /\[·\]a\s*When in\.csv is updated/);
  assert.doesNotMatch(t, /next in|today|tomorrow/);
});

test('Must fail when a job\'s 9th-newest run shows without search: 9 runs = the newest + 7 older, then the fold line', () => {
  const data = payload(runsOf('flights', 9), [meta('flights')]);
  const m = model(data, { open: { flights: true } });
  const card = m.jobs[0];
  assert.equal(card.count, 9);
  assert.equal(card.head.runId, 'run-9');
  assert.deepEqual(card.older.shown.map((r) => r.runId), ['run-8', 'run-7', 'run-6', 'run-5', 'run-4', 'run-3', 'run-2']);
  assert.equal(card.older.hidden, 1);
  const html = text(lib.rlJobsHtml(m));
  assert.match(html, /1 more runs on \d\d\/\d\d\. Search to find one\./, 'M11 am7 item 4 (replaces am5 item 5): the no-search fold line, one day');
  assert.doesNotMatch(html, /run-1\b/, 'the 9th-newest run is not shown');
  // closed fold: the older runs are not listed at all, and the fold line says how many
  const closed = text(lib.rlJobsHtml(model(data)));
  assert.match(closed, /▸ older runs \(8\)/);
  assert.doesNotMatch(closed, /run-8/);
  // 8 runs or fewer: nothing hidden, no hint
  assert.equal(model(payload(runsOf('f', 8), [meta('f')]), { open: { f: true } }).jobs[0].older.hidden, 0);
});

test('a selected run past the 7 is still shown', () => {
  const data = payload(runsOf('flights', 12), [meta('flights')]);
  const m = model(data, { sel: { flow: 'flights', runId: 'run-1' }, open: { flights: true } });
  const card = m.jobs[0];
  assert.deepEqual(card.older.shown.map((r) => r.runId), ['run-11', 'run-10', 'run-9', 'run-8', 'run-7', 'run-6', 'run-5', 'run-1']);
  assert.equal(card.older.hidden, 11 - 7 - 1);
  assert.equal(card.selected, true, 'the job card is highlighted when the selected run is one of its runs');
  assert.match(lib.rlJobsHtml(m), /class="rl-card rl-sel[^"]*"[^>]*data-testid="rl-run-flights-run-1"/);
});

test('with the older fold shut, a selected older run opens it (nothing selected hides behind a fold)', () => {
  const data = payload(runsOf('flights', 4), [meta('flights')]);
  const m = model(data, { sel: { flow: 'flights', runId: 'run-2' } });
  assert.equal(m.jobs[0].older.open, true);
  const manualShut = model(data, { sel: { flow: 'flights', runId: 'run-2' }, open: { flights: false } });
  assert.equal(manualShut.jobs[0].older.open, false, 'a manual close wins, as today');
});

test('search for an older run opens its job ON that run: only the matching older runs show (M11 am5 item 4); the job card still describes its newest run', () => {
  const data = payload(runsOf('flights', 12), [meta('flights')]);
  const m = model(data, { filters: { results: [], time: 'all', search: 'run-2' } });
  const card = m.jobs[0];
  assert.equal(card.older.open, true);
  assert.deepEqual(card.older.shown.map((r) => r.runId), ['run-2'], 'only the hit');
  assert.equal(card.older.hidden, 0, 'nothing else matches, so nothing is counted');
  assert.equal(card.head.runId, 'run-12', 'the card line 2 is the newest run, not the match');
  assert.equal(model(data, { filters: { results: [], time: 'all', search: 'nope' } }).jobs.length, 0, 'a job with no matching run is gone');
  // a filter is capped the same way: a chip matching all 11 older runs shows the 7, the newest match is already inside them (M11 am1, hamr ruled A)
  const all = model(data, { filters: { results: ['[✓]'], time: 'all', search: '' } }).jobs[0];
  assert.equal(all.older.shown.length, 7, 'the cap holds under a chip');
  assert.equal(all.older.hidden, 4);
});

test('search: an older matching run is shown; non-matching older runs are never shown (M11 am5 item 4)', () => {
  const data = payload(runsOf('flights', 20), [meta('flights')]);
  const card = model(data, { filters: { results: [], time: 'all', search: 'run-2' } }).jobs[0];
  const ids = card.older.shown.map((r) => r.runId);
  assert.ok(ids.includes('run-2'), 'run-2 (position 18) is shown');
  assert.deepEqual(ids, ['run-2'], 'run-2 is exact: not run-20 (the head), not run-12');
  assert.equal(card.older.hidden, 0);
  // no search: unchanged, 7 older runs + the hint
  const plain = model(data, { open: { flights: true } }).jobs[0];
  assert.equal(plain.older.shown.length, 7);
  assert.equal(plain.older.hidden, 12);
});

test('20-run job, search `run-2`: the fold opens by itself even though the head (run-20) is not the match; run-2 only', () => {
  const data = payload(runsOf('flights', 20), [meta('flights')]);
  const card = model(data, { filters: { results: [], time: 'all', search: 'run-2' } }).jobs[0];
  assert.equal(card.older.open, true);
  assert.ok(card.older.shown.some((r) => r.runId === 'run-2'));
  assert.equal(card.older.shown.length, 1);
  assert.equal(card.older.hidden, 0);
  assert.equal(model(data, { filters: { results: [], time: 'all', search: 'run-2' }, open: { flights: false } }).jobs[0].older.open, false, 'a manual close still wins');
});

test('300-run job, search `run`: every run matches, still only 7 shown (the newest match is inside the 7), hint 292; a chip most runs match is capped the same', () => {
  const data = payload(runsOf('big', 300), [meta('big')]);
  const card = model(data, { filters: { results: [], time: 'all', search: 'run' } }).jobs[0];
  assert.equal(card.older.shown.length, 7);
  assert.equal(card.older.hidden, 292);
  const rows = Array.from({ length: 300 }, (_, i) => run('big', 300 - i, i === 0 ? {} : { glyph: '[✗]', word: 'failed', label: 'failed' }));
  const chip = model(payload(rows, [meta('big')]), { filters: { results: ['[✗]'], time: 'all', search: '' } }).jobs[0];
  assert.equal(chip.older.shown.length, 7);
  assert.equal(chip.older.hidden, 292);
});

test('the selected run AND a different match: both shown, nothing else (M11 am5 item 4)', () => {
  const data = payload(runsOf('flights', 20), [meta('flights')]);
  const card = model(data, { filters: { results: [], time: 'all', search: 'run-2' }, sel: { flow: 'flights', runId: 'run-5' } }).jobs[0];
  const ids = card.older.shown.map((r) => r.runId);
  assert.deepEqual(ids.slice().sort(), ['run-2', 'run-5']);
  assert.equal(card.older.hidden, 0);
});

test('no search: 7 older runs shown and the fold is not auto-opened', () => {
  const card = model(payload(runsOf('flights', 20), [meta('flights')])).jobs[0];
  assert.equal(card.older.shown.length, 7);
  assert.equal(card.older.hidden, 12);
  assert.equal(card.older.open, false);
});

test('the card lines clip on one line with an ellipsis, as the mockup CSS does (nowrap + ellipsis on line 2 and the name)', () => {
  assert.match(PAGE, /\.rl-l2\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(PAGE, /\.rl-nm\{[^}]*overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
  assert.doesNotMatch(PAGE, /\.rl-l1\{[^}]*flex-wrap/);
});

test('the quiet split is the server\'s: a job it marked quiet is under the fold (shut until opened), whatever its run dates say', () => {
  const rows = [...runsOf('recent', 2), ...runsOf('dusty', 2)];
  const data = payload(rows, [meta('recent'), meta('dusty', true)]);
  const m = model(data);
  assert.deepEqual(m.jobs.map((c) => c.flow), ['recent']);
  assert.deepEqual(m.quiet.map((c) => c.flow), ['dusty']);
  assert.equal(m.quietOpen, false);
  const shut = text(lib.rlJobsHtml(m));
  assert.match(shut, /▸ quiet jobs \(1\) · no run in 30 days/);
  assert.doesNotMatch(shut, /dusty/);
  const open = text(lib.rlJobsHtml(model(data, { open: { __quiet: true } })));
  assert.match(open, /▾ quiet jobs \(1\) · no run in 30 days/);
  assert.match(open, /dusty/);
  // selecting a run in a quiet job (a Needs-you jump) opens the fold so the card can be scrolled to
  assert.equal(model(data, { sel: { flow: 'dusty', runId: 'run-1' } }).quietOpen, true);
  // the order is the server's `jobs` order, not the rows' order
  const reordered = model(payload(rows, [meta('dusty'), meta('recent')]));
  assert.deepEqual(reordered.jobs.map((c) => c.flow), ['dusty', 'recent']);
});

test('the limits are the server\'s: 3 shown when the payload says 3, and the fold labels use its 30', () => {
  const data = { ...payload(runsOf('f', 9), [meta('f')]), limits: { quietDays: 45, olderRuns: 3 } };
  const groups = lib.groupRunsByFlow(data.rows);
  const m = lib.rlModel(data, groups, NONE, data.limits, { flow: null, runId: null }, { f: true });
  assert.equal(m.jobs[0].older.shown.length, 3);
  assert.equal(m.jobs[0].older.hidden, 5);
  assert.match(text(lib.rlJobsHtml(m)), /Jobs \(1\) · run in the last 45 days/);
});

test('card shapes: a job card is `[sign] job · k runs` / `word · why` of its newest run; a run card is `[sign] run-N · date · model` (M11 am5 item 6) / `word — why · $ · wall`', () => {
  const rows = [run('flights', 2, { glyph: '[✗]', word: 'failed', line: 'price over $450', label: 'failed (halt)', spend: '$0.0500', wallMs: 240_000, at: '2026-10-12T14:03:00.000Z' }), run('flights', 1)];
  const m = model(payload(rows, [meta('flights')]), { open: { flights: true } });
  const job = lib.rlJobCardHtml(m.jobs[0]);
  const lines = text(job).replace(/\s+/g, ' ');
  assert.match(lines, /^\[✗\]flights · 2 runs\s*failed · price over \$450/);
  assert.match(job, /<div class="rl-card[^"]*" id="rl-job-flights"/, 'the job card is not a button and is not clickable');
  assert.ok(lines.includes(`[✗]run-2 · ${short('2026-10-12T14:03:00.000Z')} · deepseek-flash`) && /deepseek-flash\s*failed — price over \$450 · \$0\.0500 · 4m00s/.test(lines), lines);
  assert.ok(lines.includes(`[✓]run-1 · ${short('2026-10-12T10:00:00.000Z')} · deepseek-flash`) && /deepseek-flash\s*passed — goal met · \$0\.0100 · 1m00s/.test(lines), lines);
});

test('a job with no run yet is one plain card with the server\'s sentence (never a made-up row)', () => {
  const rows = [{ flow: 'fresh', runId: null, glyph: null, label: null, spend: null, at: null, why: 'this flow has no runs yet' }];
  const m = model(payload(rows, [{ flow: 'fresh', quiet: false, activityMs: null }]));
  const t = text(lib.rlJobsHtml(m)).replace(/\s+/g, ' ');
  assert.match(t, /fresh\s*this flow has no runs yet/);
  assert.doesNotMatch(t, /0 runs|older runs/);
});

test('book text is escaped everywhere on a card', () => {
  const rows = [run('x', 1, { line: '<img src=x onerror=1>', word: 'failed', glyph: '[✗]', model: '<b>m</b>' })];
  const html = lib.rlJobsHtml(model(payload(rows, [meta('x')]), { open: { x: true } }));
  assert.doesNotMatch(html, /<img|<b>m/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
});

test('the old view is gone: no Workflows / History switch, no History list, no saved view key, no second copy of the run card', () => {
  assert.doesNotMatch(PAGE, /data-runs-view|runs-view-|id="history-list"|RUNS_VIEW_KEY|renderHistory|loadRunsViewMode|capChildRuns|buildRunRowEl|renderWorkflows/);
  assert.doesNotMatch(PAGE, /select a run from Workflows or History/);
  const panel = PAGE.slice(PAGE.indexOf('<section id="panel-runs"'), PAGE.indexOf('</section>', PAGE.indexOf('<section id="panel-runs"')));
  const order = ['id="rl-top"', 'data-testid="rl-filter-note">filters below act on Jobs and quiet jobs only', 'id="runs-filterbar-anchor"', 'id="wf-list"'].map((s) => panel.indexOf(s));
  assert.ok(order.every((i) => i !== -1), `panel-runs parts missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'top sections, the dashed note, the filter bar, then Jobs');
  assert.match(panel, /rl-dash/);
});

test('the limits live on the server only: the page has no literal 7 or 30 for them', () => {
  const src = [fnSrc('rlModel'), fnSrc('rlJobsHtml')].join('\n');
  assert.doesNotMatch(src, /\b(7|30)\b/);
  assert.match(src, /limits\.olderRuns/);
  assert.match(src, /limits\.quietDays/);
});

// ---- behaviour that needs a little DOM ----
function listHarness() {
  const els = {};
  const mk = (id) => (els[id] = { id, _h: '', writes: 0, get innerHTML() { return this._h; }, set innerHTML(v) { this.writes += 1; this._h = v; }, contains: () => false, querySelectorAll: () => [] });
  mk('rl-top'); mk('wf-list');
  const body = `
    var rlData = { rows: ROWS, jobs: JOBS, scheduled: [], limits: LIMITS };
    var rlOpen = {}; var rlLast = { top: null, jobs: null }; var currentFlow = null; var currentRunId = null;
    function tickSince(){}
    function currentRunsFilters(){ return NONE; }
    function withFocusPreserved(el, fn){ fn(); }
    ${['escapeXml', 'duration', 'glyphClass', 'dotClass', 'signHtml', 'readableDateTime', 'runSpendText', 'runWallText', 'runAtText', 'rlShortDate', 'groupRunsByFlow', 'matchesSearch', 'filterRuns', 'filterWorkflows', 'filtersActive', 'rlModel', 'rlSectHtml', 'rlJumpCardHtml', 'rlScheduledCardHtml', 'rlRunCardHtml', 'rlJobCardHtml', 'rlTopHtml', 'rlJobsHtml', 'paintRunsList'].map(fnSrc).join('\n')}
    return { paintRunsList, setSel: function(f, r){ currentFlow = f; currentRunId = r; } };`;
  const rows = runsOf('f', 3);
  const api = new Function('document', 'ROWS', 'JOBS', 'LIMITS', 'NONE', body)({ getElementById: (id) => els[id] }, rows, [meta('f')], LIMITS, NONE);
  return { els, api };
}

test('refresh: a repaint with nothing changed rewrites nothing (focus, selection and scroll inside the list survive a poll); a change rewrites', () => {
  const { els, api } = listHarness();
  api.paintRunsList();
  const w = [els['rl-top'].writes, els['wf-list'].writes];
  api.paintRunsList();
  assert.deepEqual([els['rl-top'].writes, els['wf-list'].writes], w, 'identical markup is not written again');
  api.setSel('f', 'run-3');
  api.paintRunsList();
  assert.equal(els['wf-list'].writes, w[1] + 1, 'a selection change repaints the jobs');
  assert.match(els['wf-list'].innerHTML, /rl-sel/);
});

test('a jump (Running now / Needs you click) selects that run, opens the Run tab, and scrolls its job card into view', () => {
  const calls = [];
  const card = { scrollIntoView: (o) => calls.push(['scroll', o.block]) };
  const doc = { getElementById: (id) => (id === 'tab-run' ? { click: () => calls.push(['tab-run']) } : id === 'rl-job-f' ? card : null) };
  const body = `${fnSrc('rlJump')}\nreturn rlJump;`;
  const jump = new Function('document', 'selectRun', 'paintRunsList', body)(doc, (...a) => calls.push(['select', a[0], a[1], a[2]]), () => calls.push(['paint']));
  jump('f', 'run-3');
  assert.deepEqual(calls, [['select', 'f', 'run-3', null], ['tab-run'], ['paint'], ['scroll', 'nearest']]);
  // a click on a run card inside a job still goes through the ONE run-click function (M4c amendment 1 (a))
  assert.match(PAGE, /openRunFromRuns\(/);
  assert.match(fnSrc('rlClick'), /openRunFromRuns\(/);
  assert.match(fnSrc('rlClick'), /rlJump\(/);
});
