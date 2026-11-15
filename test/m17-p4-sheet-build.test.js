// M17 P4 (docs/wiki/the-module-ladder.md "M17 am2", "M17 am3", rulings of hamr 2026-11-14): sheet checks are built by code on bareguard. Each test names the break that turns it red.
// Fake providers, the synthetic sheet test/fixtures/m10b-sheets/aging.csv, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../src/drafter.js';
import { buildSheetLine } from '../src/sheetbuild.js';
import { parseCsv, sheetTable } from '../src/csv.js';
import { applyAnswers } from '../src/panel/authorcard.js';
import { columnChoiceParts, swapColumnWord } from '../src/sheetoffer.js';
import { sheetByOf } from '../src/checkwords.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const TABLES = { aging: sheetTable(parseCsv(readFileSync(AGING_CSV, 'utf8'))) };
const LINE = { n: 2, text: 'Put each invoice in its overdue bucket as of 2026-10-11', guardrail: 'every invoice appears exactly once; flag amounts over 500' };
const ROWS = { id: 'x', rule: 'cells', table: 'aging', claim: 'x', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] };
const COUNT = { rule: 'cells', table: 'aging', claim: 'c', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] };
const NODUP = { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' };
const build = (suggestions) => buildSheetLine({ line: LINE, tables: TABLES, suggestions });

test('am3 forced case: a table check then a cells check on one rule: the rule row is the cells check, the table check is its own [agent] row', async () => {
  const r = await build([{ ...NODUP, covers: [1] }, { ...COUNT, covers: [1] }]);
  assert.deepEqual(r.ruleRows.map((x) => [x.check.rule, x.check.covers]), [['cells', [1]]]);
  assert.deepEqual(r.agentRows.map((x) => [x.check.rule, x.check.covers]), [['table', []]]);
  assert.equal(r.refused.length, 0, 'nothing is hidden');
});

test('am3 forced case: cells first then table gives the same rule row and agent row', async () => {
  const r = await build([{ ...COUNT, covers: [1] }, { ...NODUP, covers: [1] }]);
  assert.deepEqual(r.ruleRows.map((x) => x.check.rule), ['cells']);
  assert.deepEqual(r.agentRows.map((x) => x.check.rule), ['table']);
});

test('am3 forced case: two cells checks on one rule: the rule row is the first, the second is an [agent] row', async () => {
  const r = await build([{ ...COUNT, covers: [2] }, { ...ROWS, covers: [2] }]);
  assert.deepEqual(r.ruleRows.map((x) => x.check.op), ['countIf']);
  assert.deepEqual(r.agentRows.map((x) => x.check.op), ['rows']);
});

test('am3 must-fail: a rule row never holds two checks, no rule is on two rule rows, every built check is exactly one row, and no buildable suggestion is hidden', async () => {
  const sug = [{ ...COUNT, covers: [2] }, { ...ROWS, covers: [2] }, { ...NODUP, covers: [1] }, { rule: 'table', table: 'aging', op: 'noEmpty', column: 'Amount', covers: [] }, { ...ROWS, covers: [1, 2] }];
  const r = await build(sug);
  const held = r.ruleRows.flatMap((x) => x.covers);
  assert.equal(new Set(held).size, held.length, 'a rule is on one rule row only');
  assert.equal(r.ruleRows.length + r.agentRows.length, sug.length - r.refused.length, 'built + refused = suggested');
  assert.equal(r.refused.length, 0);
  assert.equal(new Set(r.checks.map((c) => c.id)).size, r.checks.length, 'every check has its own id: one row each');
  for (const a of r.agentRows) assert.equal(sheetByOf(a.check.covers), 'agent', 'an agent row is tagged [agent]');
  for (const a of r.ruleRows) assert.equal(sheetByOf(a.check.covers), 'you');
  assert.ok(r.checks.every((c) => /^l2[ra]/.test(c.id)), 'code names every check');
});

test('am2 must-fail: a suggestion bareguard refuses is never built; its rule is Not checked with the helper and its reason', async () => {
  const cases = [
    [{ rule: 'cells', table: 'aging', op: 'nope', covers: [2] }, 'vocabulary'],
    [{ ...ROWS, table: 'elsewhere', covers: [2] }, 'tables'],
    [{ ...ROWS, where: [{ column: 'Price', cmp: 'gt', value: 500 }], covers: [2] }, 'columnAt'],
    [{ ...ROWS, where: [{ column: 'Amount', cmp: 'gt', value: 777 }], covers: [2] }, 'groundedLiterals'],
    [{ rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Customer', covers: [2] }, 'runTableChecks'],
  ];
  const dup = { aging: sheetTable(parseCsv('Invoice #,Customer,Due date,Amount\nINV-1,A,2026-01-01,5\nINV-2,A,2026-01-02,6\n')) };
  for (const [s, helper] of cases) {
    const r = await buildSheetLine({ line: LINE, tables: helper === 'runTableChecks' ? dup : TABLES, suggestions: [s] });
    assert.equal(r.checks.length, 0, helper);
    assert.equal(r.refused[0].helper, helper);
    assert.equal(r.rows[1].state, 'not-checked');
    assert.ok(r.rows[1].reason.startsWith(`suggestion refused: ${helper}:`), r.rows[1].reason);
  }
});

test('am2 must-fail: the AI writes no sheet check: its id, claim and text are dropped; the plan holds only what code built', async () => {
  const r = await build([{ ...ROWS, id: 'AI-NAME', claim: 'AI-CLAIM', text: 'AI wrote this', covers: [2] }]);
  assert.deepEqual(r.checks.map((c) => [c.id, c.claim, c.text]), [['l2r2', 'l2r2', undefined]]);
});

const PROSE = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: every invoice appears exactly once; flag amounts over 500
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
const decl = (sheet) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
});
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const NO_WORDS = reply(JSON.stringify({ facts: [] }));

test('am2 must-fail through the real draft: the saved plan holds code-named checks only, the AI\'s own ids and claims are nowhere in the signed close, a made-up op is not in it', async () => {
  const sug = [{ ...NODUP, covers: [1] }, { ...ROWS, id: 'ai-over', claim: 'ai-over-claim', covers: [2] }, { id: 'bad', rule: 'cells', table: 'aging', claim: 'bad', op: 'madeUp', covers: [] }];
  const r = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl(sug))]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const sheet = r.declaration.steps[1].close.sheet;
  const text = JSON.stringify(sheet);
  for (const w of ['ai-over', 'nodup', 'madeUp', '"bad"']) assert.equal(text.includes(w), false, w);
  assert.deepEqual(sheet.map((c) => c.id), ['l2r2', 'l2r1']);
  assert.equal(r.log.find((e) => e.sheetRefused).sheetRefused[0].helper, 'vocabulary');
  // the card shows each rule once: two [you] rows, no Not checked
  assert.deepEqual(r.notChecked, []);
});

test('am3 must-fail through the real draft: a second buildable check on a rule is on the list as an [agent] row, on, with Drop', async () => {
  const sug = [{ ...COUNT, covers: [2] }, { ...ROWS, covers: [2] }, { ...NODUP, covers: [1] }];
  const r = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl(sug))]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const rows = r.checkCard.rows.filter((x) => x.line === 2);
  assert.deepEqual(rows.map((x) => [x.by, x.drop]), [['you', false], ['you', false], ['agent', true]]);
  assert.equal(r.declaration.steps[1].close.sheet.length, 3, 'nothing hidden');
});

test('ruling 1: a column answer tied to a ~ rule rewrites the rule\'s own words in place; no line is added', () => {
  const job = '1. Read the sheet\n2. Flag the big ones\n~ Price over 500\n3. Write it out';
  const ask = { line: 2, rule: "use the column 'Amount' for 'Price'", left: false, ruleNo: 1, ruleText: 'Price over 500', ask: 'reading', proposal: "use the column 'Amount' for 'Price'" };
  const r = applyAnswers(job, [ask]);
  assert.equal(r.job, '1. Read the sheet\n2. Flag the big ones\n~ Amount over 500\n3. Write it out');
  // own words replace the rule too
  const own = applyAnswers(job, [{ ...ask, rule: 'Amount above 500' }]);
  assert.equal(own.job, '1. Read the sheet\n2. Flag the big ones\n~ Amount above 500\n3. Write it out');
  assert.deepEqual(columnChoiceParts("use the column 'Amount' for 'Price'"), { column: 'Amount', word: 'Price' });
  assert.equal(swapColumnWord('price over 500', 'Price', 'Amount'), 'Amount over 500');
  assert.equal(swapColumnWord('priced over 500', 'Price', 'Amount'), null, 'whole words only');
});
