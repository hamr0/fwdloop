// borrowed-from: bareloop tests/learn-render.test.js@v0.46.0 (8b3d815)
// Cross-run learnings, part 4: the one render the PLANNER reads (ITEM33-BUILD.md rev 2, section 7, RULING 7).
// Order: this job, then this place, then all-jobs; highest count first inside each level; 2,000 characters; a hint is
// added whole or not at all; one function, byte-for-byte. Rows come from real runs folded by the real ledger code;
// where a row is edited (a level, a place, a run id list) the test says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLedger, countLedger, holdPending, renderHints, readableRows, changedLines, saidLine, HINT_HEADER, HINT_CHARS_MAX, DECAY_DAYS,
} from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';

const DAY = 86_400_000;
const WF = 'aurora-u-spawner-types';
const AURORA = ['ms2c0ls7', 'ms7flkok', 'mszi97jd', 'ms2ddxjc', 'mszcfaof'];
const built = AURORA.map((id) => cardsOf(id));
const lastAt = built.map((b) => b.cards[0].at).sort().at(-1) ?? '';
const NOW = new Date(new Date(lastAt).getTime() + DAY);
const ctx = { workflow: WF, place: '/p/aurora', specHash: 'h1', now: NOW };

/** the real ledger of the five aurora runs: a typecheck lesson seen 5 times, a no-suppressions lesson seen 2 times */
function auroraLedger() {
  let L = emptyLedger();
  AURORA.forEach((id, i) => { L = countLedger(L, { runid: id, cards: built[i].cards, workflow: WF, place: '/p/aurora', specHash: 'h1', trust: 'deterministic', now: NOW }); });
  return L;
}
/** @param {any} L @param {string} check */
const rowOf = (L, check) => L.rows.find((/** @type {any} */ r) => r.sample.check === check);
/** an edited copy of a real row (the edit is the point of the test that calls this) */
const rowLike = (/** @type {any} */ r, /** @type {any} */ over) => ({ ...r, ...over, sample: { ...r.sample, ...(over.sample ?? {}) } });
const withRows = (/** @type {any} */ L, /** @type {any[]} */ rows) => ({ ...L, rows });
/**
 * Rows that READ at `level` (the level is derived from the siblings, never stored): the row first, then, for `place`
 * and `user`, two hidden sibling rows of the same lesson (no run id: never shown, but they count for climbing) in other
 * workflows on the same place / on other places. Every id gets its own check, so lessons never merge across ids.
 */
const atLevel = (/** @type {any} */ tc, /** @type {string} */ id, /** @type {'workflow'|'place'|'user'} */ level, /** @type {number} */ count, /** @type {any} */ extra = {}) => {
  const row = rowLike(tc, { id, level: 'workflow', count, workflow: level === 'workflow' ? WF : 'elsewhere', place: '/p/aurora', ...extra, sample: { check: `chk-${id}`, ...(extra.sample ?? {}) } });
  const sib = (/** @type {number} */ n) => rowLike(row, { id: `${id}-sib${n}`, runIds: [], workflow: `${id}-wf${n}`, place: level === 'place' ? row.place : `/q/${id}/${n}`, sample: { job: `${id}-wf${n}` } });
  return level === 'workflow' ? [row] : [row, sib(1), sib(2)];
};

test('the block for a real ledger: header, then the lesson seen most often first, each hint whole', () => {
  const L = auroraLedger();
  const r = renderHints(L, ctx);
  const lines = r.text.split('\n');
  assert.equal(lines[0], HINT_HEADER);
  assert.match(lines[1], /^1\. \[this job, seen 5 times\] check "typecheck"/);
  assert.ok(r.text.includes('[this job, seen 2 times] check "no-suppressions"'));
  assert.ok(r.text.indexOf('seen 5 times') < r.text.indexOf('seen 2 times'));
  assert.deepEqual(r.ids, [rowOf(L, 'typecheck').id, rowOf(L, 'no-suppressions').id]);
  assert.match(r.text, /\n   It said: /);
  assert.match(r.text, /\n   Fix touched: .*timeout_policy\.py/);
  assert.ok(r.text.length <= HINT_CHARS_MAX);
  // pure + byte-for-byte: the same ledger renders the same bytes
  assert.equal(renderHints(L, ctx).text, r.text);
  process.stdout.write(`\n--- SAMPLE HINT BLOCK (real aurora ledger) ---\n${r.text}\n--- ${r.text.length} chars ---\n`);
});

test('a NEVER FIXED lesson reads "got stuck here, never fixed"', () => {
  const [stuck] = cardsOf('mshcpdg4').cards;
  const L = countLedger(emptyLedger(), { runid: 'mshcpdg4', cards: [stuck], workflow: 'bareagent-u-types', place: null, specHash: null, trust: 'deterministic', now: new Date(stuck.at) });
  const r = renderHints(L, { workflow: 'bareagent-u-types', place: null, specHash: null, now: new Date(stuck.at) });
  assert.match(r.text, /\[this job, seen 1 time\] check "typecheck" failed on TS2322 .*; got stuck here, never fixed\./);
  assert.ok(!r.text.includes('Fix touched'));
});

test('MUST-FAIL 8: hints are ordered by (level, count): this job, then this place, then all jobs, highest count first', () => {
  const L = auroraLedger();
  const tc = rowOf(L, 'typecheck');
  const mk = (/** @type {string} */ id, /** @type {'workflow'|'place'|'user'} */ level, /** @type {number} */ count, extra = {}) => atLevel(tc, id, level, count, { sample: { said: [], fixTouched: [] }, ...extra });
  const rows = [mk('u7', 'user', 7), mk('p3', 'place', 3), mk('w2', 'workflow', 2), mk('p9', 'place', 9), mk('w5', 'workflow', 5)].flat();
  assert.deepEqual(renderHints(withRows(L, rows), ctx).ids, ['w5', 'w2', 'p9', 'p3', 'u7']);
  assert.deepEqual(readableRows(withRows(L, rows), ctx).map((r) => r.id), ['w5', 'w2', 'p9', 'p3', 'u7']);
  // ties: most recent lastSeen first, then id — the order is total and stable
  const tied = [mk('b', 'workflow', 4, { lastSeen: '2026-07-01T00:00:00Z' }), mk('a', 'workflow', 4, { lastSeen: '2026-07-01T00:00:00Z' }), mk('c', 'workflow', 4, { lastSeen: lastAt })].flat();
  assert.deepEqual(renderHints(withRows(L, tied), ctx).ids, ['c', 'a', 'b']);
  assert.deepEqual(renderHints(withRows(L, [...tied].reverse()), ctx).ids, ['c', 'a', 'b']);
});

test('MUST-FAIL 5: the block is never longer than 2,000 characters, and a hint is added whole or not at all', () => {
  const L = auroraLedger();
  const tc = rowOf(L, 'typecheck');
  const many = Array.from({ length: 40 }, (_, i) => rowLike(tc, { id: `row-${String(i).padStart(2, '0')}`, count: 100 - i }));
  const r = renderHints(withRows(L, many), ctx);
  assert.ok(r.text.length <= HINT_CHARS_MAX, `${r.text.length} chars`);
  assert.ok(r.ids.length >= 2 && r.ids.length < 40, 'some fit, not all');
  assert.deepEqual(r.ids, many.slice(0, r.ids.length).map((x) => x.id), 'the highest counts won the room');
  // the text is exactly the header plus whole hints: no hint was cut
  const hintBlocks = r.text.slice(HINT_HEADER.length + 1).split(/\n(?=\d+\. \[)/);
  assert.equal(hintBlocks.length, r.ids.length);
  assert.ok(hintBlocks.every((h) => /^\d+\. \[this job, seen \d+ times\] check ".*\.$|\n   Fix touched: .*$/s.test(h)));
  // one more hint would not have fit
  const next = renderHints(withRows(L, many.slice(0, r.ids.length + 1)), ctx);
  assert.equal(next.ids.length, r.ids.length);
  // a limit that nothing fits under renders nothing (empty text, not a lone header)
  assert.equal(HINT_CHARS_MAX, 2000);
});

test('MUST-FAIL 6: a row with no run id is never injected', () => {
  const L = auroraLedger();
  const tc = rowOf(L, 'typecheck');
  const rows = [rowLike(tc, { id: 'orphan', runIds: [], count: 99 }), rowLike(tc, { id: 'real', count: 1 })];
  assert.deepEqual(renderHints(withRows(L, rows), ctx).ids, ['real']);
  assert.equal(renderHints(withRows(L, [rows[0]]), ctx).text, '');
});

test('MUST-FAIL 7: a place row reaches its own place only; an all-jobs row reaches every place', () => {
  const L = auroraLedger();
  const tc = rowOf(L, 'typecheck');
  const rows = [...atLevel(tc, 'here', 'place', 1, { place: '/p/aurora' }), ...atLevel(tc, 'there', 'place', 1, { place: '/p/elsewhere' }), ...atLevel(tc, 'everyone', 'user', 1, { place: '/p/elsewhere' })];
  assert.deepEqual(renderHints(withRows(L, rows), ctx).ids, ['here', 'everyone']);
  assert.deepEqual(renderHints(withRows(L, rows), { ...ctx, place: '/p/elsewhere' }).ids, ['there', 'everyone']);
  assert.deepEqual(renderHints(withRows(L, rows), { ...ctx, place: null }).ids, ['everyone'], 'a job with no place gets no place rows');
});

test('MUST-FAIL 4 (R2, replaces the check-wide item): an all-jobs hint never appears before a this-job or this-place hint, whatever its count', () => {
  const L = auroraLedger();
  const tc = rowOf(L, 'typecheck');
  const mk = (/** @type {string} */ id, /** @type {'workflow'|'place'|'user'} */ level, /** @type {number} */ count, extra = {}) => atLevel(tc, id, level, count, extra);
  const rows = [mk('all-99', 'user', 99), mk('all-50', 'user', 50), mk('place-1', 'place', 1), mk('job-1', 'workflow', 1)].flat();
  const ids = renderHints(withRows(L, rows), ctx).ids;
  assert.deepEqual(ids, ['job-1', 'place-1', 'all-99', 'all-50']);
  const lastLocal = Math.max(ids.indexOf('job-1'), ids.indexOf('place-1'));
  const firstAll = Math.min(...ids.filter((i) => i.startsWith('all-')).map((i) => ids.indexOf(i)));
  assert.ok(lastLocal < firstAll, `order was ${ids.join(',')}`);
  // all-jobs hints only use leftover room: when the room is short, they are the ones left out
  const fat = (/** @type {string} */ id, /** @type {'workflow'|'place'|'user'} */ level, /** @type {number} */ count) => mk(id, level, count, { sample: { said: ['x'.repeat(150)], fixTouched: [] } });
  const crowd = [...Array.from({ length: 6 }, (_, i) => fat(`job-${i}`, 'workflow', 1)), ...Array.from({ length: 6 }, (_, i) => fat(`all-${i}`, 'user', 90))].flat();
  const r = renderHints(withRows(L, crowd), ctx);
  assert.ok(r.ids.length < 12, 'the cap bit');
  assert.ok(r.ids.every((i, k) => k < 6 ? i.startsWith('job-') : i.startsWith('all-')), `order was ${r.ids.join(',')}`);
  assert.equal(r.ids.filter((i) => i.startsWith('job-')).length, 6, 'every this-job hint was read before any all-jobs hint took room');
});

test('R2: a lesson seen across jobs climbs to the place and is READ there (no check-wide set-aside), after the reader\'s own job', () => {
  const tc = built[0].cards.find((c) => c.check === 'typecheck');
  assert.ok(tc);
  let L = emptyLedger();
  for (const wf of ['job-a', 'job-b', 'job-c']) L = countLedger(L, { runid: `r-${wf}`, cards: [{ ...tc, job: wf }], workflow: wf, place: '/p/shared', specHash: null, trust: 'deterministic', now: NOW });
  assert.deepEqual(L.rows.map((r) => r.level), ['workflow', 'workflow', 'workflow'], 'the file stores no climbed level');
  assert.deepEqual(readableRows(L, { workflow: 'job-d', place: '/p/shared', specHash: null, now: NOW }).map((r) => r.level), ['place', 'place', 'place']);
  const r = renderHints(L, { workflow: 'job-d', place: '/p/shared', specHash: null, now: NOW });
  assert.equal(r.ids.length, 3, 'a fourth job on that place reads the climbed lessons');
  assert.match(r.text, /\[this place, seen 1 time\]/);
});

test('what is not readable: rows of another job or signed hash, rows decayed by the clock, and held rubric cards', () => {
  const L = auroraLedger();
  const tc = rowOf(L, 'typecheck');
  const rows = [
    rowLike(tc, { id: 'old-flag', status: 'expired', expiredBy: 'age' }), // legacy stored fields are ignored: this one is fresh, so it IS read
    rowLike(tc, { id: 'other-job', workflow: 'other-job' }),
    rowLike(tc, { id: 'other-hash', specHash: 'h-old' }),
    rowLike(tc, { id: 'stale', lastSeen: new Date(NOW.getTime() - (DECAY_DAYS + 1) * DAY).toISOString() }),
    rowLike(tc, { id: 'fresh' }),
  ];
  assert.deepEqual(renderHints(withRows(L, rows), ctx).ids.sort(), ['fresh', 'old-flag']);
  // a held rubric run is in `pending`, never in the block
  const held = holdPending(L, { runid: 'mvh72jo0', cards: cardsOf('mvh72jo0').cards, workflow: WF, place: '/p/aurora', specHash: 'h1', at: lastAt }, NOW);
  assert.equal(held.pending.length, 1);
  assert.ok(!renderHints(held, ctx).text.includes('line-1-three-flights'));
  assert.equal(renderHints(held, ctx).text, renderHints(L, ctx).text);
});

test('the byte check: what the spine recorded must equal a fresh render from the ledger as it stood', () => {
  const L = auroraLedger();
  const recorded = renderHints(L, ctx).text;
  assert.equal(recorded, renderHints(L, ctx).text);
  assert.notEqual(`${recorded} `, renderHints(L, ctx).text, 'one extra byte');
  assert.notEqual(recorded.replace('seen 5', 'seen 6'), renderHints(L, ctx).text, 'one changed byte');
  const later = countLedger(L, { runid: 'newrun', cards: built[0].cards, workflow: WF, place: '/p/aurora', specHash: 'h1', trust: 'deterministic', now: NOW });
  assert.notEqual(recorded, renderHints(later, ctx).text, 'the ledger moved on: the old record no longer matches');
});

test('an empty ledger renders nothing (no lone header)', () => {
  assert.deepEqual(renderHints(emptyLedger(), ctx), { text: '', ids: [] });
});

// ── R3: a FIXED hint shows the first 3 +/- lines of "What changed" ───────────────────────────────
const pulse = cardsOf('mvk2e4uy').cards[0];
const pulseCtx = { workflow: pulse.job, place: null, specHash: null, now: new Date(new Date(pulse.at).getTime() + DAY) };
const pulseLedger = (/** @type {any} */ card) => countLedger(emptyLedger(), { runid: card.runid, cards: [card], workflow: pulse.job, place: null, specHash: null, trust: 'deterministic', now: pulseCtx.now });

test('R3: a FIXED hint shows the first 3 changed lines, each indented to align, then "(+N more)" - real run mvk2e4uy', () => {
  assert.equal(pulse.kind, 'FIXED');
  assert.ok(pulse.whatChanged, 'the real card carries the passing try\'s diff');
  const all = changedLines(pulse.whatChanged);
  assert.equal(all.length, 31);
  const r = renderHints(pulseLedger(pulse), pulseCtx);
  const pad = ' '.repeat(17);
  assert.ok(r.text.endsWith([
    '   What changed: -const e = /** @type {NodeJS.ErrnoException|undefined} */ (err);',
    `${pad}-const exitCode = typeof e?.code === 'number' ? e.code : 1;`,
    `${pad}+// execFile's error is an ExecFileException: \`code\` is a string|number exit code`,
    `${pad}(+28 more)`,
  ].join('\n')), r.text);
  assert.ok(!/diff --git|^index |^@@|^---|^\+\+\+/m.test(r.text), 'no diff headers, hunk marks or file lines');
  process.stdout.write(`\n--- R3 HINT (real mvk2e4uy) ---\n${r.text}\n--- ${r.text.length} chars ---\n`);
});

test('R3: headers, @@ and context lines are never shown; a removed line that starts with -- is content once a hunk is open; each line is cut at 150', () => {
  const diff = ['diff --git a/x.js b/x.js', 'index 1..2 100644', '--- a/x.js', '+++ b/x.js', '@@ -1,3 +1,3 @@', ' context line', '--- a SQL comment removed', `+${'y'.repeat(300)}`, '\\ No newline at end of file', '+tail'].join('\n');
  const wc = { files: [{ path: 'x.js', diff, truncated: false }], binary: [], truncated: false };
  const got = changedLines(wc);
  assert.deepEqual(got, ['--- a SQL comment removed', `+${'y'.repeat(300)}`, '+tail']);
  const r = renderHints(pulseLedger({ ...pulse, whatChanged: wc }), pulseCtx);
  const shown = r.text.split('\n').filter((l) => l.includes('y'.repeat(20)));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].trim().length, 150, 'the long line is cut at 150 characters');
  assert.ok(shown[0].endsWith('…'));
  assert.ok(!r.text.includes('more)'), 'exactly 3 lines: no more-line');
});

test('R3: NEVER FIXED hints never show What changed, even when the card carries a diff', () => {
  const stuck = { ...pulse, kind: 'NEVER_FIXED' };
  assert.ok(stuck.whatChanged);
  const r = renderHints(pulseLedger(stuck), pulseCtx);
  assert.ok(r.text.includes('got stuck here'));
  assert.ok(!r.text.includes('What changed'));
});

test('R3: whole hint or nothing - a hint whose What changed block no longer fits under 2,000 characters is left out entirely', () => {
  const rows = Array.from({ length: 12 }, (_, i) => rowLike(pulseLedger(pulse).rows[0], { id: `p-${String(i).padStart(2, '0')}`, count: 50 - i }));
  const L = withRows(emptyLedger(), rows);
  const r = renderHints(L, pulseCtx);
  assert.ok(r.text.length <= HINT_CHARS_MAX, `${r.text.length}`);
  assert.ok(r.ids.length > 1 && r.ids.length < 12);
  // every hint that made it is whole: it ends with its "(+28 more)" line
  const blocks = r.text.slice(HINT_HEADER.length + 1).split(/\n(?=\d+\. \[)/);
  assert.ok(blocks.every((b) => b.endsWith('(+28 more)')));
});

// ── R5: tidy the hint - the first real flagged line, and shorter paths ───────────────────────────
test('R5: "It said" shows the flagged code line, not the summary wrapper line (real aurora no-suppressions card)', () => {
  const L = auroraLedger();
  const ns = rowOf(L, 'no-suppressions');
  assert.match(ns.sample.said[0], /^SPAWNER red: \d+ suppression\(s\) added/, 'the stored quote starts with the summary line');
  const hint = renderHints(L, ctx).text.split(/\n(?=\d+\. \[)/).find((h) => h.includes('no-suppressions')) ?? '';
  // B1-ADAPTED (F79): any non-empty line is flagged text, so the first line (the summary) is what it said
  assert.match(hint, /\n   It said: SPAWNER red: 3 suppression\(s\) added — suppressing an error is not typing it\n/);
  // the red side: with the summary line only (no flagged line anywhere) it falls back to the first line
  assert.equal(saidLine(['SPAWNER red: 3 suppression(s) added — nothing else']), 'SPAWNER red: 3 suppression(s) added — nothing else');
  assert.equal(saidLine([]), undefined);
  // a real tree-changed card has no flagged line at all: the summary stays
  const [tree] = cardsOf('mv3sconb').cards.filter((c) => c.check === 'tree-changed');
  assert.equal(saidLine(tree.said), tree.said[0]);
  // a stripped `close: [id] file:line: text` line (a real card) counts as flagged
  const cast = cardsOf('mv3sconb').cards.find((c) => c.check === 'no-suppressions');
  assert.ok(cast && /^\[cast\] src\/fallback\.js:20:/.test(cast.said[0]));
  // B1-ADAPTED (F79): the plain wrapper first line is flagged text now, so it wins over the `close:` line
  assert.equal(saidLine(['no-suppressions red: 1 added', ...cast.said]), 'no-suppressions red: 1 added');
  // a flagged line second in the quote wins over a wrapper first line
  // B1-ADAPTED (F79): a plain first line is flagged text now, so it wins
  assert.equal(saidLine(['wrapper line', 'src/a.ts(1,2): error TS2322: bad']), 'wrapper line');
});

test('R5: a file already shown in full earlier in the SAME hint is written by its basename; the first mention stays full', () => {
  const L = auroraLedger();
  const hints = renderHints(L, ctx).text.split(/\n(?=\d+\. \[)/);
  const h2 = hints.find((h) => h.includes('no-suppressions')) ?? '';
  const full = 'packages/spawner/src/aurora_spawner/spawner.py';
  assert.equal(h2.split(full).length - 1, 1, 'the full path appears exactly once, in the lesson line');
  assert.ok(h2.indexOf(full) < h2.indexOf('It said'));
  // B1-ADAPTED (F79): "It said" is the first line now, not the `added any` line
  assert.match(h2, /It said: SPAWNER red: 3 suppression/);
  assert.match(h2, /\n   Fix touched: spawner\.py\n?$/);
  // the first hint: its first Fix touched file (not shown before) stays full; the same path on another hint is full again (per hint)
  const h1 = hints.find((h) => h.includes('"typecheck"')) ?? '';
  assert.match(h1, /Fix touched: packages\/spawner\/src\/aurora_spawner\/timeout_policy\.py, packages\/spawner\/src\/aurora_spawner\/circuit_breaker\.py/);
  // a plain path that was never shown before is never shortened, whatever the hint
  const cardEdit = { ...pulse, fixTouched: ['src/a.js', 'lib/b.js'], whatChanged: null };
  const lone = renderHints(pulseLedger(cardEdit), pulseCtx).text;
  assert.match(lone, /Fix touched: src\/a\.js, lib\/b\.js/);
  // a first mention in the quote (the lesson names no file; the record is edited) stays full
  const noFile = renderHints(pulseLedger({ ...cardEdit, files: [], fixTouched: [] }), pulseCtx).text;
  assert.match(noFile, /It said: src\/checks\.js\(121,28\)/);
  // the SAME path twice in one hint: lesson, said and fix-touched
  const twice = renderHints(pulseLedger({ ...cardEdit, fixTouched: ['src/checks.js'] }), pulseCtx).text;
  assert.equal(twice.split('src/checks.js').length - 1, 1);
  assert.match(twice, /It said: checks\.js\(121,28\)/);
  assert.match(twice, /Fix touched: checks\.js/);
});

test('R5: the leading "NAME | " wrapper stays stripped from the quote lines', () => {
  const lines = auroraLedger().rows.flatMap((r) => r.sample.said);
  assert.ok(lines.length > 0 && lines.every((l) => !/^[A-Z][A-Z0-9_-]* \| /.test(l)));
});

// ── climbing follows the memory filter (ledger keeps all, memory filters): a level counts only rows not decayed at read time ──
/** the same real lesson seen once in each workflow at `place`, at the dates given (one fold per workflow) */
function siblings(/** @type {[string, string][]} */ seen, place = '/p/shared') {
  const tc = built[0].cards.find((c) => c.check === 'typecheck');
  assert.ok(tc);
  let L = emptyLedger();
  for (const [wf, at] of seen) L = countLedger(L, { runid: `r-${wf}`, cards: [{ ...tc, job: wf, at }], workflow: wf, place, specHash: null, trust: 'deterministic', now: new Date(at) });
  return L;
}
const readFor = (/** @type {any} */ L, /** @type {Date} */ now, workflow = 'job-c') => ({ workflow, place: '/p/shared', specHash: null, now });

test('climb follows memory: siblings from January do not make today\'s lesson a place lesson', () => {
  const today = '2026-10-23T09:00:00Z';
  const L = siblings([['job-a', '2026-01-10T09:00:00Z'], ['job-b', '2026-01-12T09:00:00Z'], ['job-c', today]]);
  const now = new Date(today);
  const rows = readableRows(L, readFor(L, now));
  assert.deepEqual(rows.map((r) => [r.workflow, r.level]), [['job-c', 'workflow']], 'the two January rows are out of memory, so they do not count');
  const text = renderHints(L, readFor(L, now)).text;
  assert.match(text, /\[this job, seen 1 time\]/);
  assert.doesNotMatch(text, /this place/);
  // the ledger itself kept all three rows
  assert.equal(L.rows.length, 3);
});

test('climb: three fresh siblings still climb to the place and are read there', () => {
  const L = siblings([['job-a', '2026-10-20T09:00:00Z'], ['job-b', '2026-10-21T09:00:00Z'], ['job-c', '2026-10-22T09:00:00Z']]);
  const rows = readableRows(L, readFor(L, new Date('2026-10-23T09:00:00Z'), 'job-d'));
  assert.deepEqual(rows.map((r) => r.level), ['place', 'place', 'place']);
});

test('climb: a place-level lesson drops back to workflow when its siblings age past 56 days, with no write to the ledger', () => {
  const L = siblings([['job-a', '2026-09-01T09:00:00Z'], ['job-b', '2026-09-02T09:00:00Z'], ['job-c', '2026-10-15T09:00:00Z']]);
  const early = new Date('2026-10-15T09:00:00Z');
  assert.deepEqual(readableRows(L, readFor(L, early)).map((r) => r.level), ['place', 'place', 'place'], 'all three seen within 56 days: place');
  const later = new Date('2026-10-24T09:00:00Z'); // job-a is 53 days old, still in; job-b too
  assert.equal(readableRows(L, readFor(L, later)).length, 3);
  const aged = new Date('2026-10-30T09:00:00Z'); // job-a (59 days) and job-b (58 days) are decayed
  assert.deepEqual(readableRows(L, readFor(L, aged)).map((r) => [r.workflow, r.level]), [['job-c', 'workflow']]);
  assert.equal(readableRows(L, readFor(L, aged, 'job-z')).length, 0, 'and a workflow-level row is not read by another job');
});

test('climb: an old ledger file with a stored level loads; the stored value is ignored at read and reset at the next write', () => {
  const L = siblings([['job-a', '2026-10-20T09:00:00Z']]);
  const old = { ...L, rows: L.rows.map((r) => ({ ...r, level: 'user' })) };
  assert.deepEqual(readableRows(old, readFor(old, new Date('2026-10-23T09:00:00Z'), 'job-a')).map((r) => r.level), ['workflow']);
  assert.equal(readableRows(old, readFor(old, new Date('2026-10-23T09:00:00Z'), 'job-z')).length, 0, 'a stored user level does not reach another job');
  const tc = built[0].cards.find((c) => c.check === 'typecheck');
  assert.ok(tc);
  const next = countLedger(old, { runid: 'r-next', cards: [{ ...tc, job: 'job-b', at: '2026-10-22T09:00:00Z' }], workflow: 'job-b', place: '/p/shared', specHash: null, trust: 'deterministic', now: NOW });
  assert.deepEqual(next.rows.map((r) => r.level), ['workflow', 'workflow']);
});
