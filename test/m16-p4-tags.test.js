// M16 P4 item 1 and 2 (docs/wiki/the-module-ladder.md, "M16" items 1 and 5): the tag of a check on a list line is the `by` of its row, written in ONE place
// (src/checkwords.js) and read by the plan card, the readout and the Audit; a sheet row and an old plan keep their words. $0, no provider. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tagOf, tagged, labelled } from '../src/checkwords.js';
import { checkedLines, notCheckedView, notCheckedLabelOf, NOT_CHECKED_LABEL } from '../src/checked.js';
import { closeRecords } from '../src/try-checks.js';
import { partByOf, factByOf } from '../src/checklistsign.js';
import { buildReadout } from '../src/authoring.js';

const row = (/** @type {any} */ o) => ({ state: 'built', ...o });
/** a list plan: line 1 quotes a page (fact by the agent), line 2 is a text line with a rule of the person's, an agent count, and the numbers tie */
const listDecl = () => ({
  steps: [
    { primitives: ['read'], reads: ['page'], emits: 'a1', fromLine: 1, goal: 'read the page', close: { class: 'green', cited: { source: 'page', facts: [{ name: 'city', shape: 'phrase', phrase: 'Boston' }] } } },
    { primitives: [], reads: ['a1'], emits: 'a2', fromLine: 2, goal: 'write', close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }, { rule: 'listItems', value: 3 }] }, numbersFrom: [1] } },
  ],
  guardrailClasses: { 2: 'softgreen' },
  checkList: [
    row({ key: 'L1.$floor', line: 1, kind: 'floor', by: 'default' }),
    row({ key: 'L1.fact.city', line: 1, kind: 'fact', by: 'agent', part: { line: 1, part: 0 }, facts: ['city'] }),
    row({ key: 'L2.$floor', line: 2, kind: 'floor', by: 'default' }),
    row({ key: 'L2.~1', line: 2, kind: 'rule', by: 'you', part: { line: 2, part: 0 } }),
    row({ key: 'L2.count', line: 2, kind: 'count', by: 'agent', part: { line: 2, part: 1 } }),
    row({ key: 'L2.$numbers', line: 2, kind: 'numbers', by: 'default', part: { line: 2, part: 2 } }),
  ],
});
const stripped = () => { const d = listDecl(); delete (/** @type {any} */ (d)).checkList; return d; };
const TAGS = /\[(you|agent|default)\]$/;

test('(item 1) the tags are one spelling: [you] [agent] [default] by a row\'s by; any other by has none', () => {
  assert.deepEqual(['you', 'agent', 'default'].map(tagOf), ['[you]', '[agent]', '[default]']);
  assert.equal(tagOf('picked'), '', 'break: let tagOf read the old label words and this reds');
  assert.equal(tagged('x', 'agent'), 'x [agent]');
  assert.equal(tagged('x', undefined), 'x');
});

test('(item 1) the plan card of a list line: every check sentence carries exactly the tag of its own row', () => {
  const lines = checkedLines(listDecl());
  const l1 = lines[0].sentences; const l2 = lines[1].sentences;
  assert.ok(l1.slice(1).every((s) => TAGS.test(s)) && l1.some((s) => /\[agent\]$/.test(s)), JSON.stringify(l1));
  assert.deepEqual(l2.slice(1).map((s) => /\[(\w+)\]$/.exec(s)?.[1]), ['you', 'agent', 'default'], JSON.stringify(l2));
  for (const s of [...l1, ...l2]) assert.equal((s.match(/\[(you|agent|default)\]/g) ?? []).length <= 1, true, `one tag per check: ${s}`);
  assert.ok(!JSON.stringify(lines).includes('[you picked]'), 'break: label a list line\'s pick with labelled(...picked) and this reds');
});

test('(item 1) an old plan (no checkList) shows its words as before: [you picked] and [agent]', () => {
  const lines = checkedLines(stripped());
  assert.ok(lines[1].sentences.some((s) => s.endsWith('[you picked]')), JSON.stringify(lines[1]));
  assert.ok(!lines[1].sentences.some((s) => /\[you\]$/.test(s)), 'break: tag by row for a plan with no list and this reds');
});

test('(item 1) the readout of a list plan tags each check by its row; an old plan keeps `you picked`', () => {
  const parsed = { arbiter: { sources: [], asks: [], sends: [], capUsd: 1 }, lines: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }], name: 'x' };
  const text = (/** @type {any} */ d) => buildReadout({ declaration: { ...d, inputFacts: {}, flowType: 'plain' }, arbiter: parsed.arbiter, lines: parsed.lines, name: 'x', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: '/r' });
  const list = text(listDecl());
  assert.match(list, /\n {5}at most 80 words \[you\]\n/);
  assert.match(list, /\n {5}exactly 3 list items \[agent\]\n/);
  assert.doesNotMatch(list, /you picked/);
  assert.match(text(stripped()), /you picked: at most 80 words \[you picked\]/);
});

test('(item 1) the Audit rows of a list line carry the row\'s by, not a baked label; a line off the list keeps its label', () => {
  const step = listDecl().steps[1];
  const closed = { verdict: 'green', checks: [{ id: 'keys', text: 'one key', ok: true, result: null }, { id: 'pick1', text: 'at most 80 words', ok: true, result: null }, { id: 'pick2', text: 'exactly 3 list items', ok: true, result: null }], numbersCheck: { text: 'every number is in a quote', ok: true, result: null } };
  const on = closeRecords(step, { text: 'x' }, closed, listDecl().checkList);
  assert.deepEqual(on.filter((r) => /** @type {any} */ (r).by).map((r) => /** @type {any} */ (r).by), ['you', 'agent', 'default'], JSON.stringify(on));
  assert.ok(on.every((r) => !String(r.text).includes('[')), 'the tag is drawn from `by`, never baked into the words');
  const off = closeRecords(step, { text: 'x' }, closed);
  assert.ok(off.some((r) => String(r.text).endsWith('[you picked]')), 'break: tag without a list and this reds');
  assert.ok(off.every((r) => !('by' in r)));
});

test('(item 2) the label is "Not checked" on a plan with a list, the old words on an older plan', () => {
  assert.equal(notCheckedLabelOf(listDecl()), 'Not checked');
  assert.equal(notCheckedLabelOf(stripped()), NOT_CHECKED_LABEL, 'break: return the new label for every plan and this reds');
  assert.equal(notCheckedView(['tone'], listDecl()).label, 'Not checked');
  assert.equal(notCheckedView(['tone'], stripped()).label, NOT_CHECKED_LABEL);
});

test('(item 1) row readers: the by of a part and of a fact come from the row that points at it', () => {
  const d = listDecl();
  assert.equal(partByOf(d, 2, 1), 'agent');
  assert.equal(partByOf(d, 2, 7), null);
  assert.equal(factByOf(d, 1, 'city'), 'agent');
  assert.equal(labelled('x', 'picked'), 'x [you picked]', 'a sheet row keeps its label');
});

import { readFileSync } from 'node:fs';

test('(Must fail: a sheet job changes) a CSV job\'s sheet check keeps its own `[agent]` label even beside a list line; with its list on another line the sheet row is not retagged', () => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/m16-block/csv/signed-declaration.json', import.meta.url), 'utf8'));
  const before = checkedLines(d)[1].sentences;
  assert.ok(before.some((s) => s === 'rows where Amount > 500 [agent]'), JSON.stringify(before));
  // the same plan with a list on line 1 only: line 2 (the sheet line) is not on the list, so its words do not move
  const withList = { ...d, checkList: [row({ key: 'L1.$floor', line: 1, kind: 'floor', by: 'default' })] };
  assert.deepEqual(checkedLines(withList)[1].sentences, before, 'break: tag every green line by row and this reds');
  assert.equal(notCheckedLabelOf(d), NOT_CHECKED_LABEL);
});
