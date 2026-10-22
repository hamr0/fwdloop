// test/m4e-world.mjs reapChildren: a panel's close can still spawn a child (a scheduler tick / starter that fires after the scan).
// The child must be dead after reapChildren, whichever way the panel closes. The stub handle below spawns one inside close().
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { reapChildren } from './m4e-world.mjs';
import { procStartOf } from '../src/liveness.js';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => { setTimeout(r, 25); }); } return true; };

test('reapChildren kills a child spawned by a panel close', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-reap-'));
  const script = path.join(root, 'fwdloop'); // liveness names the script `fwdloop`
  writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  chmodSync(script, 0o755);
  let childPid = 0;
  const handle = {
    async close() {
      const c = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
      c.unref();
      childPid = c.pid;
      const dir = path.join(root, '.starts', 'late');
      mkdirSync(dir, { recursive: true });
      // the child must be listed AND readable as fwdloop before the kill scans
      await until(() => procStartOf(c.pid) !== null);
      writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid: c.pid, procStart: procStartOf(c.pid) }));
    },
  };
  try {
    await reapChildren([root], [handle]);
    assert.ok(childPid > 0, 'the stub close ran');
    assert.ok(await until(() => !alive(childPid)), `child ${childPid} is still alive after reapChildren`);
  } finally {
    if (childPid > 0 && alive(childPid)) { try { process.kill(-childPid, 'SIGKILL'); } catch { /* gone */ } }
    rmSync(root, { recursive: true, force: true });
  }
});
