// M10 am7 item 1 at the drafter: the drafter WRITES the facts (`close.cited`), code checks them at $0 against the drafting copy of the page and what the page-word
// map kept, a refusal names the job line and goes back to the drafter, and the drafter is TOLD every rule (a rule it was not told would fail every draft).
// Fake provider, F71's real page and map answers, $0, no internet. The forced reds are named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { checkedLines } from '../src/checked.js';
import {
  RATES, MODEL, fakeProvider, textReply, toolReply,
} from './drafter-fixture.mjs';
import { PAGE, raw } from './fixtures/m10-map/load.mjs';

const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR&hl=en&curr=USD';
const PROSE = `1. List 3 flights from Amsterdam to London,
   guardrail: under $150; departure time between 05:00 and 23:59; nonstop
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`;
const mapReply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const facts = () => [
  { name: 'origin airport', shape: 'phrase', phrase: 'Leaves Amsterdam Airport Schiphol' },
  { name: 'destination airport', shape: 'phrase', phrase: 'arrives at Heathrow Airport' },
  { name: 'price', shape: 'money', anchor: 'From', unit: ['US dollars'], rule: { op: 'lt', value: 150 } },
  { name: 'departure time', shape: 'time', anchor: 'Departure time:', rule: { op: 'between', lo: '05:00', hi: '23:59' } },
  { name: 'nonstop', shape: 'phrase', phrase: 'Nonstop' },
];
const declaration = (f = facts()) => ({
  steps: [
    { primitives: [], reads: ['flights'], emits: 'flights_found', fromLine: 1, close: { class: 'green', cited: { source: 'flights', facts: f, count: { min: 3, max: 3 } } } },
    { primitives: [], reads: ['flights_found'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'green', 2: 'hitl' },
  unjudgeable: {},
  refused: [],
});
const run = (provider) => draft({
  proseText: PROSE, provider, rates: RATES, modelId: MODEL, draftDir: path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m10cited-')), 'pages'), fetchPage: async (url) => ({ ok: true, text: PAGE, url }), offerQuestions: false,
});

test('the drafter writes the facts and count, code accepts them: the draft is valid and the plan card shows every fact', async () => {
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration())]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 0);
  const cited = r.declaration.steps[0].close.cited;
  assert.equal(cited.facts.length, 5);
  assert.deepEqual(cited.count, { min: 3, max: 3 });
  const [line1] = checkedLines(r.declaration, { askLines: [2] });
  assert.ok(line1.sentences.some((s) => s === 'fact · origin airport — phrase, must say "Leaves Amsterdam Airport Schiphol", quoted from "flights"'), line1.sentences.join('\n'));
  assert.ok(line1.sentences.some((s) => s === 'fact · price — money in US dollars, under 150 US dollars, after "From", quoted from "flights"'));
  assert.ok(line1.sentences.some((s) => s === 'fact · results — exactly 3 results, each quoted from "flights"'));
});

test('the drafter is told every rule the validator will apply, and the checked words: place phrases, labels, units, the limit read', async () => {
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration())]);
  await run(p);
  const sys = p.calls[1].messages[0].content;
  for (const need of [
    /close\.cited = \{source, facts, count\}/, /"List 3" is \{min: 3, max: 3\}/, /PICKED from the kept labels/, /EVERY one of its phrases as its own phrase fact/,
    /only use a number that is in the person's own words/, /at least as many times as close\.cited\.count\.min/, /letters and spaces only/,
    /place phrases \(every one must be its own phrase fact\) "Leaves Amsterdam Airport Schiphol"/, /"arrives at Heathrow Airport"/,
    /price.*labels "From", unit "US dollars", limit read from your words: under 150/s, /labels "Departure time:"/, /MUST carry that rule/,
  ]) assert.match(sys, need);
  const schema = p.calls[1].tools.includes('emit_declaration');
  assert.equal(schema, true);
});

test('a number the person never wrote is refused with the line named, the drafter is told, and the redraft passes', async () => {
  const bad = facts();
  bad[2] = { ...bad[2], rule: { op: 'lt', value: 450 } };
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration(bad)), toolReply(declaration())]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 1);
  // the made-up 450 replaced the limit the look read (150), so the missing 150 is a second red
  assert.equal(r.log.find((e) => e.outcome?.startsWith('validator')).reds.length, 2);
  assert.match(r.log.find((e) => e.outcome?.startsWith('validator')).reds[0], /line 1: fact "price" has the number 450 in its rule/);
  assert.match(p.calls[2].messages.at(-1).content, /line 1: fact "price" has the number 450/);
});

test('a plan that leaves out the limit the look read from the guardrail is refused at $0 with the bound named, the drafter is told, and the redraft passes', async () => {
  const bad = facts().map((f) => (f.name === 'price' ? { name: 'price', shape: 'money', anchor: 'From', unit: ['US dollars'] } : f));
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration(bad)), toolReply(declaration())]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 1);
  const red = r.log.find((e) => e.outcome?.startsWith('validator')).reds;
  assert.equal(red.length, 1, red.join('\n'));
  assert.match(red[0], /line 1: your words on line 1 set a limit, price under 150 US dollars, but no money fact of this check carries it/);
  assert.match(p.calls[2].messages.at(-1).content, /price under 150 US dollars/);
});

test('a drafter that never fixes it is stopped at the validator with the red kept; nothing is signed', async () => {
  const bad = facts().filter((f) => f.name !== 'destination airport');
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration(bad))]);
  const r = await run(p);
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'validator');
  assert.match(r.reds.join('\n'), /line 1: the place "destination airport" must be checked with the words "arrives at Heathrow Airport"/);
});
