// borrowed-from: bareloop tests/time-label-colon.test.js@v0.57.0 (c18df406) (1583d563), adapted: fwd has no time dry read (dryReadTimes), so the test stops at the page rules and fwd's money dry read; the page is the real saved page of bareloop run mwgsl7zx, test/fixtures/m17-time-label-colon (sha256 d58e473d...)
// M17 am1 1(d): a label the page writes with a colon right after it ("Departure time: 10:24 AM.") is signed with that colon, whether the look gave it with or without.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyPageRules, withColon } from '../src/pagerules.js';
import { dryReadMoney } from '../src/pagedry.js';

const page = readFileSync(new URL('./fixtures/m17-time-label-colon/flights-mwgsl7zx.page.txt', import.meta.url), 'utf8');
const JOB = [{ n: 1, text: 'List 3 flights', rules: ['under $450', 'departure time between 05:00 and 21:59'] }];
/** @returns {any} */
const timeFact = (/** @type {string[]} */ words) => ({ name: 'departure time', shape: 'time', from: 'rule 2', words });
const kept = (/** @type {string} */ text, /** @type {any} */ fact) => applyPageRules(text, { facts: [fact] }, JOB).facts;

test('the real page writes "Departure time: 10:24 AM." and the fixture is the run page', () => {
  assert.equal(createHash('sha256').update(page).digest('hex'), 'd58e473d7247dc93b4fdbbb6d78bec6189c64c3f9757ad6e5c8cec47ba80d7a7');
  assert.match(page, /Departure time: 10:24 AM\./);
});

test('"Departure time" (no colon) is signed as the page writes it, the same word as "Departure time:", and nothing is dropped', () => {
  const without = applyPageRules(page, { facts: [timeFact(['Departure time'])] }, JOB);
  const withColon = applyPageRules(page, { facts: [timeFact(['Departure time:'])] }, JOB);
  assert.deepEqual(without.dropped, []);
  assert.deepEqual(without.facts[0].words, ['Departure time:']);
  assert.deepEqual(without.facts[0].words, withColon.facts[0].words);
});

test('withColon: every place has the colon -> colon; one bare place -> as given; a colon already there -> unchanged', () => {
  assert.equal(withColon('Price: $1\nPrice: $2\n', 'Price'), 'Price:');
  assert.equal(withColon('Price: $1\nPrice $2\n', 'Price'), 'Price');
  assert.equal(withColon('Price: $1\n', 'Price:'), 'Price:');
  assert.equal(withColon('no label here\n', 'Price'), 'Price');
});

test('a label followed by other words before the time keeps its form, and the colon word is not on that page', () => {
  const text = 'Departure time (local): 10:24 AM.\nDeparture time (local): 1:35 PM.\n';
  assert.deepEqual(kept(text, timeFact(['Departure time']))[0]?.words, ['Departure time']);
  assert.deepEqual(kept(text, timeFact(['Departure time:'])), [], 'the colon word is not on that page');
});

test('money: "Price" on a page that writes "Price: $120" is signed "Price:" and the dry read reads the amounts like "Price:"', async () => {
  const text = 'Flight A\nPrice: $120\nFlight B\nPrice: $166\n';
  const money = (/** @type {string[]} */ words) => ({ name: 'price', shape: 'money', from: 'rule 1', words, currency: ['$'] });
  const without = await dryReadMoney(text, kept(text, money(['Price'])));
  const withC = await dryReadMoney(text, kept(text, money(['Price:'])));
  assert.deepEqual(without.dropped, []);
  assert.ok(without.reads.price > 0);
  assert.equal(without.reads.price, withC.reads.price);
  assert.deepEqual(without.facts[0].words, withC.facts[0].words);
});
