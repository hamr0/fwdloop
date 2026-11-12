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

test('through the real draft path: the bad table check is not green, the red reaches the next try, and a fix goes green at no extra round', async () => {
  const stuck = fakeProvider([NO_WORDS, toolReply(decl([BAD, CELLS]))]);
  const r = await draft({ proseText: prose, provider: stuck, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, false, 'a red left on the last try fails the draft');
  assert.ok(r.reds.includes(RED_BAD), JSON.stringify(r.reds));
  const fixed = fakeProvider([NO_WORDS, toolReply(decl([BAD, CELLS])), toolReply(decl([GOOD, CELLS]))]);
  const ok = await draft({ proseText: prose, provider: fixed, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
  assert.equal(draftCalls(fixed).length, 2, 'two drafting rounds: the red is fed to the next try, nothing else is metered');
  assert.ok(JSON.stringify(draftCalls(fixed)[1].messages).includes('already fails on the input'), 'try 2 is told the red');
});
