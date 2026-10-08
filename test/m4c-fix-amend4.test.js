// M4c-fix amendment 4: the step cards under the map read in their real case, and the sign badge is one
// `[sign] word` (no second pair of brackets). Source-level, like the rest of the panel tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const rule = (sel) => { const i = PAGE.indexOf(sel + '{'); assert.ok(i !== -1, sel); return PAGE.slice(i, PAGE.indexOf('}', i)); };

test('no uppercase on the card header row (head, its h4)', () => {
  assert.doesNotMatch(rule('.step-card .step-head'), /uppercase/);
  // the global `h2,h4` rule uppercases; the card's own h4 rule must turn it off
  assert.match(rule('.step-card h4'), /text-transform:none/);
});

test('a signed state chip drops the badge brackets (one [sign] word); close chip and "not started" keep them', () => {
  assert.match(PAGE, /\.sign-badge::before,\.sign-badge::after\{content:none;\}/);
  const i = PAGE.indexOf('function buildStepCardHeadEl(');
  const body = PAGE.slice(i, PAGE.indexOf('\n  }', i));
  assert.match(body, /STEP_SIGN\[box\.state\] \? " sign-badge" : ""/);
  assert.match(body, /closeBadge\.className = "badge cyan"/); // close chip stays a plain bracketed badge
});
