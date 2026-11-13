// M10 am7 item 1 at the drafter. M16 item 5 replaces it FOR THE LINES OF THE LIST ("the drafter writes the facts"): the check block builds the cited part from the page look and the
// person's rules; whatever cited part the AI sends is dropped, so there is nothing of the AI's for the words gate to refuse and no rule to tell it. Fake provider, F71's real page and map answers, $0, no internet. The forced reds are named in the commit.
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

const NAMES = ['price', 'departure time', 'nonstop', 'origin airport', 'destination airport'];

test('M16 item 5: the list builds the facts from the look and the rules, and the plan card shows every fact; the AI\'s count is not kept', async () => {
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration())]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 0);
  const cited = r.declaration.steps[0].close.cited;
  assert.deepEqual(cited.facts.map((f) => f.name), NAMES);
  assert.equal(cited.count, undefined, 'the AI\'s {min: 3, max: 3} is a check it wrote; no row of the list carries it');
  const [line1] = checkedLines(r.declaration, { askLines: [2] });
  assert.ok(line1.sentences.some((s) => s.startsWith('fact · origin airport — phrase, must say "Leaves Amsterdam Airport Schiphol", quoted from "flights"')), line1.sentences.join('\n'));
  assert.ok(line1.sentences.some((s) => s.startsWith('fact · price — money in US dollars, under 150 US dollars, after "From", quoted from "flights"')));
});

test('M16 item 5: the drafter is not told close.cited or its rules; the page words it may see are still listed', async () => {
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration())]);
  await run(p);
  const sys = p.calls[1].messages[0].content;
  assert.doesNotMatch(sys, /close\.cited/);
  assert.doesNotMatch(sys, /EVERY one of its phrases as its own phrase fact/);
  assert.match(sys, /- flights: a web page/);
  assert.equal(p.calls[1].schemas[0].properties.steps.items.properties.close.properties.cited, undefined);
});

test('M16 item 5: a number the person never wrote, sent in the AI\'s cited part, is dropped with it: the plan holds the limit the look read, no red, no revise', async () => {
  const bad = facts();
  bad[2] = { ...bad[2], rule: { op: 'lt', value: 450 } };
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration(bad))]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 0);
  assert.ok(!JSON.stringify(r.declaration).includes('450'));
  assert.deepEqual(r.declaration.steps[0].close.cited.facts.find((f) => f.name === 'price').rule, { op: 'lt', value: 150 });
});

test('M16 item 5: a cited part that leaves out the look\'s limit is dropped too: the plan\'s price fact carries it', async () => {
  const bad = facts().map((f) => (f.name === 'price' ? { name: 'price', shape: 'money', anchor: 'From', unit: ['US dollars'] } : f));
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration(bad))]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 0);
  assert.deepEqual(r.declaration.steps[0].close.cited.facts.find((f) => f.name === 'price').rule, { op: 'lt', value: 150 });
});

test('M16 item 5: a place the AI left out of its cited part is in the plan anyway (every place phrase, fwd R2c, built by code)', async () => {
  const bad = facts().filter((f) => f.name !== 'destination airport');
  const p = fakeProvider([mapReply(raw(3)), toolReply(declaration(bad))]);
  const r = await run(p);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.ok(r.declaration.steps[0].close.cited.facts.some((f) => f.phrase === 'arrives at Heathrow Airport'));
});
