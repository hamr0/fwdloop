// M4d amendment 10 piece D: the page only renders the server's step list (state.stepList); the thinking line is in the list and no longer a block
// beside the plan. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HERE } from './m4e-world.mjs';

const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
function fn(name) {
  const start = PAGE.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, name);
  return PAGE.slice(start, PAGE.indexOf('\n    }\n', start) + 7);
}
const steps = new Function(`${fn('plainPlanCheck')}\n${fn('failedDetails')}\n${fn('stepsFor')}\nreturn stepsFor;`)();
const ctx = { model: 'm', starting: false, signClicked: false };
const list = [
  { id: 'thinking', label: 'thinking on (the model thought anyway)', status: 'failed', details: [] },
  { id: 'inputs', label: 'inputs', status: 'done', details: ['aging: 11 columns'] },
  { id: 'drafted', label: 'drafted with deepseek-flash', status: 'done', details: ['1 round · $0.0056'] },
  { id: 'checks', label: 'plan checks', status: 'done', details: [] },
  { id: 'rubrics', label: 'rubrics', status: 'done', details: ['line 3: built'] },
];

test('D1: a green plan renders the server list, then the signature wait; the list replaces the lone "drafted" line', () => {
  const s = steps({ phase: 'green', card: {}, revises: [], stepList: list }, ctx);
  assert.deepEqual(s.map((x) => `${x.id}:${x.status}`), ['thinking:failed', 'inputs:done', 'drafted:done', 'checks:done', 'rubrics:done', 'sign:waiting']);
  assert.deepEqual(s[1].details, ['aging: 11 columns']);
  assert.deepEqual(s[2].details, ['1 round · $0.0056']);
});

test('D2: a red draft: plan checks fails with each refusal as a plain sentence on its own detail line, the raw text folded', () => {
  const reds = ['declaration: steps[2] grants "stash", which is not wired', 'declaration: line 3 is neither served by any step'];
  const s = steps({ phase: 'red', card: {}, stepList: [list[2], { id: 'checks', label: 'plan checks', status: 'failed', details: [], reds }] }, ctx);
  const c = s.find((x) => x.id === 'checks');
  assert.equal(c.status, 'failed');
  assert.equal(c.details.length, 2);
  assert.deepEqual(c.raw, reds);
  assert.ok(s.every((x) => x.id !== 'sign'));
});

test('D3: no stepList (an older draft, or no log) lists what it always did', () => {
  const g = steps({ phase: 'green', card: {}, revises: [] }, ctx);
  assert.deepEqual(g.map((x) => x.label), ['drafted with m', 'waiting for your signature']);
  const r = steps({ phase: 'red', card: {}, reds: ['declaration: x'] }, ctx);
  assert.deepEqual(r.map((x) => x.id), ['drafted', 'checks']);
});

test('D4: while drafting the list is the one "drafting with <model>" line even if a stepList were present', () => {
  assert.deepEqual(steps({ phase: 'drafting', card: {}, stepList: list }, ctx).map((x) => x.id), ['drafting']);
});

test('D5: item 6 - the thinking sentence is no longer a block beside the plan (one place); the thinking line is red, the details grey with "> "', () => {
  const extrasFor = new Function(`${fn('extrasFor')}\nreturn extrasFor;`)();
  const base = { phase: 'green', checked: [], notChecked: { label: 'Not checked', items: [] }, thinkingSay: 'thinking: not confirmed by the model' };
  assert.equal(extrasFor(base).blocks.some((b) => b.id === 'chat-thinking'), false);
  assert.doesNotMatch(PAGE, /chat-thinking/);
  assert.match(PAGE, /\.step\[data-step="thinking"\]\.bad \.step-label\{[^}]*color:var\(--red\)/);
  assert.match(PAGE, /\.chat-steps \.step-detail\{[^}]*color:var\(--text-faint\)/);
  assert.match(PAGE, /\.chat-steps \.step\.bad \.step-detail\{color:var\(--red\);\}/);
});

test('D6: a try line\'s validator refusals go through the SAME plain-sentence path as plan checks, raw folded beside them (one translator)', () => {
  const a = 'declaration: line 2 is marked unjudgeable but guardrailClasses proposes "softgreen" — pick one';
  const b = 'declaration: steps[1].close.shape.sections names "Total Owed", which is not in the job line\'s words — use words from the line';
  const s = steps({ phase: 'green', card: {}, revises: [], stepList: [list[2], { id: 'try-2', label: 'try 2 of 3', status: 'done', details: [], reds: [a, b] }] }, ctx);
  const t = s.find((x) => x.id === 'try-2');
  assert.deepEqual(t.raw, [a, b]);
  assert.equal(t.details.length, 2);
  for (const d of t.details) assert.doesNotMatch(d, /^declaration:/);
  assert.match(t.details[1], /section name in the plan's check is not in your job line/i);
  // a structure reason (no reds) stays a plain detail
  const u = steps({ phase: 'green', card: {}, revises: [], stepList: [{ id: 'try-2', label: 'try 2 of 3', status: 'done', details: ['no usable tool call'] }] }, ctx);
  assert.deepEqual([u[0].details, u[0].raw], [['no usable tool call'], undefined]);
});
