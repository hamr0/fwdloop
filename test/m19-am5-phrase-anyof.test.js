// M19 amendment 5 (docs/wiki/the-module-ladder.md): a page phrase fact with several words checks any one of them, on word edges. One test per "Must fail when" line,
// each run through the real closer (checkCited, bareguard 0.37.0). $0, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCited, factsOfLook, factBrief, factSentence, factPartReds } from '../src/citedcheck.js';
import { lookFactOf } from '../src/pagelook.js';

const AIR = ['United', 'JetBlue', 'Delta', 'American', 'Frontier'];
const PAGE = ['United 8:00 AM nonstop $120', 'JetBlue 1 stop $99', 'Delta Air Lines Nonstop $140', 'Reunited Tours 7:00 AM $50', 'Other line with nothing'].join('\n');
const airline = () => ({ source: 'p', facts: [{ name: 'airline name', shape: 'phrase', anyOf: AIR }] });
const run = (part, quote) => checkCited({ part, text: PAGE, results: [{ quote, values: {} }] });

test('Must fail 1: a several-word phrase look fact signs all its words, not the first (a one-word fact signs phrase as before)', () => {
  const look = lookFactOf({ line: 1, name: 'airline name', shape: 'phrase', words: [...AIR] }, 'p');
  assert.deepEqual(factsOfLook(look), [{ name: 'airline name', shape: 'phrase', anyOf: AIR }]);
  const one = lookFactOf({ line: 1, name: 'stop count', shape: 'phrase', words: ['Nonstop'] }, 'p');
  assert.deepEqual(factsOfLook(one), [{ name: 'stop count', shape: 'phrase', phrase: 'Nonstop' }]);
  assert.deepEqual(factPartReds({ source: 'p', facts: factsOfLook(look) }), []);
});

test('Must fail 2: a quote holding only a later word is green, also a word with a digit, with no unsupported-number red', async () => {
  const a = await run(airline(), 'JetBlue 1 stop $99');
  assert.equal(a.verdict, 'green', a.gapLines.join('|'));
  const stops = { source: 'p', facts: [{ name: 'stop count', shape: 'phrase', anyOf: ['Nonstop', '1 stop'] }] };
  const b = await run(stops, 'JetBlue 1 stop $99');
  assert.equal(b.verdict, 'green', b.gapLines.join('|'));
  assert.ok(!b.gapLines.some((l) => /number/.test(l)));
});

test('Must fail 3: a quote holding none of the words is red, in the signed words', async () => {
  const r = await run(airline(), 'Other line with nothing');
  assert.equal(r.verdict, 'red');
  assert.ok(r.gapLines.some((l) => l.endsWith('the quote says none of "United", "JetBlue", "Delta", "American", "Frontier"')), r.gapLines.join('|'));
  const edge = await run(airline(), 'Reunited Tours 7:00 AM $50');
  assert.equal(edge.verdict, 'red', 'word edges: "United" is not in "Reunited"');
});

test('Must fail 4: a one-word fact checks exactly as today (all-of substring decide, same field shape)', async () => {
  const part = { source: 'p', facts: [{ name: 'airline name', shape: 'phrase', phrase: 'United' }] };
  assert.equal((await run(part, 'Reunited Tours 7:00 AM $50')).verdict, 'green', 'substring, as today');
  const red = await run(part, 'JetBlue 1 stop $99');
  assert.equal(red.verdict, 'red');
  assert.ok(red.gapLines.some((l) => l.includes('the quote does not say "United"')));
});

test('Must fail 5: a place fact (one fact per phrase) stays all-of: one phrase missing is red', async () => {
  const k = { line: 1, name: 'route', shape: 'phrase', words: ['x'], phrases: ['United', 'Delta'] };
  const facts = factsOfLook(k);
  assert.equal(facts.length, 2);
  assert.ok(facts.every((f) => f.phrase !== undefined && f.anyOf === undefined));
  const text = 'United to Delta\nUnited only';
  const g = await checkCited({ part: { source: 'p', facts }, text, results: [{ quote: 'United only', values: {} }] });
  assert.equal(g.verdict, 'red');
});

test('the step and the rows are told the signed words', () => {
  const f = airline().facts[0];
  assert.equal(factBrief(f), 'airline name - no value to write; the quote you copy must say one of: "United", "JetBlue", "Delta", "American", "Frontier"');
  assert.equal(factSentence(f, 'p'), 'fact "airline name" with one of the words "United", "JetBlue", "Delta", "American", "Frontier"');
});

test('an unsignable word never signs a narrower check or goes green: the closer stops, naming it', async () => {
  const part = { source: 'p', facts: [{ name: 'airline name', shape: 'phrase', anyOf: ['United', '-x'] }] };
  const r = await run(part, 'United 8:00 AM nonstop $120');
  console.log('edges-unsignable:', r.verdict, r.fault);
  assert.notEqual(r.verdict, 'green');
});

test('an unsignable word is refused at draft time too (the shape check), never signed', () => {
  const reds = factPartReds({ source: 'p', facts: [{ name: 'airline name', shape: 'phrase', anyOf: ['United', '-x'] }] });
  assert.ok(reds.some((r) => r.includes('"-x" must start and end with a letter or digit')), reds.join('|'));
});

test('the draft-time trial check (rubricStepShapeReds, the one checkblock signs through) refuses it too', async () => {
  const { rubricStepShapeReds } = await import('../src/rubricstep.js');
  const reds = rubricStepShapeReds({ step: 1, parts: [{ text: 't', class: 'fact', source: 'p', facts: [{ name: 'airline name', shape: 'phrase', anyOf: ['United', '-x'] }] }] }, 'trial');
  assert.ok(reds.length > 0);
});
