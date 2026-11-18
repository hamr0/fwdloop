// M15 am3 item 2: the heading over the AI's text follows the signed list (bareloop v0.60.0 proseNotChecked): a Not checked `~` rule on the line says "not checked"; none says "The answer".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeJobText } from '../src/whole-job.js';

const NOT_CHECKED = "### The AI's answer (not checked — you judge it at Accept)";
const steps = [
  { fromLine: 1, goal: 'Say hi', emits: 'a1', close: { class: 'green' } },
  { fromLine: 2, goal: 'Say bye', emits: 'a2', close: { class: 'green' } },
  { fromLine: 3, goal: 'Ask', emits: 'a3', close: { class: 'hitl' } },
];
const askLines = new Map([[3, {}]]);
const ctx = (checkList) => ({ ok: true, jobLines: [], checkList, tables: {}, okIdsOf: () => null });
const run = (checkList) => wholeJobText({ steps, askLines, lastAskIndex: 2, readResult: (id) => ({ ok: true, value: { text: `text of ${id}` } }), context: ctx(checkList) });

test('a line with a Not checked ~ rule writes the not-checked heading; a line with none writes "The answer"', () => {
  const list = [
    { line: 1, kind: 'rule', state: 'not-checked', rule: 1, reason: 'no check was picked' },
    { line: 1, kind: 'floor', state: 'built' },
    { line: 2, kind: 'rule', state: 'built', rule: 1 },
    { line: 2, kind: 'floor', state: 'built' },
  ];
  const out = run(list);
  assert.equal(out.ok, true);
  const [one, two] = out.value.text.split('## 2.');
  assert.ok(one.includes(NOT_CHECKED) && !one.includes('### The answer'), one);
  assert.ok(two.includes('### The answer') && !two.includes(NOT_CHECKED), two);
});
test('a plan with no list on the line keeps the older reading', () => {
  const out = run(null);
  assert.equal(out.ok, true);
  assert.equal(out.value.text.split('### The answer').length, 3);
});
