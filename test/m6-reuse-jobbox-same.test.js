// The Reuse card's job box is the SAME component as the New job card's (gutter + jf-wrap + the one fitBox/paintGutter), not a bare textarea.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const tag = (id) => PAGE.match(new RegExp(`<textarea[^>]*\\sid="${id}"[^>]*>`))?.[0] ?? '';
const box = (id) => PAGE.match(new RegExp(`<div class="jf-gutbox"[^>]*>\\s*<div class="jf-gut" id="${id}-gut"[^>]*><div class="jf-gut-in"></div></div>\\s*<textarea[^>]*\\sid="${id}"`));

test('Reuse job box has the gutter and the New job box classes', () => {
  assert.ok(box('jf-job'), 'New job box is gutbox + gutter + textarea');
  assert.ok(box('jf-run-jobbox'), 'Reuse job box is gutbox + gutter + textarea');
  assert.match(tag('jf-run-jobbox'), /class="jf-wrap"/);
  assert.match(tag('jf-job'), /class="jf-wrap"/);
  assert.match(PAGE, /id="jf-run-jobbox-gut"[^>]*data-testid="jf-run-jobbox-gut"/);
  assert.match(tag('jf-run-jobbox'), /data-testid="jf-run-jobbox"/);
});

test('Reuse job box uses the same sizing and gutter functions and scroll sync', () => {
  const fit = PAGE.match(/function fitCardBoxes\(\)\{[^}]*\}/)?.[0] ?? '';
  assert.match(fit, /fitBox\(jobBoxEl\)/);
  assert.match(fit, /paintGutter\(jobBoxEl, "job"\)/);
  assert.match(PAGE, /\[\[jobEl, "job"\], \[inputsBox, "inputs"\], \[jobBoxEl, "job"\]\]\.forEach/);
  assert.equal((PAGE.match(/function fitBox\(/g) ?? []).length, 1);
  assert.equal((PAGE.match(/function paintGutter\(/g) ?? []).length, 1);
});
