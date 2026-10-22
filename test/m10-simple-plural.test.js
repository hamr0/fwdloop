// hamr's ruling 2026-10-21 ("A"): a simple plural matches. The person writes "amounts", the sheet's column is "Amount" - it is the person's own word, and the
// column is found. Standing rule: an unspecified form is fine; only what a guardrail names is strict. A different word (a longer one, a suffix) still does not
// match. $0, synthetic sheet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySheetWords, applyDocWords } from '../src/sheetlook.js';
import { wordForms } from '../src/pagebits.js';

const CSV = 'Date,Amount,Tax,Category\n2026-09-01,600.50,1.25,Food\n2026-09-02,700.50,2.25,Fuel\n';
const line = (rule) => [{ n: 2, text: 'list every expense', rules: [rule] }];
const word = (w) => [{ from: 'line 2 rule 1', word: w, kind: 'number' }];
const kept = (r) => [r.facts.map((f) => f.column), r.asks.length, r.dropped.length];

test('wordForms: the word, its simple plural or singular, nothing wider', () => {
  assert.deepEqual([...wordForms('Amount')].sort(), ['amount', 'amounts']);
  assert.ok(wordForms('amounts').includes('amount'));
  assert.ok(wordForms('Tax').includes('taxes') && wordForms('taxes').includes('tax'));
  assert.ok(wordForms('category').includes('categories') && wordForms('categories').includes('category'));
  assert.ok(!wordForms('amount').includes('amounted'));
});

test('the person says "amounts"; the look names the header "Amount": it is the person\'s own word, kept, nothing asked', () => {
  assert.deepEqual(kept(applySheetWords(CSV, word('Amount'), line('amounts over 500'), 'expenses')), [['Amount'], 0, 0]);
});

test('the person says "amount"; the look gives the plural "amounts" and the sheet has the header "Amount": found, not asked', () => {
  assert.deepEqual(kept(applySheetWords(CSV, word('amounts'), line('amount over 500'), 'expenses')), [['Amount'], 0, 0]);
});

test('"taxes" and "categories" find the headers "Tax" and "Category"', () => {
  assert.deepEqual(kept(applySheetWords(CSV, word('Tax'), line('taxes under 5'), 'expenses')), [['Tax'], 0, 0]);
  assert.deepEqual(kept(applySheetWords(CSV, word('Category'), line('categories are right'), 'expenses')), [['Category'], 0, 0]);
});

test('only a simple plural matches: "amounted" is not the person\'s word "Amount"', () => {
  const r = applySheetWords(CSV, word('Amount'), line('amounted to over 500'), 'expenses');
  assert.deepEqual(kept(r), [[], 0, 1]);
  assert.equal(r.dropped[0].reason, 'word-not-yours');
});

test('a .docx heading is found by its simple plural too', () => {
  const r = applyDocWords(['Skills', 'Summary'], [{ from: 'line 2 rule 1', word: 'skill', kind: 'other' }], line('a skill section'), 'cv');
  assert.deepEqual([r.facts.map((f) => f.column), r.dropped.length], [['Skills'], 0]);
});
