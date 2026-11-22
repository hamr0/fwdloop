// M19 S8 (docs/wiki/the-module-ladder.md, M19 S8 and section 3.7): the Result fold, the cases of bareloop v0.61.0 tests/shape-views.test.js that fwd can run (the view model, the cells, the fold's words), drawn by the page's own functions.
// Copied cases: 'the view model', 'a shape line of 5+ fields folds' (the fold for any field count: the grid of 4 fields is gone, so every count draws the fold), 'every cell shows the item's own value', 'the fold draws no separate errors list'.
// Not copied (they read the card, the Audit and rows of S3-S7, or bareloop's own renderRunMd, covered by test/m19-s3-shape-rows.test.js, test/m19-s7-audit-lines.test.js and test/m19-s8-report.test.js): the card, the [default] row, shapeFieldSentence, flattenStep,
// per-row results (2), the report of renderRunMd, the page's shape card and Audit rows, the Audit model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildShapePart } from '../src/shaperows.js';
import { shapeResultModel, shapeMarkdown } from '../src/shaperesult.js';

const PAGE = readFileSync(fileURLToPath(new URL('../src/panel/index.html', import.meta.url)), 'utf8');
const fnSrc = (name) => { const start = PAGE.indexOf(`function ${name}(`); assert.ok(start !== -1, name); let depth = 0; let i = PAGE.indexOf('{', start); for (; i < PAGE.length; i += 1) { if (PAGE[i] === '{') depth += 1; else if (PAGE[i] === '}') { depth -= 1; if (depth === 0) break; } } return PAGE.slice(start, i + 1); };
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const names = ['gridGlyph', 'gridMarkOf', 'resultField', 'resultNotChecked', 'shapeFoldHtml', 'shapeResultCard'];
const { shapeResultCard } = new Function('escapeXml', `var RESULT_NONE = "no saved result to show";\n${names.map(fnSrc).join('\n')}\nreturn { shapeResultCard };`)(escapeXml);
const draw = (m, detail = { flow: 'j', runId: 'run-1' }, notChecked = [], many = false, n = 1) => shapeResultCard({ n, kind: 'shape', shape: m, notChecked }, detail, many);

test('the view model: marks per cell from the item reds, short values, the red words name the worker\'s own value, the Failed list', () => {
  const part = buildShapePart({ text: 't', fields: [
    { name: 'title', spec: { kind: 'text', required: true, minChars: 1 }, rule: 1, by: 'you' },
    { name: 'status', spec: { kind: 'oneOf', values: ['in progress', 'closed', 'finished'] }, rule: 2, by: 'you' },
    { name: 'summary', spec: { kind: 'text', maxChars: 199 }, rule: 3, by: 'you' },
  ] });
  const rules = ['each item has a title', 'status is in progress, closed or finished', 'the summary is under 200 characters'];
  const results = [
    { title: 'Cell culture notes', status: 'in progress', summary: 'x'.repeat(142) }, { title: 'Soil sample log', status: 'closed', summary: 'x'.repeat(88) },
    { title: 'Field survey', status: 'done', summary: 'x'.repeat(120) }, { title: 'Water quality review', status: 'finished', summary: 'x'.repeat(236) },
  ];
  const m = shapeResultModel({ part, results, rules, reds: ['#2:status:not-one-of', '#3:summary:too-long:chars:236>199'] });
  assert.deepEqual(m.columns, [{ name: 'title' }, { name: 'status' }, { name: 'summary' }]);
  assert.deepEqual([m.total, m.passed, m.failed], [4, 2, 2]);
  assert.equal(m.rows[2].name, '3 · Field survey');
  assert.deepEqual(m.rows[2].cells, [{ mark: 'g', text: 'Field survey' }, { mark: 'r', text: 'done', why: 'is "done", not one of: in progress, closed, finished' }, { mark: 'g', text: `${'x'.repeat(39)}… (120 chars)` }]);
  assert.deepEqual(m.rows[3].cells.map((c) => c.mark + c.text), ['gWater quality review', 'gfinished', `r${'x'.repeat(39)}… (236 chars)`]);
  assert.deepEqual(m.errors, ['item 3: status is "done", not one of: in progress, closed, finished', 'item 4: summary is too long (236 characters, under 200)']);
  assert.match(shapeMarkdown(m), /\| 3 · Field survey \| ✓ Field survey \| ✗ done \| ✓ x{39}… \(120 chars\) \|\n/);
  const whole = shapeResultModel({ part, results: [null], rules, reds: ['#0:item-not-object'] });
  assert.deepEqual(whole.rows[0].cells.map((c) => c.mark), ['r', 'r', 'r']);
});

test('the fold for any number of fields: one <details> per item, `N · name  ✓ k of n  ▸`, a failed item open with its field line and red reason', () => {
  const mk = (n) => {
    const fields = Array.from({ length: n }, (_v, k) => ({ name: k === 0 ? 'title' : `f${k}`, spec: k === 0 ? { kind: 'text', minChars: 1 } : { kind: 'text', maxChars: 9 }, rule: 1, by: 'you' }));
    const ok = Object.fromEntries(fields.map((f) => [f.name, 'abc']));
    const bad = { ...ok, f1: 'x'.repeat(30) };
    return shapeResultModel({ part: buildShapePart({ text: 't', fields }), results: [ok, bad], reds: ['#1:f1:too-long:chars:30>9'], rules: ['t'] });
  };
  const five = draw(mk(5));
  assert.match(five, /data-testid="shape-fold"/);
  assert.doesNotMatch(five, /data-testid="shape-grid"/);
  assert.match(five, /<b>j<\/b> · run-1 · <b>2<\/b> items · <b>1<\/b> passed · <b>1<\/b> failed/);
  assert.match(five, /<details class="sf-item" data-testid="shape-item"><summary>.*?1 · abc.*?5 of 5/);
  assert.match(five, /<details class="sf-item bad" data-testid="shape-item" open><summary>.*?4 of 5/);
  assert.match(five, /data-result="failed"><span class="k">f1<\/span><span class="g"><span class="mark red">✗<\/span><\/span><span class="v">xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \(30 chars\) <span class="why">· is too long/);
  for (const n of [1, 3, 4, 12]) {
    const few = draw(mk(n));
    assert.match(few, /data-testid="shape-fold"/, `${n} fields draw the fold`);
    assert.doesNotMatch(few, /shape-grid|<table/);
    assert.equal((few.match(/data-testid="shape-item"/g) ?? []).length, 2);
    assert.equal((few.match(/data-testid="shape-field"/g) ?? []).length, 2 * n, `${n} fields: one line per field per item`);
  }
});

test('the stats line and the heading: `<job> · <run> · N items · N passed · N failed`, `Result` or `Result · line <n>` when the tab has several lines', () => {
  const part = buildShapePart({ text: 't', fields: [{ name: 'a', spec: { kind: 'text', minChars: 1 }, rule: 1, by: 'you' }] });
  const m = shapeResultModel({ part, results: [{ a: 'x' }, { a: 'y' }, { a: 'z' }], reds: [], rules: ['t'] });
  const one = draw(m, { flow: 'resumes', runId: 'run-7' });
  assert.match(one, /<h4>Result<\/h4>/);
  assert.match(one, /<p class="tg-stats" data-testid="shape-stats"><b>resumes<\/b> · run-7 · <b>3<\/b> items · <b>3<\/b> passed · <b>0<\/b> failed<\/p>/);
  assert.match(draw(m, { flow: 'resumes', runId: 'run-7' }, [], true, 2), /<h4>Result · line 2<\/h4>/);
  assert.match(draw(null), /data-testid="result-nofile">no saved result to show</);
});

test('every cell shows the item\'s own value (clipped, escaped): a free title, a list joined, yes/no, a number; a bounded field adds its words in brackets', () => {
  const part = buildShapePart({ text: 't', fields: [
    { name: 'title', spec: { kind: 'text', required: true, minChars: 1 }, rule: 1, by: 'you' },
    { name: 'blurb', spec: { kind: 'text', maxWords: 9 }, rule: 1, by: 'you' },
    { name: 'tags', spec: { kind: 'list', of: { kind: 'text' } }, rule: 1, by: 'you' },
    { name: 'remote', spec: { kind: 'boolean' }, rule: 1, by: 'you' },
    { name: 'long', spec: { kind: 'text', minChars: 1 }, rule: 1, by: 'you' },
  ] });
  const m = shapeResultModel({ part, rules: ['t'], results: [{ title: 'Ada <b>', blurb: 'two words', tags: ['a', 'b'], remote: true, long: 'y'.repeat(60) }] });
  const t = m.rows[0].cells.map((c) => c.text);
  assert.equal(t[0], 'Ada <b>');
  assert.equal(t[1], 'two words (2 words)');
  assert.equal(t[2], 'a, b (2 entries)');
  assert.equal(t[3], 'yes');
  assert.equal(t[4], `${'y'.repeat(39)}…`);
  assert.match(draw(m), /Ada &lt;b&gt;/);
  assert.doesNotMatch(draw(m), /Ada <b>/);
});

test('the fold draws no separate errors list for any field count (its reasons sit on the opened items\' red lines)', () => {
  const mk = (n) => {
    const fields = Array.from({ length: n }, (_v, k) => ({ name: `f${k}`, spec: { kind: 'text', maxChars: 9 }, rule: 1, by: 'you' }));
    const bad = Object.fromEntries(fields.map((f) => [f.name, 'abc'])); bad.f1 = 'x'.repeat(30);
    return shapeResultModel({ part: buildShapePart({ text: 't', fields }), results: [bad], reds: ['#0:f1:too-long:chars:30>9'], rules: ['t'] });
  };
  for (const n of [3, 5]) {
    assert.doesNotMatch(draw(mk(n)), /shape-errors/);
    assert.match(draw(mk(n)), /class="why">· is too long/);
  }
});
