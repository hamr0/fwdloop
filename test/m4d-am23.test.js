// M4d amendment 23 (signed 2026-10-16): a Cap at or below what the earlier draft already spent is red with the Resume words. Plus the ledger fix:
// a non-string startedOverFrom is refused by name (it used to skip the am21 check and get a fresh full pot). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter } from './m4e-world.mjs';
import { spendRow, finish } from './m4d-am19-helpers.mjs';
import { leastResumeCapUsd } from '../src/panel/authorvalues.js';

killChildrenAfter();
const url = (cap, id) => `/api/author/monthly-check?cap=${cap}&provider=DEEPSEEK_API_KEY&model=fake-ticked&draft=${id}`;

test('am23: a Cap at or below what the earlier draft spent is red in the Resume words; above it, not that note', async () => {
  const w = await world({ limit: 0.3 });
  const { id } = await finish(w);
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.12));
  for (const cap of ['0.12', '0.05']) {
    const r = (await w.get(url(cap, id))).json();
    assert.equal(r.red, true, `${cap}: ${JSON.stringify(r)}`);
    assert.equal(r.text, `The cap must be above what is already spent (at least $${leastResumeCapUsd(0.12, r.floorUsd).toFixed(2)}).`);
  }
  const above = (await w.get(url('0.25', id))).json();
  assert.doesNotMatch(above.text, /must be above what is already spent/);
  const noDraft = (await w.get('/api/author/monthly-check?cap=0.05&provider=DEEPSEEK_API_KEY&model=fake-ticked')).json();
  assert.doesNotMatch(noDraft.text, /must be above what is already spent/, 'no earlier draft: nothing spent');
});

test('ledger: a non-string startedOverFrom (123, {}) is refused by name, 400, nothing created; absent, null and "" still start fresh', async () => {
  const w = await world({ limit: 0.3 });
  for (const bad of [123, {}, [], true]) {
    const r = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: bad });
    assert.equal(r.status, 400, `${JSON.stringify(bad)}: ${r.text}`);
    assert.equal(r.json().refused, 'started-over-from');
    assert.match(r.json().say, /startedOverFrom/);
  }
  for (const ok of [undefined, null, '']) {
    const r = await w.post('/api/author/draft', { ...w.card(), ...(ok === undefined ? {} : { startedOverFrom: ok }) });
    assert.equal(r.status, 202, `${JSON.stringify(ok)}: ${r.text}`);
    const { until } = await import('./m4e-world.mjs');
    await until(async () => ['green', 'red', 'stopped'].includes((await w.get(`/api/author/${r.json().draftId}`)).json()?.phase));
  }
});
