// M11 amendment 4 item 4 (docs/wiki/the-module-ladder.md): the Inbox status chips read, in this order, accepted, redo, rerun, expired.
// The page builds them from Object.keys(INBOX_CHIP_WORD), so the object's key order IS the on-page order; this pins the rendered order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fnSrc = (name) => cutFn(PAGE, name, '  ');
const WORDS = PAGE.match(/ {2}var INBOX_CHIP_WORD = [^\n]*/)?.[0];
assert.ok(WORDS, 'INBOX_CHIP_WORD line not found');
const filterBarHTML = new Function(`${WORDS}\n${fnSrc('filterBarHTML')}\nreturn filterBarHTML;`)();

test('the rendered Inbox status chips are accepted, redo, rerun, expired, in that order', () => {
  const html = filterBarHTML('inbox', true);
  const chips = [...html.matchAll(/data-filter-group="result" data-filter-value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(chips, [['accepted', 'accepted'], ['redo', 'redo'], ['reran', 'rerun'], ['expired', 'expired']]);
});
