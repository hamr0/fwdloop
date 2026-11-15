// M17 P4, F196 practice-walk bugs (draft d-00mwhwe36y-35d3, the aging job), $0: the real prose and the real sheet-look words, fake providers.
//   A  the row-edit turn showed the AI the send line (4) beside the sheet line (2) and let `line` be any integer; the AI sent all four sheetChecks with "line": 4
//   B  a `~` rule showed twice in Not checked (the sheet look's column drop and the no-pick words)
//   C  the card drew the old sheet block (Guardrails / Not checked: none) beside the list rows
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { draft } from '../src/drafter.js';
import { checkedLines } from '../src/checked.js';
import { parseSignedText } from '../src/signed-text.js';
import { csvRolesOf } from '../src/sheetblock.js';
import path from 'node:path';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world } from './m10-am4-world.mjs';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const CSV_PATH = new URL('../fixtures/ar-aging.csv', import.meta.url).pathname;
const PROSE = readFileSync(new URL('./fixtures/m17-f196-aging/prose.txt', import.meta.url), 'utf8').replace('{CSV}', CSV_PATH);
// the sheet look's words, as the walk had them
const LOOK = { facts: [
  { from: 'line 2', word: 'invoice', kind: 'other' }, { from: 'line 2 rule 1', word: 'invoice', kind: 'other' }, { from: 'line 2 rule 2', word: 'invoice', kind: 'other' },
  { from: 'line 2 rule 2', word: 'bucket', kind: 'other' }, { from: 'line 2', word: 'bucket', kind: 'other' }, { from: 'line 1', word: 'aging report', kind: 'other' },
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
  const job = text.split("THE JOB (the person's own words)")[1].split('INPUT')[0];
  assert.match(job, /^2\. For each invoice/m);
  assert.equal(/^4\. /m.test(job), false, 'the send line is not a line the AI is shown');
  assert.equal(/^3\. /m.test(job), false, 'nor the ask line');
  assert.ok(text.includes("The job's sheet lines are 2"), 'and it is told which lines are sheet lines');
  assert.deepEqual(turn.schema.properties.sheetChecks.items.properties.line.enum, [2], 'a typed lock: line 4 cannot be named');
});

test('B: each ~ rule is ONE Not checked line with ONE reason (the build\'s wins over the look\'s column drop); a prose word\'s drop stays', async () => {
  const { r } = await run();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const mine = (rule) => r.notChecked.filter((t) => t.startsWith(`line 2: "${rule}"`));
  assert.deepEqual(mine('every invoice appears exactly once'), ['line 2: "every invoice appears exactly once" — No check was picked for it, so you judge it at the Ask.']);
  assert.deepEqual(mine('each invoice is in one bucket'), ['line 2: "each invoice is in one bucket" — No check was picked for it, so you judge it at the Ask.']);
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

// C in a real browser (1280, 390, 320): the page's own planOfState draws a plan with a list; the old sheet block (Guardrails / Not checked: none) is not among its lines for a code-built plan, and still is for an older one
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the plan card of a code-built sheet plan draws the list only, no old sheet block`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { r } = await run();
    const parsed = parseSignedText(PROSE);
    const csvRoles = csvRolesOf(parsed.arbiter);
    const checked = checkedLines(r.declaration, { lines: parsed.lines, csvRoles });
    const old = checked.map((c) => (c.sheet ? { ...c, sheet: { ...c.sheet, codeBuilt: false } } : c));
    const w = await world();
    await chrome.open(`http://127.0.0.1:${w.port}/`, width);
    const src = `${cutFn(PAGE, 'sheetBlockLines', '  ')}\n${cutFn(PAGE, 'planOfState', '    ')}`;
    const extra = (c) => chrome.ev(`(function(){ ${src}
      var p = planOfState({checked: ${JSON.stringify(c)}, planLines: [{n: 2, text: "x", rules: []}], notChecked: {items: []}, always: []}, {rows: [], suggested: []});
      return p.lines[0].extra; })()`);
    assert.deepEqual(await extra(checked), [], 'a code-built plan: nothing beside the list rows');
    assert.ok((await extra(old)).includes('Not checked: none') || (await extra(old)).includes('Guardrails:'), 'an older plan keeps what it showed');
    assert.ok(await chrome.ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no horizontal scroll');
  });
}

test('B2 (walk d-00mwhx4jbm-fe4b): a look drop of a word inside a ~ rule never makes a Not checked line; a rule a cells row holds shows nowhere, a prose word\'s drop stays', async () => {
  const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
  const sug = [{ rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] }, { rule: 'cells', table: 'aging', claim: 'b', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS, covers: [2, 3] }];
  const { r } = await run(sug);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.declaration.steps[1].close.sheet.map((c) => c.id), ['l2r2_3', 'l2a1']);
  // M17 am7: the table check is an [agent] row and holds no rule, so rule 1 is Not checked ONCE (the no-pick words); the cells check's rules 2 and 3 show nowhere
  assert.deepEqual(r.notChecked.filter((t) => /every invoice|each invoice/.test(t)), ['line 2: "every invoice appears exactly once" \u2014 No check was picked for it, so you judge it at the Ask.']);
  assert.ok(r.notChecked.some((t) => t.startsWith('line 2: "bucket"')), 'the prose word stays');
});
