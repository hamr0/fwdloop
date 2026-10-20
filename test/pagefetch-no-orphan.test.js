// A web-page fetch must never leave a chromium running. barebrowse starts chromium detached (its own process group), so a SIGKILL of the
// fetching process cannot reach it: the test reaper (test/m4e-world.mjs) used to SIGKILL a run child mid-fetch and orphaned one chromium
// per child (--user-data-dir=/tmp/barebrowse-<child pid>-<ts>, parent gone). Counted by profile prefix of the child's own pid, waited on
// process exit, never on a phase event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { reapChildren } from './m4e-world.mjs';
import { procStartOf } from '../src/liveness.js';

const PAGEFETCH = path.resolve(import.meta.dirname, '..', 'src', 'pagefetch.js');
const BAREBROWSE = import.meta.resolve('barebrowse');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => { setTimeout(r, 50); }); } return true; };

/** pids of the chromium roots (no --type=) whose profile is /tmp/barebrowse-<ownerPid>-*, read from /proc */
function chromiumRoots(ownerPid) {
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd;
    // chromium rewrites its argv into one space-joined string, so match on the whole text
    try { cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (cmd.includes(' --type=')) continue;
    if (cmd.includes(`--user-data-dir=/tmp/barebrowse-${ownerPid}-`)) out.push(Number(d));
  }
  return out;
}
const dlDirs = () => readdirSync('/tmp').filter((n) => n.startsWith('barebrowse-dl-'));
const profiles = (ownerPid) => readdirSync('/tmp').filter((n) => n.startsWith(`barebrowse-${ownerPid}-`));

/** a script named `fwdloop` (so liveness lists it) that runs the real fetch to a private address; `hang` parks it after chromium is up */
function makeChild(root, hang) {
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const script = path.join(root, 'fwdloop');
  writeFileSync(script, `
import { fetchPageText } from ${JSON.stringify(PAGEFETCH)};
import { writeFileSync } from 'node:fs';
const real = (await import(${JSON.stringify(BAREBROWSE)})).connect;
const connect = async (o) => { const p = await real(o); writeFileSync(${JSON.stringify(path.join(root, 'launched'))}, 'x'); ${hang ? 'await new Promise(() => {});' : ''} return p; };
const r = await fetchPageText('http://127.0.0.1:1/x', { connect });
writeFileSync(${JSON.stringify(path.join(root, 'result.json'))}, JSON.stringify(r));
process.exit(0);
`);
  chmodSync(script, 0o755);
  const c = spawn(process.execPath, [script], { detached: true, stdio: 'ignore', cwd: path.resolve(import.meta.dirname, '..') });
  c.unref();
  const exited = new Promise((r) => { c.once('exit', r); });
  return { c, exited };
}

test('a fetch child killed by the test reaper mid-fetch leaves no chromium', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-orphan-'));
  const dl0 = new Set(dlDirs());
  const { c } = makeChild(root, true);
  const pid = c.pid;
  try {
    assert.ok(await until(() => existsSync(path.join(root, 'launched'))), 'chromium was launched by the child');
    assert.ok(await until(() => chromiumRoots(pid).length >= 1, 10000), `pid ${pid} profiles ${profiles(pid)} a chromium root of the child is running before the reap`);
    assert.ok(await until(() => procStartOf(pid) !== null));
    const dir = path.join(root, '.starts', 'f');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid, procStart: procStartOf(pid) }));
    await reapChildren([root], []);
    assert.ok(await until(() => !alive(pid)), 'the child is dead');
    assert.ok(await until(() => chromiumRoots(pid).length === 0, 10000), `orphaned chromium root(s) left: ${chromiumRoots(pid).join(',')}`);
    assert.ok(await until(() => profiles(pid).length === 0, 10000), `profile dir(s) left: ${profiles(pid).join(',')}`);
  } finally {
    for (const r of chromiumRoots(pid)) { try { process.kill(r, 'SIGKILL'); } catch { /* gone */ } }
    for (const n of profiles(pid)) rmSync(path.join('/tmp', n), { recursive: true, force: true });
    if (alive(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
    for (const n of dlDirs()) if (!dl0.has(n)) rmSync(path.join('/tmp', n), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a refused fetch (private address) whose process exits right after leaves no chromium', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-orphan-'));
  const { c, exited } = makeChild(root, false);
  const pid = c.pid;
  try {
    await Promise.race([exited, new Promise((_, rej) => { setTimeout(() => rej(new Error('child did not exit in 60s')), 60000); })]);
    const res = JSON.parse(readFileSync(path.join(root, 'result.json'), 'utf8'));
    assert.equal(res.ok, false);
    assert.match(res.error, /Refusing to navigate to private\/internal host/);
    assert.ok(await until(() => chromiumRoots(pid).length === 0, 10000), `chromium root(s) left: ${chromiumRoots(pid).join(',')}`);
    assert.equal(profiles(pid).length, 0, `profile dir(s) left: ${profiles(pid).join(',')}`);
  } finally {
    for (const r of chromiumRoots(pid)) { try { process.kill(r, 'SIGKILL'); } catch { /* gone */ } }
    for (const n of profiles(pid)) rmSync(path.join('/tmp', n), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
