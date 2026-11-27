// M20 am5 item 2: a diary row whose `checks` is not a list is read as a row with no checks by the Audit's "every step" read (it used to throw `.filter is not a function`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditChecksOf } from '../src/auditchecks.js';

const decl = () => ({
  steps: [{ fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }] } } }],
  checkList: [
    { state: 'built', key: 'L1.$floor', line: 1, kind: 'floor', by: 'default' },
    { state: 'built', key: 'L1.~1', line: 1, kind: 'rule', by: 'you', part: { line: 1, part: 0 } },
  ],
});
const EVERY = { n: 1, text: "the output exists and isn't empty", ok: true, source: 'every step' };

test('am5 item 2: a row whose checks is not a list is skipped, the other rows still read', () => {
  const diary = [
    { kind: 'checks', step: 'a1', try: 1, checks: 'not a list' },
    { kind: 'checks', step: 'a1', try: 2, checks: { n: 1 } },
    { kind: 'checks', step: 'a1', try: 3, checks: [EVERY] },
  ];
  const ac = auditChecksOf(decl(), diary, null, { lines: [{ n: 1, text: 'Write it' }] });
  assert.ok(ac, 'the Audit is built, not thrown');
  assert.equal(ac.always[0].result, 'passed', 'the row with a real list is read');
  const only = auditChecksOf(decl(), [{ kind: 'checks', step: 'a1', try: 1, checks: 'x' }], null, { lines: [{ n: 1, text: 'Write it' }] });
  assert.ok(only);
  assert.equal(only.always[0].result, 'none', 'a broken row alone gives no checks');
});
