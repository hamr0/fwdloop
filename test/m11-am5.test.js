// M11 amendment 5 (docs/wiki/the-module-ladder.md "M11 amendment 5", signed 2026-10-14): the Runs search by words, a run word is exact, a day word,
// matches-only older fold (at most 7 + the selected run), the hints, and run card line 1. Pure page functions over fake runs, $0.
// The Inbox search has its own filter and is not touched here.
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
  'rlModel', 'rlSectHtml', 'rlJumpCardHtml', 'rlScheduledCardHtml', 'rlRunCardHtml', 'rlJobCardHtml', 'rlTopHtml', 'rlJobsHtml', 'filterBarHTML',
];
const CHIP_WORDS = PAGE.match(/ {2}var INBOX_CHIP_WORD = [^\n]*/)?.[0] ?? '';
const lib = new Function(`${CHIP_WORDS}\n${NAMES.map(fnSrc).join('\n')}\nreturn {${NAMES.join(',')}};`)();
const LIMITS = { quietDays: 30, olderRuns: 7 };
const NONE = { results: [], time: 'all', search: '' };
const S = (search) => ({ results: [], time: 'all', search });
// a LOCAL wall-clock time as an ISO stamp: the day a human sees is the local day
const local = (y, mo, d, h = 13, mi = 46) => new Date(y, mo - 1, d, h, mi).toISOString();

const run = (flow, n, over = {}) => ({
  flow, runId: `run-${n}`, glyph: '[✓]', word: 'passed', line: null, label: 'passed', pulse: false, spend: '$0.0100', spendWhy: null,
  wallMs: 60_000, at: local(2026, 10, 12), askedAt: null, startedAt: null, model: 'deepseek-flash', needs: null, live: false, ...over,
});
const runsOf = (flow, k, over = {}) => Array.from({ length: k }, (_, i) => run(flow, k - i, typeof over === 'function' ? over(k - i) : over));
const meta = (flow) => ({ flow, quiet: false, activityMs: 1 });
const payload = (rows, jobs) => ({ rows, jobs, scheduled: [], limits: LIMITS });
function model(data, { filters = NONE, sel = { flow: null, runId: null }, open = {} } = {}) {
  const groups = lib.filterWorkflows(lib.groupRunsByFlow(data.rows), filters, Date.now());
  return lib.rlModel(data, groups, filters, LIMITS, sel, open);
}
const hit = (rows, search) => lib.filterRuns(rows, S(search), Date.now()).map((r) => `${r.flow}/${r.runId}`);
const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&middot;/g, '·');

test('items 1-2: a run word is exact: run-2 never matches run-20 or run-230; case does not matter', () => {
  const rows = [2, 20, 230].map((n) => run('aging', n));
  assert.deepEqual(hit(rows, 'run-2'), ['aging/run-2']);
  assert.deepEqual(hit(rows, 'RUN-20'), ['aging/run-20']);
  assert.deepEqual(hit(rows, 'run-230'), ['aging/run-230']);
  assert.deepEqual(hit(rows, 'run-3'), []);
});

test('item 1: words split at spaces and every word must match: `aging run-23` finds run-23 of aging-live-4 only', () => {
  const rows = [run('aging-live-4', 23), run('aging-live-4', 2), run('kyc', 23), run('aging-live-4', 230)];
  assert.deepEqual(hit(rows, 'aging run-23'), ['aging-live-4/run-23']);
  assert.deepEqual(hit(rows, 'aging  run-23 '), ['aging-live-4/run-23'], 'extra spaces do nothing');
  assert.deepEqual(hit(rows, 'kyc run-23'), ['kyc/run-23']);
  assert.deepEqual(hit(rows, 'kyc run-2'), [], 'every word must match');
  assert.deepEqual(hit(rows, 'live'), ['aging-live-4/run-23', 'aging-live-4/run-2', 'aging-live-4/run-230'], 'a plain word is still a substring of the job name');
  assert.deepEqual(hit(rows, '23'), ['aging-live-4/run-23', 'kyc/run-23', 'aging-live-4/run-230'], 'a plain word is still a substring of the run id');
});

test('item 3: MM/DD matches the LOCAL day the card shows, in any year; a run from another day does not match', () => {
  const rows = [
    run('a', 1, { at: local(2026, 10, 12, 0, 5) }),
    run('a', 2, { at: local(2026, 10, 12, 23, 55) }),
    run('a', 3, { at: local(2026, 10, 13, 0, 5) }),
    run('a', 4, { at: local(2026, 10, 11, 23, 55) }),
    run('a', 5, { at: local(2025, 10, 12, 9, 0) }),
  ];
  assert.deepEqual(hit(rows, '10/12'), ['a/run-1', 'a/run-2', 'a/run-5']);
  assert.deepEqual(hit(rows, '10/13'), ['a/run-3']);
  assert.deepEqual(hit(rows, '10/14'), []);
  // the day word and the card's own date agree: whatever rlShortDate prints for a run, that MM/DD finds the run
  for (const r of rows) assert.ok(hit([r], lib.rlShortDate(r.at).slice(0, 5)).includes(`a/${r.runId}`), `${r.runId} found by the date on its card`);
});

test('item 3: YYYY-MM-DD matches that local day of that year only', () => {
  const rows = [run('a', 1, { at: local(2026, 10, 12) }), run('a', 2, { at: local(2025, 10, 12) }), run('a', 3, { at: local(2026, 10, 13) })];
  assert.deepEqual(hit(rows, '2026-10-12'), ['a/run-1']);
  assert.deepEqual(hit(rows, '2025-10-12'), ['a/run-2']);
});

test('item 3: the day is the time the card shows: at, else askedAt, else startedAt', () => {
  const rows = [
    run('a', 1, { at: null, askedAt: local(2026, 10, 12), startedAt: local(2026, 9, 1) }),
    run('a', 2, { at: null, askedAt: null, startedAt: local(2026, 10, 12) }),
    run('a', 3, { at: null, askedAt: null, startedAt: null }),
  ];
  assert.deepEqual(hit(rows, '10/12'), ['a/run-1', 'a/run-2']);
  assert.deepEqual(hit(rows, '09/01'), [], 'startedAt is not read when askedAt is the card time');
});

test('item 3: a part date matches nothing (10/1 is not 10/12 or 10/01); a non-day shape is a plain word (13/45, 2026-13-45)', () => {
  const rows = [run('a', 1, { at: local(2026, 10, 12) }), run('a', 2, { at: local(2026, 10, 1) }), run('10-1x', 3, { at: local(2026, 10, 12) })];
  assert.deepEqual(hit(rows, '10/1'), []);
  assert.deepEqual(hit(rows, '10/'), []);
  assert.deepEqual(hit(rows, '13/45'), []);
  assert.deepEqual(hit(rows, '2026-13-45'), []);
  assert.deepEqual(hit(rows, '10/01'), ['a/run-2']);
  assert.deepEqual(hit(rows, '10-1'), ['10-1x/run-3'], 'not a day shape: a substring of the job name, as today');
});

test('items 1-3 together: job + run word + day word, all must match', () => {
  const rows = [run('aging', 23, { at: local(2026, 10, 12) }), run('aging', 24, { at: local(2026, 10, 13) }), run('kyc', 23, { at: local(2026, 10, 12) })];
  assert.deepEqual(hit(rows, 'aging 10/12'), ['aging/run-23']);
  assert.deepEqual(hit(rows, 'aging run-23 10/12'), ['aging/run-23']);
  assert.deepEqual(hit(rows, 'aging run-23 10/13'), []);
});

test('item 4: while searching, the older fold shows only matching runs, newest first, at most 7, plus the selected run', () => {
  const day = (n) => (n % 2 === 0 ? { at: local(2026, 10, 12) } : { at: local(2026, 10, 13) });
  const data = payload(runsOf('flights', 40, day), [meta('flights')]);
  const card = model(data, { filters: S('10/12') }).jobs[0];
  assert.equal(card.older.open, true);
  assert.deepEqual(card.older.shown.map((r) => r.runId), ['run-38', 'run-36', 'run-34', 'run-32', 'run-30', 'run-28', 'run-26'], 'matches only, newest first, 7');
  assert.equal(card.older.hidden, 12, 'older matches are run-38 down to run-2: 19; 7 shown');
  // a selected run that does NOT match is still shown
  const sel = model(data, { filters: S('10/12'), sel: { flow: 'flights', runId: 'run-5' } }).jobs[0];
  assert.equal(sel.older.shown.length, 8);
  assert.ok(sel.older.shown.some((r) => r.runId === 'run-5'));
  assert.ok(sel.older.shown.every((r) => r.runId === 'run-5' || Number(r.runId.slice(4)) % 2 === 0), 'no other non-matching run');
  assert.equal(sel.older.hidden, 12, 'the selected run is shown, so it is not counted as hidden');
});

test('item 4: a search that matches no older run shows no older run (the head matches)', () => {
  const data = payload(runsOf('flights', 12), [meta('flights')]);
  const card = model(data, { filters: S('run-12') }).jobs[0];
  assert.deepEqual(card.older.shown, []);
  assert.equal(card.older.hidden, 0);
});

test('item 4: a chip filter counts as a search: only matching older runs', () => {
  const rows = runsOf('f', 20, (n) => (n % 5 === 0 ? { glyph: '[✗]', word: 'failed', label: 'failed' } : {}));
  const card = model(payload(rows, [meta('f')]), { filters: { results: ['[✗]'], time: 'all', search: '' } }).jobs[0];
  assert.deepEqual(card.older.shown.map((r) => r.runId), ['run-15', 'run-10', 'run-5']);
});

test('item 5: no search: the line after the 7 reads `(and k older · <oldest> to <newest> of those k · search above)` with the dates of those k', () => {
  const rows = runsOf('f', 12, (n) => ({ at: local(2026, 9, n) })); // run-n on 09/n
  const html = lib.rlJobsHtml(model(payload(rows, [meta('f')]), { open: { f: true } }));
  // 11 older, 7 shown (run-11..run-5); the k = 4 hidden are run-4..run-1: 09/04 down to 09/01
  assert.match(text(html), /\(and 4 older · 09\/01 to 09\/04 of those 4 · search above\)/);
  assert.doesNotMatch(html, /use search/);
});

test('item 5: while searching: `(and k more matches · add a day or a run)`, k = matches not shown', () => {
  const rows = runsOf('f', 30);
  const html = text(lib.rlJobsHtml(model(payload(rows, [meta('f')]), { filters: S('f') })));
  assert.match(html, /\(and 22 more matches · add a day or a run\)/, '29 older matches, 7 shown');
  assert.doesNotMatch(html, /search above|older ·/);
  const none = text(lib.rlJobsHtml(model(payload(runsOf('f', 3), [meta('f')]), { filters: S('f') })));
  assert.doesNotMatch(none, /more matches/, 'nothing hidden, no line');
});

test('item 5: the Runs search box reads `job, run-23, or a day 10/12`; the Inbox hint is untouched', () => {
  assert.match(lib.filterBarHTML('runs'), /placeholder="job, run-23, or a day 10\/12"/);
  assert.match(lib.filterBarHTML('inbox', true), /placeholder="search job, run, status, question or reason…"/);
});

test('item 6: run card line 1 is `run-2 · 10/12 13:46 · deepseek-flash`, the date and model not in the small raised .rl-faint span', () => {
  const r = run('aging', 2, { at: local(2026, 10, 12, 13, 46) });
  const l1 = (x) => lib.rlRunCardHtml(x, false).match(/<span class="rl-l1">([\s\S]*?)<\/span><span class="rl-l2">/)[1];
  assert.equal(text(l1(r)), 'run-2 · 10/12 13:46 · deepseek-flash');
  assert.doesNotMatch(l1(r), /rl-faint/, 'not the smaller, margined span');
  assert.doesNotMatch(PAGE, /\.rl-rest\{[^}]*(font-size|margin)/, 'the rest of line 1 sets no size or margin of its own');
  assert.equal(text(l1(run('aging', 2, { at: null, askedAt: null, startedAt: null, atWhy: 'no stamp', model: null }))), 'run-2 · no stamp');
});

test('M11 am6: Running now and Scheduled line 1: the time, cost and next-run text sit in the same-size .rl-rest span after ` · `, not in .rl-faint', () => {
  const l1 = (html) => html.match(/<span class="rl-l1">([\s\S]*?)<\/span><span class="rl-l2">/)[1];
  const live = lib.rlJumpCardHtml(run('aging-live-4', 7, { live: true, glyph: '[▶]', startedAt: local(2026, 10, 12) }), false);
  assert.doesNotMatch(l1(live), /rl-faint/);
  assert.match(l1(live), /<span class="rl-rest">&middot; /);
  assert.equal(text(l1(live)).replace(/\s+/g, ' ').replace(/^.*?aging-live-4 run-7/, 'aging-live-4 run-7').replace(/ · .*? · /, ' · X · '), 'aging-live-4 run-7 · X · $0.0100');
  const sch = lib.rlScheduledCardHtml({ flow: 'aging-live-4', at: 'Mon 09:00', in: 'in 2d', words: 'weekly', runId: 'run-7' });
  assert.doesNotMatch(l1(sch), /rl-faint/);
  assert.equal(text(l1(sch)), 'aging-live-4 · Mon 09:00');
  // no next-run time (a file trigger): nothing is made up
  assert.equal(text(l1(lib.rlScheduledCardHtml({ flow: 'k', at: null, in: null, words: 'file', runId: null }))), 'k');
  // Needs you keeps its pill
  assert.match(lib.rlJumpCardHtml(run('x', 1, { needs: 'Accept' }), true), /rl-pill-need/);
});
