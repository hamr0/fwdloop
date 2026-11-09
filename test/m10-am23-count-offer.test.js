// M10 am23 (docs/wiki/the-module-ladder.md): a count guardrail always reaches the pick offer. $0 tests; each was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignedText } from '../src/signed-text.js';
import { scopedRules, offerRules } from '../src/checkpick.js';
import { guardrailItemCount, isCountGuardrail } from '../src/declaration.js';

const prose = (guard, source = 'page:https://example.test/p') => `1. Summarise the page,
   guardrail: ${guard}
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source s = ${source}
`;
const parsed = (g, src) => { const p = parseSignedText(prose(g, src)); assert.ok(p.ok); return p; };
const tie = (rule) => ({ line: 1, forRule: rule, name: 'x', shape: 'count' });

test('am23 (1): ~ exactly 3 bullets on a page job is offered; so are the other counts', () => {
  for (const g of ['exactly 3 bullets', 'at most 5 list items', 'no more than 4 items', 'exactly three lines', '2 points', '3 sections']) {
    const p = parsed(g);
    assert.equal(offerRules(p.lines, p.arbiter, []).length, 1, g);
  }
});

test('am23 (2): a saved look that tied bullets and words to facts still offers both; no fact is removed', () => {
  const p = parsed('exactly 3 bullets; under 80 words');
  const facts = [tie(1), tie(2)];
  const got = offerRules(p.lines, p.arbiter, facts);
  assert.deepEqual(got.map((r) => r.text), ['exactly 3 bullets', 'under 80 words']);
  assert.equal(facts.length, 2);
});

test('am23 (3): a guardrail that is not a count behaves as before (out of scope on a page job; removed when tied)', () => {
  for (const g of ['under $150', 'nonstop', 'the price is $5 per item', 'departs 05:00']) {
    const p = parsed(g);
    assert.deepEqual(offerRules(p.lines, p.arbiter, []), [], `${g} untied`);
    assert.equal(isCountGuardrail(g), false, g);
  }
  // a non-count rule that is in scope (no routing input) and tied is still removed
  const p = parsed('nonstop', 'file:poc/m0/in.txt');
  assert.equal(scopedRules(p.lines, p.arbiter).length, 1);
  assert.deepEqual(offerRules(p.lines, p.arbiter, [tie(1)]), []);
});

test('am23: one reader says what a count is', () => {
  assert.equal(guardrailItemCount('exactly 3 bullets'), 3);
  assert.equal(guardrailItemCount('exactly three bullet points'), 3);
  assert.equal(guardrailItemCount('under $150 per item'), null);
  assert.equal(isCountGuardrail('under 80 words'), true);
});
