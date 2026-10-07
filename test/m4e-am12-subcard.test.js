// M4e amendment 12 (docs/wiki/the-module-ladder.md): a Runs sub-card reads `(run-<n>) <word> — <label>` on one line and
// drops the flow name; the flow card / History row keep `<flow> (run-<n>)`. The page's own buildRunRowEl over a fake DOM. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
function fnSrc(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }', start) + 4);
}
function build(r, opts) {
  const row = { attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute() {}, addEventListener() {} };
  const document = { createElement: () => row };
  const body = `
    var currentFlow = null, currentRunId = null;
    function openRunFromRuns(){}
    function runMetaLineHtml(){ return '<span class="wf-meta-line">$0.0616 · 7m28s · 2026-10-06</span>'; }
    ${fnSrc('escapeXml')} ${fnSrc('signHtml')} ${fnSrc('dotClass')} ${fnSrc('glyphClass')} ${fnSrc('buildRunRowEl')}
    return buildRunRowEl;`;
  return new Function('document', body)(document)(r, opts);
}
const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&mdash;/g, '—');
const RUN = { flow: 'm4e-exit-3a', runId: 'run-1', glyph: '[✓]', word: 'passed', line: 'goal met', label: 'passed' };

test('sub-card line 1 reads `(run-1) passed — goal met` and shows no flow name; title keeps the full name', () => {
  const row = build(RUN, { sub: true });
  const line1 = row.innerHTML.slice(0, row.innerHTML.indexOf('<span class="wf-meta-line">'));
  assert.equal(text(line1), '(run-1) passed — goal met');
  assert.ok(!text(row.innerHTML).includes('m4e-exit-3a'), 'no flow name in visible text');
  assert.match(row.innerHTML, /title="m4e-exit-3a \(run-1\)"/);
  assert.equal(row.attrs['aria-label'], 'm4e-exit-3a (run-1)');
  assert.match(row.innerHTML, /\$0\.0616 · 7m28s · 2026-10-06/);
});

test('a sub-card with no line has no dash', () => {
  const row = build({ ...RUN, line: '' }, { sub: true });
  assert.ok(!text(row.innerHTML).includes('—'));
});

test('without opts (flow card, History) the row still reads `<flow> (run-<n>)`', () => {
  const row = build(RUN);
  assert.match(text(row.innerHTML), /^m4e-exit-3a \(run-1\)passed — goal met/);
  assert.match(row.innerHTML, /title="m4e-exit-3a \(run-1\)"/);
});

test('only the Workflows sub-card builder passes sub; History and the flow card do not', () => {
  assert.equal((PAGE.match(/buildRunRowEl\(r, \{ sub: true \}\)/g) || []).length, 1);
  assert.match(PAGE, /runs\.forEach\(function\(r\)\{ el\.appendChild\(buildRunRowEl\(r\)\); \}\)/);
  assert.match(PAGE, /buildRunRowEl\(g\.lastRow\)/);
});
