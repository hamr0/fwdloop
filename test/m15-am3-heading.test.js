// M15 am3 item 2: the heading over the AI's text follows the signed list (bareloop v0.60.0 proseNotChecked): a Not checked `~` rule on the line says "not checked"; none says "The answer".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeJobText } from '../src/whole-job.js';

const NOT_CHECKED = "### The AI's answer (not checked — you judge it at Accept)";
const steps = [
  { fromLine: 1, goal: 'Say hi', emits: 'a1', close: { class: 'green', shape: { wordsPerSection: { min: 1, max: 9 } } } },
  { fromLine: 2, goal: 'Say bye', emits: 'a2', close: { class: 'green', shape: { wordsPerSection: { min: 1, max: 9 } } } },
  { fromLine: 4, goal: 'Read sheet', emits: 'a4', close: { class: 'hitl' } },
  { fromLine: 5, goal: 'Ask', emits: 'a5', close: { class: 'hitl' } },
];
const askLines = new Map([[5, {}]]);
const ctx = (checkList) => ({ ok: true, jobLines: [], checkList, tables: {}, okIdsOf: () => null });
const run = (checkList) => wholeJobText({ steps, askLines, lastAskIndex: 3, readResult: (id) => ({ ok: true, value: { text: `text of ${id}` } }), context: ctx(checkList) });

test('a line with a Not checked ~ rule writes the not-checked heading; a line with none writes "The answer"', () => {
  const list = [
    { line: 1, kind: 'rule', state: 'not-checked', rule: 1, reason: 'no check was picked' },
    { line: 1, kind: 'floor', state: 'built' },
    { line: 2, kind: 'rule', state: 'built', rule: 1 },
    { line: 2, kind: 'floor', state: 'built' },
  ];
  const out = run(list);
  assert.equal(out.ok, true);
  const [one, two] = out.value.text.split('## 4.')[0].split('## 2.');
  assert.ok(one.includes(NOT_CHECKED) && !one.includes('### The answer'), one);
  assert.ok(two.includes('### The answer') && !two.includes(NOT_CHECKED), two);
});
test('a line whose text no code checked (a hitl cells read, nothing but non-empty) writes the not-checked heading even with no Not checked rule', () => {
  const out = run([{ line: 4, kind: 'floor', state: 'built' }]);
  const sec = out.value.text.split('## 4.')[1];
  assert.ok(sec.includes(NOT_CHECKED) && !sec.includes('### The answer'), sec);
});
test('a plan with no list: the text check decides', () => {
  const out = run(null);
  assert.equal(out.ok, true);
  assert.equal(out.value.text.split('### The answer').length, 3);
});
