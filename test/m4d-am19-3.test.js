// M4d amendment 19, item 3: Start over keeps the pot (docs/wiki/the-module-ladder.md). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import {
  tmp, spendRow, newHome, cli, proseAt, finish,
} from './m4d-am19-helpers.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

killChildrenAfter();
import { draftingSpent } from '../src/draftspend.js';

test('3: drafting spent before a Start over still comes out of the cap: too little left says "Raise Cap $"', async () => {
  const w = await world();
  const { id } = await finish(w, { capUsd: '0.5' });
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.48)); // 0.50 - 0.48 = 0.02 < one round of the fake provider ($0.0288)
  const again = (await w.post('/api/author/draft', { ...w.card({ capUsd: '0.5' }), startedOverFrom: id })).json().draftId;
  const v = await until(async () => { const x = (await w.get(`/api/author/${again}`)).json(); return ['green', 'red', 'stopped'].includes(x?.phase) ? x : null; });
  assert.equal(v.phase, 'stopped');
  assert.match(v.say, /Cap \$0\.50 less \$0\.48 already spent on drafting leaves \$0\.02, below one drafting round's worst case .* Raise Cap \$ or pick another model\./);
});

test('3: draftingSpent follows the Start-over chain (a session names the one it started over from)', () => {
  const dd = tmp('chain');
  const mk = (name, usd, from) => {
    const d = path.join(dd, name);
    mkdirSync(path.join(d, 'draft'), { recursive: true });
    writeFileSync(path.join(d, 'card.json'), '{}'); // a session folder always has its card (am21: a link to a folder without one is a missing draft)
    writeFileSync(path.join(d, 'draft', 'spend.jsonl'), spendRow(usd));
    if (from) writeFileSync(path.join(d, 'started-over-from.json'), JSON.stringify({ startedOverFrom: from }));
  };
  mk('d-0000000001-aaaa', 0.1);
  mk('d-0000000002-bbbb', 0.05, 'd-0000000001-aaaa');
  mk('d-0000000003-cccc', 0.02, 'd-0000000002-bbbb');
  assert.ok(Math.abs(draftingSpent(path.join(dd, 'd-0000000003-cccc')).usd - 0.17) < 1e-9);
  mk('d-0000000004-dddd', 0.01, 'd-0000000004-dddd'); // a name pointing at itself must not loop
  assert.ok(Math.abs(draftingSpent(path.join(dd, 'd-0000000004-dddd')).usd - 0.01) < 1e-9);
});

