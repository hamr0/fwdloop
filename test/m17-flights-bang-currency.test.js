// borrowed-from: bareloop tests/checkblock-bang-result.test.js + tests/checkblock-currency-fallback.test.js@v0.57.0 (c18df406) (fd943e49, 637e76ad, fa942d5d, 60226a39), imports pointed at fwd's files, one fixture under test/fixtures/m16-block/flights-eur/
// M17 am1 1(c): fwdloop's own live run walk-m16-flights run-1 (a euro flights page, Madrid to Rome). Real CheckBlock, real saved page; no mock.
// A: a `!` phrase "Rome" on the page (search box, "Track prices" toggles) but in no result row is Not checked, never built.
// B: "under $150" against a euro price fact is Not checked, never the look's reading (lt 150) on euro prices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CheckBlock, renderCard } from '../src/checkblock.js';
import { dryReadPhrases, phraseInNoResult } from '../src/pagedry.js';

const TEXT = readFileSync(new URL('./fixtures/m16-block/flights-eur/flights-madrid-rome-eur.txt', import.meta.url), 'utf8');
const price = (/** @type {any} */ extra = {}) => ({ line: 2, name: 'price', shape: 'money', source: 'flights', words: ['From'], unit: ['euros'], currency: ['€'], forRule: 1, reading: { op: 'lt', value: 150 }, ...extra });
const make = (/** @type {string[]} */ rules, /** @type {any[]} */ facts, /** @type {any[]} */ edits = []) => {
  const b = new CheckBlock({ texts: { flights: TEXT }, labels: ['flights'], asks: false });
  b.fromJob([{ n: 1, text: 'Read the flights page', rules: [] }, { n: 2, text: 'list 3 flights from Madrid to Rome', rules }]);
  b.addLook(facts, []);
  const rec = edits.length ? b.applyDelta({ label: 'ai', edits }) : null;
  const close = b.reconcile();
  const allFacts = close.parts.flatMap((/** @type {any} */ p) => p.facts ?? []);
  return { b, rec, allFacts };
};
const OWN = ['must name the flights']; // F251: a line with no ~ rule of the person's holds no signable check, so a test of a built `!` row gives its line one
const add = (/** @type {string} */ w) => ({ op: 'add', line: 2, kind: 'phrase', name: w, words: [w] });

test('A: a `!` phrase on the page but in no result row is Not checked, with the look\'s own sentence', () => {
  const { b, allFacts } = make([], [price({ forRule: undefined, reading: undefined })], [add('Rome')]);
  const row = b.rows.find((r) => r.key === 'L2.phrase.rome');
  assert.equal(row?.state, 'not-checked');
  assert.equal(row?.reason, '"Rome" is on the page but in none of its results, so it is not checked.');
  assert.equal(allFacts.some((f) => f.phrase === 'Rome'), false);
});

test('A good case: a `!` phrase that IS in a result row still builds', () => {
  const { b, allFacts } = make(OWN, [price({ forRule: undefined, reading: undefined })], [add('Nonstop')]);
  assert.equal(b.rows.find((r) => r.key === 'L2.phrase.nonstop')?.state, 'built');
  assert.equal(allFacts.some((f) => f.phrase === 'Nonstop'), true);
});

test('A good case: with no money fact on the line the result rows are unknown, so nothing is guessed and Rome builds', () => {
  const { b } = make(OWN, [], [add('Rome')]);
  assert.equal(b.rows.find((r) => r.key === 'L2.phrase.rome')?.state, 'built');
});

test('A one owner: the sync read agrees with the look\'s own dry read (the real grader) on both the refused and the good phrase', async () => {
  const money = [price({ forRule: undefined, reading: undefined })];
  for (const w of ['Rome', 'Nonstop']) {
    const dry = await dryReadPhrases(TEXT, [...money, { line: 2, name: w, shape: 'phrase', words: [w], source: 'flights' }]);
    assert.equal(phraseInNoResult(TEXT, money, w), dry.dropped.length === 1, w);
  }
});

test('A Drop then Add: a ledger-suggested "Rome" re-Added from Suggested stays Not checked in the row, the card, signedRows() and the close', () => {
  const b = new CheckBlock({ texts: { flights: TEXT }, labels: ['flights'], asks: false });
  b.fromJob([{ n: 1, text: 'Read the flights page', rules: [] }, { n: 2, text: 'list 3 flights from Madrid to Rome', rules: [] }]);
  b.addLook([price({ forRule: undefined, reading: undefined })], []);
  b.reconcile();
  b.applyDelta({ label: 'pre:ledger-suggest', pre: true, edits: [{ op: 'add', line: 2, kind: 'phrase', name: 'Rome', words: ['Rome'], source: 'flights' }] });
  b.reconcile();
  b.rowChoice('L2.phrase.rome', 'drop');
  b.reconcile();
  b.rowChoice('L2.phrase.rome', 'add');
  const close = b.reconcile();
  const sentence = '"Rome" is on the page but in none of its results, so it is not checked.';
  const row = b.rows.find((r) => r.key === 'L2.phrase.rome');
  assert.equal(row?.state, 'not-checked');
  assert.equal(row?.reason, sentence);
  assert.equal(renderCard(b.rows).some((c) => c.key === 'L2.phrase.rome' && c.state === 'built'), false);
  const signed = b.signedRows().filter((r) => r.key === 'L2.phrase.rome');
  assert.equal(signed.some((r) => r.state === 'built'), false);
  assert.equal(close.parts.flatMap((/** @type {any} */ p) => p.facts ?? []).some((/** @type {any} */ f) => f.phrase === 'Rome'), false);
});

// /branch-review finding on 637e76ad: matchBang's money filter had `&&`/`||` ungrouped, so a source-carrying add ignored the line and money test.
test('A source-carrying add on a line with NO money fact builds, though another line has one; on the money line it is still refused', () => {
  const run = (/** @type {number} */ line) => {
    const b = new CheckBlock({ texts: { flights: TEXT }, labels: ['flights'], asks: false });
    b.fromJob([{ n: 1, text: 'Read the flights page', rule: OWN[0], rules: OWN }, { n: 2, text: 'list 3 flights from Madrid to Rome', rule: OWN[0], rules: OWN }]);
    b.addLook([price({ forRule: undefined, reading: undefined })], []);
    b.reconcile();
    b.applyDelta({ label: 'pre:ledger-suggest', pre: true, edits: [{ op: 'add', line, kind: 'phrase', name: 'Rome', words: ['Rome'], source: 'flights' }] });
    b.reconcile();
    return b.rows.find((r) => r.key === `L${line}.phrase.rome`);
  };
  assert.equal(run(1)?.state, 'built');
  assert.equal(run(2)?.state, 'not-checked');
});

test('B: "under $150" against a euro fact is Not checked, never the look\'s reading on euro prices', () => {
  const { b, allFacts } = make(['under $150'], [price()]);
  const row = b.rows.find((r) => r.kind === 'rule' && r.line === 2);
  assert.equal(row?.state, 'not-checked');
  assert.match(row?.reason ?? '', /another currency than the page/);
  assert.equal(allFacts.some((f) => f.name === 'price'), false);
});

test('B good case: a rule in the SAME currency as the fact still builds', () => {
  for (const rule of ['under 150 euros', 'under €150']) {
    const { allFacts } = make([rule], [price()]);
    assert.deepEqual(allFacts.find((f) => f.name === 'price')?.rule, { op: 'lt', value: 150 }, rule);
  }
});

// am1 Done-when: the flights job re-walk does not prove 'Rome' from the search box, and does not check euro prices against $150 (both on the one real page, one job)
test('Done-when: one job with "under $150" and a Rome suggestion on the euro page builds neither the Rome check nor a 150 price bound', () => {
  const { b, allFacts } = make(['under $150'], [price()], [add('Rome')]);
  assert.equal(b.rows.find((r) => r.key === 'L2.phrase.rome')?.state, 'not-checked');
  assert.equal(b.rows.find((r) => r.kind === 'rule' && r.line === 2)?.state, 'not-checked');
  assert.equal(allFacts.some((f) => f.phrase === 'Rome' || f.name === 'price'), false);
});

// Must-fail: a file copied from a bareloop branch instead of the tag
test('Must-fail: every file this piece copied names the released tag v0.57.0 (c18df406), never a branch', () => {
  for (const f of ['../src/pagedry.js', '../src/rubricstep.js', '../src/checkblock.js', './m17-flights-bang-currency.test.js']) {
    const lines = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => /^\/\/ borrowed-from: bareloop /.test(l) && l.includes('v0.57.0'));
    assert.ok(lines.length > 0, f);
    assert.ok(lines.every((l) => l.includes('(c18df406)')), f);
  }
});
