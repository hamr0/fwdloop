// M19 am6 to am9 (docs/wiki/the-module-ladder.md): the ONE reader of the plan card's rows (src/checkrows.js). Built from the shape POC F242 (poc/card-model/reader4.mjs). $0, no AI.
// The fixtures are saved plans (test/fixtures/m19-card): their signed declaration and job text. A row that must not be there, a word that must change: each assertion fails on the old card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../src/signed-text.js';
import { csvRolesOf, rulesOfLine } from '../src/sheetblock.js';
import { cardOfPlan, ledgerRowsOf, readLedger, notCheckedName, planMatchesCard, planCard, DEFAULT_ROW_WORDS } from '../src/checkrows.js';

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm19-card');
/** @param {string} n */
const load = (n) => {
  const declaration = JSON.parse(fs.readFileSync(path.join(D, `${n}.declaration.json`), 'utf8'));
  const p = parseSignedText(fs.readFileSync(path.join(D, `${n}.prose.txt`), 'utf8'));
  assert.equal(p.ok, true);
  return { declaration, lines: p.lines, csvRoles: csvRolesOf(p.arbiter) };
};
const textOf = (/** @type {any} */ c, /** @type {string} */ key) => c.rows.find((/** @type {any} */ r) => r.key === key)?.text;

test('am6 item 1, am5 item 3: a phrase row reads the signed words, the tag is the signed row\'s', () => {
  const p = load('flights');
  const c = cardOfPlan(p);
  assert.match(textOf(c, 'L2.~2'), /one of the words "United", "JetBlue", "Delta", "American", "Frontier"$/);
  assert.equal(c.rows.find((r) => r.key === 'L2.~2')?.by, 'you');
  assert.equal(c.rows.filter((r) => r.line === 2 && /^L2\.(fact|phrase)\./.test(r.key)).length, 2);
});

test('am7 item 4: a line\'s rows follow the signed parts\' order, the floor last; the count follows the facts', () => {
  const c = cardOfPlan(load('flights'));
  const keys = c.rows.filter((r) => r.line === 2).map((r) => r.key);
  assert.equal(keys[keys.length - 1], 'L2.$floor');
  assert.ok(keys.indexOf('L2.count.3-3') > keys.indexOf('L2.phrase.chicago ord'), keys.join(' , '));
});

test('am7 item 3: the numbers tie reads "a quote checked on line <n>", tagged default', () => {
  const c = cardOfPlan(load('flights'));
  assert.equal(textOf(c, 'L3.$numbers'), 'every number in the text is in a quote checked on line 2');
  assert.equal(c.rows.find((r) => r.key === 'L3.$numbers')?.by, 'default');
});

test('am7 item 1: a list line\'s field rows read in shapeRowsOf\'s words, [you] for a rule\'s field', () => {
  const c = cardOfPlan(load('shape'));
  assert.equal(textOf(c, 'L2.~1'), 'title · not empty');
  assert.equal(textOf(c, 'L2.~2'), 'status · one of: in progress, closed, finished');
  assert.equal(c.rows.find((r) => r.key === 'L2.~3')?.by, 'you');
});

test('am7 item 2 and item 5: a pick reads its plain words (no "you agreed", no period); one check from two rules is one row', () => {
  const c = cardOfPlan(load('tworules'));
  assert.equal(textOf(c, 'L3.~1'), 'exactly 3 list items');
  assert.equal(c.rows.filter((r) => r.line === 3 && r.key !== 'L3.$floor').length, 1);
  const kept = cardOfPlan({ ...load('tworules'), kept: [{ line: 3, check: { kind: 'items', n: 3 } }] });
  assert.equal(kept.rows.filter((r) => r.line === 3 && r.key !== 'L3.$floor').length, 1);
});

test('am7 item 7: a Tickets row shows only where the signed list holds it; it sits before the floor', () => {
  const p = load('tickets');
  const c = cardOfPlan(p);
  const keys = c.rows.filter((r) => r.line === 2).map((r) => r.key);
  assert.ok(keys.includes('L2.ticket.ticketFilter.1') && keys.indexOf('L2.ticket.ticketFilter.1') < keys.indexOf('L2.$floor'));
  const bare = { ...p, declaration: { ...p.declaration, checkList: p.declaration.checkList.filter((r) => r.kind !== 'ticket') } };
  assert.equal(cardOfPlan(bare).rows.some((r) => /\.ticket\./.test(r.key)), false);
});

test('am8 item 3: Not checked rows are a list of their own, in the signed list\'s order, never among a line\'s rows', () => {
  const p = load('flights');
  const decl = JSON.parse(JSON.stringify(p.declaration));
  decl.checkList.push({ line: 2, key: 'L2.fact.zeta', from: 'look', by: 'agent', kind: 'fact', state: 'not-checked', reason: 'r1' }, { line: 2, key: 'L2.fact.alpha', from: 'look', by: 'agent', kind: 'fact', state: 'not-checked', reason: 'r2' });
  const c = cardOfPlan({ ...p, declaration: decl });
  assert.equal(c.rows.some((r) => r.state === 'not-checked'), false);
  assert.deepEqual(c.notChecked.map((r) => r.key), ['L2.fact.zeta', 'L2.fact.alpha']);
});

test('am8 item 2, am9 items 1 and 2: a rule row reads line, quoted rule text and reason; a prose or stage row only its line and reason', () => {
  const p = load('flights');
  const rule = rulesOfLine(p.lines.find((l) => l.n === 2))[0];
  const decl = JSON.parse(JSON.stringify(p.declaration));
  decl.checkList.push(
    { line: 2, key: 'L2.~1x', from: 'rule', by: 'you', kind: 'rule', rule: 1, state: 'not-checked', reason: 'why' },
    { line: 2, key: 'L2.~9', from: 'rule', by: 'you', kind: 'rule', rule: 9, state: 'not-checked', reason: 'x' },
    { line: 2, key: 'L2.prose.1', from: 'look', by: 'agent', kind: 'prose', state: 'not-checked', reason: 'x' },
    { line: 2, key: 'L2.stage.1', from: 'look', by: 'agent', kind: 'stage', state: 'not-checked', reason: 'x' },
  );
  const nc = cardOfPlan({ ...p, declaration: decl }).notChecked;
  const name = (/** @type {string} */ k) => nc.find((r) => r.key === k)?.text;
  assert.equal(name('L2.~1x'), `line 2: "${rule}" — why`);
  assert.equal(name('L2.~9'), 'line 2: rule 9 — x');
  assert.equal(name('L2.prose.1'), 'line 2: x');
  assert.equal(name('L2.stage.1'), 'line 2: x');
});

test('am8 item 2 and am9 item 4: any other Not checked row reads `<kind> "<ledger words>"` (the page\'s case), else its key\'s tail', () => {
  const p = load('flights');
  const decl = JSON.parse(JSON.stringify(p.declaration));
  decl.checkList.push({ line: 2, key: 'L2.phrase.new york', from: 'look', by: 'agent', kind: 'phrase', state: 'not-checked', reason: 'r' });
  const withLedger = cardOfPlan({ ...p, declaration: decl, log: [{ kind: 'ledger', phase: 'final', key: 'L2.phrase.new york', rowKind: 'phrase', words: ['New York'], state: 'not-checked' }] });
  assert.equal(withLedger.notChecked[0].text, 'phrase "New York"');
  assert.equal(cardOfPlan({ ...p, declaration: decl }).notChecked.find((r) => r.key === 'L2.phrase.new york')?.text, 'phrase "new york"');
});

test('am9 items 3 and 4: cited, numbers, note read their fixed words; a not-checked sheet row is in the list; the floor and a fact line\'s default cited never are', () => {
  const p = load('flights');
  const decl = JSON.parse(JSON.stringify(p.declaration));
  decl.checkList.push(
    { line: 9, key: 'L9.$cited', from: 'default', by: 'default', kind: 'cited', state: 'not-checked', reason: 'r' },
    { line: 9, key: 'L9.$numbers', from: 'default', by: 'default', kind: 'numbers', state: 'not-checked', reason: 'r' },
    { line: 9, key: 'L9.$note', from: 'default', by: 'default', kind: 'note', state: 'not-checked', reason: 'r' },
    { line: 9, key: 'L9.$floor', from: 'default', by: 'default', kind: 'floor', state: 'not-checked', reason: 'r' },
    { line: 2, key: 'L2.$cited', from: 'default', by: 'default', kind: 'cited', state: 'not-checked', reason: 'r' },
    { line: 2, key: 'L2.sheet.over500-rows', from: 'agent', by: 'agent', kind: 'sheet', state: 'not-checked', reason: 'r' },
  );
  const nc = cardOfPlan({ ...p, declaration: decl }).notChecked;
  const name = (/** @type {string} */ k) => nc.find((r) => r.key === k)?.text;
  assert.equal(name('L9.$cited'), 'every claim quotes its input');
  assert.equal(name('L9.$numbers'), 'every number matches a quote');
  assert.equal(name('L9.$note'), 'the note');
  assert.deepEqual(DEFAULT_ROW_WORDS, { cited: 'every claim quotes its input', numbers: 'every number matches a quote', note: 'the note' });
  assert.equal(name('L9.$floor'), undefined);
  assert.equal(name('L2.$cited'), undefined);
  assert.equal(name('L2.sheet.over500-rows'), 'sheet "over500-rows"');
});

test('am8 item 1 and am9 item 5: one ledger row per Not checked row; a rule\'s words are its own text; the last row per key wins', () => {
  const p = load('flights');
  const rule = rulesOfLine(p.lines.find((l) => l.n === 2))[0];
  const decl = JSON.parse(JSON.stringify(p.declaration));
  decl.checkList.push({ line: 2, key: 'L2.~1x', from: 'rule', by: 'you', kind: 'rule', rule: 1, state: 'not-checked', reason: 'why' }, { line: 2, key: 'L2.fact.d', from: 'look', by: 'agent', kind: 'fact', state: 'not-checked', reason: 'r' });
  const rows = ledgerRowsOf(decl, p.lines, { 'L2.fact.d': ['D'] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { kind: 'ledger', phase: 'final', key: 'L2.~1x', rowKind: 'rule', words: [rule], state: 'not-checked' });
  assert.deepEqual(rows[1].words, ['D']);
  const m = readLedger([{ kind: 'ledger', key: 'k', words: ['A'] }, { kind: 'ledger', key: 'z', words: ['Z'] }, { kind: 'ledger', key: 'k', words: ['B'] }, { kind: 'other', key: 'z', words: ['no'] }]);
  assert.equal(m.get('k').words[0], 'B');
  assert.equal(m.get('z').words[0], 'Z');
  assert.equal(notCheckedName({ kind: 'fact', key: 'L2.fact.d', line: 2 }, undefined, undefined), 'fact "d"');
});

test('am6 item 3: the card shown must equal the plan\'s checks line by line; a difference names the line', () => {
  const p = load('flights');
  const card = planCard({ rows: [], suggested: [] }, p);
  assert.deepEqual(planMatchesCard(p, card), []);
  const tampered = { ...card, rows: card.rows.map((r) => (r.key === 'L3.$numbers' ? { ...r, text: 'every number is fine' } : r)) };
  const reds = planMatchesCard(p, tampered);
  assert.equal(reds.length, 1);
  assert.match(reds[0], /line 3/);
  assert.deepEqual(planMatchesCard(p, null), []);
});
