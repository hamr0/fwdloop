// M10 piece 5 (item 7): the sheet's look - the model names the job's word for each rule (one call), CODE keeps a word only if it is a real column, and finds the
// column to offer when it is not. The asks are decided by code from the kept words (never from a model field). $0, synthetic sheet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { sheetPrompt, parseSheetAnswer, applySheetWords, lookAtSheet, columnRuleWords, SHEET_MARK } from '../src/sheetlook.js';
import { notCheckedLines } from '../src/pagelook.js';

const rowsOf = (n, amountRows, taxRows) => Array.from({ length: n }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, '0')},Office item ${i + 1},${i < amountRows ? `${101 + i}.50` : ''},${i < taxRows ? `${i + 1}.25` : ''}`);
const SHEET = (n = 40, a = 40, t = 10) => `${['Date,Description,Amount,Tax', ...rowsOf(n, a, t)].join('\n')}\n`;
const JOB = [{ n: 1, text: 'Add up the price of every invoice', rule: 'under 5000; matches the ledger' }];
const ans = (facts) => JSON.stringify({ facts });

test('the prompt carries the job, the header, the first rows, and the sheet mark the test provider recognises', () => {
  const p = sheetPrompt({ jobLines: JOB, label: 'aging', text: SHEET() });
  assert.ok(p.includes(SHEET_MARK));
  assert.ok(p.includes('LINE 1: Add up the price of every invoice') && p.includes('~ rule 1: under 5000') && p.includes('~ rule 2: matches the ledger'));
  assert.ok(p.includes('Date | Description | Amount | Tax'));
  assert.ok(p.includes('Office item 1') && !p.includes('Office item 30'), 'only the first rows');
});

test('parse: strict - a fact needs from, word and a kind; anything else is unreadable (no repair)', () => {
  assert.equal(parseSheetAnswer(ans([{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }])).ok, true);
  assert.equal(parseSheetAnswer('sure!').ok, false);
  assert.equal(parseSheetAnswer(ans([{ from: 'line 1', word: '', kind: 'number' }])).ok, false);
  assert.equal(parseSheetAnswer(ans([{ from: 'line 1', word: 'Price', kind: 'money' }])).ok, false);
  assert.equal(parseSheetAnswer(ans([{ from: 'line 1', kind: 'number' }])).ok, false);
  assert.equal(parseSheetAnswer(JSON.stringify({ facts: 'x' })).ok, false);
});

test('a word that is a real column is kept; no ask, no drop', () => {
  const said = [{ n: 1, text: 'Add up the price of every invoice', rule: 'amount under 5000; matches the ledger' }]; // the person says "amount": the look's word is the person's own
  const r = applySheetWords(SHEET(), [{ from: 'line 1 rule 1', word: 'amount', kind: 'number' }], said, 'aging');
  assert.deepEqual(r.asks, []);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.facts.map((f) => [f.line, f.forRule, f.column, f.source]), [[1, 1, 'Amount', 'aging']]);
});

// signed item 7 + C1: the example, asked once
test('a word that is not a column asks once in the signed words, naming the column and the true count', () => {
  const r = applySheetWords(SHEET(), [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }], JOB, 'aging');
  assert.equal(r.asks.length, 1);
  assert.deepEqual(r.asks[0], {
    line: 1, rule: 1, source: 'look', ask: 'reading', ruleText: 'under 5000',
    question: `no column 'Price'; 'Amount' has numbers in 40 of 40 rows. Use it? Answer "agree", or type your own words (your answer is added as a new ~ rule on line 1).`,
    reading: columnRuleWords('Price', 'Amount'), word: 'Price', column: 'Amount',
  });
  assert.deepEqual(r.facts, []);
});

test('the same word twice for one rule is one ask', () => {
  const w = { from: 'line 1 rule 1', word: 'Price', kind: 'number' };
  assert.equal(applySheetWords(SHEET(), [w, { ...w }], JOB, 'aging').asks.length, 1);
});

// must fail (signed): a guardrail dropped with no reason
test('two columns fit equally, or none fits, or the word is not a number: no ask, and a Not-checked line that says why', () => {
  const w = [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }];
  const tie = applySheetWords(SHEET(40, 40, 40), w, JOB, 'aging');
  assert.deepEqual(tie.asks, []);
  assert.deepEqual(notCheckedLines(tie.dropped, JOB), ["line 1: \"under 5000\" — two columns fit 'Price' equally"]);
  const none = applySheetWords(`Date,Note\n2026-09-01,a\n2026-09-02,b\n`, w, JOB, 'aging');
  assert.deepEqual(none.asks, []);
  assert.deepEqual(notCheckedLines(none.dropped, JOB), ["line 1: \"under 5000\" — no column fits 'Price'"]);
  const other = applySheetWords(SHEET(), [{ from: 'line 1 rule 1', word: 'Customer', kind: 'other' }], JOB, 'aging');
  assert.deepEqual(other.asks, []);
  assert.deepEqual(notCheckedLines(other.dropped, JOB), ["line 1: \"under 5000\" — there is no column 'Customer'"]);
});

test('the person already named the column in another rule of the line: the word is that column, nothing is asked again', () => {
  const lines = [{ n: 1, text: 'Add up the price of every invoice', rules: ['under 5000', "use the column 'Amount' for 'price'"] }];
  const r = applySheetWords(SHEET(), [{ from: 'line 1 rule 1', word: 'price', kind: 'number' }], lines, 'aging');
  assert.deepEqual(r.asks, []);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.facts.map((f) => [f.line, f.forRule, f.column]), [[1, 1, 'Amount']]);
});

test('a word with no rule (the job line itself) is asked about with the line as its text', () => {
  const r = applySheetWords(SHEET(), [{ from: 'line 1', word: 'Price', kind: 'number' }], JOB, 'aging');
  assert.equal(r.asks.length, 1);
  assert.equal(r.asks[0].rule, null);
  assert.equal(r.asks[0].ruleText, 'Add up the price of every invoice');
});

test('lookAtSheet: one call; an unreadable answer is retried once, then it stops with the plain words', async () => {
  let n = 0;
  const calls = [];
  const callModel = async (content, attempt) => { calls.push(attempt); n += 1; return n === 1 ? { text: 'not json' } : { text: ans([{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }]) }; };
  const ok = await lookAtSheet({ label: 'aging', text: SHEET(), jobLines: JOB, callModel });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(ok.asks.length, 1);
  const bad = await lookAtSheet({ label: 'aging', text: SHEET(), jobLines: JOB, callModel: async () => ({ text: 'nope' }) });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /not readable twice/);
  const cut = await lookAtSheet({ label: 'aging', text: SHEET(), jobLines: JOB, callModel: async () => ({ text: '{"facts":[', cutOff: true }) });
  assert.equal(cut.ok, false);
  const err = await lookAtSheet({ label: 'aging', text: SHEET(), jobLines: JOB, callModel: async () => ({ error: 'boom' }) });
  assert.match(err.reason, /failed: boom/);
});

// must fail (signed): an ask from the model choosing
test('static: the ask is built from the kept word, the rule and the sheet only - code reads no other model field, and no column the model names', () => {
  const src = readFileSync(new URL('../src/sheetlook.js', import.meta.url), 'utf8');
  const parse = src.slice(src.indexOf('export function parseSheetAnswer'), src.indexOf('export function applySheetWords'));
  for (const k of ['from', 'word', 'kind']) assert.ok(parse.includes(`.${k}`), `parse reads ${k}`);
  assert.ok(!/\b(column|ask|question|reading)\b/.test(parse.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the parser reads no column, ask, question or reading field');
});

test('the answer words are am2\'s: agree / yes writes the proposed rule, own words are word for word, and the rule is then a column the next look keeps', async () => {
  const { ruleOfAnswer } = await import('../src/pageask.js');
  const r = applySheetWords(SHEET(), [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }], JOB, 'aging');
  const q = { source: 'look', ask: r.asks[0].ask, proposal: r.asks[0].reading };
  assert.deepEqual(ruleOfAnswer(q, 'agree'), { rule: "use the column 'Amount' for 'Price'", left: false });
  assert.deepEqual(ruleOfAnswer(q, 'Yes.'), { rule: "use the column 'Amount' for 'Price'", left: false });
  assert.deepEqual(ruleOfAnswer(q, 'the Tax column'), { rule: 'the Tax column', left: false });
  // "drop it" is for a can't-check ask only: on a reading ask it is the person's own words
  assert.deepEqual(ruleOfAnswer(q, 'drop it'), { rule: 'drop it', left: false });
  // after the answer is a new ~ line under the same job line, the next look keeps the column
  const again = [{ n: 1, text: JOB[0].text, rules: ['under 5000', 'matches the ledger', ruleOfAnswer(q, 'agree').rule] }];
  const next = applySheetWords(SHEET(), [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }], again, 'aging');
  assert.deepEqual([next.asks.length, next.dropped.length, next.facts.map((f) => f.column)], [0, 0, ['Amount']]);
});
