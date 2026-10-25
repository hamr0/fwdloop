// test/m4e-world.mjs reapChildren: a panel's close can still spawn a child (a scheduler tick / starter that fires after the scan).
// The child must be dead after reapChildren, whichever way the panel closes. The stub handle below spawns one inside close().
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { reapChildren, killBarebrowseOf } from './m4e-world.mjs';
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

test('reapChildren also kills the chromium a killed child left behind, and removes its profile dir', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-reap-'));
  const script = path.join(root, 'fwdloop');
  writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  chmodSync(script, 0o755);
  const c = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  c.unref();
  // a stand-in for barebrowse's detached chromium: its own process group, profile dir stamped with the CHILD's pid, outliving the child
  const udd = path.join(tmpdir(), `barebrowse-${c.pid}-${Date.now()}`);
  mkdirSync(udd, { recursive: true });
  const ch = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${udd}`, 'about:blank'], { detached: true, stdio: 'ignore' });
  ch.unref();
  // a bystander with a different pid in its dir name must survive
  const other = path.join(tmpdir(), `barebrowse-${c.pid + 1000000}-${Date.now()}`);
  mkdirSync(other, { recursive: true });
  const by = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${other}`, 'about:blank'], { detached: true, stdio: 'ignore' });
  by.unref();
  try {
    const dir = path.join(root, '.starts', 'x');
    mkdirSync(dir, { recursive: true });
    await until(() => procStartOf(c.pid) !== null);
    writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid: c.pid, procStart: procStartOf(c.pid) }));
    await new Promise((r) => { setTimeout(r, 300); }); // let both argv's settle in /proc
    await reapChildren([root], []);
    assert.ok(await until(() => !alive(c.pid)), 'the child is dead');
    assert.ok(await until(() => !alive(ch.pid)), `the chromium on ${udd} (pid ${ch.pid}) is still alive after reapChildren`);
    assert.equal(existsSync(udd), false, 'its profile dir is removed');
    assert.equal(alive(by.pid), true, 'a chromium stamped with another pid is not touched');
    assert.equal(existsSync(other), true);
  } finally {
    for (const p of [c.pid, ch.pid, by.pid]) { try { process.kill(-p, 'SIGKILL'); } catch { /* gone */ } }
    rmSync(udd, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('killBarebrowseOf with no pids does nothing', () => { killBarebrowseOf([]); });
