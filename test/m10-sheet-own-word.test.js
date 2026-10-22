// M10 live-walk bug (2026-10-21, flows/m10-walk-csv): the job rule was `~ Price over 500`, the sheet's header `Date,Description,Amount,Tax`. The sheet look named the
// word "Amount" (a real header, not the person's word) and code kept it, so nothing was asked and no `~` line was written: the MODEL chose the column in place of the
// person (signed item 4/7: asks are decided by code from the person's word). The word the look keeps must be the person's own. $0, synthetic sheet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sheetPrompt, applySheetWords, lookAtSheet } from '../src/sheetlook.js';
import { notCheckedLines } from '../src/pagelook.js';

const CSV = `${['Date,Description,Amount,Tax', ...Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')},Item ${i + 1},${600 + i}.50,${i < 3 ? `${i + 1}.25` : ""}`)].join('\n')}\n`;
const JOB = [
  { n: 1, text: 'Read the expenses sheet' },
  { n: 2, text: 'list every expense over 500', rules: ['Price over 500'] },
];
const ans = (/** @type {any[]} */ facts) => JSON.stringify({ facts });

test('the real case: the look named "Amount" for the rule "Price over 500" - the person\'s word is not a word of the job, so it is NOT kept; Not checked says why', () => {
  const r = applySheetWords(CSV, [{ from: 'line 2 rule 1', word: 'Amount', kind: 'number' }], JOB, 'expenses');
  assert.deepEqual(r.facts, [], 'the model\'s word is not kept as a column');
  assert.deepEqual(r.asks, []);
  assert.deepEqual(notCheckedLines(r.dropped, JOB), ["line 2: \"Price over 500\" — the sheet look named 'Amount', which is not a word in your job, so it was not used."]);
});

test('the person\'s own word "Price" (named by the look) asks once in the signed words', () => {
  const r = applySheetWords(CSV, [{ from: 'line 2 rule 1', word: 'Price', kind: 'number' }], JOB, 'expenses');
  assert.equal(r.asks.length, 1);
  assert.equal(r.asks[0].question, `no column 'Price'; 'Amount' has numbers in 12 of 12 rows. Use it? Answer "agree", or type your own words (your answer is added as a new ~ rule on line 2).`);
});

test('a header the person did say is kept, case aside, with no ask', () => {
  const lines = [{ n: 2, text: 'list every expense over 500', rules: ['amount over 500'] }];
  const r = applySheetWords(CSV, [{ from: 'line 2 rule 1', word: 'Amount', kind: 'number' }], lines, 'expenses');
  assert.deepEqual([r.asks.length, r.dropped.length, r.facts.map((f) => f.column)], [0, 0, ['Amount']]);
});

test('the prompt asks for the job\'s own word as the job writes it, and no longer invites the model to copy a column name in its place', () => {
  const p = sheetPrompt({ jobLines: JOB, label: 'expenses', text: CSV });
  assert.ok(!p.includes("copy that column's name"), p);
  assert.match(p, /exactly as the job writes it/);
});

test('through the look: a model that answers "Amount" gets no fact and no ask, but a Not-checked line', async () => {
  const r = await lookAtSheet({ label: 'expenses', text: CSV, jobLines: JOB, callModel: async () => ({ text: ans([{ from: 'line 2 rule 1', word: 'Amount', kind: 'number' }]) }) });
  assert.equal(r.ok, true);
  assert.deepEqual([r.facts.length, r.asks.length, r.dropped.length], [0, 0, 1]);
});
