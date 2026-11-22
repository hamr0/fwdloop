// M19 am7 items 1 to 3 and 8 (docs/wiki/the-module-ladder.md): the Job tab and the Audit's Checks fold read a list line's rows through the one reader (src/checkrows.js), in the card's words.
// $0, no AI. Fixtures: test/fixtures/m19-card (saved plans).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../src/signed-text.js';
import { listPartRows, checkedLines } from '../src/checked.js';

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm19-card');
const load = (/** @type {string} */ n) => ({ declaration: JSON.parse(fs.readFileSync(path.join(D, `${n}.declaration.json`), 'utf8')), lines: /** @type {any} */ (parseSignedText(fs.readFileSync(path.join(D, `${n}.prose.txt`), 'utf8'))).lines });
const stepOn = (/** @type {any} */ decl, /** @type {number} */ line) => decl.steps.find((/** @type {any} */ s) => s.fromLine === line);

test('am7 item 1 and 8: the Job tab draws a list line\'s field rows in shapeRowsOf\'s words, [you] for a rule\'s field, and counts the shape part', () => {
  const { declaration, lines } = load('shape');
  const rows = listPartRows(declaration, stepOn(declaration, 2), { lines });
  assert.deepEqual(rows.map((r) => r.text), ['title · not empty', 'status · one of: in progress, closed, finished', 'summary · under 200 characters']);
  assert.deepEqual(rows.map((r) => r.by), ['you', 'you', 'you']);
  assert.deepEqual(rows.map((r) => r.part), [0, 0, 0]);
});

test('am7 item 8: a pick after the shape part is counted as part 1 and tagged by its own row', () => {
  const { declaration, lines } = load('shape');
  const decl = JSON.parse(JSON.stringify(declaration));
  const st = stepOn(decl, 2);
  st.close.picked = [{ kind: 'words', max: 80 }];
  decl.checkList.push({ line: 2, key: 'L2.~9', from: 'agent', by: 'agent', kind: 'rule', state: 'built', rule: 9, part: { line: 2, part: 1 } });
  const pick = listPartRows(decl, st, { lines }).find((r) => r.part === 1);
  assert.ok(pick);
  assert.equal(pick.by, 'agent');
});

test('am7 items 2 and 3: a pick reads its plain words, the numbers tie "a quote checked on line <n>"; no period, no "you agreed"', () => {
  const t = load('tworules');
  const pick = listPartRows(t.declaration, stepOn(t.declaration, 3), { lines: t.lines });
  assert.deepEqual(pick.map((r) => r.text), ['exactly 3 list items']);
  const f = load('flights');
  const num = listPartRows(f.declaration, stepOn(f.declaration, 3), { lines: f.lines });
  assert.deepEqual(num.map((r) => r.text), ['every number in the text is in a quote checked on line 2']);
  assert.equal(num[0].by, 'default');
});

test('am7 item 2: a pick a Revise carried reads " · kept from last draft"', () => {
  const t = load('tworules');
  const st = stepOn(t.declaration, 3);
  const check = st.close.picked?.[0] ?? st.close.shape?.picked?.[0];
  const rows = listPartRows(t.declaration, st, { lines: t.lines, kept: [{ line: 3, check }] });
  assert.equal(rows[0].text, 'exactly 3 list items · kept from last draft');
});

test('am7 items 2 and 8: the plan card\'s sentences of a list line (checkedLines) carry the same words', () => {
  const t = load('tworules');
  const out = checkedLines(t.declaration, { askLines: [], lines: t.lines });
  const on3 = out.find((l) => l.line === 3);
  assert.ok(on3?.sentences.some((s) => s.includes('exactly 3 list items') && !s.includes('you agreed') && !/\.$/.test(s.replace(/\s*\[\w+\]\s*$/, ''))), JSON.stringify(on3?.sentences));
});
