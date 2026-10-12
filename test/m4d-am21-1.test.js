// M4d amendment 21 items 1-2: Start over and the Cap note count what is left of the cap (as a revise does); a missing earlier draft is never counted as $0. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter, tickedConfig } from './m4e-world.mjs';
import { tmp, spendRow, finish } from './m4d-am19-helpers.mjs';
import { draftingSpent } from '../src/draftspend.js';

killChildrenAfter();
const MISSING = "An earlier draft of this job is missing, so its spend can't be counted.";

test('1: a Start over is checked against the month for the pot LEFT (cap minus the earlier session\'s drafting), not the whole cap', async () => {
  const w = await world({ limit: 0.3 });
  const { id } = await finish(w);
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.12)); // pot left 0.25 - 0.12 = 0.13
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 0.2 }))); // room for 0.13, not for 0.25
  const again = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: id });
  assert.equal(again.status, 202, again.text);
});

test('1: the Cap note counts the pot left when it is told which draft the card belongs to', async () => {
  const w = await world({ limit: 0.3 });
  const { id } = await finish(w);
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.12));
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 0.2 })));
  const whole = (await w.get('/api/author/monthly-check?cap=0.25&provider=DEEPSEEK_API_KEY&model=fake-ticked')).json();
  assert.equal(whole.red, true, 'without a draft: the whole cap does not fit the month');
  const left = (await w.get(`/api/author/monthly-check?cap=0.25&provider=DEEPSEEK_API_KEY&model=fake-ticked&draft=${id}`)).json();
  assert.equal(left.red, false, JSON.stringify(left));
});

test('2: a chain link naming a missing folder is flagged, never counted as $0; Start over is refused at $0 with the exact words', async () => {
  const dd = tmp('chain');
  const mk = (name, usd, from) => {
    const d = path.join(dd, name);
    mkdirSync(path.join(d, 'draft'), { recursive: true });
    writeFileSync(path.join(d, 'card.json'), '{}');
    writeFileSync(path.join(d, 'draft', 'spend.jsonl'), spendRow(usd));
    if (from) writeFileSync(path.join(d, 'started-over-from.json'), JSON.stringify({ startedOverFrom: from }));
  };
  mk('d-0000000001-aaaa', 0.1);
  mk('d-0000000002-bbbb', 0.05, 'd-0000000001-aaaa');
  assert.equal(draftingSpent(path.join(dd, 'd-0000000002-bbbb')).missingEarlier, false);
  rmSync(path.join(dd, 'd-0000000001-aaaa'), { recursive: true });
  const gone = draftingSpent(path.join(dd, 'd-0000000002-bbbb'));
  assert.equal(gone.missingEarlier, true);
  assert.equal(gone.complete, false, 'never a clean figure');

  const w = await world();
  const first = await finish(w);
  const second = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: first.id });
  assert.equal(second.status, 202, second.text);
  const sid = second.json().draftId;
  const { until } = await import('./m4e-world.mjs');
  const { isFwdloopAlive } = await import('../src/liveness.js');
  const { readFileSync } = await import('node:fs');
  await until(async () => ['green', 'red', 'stopped'].includes((await w.get(`/api/author/${sid}`)).json()?.phase));
  const pid = JSON.parse(readFileSync(path.join(w.dir(sid), 'pid.json'), 'utf8'));
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
  rmSync(w.dir(first.id), { recursive: true }); // the session the second one started over from is gone
  const ghost = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: sid });
  assert.equal(ghost.status, 400, ghost.text);
  assert.equal(ghost.json().say, MISSING);
  const named = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: 'd-00zzzzzzzz-abcd' }); // names a draft that never existed: also not $0
  assert.equal(named.status, 400, named.text);
  assert.equal(named.json().say, MISSING);
});
