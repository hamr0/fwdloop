// hamr 2026-11-02: field captions on every page are 1px bigger (12px), bold, accent; the Chat card keeps its pills; checkbox/radio labels are not captions. $0, static page checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const body = (start) => { const i = PAGE.indexOf(start); assert.ok(i >= 0, `rule ${start}`); return PAGE.slice(i, PAGE.indexOf('}', i)); };

test('every caption style is 12px bold accent: global label, Ask reason label, Ask box headings, Settings money labels', () => {
  for (const sel of ['\n  label{', '.answer-doors label{', '.evidence-heading{', '.money-item label{']) {
    const r = body(sel);
    assert.match(r, /font-size:12px/, sel); assert.match(r, /font-weight:700/, sel); assert.match(r, /color:var\(--accent\)/, sel);
    assert.doesNotMatch(r, /text-dim/, sel);
  }
  assert.match(body('\n  label{'), /text-transform:uppercase/, 'case kept');
});

test('checkbox and radio labels are not captions: they keep their own colour; the Chat pills are untouched', () => {
  assert.match(body('.field label.jf-thinking{'), /color:var\(--text-dim\)/);
  assert.match(body('.pv-legacy{'), /color:var\(--text-dim\)/);
  assert.match(body('.radio-row label{'), /color:var\(--text\)/);
  assert.match(body('#chat-job-card .field > label:not(.jf-thinking)'), /font-size:13px;font-weight:700;color:var\(--accent\);text-transform:none/);
});

test('hamr 2026-11-02: Run tab ended/next/schedule labels accent bold; Summary and Map captions accent bold 12px; Result grid headings accent bold', () => {
  const lab = body('.ended-label{');
  assert.match(lab, /color:var\(--accent\)/); assert.match(lab, /font-weight:700/); assert.match(lab, /font-size:11px/);
  assert.match(body('.ended-text.is-red,.ended-label.is-red{'), /color:var\(--red\)/, 'red stays red');
  for (const sel of ['.summary-box::before{', '.map-box::before{']) {
    const r = body(sel);
    assert.match(r, /font-size:12px/, sel); assert.match(r, /font-weight:700/, sel); assert.match(r, /color:var\(--accent\)/, sel);
  }
  const th = body('table.grid.tg th{');
  assert.match(th, /color:var\(--accent\)/); assert.match(th, /font-weight:700/);
  assert.match(body('.next-label{'), /color:var\(--accent\);font-weight:700/, 'next instruction labels match the NEXT label');
  assert.doesNotMatch(body('.tg-val{'), /accent/, 'values untouched');
});
