// hamr 2A: two word limits in one guardrail, the smallest wins (guardrailWordLimit). The drafter must be told.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTCHECKED_PROMPT, buildDeclarationSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';

test('the drafter is told to use the smallest word limit', () => {
  assert.match(NOTCHECKED_PROMPT, /word ceiling[^\n]*smallest/i);
  const schema = buildDeclarationSchema(wiredMenu(['core']));
  const desc = JSON.stringify(schema).match(/"maxWords":\{[^}]*\}/)[0];
  assert.match(desc, /smallest/i);
});

// Copied from test/m4e-am24.test.js:11 (not exported there): the signed am25 negative, no number in the drafter's prompt or schema.
const NUMBERISH = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|pair|dozen|single|once|twice|max|maximum|at most|up to|limit)\b/i;
const maxWordsDesc = () => buildDeclarationSchema(wiredMenu(['core'])).properties?.maxWords?.description
  ?? JSON.stringify(buildDeclarationSchema(wiredMenu(['core']))).match(/"maxWords":\{[^}]*"description":"((?:[^"\\]|\\.)*)"/)[1];

test('one sentence carries the smallest-ceiling rule in the schema and the prompt', async () => {
  const { SMALLEST_CEILING_RULE } = await import('../src/drafter.js');
  assert.equal(typeof SMALLEST_CEILING_RULE, 'string');
  assert.ok(maxWordsDesc().includes(SMALLEST_CEILING_RULE), 'schema description carries the sentence');
  assert.ok(NOTCHECKED_PROMPT.includes(SMALLEST_CEILING_RULE), 'prompt carries the sentence');
  assert.match(SMALLEST_CEILING_RULE, /smallest/i);
  assert.match(SMALLEST_CEILING_RULE, /each section|per section/i);
  assert.match(SMALLEST_CEILING_RULE, /not/i);
});

test('NUMBERISH finds nothing in the maxWords description', () => {
  assert.doesNotMatch(maxWordsDesc(), NUMBERISH);
});
