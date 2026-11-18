// M17 P4 (docs/wiki/the-module-ladder.md "M17 am2", "M17 am3", rulings of hamr 2026-11-14): sheet checks are built by code on bareguard. Each test names the break that turns it red.
// Fake providers, the synthetic sheet test/fixtures/m10b-sheets/aging.csv, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir } from '../src/authoring.js';
import { readColumns, recordPath } from '../src/pickrecord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../src/drafter.js';
import { buildSheetLine } from '../src/sheetbuild.js';
import { parseCsv, sheetTable } from '../src/csv.js';
import { applyAnswers } from '../src/panel/authorcard.js';
import { columnChoiceParts, swapColumnWord } from '../src/sheetoffer.js';
import { sheetByCheck } from '../src/sheetblock.js';
import { columnEntries, columnsOnLines } from '../src/pickrecord.js';
import { parseSignedText } from '../src/signed-text.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const TABLES = { aging: sheetTable(parseCsv(readFileSync(AGING_CSV, 'utf8'))) };
const LINE = { n: 2, text: 'Put each invoice in its overdue bucket as of 2026-10-11', guardrail: 'every invoice appears exactly once; flag amounts over 500' };
const ROWS = { id: 'x', rule: 'cells', table: 'aging', claim: 'x', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] };
const COUNT = { rule: 'cells', table: 'aging', claim: 'c', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] };
const NODUP = { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' };
const build = (suggestions) => buildSheetLine({ line: LINE, tables: TABLES, suggestions });

test('am3 forced case: a table check then a cells check on one rule: the rule row is the cells check, the table check is its own [agent] row', async () => {
  const r = await build([{ ...NODUP, covers: [1] }, { ...COUNT, covers: [1] }]);
  assert.deepEqual(r.ruleRows.map((x) => [x.check.rule, x.check.covers]), [['cells', [1]]]);
  assert.deepEqual(r.agentRows.map((x) => [x.check.rule, x.check.covers]), [['table', []]]);
  assert.equal(r.refused.length, 0, 'nothing is hidden');
});

test('am3 forced case: cells first then table gives the same rule row and agent row', async () => {
  const r = await build([{ ...COUNT, covers: [1] }, { ...NODUP, covers: [1] }]);
  assert.deepEqual(r.ruleRows.map((x) => x.check.rule), ['cells']);
  assert.deepEqual(r.agentRows.map((x) => x.check.rule), ['table']);
});

test('am3 forced case: two cells checks on one rule: the rule row is the first, the second is an [agent] row', async () => {
  const r = await build([{ ...COUNT, covers: [2] }, { ...ROWS, covers: [2] }]);
  assert.deepEqual(r.ruleRows.map((x) => x.check.op), ['countIf']);
  assert.deepEqual(r.agentRows.map((x) => x.check.op), ['rows']);
});

test('am3 must-fail: a rule row never holds two checks, no rule is on two rule rows, every built check is exactly one row, and no buildable suggestion is hidden', async () => {
  const sug = [{ ...COUNT, covers: [2] }, { ...ROWS, covers: [2] }, { ...NODUP, covers: [1] }, { rule: 'table', table: 'aging', op: 'noEmpty', column: 'Amount', covers: [] }, { ...ROWS, covers: [1, 2] }];
  const r = await build(sug);
  const held = r.ruleRows.flatMap((x) => x.covers);
  assert.equal(new Set(held).size, held.length, 'a rule is on one rule row only');
  assert.equal(r.ruleRows.length + r.agentRows.length, sug.length - r.refused.length, 'built + refused = suggested');
  assert.equal(r.refused.length, 0);
  assert.equal(new Set(r.checks.map((c) => c.id)).size, r.checks.length, 'every check has its own id: one row each');
  for (const a of r.agentRows) assert.equal(sheetByCheck(a.check, []), 'agent', 'an agent row is tagged [agent]');
  for (const a of r.ruleRows) assert.equal(sheetByCheck(a.check, ['x']), 'you');
  assert.ok(r.checks.every((c) => /^l2[ra]/.test(c.id)), 'code names every check');
});

test('am2 must-fail: a suggestion bareguard refuses is never built; its rule is Not checked with the helper and its reason', async () => {
  const cases = [
    [{ rule: 'cells', table: 'aging', op: 'nope', covers: [2] }, 'vocabulary'],
    [{ ...ROWS, table: 'elsewhere', covers: [2] }, 'tables'],
    [{ ...ROWS, where: [{ column: 'Price', cmp: 'gt', value: 500 }], covers: [2] }, 'columnAt'],
    [{ ...ROWS, where: [{ column: 'Amount', cmp: 'gt', value: 777 }], covers: [2] }, 'groundedLiterals'],
    [{ rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Customer', covers: [2] }, 'runTableChecks'],
  ];
  const dup = { aging: sheetTable(parseCsv('Invoice #,Customer,Due date,Amount\nINV-1,A,2026-01-01,5\nINV-2,A,2026-01-02,6\n')) };
  for (const [s, helper] of cases) {
    const r = await buildSheetLine({ line: LINE, tables: helper === 'runTableChecks' ? dup : TABLES, suggestions: [s] });
    assert.equal(r.checks.length, 0, helper);
    assert.equal(r.refused[0].helper, helper);
    assert.equal(r.rows[1].state, 'not-checked');
    assert.ok(r.rows[1].reason.startsWith(`suggestion refused: ${helper}:`), r.rows[1].reason);
  }
});

test('am2 must-fail: the AI writes no sheet check: its id, claim and text are dropped; the plan holds only what code built', async () => {
  const r = await build([{ ...ROWS, id: 'AI-NAME', claim: 'AI-CLAIM', text: 'AI wrote this', covers: [2] }]);
  assert.deepEqual(r.checks.map((c) => [c.id, c.claim, c.text]), [['l2r2', 'l2r2', undefined]]);
});

const PROSE = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: every invoice appears exactly once; flag amounts over 500
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
const decl = (sheet) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
});
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const NO_WORDS = reply(JSON.stringify({ facts: [] }));

test('am2 must-fail through the real draft: the saved plan holds code-named checks only, the AI\'s own ids and claims are nowhere in the signed close, a made-up op is not in it', async () => {
  const sug = [{ ...NODUP, covers: [1] }, { ...ROWS, id: 'ai-over', claim: 'ai-over-claim', covers: [2] }, { id: 'bad', rule: 'cells', table: 'aging', claim: 'bad', op: 'madeUp', covers: [] }];
  const r = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl(sug))]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const sheet = r.declaration.steps[1].close.sheet;
  const text = JSON.stringify(sheet);
  for (const w of ['ai-over', 'nodup', 'madeUp', '"bad"']) assert.equal(text.includes(w), false, w);
  assert.deepEqual(sheet.map((c) => c.id), ['l2r2', 'l2a1']);
  assert.equal(r.log.find((e) => e.sheetRefused).sheetRefused[0].helper, 'vocabulary');
  // the card shows each rule once: rule 2 is a [you] row; M17 am7: the table check is an [agent] row, so rule 1 is Not checked, once, with the no-pick words
  assert.deepEqual(r.notChecked, ['line 2: "every invoice appears exactly once" \u2014 No check was picked for it, so you judge it at the Ask.']);
});

test('am3 must-fail through the real draft: a second buildable check on a rule is on the list as an [agent] row, on, with Drop', async () => {
  const sug = [{ ...COUNT, covers: [2] }, { ...ROWS, covers: [2] }, { ...NODUP, covers: [1] }];
  const r = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl(sug))]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const rows = r.checkCard.rows.filter((x) => x.line === 2);
  assert.deepEqual(rows.map((x) => [x.by, x.drop]), [['you', false], ['agent', true], ['agent', true]]);
  assert.equal(r.declaration.steps[1].close.sheet.length, 3, 'nothing hidden');
});

test('ruling 1: a column answer tied to a ~ rule rewrites the rule\'s own words in place; no line is added', () => {
  const job = '1. Read the sheet\n2. Flag the big ones\n~ Price over 500\n3. Write it out';
  const ask = { line: 2, rule: "use the column 'Amount' for 'Price'", left: false, ruleNo: 1, ruleText: 'Price over 500', ask: 'reading', proposal: "use the column 'Amount' for 'Price'" };
  const r = applyAnswers(job, [ask]);
  assert.equal(r.job, '1. Read the sheet\n2. Flag the big ones\n~ Amount over 500\n3. Write it out');
  // own words replace the rule too
  const own = applyAnswers(job, [{ ...ask, rule: 'Amount above 500' }]);
  assert.equal(own.job, '1. Read the sheet\n2. Flag the big ones\n~ Amount above 500\n3. Write it out');
  assert.deepEqual(columnChoiceParts("use the column 'Amount' for 'Price'"), { column: 'Amount', word: 'Price' });
  assert.equal(swapColumnWord('price over 500', 'Price', 'Amount'), 'Amount over 500');
  assert.equal(swapColumnWord('priced over 500', 'Price', 'Amount'), null, 'whole words only');
});

test('edge case (F195): a multi-rule suggestion one of whose rules a rule row holds is an [agent] row that shows the rule no rule row holds; that rule is not Not checked, and shows once', async () => {
  const r = await build([{ ...COUNT, covers: [1] }, { ...ROWS, covers: [1, 2] }, { ...NODUP, covers: [2] }]);
  assert.deepEqual(r.rows.map((x) => [x.state, x.id]), [['built', 'l2r1'], ['agent-row', 'l2a1']]);
  const a1 = r.agentRows[0].check;
  assert.deepEqual([a1.row, a1.covers], ['agent', [2]], 'tagged [agent], shows rule 2 only (rule 1 stays on its rule row)');
  assert.deepEqual(r.agentRows[1].check.covers, [], 'a later check on the shown rule shows no rule: a rule never has two rows');
});

test('edge case through the real draft: that rule is not in Not checked, the card shows the check once as an [agent] row with the rule\'s words', async () => {
  const sug = [{ ...COUNT, covers: [1] }, { ...ROWS, covers: [1, 2] }];
  const r = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl(sug))]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.notChecked, []);
  const rows = r.checkCard.rows.filter((x) => x.line === 2);
  assert.deepEqual(rows.map((x) => x.by), ['you', 'agent']);
  assert.ok(rows[1].text.includes('covers "flag amounts over 500"'), rows[1].text);
});

// ruling 2 (hamr 2026-11-15): an agreed column for a word that is no `~` rule adds no `~` line; the check is the AI's suggestion, one `!` [agent] row built by code
// the line keeps one ~ rule of its own (a line with no guardrail is never green); the word 'price' is in the prose, in no rule
const PROSE_NO_RULE = PROSE.replace('; flag amounts over 500', '').replace('Put each invoice in its overdue bucket as of 2026-10-11', 'List every invoice over 500 by its price');
const PROSE_ASK = { line: 2, rule: "use the column 'Amount' for 'price'", left: false, ruleNo: undefined, ruleText: 'List every invoice over 500 by its price', ask: 'reading', proposal: "use the column 'Amount' for 'price'" };

test('ruling 2: Agree on a word that is no ~ rule appends no ~ line (the job is unchanged) and hands the column on, typed', () => {
  const job = '1. Read the aging report\n2. List every invoice over 500 by its price\n3. Write it out';
  const r = applyAnswers(job, [PROSE_ASK]);
  assert.equal(r.job, job, 'no ~ line');
  assert.deepEqual(r.columns, [{ line: 2, word: 'price', column: 'Amount' }]);
  assert.equal(r.added, 1, 'the answer counts, so the panel does not refuse the redraft');
  // the person's own words for it are still a ~ rule they wrote
  const own = applyAnswers(job, [{ ...PROSE_ASK, rule: 'the price is the Amount column' }]);
  assert.match(own.job, /~ the price is the Amount column/);
});

test('ruling 2 through the draft: the AI is told the agreed column, its suggestion on it is one [agent] row (Drop offered), nothing is a ~ rule', async () => {
  const sug = [{ ...NODUP, covers: [1] }, { ...ROWS, covers: [] }];
  const PRICE = reply(JSON.stringify({ facts: [{ from: 'line 2', word: 'price', kind: 'number' }] })); // the sheet look: 'price' is a word of the prose, no column
  const p = fakeProvider([PRICE, toolReply(decl(sug))]);
  const r = await draft({ proseText: PROSE_NO_RULE, provider: p, rates: RATES, modelId: MODEL, offerQuestions: false, columnAnswers: [{ line: 2, word: 'price', column: 'Amount' }] });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const told = p.blockTurns.find((t) => t.name === 'submit_edits').messages.map((m) => String(m.content)).join('\n');
  assert.ok(told.includes("the word 'price' means the column 'Amount'"));
  const rows = r.checkCard.rows.filter((x) => x.line === 2);
  assert.deepEqual(rows.map((x) => [x.by, x.drop]), [['agent', true], ['agent', true]], 'M17 am7: the line has no ~ rule and a table check is never a rule row: both are [agent] rows (with Drop)');
  assert.deepEqual(r.declaration.steps[1].close.sheet.map((c) => [c.id, c.row, c.covers]), [['l2a1', 'agent', []], ['l2a2', 'agent', []]]);
  // told nothing, the AI's same suggestion is still an [agent] row; the told words are absent
  const p2 = fakeProvider([PRICE, toolReply(decl(sug))]);
  await draft({ proseText: PROSE_NO_RULE, provider: p2, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(p2.blockTurns.find((t) => t.name === 'submit_edits').messages.map((m) => String(m.content)).join('\n').includes('the person agreed'), false);
});

test('ruling 2: when the AI suggested no check for the agreed word, no row is added', async () => {
  const { buildSheetChecks } = await import('../src/sheetbuild.js');
  const d = decl(undefined);
  const out = await buildSheetChecks({ declaration: d, lines: [{ n: 2, text: 'List every invoice over 500 by its price' }], tables: TABLES });
  assert.equal(out.declaration.steps[1].close.sheet, undefined);
});

test('am2 item 2 must-fail: a declaration that carries close.sheet is red, naming the field, and is revised; code builds nothing from it', async () => {
  const sug = [{ ...ROWS, covers: [2] }];
  const carried = { ...toolReply(decl(sug)), carrySheet: true };
  const p = fakeProvider([NO_WORDS, carried, toolReply(decl(sug))]);
  const r = await draft({ proseText: PROSE, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const first = r.log.find((e) => e.outcome?.startsWith('validator'));
  assert.ok(first, JSON.stringify(r.log.map((e) => e.outcome)));
  assert.ok(first.reds[0].includes('"close.sheet"'), first.reds[0]);
  assert.equal(JSON.stringify(r.declaration.steps[1].close.sheet).includes('"x"'), false, 'the carried check is not in the plan');
  const stuck = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, carried]), rates: RATES, modelId: MODEL });
  assert.equal(stuck.ok, false, 'a draft that keeps carrying it is never accepted');
});

test('am3 must-fail: a Revise keeps a Drop only for the very same check; a different check that now has the same code-given id is not hidden', async () => {
  const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }];
  const band = { rule: 'cells', table: 'aging', claim: 'b', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: [{ column: 'Due date', format: 'YYYY-MM-DD' }], bands: BANDS, covers: [] };
  const dropped = [{ key: 'L2.sheet.l2a1', line: 2, index: 2, check: { id: 'l2a1', ...band, claim: 'l2a1', row: 'agent' }, text: 'band' }];
  const base = [{ ...COUNT, covers: [2] }, { ...NODUP, covers: [1] }];
  // the same band check again: it starts dropped (gone from the close)
  const same = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl([...base, band]))]), rates: RATES, modelId: MODEL, carriedSheetDropped: dropped });
  assert.equal(same.ok, true, JSON.stringify(same.reds));
  assert.equal(same.declaration.steps[1].close.sheet.some((c) => c.op === 'band'), false);
  // another check takes the id l2a1: it is NOT dropped
  const other = await draft({ proseText: PROSE, provider: fakeProvider([NO_WORDS, toolReply(decl([...base, { ...ROWS, covers: [] }]))]), rates: RATES, modelId: MODEL, carriedSheetDropped: dropped });
  assert.equal(other.ok, true, JSON.stringify(other.reds));
  assert.deepEqual(other.declaration.steps[1].close.sheet.map((c) => c.id), ['l2r2', 'l2a1', 'l2a2']);
  assert.equal(other.checkCard.suggested.length, 0, 'nothing is hidden or shown as dropped');
});

test('ruling 2 across a Revise: the agreed column is kept in the picks record (tied to the line\'s words), is not asked or declined again, and is told to the AI again', async () => {
  const PRICE = reply(JSON.stringify({ facts: [{ from: 'line 2', word: 'price', kind: 'number' }] }));
  const lines = parseSignedText(PROSE_NO_RULE).lines;
  const entries = columnEntries(lines, [{ line: 2, word: 'price', column: 'Amount' }]);
  assert.deepEqual(entries.map((e) => [e.lineWords, e.occurrence, e.word, e.column]), [[lines[1].text.toLowerCase(), 0, 'price', 'Amount']]);
  // control: with no carried answer the word is asked again
  const asked = await draft({ proseText: PROSE_NO_RULE, provider: fakeProvider([PRICE, toolReply(decl([]))]), rates: RATES, modelId: MODEL });
  assert.equal(asked.stop, 'look-asks');
  // carried: not asked, not Not checked as declined, told again, and handed on to the next record
  let rec = null;
  const p = fakeProvider([PRICE, toolReply(decl([{ ...NODUP, covers: [1] }, { ...ROWS, covers: [] }]))]);
  const r = await draft({ proseText: PROSE_NO_RULE, provider: p, rates: RATES, modelId: MODEL, carriedColumns: entries, onColumns: (x) => { rec = x; } });
  assert.notEqual(r.stop, 'look-asks');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.notChecked.some((t) => t.includes('price')), false, 'not declined into Not checked');
  assert.ok(p.blockTurns.find((t) => t.name === 'submit_edits').messages.map((m) => String(m.content)).join('\n').includes("the word 'price' means the column 'Amount'"));
  assert.deepEqual(rec, entries);
  assert.deepEqual(columnsOnLines(entries, lines), [{ line: 2, word: 'price', column: 'Amount' }]);
  // a line whose words changed no longer carries it
  assert.deepEqual(columnsOnLines(entries, lines.map((l) => ({ ...l, text: `${l.text} now` }))), []);
});

test("M17 am9a: a rule-tied column answer whose word is not in the rule's text rewrites that rule to `use the column ...`; no line is added, nothing is only told to the AI", () => {
  const job = '1. Read the sheet\n2. Flag the big ones\n~ under 5000\n3. Write it out';
  const ask = { line: 2, rule: "use the column 'Amount' for 'Price'", left: false, ruleNo: 1, ruleText: 'under 5000', ask: 'reading', proposal: "use the column 'Amount' for 'Price'" };
  const r = applyAnswers(job, [ask]);
  assert.equal(r.job, "1. Read the sheet\n2. Flag the big ones\n~ use the column 'Amount' for 'Price'\n3. Write it out");
  assert.deepEqual(r.columns, []);
  assert.equal(r.job.split('\n').length, job.split('\n').length, 'no line added');
});

test('ruling 2: the draft writes the agreed columns into the plan\'s own picks record (no new file), and the next draft reads them back', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m17p4-'));
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, PROSE_NO_RULE);
  mkdirSync(path.join(work, 'flows'));
  const PRICE = reply(JSON.stringify({ facts: [{ from: 'line 2', word: 'price', kind: 'number' }] }));
  const dir = path.join(work, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(work, 'flows'), name: 'aging', provider: fakeProvider([PRICE, toolReply(decl([{ ...NODUP, covers: [1] }, { ...ROWS, covers: [] }]))]), rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY', noQuestions: true, columnAnswers: [{ line: 2, word: 'price', column: 'Amount' }] });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const got = readColumns(recordPath(dir));
  assert.deepEqual(got?.map((e) => [e.word, e.column]), [['price', 'Amount']]);
  // the next draft (a Revise carries that record) is not asked again and writes it on
  const dir2 = path.join(work, 'draft-1');
  const r2 = await draftToDir({ proseFile, dir: dir2, root: path.join(work, 'flows'), name: 'aging', provider: fakeProvider([PRICE, toolReply(decl([{ ...NODUP, covers: [1] }, { ...ROWS, covers: [] }]))]), rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY', carriedColumns: got ?? undefined });
  assert.equal(r2.ok, true, JSON.stringify(r2.reds));
  assert.deepEqual(readColumns(recordPath(dir2))?.map((e) => [e.word, e.column]), [['price', 'Amount']]);
});
