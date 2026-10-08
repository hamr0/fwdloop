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
const mobile = html.slice(html.indexOf('@media (max-width: 640px){', start), html.indexOf('</style>', start));

test('phone audit rows are single flex lines, not stacked label:value cards', () => {
  assert.ok(start > 0, 'the one-row-per-line block exists');
  assert.match(mobile, /\[data-testid="audit-table"\] tr[^{]*\{[^}]*display:flex/);
  assert.doesNotMatch(mobile, /content:attr\(data-label\)/, 'no per-cell "Label: " lines');
  assert.doesNotMatch(mobile, /td[^{]*\{[^}]*display:block;border:none;border-bottom:1px dotted/, 'the old full-width stacked cell is gone');
});

test('everything the line cuts short is hidden on a phone until the row is tapped, then shows in full on wrapped lines', () => {
  // hamr's phone walk: tapping a row showed no extra text (only a row WITH a gap opened, and only the gap showed)
  assert.match(mobile, /\[data-testid="audit-table"\] td\.am\.am-detail, \.audit-group table td\.am\.am-detail\{display:none;\}/, 'hidden until opened, in BOTH tables (an unscoped td.am.am-detail loses to `.audit-group table td.am{display:block}` and leaves every grouped row 135 px tall)');
  assert.match(mobile, /tr\.open td\.am-detail[^{]*\{[^}]*display:block[^}]*flex:0 0 100%[^}]*white-space:normal/, 'shown under tr.open, wrapped, full width');
  assert.match(html, /tr\.className = "audit-tap"/, 'EVERY row is tappable, not only one with a gap');
  assert.doesNotMatch(html, /audit-has-gap/);
  assert.match(html, /tr\.classList\.toggle\("open"\)/);
});

test('the opened block carries step, result, gap, refused, tools, close, cost and time in full', () => {
  const fn = html.slice(html.indexOf('function auditDetailHtml'), html.indexOf('function buildAuditRowEl'));
  for (const label of ['["step", r.step]', '["result", word]', '["action", actionText]', '["gap", auditGapText(r)]', '"refused"', 'r.refused', '"close"', '"cost"', '"time"']) {
    assert.ok(fn.includes(label), label);
  }
  assert.match(html, /"<td class=\\"am am-detail\\">" \+ auditDetailHtml\(/, 'built into every row');
});

test('every audit row carries the short phone cells (glyph, cost, HH:MM) that desktop hides', () => {
  for (const c of ['am am-glyph', 'am am-cost', 'am am-time']) assert.ok(html.includes(`class=\\"${c}\\"`), c);
  assert.match(html, /td\.am\{display:none;\}/, 'desktop layout unchanged: the extra cells are hidden');
});

// hamr's 2026-10-04 walk: the one-line layout stopped at 480 px, so a 500-640 px window still showed the wide table
// (rows 49-607 px tall, 710 px wide in a 485 px page), and a row could wrap onto a second line when its content or the
// system font grew. Real-browser numbers are in the commit message; these pin the two causes.
test('the one-line layout covers the whole phone/narrow range (up to 640 px), not just 480', () => {
  assert.match(html, /@media \(max-width: 640px\)\{\s*(?:\/\*[^*]*\*\/\s*)?\[data-testid="audit-table"\], \.audit-group table\{display:block;width:100%/);
  assert.doesNotMatch(html, /@media \(max-width: 480px\)/, 'no audit rule is left that stops at 480 px');
});

test('a phone audit row never wraps: nowrap + overflow hidden, only a tapped row may take a second (gap) line', () => {
  assert.match(mobile, /\[data-testid="audit-table"\] tr[^{]*\{[^}]*flex-wrap:nowrap[^}]*overflow:hidden/);
  assert.doesNotMatch(mobile, /\[data-testid="audit-table"\] tr, \.audit-group table tr\{[^}]*flex-wrap:wrap/);
  assert.match(mobile, /tr\.open[^{]*\{flex-wrap:wrap;\}/);
  for (const cell of ['am-glyph', 'am-cost', 'am-time']) assert.match(mobile, new RegExp(`td\\.${cell}[^{]*\\{[^}]*flex:0 0 auto`), `${cell} keeps its width`);
});
