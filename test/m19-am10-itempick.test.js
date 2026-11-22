// M19 am10 (docs/wiki/the-module-ladder.md): a list line with item fields keeps the checks the person picked, as M10 am22 keeps them on a fact line. $0, no AI. The plan is the practice walk's saved
// red draft (test/fixtures/m19-am10, copied from the walk's draft-1; research notes only, no PII), rebuilt through the real path (src/planrebuild.js `rebuildBlock`, then the assembly and the gate as `assembleAgain` calls them).
// Each must-fail case was seen red on the code before the change (F243).
// M19 am11 item 1 replaces am10 for a rule that COUNTS LIST ITEMS only (it is the item fields' own count now, test/m19-am11-p1-itemcount.test.js); every other pick on the line stays as am10 says. So the pick here is a word count,
// "at most 100 words" (the fixture's rule 4 reworded; the walk's "exactly 4 list items" no longer is a pick).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { rebuildBlock } from '../src/planrebuild.js';
import { assembleFromBlock } from '../src/blockassemble.js';
import { validateDeclaration } from '../src/declaration.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { csvRolesOf } from '../src/sheetblock.js';
import { docRolesOf } from '../src/drafter.js';
import { closeByClass } from '../src/closers.js';
import { closeRecords } from '../src/try-checks.js';

const FX = new URL('./fixtures/m19-am10/', import.meta.url).pathname;
const clone = (/** @type {any} */ o) => JSON.parse(JSON.stringify(o));
const PICK = 'at most 100 words';
const SENTENCE = /close\.picked is for a step that checks facts \(quotes or a sheet\) only; this step's check is "(hitl|softgreen)"/;

function setUp() {
  const root = mkdtempSync(path.join(tmpdir(), 'am10-'));
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir);
  for (const f of ['log.json', 'picks-record.json', 'not-checked.json', 'declaration.json']) copyFileSync(path.join(FX, f), path.join(planDir, f));
  for (const f of ['prose.txt', 'target.json']) writeFileSync(path.join(planDir, f), readFileSync(path.join(FX, f), 'utf8').replaceAll('__ROOT__', root).replace('exactly 4 list items', PICK));
  copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  const b = rebuildBlock({ planDir, asks: true });
  assert.equal(b.ok, true, b.ok ? '' : b.say);
  assert(b.ok);
  const cat = loadCatalogue();
  assert(cat.ok);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((/** @type {any} */ a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
  const validate = (/** @type {any} */ d) => validateDeclaration(d, {
    arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
    pageWords: { texts: b.texts, look: null, docs: docRolesOf(b.parsed.arbiter.sources) },
  });
  return { built, validate, step: built.declaration.steps.find((/** @type {any} */ s) => s.fromLine === 2) };
}

test('am10 items 1, 3: the walk plan keeps its agreed pick on the item line and passes its own gate', () => {
  const { built, validate, step } = setUp();
  assert.deepEqual(step.close.picked, [{ rule: 'maxWords', value: 100 }]);
  assert.ok(step.close.itemShape && !step.close.cited);
  assert.deepEqual(built.declaration.pickedLines, [2]);
  const v = validate(built.declaration);
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
});

test('am10 item 3: a count the drafter wrote itself on an item line is refused (pick not recorded, line not recorded, own shape)', () => {
  const { built, validate } = setUp();
  const redsOf = (/** @type {(d: any, s: any) => void} */ fn) => { const d = clone(built.declaration); fn(d, d.steps.find((/** @type {any} */ s) => s.fromLine === 2)); const v = validate(d); return v.ok ? [] : v.reds.map(String); };
  const a = redsOf((d) => { delete d.pickedLines; });
  const b = redsOf((d) => { d.pickedLines = [3]; });
  assert.match(a[0] ?? '', /line 2 is not one of the lines you picked checks for \(pickedLines\)/);
  assert.match(b[0] ?? '', /line 2 is not one of the lines you picked checks for \(pickedLines\)/);
  assert.ok(redsOf((d, s) => { delete s.close.picked; delete d.pickedLines; s.close.shape = { maxWords: 80 }; }).length > 0);
  assert.ok(redsOf((d, s) => { delete s.close.picked; delete d.pickedLines; s.close.shape = { picked: [{ rule: 'maxWords', value: 100 }] }; }).length > 0);
});

test('am10: a pick on a hitl or softgreen step is still refused with the same sentence (a line with neither check is unchanged)', () => {
  const { built, validate } = setUp();
  for (const cls of ['hitl', 'softgreen']) {
    const d = clone(built.declaration);
    d.steps.find((/** @type {any} */ s) => s.fromLine === 2).close = { class: cls, picked: [{ rule: 'maxWords', value: 100 }] };
    if (cls === 'hitl') delete d.guardrailClasses['2']; else d.guardrailClasses['2'] = 'softgreen';
    const v = validate(d);
    assert.equal(v.ok, false);
    assert.match(String(v.reds.find((/** @type {any} */ r) => /close\.picked is for/.test(r))), SENTENCE, cls);
  }
});

test('am10 items 1, 2: the step is green only if the item fields and the pick both pass; missing text or results is red', async () => {
  const { step } = setUp();
  const ctx = { reads: {}, businessDate: '2026-11-21' };
  const it = (/** @type {string} */ t, s = 'closed') => ({ title: t, status: s, summary: 'ok' });
  const four = [it('A'), it('B'), it('C'), it('D')];
  const bullets = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => `- item ${i + 1}`).join('\n');
  const words = (/** @type {number} */ n) => Array.from({ length: n }, () => 'w').join(' ');
  const v = async (/** @type {any} */ a) => (await closeByClass(step, { done: true, blocker: null, ...a }, ctx)).verdict;
  assert.equal(await v({ results: four, text: words(100) }), 'green');
  assert.equal(await v({ results: four, text: words(101) }), 'red');
  assert.equal(await v({ results: [...four.slice(0, 3), it('D', 'weird')], text: words(10) }), 'red');
  assert.equal(await v({ results: four }), 'red');
  assert.equal(await v({ results: four, text: '' }), 'red');
  assert.equal(await v({ text: words(10) }), 'red');
});

test('am10 (M10 am22 item 4): the Audit check row of the pick on an item line carries the pick\'s own list part and tag', async () => {
  const { built, step } = setUp();
  const it = (/** @type {string} */ t, s = 'closed') => ({ title: t, status: s, summary: 'ok' });
  const art = { results: [it('A'), it('B'), it('C'), it('D', 'weird')], text: '- a\n- b\n- c', done: true, blocker: null };
  const closed = await closeByClass(step, art, { reads: {}, businessDate: '2026-11-21' });
  const rows = closeRecords(step, art, closed, built.declaration.checkList);
  const pickRow = rows.find((/** @type {any} */ r) => r.text === 'at most 100 words');
  const listRow = built.declaration.checkList.find((/** @type {any} */ r) => r.key === 'L2.~4');
  assert.ok(pickRow && listRow);
  assert.equal(pickRow.by, 'you');
  assert.equal(pickRow.part, listRow.part.part, 'the row is the pick\'s own part, not the shape part before it');
});

test('am10: the numbers-tie row of an item line sits after the item-fields part and the pick (part 2), tagged default', async () => {
  const { built, step } = setUp();
  const it = (/** @type {string} */ t) => ({ title: t, status: 'closed', summary: 'ok' });
  const art = { results: [it('A'), it('B'), it('C'), it('D')], text: '- a\n- b\n- c\n- d', done: true, blocker: null };
  const closed = { ...(await closeByClass(step, art, { reads: {}, businessDate: '2026-11-21' })), numbersCheck: { text: 'numbers tie', ok: true, result: null } };
  const rows = closeRecords(step, art, closed, built.declaration.checkList);
  const tieRow = rows.find((/** @type {any} */ r) => r.text === 'numbers tie');
  assert.ok(tieRow);
  assert.equal(tieRow.part, 2, 'part 0 = item fields, 1 = the pick, 2 = the tie');
  assert.equal(tieRow.by, 'default');
});
