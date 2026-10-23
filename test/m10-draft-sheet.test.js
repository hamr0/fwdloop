// M10 piece 5 at the drafter: a CSV input gets one sheet-word call (after the $0 gates, before any drafting round); a job word that is no column asks in the
// signed item 7 words, decided by code. Fake provider, local sheet, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { parseSignedText } from '../src/signed-text.js';
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
const ASK_Q = `no column 'Price'; 'Amount' has numbers in 40 of 40 rows. Use it? Answer "agree", or type your own words (your answer is added as a new ~ rule on line 1).`;

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
  const r = await run(p, csv, { guard: 'amount under 5000' }); // the person says "amount": the look's word is the person's own
  assert.notEqual(r.stop, 'look-asks');
  assert.ok(p.calls.length > 1 && p.calls[1].tools[0] === 'emit_declaration');
  const sys = p.calls[1].messages[0].content;
  assert.ok(sys.includes("column 'Amount'"), 'the drafter is told the kept column');
}));

// must fail (signed): a guardrail dropped with no reason
test('a word that gets no offer is Not checked with its reason, on the result and told to the drafter', () => withSheet(async (csv) => {
  const p = fakeProvider([ans(W('Customer', 'line 1 rule 1', 'other')), textReply()]);
  const r = await run(p, csv);
  const line = 'line 1: "under 5000" — there is no column \'Customer\'';
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
  assert.ok(declined.notChecked.includes('line 1: "under 5000" — you didn\'t take the offered column'), declined.notChecked.join('|'));
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

// am8 item 3: a .docx word that is no heading is Not checked with its reason; nothing is asked
import { makeDocx, para } from './fixtures/docx-make.mjs';
const withDocx = async (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10docx-'));
  const f = path.join(dir, 'terms.docx');
  writeFileSync(f, makeDocx(para('Heading1', 'Fees') + para(null, 'The fee is 45 dollars.') + para('Heading1', 'Term') + para(null, 'Twelve months.')));
  try { return await fn(f); } finally { rmSync(dir, { recursive: true, force: true }); }
};
test('a word that is a .docx heading is kept; one that is not is Not checked with its reason and nothing is asked', () => withDocx(async (docx) => {
  const kept = fakeProvider([ans(W('fees', 'line 1 rule 1', 'other')), textReply()]);
  const a = await run(kept, docx);
  assert.equal(a.stop === 'look-asks', false);
  assert.ok(kept.calls[0].messages[1].content.includes('- Fees') && kept.calls[0].messages[1].content.includes(SHEET_MARK));
  assert.ok(kept.calls[1].messages[0].content.includes("heading 'Fees'"), 'the drafter is told the kept heading');
  const p = fakeProvider([ans(W('Price', 'line 1 rule 1', 'number')), textReply()]);
  const r = await run(p, docx);
  assert.notEqual(r.stop, 'look-asks');
  assert.deepEqual(r.questions, []);
  assert.ok(r.notChecked.includes('line 1: "under 5000" — there is no heading \'Price\''), r.notChecked.join('|'));
  assert.ok(p.calls[1].messages[0].content.includes("there is no heading 'Price'"));
}));

// am8 item 2 at the drafter: the column the code kept for a line must be in that step's close.columns, or the draft is refused naming the line
import { readFileSync } from 'node:fs';
import { toolReply } from './drafter-fixture.mjs';
const AGING = readFileSync(new URL('./fixtures/m4d-am8.aging.signed.txt', import.meta.url), 'utf8');
const agingDecl = (columns) => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/m4d-am8.aging.declaration.json', import.meta.url), 'utf8'));
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment'];
  // M10b piece 5: the green step carries close.sheet (the old cell cite no longer drafts)
  d.steps[1].close = { class: 'green', ...(columns ? { columns } : {}), sheet: [{ id: 'n', rule: 'cells', table: 'aging', claim: 'n', op: 'count', column: 'Amount', covers: [] }] };
  delete d.inputFacts;
  return d;
};
const withAging = (fn) => withSheet(async (csv) => fn(AGING.replace(/source aging = file:.*/, `source aging = file:${csv}`).replace('   guardrail: every invoice appears exactly once', '   guardrail: every invoice appears exactly once; amounts are right')), 'Invoice,Amount\nA1,10.5\nA2,20\nA3,30\n');
const sheetAnswer = () => ans(W('Amount', 'line 2 rule 2', 'number'));

test('the kept column must be named in the step\'s close.columns: a draft without it is refused naming the line, a draft with it passes', () => withAging(async (proseText) => {
  const bad = fakeProvider([sheetAnswer(), toolReply(agingDecl()), toolReply(agingDecl()), toolReply(agingDecl())]);
  const r = await draft({ proseText, provider: bad, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes('line 2') && x.includes("'Amount'") && x.includes('close.columns')), JSON.stringify(r.reds));
  assert.ok(bad.calls[1].messages[0].content.includes("is column 'Amount'"), 'the drafter is told the kept column');
  const good = fakeProvider([sheetAnswer(), toolReply(agingDecl([{ source: 'aging', column: 'Amount' }]))]);
  const ok = await draft({ proseText, provider: good, rates: RATES, modelId: MODEL });
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
  assert.deepEqual(ok.declaration.steps[1].close.columns, [{ source: 'aging', column: 'Amount' }]);
  const made = fakeProvider([sheetAnswer(), toolReply(agingDecl([{ source: 'aging', column: 'Price' }]))]);
  assert.equal((await draft({ proseText, provider: made, rates: RATES, modelId: MODEL })).ok, false);
}));

import { buildReadout } from '../src/authoring.js';
test('the column lock is a row of the readout, so it is signed with the plan', () => {
  const parsed = parseSignedText(AGING);
  const d = agingDecl([{ source: 'aging', column: 'Amount' }]);
  d.inputFacts = {};
  const text = buildReadout({ declaration: d, arbiter: parsed.arbiter, lines: parsed.lines, name: 'x', modelId: MODEL, costUsd: 0, rounds: 1, spendComplete: true, root: 'r' });
  assert.ok(text.includes("cells only from column 'Amount' of aging"), text);
});

// the sheet-map call books a pre-send throw like the page-map call does (8cd2b7b): one unmetered call, held at the ceiling, never uncounted
test('a ValidationError thrown before the sheet call is sent is booked as one unmetered call, spend not complete', () => withSheet(async (csv) => {
  const books = [];
  const p = fakeProvider([ans(W('amount'))]);
  p.generate = async () => { const e = new Error('messages: too long'); e.name = 'ValidationError'; throw e; };
  const r = await run(p, csv, { onBook: (b) => books.push(b) });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'provider-red');
  assert.equal(r.spendComplete, false);
  assert.equal(r.calls, 1);
  assert.equal(books.at(-1).unmetered, 1);
  assert.equal(r.log[0].kind, 'sheet-map');
}));
