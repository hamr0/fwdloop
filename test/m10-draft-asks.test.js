// M10 piece 3 at the drafter: the look's asks fire AFTER the one map call and BEFORE any paid drafting round; more than 3 stop at $0 more; a "drop it"
// rule is Not checked with the signed words. Fake provider, local fixtures, $0, no internet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { tooManyAsksText } from '../src/pageask.js';
import {
  RATES, MODEL, fakeProvider, textReply, toolReply,
} from './drafter-fixture.mjs';
import { PAGE, raw } from './fixtures/m10-map/load.mjs';

const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const prose = (guard = 'under $150; not a red-eye; nonstop') => `1. List 3 flights from Amsterdam to London,
   guardrail: ${guard}
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`;
const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m10asks-'));
const mapReply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const fetcher = async (url) => ({ ok: true, text: PAGE, url });
const run = (provider, extra = {}) => draft({
  proseText: prose(), provider, rates: RATES, modelId: MODEL, draftDir: path.join(tmp(), 'pages'), fetchPage: fetcher, ...extra,
});
// a plan for the job above: M17 am4 - Not checked is the list's, so it reads on a draft that reaches the list's assembly (a refused draft has none)
const planOf = () => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'flights_list', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['flights_list'], emits: 'ok', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['flights_list', 'ok'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: {}, refused: [],
});
const READ_Q = 'Your line 1 says "not a red-eye". I read it as: departure time between 05:00 and 23:59. Agree? Answer "agree", or type your own reading (your answer replaces that ~ rule on line 1).';

test('a reading ask fires after the look and BEFORE any drafting round: one provider call (the map), no declaration', async () => {
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p);
  assert.equal(p.calls.length, 1, 'only the map call was paid');
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'look-asks');
  assert.equal(r.declaration, null);
  assert.deepEqual(r.reds, []);
  assert.ok(r.costUsd > 0 && r.spendComplete === true, 'the map call is booked');
  assert.equal(r.questions.length, 1);
  assert.deepEqual(r.questions[0], {
    line: 1, question: READ_Q, source: 'look', ask: 'reading', ruleNo: 2, ruleText: 'not a red-eye', proposal: 'departure time between 05:00 and 23:59',
  });
  assert.ok(r.look.facts.length > 0 && r.pageLooks.length === 1, 'the look is kept for the plan folder');
});

test('the ask line\'s own guardrail ("nothing goes out before I accept") is a stop, not a page check: it is not asked', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]));
  assert.ok(!r.questions.some((q) => q.line === 2));
});

// M19 am3 (hamr 2026-11-20): a `~` rule code cannot check is Not checked with no question (bareloop v0.61.0), so "I can't check this" is never asked and never counted toward the 3.
// The cap on asks still holds for the asks that stay (a column reading: test/m10-draft-sheet.test.js, "more than 3 column asks").
// must fail (M19 am3): a draft asks "I can't check this" about a `~` rule
test('M19 am3: rules code cannot check ("pays well", "looks nice", "feels right") are not asked and never trip the cap; only the page reading is asked', async () => {
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p, { proseText: prose('under $150; not a red-eye; nonstop; pays well; looks nice; feels right') });
  assert.equal(p.calls.length, 1, 'only the map call was paid');
  assert.equal(r.stop, 'look-asks');
  assert.deepEqual(r.questions.map((q) => [q.ask, q.ruleText]), [['reading', 'not a red-eye']]);
  assert.deepEqual(r.reds, []);
  assert.ok(!JSON.stringify(r.questions).includes("I can't check"), 'no can\'t-check question about a ~ rule');
  assert.ok(tooManyAsksText([1, 2, 3, 4].map((i) => ({ line: 1, ruleText: `r${i}` }))).startsWith('Your job has 4 rules'), 'the cap words stay for the asks that remain');
});

test('M19 am3: the redraft of the same card (the reading answered) reaches drafting with the unreadable rules Not checked, no question', async () => {
  const p = fakeProvider([mapReply(raw(3)), toolReply(planOf())]);
  const r = await run(p, { proseText: prose('under $150; not a red-eye; nonstop; pays well; looks nice'), offerQuestions: false });
  assert.deepEqual(r.questions, []);
  assert.notEqual(r.stop, 'look-asks');
  assert.ok(r.notChecked.some((l) => l.includes('"pays well"')), r.notChecked.join('\n'));
  assert.ok(r.notChecked.some((l) => l.includes('"looks nice"')), r.notChecked.join('\n'));
});

test('the redraft after the answers (offerQuestions false) never asks', async () => {
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p, { offerQuestions: false });
  assert.notEqual(r.stop, 'look-asks');
  assert.ok(p.calls.length > 1 && p.calls[1].tools[0] === 'emit_declaration', 'a drafting round ran');
  assert.deepEqual(r.questions, []);
});

test('no page input, no look ask (a CSV-only job is unchanged)', async () => {
  const r = await draft({ proseText: prose().replace(/guardrail: source flights = page:.*\n/, ''), provider: fakeProvider([textReply()]), rates: RATES, modelId: MODEL });
  // (M10 am16: a shape guardrail now asks too, but never as a page look ask)
  assert.ok((r.questions ?? []).every((q) => q.ask === 'check' || q.ask === 'no-check'), JSON.stringify(r.questions));
});

// must fail (signed): a guardrail dropped with no reason
test('a rule the person left ("drop it") is Not checked with the signed words, the drafter is told, and no fact serves it', async () => {
  const p = fakeProvider([mapReply(raw(3)), toolReply(planOf())]);
  const r = await run(p, { offerQuestions: false, leftRules: [{ line: 1, rule: 2 }] });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.ok(!r.look.facts.some((f) => f.line === 1 && f.forRule === 2));
  assert.ok(r.look.dropped.some((d) => d.line === 1 && d.rule === 2 && d.reason === 'person-left'));
  assert.ok(r.notChecked.includes('line 1: "not a red-eye" — You chose to leave it Not checked, so you judge it at Accept.'), r.notChecked.join('\n'));
  assert.ok(p.calls.find((c) => c.tools[0] === 'emit_declaration').messages[0].content.includes('not checked · "not a red-eye" — You chose to leave it Not checked, so you judge it at Accept.'), 'the drafter is told');
});

test('a left rule that does not exist on the job is ignored, not invented', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]), { offerQuestions: false, leftRules: [{ line: 9, rule: 1 }, { line: 1, rule: 7 }] });
  assert.ok(!r.look.dropped.some((d) => d.reason === 'person-left'));
});

test('am2 item 3: the plan card row for a left rule reads exactly `line <n>: "<rule>" — You chose to leave it Not checked.` (M19 am9 item 1), and no other row uses the old `not checked · ` prefix but the Ask line', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), toolReply(planOf())]), { offerQuestions: false, leftRules: [{ line: 1, rule: 2 }] });
  assert.equal(r.ok, true, r.reds.join('\n'));
  const left = r.notChecked.filter((x) => x.endsWith('You chose to leave it Not checked, so you judge it at Accept.'));
  assert.deepEqual(left, ['line 1: "not a red-eye" — You chose to leave it Not checked, so you judge it at Accept.']);
  // M17 am5 (D3): the job's Ask line carries a ~ rule, which the list shows as Not checked with the signed reason; every other `not checked · ` row is that one
  assert.deepEqual(r.notChecked.filter((x) => x.startsWith('not checked · ') && !x.endsWith('You chose to leave it Not checked, so you judge it at Accept.')), ['not checked · "nothing goes out before I accept" \u2014 you judge it at the Ask']);
});
