// M10 amendment 7 item 1 (docs/wiki/the-module-ladder.md): the facts are signed in the step's check (`close.cited`), written by the drafter and CHECKED by code at $0,
// naming the job line. Refusals: a label the page-read did not keep, a word not on the page, a label seen fewer times than the result count, a word a page rule
// dropped - and (tighter than bareloop) a number rule that is not in the person's own words on that line. $0, F71's real page and real map answers.
// Each must-fail case was seen red first; the commit names how.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignedText } from '../src/signed-text.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { validateDeclaration } from '../src/declaration.js';
import { parseMapAnswer } from '../src/pagemap.js';
import { applyPageWords, lookFactOf } from '../src/pagelook.js';
import { PAGE, raw, JOB } from './fixtures/m10-map/load.mjs';

const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR&hl=en&curr=USD';
const prose = (guard = 'under $150; departure time between 05:00 and 23:59; nonstop') => `1. List 3 flights from Amsterdam to London,
   guardrail: ${guard}
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`;
const signed = parseSignedText(prose());
assert.equal(signed.ok, true);
const cat = loadCatalogue();
assert.equal(cat.ok, true);

/** the page-read of one saved F71 draft: what the map KEPT and DROPPED, as the drafter keeps it */
function lookOf(n) {
  const p = parseMapAnswer(raw(n));
  const r = applyPageWords(PAGE, /** @type {any} */ (p).mapping, JOB);
  return { facts: r.facts.map((f) => lookFactOf(f, 'flights')), dropped: r.dropped.map((d) => ({ ...d, source: 'flights' })) };
}
/** the facts a careful drafter writes for draft 3's look */
const goodFacts = () => [
  { name: 'origin airport', shape: 'phrase', phrase: 'Leaves Amsterdam Airport Schiphol' },
  { name: 'destination airport', shape: 'phrase', phrase: 'arrives at Heathrow Airport' },
  { name: 'price', shape: 'money', anchor: 'From', unit: ['US dollars'], rule: { op: 'lt', value: 150 } },
  { name: 'departure time', shape: 'time', anchor: 'Departure time:', rule: { op: 'between', lo: '05:00', hi: '23:59' } },
  { name: 'nonstop', shape: 'phrase', phrase: 'Nonstop' },
];
const decl = (cited, over = {}) => ({
  steps: [
    { goal: signed.lines[0].text, primitives: [], reads: ['flights'], emits: 'flights_found', fromLine: 1, close: { class: 'green', cited }, ...over },
    { goal: signed.lines[1].text, primitives: [], reads: ['flights_found'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { goal: signed.lines[2].text, primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'green', 2: 'hitl' },
  unjudgeable: {},
  refused: [],
  inputFacts: {},
});
const part = (facts = goodFacts(), count = { min: 3, max: 3 }) => ({ source: 'flights', facts, ...(count === null ? {} : { count }) });
const check = (d, { words = true, look = lookOf(3) } = {}) => validateDeclaration(d, {
  arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: false, fitJobLine: true,
  ...(words ? { pageWords: { texts: { flights: PAGE }, look } } : {}),
});
const reds = (d, o) => { const r = check(d, o); return r.ok ? [] : [...r.reds]; };

test('a careful drafter\'s facts are accepted: the grown place phrases, the labels the page-read kept, numbers that are in the person\'s words', () => {
  const r = check(decl(part()));
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
});

test('a number rule that is not in the person\'s own words on that line is refused at $0 naming the line (tighter than bareloop)', () => {
  const f = goodFacts();
  f[2] = { ...f[2], rule: { op: 'lt', value: 450 } };
  const r = reds(decl(part(f)));
  assert.equal(r.length, 1, r.join('\n'));
  assert.match(r[0], /line 1: fact "price" has the number 450 in its rule, but 450 is not in your words on line 1/);
  // the same refusal is made where no page is at hand (sign): a number is checked against the signed job, not the page
  assert.match(reds(decl(part(f)), { words: false })[0], /number 450/);
});

test('a number rule that IS a reading the person agreed to is accepted: it is a ~ line of the signed job', () => {
  const agreed = parseSignedText(prose('under $150; departure time between 06:30 and 21:59; nonstop'));
  const f = goodFacts();
  f[3] = { ...f[3], rule: { op: 'between', lo: '06:30', hi: '21:59' } };
  const r = validateDeclaration(decl(part(f)), {
    arbiter: agreed.arbiter, lines: agreed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, fitJobLine: true, pageWords: { texts: { flights: PAGE }, look: lookOf(3) },
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  // but 05:00 is no longer in the words once the person's line says 06:30: the old bound is refused
  const old = validateDeclaration(decl(part(goodFacts())), {
    arbiter: agreed.arbiter, lines: agreed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, fitJobLine: true, pageWords: { texts: { flights: PAGE }, look: lookOf(3) },
  });
  assert.equal(old.ok, false);
});

test('a label the page-read did not keep is refused: a label is picked, never typed', () => {
  const f = goodFacts();
  f[2] = { ...f[2], anchor: 'Pay' };
  const r = reds(decl(part(f)));
  assert.equal(r.length, 1, r.join('\n'));
  assert.match(r[0], /line 1: fact "price": the label "Pay" is not one of the labels the page words for "flights" kept\. A label is picked from those, never typed: "From", "Departure time:"/);
});

test('a word that is not on the page is refused: a phrase, a unit, a closing label', () => {
  const f = goodFacts();
  f[4] = { name: 'nonstop', shape: 'phrase', phrase: 'Imaginary Air' };
  f[2] = { ...f[2], unit: ['euro cents'] };
  const r = reds(decl(part(f)));
  assert.ok(r.some((x) => /line 1: fact "nonstop": "Imaginary Air" is not in the input "flights"/.test(x)), r.join('\n'));
  assert.ok(r.some((x) => /line 1: fact "price": the unit "euro cents" is not in the input "flights"/.test(x)), r.join('\n'));
});

test('a label that shows up fewer times than the result count is refused, and so is a phrase (page-header words are in no result)', () => {
  const r = reds(decl(part(goodFacts(), { min: 40, max: 40 })));
  assert.ok(r.some((x) => /line 1: fact "price": the label "From" is in the input "flights" only 19 times, but this line asks for 40 results/.test(x)), r.join('\n'));
  assert.ok(r.some((x) => /line 1: fact "nonstop": the words "Nonstop" are in the input "flights" only \d+ times?, but this line asks for 40 results/.test(x)), r.join('\n'));
  // the same facts at the count of the job (3) are fine
  assert.deepEqual(reds(decl(part())), []);
});

test('a word a page rule dropped cannot come back through the drafter', () => {
  // draft 1's look dropped "Leaves" as a time label (it does not read the same values as "Departure time:") and the currency sign "$" as a way to write the price
  const f = goodFacts();
  f[3] = { ...f[3], anchor: 'Leaves' };
  f[2] = { ...f[2], currency: ['$'] };
  const r = reds(decl(part(f)), { look: lookOf(1) });
  assert.ok(r.some((x) => /line 1: fact "departure time": the label "Leaves" cannot be used\. "Leaves" does not show the same values as "Departure time:"/.test(x)), r.join('\n'));
  assert.ok(r.some((x) => /line 1: fact "price": the currency "\$" cannot be used\. "\$" does not show the same amounts as "US dollars"/.test(x)), r.join('\n'));
});

test('R2c: a place the page-read grew to phrases must have every phrase in the part, or a flipped route passes', () => {
  const f = goodFacts().filter((x) => x.name !== 'destination airport');
  let r = reds(decl(part(f)));
  assert.equal(r.length, 1, r.join('\n'));
  assert.match(r[0], /line 1: the place "destination airport" must be checked with the words "arrives at Heathrow Airport"/);
  // the ungrown phrase is no substitute
  const bare = goodFacts();
  bare[1] = { name: 'destination airport', shape: 'phrase', phrase: 'Heathrow Airport' };
  r = reds(decl(part(bare)));
  assert.ok(r.some((x) => /must be checked with the words "arrives at Heathrow Airport"/.test(x)), r.join('\n'));
});

test('the shape: green only, the source is a signed role the step reads, no stray fields, at most 10 facts, one count form', () => {
  assert.match(reds({ ...decl(part()), steps: decl(part()).steps.map((s, i) => (i === 0 ? { ...s, close: { class: 'softgreen', shape: { maxWords: 5 }, cited: part() } } : s)) }, { words: false }).join('\n'), /close\.cited is for a green step only/);
  assert.match(reds(decl({ ...part(), source: 'elsewhere' }), { words: false }).join('\n'), /close\.cited\.source "elsewhere" is not one of the signed source roles/);
  assert.match(reds(decl(part()), { words: false }).length === 0 ? 'ok' : 'x', /ok/);
  assert.match(reds(decl(part()).steps ? decl(part(), { reads: [] }) : null, { words: false }).join('\n'), /not in steps\[0\]\.reads/);
  assert.match(reds(decl({ ...part(), extra: 1 }), { words: false }).join('\n'), /a fact part has no field "extra"/);
  const many = Array.from({ length: 11 }, (_, i) => ({ name: `phrase ${String.fromCharCode(97 + i)}`, shape: 'phrase', phrase: 'Nonstop' }));
  assert.match(reds(decl(part(many)), { words: false }).join('\n'), /needs 1 to 10 facts \(it has 11;/);
  assert.match(reds(decl(part(goodFacts(), { min: 3, max: 2 })), { words: false }).join('\n'), /the result count is \{min, max\}/);
});

test('an input the page-read never read (no look) is refused as unread: a check whose words were never proved is never drafted', () => {
  const r = reds(decl(part()), { look: null });
  assert.equal(r.length, 1, r.join('\n'));
  assert.match(r[0], /line 1: the input "flights" was not read here to prove the words against it/);
});

test('a green step with no cited facts and no spreadsheet is still refused (the cells rule), and one WITH cited facts is not', () => {
  const none = decl(undefined);
  delete none.steps[0].close.cited;
  assert.match(reds(none).join('\n'), /Line 1's check needs cells/);
  assert.deepEqual(reds(decl(part())), []);
});
