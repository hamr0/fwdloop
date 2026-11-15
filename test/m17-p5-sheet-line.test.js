// M17 am4 (A3, B5) and the P4 leftovers, piece P5: a line the list is not given (a sheet line) has no question and no old pick path of its own; a sheet step code built no check for is hitl with each rule
// Not checked, never a red the AI cannot fix. Fake provider, the synthetic aging sheet, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../src/drafter.js';
import { validateDeclaration } from '../src/declaration.js';
import { loadCatalogue } from '../src/catalogue.js';
import * as pageask from '../src/pageask.js';
import * as checkpick from '../src/checkpick.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const prose = (guard) => `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: ${guard}
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
const decl = () => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green' } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' },
  refused: [],
});
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const NO_WORDS = reply(JSON.stringify({ facts: [] }));
const run = (guard, offerQuestions) => {
  const p = fakeProvider([NO_WORDS, toolReply(decl())]);
  return draft({ proseText: prose(guard), provider: p, rates: RATES, modelId: MODEL, ...(offerQuestions === undefined ? {} : { offerQuestions }) }).then((r) => ({ r, p }));
};

test('am4 (A3, B5): a count rule on a sheet line is asked no question and offered no pick call; it is Not checked with the list\'s reason', async () => {
  const { r, p } = await run('flag amounts over 500; at most 80 words');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.questions ?? [], []);
  assert.equal(p.calls.some((c) => c.tools[0] === 'suggest_checks'), false, 'no pick-suggestion call for a line the list is not given');
  assert.ok(r.notChecked.some((x) => x.includes('"at most 80 words"') && x.endsWith('No check was picked for it, so you judge it at the Ask.')), JSON.stringify(r.notChecked));
  assert.equal(r.declaration.steps[1].close.shape, undefined);
  assert.equal(r.declaration.steps[1].close.picked, undefined);
});

test('P4 leftover: a green sheet step with no sheet check built is hitl, each rule is Not checked with its reason, the draft is not red', async () => {
  const { r } = await run('flag amounts over 500; every invoice appears exactly once');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.log.some((e) => (e.reds ?? []).some((x) => x.includes('cannot cite cells any more'))), false, 'no red the AI cannot fix');
  assert.equal(r.declaration.steps[1].close.class, 'hitl');
  assert.equal(r.declaration.guardrailClasses['2'], 'hitl');
  assert.deepEqual([...r.notChecked].sort(), ['line 2: "every invoice appears exactly once" — No check was picked for it, so you judge it at the Ask.', 'line 2: "flag amounts over 500" — No check was picked for it, so you judge it at the Ask.']);
  assert.ok(r.log.every((e) => e.repaired === undefined), 'no repair drops a Not checked reason');
});

test('P4 leftover: the old red stays for a plan signed before (a green sheet step with no close.sheet and no list is still refused by the validator)', () => {
  const d = { ...decl(), unjudgeable: {}, inputFacts: {} };
  const v = validateDeclaration(d, { arbiter: { sources: [{ role: 'aging', kind: 'file', path: AGING_CSV }], asks: [{ line: 3 }], sends: [{ line: 4 }] }, lines: [{ n: 2, text: 'x', guardrail: 'flag amounts over 500' }], fitJobLine: true, verbatimGoals: false, catalogue: loadCatalogue().primitives });
  assert.ok(!v.ok && v.reds.some((x) => x.includes('cannot cite cells any more')), JSON.stringify(v.reds));
});

test('am4 (A1, A3, B5): no function in src asks a question or settles a pick outside the list (their exports are gone)', () => {
  assert.equal(/** @type {any} */ (pageask).askableFromLook, undefined);
  assert.equal(/** @type {any} */ (checkpick).settleRules, undefined);
  assert.equal(/** @type {any} */ (checkpick).applyPicks, undefined);
});
