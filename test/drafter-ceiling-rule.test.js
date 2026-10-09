// Amendment 29: the AI picks the whole-output ceiling; the drafter is told one sentence, in the schema and the prompt.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTCHECKED_PROMPT, buildDeclarationSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';

test('the drafter is told the guardrail\'s ceiling for the whole output, and never "smallest"', () => {
  assert.match(NOTCHECKED_PROMPT, /word ceiling[^\n]*the guardrail's ceiling for the whole output/i);
  const schema = buildDeclarationSchema(wiredMenu(['core']));
  const desc = JSON.stringify(schema).match(/"maxWords":\{[^}]*\}/)[0];
  assert.match(desc, /the guardrail's ceiling for the whole output/i);
  assert.doesNotMatch(desc + NOTCHECKED_PROMPT, /smallest/i);
});

// Copied from test/m4e-am24.test.js:11 (not exported there): the signed am25 negative, no number in the drafter's prompt or schema.
const NUMBERISH = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|pair|dozen|single|once|twice|max|maximum|at most|up to|limit)\b/i;
const maxWordsDesc = () => buildDeclarationSchema(wiredMenu(['core'])).properties?.maxWords?.description
  ?? JSON.stringify(buildDeclarationSchema(wiredMenu(['core']))).match(/"maxWords":\{[^}]*"description":"((?:[^"\\]|\\.)*)"/)[1];

test('one sentence carries the whole-output-ceiling rule in the schema and the prompt', async () => {
  const { WHOLE_OUTPUT_CEILING_RULE } = await import('../src/drafter.js');
  assert.equal(WHOLE_OUTPUT_CEILING_RULE, "use the guardrail's ceiling for the whole output");
  assert.ok(maxWordsDesc().includes(WHOLE_OUTPUT_CEILING_RULE), 'schema description carries the sentence');
  assert.ok(NOTCHECKED_PROMPT.includes(WHOLE_OUTPUT_CEILING_RULE), 'prompt carries the sentence');
});

test('NUMBERISH finds nothing in the maxWords description', () => {
  assert.doesNotMatch(maxWordsDesc(), NUMBERISH);
});

test('a separate sentence tells the drafter to leave the whole-output ceiling out when the guardrail names no ceiling', async () => {
  const { WHOLE_OUTPUT_CEILING_RULE, NO_CEILING_RULE } = await import('../src/drafter.js');
  assert.equal(WHOLE_OUTPUT_CEILING_RULE, "use the guardrail's ceiling for the whole output");
  assert.equal(NO_CEILING_RULE, 'If the guardrail names no ceiling for the whole output, leave the whole-output ceiling out.');
  assert.ok(maxWordsDesc().includes(WHOLE_OUTPUT_CEILING_RULE), 'signed sentence still in the schema');
  assert.ok(NOTCHECKED_PROMPT.includes(WHOLE_OUTPUT_CEILING_RULE), 'signed sentence still in the prompt');
  assert.ok(maxWordsDesc().includes(NO_CEILING_RULE), 'schema carries the new sentence');
  assert.ok(NOTCHECKED_PROMPT.includes(NO_CEILING_RULE), 'prompt carries the new sentence');
  assert.doesNotMatch(NO_CEILING_RULE, NUMBERISH);
});
