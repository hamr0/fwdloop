// M4d amendment 19, item 2: a revise checks the month for what is left of the cap (docs/wiki/the-module-ladder.md). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter, until, tickedConfig } from './m4e-world.mjs';
import {
  tmp, spendRow, newHome, cli, proseAt, finish,
} from './m4d-am19-helpers.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

killChildrenAfter();

test('2: a revise is checked against the month for cap minus drafting spent (the whole cap would be a false refusal)', async () => {
  const w = await world({ limit: 0.3 });
  const { id, j } = await finish(w);
  assert.equal(j.phase, 'green');
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.12)); // the pot left is 0.25 - 0.12 = 0.13
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 0.2 }))); // the month now has room for 0.13 but not for the whole cap 0.25
  const r = await w.post(`/api/author/${id}/revise`, w.card());
  assert.equal(r.status, 202, r.text);
});

