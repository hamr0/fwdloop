// M19 amendment C (docs/wiki/the-module-ladder.md, "Amendments A-E", C): the report's shape section is bareloop's (`shapeMarkdown`, v0.61.0). Three Must-fail lines, one test each, plus the hash binding (M15 am3 item 6).
//   1. a check mark appears outside a shape line's table;  2. a value in the table differs from the accepted answer;  3. a `✗` appears in a report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildShapePart } from '../src/shaperows.js';
import { renderReportBody } from '../src/report.js';
import { wholeJobText, sendBodyOf, reportContextOf } from '../src/whole-job.js';

const PART = buildShapePart({ text: 'the items of line 2', fields: [
  { name: 'name', spec: { kind: 'text', required: true, minChars: 1 }, rule: 2, by: 'you' },
  { name: 'blurb', spec: { kind: 'text', required: true, maxWords: 59 }, rule: 1, by: 'you' },
  { name: 'matching', spec: { kind: 'list', of: { kind: 'text' }, maxEntries: 5 }, by: 'agent' },
  { name: 'remote', spec: { kind: 'boolean' }, by: 'agent' },
  { name: 'tag', spec: { kind: 'oneOf', values: ['a', 'b'] }, by: 'agent' },
] });
const RULES = ['each blurb is under 60 words', 'the candidate has a name'];
const ITEMS = [
  { name: 'Ada Lovelace', blurb: 'Strong fit.', matching: ['python', 'sql'], remote: true, tag: 'a' },
  { name: 'Alan Turing', blurb: 'Good.', matching: [], remote: false, tag: 'b' },
];
const FACTS = { results: [{ quote: 'it costs 9', values: { price: '9' } }] };
const SHEET = [{ id: 'rows', rule: 'cells', table: 't', op: 'rows', claim: 'r', where: [{ column: 'A', cmp: 'gt', value: 1 }] }];
const TABLES = { t: { header: ['A'], rows: [{ rowNumber: 2, cells: ['5'] }] } };
const lines = (shape, items = ITEMS) => [
  { n: 1, kind: 'work', text: 'Write a note', artifact: { text: 'a short note' } },
  { n: 2, kind: 'work', text: 'Read each resume', rules: RULES, artifact: { results: items }, shape },
  { n: 3, kind: 'work', text: 'Quote the price', artifact: FACTS, checks: [] },
  { n: 4, kind: 'work', text: 'List the big rows', artifact: { r: { rows: [2] } }, checks: SHEET },
  { n: 5, kind: 'ask' },
];
const sectionOf = (body, n) => { const i = body.indexOf(`## ${n}. `); if (i < 0) return null; const j = body.indexOf('\n\n## ', i + 1); return body.slice(i, j < 0 ? undefined : j); };

test('amendment C (1): a check mark appears only inside a shape line\'s table; the text, facts, sheet and Ask sections get none and are byte-identical to the report with no shape line', () => {
  const body = renderReportBody(lines(PART), TABLES);
  const plain = renderReportBody(lines(null), TABLES);
  const marks = body.split('\n').filter((l) => l.includes('✓'));
  assert.equal(marks.length, ITEMS.length, 'one marked row per item');
  const shape = /** @type {string} */ (sectionOf(body, 2));
  for (const l of marks) { assert.ok(l.startsWith('| '), `a marked line is a table row: ${l}`); assert.ok(shape.includes(l), 'and it is inside the shape section'); }
  for (const n of [1, 3, 4]) { assert.equal(sectionOf(body, n), sectionOf(plain, n), `line ${n}'s section is byte-identical`); assert.ok(!(/** @type {string} */ (sectionOf(body, n))).includes('✓')); }
  assert.ok(body.endsWith('Line 5: you accepted this at the Ask.'));
  assert.ok(!plain.includes('✓'), 'a report with no shape line holds no check mark (M15 am3 stands)');
});

test('amendment C (2): every value in the table is the accepted answer\'s value, in the answer\'s order; a long value is clipped as bareloop clips it, never changed', () => {
  const long = 'z'.repeat(70);
  const items = [{ ...ITEMS[0], name: long }, { ...ITEMS[1], name: 'a | b\nc' }, ITEMS[0]];
  const body = renderReportBody(lines(PART, items), TABLES);
  const rows = body.split('\n').filter((l) => /^\| \d/.test(l));
  assert.equal(rows.length, 3, 'one row per item, none dropped');
  assert.ok(rows[0].startsWith(`| 1 · ${'z'.repeat(39)}… | ✓ ${'z'.repeat(39)}… | ✓ Strong fit. (2 words) | ✓ python, sql (2 entries) | ✓ yes | ✓ a |`), rows[0]);
  assert.ok(rows[1].startsWith('| 2 · a \\| b c | ✓ a \\| b c | ✓ Good. (1 word) | ✓ 0 entries | ✓ no | ✓ b |'), rows[1]);
  assert.ok(rows[2].startsWith('| 3 · Ada Lovelace | ✓ Ada Lovelace |'), 'the third item is third');
  // the values read back from the table are the answer's own (whitespace folded, the pipe escaped)
  const names = rows.map((r) => r.split(/(?<!\\) \| /)[1].replace(/^✓ /, '').replace(/\\\|/g, '|'));
  assert.deepEqual(names, [`${'z'.repeat(39)}…`, 'a | b c', 'Ada Lovelace']);
});

test('amendment C (3): a `✗` never appears in a report, even for an item that breaks the shape (a report is written for a green run; no item is red there)', () => {
  const bad = [{ ...ITEMS[0], tag: 'z' }, { ...ITEMS[1], name: '' }, null];
  const body = renderReportBody(lines(PART, bad), TABLES);
  assert.ok(!body.includes('✗'));
  assert.ok(!body.includes('### Failed'));
  assert.ok(body.includes('Shape checks (code checks each item\'s form, not whether it is true)'));
});

test('the shape section\'s words: heading, the Rule lines, the shape-checks line, the table, the Not checked line; no AI-answer heading', () => {
  const body = /** @type {string} */ (sectionOf(renderReportBody(lines(PART), TABLES), 2));
  assert.ok(body.startsWith('## 2. Read each resume\nRule: each blurb is under 60 words\nRule: the candidate has a name\n\nShape checks (code checks each item\'s form, not whether it is true)\n\n| item | name | blurb | matching | remote | tag |\n| --- | --- | --- | --- | --- | --- |\n'));
  assert.ok(body.endsWith('\n\nNot checked: whether each one is true (you judge it at Accept)'));
  assert.ok(!body.includes('The AI\'s answer') && !body.includes('### Checked by code'));
  assert.equal(renderReportBody([{ n: 2, kind: 'work', text: 'x', artifact: { results: [] }, shape: PART }], {}), '', 'an answer with no items writes no section');
});

// M15 am3 item 6: the whole-job text built at the last Ask holds the shape section, so the accept's hash binds it; the send writes that text as accepted.
const sha = (t) => createHash('sha256').update(t).digest('hex');
const STEPS = [
  { fromLine: 2, goal: 'Read each resume', emits: 's2', close: { class: 'green', itemShape: { fields: PART.fields } } },
  { fromLine: 3, goal: 'Check it with me', emits: 's3', close: { class: 'hitl' } },
];
const whole = (items) => {
  const ctx = reportContextOf({ runDir: '/nonexistent', steps: STEPS, jobLines: [{ n: 2, text: 'Read each resume', guardrail: RULES.join('; ') }], checkList: null });
  const askLines = new Map([[3, {}]]);
  const r = wholeJobText({ steps: STEPS, askLines, lastAskIndex: 1, readResult: () => ({ ok: true, value: { results: items } }), context: ctx });
  return { r, ctx, askLines };
};
test('the hash binding: the whole-job text carries the shape section; the send gets that text byte for byte; one changed value is another hash', () => {
  const a = whole(ITEMS);
  assert.ok(a.r.ok);
  const text = a.r.value.text;
  assert.ok(text.includes('| 1 · Ada Lovelace | ✓ Ada Lovelace |'));
  const sent = sendBodyOf({ content: { text }, wholeIdx: 0, steps: STEPS, sendIndex: 2, askLines: a.askLines, context: a.ctx });
  assert.deepEqual(sent, { ok: true, body: text });
  const b = whole([{ ...ITEMS[0], name: 'Ada Lovelace II' }, ITEMS[1]]);
  assert.notEqual(sha(b.r.value.text), sha(text));
  // the accepted answer must be the whole text and nothing else: an extra key is refused as today
  assert.equal(sendBodyOf({ content: { text, extra: 1 }, wholeIdx: 0, steps: STEPS, sendIndex: 2, askLines: a.askLines, context: a.ctx }).ok, false);
});
