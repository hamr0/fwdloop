// M10 piece 5 at the drafter: a CSV input gets one sheet-word call (after the $0 gates, before any drafting round); a job word that is no column asks in the
// signed item 7 words, decided by code. Fake provider, local sheet, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { SHEET_MARK, columnRuleWords } from '../src/sheetlook.js';
import { RATES, MODEL, fakeProvider, textReply } from './drafter-fixture.mjs';

const rows = Array.from({ length: 40 }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, '0')},Office item ${i + 1},${101 + i}.50,${i < 10 ? `${i + 1}.25` : ''}`);
const CSV = `${['Date,Description,Amount,Tax', ...rows].join('\n')}\n`;
const prose = (csv, guard = 'under 5000') => `1. Add up the price of every invoice,
   guardrail: ${guard}
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source aging = file:${csv}
`;
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const ans = (...facts) => reply(JSON.stringify({ facts }));
const W = (word, from = 'line 1 rule 1', kind = 'number') => ({ from, word, kind });
const withSheet = async (fn, text = CSV) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10sheet-'));
  const csv = path.join(dir, 'aging.csv');
  writeFileSync(csv, text);
  try { return await fn(csv); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const run = (provider, csv, extra = {}) => draft({ proseText: prose(csv, extra.guard), provider, rates: RATES, modelId: MODEL, ...extra, guard: undefined });
const ASK_Q = "no column 'Price'; 'Amount' has numbers in 40 of 40 rows. Use it?";

// Done when (signed): the CSV case asks once
test('a job word that is no column asks once, in the signed words, after the one sheet call and before any drafting round', () => withSheet(async (csv) => {
  const p = fakeProvider([ans(W('Price')), textReply()]);
  const r = await run(p, csv);
  assert.equal(p.calls.length, 1, 'only the sheet call was paid');
  assert.ok(p.calls[0].messages[1].content.includes(SHEET_MARK));
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'look-asks');
  assert.equal(r.declaration, null);
  assert.ok(r.costUsd > 0 && r.spendComplete === true, 'the sheet call is booked');
  assert.deepEqual(r.questions, [{
    line: 1, question: ASK_Q, source: 'look', ask: 'reading', ruleNo: 1, ruleText: 'under 5000', proposal: columnRuleWords('Price', 'Amount'),
  }]);
  assert.ok(r.log.some((e) => e.kind === 'sheet-map'));
}));

test('a job word that IS a column asks nothing: drafting runs and the drafter is told the column the code kept', () => withSheet(async (csv) => {
  const p = fakeProvider([ans(W('amount')), textReply()]);
  const r = await run(p, csv);
  assert.notEqual(r.stop, 'look-asks');
  assert.ok(p.calls.length > 1 && p.calls[1].tools[0] === 'emit_declaration');
  const sys = p.calls[1].messages[0].content;
  assert.ok(sys.includes("column 'Amount'"), 'the drafter is told the kept column');
}));

// must fail (signed): a guardrail dropped with no reason
test('a word that gets no offer is Not checked with its reason, on the result and told to the drafter', () => withSheet(async (csv) => {
  const p = fakeProvider([ans(W('Customer', 'line 1 rule 1', 'other')), textReply()]);
  const r = await run(p, csv);
  const line = 'line 1: "under 5000" — There is no column "Customer" in the sheet. Only a column with numbers can be offered in its place.';
  assert.ok(r.notChecked.includes(line), r.notChecked.join('\n'));
  assert.ok(p.calls[1].messages[0].content.includes(line), 'the drafter is told');
}));

test('the redraft after the answers never asks; a column the person named in a rule is kept, one they did not take is Not checked', () => withSheet(async (csv) => {
  const named = await run(fakeProvider([ans(W('Price')), textReply()]), csv, { offerQuestions: false, guard: `under 5000; ${columnRuleWords('Price', 'Amount')}` });
  assert.notEqual(named.stop, 'look-asks');
  assert.deepEqual(named.questions, []);
  assert.ok(!named.notChecked.some((l) => l.includes('Price')), named.notChecked.join('|'));
  const declined = await run(fakeProvider([ans(W('Price')), textReply()]), csv, { offerQuestions: false, guard: 'under 5000; the total of the amounts' });
  assert.notEqual(declined.stop, 'look-asks');
  assert.ok(declined.notChecked.includes('line 1: "under 5000" — There is no column "Price" in the sheet, and the column offered ("Amount") was not taken.'), declined.notChecked.join('|'));
}));

// must fail (signed): more than 3 asks -> rewrite, at $0 more
test('more than 3 column asks: nothing is asked, the rewrite list names each, and no drafting round was paid', () => withSheet(async (csv) => {
  const p = fakeProvider([ans(W('Price', 'line 1 rule 1'), W('Cost', 'line 1 rule 2'), W('Fee', 'line 1 rule 3'), W('Total', 'line 1 rule 4')), textReply()]);
  const r = await run(p, csv, { guard: 'a; b; c; d' });
  assert.equal(p.calls.length, 1);
  assert.equal(r.stop, 'look-asks-too-many');
  assert.deepEqual(r.questions, []);
  assert.match(r.reds[0], /^Your job has 4 rules I can't check or had to guess\. Please rewrite it so each one says what to look for\. My readings: line 1 "a" → use the column 'Amount' for 'Price'; line 1 "b" → use the column 'Amount' for 'Cost'/);
  assert.match(r.reds[0], / Spent so far: \$0\.\d{4}\.$/);
}));

test('a job whose lines carry no guardrail to check makes no sheet call: a CSV job without a rule is unchanged', () => withSheet(async (csv) => {
  const p = fakeProvider([textReply()]);
  const noRule = prose(csv).replace('   guardrail: under 5000\n', '');
  const r = await draft({ proseText: noRule, provider: p, rates: RATES, modelId: MODEL });
  assert.ok(p.calls.every((c) => !JSON.stringify(c.messages).includes(SHEET_MARK)));
  assert.notEqual(r.stop, 'look-asks');
}));

test('the ask line\'s own guardrail is a stop, not a sheet check: it is not sent to the sheet call', () => withSheet(async (csv) => {
  const p = fakeProvider([ans(W('Price')), textReply()]);
  await run(p, csv);
  assert.ok(!p.calls[0].messages[1].content.includes('nothing goes out before I accept'));
}));

test('an unreadable sheet answer twice stops at the sheet call with the plain words, nothing signed', () => withSheet(async (csv) => {
  const p = fakeProvider([reply('no json'), reply('still no')]);
  const r = await run(p, csv);
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'page-map');
  assert.match(r.reds[0], /about the sheet was not readable twice/);
  assert.equal(p.calls.length, 2);
}));
