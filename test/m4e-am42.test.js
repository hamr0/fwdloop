// M4e amendment 42: the Chat card's Checked list and the Job tab say the same words for a step after the last ask.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedLines } from '../src/checked.js';

const decl = { steps: [
  { fromLine: 1, close: { class: 'hitl' } },
  { fromLine: 2, close: { class: 'hitl' } }, // the ask step
  { fromLine: 3, close: { class: 'hitl' } }, // after the last ask, no machine check
  { fromLine: 4, close: { class: 'softgreen', shape: { maxWords: 50 } } }, // after the last ask but machine-checked: unchanged
] };

test('checkedLines: a non-green step after the last ask reads "you check it after you accept"; before it, "at the ask"', () => {
  const l = checkedLines(decl, { askLines: [2] });
  assert.equal(l[0].sentences[0], 'No machine check of the content: you check it at the ask.');
  assert.equal(l[2].sentences[0], 'No machine check of the content; you check it after you accept.');
  assert.match(l[3].sentences[0], /plain text only/);
});

test('checkedLines: no ask in the job keeps the old "only that the step happened" words', () => {
  assert.equal(checkedLines(decl, { askLines: [] })[2].sentences[0], 'No machine check of the content; the machine checks only that the step happened.');
});
