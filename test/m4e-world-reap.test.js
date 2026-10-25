// test/m4e-world.mjs reapChildren: a panel's close can still spawn a child (a scheduler tick / starter that fires after the scan).
// The child must be dead after reapChildren, whichever way the panel closes. The stub handle below spawns one inside close().
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
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

test('reapChildren on a child that is mid page fetch leaves no chromium (barebrowse tethers it to the child)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-reap-'));
  // a page that starts answering and never finishes, so the child's real fetchPageText stays inside barebrowse with a live chromium
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.write(`<html><body>${'x'.repeat(2000)}`); });
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const script = path.join(root, 'fwdloop'); // liveness names the script `fwdloop`
  const src = new URL('../src/pagefetch.js', import.meta.url).href;
  const bb = new URL('../node_modules/barebrowse/src/index.js', import.meta.url).href;
  // the one deviation from production: the private-network block is off, or the loopback page would be refused before it hangs
  writeFileSync(script, `import { fetchPageText } from ${JSON.stringify(src)};\nimport { connect } from ${JSON.stringify(bb)};\n`
    + `await fetchPageText(${JSON.stringify(url)}, { connect: (o) => connect({ ...o, blockPrivateNetwork: false }), timeoutMs: 120000, idleTimeoutMs: 120000 });\n`);
  chmodSync(script, 0o755);
  const c = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  c.unref();
  const chromiumOf = (pid) => readdirSync('/proc').filter((n) => /^\d+$/.test(n)).filter((n) => {
    try { return readFileSync(`/proc/${n}/cmdline`, 'utf8').includes(`/barebrowse-${pid}-`); } catch { return false; }
  });
  try {
    const dir = path.join(root, '.starts', 'x');
    mkdirSync(dir, { recursive: true });
    await until(() => procStartOf(c.pid) !== null);
    writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid: c.pid, procStart: procStartOf(c.pid) }));
    assert.ok(await until(() => chromiumOf(c.pid).length > 0, 30000), 'the child started a chromium (the test must see one to prove it is gone)');
    await reapChildren([root], []);
    assert.ok(await until(() => !alive(c.pid)), 'the child is dead');
    assert.ok(await until(() => chromiumOf(c.pid).length === 0, 15000), `chromium for child ${c.pid} is still alive after reapChildren`);
  } finally {
    for (const n of chromiumOf(c.pid)) { try { process.kill(Number(n), 'SIGKILL'); } catch { /* gone */ } }
    try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ }
    srv.closeAllConnections();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
});
