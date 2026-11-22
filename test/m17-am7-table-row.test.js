// M17 am7 (docs/wiki/the-module-ladder.md "M17 am7"): a check that reads only the input sheet (a `table` check) never sits on a `~` rule's row, and a `~` rule no check holds
// reads "No check was picked for it, so you judge it at Accept." (never "no sheet check covers it"). Fake providers, the synthetic sheet test/fixtures/m10b-sheets/aging.csv, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../src/drafter.js';
import { buildSheetLine } from '../src/sheetbuild.js';
import { parseCsv, sheetTable } from '../src/csv.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const TABLES = { aging: sheetTable(parseCsv(readFileSync(AGING_CSV, 'utf8'))) };
const GUARD = 'every invoice appears exactly once, all 8 of them; flag amounts over 500';
const LINE = { n: 2, text: 'Put each invoice in its overdue bucket as of 2026-10-11', guardrail: GUARD };
const NO_PICK = 'No check was picked for it, so you judge it at Accept.';
const R1 = 'line 2: "every invoice appears exactly once, all 8 of them"';
const ROWCOUNT = { rule: 'table', table: 'aging', op: 'rowCount', n: 8, covers: [1] };
const OVER = { rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] };
const build = (suggestions) => buildSheetLine({ line: LINE, tables: TABLES, suggestions });

test('(a) a rule whose only suggestion is a table check: the check is an [agent] row that covers no rule, and the rule is Not checked', async () => {
  const r = await build([ROWCOUNT]);
  assert.deepEqual(r.ruleRows, []);
  assert.deepEqual(r.agentRows.map((x) => [x.check.rule, x.check.row, x.check.covers]), [['table', 'agent', []]]);
  assert.deepEqual(r.rows.map((x) => [x.rule, x.state]), [[1, 'not-checked'], [2, 'not-checked']]);
});

test('(d) a cells check still sits on its rule\'s row', async () => {
  const r = await build([ROWCOUNT, OVER]);
  assert.deepEqual(r.ruleRows.map((x) => [x.check.rule, x.check.covers]), [['cells', [2]]]);
  assert.deepEqual(r.rows.map((x) => x.state), ['not-checked', 'built']);
});

const prose = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: ${GUARD}
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
const run = (sheet) => draft({ proseText: prose, provider: fakeProvider([reply(JSON.stringify({ facts: [] })), toolReply(decl(sheet))]), rates: RATES, modelId: MODEL }).then((r) => r);

test('(b) through the real drafter: the Not checked line is the no-pick sentence and no card text says "no sheet check covers it"', async () => {
  const r = await run([ROWCOUNT, OVER]);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.notChecked.filter((t) => t.startsWith('line 2:')), [`${R1} — ${NO_PICK}`]);
  assert.equal(JSON.stringify(r).includes('no sheet check covers it'), false);
  const tbl = r.declaration.steps[1].close.sheet.find((c) => c.rule === 'table');
  assert.deepEqual([tbl.row, tbl.covers], ['agent', []]);
});

test('(c) a rule whose check was refused keeps the refusal as its reason', async () => {
  const bad = { ...ROWCOUNT, n: 99, covers: [1] }; // 99 is not in the person's words
  const r = await run([bad, OVER]);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const line = r.notChecked.find((t) => t.startsWith(R1));
  assert.ok(line && line.includes('suggestion refused: '), String(line));
  assert.equal(line.includes(NO_PICK), false);
});
