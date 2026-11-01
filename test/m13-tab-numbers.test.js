// Chat card looks (hamr rulings 2026-11-01): variant A captions, and no [n] numbers on the tab rows. $0, static page checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

test('tab rows: no [n] numbers on either side', () => {
  assert.doesNotMatch(PAGE, /counter\((r?tabnum)\)/);
  assert.doesNotMatch(PAGE, /counter-(reset|increment):r?tabnum/);
  assert.doesNotMatch(PAGE, /\.(rp-)?tabrow button::before/);
});
