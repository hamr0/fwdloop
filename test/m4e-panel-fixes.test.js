// M4e walk fixes F1-F2 (route level): the courtesy "left this month" line reads the limit the way the CLI's monthly check does, at
// request time; a start's refusal survives a reload through `/api/author/live`. $0, scratch dirs, every child killed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createPanelServer } from '../src/panel/server.js';
import { keysForDoor } from '../src/keysfile.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import {
  killChildrenAfter, rq, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

test('F1 the courtesy line reads the monthly limit from FWDLOOP_CONFIG_HOME at request time, like the CLI check (no settings.home injected, config written after the panel started)', async () => {
  const w = await world();
  await w.signedFlow();
  const prev = process.env.FWDLOOP_CONFIG_HOME;
  process.env.FWDLOOP_CONFIG_HOME = w.home;
  // the way `fwdloop panel` builds it: no settings.home, so the door's home (FWDLOOP_CONFIG_HOME) must be the one read
  const h = remember(await createPanelServer({ port: 0, root: w.root, author: { loadEnv: () => keysForDoor({ env: w.env, keysHome: w.home }) } }));
  try {
    const flows = async () => (await rq(h.port, { url: '/api/author/flows' })).json();
    assert.equal((await flows()).leftThisMonth.say, 'no monthly limit set');
    writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 0.1 }));
    const after = await flows();
    assert.equal(after.leftThisMonth.limitUsd, 0.1, JSON.stringify(after.leftThisMonth));
    assert.match(after.flows[0].leftThisMonth.say, /left this month/);
  } finally {
    if (prev === undefined) delete process.env.FWDLOOP_CONFIG_HOME; else process.env.FWDLOOP_CONFIG_HOME = prev;
    await h.close();
  }
});

const startPhase = (w, startId, phases) => until(async () => {
  const j = (await w.get(`/api/author/start/${startId}`)).json();
  return phases.includes(j?.phase) ? j : null;
});
const runBody = (w) => ({ flow: 'job2', inputs: w.inputs(), runId: 'r1' });
const live = async (w) => (await w.get('/api/author/live')).json();

test('F2 a refused start survives a reload: /api/author/live returns it until Clear writes cleared.json; a started or starting one needs no refusal', async () => {
  const w = await world();
  await w.signedFlow();
  assert.equal((await live(w)).start ?? null, null, 'no start yet');
  // lowered below the flow's $0.25 cap after the draft: the CLI child refuses at $0
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 0.1 }));
  const r = await w.post('/api/author/run', runBody(w));
  assert.equal(r.status, 202, r.text);
  const { startId } = r.json();
  await startPhase(w, startId, ['refused']);
  // a reload = a new GET of live: the refusal is still there, with the CLI's own sentence
  const j = await live(w);
  assert.equal(j.start?.startId, startId, JSON.stringify(j));
  assert.equal(j.start.phase, 'refused');
  assert.ok(j.start.say.includes('Nothing spent.') && j.start.say.includes('monthly limit'), j.start.say);
  assert.equal(j.start.kind, 'run');
  // Clear dismisses it: a file in the start folder, and the next live has none
  assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/author/start/s-0000000000-0000/clear', body: {} })).status, 404);
  assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/author/start/nope/clear', body: {} })).status, 404);
  const c = await w.post(`/api/author/start/${startId}/clear`, {});
  assert.equal(c.status, 200, c.text);
  assert.ok(existsSync(path.join(w.root, '.starts', startId, 'cleared.json')));
  assert.equal((await live(w)).start ?? null, null);
  assert.equal((await rq(w.h.port, { method: 'POST', url: `/api/author/start/${startId}/clear`, body: {}, headers: { cookie: null } })).status, 403, 'the same gated door');
  // a start that began (a run exists) is not returned: nothing to re-attach, nothing refused
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 50 }));
  const r2 = await w.post('/api/author/run', { ...runBody(w), runId: 'r2' });
  assert.equal(r2.status, 202, r2.text);
  await startPhase(w, r2.json().startId, ['started']);
  assert.equal((await live(w)).start ?? null, null, 'a started run is in Runs, not on the card');
  // a start still starting (a fresh child, no book row yet) is returned as `starting` so the page re-attaches its poll
});
