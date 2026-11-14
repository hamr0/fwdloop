// M16 am4 (1): a sheet check runs through bareguard's check helpers (checkTables, runTableChecks, checkSchema, claimSchema, groundedValues, groundedLiterals, columnAt);
// fwd's own copies of that logic are gone. Must fail when a sheet check runs from fwd's own copy instead of bareguard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSchema, claimSchema, rubricVocabulary } from 'bareguard';
import { sheetCheckReds, sheetCheckWordReds, sheetCheckColumns } from '../src/sheetchecks.js';
import * as sheetchecks from '../src/sheetchecks.js';
import * as sheetoffer from '../src/sheetoffer.js';
import { sheetChecksProp, WHERE_CMPS } from '../src/sheetoffer.js';
import { sheetAnswerProps } from '../src/sheetclaims.js';
import { tableChecksFailingOnInput } from '../src/sheetrun.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const TABLES = { t: { header: ['Id', 'Amount', 'Due'], rows: [{ rowNumber: 2, cells: ['a', '5', '2026-01-01'] }, { rowNumber: 3, cells: ['a', '7', '2026-01-02'] }] } };
const line = { n: 3, text: 'Count the rows over 500' };

test('the helpers are imported from bareguard where each sheet check runs, and fwd keeps no copy of their logic', () => {
  const chk = src('sheetchecks.js');
  assert.match(chk, /import \{[^}]*\bcheckTables\b[^}]*\bgroundedLiterals\b[^}]*\} from 'bareguard'/);
  for (const gone of ['numbersSaid', 'NUMBER_CMPS', 'DATE_CMPS', 'COLUMN_STRING_FIELDS', 'COLUMN_OPERAND_FIELDS', 'COLUMN_CELL_FIELDS', 'COLUMN_LIST_FIELDS']) assert.equal(chk.includes(gone), false, `sheetchecks.js no longer holds ${gone}`);
  assert.equal(/^import .*createRubric/m.test(chk), false, 'sheetchecks.js builds no rubric of its own');
  assert.match(chk, /columnAt/, 'sheetCheckColumns reads the vocabulary\'s columnAt');
  const run = src('sheetrun.js');
  assert.match(run, /import \{[^}]*\brunTableChecks\b[^}]*\} from 'bareguard'/);
  const fn = run.slice(run.indexOf('export async function tableChecksFailingOnInput'));
  assert.ok(fn.includes('runTableChecks(') && !fn.includes('closeSheet('), 'the draft-time table check runs through runTableChecks, not through the run-time close');
  const off = src('sheetoffer.js');
  assert.match(off, /import \{[^}]*\bcheckSchema\b[^}]*\} from 'bareguard'/);
  for (const gone of ['function fieldSchema', 'condition-list', 'band-list', 'date-format-list']) assert.equal(off.includes(gone), false, `sheetoffer.js no longer holds ${gone}`);
  assert.equal(off.includes("'gt', 'gte'"), false, 'WHERE_CMPS is read from the vocabulary, not copied');
  const cl = src('sheetclaims.js');
  assert.match(cl, /import \{[^}]*\bclaimSchema\b[^}]*\} from 'bareguard'/);
  assert.equal(cl.includes('function schemaOf'), false);
});

test('the removed fwd functions are not exported any more', () => {
  for (const gone of ['COLUMN_STRING_FIELDS', 'COLUMN_OPERAND_FIELDS', 'COLUMN_CELL_FIELDS', 'COLUMN_LIST_FIELDS']) assert.equal(gone in sheetchecks, false, gone);
  assert.equal('headerUnion' in sheetoffer, false);
});

test('a row-math constant the person never said is a red: that is bareguard\'s reading of the literals (fwd\'s old copy did not read b.const)', () => {
  const c = { id: 'rm', rule: 'table', table: 't', op: 'rowMath', a: 'Amount', fn: 'add', b: { const: 12345 }, result: 'Due' };
  const reds = sheetCheckWordReds([c], line);
  assert.equal(reds.length, 1);
  assert.match(reds[0], /declaration: line 3: the sheet check 'rm' has the number 12345 \(row math b\), but 12345 is not in your words on line 3\./);
  assert.deepEqual(sheetCheckWordReds([{ ...c, b: { const: 500 } }], line), []);
});

test('the word reds keep fwd\'s words for a number and a date in a where condition', () => {
  const c = { id: 'big', rule: 'cells', table: 't', claim: 'a', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 9999 }, { column: 'Due', cmp: 'after', value: '2026-02-02' }] };
  const reds = sheetCheckWordReds([c], line);
  assert.equal(reds.length, 2);
  assert.match(reds[0], /has the number 9999 \(where Amount\), but 9999 is not in your words on line 3\./);
  assert.match(reds[1], /has the date 2026-02-02 \(where Due\), but 2026-02-02 is not a date in your words on line 3\./);
});

test('the sign-time reds come from checkTables: no saved copy, a wrong column, and a check it refuses each keep fwd\'s words', () => {
  const ok = { id: 'n', rule: 'cells', table: 't', claim: 'n', op: 'sum', column: 'Amount' };
  assert.deepEqual(sheetCheckReds([ok], 3, TABLES), []);
  assert.match(sheetCheckReds([{ ...ok, table: 'zz' }], 3, TABLES)[0], /line 3: the sheet check reads "zz", which has no saved copy/);
  assert.match(sheetCheckReds([{ ...ok, column: 'Nope' }], 3, TABLES)[0], /line 3: 'Nope' is not a real column of "t" \(its columns: 'Id', 'Amount', 'Due'\)\. Copy a column name exactly\./);
  assert.match(sheetCheckReds([{ ...ok, op: 'nope' }], 3, TABLES)[0], /^declaration: line 3: bareguard refuses the sheet check 'n': /);
});

test('the columns of a check are the vocabulary\'s columnAt fields', () => {
  const V = /** @type {any} */ (rubricVocabulary);
  const c = { id: 'rm', rule: 'table', table: 't', op: 'rowMath', a: 'Amount', fn: 'add', b: { const: 1 }, result: 'Due' };
  assert.deepEqual(sheetCheckColumns(c).sort(), ['Amount', 'Due']);
  const w = { id: 'w', rule: 'cells', table: 't', claim: 'c', op: 'countIf', where: [{ column: 'Id', cmp: 'empty' }] };
  assert.deepEqual(sheetCheckColumns(w), ['Id']);
  assert.equal(V.rules.cells.fields.where.columnAt, 'each.column');
});

test('a table check that fails on the sheet is found by runTableChecks and read in fwd\'s words', async () => {
  const bad = { id: 'dup', rule: 'table', table: 't', op: 'noDuplicates', column: 'Id' };
  const reds = await tableChecksFailingOnInput({ steps: [{ fromLine: 3, close: { class: 'green', sheet: [bad] } }] }, TABLES);
  assert.equal(reds.length, 1);
  assert.match(reds[0], /^line 3: the table check "no duplicate Id" already fails on the input "t" \(rows sharing a value: 2, 3\)/);
});

test('the drafter\'s check schema is bareguard\'s checkSchema (plus covers, minus the free-text field) and the answer box is bareguard\'s claimSchema', () => {
  const bg = checkSchema({ rules: ['cells', 'table'], columns: TABLES.t.header, tables: ['t'] });
  const mine = sheetChecksProp(TABLES).items;
  assert.deepEqual(Object.keys(mine.properties).sort(), [...Object.keys(bg.properties).filter((k) => k !== 'text'), 'covers'].sort());
  assert.deepEqual(mine.properties.where.items, bg.properties.where.items);
  assert.deepEqual(mine.properties.dateFormats, bg.properties.dateFormats);
  assert.deepEqual(WHERE_CMPS, rubricVocabulary.rules.cells.fields.where.cmps);
  const c = { id: 'r', rule: 'cells', table: 't', claim: 'ans', op: 'rows', where: [{ column: 'Id', cmp: 'notEmpty' }], covers: [1] };
  const { covers: _c, ...plain } = c;
  assert.deepEqual(sheetAnswerProps([c]).properties.ans, claimSchema(plain));
});
