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
  RATES, MODEL, fakeProvider, textReply,
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
const READ_Q = 'Your line 1 says "not a red-eye". I read it as: departure time between 05:00 and 23:59. Agree? Answer "agree", or type your own reading (your answer is added as a new ~ rule on line 1).';

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

// must fail (signed): more than 3 asks before drafting; it must stop at $0 more instead
test('more than 3 asks: nothing is asked, drafting stops with the rewrite list, then Spent so far; no drafting round was paid', async () => {
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p, { proseText: prose('under $150; not a red-eye; nonstop; pays well; looks nice; feels right') });
  assert.equal(p.calls.length, 1);
  assert.equal(r.stop, 'look-asks-too-many');
  assert.deepEqual(r.questions, []);
  assert.equal(r.ok, false);
  const m = /^(Your job has (\d+) rules .*)( Spent so far: (.+)\.)$/s.exec(r.reds[0]);
  assert.ok(m, r.reds[0]);
  assert.equal(m[2], '4');
  assert.match(m[1], /line 1 "not a red-eye" → departure time between 05:00 and 23:59; line 1 "pays well" → I can't check this on the page; line 1 "looks nice" → I can't check this on the page; line 1 "feels right" → I can't check this on the page\.$/);
  assert.match(m[4], /^\$0\.\d{4}$/);
  assert.equal(r.reds.length, 1);
  assert.ok(tooManyAsksText([1, 2, 3, 4].map((i) => ({ line: 1, ruleText: `r${i}` }))).startsWith('Your job has 4 rules'));
});

test('exactly 3 asks are asked (the cap is 3, not 2)', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]), { proseText: prose('under $150; not a red-eye; nonstop; pays well; looks nice') });
  assert.equal(r.stop, 'look-asks');
  assert.deepEqual(r.questions.map((q) => q.ask), ['reading', 'cant-check', 'cant-check']);
});

test('an unpriced map call reads "Spent so far: unknown" (never $0)', async () => {
  const noUsage = { ...textReply(raw(3)) };
  delete noUsage.usage;
  const r = await run(fakeProvider([noUsage, textReply()]), { proseText: prose('under $150; not a red-eye; nonstop; pays well; looks nice; feels right') });
  assert.equal(r.stop, 'look-asks-too-many');
  assert.match(r.reds[0], /Spent so far: (unknown|at least \$0\.\d+)\.$/);
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
  assert.notEqual(r.stop, 'look-asks');
});

// must fail (signed): a guardrail dropped with no reason
test('a rule the person left ("drop it") is Not checked with the signed words, the drafter is told, and no fact serves it', async () => {
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p, { offerQuestions: false, leftRules: [{ line: 1, rule: 2 }] });
  assert.ok(!r.look.facts.some((f) => f.line === 1 && f.forRule === 2));
  assert.ok(r.look.dropped.some((d) => d.line === 1 && d.rule === 2 && d.reason === 'person-left'));
  assert.ok(r.notChecked.includes('not checked · "not a red-eye" — You chose to leave it Not checked.'), r.notChecked.join('\n'));
  assert.ok(p.calls[1].messages[0].content.includes('not checked · "not a red-eye" — You chose to leave it Not checked.'), 'the drafter is told');
});

test('a left rule that does not exist on the job is ignored, not invented', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]), { offerQuestions: false, leftRules: [{ line: 9, rule: 1 }, { line: 1, rule: 7 }] });
  assert.ok(!r.look.dropped.some((d) => d.reason === 'person-left'));
});

test('am2 item 3: the plan card row for a left rule reads exactly `not checked · "<rule>" — You chose to leave it Not checked.`, and no other row uses that prefix', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]), { offerQuestions: false, leftRules: [{ line: 1, rule: 2 }] });
  const left = r.notChecked.filter((x) => x.endsWith('You chose to leave it Not checked.'));
  assert.deepEqual(left, ['not checked · "not a red-eye" — You chose to leave it Not checked.']);
  assert.ok(r.notChecked.filter((x) => x.startsWith('not checked · ')).length === 1, 'page drops keep their own line form');
});
