// M10b am5: a `table` check that already fails on the sheet the draft was made with is a red at draft time ($0, no model call). Real bareguard checkStep, fixtures/ar-aging.csv
// (one row per invoice, so `noDuplicates Customer` fails and `noEmpty Customer` holds). Fake providers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft, linesNamedByReds } from '../src/drafter.js';
import * as sheetrun from '../src/sheetrun.js';
import { parseCsv, sheetTable } from '../src/csv.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ar-aging.csv');
const TABLES = { aging: sheetTable(parseCsv(readFileSync(CSV, 'utf8'))) };
const BAD = { id: 'each-customer-once', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Customer', covers: [1] };
const GOOD = { id: 'customer-not-empty', rule: 'table', table: 'aging', op: 'noEmpty', column: 'Customer', covers: [] };
const CELLS = { id: 'customer-count', rule: 'cells', table: 'aging', claim: 'customers', op: 'uniqueCount', column: 'Customer', covers: [1] };
const plan = (sheet) => ({ steps: [{ primitives: ['read'], reads: ['aging'], emits: 'totals', fromLine: 2, close: { class: 'green', sheet } }] });
const RED_BAD = 'line 2: the table check "no duplicate Customer" already fails on the input "aging" (rows sharing a value: 2, 3, 4, 5, 6, 7), so this step could never pass. A table check judges the input sheet itself; to check what the step gives, use a cells check.';

test('a table check that fails on the draft-time sheet gets the signed red, naming the line and the check', async () => {
  const reds = await sheetrun.tableChecksFailingOnInput(plan([BAD, CELLS]), TABLES);
  assert.deepEqual(reds, [RED_BAD]);
  assert.deepEqual(linesNamedByReds(reds, plan([BAD]), [1, 2]), [2]);
});

test('a passing table check is not refused', async () => {
  assert.deepEqual(await sheetrun.tableChecksFailingOnInput(plan([GOOD, CELLS]), TABLES), []);
});

test('a cells check is never run at draft time (a cells check that would fail on an empty answer is silent)', async () => {
  assert.deepEqual(await sheetrun.tableChecksFailingOnInput(plan([CELLS]), TABLES), []);
});

test('no sheet, no close.sheet and a table role without a draft-time sheet give no red', async () => {
  assert.deepEqual(await sheetrun.tableChecksFailingOnInput(plan([BAD]), {}), []);
  assert.deepEqual(await sheetrun.tableChecksFailingOnInput({ steps: [{ close: { class: 'hitl' } }] }, TABLES), []);
});

const prose = `1. Read the aging report
2. Total the balance due per customer
   guardrail: every customer appears exactly once; total the balance due
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${CSV}
`;
const decl = (sheet) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'totals', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['totals'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['totals', 'human_ok'], emits: 'report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
});
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const NO_WORDS = reply(JSON.stringify({ facts: [] }));
const draftCalls = (p) => p.calls.filter((c) => c.tools[0] === 'emit_declaration');

// M17 am2: the table check that already fails on the sheet is no longer a red sent back to the AI; code refuses that suggestion at build (runTableChecks) and its rule is Not checked with the reason
test('through the real draft path: the bad table check is refused by code at build, never in the plan; its rule is Not checked with the reason, and nothing is sent back', async () => {
  const stuck = fakeProvider([NO_WORDS, toolReply(decl([BAD, CELLS]))]);
  const r = await draft({ proseText: prose, provider: stuck, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.declaration.steps[1].close.sheet.map((c) => c.op), ['uniqueCount'], 'only the cells check is built');
  assert.equal(draftCalls(stuck).length, 1, 'no second try: a refused suggestion is no red');
  assert.deepEqual(r.log.find((e) => e.sheetRefused)?.sheetRefused, [{ line: 2, helper: 'runTableChecks', why: 'the table check already fails on the sheet' }], 'the refusal is in the round log');
  // the cells check holds rule 1; the table check's refusal names only rule 1, which is held, so the one Not checked rule is rule 2, as before
  assert.deepEqual(r.notChecked, ['line 2: "total the balance due" \u2014 no sheet check covers it']);
  // a rule whose only suggestion is the bad table check shows it with the reason
  const only = await draft({ proseText: prose, provider: fakeProvider([NO_WORDS, toolReply(decl([BAD, { ...CELLS, covers: [2] }]))]), rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.deepEqual(only.notChecked, ['line 2: "every customer appears exactly once" \u2014 suggestion refused: runTableChecks: the table check already fails on the sheet']);
});
