// M4c-fix amendment 2 (f), Audit "Grouped" view. A source test cannot see rendering, so these pin the rules the
// real-browser walk (1280/390/320, per-box spill via getBoundingClientRect) showed are what fix it:
// a closed group is one header line with a caret, a failed step starts open, a manual toggle survives a re-render,
// and the header sits INSIDE its box so a long one wraps there instead of over the next group.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const rule = (sel) => {
  const m = new RegExp(`^\\s*${sel.replace(/[.\-\[\]="]/g, '\\$&')}\\{([^}]*)\\}`, 'm').exec(page);
  assert.ok(m, `rule ${sel} exists`);
  return m[1];
};
const fn = page.slice(page.indexOf('function renderAuditGroups'), page.indexOf('function renderAuditFlat'));

test('a closed group draws no empty box: its table is display:none even on a phone, where the table rule is display:block', () => {
  assert.match(rule('.audit-group.audit-fold table[hidden]'), /display:none\s*!important/);
  assert.match(fn, /table\.hidden = !isOpen/);
});

test('a closed group shows a right caret and an open one a down caret, driven by aria-expanded', () => {
  assert.match(rule('.audit-group.audit-fold h4.audit-status-header::before'), /content:"\\25B6/);
  assert.match(rule('.audit-group.audit-fold h4.audit-status-header[aria-expanded="true"]::before'), /content:"\\25BC/);
  assert.match(fn, /header\.setAttribute\("aria-expanded", isOpen \? "true" : "false"\)/);
  assert.match(fn, /wrap\.classList\.toggle\("closed", !next\)/);
  assert.match(fn, /header\.addEventListener\("keydown"[\s\S]*?"Enter"[\s\S]*?" "/, 'Enter and Space toggle');
});

test('a step with any failed try (a row with a gap) starts open; the others start closed', () => {
  assert.match(fn, /var failed = \(g\.rows \|\| \[\]\)\.some\(function\(r\)\{ return !!r\.gap; \}\);/);
  assert.match(fn, /auditExpanded\[g\.step\] : failed/);
});

test('a manual toggle wins on a re-render in the same page load, and resets for another run', () => {
  assert.match(fn, /auditExpanded\[g\.step\] = next/);
  assert.match(fn, /hasOwnProperty\.call\(auditExpanded, g\.step\)/);
  assert.match(fn, /auditExpandedRun !== runKey\)\{ auditExpanded = \{\}/);
  const open = page.slice(page.indexOf('function openAuditGroup'), page.indexOf('// What a phone tap shows'));
  assert.match(open, /auditExpanded\[step\] = true/, 'a jump from the map opens it and remembers it');
  assert.match(open, /row\.classList\.remove\("closed"\)/);
});

test('the group header sits inside its box (not pinned over the top edge) and wraps within it', () => {
  const r = rule('.audit-group.audit-fold h4.audit-status-header');
  assert.match(r, /position:static/);
  assert.match(r, /overflow-wrap:anywhere/);
  assert.match(r, /min-width:0/);
  assert.match(r, /max-width:100%/);
  assert.match(fn, /classList\.add\("audit-fold"\)/);
});
