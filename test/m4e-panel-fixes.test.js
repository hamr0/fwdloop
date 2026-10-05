// M4e walk fixes F1-F2 (route level): the courtesy "left this month" line reads the limit the way the CLI's monthly check does, at
// request time; a start's refusal survives a reload through `/api/author/live`. $0, scratch dirs, every child killed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
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
