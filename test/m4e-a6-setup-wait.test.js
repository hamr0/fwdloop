// M4e amendment 6 item 6 walk fix: a Sign & run row's ask waits read through the Job tab's plainWait ("1h 30m"), data.js hands the page typed waits. $0.
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
  const src = NAMES.map(fn).join('\n');
  const { buildAuditRowEl } = new Function('document', `${src}\nreturn { buildAuditRowEl };`)(doc);
  return buildAuditRowEl(row, false).innerHTML;
}
const setupRow = { attempt: 3, step: 'setup', class: 'hitl', verdict: 'hitl', setup: true, action: 'card (you)', gap: 'job: x', tokensDisplay: { kind: 'no-model' }, at: '2026-10-06T12:00:00.000Z' };

test('a Sign & run row prints its ask wait plainly: 90m reads 1h 30m, an unreadable wait stays as typed', () => {
  const html = build({
    ...setupRow, action: 'Sign & run (hamr)', gap: 'cap $0.4 · ask waits line 4: 90m',
    gapHead: ['cap $0.4'], gapWaits: [{ line: '4', wait: '90m', waitMs: 5_400_000 }, { line: '7', wait: 'soon', waitMs: null }],
  });
  assert.match(html, /cap \$0\.4 · ask waits line 4: 1h 30m, line 7: soon/);
  assert.doesNotMatch(html, /90m/);
});
