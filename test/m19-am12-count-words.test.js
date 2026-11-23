// M19 amendment 12 (docs/wiki/the-module-ladder.md, "M19 amendment 12"): the words of a list line's count row. $0, no AI, no src change.
// Item 1: one number `the answer lists exactly N items`; a lowest number only `at least N items`; a highest only `at most N items`; both `at least N items and at most M items`; with 1 the word is `item`.
// Item 2: the same words show on the card, the Job tab, the draft readout and the Audit. The walk plan is test/fixtures/m19-am10, rebuilt through the real path as test/m19-am11-p1-itemcount.test.js does;
// the count the person's rule set is changed on the signed shape part, so every surface reads the words the one reader writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { rebuildBlock } from '../src/planrebuild.js';
import { assembleFromBlock } from '../src/blockassemble.js';
import { csvRolesOf } from '../src/sheetblock.js';
import { shapeCountWords } from '../src/shaperows.js';
import { cardOfPlan, planCard } from '../src/checkrows.js';
import { checkedLines } from '../src/checked.js';
import { auditChecksOf } from '../src/auditchecks.js';

const FX = new URL('./fixtures/m19-am10/', import.meta.url).pathname;

/** the walk plan as built through the real path */
function setUp() {
  const root = mkdtempSync(path.join(tmpdir(), 'am12-'));
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir);
  for (const f of ['log.json', 'picks-record.json', 'not-checked.json', 'declaration.json']) copyFileSync(path.join(FX, f), path.join(planDir, f));
  for (const f of ['prose.txt', 'target.json']) writeFileSync(path.join(planDir, f), readFileSync(path.join(FX, f), 'utf8').replaceAll('__ROOT__', root));
  copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  const b = rebuildBlock({ planDir, asks: true });
  assert.equal(b.ok, true, b.ok ? '' : b.say);
  assert(b.ok);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((/** @type {any} */ a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
  return { declaration: built.declaration, lines: b.lines, csvRoles: csvRolesOf(b.parsed.arbiter) };
}

/** the same signed plan with the shape part of line 2 set to `part`'s counts (the one place the count is signed) @param {any} base @param {{minItems?: number, maxItems?: number}} part */
function withCount(base, part) {
  const declaration = structuredClone(base.declaration);
  const st = declaration.steps.find((/** @type {any} */ s) => s.fromLine === 2);
  delete st.close.itemShape.minItems;
  delete st.close.itemShape.maxItems;
  Object.assign(st.close.itemShape, part);
  return { ...base, declaration, st };
}

const FORMS = /** @type {[{minItems?: number, maxItems?: number}, string][]} */ ([
  [{ minItems: 4, maxItems: 4 }, 'the answer lists exactly 4 items'],
  [{ minItems: 3 }, 'the answer lists at least 3 items'],
  [{ maxItems: 5 }, 'the answer lists at most 5 items'],
  [{ minItems: 3, maxItems: 5 }, 'the answer lists at least 3 items and at most 5 items'],
]);

const SINGULAR = /** @type {[{minItems?: number, maxItems?: number}, string][]} */ ([
  [{ minItems: 1, maxItems: 1 }, 'the answer lists exactly 1 item'],
  [{ minItems: 1 }, 'the answer lists at least 1 item'],
  [{ maxItems: 1 }, 'the answer lists at most 1 item'],
]);

test('am12 item 1: the four forms of the count row, exact words', () => {
  for (const [part, words] of FORMS) assert.equal(shapeCountWords(part), words);
});

test('am12 item 1: with 1 the word is `item`, not `items` (exactly 1, at least 1, at most 1), and both bounds keep each their own singular', () => {
  for (const [part, words] of SINGULAR) assert.equal(shapeCountWords(part), words);
  assert.equal(shapeCountWords({ minItems: 1, maxItems: 5 }), 'the answer lists at least 1 item and at most 5 items');
  assert.equal(shapeCountWords({ minItems: 3, maxItems: 1 }), 'the answer lists at least 3 items and at most 1 item');
});

test('am12 item 1: a part with no count has no count words', () => {
  assert.equal(shapeCountWords({}), null);
});

/** the count row's words on each surface the code renders for line 2: the card, the draft readout (the saved card read back), the Job tab (the check sentences and the Audit's rows) */
function surfaces(/** @type {any} */ x) {
  const { declaration, lines, csvRoles } = x;
  const rowOf = (/** @type {any[]} */ rows) => rows.filter((r) => r.key === 'L2.~4');
  const card = cardOfPlan({ declaration, lines, csvRoles });
  // the draft readout: the saved card (rows as the draft saved them) re-read by the plan reader, as src/panel/author.js does
  const saved = planCard({ rows: card.rows, suggested: [], notChecked: card.notChecked }, { declaration, lines, csvRoles });
  const job = checkedLines(declaration, { askLines: [], lines, csvRoles }).find((s) => s.line === 2)?.sentences ?? [];
  const audit = auditChecksOf(declaration, [], null, { lines, csvRoles });
  return {
    card: rowOf(card.rows).map((r) => r.text),
    readout: rowOf(saved.rows).map((r) => r.text),
    job,
    audit: (audit?.checks ?? []).map((c) => c.text),
  };
}

test('am12 item 2 (Must-fail 2): every form and the singular show the same words on the card, the draft readout, the Job tab and the Audit', () => {
  const base = setUp();
  for (const [part, words] of [...FORMS, ...SINGULAR]) {
    const s = surfaces(withCount(base, part));
    assert.deepEqual(s.card, [words], `card: ${JSON.stringify(part)}`);
    assert.deepEqual(s.readout, [words], `readout: ${JSON.stringify(part)}`);
    assert.ok(s.job.some((t) => t.includes(words)), `Job tab: ${JSON.stringify(part)} -> ${JSON.stringify(s.job)}`);
    assert.ok(s.audit.some((t) => t === `line 2 · ${words}`), `Audit: ${JSON.stringify(part)} -> ${JSON.stringify(s.audit)}`);
  }
});
