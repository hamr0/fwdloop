// POC m4c probe: spawn REAL processes, compare isFwdloopAlive to expectation. Exit 1 on any mismatch.
// Usage: node poc/m4c/probe.mjs   (env LIVENESS=<path> swaps the rule under test, used for the red proof)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, symlinkSync, readFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const bin = join(repo, 'bin', 'fwdloop');
const { isFwdloopAlive } = await import(pathToFileURL(resolve(process.env.LIVENESS ?? join(here, 'liveness.mjs'))).href);
const scratch = process.env.SCRATCH ?? '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/a95578bd-64f1-4f53-a305-b4b67bebc5d5/scratchpad/m4c-poc';
rmSync(scratch, { recursive: true, force: true });
mkdirSync(join(scratch, 'root'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
const start = (cmd, args, opts = {}) => { const c = spawn(cmd, args, { stdio: 'ignore', ...opts }); kids.push(c); return c; };
const cmdline = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').slice(0, -1).join(' ␀ '); } catch { return '(unreadable)'; } };
let port = 4830;
const nextPort = () => port++;
const waitUp = async (c, ms = 2500) => { const t = Date.now(); while (Date.now() - t < ms) { if (c.exitCode !== null) return false; try { if (readFileSync(`/proc/${c.pid}/cmdline`).length) { await sleep(300); return c.exitCode === null; } } catch {} await sleep(50); } return false; };

const rows = [];
const add = (name, expected, got, note = '') => rows.push({ name, expected, got, ok: expected === got, note });

try {
  // 1. direct node spawn; child.pid IS the node process
  const c1 = start(process.execPath, [bin, 'panel', '--root', join(scratch, 'root'), '--port', String(nextPort())]);
  await waitUp(c1);
  add('1 node bin/fwdloop panel', true, isFwdloopAlive(c1.pid), cmdline(c1.pid));

  // 2. shebang: execute bin directly, as an npm bin would
  const c2 = start(bin, ['panel', '--root', join(scratch, 'root'), '--port', String(nextPort())]);
  await waitUp(c2);
  add('2 ./bin/fwdloop (shebang)', true, isFwdloopAlive(c2.pid), cmdline(c2.pid));

  // 3. panel's resume spawn shape; a bad runId exits fast, so freeze it with SIGSTOP right after spawn (cmdline is set at exec)
  const c3 = start(process.execPath, [bin, 'resume', 'r-x', '--flow', 'f', '--root', join(scratch, 'root')]);
  c3.kill('SIGSTOP');
  await sleep(150);
  add('3 spawn(execPath,[bin,resume..]) stopped', true, isFwdloopAlive(c3.pid), cmdline(c3.pid));
  // 3b. and the unfrozen form: how long does a real bad-runId resume live, and is it alive while it does?
  c3.kill('SIGKILL');

  // 4. npm-install-like: symlink node_modules/.bin/fwdloop -> copy of bin (and a symlink to the real one)
  const nm = join(scratch, 'node_modules', '.bin'); mkdirSync(nm, { recursive: true });
  symlinkSync(bin, join(nm, 'fwdloop'));
  const c4 = start(join(nm, 'fwdloop'), ['panel', '--root', join(scratch, 'root'), '--port', String(nextPort())]);
  await waitUp(c4);
  add('4 node_modules/.bin/fwdloop symlink', true, isFwdloopAlive(c4.pid), cmdline(c4.pid));

  // 5. kill case 1, time kill -> not alive
  const t0 = process.hrtime.bigint(); c1.kill('SIGKILL');
  let flip = null; for (;;) { if (isFwdloopAlive(c1.pid) !== true) { flip = Number(process.hrtime.bigint() - t0) / 1e6; break; } await sleep(1); if (Number(process.hrtime.bigint() - t0) / 1e6 > 4000) break; }
  add('5 SIGKILL case 1 -> flips within 2000 ms', true, flip !== null && flip < 2000, `flipped after ${flip?.toFixed(1)} ms (child not yet reaped by us? node reaps on its own loop)`);

  // 6. recycled-pid stand-ins
  const trap = join(scratch, 'fwdloop-panel-logs-x'); mkdirSync(trap, { recursive: true });
  const repoTrapDir = join(repo, 'poc', 'm4c'); // a real path under a dir named fwdloop
  const fake = join(trap, 'other.js'); const fakeSrc = 'setTimeout(()=>{},8000)';
  spawnSync('sh', ['-c', `printf '%s' "${fakeSrc}" > ${fake}`]);
  const other = join(repoTrapDir, 'hold.js'); // lives in repo, tracked? no: written at run time, removed at end
  spawnSync('sh', ['-c', `printf '%s' "${fakeSrc}" > ${other}`]);
  const c6a = start(process.execPath, ['-e', fakeSrc]);
  const c6b = start('sleep', ['8']);
  const c6c = start(process.execPath, [fake]);
  const c6d = start(process.execPath, [other]);
  const c6e = start(process.execPath, [fake, '--root', join(scratch, 'fwdloop')]); // trap: an ARG whose basename is fwdloop
  await sleep(400);
  add('6a node -e (not fwdloop)', false, isFwdloopAlive(c6a.pid), cmdline(c6a.pid));
  add('6b sleep 8 (not fwdloop)', false, isFwdloopAlive(c6b.pid), cmdline(c6b.pid));
  add('6c node .../fwdloop-panel-logs-x/other.js', false, isFwdloopAlive(c6c.pid), cmdline(c6c.pid));
  add('6d node <repo>/poc/m4c/hold.js (repo dir is fwdloop)', false, isFwdloopAlive(c6d.pid), cmdline(c6d.pid));
  add('6e node other.js --root .../fwdloop (arg basename)', false, isFwdloopAlive(c6e.pid), cmdline(c6e.pid));

  // 7. zombie: Node reaps via its own SIGCHLD handler, so make the zombie from a shell that never waits:
  //    sh forks `true &` then sleeps without wait; the grandchild exits and stays <defunct> under sh.
  const sh2 = spawn('sh', ['-c', 'true & echo $!; sleep 6'], { stdio: ['ignore', 'pipe', 'ignore'] }); kids.push(sh2);
  let zpid = await new Promise((r) => sh2.stdout.once('data', (d) => r(Number(String(d).trim()))));
  await sleep(300);
  const state = (() => { try { return readFileSync(`/proc/${zpid}/stat`, 'utf8').replace(/^\d+ \(.*\) /, '')[0]; } catch { return '?'; } })();
  add(`7 zombie (stat state ${state})`, false, isFwdloopAlive(zpid), `cmdline=${JSON.stringify(cmdline(zpid))}`);

  // 8. nonexistent pid
  add('8 nonexistent pid', false, isFwdloopAlive(4194300), '');
  add('8b pid 0 / NaN', false, isFwdloopAlive(0) || isFwdloopAlive(NaN), '');

  // 9. cost: 200 calls, mix of live (c2, c4) and dead
  const pids = [c2.pid, c4.pid, c6a.pid, 4194300];
  isFwdloopAlive(c2.pid);
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) isFwdloopAlive(pids[i % 4]);
  const us = Number(process.hrtime.bigint() - t1) / 1e3 / 200;
  rows.push({ name: '9 cost, 200 calls mixed', expected: '-', got: `${us.toFixed(1)} us/call`, ok: us < 2000, note: '' });
  spawnSync('rm', ['-f', other]);
} finally {
  for (const c of kids) { try { c.kill('SIGKILL'); } catch {} }
  spawnSync('rm', ['-f', join(repo, 'poc', 'm4c', 'hold.js')]);
}

const w = Math.max(...rows.map((r) => r.name.length));
console.log(`${'case'.padEnd(w)}  expected  got      verdict`);
for (const r of rows) console.log(`${r.name.padEnd(w)}  ${String(r.expected).padEnd(8)}  ${String(r.got).padEnd(7)}  ${r.ok ? 'ok' : 'RED'}   ${r.note}`);
const bad = rows.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} MISMATCH: ${bad.map((r) => r.name).join('; ')}` : '\nall match');
process.exit(bad.length ? 1 : 0);
