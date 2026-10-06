// M4e amendment 6 item 4 walk fix: the phone-only cost cell of a Setup row with no cost says "—", never "unknown" (one function, auditCostCellText, for both cells). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
const NAMES = ['escapeXml', 'money', 'duration', 'plainWait', 'verdictPassed', 'readableDateTime', 'verdictGlyph', 'verdictWord', 'closeClassLabel', 'auditTimeCellHtml', 'auditShortTime',
  'auditDetailHtml', 'auditGapText', 'auditCostCellText', 'buildAuditRowEl'];

function build(row) {
  const doc = { createElement: () => ({ classList: { toggle: () => false }, setAttribute() {}, addEventListener() {}, innerHTML: '' }) };
  const src = NAMES.filter((n) => PAGE.includes(`  function ${n}(`)).map(fn).join('\n');
  const { buildAuditRowEl } = new Function('document', `${src}\nreturn { buildAuditRowEl };`)(doc);
  return buildAuditRowEl(row, false).innerHTML;
}
const cell = (html, cls) => new RegExp(`<td class="${cls}">([^<]*)</td>`).exec(html)?.[1];
const setupRow = { attempt: 3, step: 'setup', class: 'hitl', verdict: 'hitl', setup: true, action: 'card (you)', gap: 'job: x', tokensDisplay: { kind: 'no-model' }, at: '2026-10-06T12:00:00.000Z' };

test('the phone cost cell of a Setup row with no cost matches the desktop cell: a dash, not "unknown"', () => {
  const html = build(setupRow);
  assert.equal(cell(html, 'am am-cost'), '—');
  assert.match(html, /<td data-label="Cost">—<\/td>/);
});

test('a real unpriced run row still says unknown on the phone line', () => {
  const html = build({ attempt: 1, step: 'a', class: 'green', verdict: 'green', action: 'model', tokensDisplay: { kind: 'no-model' }, at: '2026-10-06T12:00:00.000Z' });
  assert.match(cell(html, 'am am-cost'), /unknown/);
});
