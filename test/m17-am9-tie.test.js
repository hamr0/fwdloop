// M17 am9 (a column tie asks which column) and am9a (every agreed column answer rewrites the rule), docs/wiki/the-module-ladder.md, last blocks.
// $0: the real sheet look, the real draft with a fake provider, the real answer code. One test per "Must fail when" clause.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { applySheetWords } from '../src/sheetlook.js';
import { applyAnswers } from '../src/panel/authorcard.js';
import { ruleOfAnswer, decidedWords, TIE_PICK_SAY } from '../src/pageask.js';
import { notCheckedLines } from '../src/pagelook.js';
import { RATES, MODEL, fakeProvider, textReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPENSES = path.join(HERE, 'fixtures', 'm10b-sheets', 'expenses.csv');
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const WORD = (from, word = 'Price') => reply(JSON.stringify({ facts: [{ from, word, kind: 'number' }] }));
const proseOf = (rule, csv = EXPENSES) => `1. Read the expenses
2. List the expensive ones
   guardrail: ${rule}
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source expenses = file:${csv}
`;

/** a sheet of n numeric columns, every cell a number, so every column fits equally */
function csvOf(names) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am9-'));
  const f = path.join(dir, 'wide.csv');
  const rows = Array.from({ length: 12 }, (_, i) => names.map((_n, j) => (i + 1) * (j + 3)).join(','));
  writeFileSync(f, `${names.join(',')}\n${rows.join('\n')}\n`);
  return f;
}
const tieQuestions = async (rule, csv, word = WORD('line 2 rule 1')) => {
  const p = fakeProvider([word]);
  const r = await draft({ proseText: proseOf(rule, csv), provider: p, rates: RATES, modelId: MODEL });
  return { r, p };
};

test('item 1 + Done when: a draft on expenses.csv with `~ Price over 500` asks one tie question at $0, in the signed words, and the question carries the columns and each reading', async () => {
  const { r, p } = await tieQuestions('Price over 500', EXPENSES);
  assert.equal(r.stop, 'look-asks');
  assert.equal(r.questions.length, 1);
  const q = r.questions[0];
  assert.equal(q.question, "I found 2 columns matching 'Price': Amount, Tax. Choose one. (your answer replaces that ~ rule on line 2).");
  assert.deepEqual(q.columns, ['Amount', 'Tax']);
  assert.deepEqual(q.readings, { Amount: "use the column 'Amount' for 'Price'", Tax: "use the column 'Tax' for 'Price'" });
  assert.equal(q.proposal, null, 'no single reading exists: nothing to Agree to');
  assert.equal(p.calls.length, 1, 'only the word look was called; the draft stopped at the question');
  assert.ok(r.costUsd < 0.01);
});

test('item 1: a 3-column and a 5-column tie list every column, in sheet order, with the real count', async () => {
  for (const names of [['Fee', 'Amount', 'Tax'], ['Fee', 'Amount', 'Tax', 'Tip', 'Duty']]) {
    const { r } = await tieQuestions('Price over 500', csvOf(names));
    const q = r.questions[0];
    assert.deepEqual(q.columns, names);
    assert.equal(q.question, `I found ${names.length} columns matching 'Price': ${names.join(', ')}. Choose one. (your answer replaces that ~ rule on line 2).`);
    assert.deepEqual(Object.keys(q.readings), names);
  }
});

test('Must fail: a tie goes to Not checked on a ~ rule\'s word (the look asks, drops nothing)', () => {
  const sheet = readFileSync(EXPENSES, 'utf8');
  const jobs = [{ n: 1, text: 'List the expensive ones', rule: 'Price over 500' }];
  const r = applySheetWords(sheet, [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }], jobs, 'expenses');
  assert.equal(r.asks.length, 1);
  assert.deepEqual(r.dropped, []);
});

test('item 5: a tie on a line\'s own prose word (no ~ rule) asks nothing and stays Not checked with its reason; a rule that names a real header asks nothing', () => {
  const sheet = readFileSync(EXPENSES, 'utf8');
  const jobs = [{ n: 1, text: 'List the expensive ones by price', rule: 'Price over 500' }];
  const prose = applySheetWords(sheet, [{ from: 'line 1', word: 'price', kind: 'number' }], [{ n: 1, text: 'List the expensive ones by price' }], 'expenses');
  assert.deepEqual(prose.asks, []);
  assert.match(notCheckedLines(prose.dropped, [{ n: 1, text: 'List the expensive ones by price' }])[0], /two columns fit 'price' equally/);
  // F196: the line's prose word is settled by the tied rule: one question, never two
  const both = applySheetWords(sheet, [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }, { from: 'line 1', word: 'price', kind: 'number' }], jobs, 'expenses');
  assert.equal(both.asks.length, 1, 'a prose word does not ask beside the rule\'s question');
  const named = applySheetWords(sheet, [{ from: 'line 1 rule 1', word: 'Price', kind: 'number' }], [{ n: 1, text: 'x', rule: 'Amount over 500' }], 'expenses');
  assert.equal(named.asks.length, 0, 'the rule\'s own words name a real header: settled, asks nothing');
});

test('item 4 + am9a Done when: Tax gives `Tax over 500`, Amount gives `Amount over 500` (no line added); a word not in the rule gives `use the column ...`', () => {
  const q = { source: 'look', ask: 'reading', proposal: null, line: 2, ruleNo: 1, ruleText: 'Price over 500', columns: ['Amount', 'Tax'], readings: { Amount: "use the column 'Amount' for 'Price'", Tax: "use the column 'Tax' for 'Price'" } };
  const job = '1. Read the expenses\n2. List the expensive ones\n~ Price over 500\n3. Write it out';
  for (const [col, want] of [['Tax', 'Tax over 500'], ['Amount', 'Amount over 500']]) {
    const eff = ruleOfAnswer(q, col, 'column');
    assert.equal(eff.left, false);
    const r = applyAnswers(job, [{ line: 2, question: 'q', answer: col, ...eff, ruleNo: 1, ruleText: q.ruleText, ask: 'reading', proposal: eff.rule }]);
    assert.equal(r.job, `1. Read the expenses\n2. List the expensive ones\n~ ${want}\n3. Write it out`);
    assert.equal(r.job.split('\n').length, job.split('\n').length, 'no line added');
    assert.equal(r.job.split('\n').filter((l) => l.startsWith('~')).length, 1, 'no second rule beside the replaced one');
    assert.deepEqual(r.columns, []);
  }
  const q2 = { ...q, ruleText: 'under budget' };
  const eff2 = ruleOfAnswer(q2, 'Tax', 'column');
  const job2 = job.replace('Price over 500', 'under budget');
  const r2 = applyAnswers(job2, [{ line: 2, question: 'q', answer: 'Tax', ...eff2, ruleNo: 1, ruleText: 'under budget', ask: 'reading', proposal: eff2.rule }]);
  assert.equal(r2.job, "1. Read the expenses\n2. List the expensive ones\n~ use the column 'Tax' for 'Price'\n3. Write it out");
});

test('item 4: Drop it on a tie leaves the rule Not checked (no rule written)', () => {
  const q = { source: 'look', ask: 'reading', proposal: null, line: 2, ruleNo: 1, ruleText: 'Price over 500', columns: ['Amount', 'Tax'], readings: {} };
  assert.deepEqual(ruleOfAnswer(q, 'drop it', 'drop'), { rule: null, left: true });
});

test('am9a: a column answer about a word of a line\'s own prose (no ~ rule) is unchanged: no line, told to the AI', () => {
  const job = '1. Read the sheet\n2. List every invoice by its price\n3. Write it out';
  const r = applyAnswers(job, [{ line: 2, rule: "use the column 'Amount' for 'price'", left: false, ruleNo: undefined, ruleText: 'x', ask: 'reading', proposal: "use the column 'Amount' for 'price'" }]);
  assert.equal(r.job, job);
  assert.deepEqual(r.columns, [{ line: 2, word: 'price', column: 'Amount' }]);
});

test('am9a Must fail: a single-column Agree on `~ under budget` leaves the rule\'s old words (it must read `use the column ...`)', () => {
  const job = '1. Read\n2. List\n~ under budget\n3. Write';
  const ask = { line: 2, rule: "use the column 'Amount' for 'Price'", left: false, ruleNo: 1, ruleText: 'under budget', ask: 'reading', proposal: "use the column 'Amount' for 'Price'" };
  assert.match(applyAnswers(job, [ask]).job, /~ use the column 'Amount' for 'Price'/);
  assert.equal(applyAnswers(job, [ask]).job.includes('under budget'), false);
});

test('item 7: a column pick reads the question-and-answer form in the Audit (decidedWords gives no one-line word); the one-line words stay for Agree, own words and Drop it', () => {
  assert.equal(decidedWords({ choice: 'column', words: 'Tax over 500' }), null);
  assert.equal(decidedWords({ choice: 'column' }), null);
  assert.equal(decidedWords({ choice: 'drop' }), 'dropped — Not checked');
  assert.match(decidedWords({ choice: 'agree', words: 'x' }), /^agreed/);
  assert.match(decidedWords({ choice: 'rule', words: 'x' }), /^you wrote/);
});

test('item 3: the refusal words', () => {
  assert.equal(TIE_PICK_SAY, 'This question has a list to choose from: pick one of the columns, or Drop it. Nothing was saved.');
});
