// M19 am11 item 4 (docs/wiki/the-module-ladder.md): the run gives each check of a list line its own row result (bareloop src/rowresults.js `rowResultsOf`, copied; a count red lands on the row of the rule that set the count, fwd's change).
// An item-field red is on that field's row; a count red on the count rule's row; a whole-list red on the line's shape row (or told on its own when the line has none); the Audit shows each row's result; "every cited field matches its
// source" never appears on a line that quotes nothing. $0, no AI. The plan is test/fixtures/m19-am10 rebuilt through the real path, as test/m19-am11-p1-itemcount.test.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { rebuildBlock } from '../src/planrebuild.js';
import { assembleFromBlock } from '../src/blockassemble.js';
import { csvRolesOf } from '../src/sheetblock.js';
import { closeByClass } from '../src/closers.js';
import { closeRecords } from '../src/try-checks.js';
import { auditChecksOf } from '../src/auditchecks.js';

const FX = new URL('./fixtures/m19-am10/', import.meta.url).pathname;

function setUp(words = null) {
  const root = mkdtempSync(path.join(tmpdir(), 'am11p2-'));
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir);
  for (const f of ['log.json', 'picks-record.json', 'not-checked.json', 'declaration.json']) copyFileSync(path.join(FX, f), path.join(planDir, f));
  for (const f of ['prose.txt', 'target.json']) writeFileSync(path.join(planDir, f), readFileSync(path.join(FX, f), 'utf8').replaceAll('__ROOT__', root).replace('exactly 4 list items', words ?? 'exactly 4 list items'));
  copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  const b = rebuildBlock({ planDir, asks: true });
  assert(b.ok, b.ok ? '' : b.say);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((/** @type {any} */ a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
  return { decl: built.declaration, step: built.declaration.steps.find((/** @type {any} */ s) => s.fromLine === 2), lines: b.lines };
}
const item = (/** @type {string} */ t, o = {}) => ({ title: t, status: 'closed', summary: 'ok', ...o });
const items = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => item(`I${i}`));
/** the records the run saves for line 2 and the result of each, by row key */
async function run(/** @type {ReturnType<typeof setUp>} */ p, /** @type {any} */ answer) {
  const art = { done: true, blocker: null, ...answer };
  const closed = await closeByClass(p.step, art, { reads: {}, businessDate: '2026-11-21' });
  const recs = closeRecords(p.step, art, closed, p.decl.checkList, p.lines);
  return { closed, recs, byKey: Object.fromEntries(recs.filter((/** @type {any} */ r) => r.key).map((/** @type {any} */ r) => [r.key, r.ok])), failing: recs.filter((/** @type {any} */ r) => r.ok === false) };
}

test('am11 item 4: a green answer: each row of the line has its own passing record, and no record says "every cited field matches its source"', async () => {
  const p = setUp();
  const r = await run(p, { results: items(4) });
  assert.equal(r.closed.verdict, 'green');
  assert.deepEqual(r.byKey, { 'L2.~1': true, 'L2.~2': true, 'L2.~3': true, 'L2.~4': true });
  assert.equal(r.recs.some((/** @type {any} */ x) => /every cited field matches its source/.test(x.text)), false);
  assert.deepEqual(r.recs.filter((/** @type {any} */ x) => x.key).map((/** @type {any} */ x) => x.by), ['you', 'you', 'you', 'you']);
});

test('am11 item 4 (Must-fail 3, 4): a 5-item and a 3-item answer fail the count rule\'s row and no other', async () => {
  const p = setUp();
  for (const n of [5, 3]) {
    const r = await run(p, { results: items(n) });
    assert.equal(r.closed.verdict, 'red', `${n} items`);
    assert.deepEqual(r.byKey, { 'L2.~1': true, 'L2.~2': true, 'L2.~3': true, 'L2.~4': false }, `${n} items`);
  }
});

test('am11 item 4: a bad field fails that field\'s row only: no title on rule 1, a status outside the list on rule 2, a 200-character summary on rule 3', async () => {
  const p = setUp();
  const bad = async (/** @type {any} */ o) => (await run(p, { results: [item('A', o), ...items(3)] })).byKey;
  assert.deepEqual(await bad({ title: '' }), { 'L2.~1': false, 'L2.~2': true, 'L2.~3': true, 'L2.~4': true });
  assert.deepEqual(await bad({ status: 'open' }), { 'L2.~1': true, 'L2.~2': false, 'L2.~3': true, 'L2.~4': true });
  assert.deepEqual(await bad({ summary: 'x'.repeat(200) }), { 'L2.~1': true, 'L2.~2': true, 'L2.~3': false, 'L2.~4': true });
});

test('am11 item 4: a whole-list red (no `results`) is told on its own, never as a passed row: the verdict is red and a record is failing', async () => {
  const p = setUp();
  const r = await run(p, {});
  assert.equal(r.closed.verdict, 'red');
  assert.ok(r.failing.length >= 1, 'a failing record names it');
  assert.equal(r.recs.some((/** @type {any} */ x) => /every cited field matches its source/.test(x.text)), false);
  const ac = auditChecksOf(p.decl, [{ step: p.step.emits, try: 1, checks: r.recs }], null, { lines: p.lines });
  assert.ok(ac?.lines.find((/** @type {any} */ l) => l.n === 2).checks.some((/** @type {any} */ x) => x.result === 'failed'), 'the Audit does not show only passed rows for a red list');
});

test('am11 item 4 (Must-fail 4): two count rules (at least 3, at most 5): a count red lands on the rule whose bound it is, and on no other', async () => {
  const p = setUp('at least 3 list items; at most 5 list items');
  const fields = { 'L2.~1': true, 'L2.~2': true, 'L2.~3': true };
  const under = await run(p, { results: items(2) });
  assert.equal(under.closed.verdict, 'red');
  assert.deepEqual(under.byKey, { ...fields, 'L2.~4': false, 'L2.~5': true }, 'two items: the "at least 3" row');
  const over = await run(p, { results: items(6) });
  assert.deepEqual(over.byKey, { ...fields, 'L2.~4': true, 'L2.~5': false }, 'six items: the "at most 5" row');
  assert.deepEqual((await run(p, { results: items(4) })).byKey, { ...fields, 'L2.~4': true, 'L2.~5': true });
});

test('am11 item 4: the Audit shows each row of the list line with its own result, and the failing one with the reason its check recorded', async () => {
  const p = setUp();
  const rec = async (/** @type {any} */ answer) => {
    const r = await run(p, answer);
    return auditChecksOf(p.decl, [{ step: p.step.emits, try: 1, checks: r.recs }], null, { lines: p.lines });
  };
  const rowsOf = (/** @type {any} */ ac) => ac.lines.find((/** @type {any} */ l) => l.n === 2).checks;
  const ok = rowsOf(await rec({ results: items(4) }));
  assert.equal(ok.length, 4);
  assert.deepEqual(ok.map((/** @type {any} */ r) => r.result), ['passed', 'passed', 'passed', 'passed']);
  const five = rowsOf(await rec({ results: items(5) }));
  assert.deepEqual(five.map((/** @type {any} */ r) => r.result), ['passed', 'passed', 'passed', 'failed']);
  assert.match(five[3].text, /items/);
  assert.ok(typeof five[3].why === 'string' && five[3].why.length > 0);
  const badTitle = rowsOf(await rec({ results: [item('A', { title: '' }), ...items(3)] }));
  assert.deepEqual(badTitle.map((/** @type {any} */ r) => r.result), ['failed', 'passed', 'passed', 'passed']);
});
