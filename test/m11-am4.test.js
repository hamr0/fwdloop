// M11 amendment 4 (docs/wiki/the-module-ladder.md "M11 amendment 4", signed 2026-10-14), page side: the Inbox search reads the whole row (item 3) and
// the Inbox gets status chips accepted / redo / rerun / expired (item 4). Pure page functions over fake rows and the page's source, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
function fnSrc(name) {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
}
const NAMES = ['matchesSearch', 'inboxMatchesSearch', 'inboxFilterRows', 'filterBarHTML'];
const CHIP_WORDS = PAGE.match(/ {2}var INBOX_CHIP_WORD = [^\n]*/)?.[0] ?? '';
const lib = new Function(`${CHIP_WORDS}\n${NAMES.map(fnSrc).join('\n')}\nreturn {${NAMES.join(',')}};`)();
const NONE = { results: [], time: 'all', search: '' };
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-14T12:00:00Z');

const row = (runId, over = {}) => ({
  section: 3, flow: 'kyc', runId, askId: `a-${runId}`, status: 'accepted', question: null, reason: null, answeredAt: new Date(NOW - DAY).toISOString(), ...over,
});
const ids = (rows, f) => lib.inboxFilterRows(rows, { ...NONE, ...f }, NOW).map((r) => r.runId);

test('item 3: the Inbox search reads the whole row: job, run, status word, question, reason; case does not matter', () => {
  const rows = [
    row('run-1', { flow: 'Payroll' }),
    row('run-2', { status: 'redo' }),
    row('run-3', { question: 'Is the Vendor limit right?' }),
    row('run-4', { reason: 'Totals look WRONG' }),
    row('run-5', { status: 'expired' }),
  ];
  assert.deepEqual(ids(rows, { search: 'payroll' }), ['run-1'], 'job name');
  assert.deepEqual(ids(rows, { search: 'RUN-2' }), ['run-2'], 'run id');
  assert.deepEqual(ids(rows, { search: 'redo' }), ['run-2'], 'status word');
  assert.deepEqual(ids(rows, { search: 'vendor limit' }), ['run-3'], 'question text');
  assert.deepEqual(ids(rows, { search: 'wrong' }), ['run-4'], 'answer reason');
  assert.deepEqual(ids(rows, { search: 'expired' }), ['run-5']);
  assert.deepEqual(ids(rows, { search: 'zzz' }), []);
});

test('item 3: Runs search is unchanged: matchesSearch still reads the job name and run id only', () => {
  assert.equal(lib.matchesSearch('kyc', 'run-1', 'vendor'), false);
  assert.equal(lib.matchesSearch('kyc', 'run-1', 'RUN-1'), true);
  assert.doesNotMatch(fnSrc('matchesSearch'), /status|question|reason/);
});

test('item 3: a reran row is found by the chip word `rerun` and by the status `reran`', () => {
  const rows = [row('run-1', { status: 'reran' }), row('run-2', { status: 'accepted' })];
  assert.deepEqual(ids(rows, { search: 'rerun' }), ['run-1']);
  assert.deepEqual(ids(rows, { search: 'reran' }), ['run-1']);
  assert.equal(rows[0].status, 'reran', 'the row keeps its status word');
});

test('item 4: status chips pick one or more of accepted / redo / reran; none = all; section 3 only', () => {
  const rows = [
    { section: 1, flow: 'a', runId: 'run-w', waiting: true, askId: 'x1' },
    row('run-a', { status: 'accepted' }),
    row('run-r', { status: 'redo' }),
    row('run-n', { status: 'reran' }),
    row('run-e', { status: 'expired' }),
  ];
  assert.deepEqual(ids(rows, {}), ['run-w', 'run-a', 'run-r', 'run-n', 'run-e'], 'none picked = all');
  assert.deepEqual(ids(rows, { results: ['redo'] }), ['run-w', 'run-r'], 'one chip; section 1 never hidden');
  assert.deepEqual(ids(rows, { results: ['redo', 'expired'] }), ['run-w', 'run-r', 'run-e'], 'two chips = either');
  assert.deepEqual(ids(rows, { results: ['reran'], time: '7d' }), ['run-w', 'run-n'], 'chips and time both apply');
});

test('item 4: the Inbox filter bar has the four status chips beside 7d / 30d / all / clear, and no sign chips; Runs keeps its sign chips', () => {
  const inbox = lib.filterBarHTML('inbox', true);
  for (const [v, word] of [['accepted', 'accepted'], ['redo', 'redo'], ['reran', 'rerun'], ['expired', 'expired']]) {
    assert.match(inbox, new RegExp(`data-filter-group="result" data-filter-value="${v}"[^>]*>${word}</button>`), `chip ${word}`);
  }
  assert.doesNotMatch(inbox, /data-filter-value="\[/);
  assert.match(inbox, /data-filter-value="7d"/);
  assert.match(inbox, /inbox-filter-clear/);
  const runs = lib.filterBarHTML('runs');
  assert.match(runs, /data-filter-value="\[✓\]"/);
  assert.doesNotMatch(runs, /data-filter-value="(accepted|redo|reran|expired)"/);
});

test('item 4: chip test ids are unique per scope', () => {
  const inbox = lib.filterBarHTML('inbox', true);
  const tids = [...inbox.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(tids).size, tids.length);
});
