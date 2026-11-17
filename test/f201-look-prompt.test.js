// F201 (hamr ruled adopt B, 2026-11-16): the page-look prompt states the goal, asks for a why per fact, and gives a "cannot" list
// for a rule the page cannot show. MAP_SYSTEM is unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPrompt, MAP_SYSTEM } from '../src/pagemap.js';

const jobLines = [{ n: 1, text: 'Find flights', rules: ['under 500 dollars', 'be friendly'] }];
const p = mapPrompt({ jobLines, label: 'flights', text: 'AMS to LIS $420' });

test('the prompt gives a "cannot" option: a rule the page cannot show gets no fact', () => {
  assert.match(p, /The page cannot show the rule/);
  assert.match(p, /Give NO fact for it/);
  assert.match(p, /"cannot":\[\{"from":"line N rule M","why":"<one line>"\}\]/);
});

test('the prompt asks for a one-line why per fact', () => {
  assert.match(p, /"why":"<one line>"/);
  assert.match(p, /one-line "why"/);
});

test('the job, the rules and the page text are still in the prompt; MAP_SYSTEM is unchanged', () => {
  assert.match(p, /LINE 1: Find flights\n~ rule 1: under 500 dollars\n~ rule 2: be friendly/);
  assert.match(p, /PAGE TEXT \(the input "flights"\):\nAMS to LIS \$420/);
  assert.match(MAP_SYSTEM, /^You map a person's job to the exact words of ONE saved web page\./);
});
