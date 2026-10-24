// A guardrail's number bound the page look read ("under $40" -> price under 40) must be carried by a fact of the cited close, or the plan is refused at $0.
// Shape taken from the 2026-10-24 walk (deepseek-flash): flights-learn-1 and m10-walk-flights-5 dropped the rule and run-1 passed $48 and $63;
// m10-walk-flights-4 kept it. The page text and the paths are scrubbed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { citedWordReds } from '../src/citedwords.js';

const TEXT = [
  'Prices shown in $ for one traveler.',
  'From 39 US dollars.This price does not include overhead bin access. Nonstop flight with Ryanair. Leaves Madrid Airport at 9:35 AM.',
  'From 48 US dollars.This price does not include overhead bin access. Nonstop flight with Vueling. Leaves Madrid Airport at 11:10 AM.',
  'From 63 US dollars.This price does not include overhead bin access. Nonstop flight with Iberia. Leaves Madrid Airport at 2:05 PM.',
].join('\n');
const JOB = { n: 2, text: 'list 3 flights from Madrid to Rome,', rule: 'under $40; nonstop' };
const look = (extra = {}) => ({
  facts: [
    {
      line: 2, name: 'price', shape: 'money', source: 'flights', words: ['From'], labels: ['From'], label: 'From', unit: ['US dollars'], currency: ['$'], forRule: 1, reading: { op: 'lt', value: 40 }, ...extra,
    },
    { line: 2, name: 'stops', shape: 'phrase', source: 'flights', words: ['Nonstop'], phrase: 'Nonstop', forRule: 2 },
  ],
  dropped: [],
});
const price = (rule) => ({ name: 'price', shape: 'money', anchor: 'From', unit: ['US dollars'], currency: ['$'], ...(rule ? { rule } : {}) });
const part = (p) => ({ source: 'flights', count: { min: 3, max: 3 }, facts: [p, { name: 'stops', shape: 'phrase', phrase: 'Nonstop' }] });
const run = (p, l = look()) => citedWordReds({ part: part(p), text: TEXT, line: 2, jobLine: JOB, look: l });

test('the flights-learn-1 shape (price with no rule under "under $40") is refused, naming line 2 and the $40 bound', () => {
  const r = run(price());
  const b = r.filter((x) => x.code === 'bound-missing');
  assert.equal(b.length, 1, JSON.stringify(r));
  assert.match(b[0].detail, /^line 2: /);
  assert.match(b[0].detail, /under 40 US dollars/);
  assert.match(b[0].detail, /"lt"/);
});

test('the flights-4 shape (the rule kept) passes', () => {
  assert.deepEqual(run(price({ op: 'lt', value: 40 })), []);
});

test('a guardrail with no bound needs no rule', () => {
  assert.deepEqual(run(price(), look({ reading: undefined })), []);
});

test('a bound the person never said is not demanded (an ask is forced for it, not a refusal)', () => {
  const r = run(price(), look({ reading: { op: 'lt', value: 75 } }));
  assert.deepEqual(r.filter((x) => x.code === 'bound-missing'), []);
});

test('a rule with another bound on the fact does not stand in for the read bound', () => {
  const r = run(price({ op: 'lt', value: 4 }));
  assert.ok(r.some((x) => x.code === 'bound-missing'), JSON.stringify(r));
});
