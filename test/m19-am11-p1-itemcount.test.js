// M19 am11 items 1 to 3 (docs/wiki/the-module-ladder.md): a `~` rule that counts list items, on a line with item fields, is the shape part's own item count (minItems / maxItems), on its own [you] row;
// code's own per-input item count on that line is Not checked; the worker is told the count as signed. $0, no AI. The walk plan is test/fixtures/m19-am10, rebuilt through the real path as test/m19-am10-itempick.test.js does.
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
import { cardOfPlan } from '../src/checkrows.js';
import { shapeLineBrief } from '../src/rubricstep.js';
import { CheckBlock } from '../src/checkblock.js';
import { buildShapes } from '../src/shapebuild.js';

const FX = new URL('./fixtures/m19-am10/', import.meta.url).pathname;

/** the walk plan, with the count rule's words changed when `words` is given */
function setUp(words = null) {
  const root = mkdtempSync(path.join(tmpdir(), 'am11p1-'));
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir);
  for (const f of ['log.json', 'picks-record.json', 'not-checked.json', 'declaration.json']) copyFileSync(path.join(FX, f), path.join(planDir, f));
  for (const f of ['prose.txt', 'target.json']) writeFileSync(path.join(planDir, f), readFileSync(path.join(FX, f), 'utf8').replaceAll('__ROOT__', root).replace('exactly 4 list items', words ?? 'exactly 4 list items'));
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
  return { built, validate, step: built.declaration.steps.find((/** @type {any} */ s) => s.fromLine === 2), lines: b.lines, b };
}
const it = (/** @type {string} */ t, s = 'closed') => ({ title: t, status: s, summary: 'ok' });
const items = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => it(`I${i}`));
const verdict = async (/** @type {any} */ step, /** @type {any} */ a) => closeByClass(step, { done: true, blocker: null, ...a }, { reads: {}, businessDate: '2026-11-21' });

test('am11 item 1: "exactly 4 list items" on the walk plan is the shape part\'s minItems and maxItems 4, no pick, no pickedLines, and the plan passes its own gate', () => {
  const { built, validate, step } = setUp();
  assert.equal(step.close.itemShape.minItems, 4);
  assert.equal(step.close.itemShape.maxItems, 4);
  assert.equal(Object.hasOwn(step.close, 'picked'), false);
  assert.equal(Object.hasOwn(step.close, 'shape'), false);
  assert.equal(built.declaration.pickedLines, undefined);
  const v = validate(built.declaration);
  assert.equal(v.ok, true, v.ok ? '' : String(v.reds[0]));
});

test('am11 item 1 (Must-fail 1, 2): a 4-item answer with no text passes "exactly 4 list items"; a 3-item and a 5-item answer fail it', async () => {
  const { step } = setUp();
  assert.equal((await verdict(step, { results: items(4) })).verdict, 'green', 'no `text` is needed');
  assert.equal((await verdict(step, { results: items(4), text: 'not a list at all' })).verdict, 'green', 'the text is not counted');
  assert.equal((await verdict(step, { results: items(3) })).verdict, 'red');
  assert.equal((await verdict(step, { results: items(5) })).verdict, 'red');
});

test('am11 item 1: "at least 3 list items" is minItems 3 (2 fails, 3 and 4 pass); "at most 5 list items" is maxItems 5 (6 fails, 4 and 5 pass)', async () => {
  const lo = setUp('at least 3 list items');
  assert.equal(lo.step.close.itemShape.minItems, 3);
  assert.equal(Object.hasOwn(lo.step.close.itemShape, 'maxItems'), false);
  for (const [n, want] of [[2, 'red'], [3, 'green'], [4, 'green']]) assert.equal((await verdict(lo.step, { results: items(n) })).verdict, want, `at least 3, ${n} items`);
  const hi = setUp('at most 5 list items');
  assert.equal(hi.step.close.itemShape.maxItems, 5);
  assert.equal(Object.hasOwn(hi.step.close.itemShape, 'minItems'), false);
  for (const [n, want] of [[4, 'green'], [5, 'green'], [6, 'red']]) assert.equal((await verdict(hi.step, { results: items(n) })).verdict, want, `at most 5, ${n} items`);
});

test('am11 items 1, 4 (Must-fail 3): the count rule is its own [you] row on the shape part, built, from "rule"; the card shows it once, with the shape rows, no pick row', () => {
  const { built, lines } = setUp();
  const row = built.declaration.checkList.find((/** @type {any} */ r) => r.key === 'L2.~4');
  assert.ok(row);
  assert.deepEqual([row.by, row.kind, row.from, row.state, row.part], ['you', 'rule', 'rule', 'built', { line: 2, part: 0 }]);
  const card = cardOfPlan({ declaration: built.declaration, lines }).rows.filter((/** @type {any} */ r) => r.line === 2);
  const r4 = card.filter((/** @type {any} */ r) => r.key === 'L2.~4');
  assert.equal(r4.length, 1);
  assert.equal(r4[0].by, 'you');
  assert.equal(r4[0].text, 'the answer lists exactly 4 items');
  assert.match(r4[0].part, /^L2:shape:/);
  assert.equal(card.some((/** @type {any} */ r) => /:pick:/.test(r.part)), false, 'no pick row');
});

test('am11 item 3: the worker is told the count as signed: exactly N items, at least N items, at most N items', () => {
  const fields = [{ name: 'title', spec: { kind: 'text', required: true, minChars: 1 } }];
  assert.match(shapeLineBrief(2, { fields, minItems: 4, maxItems: 4 }), /One object per item: exactly 4 items\./);
  assert.match(shapeLineBrief(2, { fields, minItems: 3 }), /One object per item: at least 3 items\./);
  assert.match(shapeLineBrief(2, { fields, maxItems: 5 }), /One object per item: at most 5 items\./);
  assert.match(shapeLineBrief(2, { fields }), /one item for every one you find/);
});

// ---- block-level: code's own per-input count (item 2) and the text line (Must-fail: "exactly 3 bullets" still counts its text)
const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: null };
const TEXT = 'Resume of Ada. Skills: python, sql. Resume of Alan. Skills: logic.';
const f = (/** @type {any} */ o) => ({ required: true, bounds: {}, fromRule: null, ...o });
const NOTE = 'your rule on this line sets the item count';
function blockOf(/** @type {string[]} */ rules, /** @type {any[]} */ fields, /** @type {string[]} */ per) {
  const LN = [{ n: 1, text: 'Write one summary per page', rules }];
  const b = new CheckBlock({ texts: { page: TEXT }, labels: ['page'], asks: false, split: true });
  b.fromJob(LN);
  b.setGuards(['changed-from-seed'], ['output/']);
  b.reconcile();
  b.setShape(buildShapes({ lines: LN, labels: ['page'], suggestions: [{ line: 1, fields, extraFields: [], itemCountFrom: per }], nameRules: NR }));
  const out = assembleFromBlock({ declaration: { steps: [{ goal: 'Write one summary per page', primitives: [], reads: ['page'], emits: 'a', fromLine: 1, close: { class: 'hitl' } }], guardrailClasses: {} }, block: b, lines: [{ n: 1, guardrail: rules.join('; ') }], lineSet: new Set([1]) });
  return { b, out, close: out.declaration.steps[0].close, row: (/** @type {string} */ k) => out.declaration.checkList.find((/** @type {any} */ r) => r.key === k) };
}

test('am11 item 2 (Must-fail 5): a rule\'s count beside code\'s per-input count: the rule is the one count (its rows), code\'s own count is Not checked with the signed reason', () => {
  const x = blockOf(['the blurb is under 60 words', 'exactly 4 list items'], [f({ name: 'blurb', kind: 'text', bounds: { maxWords: 59 }, fromRule: 1 })], ['page']);
  assert.equal(x.close.itemShape.minItems, 4);
  assert.equal(x.close.itemShape.maxItems, 4);
  assert.deepEqual(x.row('L1.~2') && [x.row('L1.~2').by, x.row('L1.~2').state, x.row('L1.~2').part], ['you', 'built', { line: 1, part: 0 }]);
  const def = x.row('L1.$shape');
  assert.equal(def?.state, 'not-checked');
  assert.equal(def?.reason, NOTE);
  assert.equal(x.out.declaration.checkList.filter((/** @type {any} */ r) => r.state === 'built' && r.part?.part === 0).some((/** @type {any} */ r) => r.key === 'L1.$shape'), false, 'code\'s count is not on the part');
});

test('am11 item 2: with no count rule, code\'s per-input count is checked as it was (the default row is built, minItems = maxItems = 1)', () => {
  const x = blockOf(['the blurb is under 60 words'], [f({ name: 'blurb', kind: 'text', bounds: { maxWords: 59 }, fromRule: 1 })], ['page']);
  assert.deepEqual([x.close.itemShape.minItems, x.close.itemShape.maxItems], [1, 1]);
  assert.equal(x.row('L1.$shape')?.state, 'built');
});

test('am11 (Must-fail 6): a text line with no item fields still counts its text: "exactly 3 bullets" stays a pick over text, not an item count', () => {
  const LN = [{ n: 1, text: 'Write one summary', rules: ['exactly 3 list items'] }];
  const b = new CheckBlock({ texts: { page: TEXT }, labels: ['page'], asks: false, split: true });
  b.fromJob(LN);
  b.setGuards(['changed-from-seed'], ['output/']);
  b.reconcile();
  assert.equal(b.isShapeLine(1), false);
  assert.equal(b.rows.find((r) => r.key === 'L1.~1')?.can?.how, 'pick');
});
