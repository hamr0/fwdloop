// M20 am3g item 23: a step's newest-try checks have one owner (newestChecksOf, src/diary.js): a row with a whole-number `try` and a `checks` list; the highest `try`; a tie goes to the later row.
// Named change, on odd rows only: the Audit skips a row whose `try` is not a whole number or whose `checks` is not a list, and takes the highest `try` where it took the last row in the file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditChecksOf } from '../src/auditchecks.js';
import { newestChecksOf } from '../src/diary.js';

const decl = () => ({
  steps: [{ fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }] } } }],
  checkList: [
    { state: 'built', key: 'L1.$floor', line: 1, kind: 'floor', by: 'default' },
    { state: 'built', key: 'L1.~1', line: 1, kind: 'rule', by: 'you', part: { line: 1, part: 0 } },
  ],
});
const rowOf = (t, ok, over = {}) => ({ kind: 'checks', step: 'a1', try: t, checks: [{ n: 3, text: 'at most 80 words', ok, part: 0, by: 'you', source: 'line 1 ~' }], ...over });
const resultOf = (diary) => auditChecksOf(decl(), diary, null, { lines: [{ n: 1, text: 'Write it' }] })?.lines[0].checks.find((r) => r.text === 'at most 80 words')?.result;

test('newestChecksOf: highest try wins, a tie goes to the later row, odd rows are skipped', () => {
  assert.equal(newestChecksOf([rowOf(1, true), rowOf(2, false)], 'a1')?.try, 2);
  assert.equal(newestChecksOf([rowOf(2, false), rowOf(1, true)], 'a1')?.try, 2, 'the highest try, not the last in the file');
  const tie = [rowOf(1, true), rowOf(1, false)];
  assert.equal(newestChecksOf(tie, 'a1'), tie[1], 'a tie goes to the later row');
  assert.equal(newestChecksOf([rowOf('1', true), rowOf(1.5, true), rowOf(1, true, { checks: 'x' })], 'a1'), null);
  assert.equal(newestChecksOf([rowOf(1, true)], 'other'), null);
});

test('named change: the Audit reads the highest try, not the last row in the file', () => {
  assert.equal(resultOf([rowOf(2, false), rowOf(1, true)]), 'failed', 'break: take the last row in the file and this reads passed');
});

test('named change: the Audit skips a row whose try is not a whole number or whose checks is not a list', () => {
  assert.equal(resultOf([rowOf(1, false), rowOf('2', true)]), 'failed', 'a string try is skipped');
  assert.equal(resultOf([rowOf(1, false), rowOf(2, true, { checks: undefined })]), 'failed', 'a row with no checks list is skipped');
});
