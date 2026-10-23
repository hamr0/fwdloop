// borrowed-from: bareloop tests/phrase-dry.test.js@c550dc8 (adapted: our checker, our fixtures). M10 phrase dry read: our real failure is
// flows/m10-walk-flights-3 run-1: the phrase "Rome" is on the page 3 times, only in a combobox and two 'Track prices from Madrid to Rome' switches,
// in 0 of the 18 result lines ('link "From ..."'). Real data: the saved public Google Flights MAD->FCO page (no personal data), sha256 pinned. $0, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dryReadMoney, dryReadPhrases, moneyResultLines } from '../src/pagedry.js';
import { dropSentence, dropRows } from '../src/pagedropwords.js';
import { lookAtPage } from '../src/pagelook.js';

const load = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const flights3 = (() => {
  const t = load('./fixtures/m10-money/mad-fco-3.page.txt');
  assert.equal(createHash('sha256').update(t).digest('hex'), 'cf352b06b3accc8c3500f0aeb51d1d41a65129e7be88b0ce9ff0f75e80987b69', 'fixture changed');
  return t;
})();
const bcn = load('./fixtures/m10-phrase/mad-bcn.page.txt');
/** @type {any} */
const price = { line: 1, name: 'price', shape: 'money', from: 'rule 1', words: ['From'], unit: ['US dollars'] };
/** @param {string} name @param {string} word @returns {any} */
const phrase = (name, word) => ({ line: 1, name, shape: 'phrase', from: '', words: [word] });
const JOB = [{ n: 1, text: 'List 3 flights from Madrid to Rome', rule: 'under $150' }];
const FLIGHTS3 = [
  { name: 'destination city', from: 'rule 1', shape: 'phrase', words: ['Rome'] },
  { name: 'nonstop', from: 'rule 1', shape: 'phrase', words: ['Nonstop'] },
  { name: 'departure airport', from: 'rule 1', shape: 'phrase', words: ['Leaves Adolfo Suárez Madrid-Barajas Airport'] },
  { name: 'arrival airport', from: 'rule 1', shape: 'phrase', words: ['arrives at Leonardo da Vinci International Airport'] },
  { name: 'price label', from: 'rule 1', shape: 'money', words: ['From'], unit: ['US dollars'], currency: ['$'] },
];

test('fixture shape: 18 result lines, "Rome" on 3 lines and on none of them', () => {
  const lines = bcn.split('\n');
  assert.equal(lines.filter((l) => /From \d+ US dollars/.test(l)).length, 18);
  assert.equal(lines.filter((l) => l.includes('Rome')).length, 3);
  assert.equal(lines.filter((l) => l.includes('Rome') && /From \d+ US dollars/.test(l)).length, 0);
  const f3 = flights3.split('\n');
  assert.equal(f3.filter((l) => l.includes('link "From ')).length, 18);
  assert.equal(f3.filter((l) => l.includes('Rome')).length, 3);
  assert.equal(f3.filter((l) => l.includes('Rome') && l.includes('link "From ')).length, 0);
});

test('a phrase found only outside the result lines is dropped as a whole fact, in plain words, and stays Not checked', async () => {
  const money = await dryReadMoney(bcn, [price, phrase('destination city', 'Rome')]);
  assert.equal(money.reads.price, 18);
  const r = await dryReadPhrases(bcn, money.facts);
  assert.deepEqual(r.facts.map((f) => f.name), ['price']);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].reason, 'phrase-no-result');
  assert.equal(r.dropped[0].fact, 'destination city');
  assert.equal(r.reads['destination city'], 0);
  assert.equal(dropSentence(r.dropped[0]), '"Rome" is on the page but in none of its results, so it is not checked.');
  const row = dropRows(r.dropped)[0];
  assert.equal(row.full, true);
});

test('a phrase that IS in the result lines is kept', async () => {
  const r = await dryReadPhrases(bcn, [price, phrase('origin city', 'Madrid')]);
  assert.deepEqual(r.facts.map((f) => f.name), ['price', 'origin city']);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.reads['origin city'], 18);
});

test('no kept money fact: the result lines are unknown, so a phrase fact passes through untouched', async () => {
  const r = await dryReadPhrases(bcn, [phrase('destination city', 'Rome')]);
  assert.deepEqual(r.facts.map((f) => f.name), ['destination city']);
  assert.deepEqual(r.dropped, []);
});

test('MAD-FCO (our real failure, flights-3 signed facts) through lookAtPage: "Rome" is Not checked; Nonstop, both airports and the price are kept', async () => {
  const r = await lookAtPage({ label: 'flights', text: flights3, jobLines: JOB, callModel: async () => ({ text: JSON.stringify({ facts: FLIGHTS3 }) }) });
  assert.ok(r.ok);
  assert.deepEqual(r.look.facts.map((f) => f.name).sort(), ['arrival airport', 'departure airport', 'nonstop', 'price label']);
  assert.deepEqual(r.look.dropped.filter((d) => d.reason === 'phrase-no-result').map((d) => [d.fact, d.other, d.source]), [['destination city', 'Rome', 'flights']]);
  assert.ok(r.notChecked.some((l) => l.includes('"Rome" is on the page but in none of its results')), r.notChecked.join('|'));
});

test('lookAtPage with no money fact: every phrase (Rome too) is left as it was', async () => {
  const r = await lookAtPage({ label: 'flights', text: flights3, jobLines: JOB, callModel: async () => ({ text: JSON.stringify({ facts: FLIGHTS3.filter((f) => f.shape === 'phrase') }) }) });
  assert.ok(r.ok);
  assert.ok(r.look.facts.some((f) => f.name === 'destination city'));
  assert.ok(!r.look.dropped.some((d) => d.reason === 'phrase-no-result'));
});

test('moneyResultLines reads the number before a unit in linear time: a 20000 x "1," line then "x EUR" returns well under a second (the backtracking regex took seconds)', () => {
  const fact = { line: 1, name: 'price', shape: 'money', from: 'rule 1', words: [], unit: ['EUR'] };
  const t0 = performance.now();
  assert.deepEqual(moneyResultLines('1,'.repeat(20000) + 'x EUR', fact), []);
  assert.deepEqual(moneyResultLines('Total 1,234.50 EUR', fact).map((r) => r.value), ['1234.50']);
  assert.ok(performance.now() - t0 < 1000, `took ${performance.now() - t0} ms`);
});
