// M19 S3 guard (hamr 2026-11-19: "checks move inside with the same flow we have, don't make unneccessary drift"): the check block caught up to bareloop v0.60.0's shape
// (src/checkblock.js holds the sheet part, the prose row, the repo rows) must give, for every fixture job this repo holds, the SAME rows, tags, Not-checked reasons, signed closes and card words
// as before the catch-up. The snapshot in test/fixtures/m19-block-snapshot/ was written from the v0.57.0-shaped block BEFORE the port (test/m19-block-snapshot.mjs says how); it is never
// rewritten to pass: a diff is a change to a screen word or a check, and goes to hamr. $0, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSnapshots } from './m19-block-snapshot.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm19-block-snapshot');
const was = (/** @type {string} */ k) => JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8'));
const now = await allSnapshots();

for (const group of /** @type {const} */ (['blocks', 'drafts', 'csv', 'fixtures'])) {
  test(`m19 snapshot: the ${group} snapshot holds entries and each is unchanged`, () => {
    const keys = Object.keys(was(group));
    assert.ok(keys.length > 0, 'an empty snapshot proves nothing');
    assert.deepEqual(Object.keys(now[group]), keys, 'the same scenarios, in the same order');
    const diffs = keys.filter((k) => JSON.stringify(now[group][k]) !== JSON.stringify(was(group)[k]));
    assert.deepEqual(diffs, [], `changed: ${diffs.join(' | ')}`);
  });
}

test('m19 snapshot: it covers sheet rows, an Agree, a Drop and an Add back (a guard that holds none cannot fail)', () => {
  const csv = was('csv');
  assert.ok(Object.keys(csv).some((k) => k.startsWith('drop L2.sheet.')) && Object.keys(csv).some((k) => k.startsWith('drop-then-add ')));
  assert.ok(Object.keys(was('blocks')).some((k) => k.endsWith('+agree')));
  assert.ok(Object.values(was('fixtures')).some((f) => Array.isArray(f.checkList) && f.checkList.length > 0));
});
