// M10b piece 3: the drafter OFFERS sheet checks (close.sheet) from bareguard's op list, with the sheet's exact header as the only column choice; every rule the
// validator enforces is told to the drafter; a number or date not in the job, an all-table list, and a guardrail with no check are each visible at $0.
// Fake providers, the synthetic sheet test/fixtures/m10b-sheets/aging.csv, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rubricVocabulary } from 'bareguard';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft, buildDeclarationSchema, buildRoundSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';
import { checkedLines } from '../src/checked.js';
import { sheetCheckSentence } from '../src/sheetchecks.js';
import { WHERE_CMPS, isColumnChoiceRule } from '../src/sheetoffer.js';
import { columnRuleWords } from '../src/sheetlook.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply, textReply } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const HEADER = readFileSync(AGING_CSV, 'utf8').split('\n')[0].split(',');
const V = /** @type {any} */ (rubricVocabulary);
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const prose = (guard = 'every invoice appears exactly once; flag amounts over 500') => `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: ${guard}
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
const CHECKS = () => [
  { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] },
  { id: 'over', rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] },
  { id: 'bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS, covers: [] },
];
const decl = (sheet) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: sheet === undefined ? { class: 'green' } : { class: 'green', sheet } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' },
  unjudgeable: {},
  refused: [],
});
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const NO_WORDS = reply(JSON.stringify({ facts: [] })); // the one sheet-word call: the job names no column word
const run = (sheet, guard, extra = {}) => {
  const p = fakeProvider([NO_WORDS, toolReply(decl(sheet))]);
  return draft({ proseText: prose(guard), provider: p, rates: RATES, modelId: MODEL, ...extra }).then((r) => ({ r, p }));
};
const draftCall = (p) => p.calls.find((c) => c.tools[0] === 'emit_declaration');
/** every `enum` that sits where a column name goes, anywhere under a schema */
function columnEnums(node, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => columnEnums(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (Array.isArray(node.enum) && node.type === 'string' && node.enum.includes('Invoice #')) out.push(node.enum);
    Object.values(node).forEach((n) => columnEnums(n, out));
  }
  return out;
}

// M17 am2 item 2: the declaration offers no close.sheet; the row-edit reply offers `sheetChecks` (each with its job line), the same bareguard schema
test('the declaration offers no close.sheet; the row-edit reply offers sheetChecks, and every column-bearing field is an enum of the sheet\'s exact header', async () => {
  const { p } = await run(CHECKS());
  assert.equal(draftCall(p).schemas[0].properties.steps.items.properties.close.properties.sheet, undefined);
  const sheet = p.blockTurns.find((t) => t.name === 'submit_edits').schema.properties.sheetChecks;
  assert.ok(sheet, 'sheetChecks is offered');
  assert.ok(sheet.items.required.includes('line') && sheet.items.properties.line.type === 'integer');
  const props = sheet.items.properties;
  for (const k of ['column', 'keyColumn', 'groupColumn', 'result']) assert.deepEqual(props[k].enum, HEADER, k);
  assert.deepEqual(props.where.items.properties.column.enum, HEADER);
  assert.deepEqual(props.dateFormats.items.properties.column.enum, HEADER);
  for (const k of ['from', 'to', 'cell']) assert.deepEqual(props[k].properties.column.enum, HEADER, k);
  for (const k of ['a', 'b']) assert.deepEqual(props[k].anyOf[0].enum, HEADER, k);
  assert.deepEqual(props.table.enum, ['aging']);
  assert.deepEqual(props.where.items.properties.cmp.enum, WHERE_CMPS);
  assert.equal(columnEnums(sheet).every((e) => JSON.stringify(e) === JSON.stringify(HEADER)), true);
  assert.ok(columnEnums(sheet).length >= 10, 'every column-bearing field has one');
  assert.equal(sheet.items.additionalProperties, false);
  // the op list is the vocabulary's (generated), so a new bareguard op arrives by itself
  assert.deepEqual(props.op.enum, [...new Set([...Object.keys(V.rules.cells.ops), ...Object.keys(V.rules.table.ops)])]);
});

test('no close.sheet is offered to a job without a CSV input (a document job), nor by the bare schema builders', async () => {
  const fx = job2Fixture();
  try {
    const p = fakeProvider([toolReply(validArgs())]);
    await draft({ proseText: fx.prose, provider: p, rates: RATES, modelId: MODEL });
    const close = p.calls[0].schemas[0].properties.steps.items.properties.close.properties;
    assert.equal(close.sheet, undefined);
    // M16 item 5 replaces M10 am7 item 1 for list lines: close.cited is not offered any more (the list builds it); close.columns is unchanged
    assert.ok(close.columns && close.cited === undefined, 'the older closes are unchanged but for the quote check the list builds');
    assert.ok(!p.calls[0].messages[0].content.includes('close.sheet'), 'and the drafter is not told of it');
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  const menu = wiredMenu(['core']);
  assert.equal(buildDeclarationSchema(menu).properties.steps.items.properties.close.properties.sheet, undefined);
  assert.equal(buildRoundSchema(menu, { sheets: { aging: { header: HEADER } } }).properties.steps.items.properties.close.properties.sheet, undefined, 'never, even with a sheet');
});

test('every WHERE_CMPS entry is named in bareguard\'s own where description (a drift guard: the list is the one hand copy)', () => {
  for (const c of WHERE_CMPS) assert.ok(V.rules.cells.fields.where.description.includes(`"${c}"`), c);
});

test('the AI is told every op with its worked example, generated from the vocabulary, and every rule code enforces, on the row-edit turn (the declaration prompt no longer asks for close.sheet)', async () => {
  const { p } = await run(CHECKS());
  assert.equal(draftCall(p).messages[0].content.includes('close.sheet is for a green step only'), false);
  const sys = p.blockTurns.find((t) => t.name === 'submit_edits').messages.map((m) => String(m.content)).join('\n');
  let n = 0;
  for (const rule of ['cells', 'table']) {
    for (const [op, o] of Object.entries(V.rules[rule].ops)) {
      n += 1;
      assert.ok(sys.includes(`- ${op}: ${o.summary}`), `op ${op}`);
      assert.ok(sys.includes(JSON.stringify(o.example.check)), `example of ${op}`);
    }
  }
  assert.ok(n >= 25, `${n} ops`);
  for (const w of [
    'Never make a number or a date up', // numbers and dates come from the job
    'every check of a step is a table check', // all-table refusal
    'Not checked', // a rule no check covers
    'dateFormats', // a date column needs its format
    'picked from the sheet\'s header',
    '~ rule 1: every invoice appears exactly once', '~ rule 2: flag amounts over 500',
  ]) assert.ok(sys.includes(w), w);
});

test('valid checks draft, KEEP covers (signed), and show one plan-card row per check; nothing is Not checked when every rule is covered', async () => {
  const { r } = await run(CHECKS());
  assert.equal(r.ok, true, r.reds.join('\n'));
  const sheet = r.declaration.steps[1].close.sheet;
  assert.equal(sheet.length, 3);
  // M17 am2/am3: code builds and names every check (a cells check before a table check); a rule row's check covers its rule, an [agent] row's covers none
  assert.deepEqual(sheet.map((c) => [c.id, c.covers]), [['l2r2', [2]], ['l2r1', [1]], ['l2a1', []]], 'M10b piece 4: covers is kept on the check, so it is signed');
  const rows = checkedLines(r.declaration).find((x) => x.line === 2).sentences;
  for (const c of sheet) assert.ok(rows.includes(`${sheetCheckSentence(c)} [agent]`), sheetCheckSentence(c));
  assert.equal(rows.length, 1 + sheet.length, 'a lead sentence, then one row per check');
  assert.deepEqual(r.notChecked, []);
});

// M17 am2: a suggestion carrying a number the person never wrote is refused by code (bareguard's groundedLiterals) at build: no red, the rule is Not checked with the refusal
test('a number in a check that is not in the job line or its guardrail is refused by code, the rule it covers is Not checked with the reason', async () => {
  const c = CHECKS(); c[1].where[0].value = 700;
  const { r } = await run(c);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.declaration.steps[1].close.sheet.some((x) => JSON.stringify(x).includes('700')), false, 'the check with 700 is not in the plan');
  assert.deepEqual(r.notChecked, ['line 2: "flag amounts over 500" \u2014 suggestion refused: groundedLiterals: number 700 (where[0].value) is not in your words']);
  const said = CHECKS(); said[1].where[0].value = 30; // 30 sits inside "1-30": a number the person wrote
  assert.deepEqual((await run(said)).r.notChecked, []);
  const part = CHECKS(); part[1].where[0].value = 50; // 50 only sits inside "500": not said
  assert.equal((await run(part)).r.notChecked.length, 1);
});

test('an asOf (or a date value) not written in the job is refused by code (M17 am2): the check is not built, the refusal is in the round log or on the rule it covers', async () => {
  const c = CHECKS(); c[2].asOf = '2026-11-30';
  const { r } = await run(c);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.declaration.steps[1].close.sheet.some((x) => x.op === 'band'), false);
  assert.ok(r.log.find((e) => e.sheetRefused).sheetRefused.some((x) => x.helper === 'groundedLiterals' && x.why.includes('date "2026-11-30"')), JSON.stringify(r.log.map((e) => e.sheetRefused)));
  const d = CHECKS(); d[1].where = [{ column: 'Due date', cmp: 'before', value: '2026-09-09' }]; d[1].dateFormats = ISO;
  const dd = await run(d);
  assert.equal(dd.r.ok, true, dd.r.reds.join('\n'));
  assert.deepEqual(dd.r.notChecked, ['line 2: "flag amounts over 500" \u2014 suggestion refused: groundedLiterals: date "2026-09-09" (where[0].value) is not in your words']);
});

test('a step whose sheet checks are all table checks has nothing to answer: refused at the line, and the drafter was told', async () => {
  const { r } = await run([CHECKS()[0], { id: 'nn', rule: 'table', table: 'aging', op: 'noEmpty', column: 'Amount', covers: [2] }]);
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes('line 2') && x.includes('every sheet check on this step is a table check')), r.reds.join('\n'));
});

test('covers that names a rule the line does not have covers none (M17 am2): the check is built as an [agent] row, and the rule it did not hold is Not checked', async () => {
  const c = CHECKS(); c[0].covers = [3];
  const { r } = await run(c);
  assert.equal(r.ok, true, r.reds.join('\n'));
  const nodup = r.declaration.steps[1].close.sheet.find((x) => x.op === 'noDuplicates');
  assert.deepEqual([nodup.id, nodup.covers], ['l2a2', []]);
  assert.deepEqual(r.notChecked, ['line 2: "every invoice appears exactly once" \u2014 no sheet check covers it']);
});

test('a guardrail rule no check covers shows under Not checked (F76 aging draft 1: noDuplicates dropped); a step with no close.sheet is refused', async () => {
  const dropped = CHECKS().slice(1); // the noDuplicates check is gone
  const { r } = await run(dropped);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.notChecked, ['line 2: "every invoice appears exactly once" — no sheet check covers it']);
  // M17 am5 / P5: a green step the AI gave no sheet check is no red the AI cannot fix (it writes no close.sheet): the step is hitl and each of its rules is Not checked, with the list's own reason
  const none = await run(undefined);
  assert.equal(none.r.ok, true, none.r.reds.join('\n'));
  assert.equal(none.r.declaration.steps[1].close.class, 'hitl');
  assert.equal(none.r.declaration.guardrailClasses['2'], 'hitl');
  assert.deepEqual([...none.r.notChecked].sort(), ['line 2: "every invoice appears exactly once" \u2014 no sheet check covers it', 'line 2: "flag amounts over 500" \u2014 no sheet check covers it']);
});

test('the column choice an agreed ask wrote is not a rule to cover, and the header the drafter may pick from is the whole sheet', async () => {
  assert.equal(isColumnChoiceRule(columnRuleWords('Price', 'Amount')), true);
  assert.equal(isColumnChoiceRule('flag amounts over 500'), false);
  const c = CHECKS().slice(1); c[0].covers = [1];
  const sheetWord = reply(JSON.stringify({ facts: [{ from: 'line 2 rule 1', word: 'Price', kind: 'number' }] }));
  const p = fakeProvider([sheetWord, toolReply({ ...decl(c), steps: decl(c).steps.map((s) => (s.fromLine === 2 ? { ...s, close: { ...s.close, columns: [{ source: 'aging', column: 'Amount' }] } } : s)) })]);
  const r = await draft({ proseText: prose(`flag amounts over 500; ${columnRuleWords('Price', 'Amount')}`), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.notChecked, [], 'the mapping rule is a column choice; the other rule is covered');
  assert.deepEqual(p.blockTurns.find((t) => t.name === 'submit_edits').schema.properties.sheetChecks.items.properties.column.enum, HEADER);
});

test('the older asks still ask once: a word that is no column asks, before any drafting round and any sheet schema is sent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10b3-'));
  try {
    const csv = path.join(dir, 'aging.csv');
    writeFileSync(csv, `Date,Description,Amount,Tax\n${Array.from({ length: 6 }, (_, i) => `2026-09-0${i + 1},Item ${i},${100 + i}.50,`).join('\n')}\n`);
    const p = fakeProvider([reply(JSON.stringify({ facts: [{ from: 'line 2 rule 1', word: 'Price', kind: 'number' }] })), textReply()]);
    const r = await draft({ proseText: prose('Price over 500').replace(AGING_CSV, csv), provider: p, rates: RATES, modelId: MODEL });
    assert.equal(r.stop, 'look-asks');
    assert.equal(r.questions.length, 1);
    assert.match(r.questions[0].question, /^no column 'Price'; 'Amount' has numbers in 6 of 6 rows\. Use it\?/);
    assert.equal(p.calls.length, 1, 'only the sheet call was paid');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
