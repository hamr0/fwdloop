// M19 amendment 4 (docs/wiki/the-module-ladder.md, "M19 amendment 4"): the draft readout's check rows of a line are the plan card's rows (log.json `checkCard`).
// Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReadout } from '../src/authoring.js';

const arbiter = { capUsd: 0.3, sources: [], asks: [], sends: [] };
const lines = [{ n: 1, text: 'Read the notes.' }, { n: 2, text: 'List every item.', guardrail: 'each item has a title' }, { n: 3, text: 'Write it out.' }];
const step = (n, extra = {}) => ({ fromLine: n, goal: lines[n - 1].text, primitives: ['read'], reads: [], emits: `o${n}`, close: { class: 'hitl' }, ...extra });
const decl = (extra = {}) => ({
  inputFacts: {}, refused: [],
  steps: [step(1), step(2, { close: { class: 'green', itemShape: { fields: [{ name: 'title', kind: 'text' }] } } }), step(3)],
  checkList: [{ key: 'L2.~1', line: 2, kind: 'rule', state: 'built', by: 'you' }, { key: 'L1.$floor', line: 1, kind: 'floor', state: 'built', by: 'default' }],
  ...extra,
});
const card = (extra = {}) => ({
  rows: [
    { key: 'L1.$floor', line: 1, by: 'default', state: 'built', text: "the file exists and its text is not empty (code's own floor)", reason: null, drop: false, kind: 'file' },
    { key: 'L2.~1', line: 2, by: 'you', state: 'built', text: '"each item has a title"', reason: null, drop: true, kind: 'shape' },
    { key: 'L2.~2', line: 2, by: 'you', state: 'built', text: '"under $450"', reason: null, drop: true, kind: 'truth' },
    { key: 'L2.~3', line: 2, by: 'you', state: 'dropped', text: 'not drawn', reason: null, drop: false, kind: 'truth' },
  ],
  suggested: [{ key: 'L2.shape.x', line: 2, text: 'each item has a note' }, { key: 'L2.phrase.bos', line: 2, text: 'fact · BOS', dropped: true }],
  ...extra,
});
const read = (o = {}) => buildReadout({ declaration: decl(), arbiter, lines, name: 'j', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, ...o });
const block = (t, n) => { const L = t.split('\n'); const i = L.findIndex((l) => l.startsWith(`  ${n}. (line`)); const j = L.findIndex((l, k) => k > i && /^ {2}\d+\. \(line|^ {2}EVERY LINE|^$/.test(l)); return L.slice(i, j < 0 ? undefined : j); };

test('a list line\'s CHECKED rows are the card\'s: the field rows show, with the card\'s tag, kind and words, in the card\'s order', () => {
  const b = block(read({ checkCard: card(), suggested: card().suggested }), 2);
  assert.ok(b.some((l) => l.includes('[you]') && l.includes('shape') && l.endsWith('"each item has a title"')), 'break: no itemShape branch and the field row is missing');
  const rows = b.filter((l) => /^ {7}\[/.test(l));
  assert.ok(rows[0].endsWith('"each item has a title"') && rows[1].endsWith('"under $450"'), 'the card\'s order');
  assert.ok(!b.join('\n').includes('not drawn'), 'a row the card does not draw (state dropped) is not told');
  assert.ok(b.includes('     CHECKED · 2'));
});

test('a card plan\'s Suggested rows read as the card draws them: kind by key, "(you dropped it)"', () => {
  const b = block(read({ checkCard: card(), suggested: card().suggested }), 2).join('\n');
  assert.match(b, /\[agent\] {4}shape {2}each item has a note/);
  assert.match(b, /\[agent\] {4}truth {2}fact · BOS \(you dropped it\)/, 'break: the dropped word is left out');
});

test('a card line drops the hand-built words (fact, you picked, sheet check, numbers); the step line, the sections line and the column lock stay', () => {
  const d = decl();
  d.steps[1].close = { class: 'green', itemShape: { fields: [] }, cited: { source: 'p', facts: [{ name: 'price', kind: 'phrase', phrases: ['x'] }] }, sheet: [], picked: [{ kind: 'mustCarry', words: ['a'] }], shape: { sections: ['A', 'B'], picked: [{ kind: 'mustCarry', words: ['b'] }] }, columns: [{ column: 'Amount', source: 'sheet' }] };
  const b = block(read({ declaration: d, checkCard: card(), suggested: [] }), 2).join('\n');
  assert.ok(!/fact · |you picked:|sheet check:/.test(b), 'break: the hand-built rows still print beside the card\'s');
  assert.match(b, /grants: read \| reads: - \| emits: o2 \| check: green/);
  assert.match(b, /sections: A · B/);
  assert.match(b, /cells only from column 'Amount' of sheet/);
});

test('a plan with no card keeps the readout it had (no checkCard, or a declaration with no list)', () => {
  const none = read({ declaration: decl({ checkList: undefined }), checkCard: card() });
  assert.equal(none, read({ declaration: decl({ checkList: undefined }) }), 'break: a card is read for a plan with no list');
  assert.equal(read(), read({ checkCard: null }));
  assert.ok(!block(read(), 2).join("\n").includes("each item has a title"));
});
