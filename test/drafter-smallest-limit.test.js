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
