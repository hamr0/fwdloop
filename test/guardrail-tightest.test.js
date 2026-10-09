// A joined guardrail with two word limits: the TIGHTEST wins (hamr 2026-10-09, 2A). One reader, guardrailWordLimit; the sum check uses it too.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardrailWordLimit, checkGuardrailSums } from '../src/declaration.js';
import { joinGuardrails } from '../src/panel/authorcard.js';

test('T1: under 600 words; under 300 words checks 300, in either order; one number is unchanged', () => {
  assert.equal(guardrailWordLimit(joinGuardrails(['under 600 words', 'under 300 words'])), 300);
  assert.equal(guardrailWordLimit(joinGuardrails(['under 300 words', 'under 600 words'])), 300);
  assert.equal(guardrailWordLimit('3 sections, all under 600 words'), 600);
  assert.equal(guardrailWordLimit('under 1,200 words; under 1,000 words'), 1000);
  assert.equal(guardrailWordLimit('no number here'), null);
  // a per-section size is never a total limit, so it does not tighten it
  assert.equal(guardrailWordLimit('under 600 words; 200 words each'), 600);
});

test('T2: the sum check uses the tightest limit', () => {
  const reds = checkGuardrailSums([{ n: 3, guardrail: '3 sections, 200 words each; under 600 words; under 300 words' }]);
  assert.equal(reds.length, 1);
  assert.match(reds[0], /under 300 words in total/);
});
