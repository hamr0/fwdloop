// 320px walk fix: the top-right Clear/Abandon button must not cover the radio row's second label. Source pin only (layout is
// measured in a real browser): under a narrow breakpoint the radio row reserves right padding for the button.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('narrow viewports reserve right padding on the radio row so the card-clear button cannot overlap its labels', () => {
  const html = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.match(html, /@media \(max-width:400px\)\{\.job-card \.radio-row\{padding-right:\d+px;\}\}/);
});
