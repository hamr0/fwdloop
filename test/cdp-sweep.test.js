// The headless-chromium helper must not leave orphans: a SIGKILLed owner's chromium and profile dir are swept by the next launch,
// and a live owner's are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sweepOrphans } from '../scripts/panel-fixtures/cdp.mjs';

const CDP = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/panel-fixtures/cdp.mjs');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a dead owner is swept (dir removed), a live owner is left alone', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cdp-sweep-root-'));
  try {
    const dead = path.join(root, 'fwdloop-cdp-dead');
    const live = path.join(root, 'fwdloop-cdp-live');
    const other = path.join(root, 'unrelated');
    for (const d of [dead, live, other]) mkdirSync(d);
    writeFileSync(path.join(dead, 'owner.pid'), '999999999');
    writeFileSync(path.join(live, 'owner.pid'), String(process.pid));
    assert.deepEqual(sweepOrphans(root), [dead]);
    assert.ok(!existsSync(dead));
    assert.ok(existsSync(live));
    assert.ok(existsSync(other));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SIGKILL the owner mid-run: the next launch kills its chromium and removes its dir', async (t) => {
  const probe = await launchChrome();
  if (!probe) { t.skip('no chromium installed'); return; }
  probe.close();
  const code = `import { launchChrome } from ${JSON.stringify(CDP)}; const c = await launchChrome(); console.log(JSON.stringify({ ok: !!c })); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => child.stdout.once('data', r));
  const dirs = readdirSync(tmpdir()).filter((n) => n.startsWith('fwdloop-cdp-')).map((n) => path.join(tmpdir(), n))
    .filter((d) => { try { return readFileSync(path.join(d, 'owner.pid'), 'utf8') === String(child.pid); } catch { return false; } });
  assert.equal(dirs.length, 1, 'the child owns exactly one profile dir');
  const pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number).filter((pid) => {
    try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(`--user-data-dir=${dirs[0]}`); } catch { return false; }
  });
  assert.ok(pids.length > 0, 'its chromium is running');
  child.kill('SIGKILL');
  await new Promise((r) => child.once('exit', r));
  assert.ok(alive(pids[0]), 'SIGKILL gave the child no chance to clean up: the chromium is an orphan');
  const next = await launchChrome();
  try {
    assert.ok(!existsSync(dirs[0]), 'orphan dir swept');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!pids.some(alive), 'orphan chromium killed');
  } finally { next?.close(); for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } }
});
