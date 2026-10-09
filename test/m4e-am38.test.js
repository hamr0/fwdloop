// M4e amendment 38: the plan lines are bold blue (the panel's accent blue), an open step shows ⌄ and a folded one ›, and a legend closes the Job tab. $0.
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

test('the step summary line is bold, folded or open', () => {
  assert.match(rule('.plan-sum'), /font-weight:700/);
  assert.doesNotMatch(PAGE, /\.plan-fold\[open\] > \.plan-sum\{font-weight:700;\}/);
});

test('the open detail is the same blue, not bold', () => {
  assert.match(rule('.plan-fold .plan-row'), /color:var\(--plan\)/);
  assert.doesNotMatch(rule('.plan-fold .plan-row'), /font-weight:700/);
});

test('the marker is CSS: folded shows ›, open shows ⌄, and the summary text no longer carries it', () => {
  assert.match(rule('.plan-sum::before'), /content:"› "/);
  assert.match(rule('.plan-fold[open] > .plan-sum::before'), /content:"⌄ "/);
  assert.doesNotMatch(PAGE, /var head = "› step "/);
  assert.match(PAGE, /var head = "step " \+ st\.step/);
});

test('the legend is the last thing in the Job grid, after Signed, in the plan blue', () => {
  const LEGEND = '› blue lines = the approved plan (what the agent does for each of your lines).';
  const grid = PAGE.slice(PAGE.indexOf('<div id="job-grid"'), PAGE.indexOf('</section>', PAGE.indexOf('<div id="job-grid"')));
  assert.ok(grid.includes(LEGEND), 'legend text exact');
  assert.ok(grid.indexOf(LEGEND) > grid.indexOf('id="details-signature"'), 'after Signed');
  assert.match(grid, /<div class="plan-legend"[^>]*>[^<]*<\/div>\s*<\/div>\s*<\/div>\s*$/);
  assert.match(rule('.plan-legend'), /color:var\(--plan\)/);
});

test('the open detail head line is not bold either', () => {
  assert.doesNotMatch(rule('.plan-fold .plan-head'), /font-weight:700/);
});
