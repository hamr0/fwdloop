// M16 P3b (S5-S7, R7) at the drafter: with `checkList: true` the declaration turn is offered no `close.cited`, code assembles the checks of the block's lines from the list
// (the AI's own close checks on those lines are dropped), the list is signed as `checkList`, a check not on it is refused, and a part the block built that fails the gate stops the plan.
// Stub providers, $0. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeclarationSchema, buildRoundSchema, buildSystemPrompt } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';
import { parseSignedText } from '../src/signed-text.js';
import { walkProse } from './m16-drafter-fixture.mjs';

const menu = wiredMenu(['core']);
const closeProps = (/** @type {any} */ s) => Object.keys(s.properties.steps.items.properties.close.properties);

test('(S5) the declaration turn is offered no close.cited when the list is on; off, it is offered as before', () => {
  assert.ok(closeProps(buildDeclarationSchema(menu)).includes('cited'));
  assert.ok(!closeProps(buildDeclarationSchema(menu, { noCited: true })).includes('cited'), 'break: drop the noCited branch of buildDeclarationSchema and this reds');
  assert.ok(!closeProps(buildRoundSchema(menu, { noCited: true })).includes('cited'));
});

test('(S5) the prompt of a list job tells nothing of close.cited and shows the count rules of the list lines; off, it is as before', (t) => {
  const prose = walkProse(t, (s) => s.replace('1. Write 3 lines about my garden from the notes', '1. Write 3 lines about my garden from the notes\n   guardrail: exactly 3 bullets'));
  const p = parseSignedText(prose);
  assert.ok(p.ok);
  if (!p.ok) return;
  const args = { menu, lines: p.lines, arbiter: p.arbiter, factsInfo: [] };
  const off = buildSystemPrompt(args);
  assert.ok(off.includes('close.cited'), 'a document input is quoted as before');
  assert.ok(!off.includes('[guardrail: exactly 3 bullets]'), 'count rules are hidden from the AI as before (am27)');
  const on = buildSystemPrompt({ ...args, blockLines: new Set([1, 3, 5]), noCited: true });
  assert.ok(on.includes('[guardrail: exactly 3 bullets]'), 'break: pass the block lines to shownRules and this reds');
  assert.ok(!on.includes('close.cited'));
});
