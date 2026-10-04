// M4c-fix exit walk: on a phone every audit entry is ONE compact line (glyph, step, verdict, cost, HH:MM); the long
// gap hides behind a tap. Source pin — the real-browser numbers (row height, per-box spill at 390/320) were measured
// separately; this fails on the old stacked "label: value" card layout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const start = html.indexOf('ONE ROW PER LINE on a phone');
const mobile = html.slice(html.indexOf('@media (max-width: 480px){', start), html.indexOf('</style>', start));

test('phone audit rows are single flex lines, not stacked label:value cards', () => {
  assert.ok(start > 0, 'the one-row-per-line block exists');
  assert.match(mobile, /\[data-testid="audit-table"\] tr[^{]*\{[^}]*display:flex/);
  assert.doesNotMatch(mobile, /content:attr\(data-label\)/, 'no per-cell "Label: " lines');
  assert.doesNotMatch(mobile, /td[^{]*\{[^}]*display:block;border:none;border-bottom:1px dotted/, 'the old full-width stacked cell is gone');
});

test('the long gap is hidden on a phone until the row is tapped', () => {
  assert.match(mobile, /td\[data-label="Gap"\][^{]*\{[^}]*display:block/, 'shown only under tr.open');
  assert.match(mobile, /tr\.open td\[data-label="Gap"\]/);
  assert.match(html, /tr\.className = "audit-has-gap"/);
  assert.match(html, /classList\.toggle\("open"\)/);
});

test('every audit row carries the short phone cells (glyph, cost, HH:MM) that desktop hides', () => {
  for (const c of ['am am-glyph', 'am am-cost', 'am am-time']) assert.ok(html.includes(`class=\\"${c}\\"`), c);
  assert.match(html, /td\.am\{display:none;\}/, 'desktop layout unchanged: the extra cells are hidden');
});
