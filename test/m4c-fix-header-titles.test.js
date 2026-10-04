// M4c-fix amendment 2 (k) run header and (l) short Audit step title. Source pins only — rendering is proved in a real browser walk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const rule = (sel) => {
  const m = new RegExp(`^\\s*${sel.replace(/[.\-]/g, '\\$&')}\\{([^}]*)\\}`, 'm').exec(PAGE);
  assert.ok(m, `rule ${sel} exists`);
  return m[1];
};

test('(k) the run header is sign + name, a bar, word — why, then the time; no frame, no capitals', () => {
  const i = PAGE.indexOf('class="rp-header-title"');
  const head = PAGE.slice(i, PAGE.indexOf('</div>', PAGE.indexOf('id="active-wf-date"')));
  const order = ['id="active-wf-dot"', 'id="active-wf-name"', 'hdr-sep', 'id="active-wf-verdict"', 'id="active-wf-date"'].map((k) => head.indexOf(k));
  assert.ok(order.every((n) => n > 0), 'all five parts present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sign, name, bar, verdict, time in that order');
  assert.doesNotMatch(head, /┤|├/, 'no box frame in the header');
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('.rp-header h2{'), PAGE.indexOf('.hdr-name-line{')), /┤|├|::before|::after/, 'no frame pseudo-elements on the name');
  assert.match(rule('.rp-header h2'), /min-width:0/);
  assert.match(rule('.rp-header h2'), /text-transform:none/);
  assert.match(PAGE, /\.hdr-verdict:has\(\+ \.hdr-time:not\(:empty\)\)::after\{content:" \\00B7";\}/, 'the middle dot trails the verdict, so a wrapped time never starts a line with it');
  assert.doesNotMatch(PAGE, /\.hdr-time[^{]*::before/, 'no dot on the time itself (orphan at a wrapped line start)');
});

test('(k) at 640 px or less the header is three lines: bar and dot hidden, column layout', () => {
  const m = /@media \(max-width: 640px\)\{\s*\/\* \(k\)[^\n]*\n([^\n]*\n[^\n]*\n[^\n]*\n)/.exec(PAGE);
  assert.ok(m, 'phone block for the header');
  assert.match(m[1], /\.rp-header-title\{flex-direction:column/);
  assert.match(m[1], /\.hdr-sep\{display:none/);
  assert.match(m[1], /::after\{content:none/);
});

test('(l) the grouped Audit title is [sign] name · cost · try N, the name cut with an ellipsis, time and tokens not in it', () => {
  assert.match(PAGE, /\.audit-fold-name\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/, 'name cuts with …');
  assert.match(rule('.audit-fold-name'), /min-width:0/);
  const i = PAGE.indexOf('h4.className = "audit-status-header"');
  const body = PAGE.slice(i, PAGE.indexOf('return h4;', i));
  assert.match(body, /audit-fold-name/, 'the name is its own child');
  const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /tokens|timeMs|duration\(/, 'no time or tokens in the title');
});

test('(l) the step map cuts a long name with … and keeps the whole name in a <title>', () => {
  assert.match(PAGE, /function mapLabel\(/);
  assert.match(PAGE, /<title>' \+ escapeXml\(stepTitleText/);
});

test('(l) the sign and caret never shrink, so a narrow title cuts only the name (walk: the sign broke letter by letter at 390 without this)', () => {
  assert.match(PAGE, /audit-status-header > \.badge,[^{]*audit-status-header::before\{flex:none;white-space:pre;\}/);
});
