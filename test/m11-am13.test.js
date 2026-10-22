// M11 amendment 13 (signed 2026-10-16): when a search matches an older run, the fold opens and each matching run card is highlighted.
// The highlight is not the selected look.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fnSrc = (name) => cutFn(PAGE, name, '  ');
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
const cls = (html, id) => html.match(new RegExp(`<button class="([^"]*)"[^>]*data-testid="rl-run-${id}"`))?.[1] ?? null;

test('am13: a search that matches an older run opens the fold and highlights each matching run card, not the others', () => {
  const rows = runsOf('f', 5, (n) => ({ at: local(2026, 10, n <= 2 ? 11 : 12) }));
  const m = model(payload(rows, [meta('f')]), { filters: S('10/11') });
  assert.equal(m.jobs[0].older.open, true);
  const html = lib.rlJobsHtml(m);
  assert.match(cls(html, 'f-run-1'), /\brl-hit\b/);
  assert.match(cls(html, 'f-run-2'), /\brl-hit\b/);
  assert.equal(cls(html, 'f-run-3'), null, 'a non-matching older run is not shown while searching');
  assert.doesNotMatch(cls(html, 'f-run-5'), /rl-hit/);
});

test('am13: no search, or a search whose matches are not older runs, highlights nothing', () => {
  const rows = runsOf('f', 4);
  assert.doesNotMatch(lib.rlJobsHtml(model(payload(rows, [meta('f')]), { open: { f: true } })), /rl-hit/);
  const html = lib.rlJobsHtml(model(payload(rows, [meta('f')]), { filters: S('run-4'), open: { f: true } }));
  assert.doesNotMatch(html, /rl-hit/);
});

test('am13: the highlight is not the selected look: a matching selected run keeps the selected look alone, and the style differs', () => {
  const rows = runsOf('f', 3);
  const html = lib.rlJobsHtml(model(payload(rows, [meta('f')]), { filters: S('f'), sel: { flow: 'f', runId: 'run-2' } }));
  assert.match(cls(html, 'f-run-2'), /\brl-sel\b/);
  assert.doesNotMatch(cls(html, 'f-run-2'), /rl-hit/);
  assert.match(cls(html, 'f-run-1'), /\brl-hit\b/);
  assert.doesNotMatch(cls(html, 'f-run-1'), /rl-sel/);
  const css = PAGE.match(/\.rl-card\.rl-hit\{[^}]*\}/)?.[0] ?? '';
  assert.match(css, /var\(--accent\)/, 'the theme accent token');
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}|rgb/i, 'no new colour');
  assert.doesNotMatch(css, /background/, 'the selected look is the strong fill; the highlight has none');
});
