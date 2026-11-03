// Amendment 29 (the AI picked the whole-output ceiling) is replaced by M10 am16: the drafter writes no check, so its schema offers no `shape` and no maxWords.
// The one sentence about the ceiling stays in the prompt's Not-checked list (information for notChecked), and never says "smallest".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTCHECKED_PROMPT, buildDeclarationSchema, WHOLE_OUTPUT_CEILING_RULE } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';

test('the drafter schema offers no shape and no maxWords: the drafter writes no check (am16 (4))', () => {
  const schema = /** @type {any} */ (buildDeclarationSchema(wiredMenu(['core'])));
  assert.equal(schema.properties.steps.items.properties.close.properties.shape, undefined);
  assert.doesNotMatch(JSON.stringify(schema), /"maxWords"|"mustCarry"|"linesPerInvoice"/);
});

test('the Not-checked prompt carries the ceiling sentence, never "smallest"', () => {
  assert.equal(WHOLE_OUTPUT_CEILING_RULE, "use the guardrail's ceiling for the whole output");
  assert.ok(NOTCHECKED_PROMPT.includes(WHOLE_OUTPUT_CEILING_RULE));
  assert.doesNotMatch(NOTCHECKED_PROMPT, /smallest/i);
});
