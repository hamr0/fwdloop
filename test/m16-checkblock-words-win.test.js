// borrowed-from: bareloop tests/checkblock-words-win.test.js@v0.56.0 (3383cce + f148028e for the agree-follower tests), imports pointed at fwd's files, fixtures under test/fixtures/m16-block/
// hamr 2026-11-13 ruling A (live draft session smwe2qz5g3xrq): "~ under $450" ended as at most 450 because the look's reading beat the person's words. The person's words win whenever code can read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckBlock } from '../src/checkblock.js';

const PAGE = 'Flights\nFrom $389 US dollars\nFrom $431 US dollars\nLeaves Boston at 07:30\nLeaves Boston at 12:10\n';
const price = (/** @type {any} */ reading) => ({ line: 1, name: 'price', shape: 'money', source: 'flights', words: ['From'], unit: ['US dollars'], currency: ['$'], decimal: '.', forRule: 1, ...(reading ? { reading } : {}) });
const time = (/** @type {any} */ reading) => ({ line: 1, name: 'departure time', shape: 'time', source: 'flights', words: ['Leaves Boston at'], lang: 'en', forRule: 1, ...(reading ? { reading } : {}) });
const build = (/** @type {string} */ rule, /** @type {any} */ fact, /** @type {any[]} */ edits = []) => {
  const b = new CheckBlock({ texts: { flights: PAGE }, labels: ['flights'], asks: false });
  b.fromJob([{ n: 1, text: 'List flights', rules: [rule] }]);
  b.addLook([fact]);
  const rec = edits.length ? b.applyDelta({ label: 'ai', edits }) : null;
  const close = b.reconcile();
  const f = close.parts.flatMap((/** @type {any} */ p) => p.facts ?? []).find((/** @type {any} */ x) => x.name === fact.name);
  return { b, rec, f };
};

test('(a) look wrote at most 450, the person wrote "under $450": the fact is lt 450', () => {
  assert.deepEqual(build('under $450', price({ op: 'lte', value: 450 })).f.rule, { op: 'lt', value: 450 });
});

test('(b) the look\'s time window differs from the person\'s words: the person\'s window', () => {
  assert.deepEqual(build('departure between 06:00 and 20:00', time({ op: 'between', lo: '05:00', hi: '21:59' })).f.rule, { op: 'between', lo: '06:00', hi: '20:00' });
});

test('(c) an AI reading edit that disagrees with readable words is refused alone; an identical one and other edits stay', () => {
  const edits = [
    { op: 'reading', line: 1, rules: [1], fact: 'price', reading: { op: 'lte', value: 450 } },
    { op: 'add', line: 1, kind: 'count', min: 2, max: 2 },
  ];
  const { rec, f } = build('under $450', price(), edits);
  assert.equal(rec?.edits[0].accepted, false);
  assert.match(rec?.edits[0].refusedBecause, /code reads your words/);
  assert.equal(rec?.edits[1].accepted, true);
  assert.deepEqual(f.rule, { op: 'lt', value: 450 });
  const same = build('under $450', price(), [{ op: 'reading', line: 1, rules: [1], fact: 'price', reading: { op: 'lt', value: 450 } }]);
  assert.equal(same.rec?.edits[0].accepted, true);
});

test('(d) words code cannot read: the look\'s reading is used as before (asked, never silently built); no look reading stays Not checked', () => {
  const withLook = build('cheap enough', price({ op: 'lt', value: 450 }));
  assert.equal(withLook.b.open.length, 0, 'asks:false builds the AI proposal');
  assert.deepEqual(withLook.f.rule, { op: 'lt', value: 450 });
  const none = build('cheap enough', price());
  assert.equal(none.f, undefined);
  assert.equal(none.b.rows.find((r) => r.kind === 'rule')?.state, 'not-checked');
});
