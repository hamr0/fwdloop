// Duplicate id="job-card" (Chat card + Job tab card) made getElementById hit the Chat card, leaving the Job tab empty.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

test('index.html has no duplicate id values', () => {
  const seen = new Map();
  for (const m of html.matchAll(/<[a-zA-Z][^>]*?\sid="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
  assert.deepEqual(dups, []);
});

test('renderJob\'s getElementById("job-card") target is the read-only Job tab card', () => {
  const body = html.slice(html.indexOf('function renderJob'));
  assert.match(body.slice(0, 600), /getElementById\("job-card"\)/);
  const m = html.match(/<div[^>]*\sid="job-card"[^>]*>/);
  assert.ok(m, 'an element with id job-card exists');
  assert.match(m[0], /data-testid="job-card-readonly"/);
});
