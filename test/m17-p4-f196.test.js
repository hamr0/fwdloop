// M17 P4, F196 practice-walk bugs (draft d-00mwhwe36y-35d3, the aging job), $0: the real prose and the real sheet-look words, fake providers.
//   A  the row-edit turn showed the AI the send line (4) beside the sheet line (2) and let `line` be any integer; the AI sent all four sheetChecks with "line": 4
//   B  a `~` rule showed twice in Not checked (the sheet look's column drop and "no sheet check covers it")
//   C  the card drew the old sheet block (Guardrails / Not checked: none) beside the list rows
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { draft } from '../src/drafter.js';
import { checkedLines } from '../src/checked.js';
import { parseSignedText } from '../src/signed-text.js';
import { csvRolesOf } from '../src/sheetblock.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const CSV_PATH = new URL('../fixtures/ar-aging.csv', import.meta.url).pathname;
const PROSE = readFileSync(new URL('./fixtures/m17-f196-aging/prose.txt', import.meta.url), 'utf8').replace('{CSV}', CSV_PATH);
// the sheet look's words, as the walk had them
const LOOK = { facts: [
  { from: 'line 2', word: 'invoice', kind: 'other' }, { from: 'line 2 rule 1', word: 'invoice', kind: 'other' }, { from: 'line 2 rule 2', word: 'invoice', kind: 'other' },
  { from: 'line 2', word: 'bucket', kind: 'other' }, { from: 'line 1', word: 'aging report', kind: 'other' },
] };
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const DAYS = { rule: 'cells', table: 'aging', claim: 'd', op: 'daysSince', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, covers: [3] };
const decl = (sheet) => ({
  steps: [
    { primitives: ['read'], reads: ['aging'], emits: 'aging_rows', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging', 'aging_rows'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'bucket_review', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_review'], emits: 'final_output', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
});
const run = (sheet = [DAYS]) => { const p = fakeProvider([reply(JSON.stringify(LOOK)), toolReply(decl(sheet))]); return draft({ proseText: PROSE, provider: p, rates: RATES, modelId: MODEL, offerQuestions: false }).then((r) => ({ r, p })); };

test('A: the row-edit turn shows the AI the job\'s sheet line by its job number, no send or ask line, and `line` can only name a sheet line', async () => {
  const { p } = await run();
  const turn = p.blockTurns.find((t) => t.name === 'submit_edits');
  const text = turn.messages.map((m) => String(m.content)).join('\n');
  assert.match(text, /^2\. For each invoice/m);
  assert.equal(/^4\. /m.test(text.split('THE SHEET CHECKS')[0]), false, 'the send line is not a line the AI is shown');
  assert.equal(/^3\. /m.test(text.split('THE SHEET CHECKS')[0]), false, 'nor the ask line');
  assert.ok(text.includes("The job's sheet lines are 2"), 'and it is told which lines are sheet lines');
  assert.deepEqual(turn.schema.properties.sheetChecks.items.properties.line.enum, [2], 'a typed lock: line 4 cannot be named');
});

test('B: each ~ rule is ONE Not checked line with ONE reason (the build\'s wins over the look\'s column drop); a prose word\'s drop stays', async () => {
  const { r } = await run();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const mine = (rule) => r.notChecked.filter((t) => t.startsWith(`line 2: "${rule}"`));
  assert.deepEqual(mine('every invoice appears exactly once'), ['line 2: "every invoice appears exactly once" — no sheet check covers it']);
  assert.deepEqual(mine('each invoice is in one bucket'), ['line 2: "each invoice is in one bucket" — no sheet check covers it']);
  assert.ok(r.notChecked.some((t) => t.startsWith('line 2: "bucket"') || t.startsWith('line 2: "invoice"')), 'a prose word is no rule: its drop stays');
});

test('C: a plan whose sheet checks code built has no old sheet block for the card; a plan with the AI\'s own names keeps it', async () => {
  const { r } = await run();
  const parsed = parseSignedText(PROSE);
  const built = checkedLines(r.declaration, { lines: parsed.lines, csvRoles: csvRolesOf(parsed.arbiter) }).find((l) => l.line === 2).sheet;
  assert.equal(built.codeBuilt, true);
  const old = { ...r.declaration, steps: r.declaration.steps.map((s) => (s.fromLine === 2 ? { ...s, close: { ...s.close, sheet: s.close.sheet.map((c) => ({ ...c, id: 'days-since' })) } } : s)) };
  assert.equal(checkedLines(old, { lines: parsed.lines, csvRoles: csvRolesOf(parsed.arbiter) }).find((l) => l.line === 2).sheet.codeBuilt, false);
});
