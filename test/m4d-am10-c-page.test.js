// M4d amendment 10 piece D: the page only renders the server's step list (state.stepList); the thinking line is in the list and no longer a block
// beside the plan. $0.
import assert from 'node:assert/strict';
import { RULES_PRELUDE } from './plan-check-rules.mjs';
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
const steps = new Function(`${RULES_PRELUDE}\n${fn('plainPlanCheck')}\n${fn('failedDetails')}\n${fn('stepsFor')}\nreturn stepsFor;`)();
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

test('D2 (am15): a red draft renders the server list as it is: a ✗ plan-checks line and the Fix line under it; no details, no raw', () => {
  const l = [list[2], { id: 'checks', label: "plan checks · A line of your job is not covered by any step", status: 'failed', details: [] },
    { id: 'checks-fix', label: 'Fix: put it in the job line.', status: 'done', details: [], note: true }];
  const s = steps({ phase: 'red', card: {}, stepList: l }, ctx);
  assert.deepEqual(s.map((x) => `${x.id}:${x.status}${x.note ? ':note' : ''}`), ['drafted:done', 'checks:failed', 'checks-fix:done:note']);
  assert.deepEqual(s.map((x) => x.details), [[...list[2].details], [], []]);
  assert.ok(s.every((x) => x.raw === undefined));
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

test('D7 (am15): the Fix line is a note (no ✓/✗) and red only comes from the status of the line above; renderProgress draws both', () => {
  const html = new Function('escapeXml', 'progressOpen', 'progressRow', `var progressHtml = "";\n${fn('renderProgress')}\nreturn renderProgress;`);
  const row = { hidden: true, innerHTML: '' };
  html((x) => String(x), {}, row)([
    { id: 'checks', label: 'plan checks · x', status: 'failed', details: [] },
    { id: 'checks-fix', label: 'Fix: y', status: 'done', details: [], note: true },
    { id: 'drafted', label: 'drafted · m · 1 round · $0.0001', status: 'done', details: [] },
  ]);
  assert.match(row.innerHTML, /<li class="step bad" data-step="checks"><div class="step-line"><span class="step-label">plan checks · x<\/span><span class="step-sign">✗<\/span>/);
  assert.match(row.innerHTML, /<li class="step ok note" data-step="checks-fix"><div class="step-line"><span class="step-label">Fix: y<\/span><span class="step-sign"><\/span>/);
  assert.doesNotMatch(row.innerHTML, /step-detail|grey/);
  assert.match(PAGE, /\.chat-steps \.step\.note \.step-label\{[^}]*color:var\(--text\)/);
});
