// M10 live-walk bug (2026-10-21, flows/m10-walk-flights run-1): the step quoted the page word for word and wrote values.price = "30 US dollars" (the page's own
// form), and bareguard reds a money value that is not the bare digits ("30") as claim-value-malformed on every try. The real frozen page, the real signed fact
// part and the real model output are in test/fixtures/m10-walk-flights. $0, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkCited, citedBrief, plainFactItem } from '../src/citedcheck.js';

const DIR = new URL('./fixtures/m10-walk-flights/', import.meta.url);
const PAGE = readFileSync(new URL('flights.txt', DIR), 'utf8');
const { part, modelOutput } = JSON.parse(readFileSync(new URL('real.json', DIR), 'utf8'));
const withPrice = (/** @type {(p: string) => string} */ f) => modelOutput.results.map((/** @type {any} */ r) => ({ ...r, values: { ...r.values, price: f(r.values.price) } }));
const bare = (/** @type {string} */ p) => /^\d+/.exec(p)?.[0] ?? '';

test('the step is told, in the answer form, to write only the digits of a money amount', () => {
  const a = citedBrief(part).answer;
  assert.match(a, /money value is only the digits/i, a);
  assert.match(a, /not "30 US dollars"/, a);
  // a part with no money fact is not told it
  const noMoney = { ...part, facts: part.facts.filter((/** @type {any} */ f) => f.shape !== 'money') };
  assert.doesNotMatch(citedBrief(noMoney).answer, /digits/);
});

test('the real page, the real signed part and the bare amounts the brief asks for are green; the page\'s own written form stays red and the refusal names the form', async () => {
  const good = await checkCited({ part, text: PAGE, results: withPrice(bare) });
  assert.equal(good.verdict, 'green', good.gapLines.join(' | '));
  const own = await checkCited({ part, text: PAGE, results: modelOutput.results });
  assert.equal(own.verdict, 'red');
  assert.ok(own.gapLines.every((l) => /write only the digits of the amount \(for example 30\), no unit or sign/.test(l)), own.gapLines.join(' | '));
});

test('a lie stays red on the real page', async () => {
  const lie = await checkCited({ part, text: PAGE, results: withPrice((p) => (bare(p) === '30' ? '10' : bare(p))) });
  assert.equal(lie.verdict, 'red');
  assert.ok(lie.gapLines.some((l) => l.includes('the value is not what the quote holds')), lie.gapLines.join(' | '));
  const fact = part.facts.find((/** @type {any} */ f) => f.name === 'price');
  assert.match(plainFactItem('#0:d2:claim-value-malformed', { facts: part.facts }), /write only the digits/);
  assert.equal(fact.shape, 'money');
  assert.doesNotMatch(plainFactItem('#0:d0:claim-value-malformed', { facts: part.facts }), /digits/, 'a phrase/other fact keeps the plain line');
});
