// M4e amendment 14 item 3 / amendment 3: "every revise and every Start over is booked as a draft call" — counted once in Money and in
// the month total. Mirrors how first-draft spend is tested in test/m4e-draft-spend.test.js (spendSummary over the monthly record).
// Piece A shipped without it. $0: the real `fwdloop draft` child with the test draft provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isFwdloopAlive } from '../src/liveness.js';
import { readRuns, spendSummary } from '../src/monthly.js';
import { readSpendRows, spendRowCost } from '../src/provider.js';
import {
  JOB, killChildrenAfter, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settled = (w, id) => until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const dirCost = (dir) => readSpendRows(path.join(dir, 'spend.jsonl')).reduce((n, r) => n + spendRowCost(r).usd, 0);

test('a first draft, a revise and a Start over are each ONE booked draft call: Money and the month total count all three once', async () => {
  const w = await world({ limit: 5 });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await settled(w, id);
  await childGone(w, id);
  const first = path.join(w.dir(id), 'draft');
  const firstUsd = dirCost(first);
  assert.ok(firstUsd > 0, 'the first draft booked its call');
  const one = spendSummary({ home: w.home });
  assert.ok(Math.abs(one.total.usd - firstUsd) < 1e-12, 'one draft so far');

  const rv = await w.post(`/api/author/${id}/revise`, w.card({ job: JOB.replace('Read my resume,', 'Read my resume EDIT,') }));
  assert.equal(rv.status, 202, rv.text);
  const s1 = await until(async () => { const j = await state(w, id); return j.phase === 'green' && j.revises?.length === 1 ? j : null; });
  await childGone(w, id);
  await until(async () => (readRuns(w.home).filter((r) => r.kind === 'hold' && r.what === 'draft').length === 2 && dirCost(path.join(w.dir(id), 'draft-1')) > 0 ? true : null));
  const reviseUsd = dirCost(path.join(w.dir(id), 'draft-1'));
  assert.ok(reviseUsd > 0, 'the revise booked its own call');

  const so = await w.post('/api/author/draft', s1.card);
  assert.equal(so.status, 202, so.text);
  const id2 = so.json().draftId;
  await settled(w, id2);
  await childGone(w, id2);
  await until(() => (dirCost(path.join(w.dir(id2), 'draft')) > 0 ? true : null));
  const startOverUsd = dirCost(path.join(w.dir(id2), 'draft'));

  const holds = readRuns(w.home).filter((r) => r.kind === 'hold' && r.what === 'draft');
  assert.equal(holds.length, 3, 'three draft calls, three holds');
  const want = firstUsd + reviseUsd + startOverUsd;
  const sum = spendSummary({ home: w.home });
  assert.ok(Math.abs(sum.total.usd - want) < 1e-12, `Money total ${sum.total.usd} vs ${want}`);
  assert.ok(Math.abs(sum.month.usd - want) < 1e-12, `month total ${sum.month.usd} vs ${want}`);
  assert.equal(sum.total.atLeast, false);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'draft-1', 'draft-spend.json'), 'utf8')).inFlight, false);
});
