// M11 amendment 18 (signed 2026-10-17); am19 (same day) replaced its words: the faint line above the runs search box says what the search and chips reach.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');

test('am18: the faint line above the runs search box reads exactly the am19 words', () => {
  const m = PAGE.match(/data-testid="rl-filter-note">([^<]*)</);
  assert.ok(m, 'the note exists');
  assert.equal(m[1], 'search also finds Scheduled; ◷ shows only Scheduled');
  assert.doesNotMatch(PAGE, /filters below act on Jobs and quiet jobs only<\/div>/);
});
