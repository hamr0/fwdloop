// M10 amendment 7 item 2 (docs/wiki/the-module-ladder.md): a PLACE word grows left to take in its role word (R2, R2a, R2b) and every grown phrase must be in the
// quote (R2c), so a flipped route goes red. $0, F71's real saved page and its three real map answers (FINDINGS F72 is the pre-registered run these cases repeat
// in the product's own code). Each must-fail case below was seen red first; the commit names how.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMapAnswer } from '../src/pagemap.js';
import { applyPageWords, lookFactOf } from '../src/pagelook.js';
import { placePhrases } from '../src/pageplace.js';
import { checkCited, factPartFromLook, factsOfLook } from '../src/citedcheck.js';
import { PAGE, CHEAT_REVERSED, raw, JOB } from './fixtures/m10-map/load.mjs';
import { FIXTURE_DIR } from './fixtures/m10-map/load.mjs';
import { readFileSync } from 'node:fs';

const PAY0 = readFileSync(`${FIXTURE_DIR}/page-ams-lhr.cheat-pay0.txt`, 'utf8');
const swap = (s) => s.replace(/Amsterdam Airport Schiphol/g, '\u0001').replace(/Heathrow Airport/g, 'Amsterdam Airport Schiphol').replace(/\u0001/g, 'Heathrow Airport');
/** F-ii-b of F72: the swap made on EVERY line of the page, quotes and source both */
const FLIPPED_EVERYWHERE = PAGE.split('\n').map(swap).join('\n');
/** the 19 result link lines of a page: each is one flight's own quote */
const quotes = (t) => t.split('\n').map((l) => /^\s*- link "(.*Select flight)"/.exec(l)).filter(Boolean).map((m) => m[1]);

/** the kept facts of one saved F71 draft's map, as the look carries them */
function keptOf(n) {
  const p = parseMapAnswer(raw(n));
  assert.equal(p.ok, true);
  return applyPageWords(PAGE, /** @type {any} */ (p).mapping, JOB).facts.map((f) => lookFactOf(f, 'flights'));
}
/** a part with ONLY the place facts, so a result can go red for a place and nothing else */
const placeOnly = (n, { grow = true } = {}) => {
  const places = keptOf(n).filter((k) => k.phrases !== undefined);
  return factPartFromLook(places.map((k) => (grow ? k : { ...k, phrases: placePhrases(PAGE, k.words, { grow: false }).phrases })), 'flights');
};
const greens = async (part, text, qs) => {
  let g = 0;
  for (const q of qs) if ((await checkCited({ part, text, results: [{ quote: q, values: {} }] })).verdict === 'green') g += 1;
  return g;
};

test('a place word grows to its role word; a word another phrase contains, or that shares under 90% of its lines, is dropped and said', () => {
  const one = placePhrases(PAGE, ['Amsterdam', 'AMS', 'Amsterdam Airport Schiphol']);
  assert.deepEqual(one.phrases, ['Leaves Amsterdam Airport Schiphol']);
  assert.ok(one.trace.some((t) => t.startsWith('R2a drop "Leaves Amsterdam" in "Leaves Amsterdam Airport Schiphol"')), one.trace.join('|'));
  assert.ok(one.trace.some((t) => t.startsWith('R2b drop "AMS" 0%')), one.trace.join('|'));
  assert.ok(one.notes.length > 0, 'growth that stops says why');
  assert.deepEqual(placePhrases(PAGE, ['London', 'LHR', 'Heathrow Airport']).phrases, ['arrives at Heathrow Airport']);
  assert.deepEqual(placePhrases(PAGE, []).phrases, []);
  assert.deepEqual(placePhrases(PAGE, ['Heathrow Airport'], { grow: false }).phrases, ['Heathrow Airport']);
});

test('all three saved F71 drafts sign the same two grown phrases (the first kept word was on no result line in two of them)', () => {
  for (const n of [1, 2, 3]) {
    const part = placeOnly(n);
    assert.deepEqual(part.facts.map((f) => f.phrase).sort(), ['Leaves Amsterdam Airport Schiphol', 'arrives at Heathrow Airport'], `draft ${n}`);
    assert.ok(part.facts.every((f) => f.shape === 'phrase'));
  }
});

test('honest results are green and the flipped route is red, for each of the 3 drafts (F72: 57 of 57 and 0 of 114)', async () => {
  for (const n of [1, 2, 3]) {
    const part = placeOnly(n);
    assert.equal(quotes(PAGE).length, 19);
    assert.equal(await greens(part, PAGE, quotes(PAGE)), 19, `draft ${n} honest`);
    assert.equal(await greens(part, CHEAT_REVERSED, quotes(CHEAT_REVERSED)), 0, `draft ${n} flipped on the link lines`);
    assert.equal(await greens(part, FLIPPED_EVERYWHERE, quotes(FLIPPED_EVERYWHERE)), 0, `draft ${n} flipped on every line`);
  }
});

test('the control: the same phrases WITHOUT growth let the flipped route through, so growth is what catches it', async () => {
  for (const n of [1, 2, 3]) {
    const part = placeOnly(n, { grow: false });
    assert.deepEqual(part.facts.map((f) => f.phrase).sort(), ['Amsterdam Airport Schiphol', 'Heathrow Airport']);
    assert.equal(await greens(part, PAGE, quotes(PAGE)), 19, `draft ${n} honest`);
    assert.equal(await greens(part, CHEAT_REVERSED, quotes(CHEAT_REVERSED)), 19, `draft ${n} flip passes without R2`);
    assert.equal(await greens(part, FLIPPED_EVERYWHERE, quotes(FLIPPED_EVERYWHERE)), 19);
  }
});

test('the old choice (the first kept word) could not go green on honest results in 2 of 3 drafts: the words were on no result line', () => {
  const firstWord = (n) => keptOf(n).filter((k) => k.phrases !== undefined).map((k) => k.words[0]).sort();
  assert.deepEqual(firstWord(1), ['Amsterdam', 'London']);
  assert.deepEqual(firstWord(2), ['AMS', 'LHR']);
  const lines = PAGE.split('\n').filter((l) => l.includes('Select flight'));
  assert.ok(lines.every((l) => !l.includes('London') && !l.includes('LHR') && !l.includes('AMS')));
});

test('the cheats of piece 4 stay red with R2 on: "Pay $0" copy, and a quote that is not on the page', async () => {
  const price = { name: 'price', shape: 'money', words: ['From'], labels: ['From'], unit: ['US dollars'], reading: { op: 'lt', value: 150 } };
  const part = factPartFromLook([...keptOf(3).filter((k) => k.phrases !== undefined), price], 'flights');
  const honest = [];
  for (const q of quotes(PAGE)) {
    const m = /^From\s+(\d+)/.exec(q);
    honest.push((await checkCited({ part, text: PAGE, results: [{ quote: q, values: { price: m[1] } }] })).verdict);
  }
  assert.equal(honest.filter((v) => v === 'green').length, quotes(PAGE).filter((q) => Number(/^From\s+(\d+)/.exec(q)[1]) < 150).length, 'the honest rows under 150 are green, the rest red');
  let pay = 0;
  for (const q of quotes(PAY0)) pay += (await checkCited({ part, text: PAY0, results: [{ quote: q, values: { price: '0' } }] })).verdict === 'green' ? 1 : 0;
  assert.equal(pay, 0, 'Pay $0 rows are never green');
  const invented = 'From 99 US dollars. Nonstop flight with Imaginary Air. Leaves Amsterdam Airport Schiphol at 9:00 AM and arrives at Heathrow Airport at 9:20 AM. Select flight';
  assert.notEqual((await checkCited({ part, text: PAGE, results: [{ quote: invented, values: { price: '99' } }] })).verdict, 'green');
});

test('R2c at the limit: a place with 2 phrases is 2 facts, and past 10 facts the check is refused by name - nothing is dropped to fit', async () => {
  const k = (name, phrases) => ({ name, shape: 'phrase', words: [phrases[0]], phrases });
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => k(`place ${n}`, ['Leaves Amsterdam Airport Schiphol', 'arrives at Heathrow Airport']));
  assert.deepEqual(factsOfLook(six[0]).map((f) => f.name), ['place a a', 'place a b']);
  const part = factPartFromLook(six, 'flights');
  assert.equal(part.facts.length, 12, 'every phrase is a fact: none was dropped to make the part fit');
  const r = await checkCited({ part, text: PAGE, results: [{ quote: quotes(PAGE)[0], values: {} }] });
  assert.equal(r.verdict, 'stopped');
  assert.match(r.fault, /needs 1 to 10 facts \(it has 12;/);
  const five = factPartFromLook(six.slice(0, 5), 'flights');
  assert.equal(five.facts.length, 10);
  assert.equal((await checkCited({ part: five, text: PAGE, results: [{ quote: quotes(PAGE)[0], values: {} }] })).verdict, 'green', 'ten facts is the limit and is allowed');
});
