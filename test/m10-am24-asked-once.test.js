// M10 am24 (docs/wiki/the-module-ladder.md): each guardrail is asked once. A count guardrail gets no page question, only the pick. $0 tests; each was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
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
const facts = [
  { line: 2, name: 'price', shape: 'money', forRule: 1, currency: ['$'], unit: [], reading: { op: 'lt', value: 150 } },
  { line: 2, name: 'bullet', shape: 'phrase', forRule: 2 },
];

// M17 am4 (A1): the page-look ask path is gone (the list asks); what stays here is the pick offer, which a count guardrail with no tied fact still gets
test('am24 (1): a count guardrail with no tied fact is still offered as a pick', () => {
  assert.ok(parsed.ok);
  assert.deepEqual(offerRules(parsed.lines, parsed.arbiter, facts).map((r) => r.text), ['exactly 3 bullets', 'under 80 words']);
});
