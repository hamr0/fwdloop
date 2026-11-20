// M19 S8: the Result tab's server side for a shape line (src/panel/result.js `buildResult`, `shapeAnswerOf`): kind `shape`, the fold model of src/shaperesult.js, the red reasons read back from the run's plain gap lines.
// A line with no `itemShape` close is byte-identical to before S8 (test/fixtures/m19-s8/non-shape-result.json was made by the code at e49f1e35, the commit before S8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildResult } from '../src/panel/result.js';
import { buildShapePart, SHAPE_TRUTH_WORDS } from '../src/shaperows.js';
import { closeByClass } from '../src/closers.js';
import { runFolder, nonShapeInputs, ARBITER, HISTORY } from './m19-s8-result-inputs.mjs';

const GOLDEN = fileURLToPath(new URL('./fixtures/m19-s8/non-shape-result.json', import.meta.url));

test('a line with no list-of-items check: the Result JSON is byte-identical to the code before S8 (a text line, a facts line, a softgreen line)', () => {
  const r = buildResult(nonShapeInputs());
  assert.equal(JSON.stringify(r, null, 1), readFileSync(GOLDEN, 'utf8'));
  assert.ok(r.lines.every((l) => l.kind !== 'shape' && !('shape' in l)));
});

const fields = (n) => Array.from({ length: n }, (_v, k) => ({ name: k === 0 ? 'title' : `f${k}`, spec: k === 0 ? { kind: 'text', required: true, minChars: 1 } : { kind: 'text', maxChars: 9 }, rule: 1, by: 'you' }));
const shapeInputs = (n, artifact, log = null, historyRow = HISTORY) => {
  const part = buildShapePart({ text: 'the items of line 1', fields: fields(n) });
  const { root, runDir } = runFolder(artifact ? { s1: artifact } : {}, log);
  const lines = [{ n: 1, text: 'List the items', guardrail: 'each f is under 10 characters' }];
  const declaration = { steps: [{ fromLine: 1, goal: 'List the items', emits: 's1', close: { class: 'green', itemShape: { fields: part.fields } } }] };
  return { flow: 'job', runId: 'run-1', runDir, root, flowRead: { declaration, lines }, arbiter: ARBITER, historyRow, auditRows: [], logJson: log, notChecked: [], readNotes: [], setupRows: [], door: null };
};
const item = (n, over = {}) => ({ ...Object.fromEntries(fields(n).map((f) => [f.name, 'abc'])), ...over });

test('a green run: the line is kind shape with the fold model of the delivered answer, any number of fields; the Not checked line is code\'s', () => {
  for (const n of [1, 4, 9]) {
    const r = buildResult(shapeInputs(n, { results: [item(n), item(n)], done: true, blocker: null }));
    const l = r.lines[0];
    assert.equal(l.kind, 'shape');
    assert.equal(l.shape.columns.length, n);
    assert.deepEqual([l.shape.total, l.shape.passed, l.shape.failed], [2, 2, 0]);
    assert.deepEqual(l.shape.rows[0].cells.map((c) => c.mark), Array(n).fill('g'));
    assert.deepEqual(l.notChecked, [SHAPE_TRUTH_WORDS]);
  }
});

test('a red run: the failed item is marked and carries the reason in the code-owned words, read back from the attempt\'s plain gap lines; the others pass', async () => {
  const part = buildShapePart({ text: 't', fields: fields(5) });
  const answer = { results: [item(5), item(5, { f1: 'x'.repeat(30) })], done: true, blocker: null };
  const closed = await closeByClass({ fromLine: 1, close: { class: 'green', itemShape: { fields: part.fields } } }, answer, { reads: {}, businessDate: '2026-11-20' });
  assert.equal(closed.verdict, 'red', 'the close really is red on this answer');
  const log = { runId: 'run-1', outcome: 'red', attempts: [{ step: 's1', attempt: 1, class: 'green', verdict: 'red', gap: closed.red, modelOutput: answer }], artifacts: {}, red: closed.red };
  const r = buildResult(shapeInputs(5, null, log, { outcome: 'red' }));
  const l = r.lines[0];
  assert.equal(l.kind, 'shape');
  assert.deepEqual([l.shape.total, l.shape.passed, l.shape.failed], [2, 1, 1]);
  assert.deepEqual(l.shape.rows[1].cells.map((c) => c.mark), ['g', 'r', 'g', 'g', 'g']);
  assert.equal(l.shape.rows[1].cells[1].why, 'is too long (30 characters, under 10)');
  assert.match(l.shape.errors[0], /^item 2: f1 is too long/);
  assert.deepEqual(l.shape.rows[0].cells.map((c) => c.mark), Array(5).fill('g'));
});

test('a red run with no readable answer: shape is null (the page says "no saved result to show"), the line stays kind shape', () => {
  const r = buildResult(shapeInputs(3, null, { runId: 'run-1', outcome: 'red', attempts: [], artifacts: {} }, { outcome: 'red' }));
  assert.equal(r.lines[0].kind, 'shape');
  assert.equal(r.lines[0].shape, null);
});

test('a gap line of another job line or a made-up item sentence is no item red', async () => {
  const answer = { results: [item(3)], done: true, blocker: null };
  const log = { attempts: [{ step: 's1', attempt: 1, verdict: 'red', gap: 'line 2: item 1: "f1" is too long (30 characters, at most 9)\nline 1: item 1 was lovely', modelOutput: answer }] };
  const r = buildResult(shapeInputs(3, null, log, { outcome: 'red' }));
  assert.deepEqual([r.lines[0].shape.passed, r.lines[0].shape.failed], [1, 0]);
});
