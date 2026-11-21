// F245 (live bug, 2026-11-21): a signed shape-only green line (`close.itemShape` + a pick, no `cited`, no `sheet`) was refused at start as "the retired cell cite", and its
// card/readout opened with the cell-cite lead. Only a close with none of cited, sheet or itemShape is the retired cell cite. Fake declarations, nothing paid.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findUnbuildableCheckStep } from '../src/canrun.js';
import { checkedLines } from '../src/checked.js';

const itemShape = { fields: [{ name: 'title', spec: { kind: 'text', required: true, minChars: 1 }, rule: 1 }] };
const step = (close, fromLine = 2) => ({ primitives: [], reads: ['notes'], emits: 'items', fromLine, goal: 'List every item.', close });
const decl = (...steps) => ({ steps });

test('F245: a green line with itemShape and a pick (no cited, no sheet) is not refused as the retired cell cite', () => {
  const found = findUnbuildableCheckStep(decl(step({ class: 'green', itemShape, picked: [{ rule: 'listItems', value: 4 }] })));
  assert.equal(found, null, found ? found.say : '');
});

test('F245: a true retired cell cite (green, nothing else) is still refused, naming its line', () => {
  const found = findUnbuildableCheckStep(decl(step({ class: 'green' }, 3)));
  assert.equal(found?.step.fromLine, 3);
  assert.ok(found.say.includes("Line 3's check cannot cite cells any more"), found.say);
});

test('F245: a green line with only a pick (no itemShape) is still refused: its close crashes, so a paid run would be wasted', () => {
  const found = findUnbuildableCheckStep(decl(step({ class: 'green', picked: [{ rule: 'listItems', value: 4 }] })));
  assert.equal(found?.step.fromLine, 2);
});

test('F245: the card/readout of an itemShape line opens with no cell-cite lead', () => {
  const lines = checkedLines(decl(step({ class: 'green', itemShape, picked: [{ rule: 'listItems', value: 4 }] })), { hasAsk: false, askLines: [], lines: [] });
  const l2 = lines.find((l) => l.line === 2);
  assert.ok(l2, 'line 2 is there');
  assert.ok(!l2.sentences.some((s) => /cite its source cell|cells/i.test(s)), JSON.stringify(l2.sentences));
});

test('F245: the card/readout of a true retired cell cite keeps its lead', () => {
  const lines = checkedLines(decl(step({ class: 'green' })), { hasAsk: false, askLines: [], lines: [] });
  assert.ok(lines.find((l) => l.line === 2).sentences.some((s) => s.startsWith('Every figure must cite its source cell')));
});
