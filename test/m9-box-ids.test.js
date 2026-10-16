// Ledger 2026-10-16: one value must not mean two things. The id of each Run-tab box agrees with its class:
// the ENDED / NEXT / SCHEDULED box is id "ended-block" (class ended-block); the old SUMMARY box is id "summary-box" (class summary-box).
// Internal names only; nothing on the page changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const tagWithClass = (cls) => PAGE.match(new RegExp(`<div[^>]*class="${cls}"[^>]*>`))?.[0] ?? '';

test('the ended-block box has id ended-block and the summary-box box has id summary-box', () => {
  assert.match(tagWithClass('ended-block'), /\bid="ended-block"/);
  assert.match(tagWithClass('summary-box'), /\bid="summary-box"/);
});

test('the page code reads each box by the id that matches its class', () => {
  const renderSummary = PAGE.slice(PAGE.indexOf('function renderSummary('));
  assert.match(renderSummary.slice(0, 200), /getElementById\("ended-block"\)/);
  assert.match(PAGE, /getElementById\("summary-box"\);\n\s*box\.className = "summary-box "/);
  assert.equal((PAGE.match(/ id="run-summary"/g) ?? []).length, 0, 'the old id run-summary is gone');
});
