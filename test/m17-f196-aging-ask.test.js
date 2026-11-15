// F196 live bug (practice walk, draft d-00mwhvggz9-4fbe): line 2 of the aging job has the prose word "days past due" and a `~` rule 3 that names 'Due date'.
// The look asked twice about 'days past due' (once for the prose, once replacing rule 3) and said "added as a new ~ rule". $0: the real sheet, the look's words as the walk had them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { applySheetWords } from '../src/sheetlook.js';

const CSV = readFileSync(new URL('../fixtures/ar-aging.csv', import.meta.url), 'utf8');
const JOB = [
  { n: 1, text: 'Read the aging report' },
  { n: 2, text: 'For each invoice, work out the days past due as of 2026-10-11 and put it in its bucket: Current, 1-30, 31-60, 61-90, 90+', rules: ['every invoice appears exactly once', 'each invoice is in one bucket', "days past due = days since 'Due date' as of 2026-10-11"] },
];
const WORDS = [
  { from: 'line 2', word: 'invoice', kind: /** @type {const} */ ('other') },
  { from: 'line 2 rule 1', word: 'invoice', kind: /** @type {const} */ ('other') },
  { from: 'line 2 rule 3', word: 'Due date', kind: /** @type {const} */ ('other') },
  { from: 'line 2', word: 'days past due', kind: /** @type {const} */ ('number') },
  { from: 'line 2 rule 3', word: 'days past due', kind: /** @type {const} */ ('number') },
];

test('F196: a rule that names a header settles its words, and the prose word of that line is not asked either (no question at all)', () => {
  const r = applySheetWords(CSV, WORDS, JOB, 'aging');
  assert.deepEqual(r.asks, [], 'rule 3 names Due date: nothing is asked about days past due, from the rule or the prose');
  assert.deepEqual(r.facts.map((f) => [f.line, f.forRule, f.column]), [[2, 3, 'Due date']]);
});

test('F196 fault 2: with no header in the rule, a word in a rule and in the prose is asked once, by the rule (it replaces that rule)', () => {
  const job = [JOB[0], { ...JOB[1], rules: ['days past due is under 30'] }];
  const r = applySheetWords(CSV, [WORDS[3], { from: 'line 2 rule 1', word: 'days past due', kind: 'number' }], job, 'aging');
  assert.equal(r.asks.length, 1);
  assert.equal(r.asks[0].rule, 1);
  assert.match(r.asks[0].question, /your answer replaces that ~ rule on line 2\)\.$/);
});

test('F196 fault 3: the prose word alone (no ~ rule) says the answer becomes the agent\'s check', () => {
  const job = [JOB[0], { ...JOB[1], rules: undefined }];
  const r = applySheetWords(CSV, [WORDS[3]], job, 'aging');
  assert.equal(r.asks.length, 1);
  assert.equal(r.asks[0].rule, null);
  assert.match(r.asks[0].question, /\(your answer becomes the agent's check on line 2\)\.$/);
  assert.ok(!r.asks[0].question.includes('added as a new'));
});

test('control (F196 W1): a rule with no column in its words and no such header is asked once, replacing that rule', () => {
  const csv = 'Date,Description,Amount,Tax\n2026-09-01,A,600.50,\n2026-09-02,B,700.50,\n';
  const job = [{ n: 2, text: 'list every expense over 500', rules: ['Price over 500'] }];
  const r = applySheetWords(csv, [{ from: 'line 2 rule 1', word: 'Price', kind: 'number' }], job, 'expenses');
  assert.equal(r.asks.length, 1);
  assert.match(r.asks[0].question, /\(your answer replaces that ~ rule on line 2\)\.$/);
});

test('F196 re-walk: the look returned no word "Due date" (only the prose and rule-3 asks) - rule 3 names the header, so code ties it: nothing is asked', () => {
  const words = [WORDS[3], WORDS[4]];
  const r = applySheetWords(CSV, words, JOB, 'aging');
  assert.deepEqual(r.asks, []);
});

test('F196 panel walk: the look returned ONLY the prose ask for "days past due"; rule 3 says that word and names the header Due date - nothing is asked', () => {
  const r = applySheetWords(CSV, [WORDS[3]], JOB, 'aging');
  assert.deepEqual(r.asks, []);
});

test('F196 panel walk control: a prose word no tied rule says is still asked (rule 3 names Due date but not "balance")', () => {
  const r = applySheetWords(CSV, [{ from: 'line 2', word: 'balance', kind: 'number' }], JOB, 'aging');
  assert.equal(r.asks.length, 1);
});
