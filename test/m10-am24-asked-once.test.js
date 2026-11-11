// M10 am24 (docs/wiki/the-module-ladder.md): each guardrail is asked once. A count guardrail gets no page question, only the pick. $0 tests; each was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askableFromLook } from '../src/pageask.js';
import { offerRules } from '../src/checkpick.js';
import { parseSignedText } from '../src/signed-text.js';

// the shape of F162 run 1's saved look: line 2 has three rules; the look tied rules 1 and 2, nothing tied rule 3 (`under 80 words`)
const GUARD = 'under $150; exactly 3 bullets; under 80 words';
const job = `1. Read the flights page,
2. list 3 flights from Madrid to Rome,
   guardrail: ${GUARD}
3. ask 30m: check it with me,
4. write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source flights = page:https://example.test/flights
`;
const parsed = parseSignedText(job);
const lines = [{ n: 2, text: 'list 3 flights from Madrid to Rome,', rule: GUARD }];
const facts = [
  { line: 2, name: 'price', shape: 'money', forRule: 1, currency: ['$'], unit: [], reading: { op: 'lt', value: 150 } },
  { line: 2, name: 'bullet', shape: 'phrase', forRule: 2 },
];

test('am24 (1): a count guardrail with no tied fact gets no page question; it is still offered as a pick', () => {
  assert.ok(parsed.ok);
  const asks = askableFromLook({ facts }, lines);
  assert.equal(asks.some((a) => a.ruleText === 'under 80 words'), false);
  assert.deepEqual(offerRules(parsed.lines, parsed.arbiter, facts).map((r) => r.text), ['exactly 3 bullets', 'under 80 words']);
});

test('am24 (1): a count guardrail tied to a fact with a reading gets no `I read it as` question', () => {
  const l = [{ n: 2, text: 'list flights,', rule: 'under 80 words' }];
  // a reading ask needs a time or money fact with a bound the person did not write (75 is not in the line); here the look tied the count to one
  const f = [{ line: 2, name: 'price', shape: 'money', forRule: 1, currency: ['$'], unit: [], reading: { op: 'lt', value: 75 } }];
  assert.deepEqual(askableFromLook({ facts: f }, l), []);
});

test('am24 (3): a non-count guardrail keeps its page question (can\'t check, and a reading)', () => {
  const l = [{ n: 2, text: 'list flights,', rule: 'not a red-eye; cheap' }];
  const asks = askableFromLook({ facts: [{ line: 2, name: 'price', shape: 'money', forRule: 2, currency: ['$'], unit: [], reading: { op: 'lt', value: 150 } }] }, l);
  assert.deepEqual(asks.map((a) => `${a.ask}:${a.ruleText}`).sort(), ['cant-check:not a red-eye', 'reading:cheap']);
});

test('am24: no look fact is removed (the facts the caller holds are untouched)', () => {
  const before = JSON.stringify(facts);
  askableFromLook({ facts }, lines);
  assert.equal(JSON.stringify(facts), before);
});
