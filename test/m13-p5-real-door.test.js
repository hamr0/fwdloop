// M13 piece 5: the turn-on and the sign's schedule write on the REAL panel's footing (no NODE_ENV, no NODE_TEST_CONTEXT, config home undefined, HOME a scratch dir), in a child node process,
// like test/m13-real-door.test.js. Neither reads the config home; this proves nothing in them quietly needs a test process. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST = path.dirname(fileURLToPath(import.meta.url));
const CHILD = `
import { p5World } from ${JSON.stringify(path.join(TEST, 'm13-p5-world.mjs'))};
const w = p5World();
w.sign();
const off = w.armed().length;
w.door.armWaiting();
const stillOff = w.armed().length;
w.run('r-red', { ticket: 5, rows: [['not-done', w.clock.t]] });
w.door.armWaiting();
const afterRed = w.armed().length;
w.run('r-red', { ticket: 5, rows: [['complete', w.clock.t]] });
w.door.armWaiting();
console.log(JSON.stringify({ off, stillOff, afterRed, on: w.armed().map((r) => r.ticketN), env: [process.env.NODE_ENV ?? null, process.env.NODE_TEST_CONTEXT ?? null] }));
`;

test('real process, config home undefined: a schedule signed with the job is off through no run and a red run, and on after the first green run, carrying the ticket number', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p5door-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home };
  delete env.NODE_ENV; delete env.NODE_TEST_CONTEXT; delete env.FWDLOOP_CONFIG_HOME;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('{'))), { off: 0, stillOff: 0, afterRed: 0, on: [5], env: [null, null] });
});
