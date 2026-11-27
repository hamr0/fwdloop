// M20 am8a item 2 (am8 item 4 withdrawn): the `number` and `date` arms in src/checkblock.js are reached. A number or date fact tied to a `~` rule that has no limit code can read
// leaves the rule Not checked; without the two arms it would fall to the phrase path and build a check with no limit (a widened close).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckBlock } from '../src/checkblock.js';

const PAGE = 'Flights\nStops: 1\nDeparts 2026-03-01\n';
const build = (/** @type {string} */ rule, /** @type {any} */ fact) => {
  const b = new CheckBlock({ texts: { flights: PAGE }, labels: ['flights'], asks: false });
  b.fromJob([{ n: 1, text: 'List flights', rules: [rule] }]);
  b.addLook([fact]);
  const close = b.reconcile();
  const facts = close.parts.flatMap((/** @type {any} */ p) => p.facts ?? []);
  return { row: b.rows.find((r) => r.kind === 'rule'), facts };
};

for (const [shape, rule, name, words] of [['number', 'few stops', 'stops', ['Stops:']], ['date', 'soon enough', 'departure date', ['Departs']]]) {
  test(`a ${shape} fact tied to a ~ rule with no limit code can read: the rule is Not checked with the look's words, no fact check is built`, () => {
    const { row, facts } = build(rule, { line: 1, name, shape, source: 'flights', words, forRule: 1 });
    assert.equal(row?.state, 'not-checked');
    assert.match(String(row?.reason), /the look tied a fact to this rule but gave no limit/);
    assert.deepEqual(facts.filter((f) => f.name === name), []);
  });
}
