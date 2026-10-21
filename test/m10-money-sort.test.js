// borrowed-from: bareloop tests/money-sort.test.js@c61d227 (adapted: our fixtures, our checker). M10 F241 port: code SORTS the AI's currency forms into
// the right box (a sign is a currency, anything else a unit); a word listed in both boxes keeps its r1l record. $0, no model.
// Real data: the saved Google Flights MAD->FCO page of flows/m10-walk-flights-2 (public page, no personal data), sha256 pinned.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyPageRules } from '../src/pagerules.js';
import { PAGE as AMS } from './fixtures/m10-map/load.mjs';

const madFco = (() => {
  const t = readFileSync(new URL('./fixtures/m10-money/mad-fco.page.txt', import.meta.url), 'utf8');
  const got = createHash('sha256').update(t).digest('hex');
  assert.equal(got, '9e9d2add454b880aa33a58ee401ae560bca66d8a13a4592fb448f8a36b50b85e', 'fixture changed');
  return t;
})();
const JOB = [{ n: 1, text: 'List 3 flights from Madrid to Rome', rule: 'under $150' }];
const said = (d) => d.map((x) => `${x.fact}|${x.word ?? '(fact)'}|${x.reason}`).sort();
const priceOf = (r) => r.facts.find((f) => f.shape === 'money');

test('MAD-FCO (our real failure): "$" and "US dollars" both listed as currency, label "From" -> "US dollars" is the unit, nothing dropped as currency-not-symbol', () => {
  const map = { facts: [{ name: 'price', from: 'rule 1', shape: 'money', words: ['From'], currency: ['$', 'US dollars'] }] };
  const kept = applyPageRules(madFco, map, JOB);
  const price = priceOf(kept);
  assert.ok(price, 'the price fact is kept');
  assert.ok(price.unit?.includes('US dollars'), JSON.stringify(price));
  assert.ok(!(price.currency ?? []).includes('US dollars'));
  assert.ok(!said(kept.dropped).some((s) => s.includes('currency-not-symbol')));
});

test('a currency that is a WORD is MOVED to the unit box, not dropped; one the page does not hold is dropped as not-on-page', () => {
  const map = { facts: [{ name: 'price', from: 'rule 1', shape: 'money', words: ['From'], currency: ['US dollars', 'zorkmids'] }] };
  const r = applyPageRules(AMS, map, JOB);
  assert.deepEqual(r.facts.map((f) => [f.words, f.unit, f.currency]), [[['From'], ['US dollars'], undefined]]);
  assert.deepEqual(said(r.dropped), ['price|zorkmids|not-on-page']);
});

test('a sign listed in the UNIT box goes to currency (the box is position, not the AI\'s pick); a word listed in currency goes to unit', () => {
  const map = { facts: [{ name: 'price', from: 'rule 1', shape: 'money', words: ['From'], unit: ['$'], currency: ['US dollars'] }] };
  const price = priceOf(applyPageRules(madFco, map, JOB));
  assert.deepEqual(price.unit, ['US dollars']);
  assert.deepEqual(price.currency, ['$']);
});

test('a word listed in BOTH boxes is one form, said once as r1l', () => {
  const map = { facts: [{ name: 'price', from: 'rule 1', shape: 'money', words: ['From'], unit: ['US dollars'], currency: ['US dollars'] }] };
  const r = applyPageRules(AMS, map, JOB);
  assert.deepEqual(priceOf(r).unit, ['US dollars']);
  assert.deepEqual(said(r.dropped), ['price|US dollars|r1l']);
});
