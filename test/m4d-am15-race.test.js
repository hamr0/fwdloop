// M4d amendment 15 two-read race, deterministic and $0: a revise line must never be settled (red/green) with `lines: null`.
// The draft child writes `draft-N/log.json` BEFORE `spec.hash` / `scrub-leak.red` (src/authoring.js writes `files` in order, then the hash), and a red plan's
// result IS its log.json (`ok: false`). So a poll that reads the log first and the result second can see the result of a log it did not see.
// Here the FIRST read of draft-1/log.json fails (as if the child had not written it yet); every later read sees it, which is the file landing between the two reads.
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import { isFwdloopAlive } from '../src/liveness.js';

killChildrenAfter();

test('a revise whose log lands between the poll\'s two reads is never settled with lines null', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await until(async () => ((await w.get(`/api/author/${id}`)).json()?.phase === 'green' ? true : null));
  const pid = JSON.parse(readFileSync(`${w.dir(id)}/pid.json`, 'utf8'));
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
  const card = w.card();
  assert.equal((await w.post(`/api/author/${id}/revise`, { ...card, job: `${card.job}\nREDMARK` })).status, 202);
  await until(async () => ((await w.get(`/api/author/${id}`)).json()?.revises?.[0]?.phase === 'red' ? true : null));
  await until(() => (readFileSync(`${w.dir(id)}/pid.json`, 'utf8') && isFwdloopAlive(pid.pid, pid.procStart) !== true ? true : null)); // the revise child's pid is the folder's pid.json

  const logPath = `${w.dir(id)}/draft-1/log.json`;
  const real = fs.readFileSync;
  let landed = false;
  fs.readFileSync = function patched(p, ...rest) {
    if (!landed && typeof p === 'string' && p.endsWith('/draft-1/log.json')) {
      landed = true;
      const e = Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });
      throw e;
    }
    return real.call(this, p, ...rest);
  };
  syncBuiltinESMExports();
  let v;
  try {
    v = (await w.get(`/api/author/${id}`)).json();
  } finally {
    fs.readFileSync = real;
    syncBuiltinESMExports();
  }
  assert.ok(landed, 'the shim never saw the log read');
  const rv = v.revises[0];
  assert.ok(!['red', 'green'].includes(rv.phase) || rv.lines !== null, `settled "${rv.phase}" with lines ${JSON.stringify(rv.lines)}`);
});
