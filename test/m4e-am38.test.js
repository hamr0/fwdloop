// M4e amendment 38 + 39: only the marker (› folded, ⌄ open) is bold accent blue; the step text is plain ink, not bold; a legend closes the Job tab. $0.
// The look itself is a browser walk; these pin the CSS rules and the legend text so they cannot silently drop.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const rule = (sel) => { const m = PAGE.match(new RegExp(`${sel.replace(/[.[\]>]/g, '\\$&')}\\{([^}]*)\\}`)); return m ? m[1] : ''; };

test('--plan is the accent blue in dark, light (media) and light (attr)', () => {
  const accents = [...PAGE.matchAll(/--accent:(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  const plans = [...PAGE.matchAll(/--plan:(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.equal(plans.length, 3);
  assert.deepEqual(plans, accents);
});

test('am39: the step summary text is not bold and is the same ink as your lines', () => {
  assert.doesNotMatch(rule('.plan-sum'), /font-weight:700/);
  assert.match(rule('.plan-sum'), /color:var\(--text\)/);
  assert.doesNotMatch(rule('.plan-sum'), /var\(--plan\)/);
});

test('am39: the open detail rows and head are the plain dim ink, normal weight', () => {
  const sel = '.plan-fold .plan-head,.plan-fold .plan-row';
  assert.match(rule(sel), /color:var\(--text-dim\)/);
  assert.doesNotMatch(rule(sel), /var\(--plan\)/);
  assert.doesNotMatch(rule('.plan-fold .plan-row'), /font-weight:700/);
  assert.doesNotMatch(rule('.plan-fold .plan-head'), /font-weight:700/);
});

test('the marker is CSS: folded shows ›, open shows ⌄, and the summary text no longer carries it', () => {
  assert.match(rule('.plan-sum::before'), /content:"› "/);
  assert.match(rule('.plan-sum::before'), /color:var\(--plan\)/);
  assert.match(rule('.plan-sum::before'), /font-weight:700/);
  assert.match(rule('.plan-fold[open] > .plan-sum::before'), /content:"⌄ "/);
  assert.doesNotMatch(PAGE, /var head = "› step "/);
  assert.match(PAGE, /var head = "step " \+ st\.step/);
});

test('am39: the legend is the last thing in the Job grid, exact text, only the marker in the plan blue and bold', () => {
  const grid = PAGE.slice(PAGE.indexOf('<div id="job-grid"'), PAGE.indexOf('</section>', PAGE.indexOf('<div id="job-grid"')));
  const m = grid.match(/<div class="plan-legend"[^>]*><span class="plan-mark">(›)<\/span> = the approved plan<\/div>/);
  assert.ok(m, 'legend text exact with the marker in its own span');
  assert.ok(grid.indexOf(m[0]) > grid.indexOf('id="details-signature"'), 'after Signed');
  assert.match(grid, /<div class="plan-legend"[^>]*>.*<\/div>\s*<\/div>\s*<\/div>\s*$/);
  assert.match(rule('.plan-legend'), /color:var\(--text-dim\)/);
  assert.doesNotMatch(rule('.plan-legend'), /font-weight:700/);
  assert.match(rule('.plan-legend .plan-mark'), /color:var\(--plan\)/);
  assert.match(rule('.plan-legend .plan-mark'), /font-weight:700/);
});
