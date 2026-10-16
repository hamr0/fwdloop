// M11 am5 ledger item 9 (src/panel/authorstart.js startingFor): the cost no longer grows with old finished starts. A start whose child has a pid.json and is not
// running can never be `starting` again, so it is remembered as dead and not read again; nothing is pruned (every folder stays on disk for newestOpen and the
// start cards). A folder with no pid.json yet is never remembered; a live child is never remembered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isFwdloopAlive, procStartOf } from '../src/liveness.js';
import { createStarter } from '../src/panel/authorstart.js';
import { until } from './m4e-world.mjs';

const procs = [];
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } } });

async function liveFwdloop(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fwdloop'), 'setInterval(() => {}, 1000);\n');
  const c = spawn(process.execPath, [path.join(dir, 'fwdloop')], { stdio: 'ignore' });
  c.unref();
  procs.push(c);
  await until(() => isFwdloopAlive(c.pid) === true);
  return c;
}
const idOf = (n) => `s-${(1_000_000 + n).toString(36).padStart(10, '0')}-abcd`;

function rootWith(nOld) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m11am5-9-'));
  mkdirSync(path.join(root, '.starts'));
  mkdirSync(path.join(root, 'job2', 'runs'), { recursive: true });
  const start = (n, { pid, flow = 'job2', booksRow = false } = {}) => {
    const d = path.join(root, '.starts', idOf(n));
    mkdirSync(d);
    const runId = `run-${n}`;
    mkdirSync(path.join(root, flow, 'runs', runId), { recursive: true });
    writeFileSync(path.join(d, 'start.json'), JSON.stringify({ kind: 'run', flow, runId, sources: [], startedAt: 'x' }));
    if (pid) writeFileSync(path.join(d, 'pid.json'), JSON.stringify(pid));
    if (booksRow) writeFileSync(path.join(root, flow, 'runs', runId, 'pids.jsonl'), `${JSON.stringify({ pid: 999999, startedAt: '2026-10-01T00:00:00.000Z', leg: 'run' })}\n`);
    return d;
  };
  for (let i = 1; i <= nOld; i++) start(i, { pid: { pid: 999999, procStart: '1', startedAt: 1 }, booksRow: i % 2 === 0 });
  return { root, start, dir: (n) => path.join(root, '.starts', idOf(n)) };
}

test('a live start is found under 300 old dead ones; when its child dies the very next call says null; nothing is pruned', async () => {
  const r = rootWith(300);
  const s = createStarter({ root: r.root });
  assert.equal(s.startingFor('job2', []), null);
  assert.equal(s.startingFor('job2', []), null, 'second call, the dead ones now remembered');
  const proc = await liveFwdloop(path.join(r.root, 'fake'));
  r.start(400, { pid: { pid: proc.pid, procStart: procStartOf(proc.pid), startedAt: Date.now() } });
  assert.equal(s.startingFor('job2', []), idOf(400), 'a new live start is seen on the next call');
  assert.equal(s.startingFor('other', []), null);
  assert.equal(s.startingFor('job2', [], 'run-400'), idOf(400));
  assert.equal(s.startingFor('job2', [], 'run-1'), null);
  proc.kill('SIGKILL');
  await until(() => isFwdloopAlive(proc.pid) !== true);
  assert.equal(s.startingFor('job2', []), null, 'the child is gone: not starting any more, on the very next call');
  assert.equal(readdirSync(path.join(r.root, '.starts')).length, 301, 'no start folder was pruned');
  rmSync(r.root, { recursive: true, force: true });
});

test('a folder with no pid.json yet (still being written) is not remembered as dead: its child appears and it is found', async () => {
  const r = rootWith(3);
  const s = createStarter({ root: r.root });
  const d = r.start(50);   // start.json only
  assert.equal(s.startingFor('job2', []), null);
  const proc = await liveFwdloop(path.join(r.root, 'fake'));
  writeFileSync(path.join(d, 'pid.json'), JSON.stringify({ pid: proc.pid, procStart: procStartOf(proc.pid), startedAt: Date.now() }));
  assert.equal(s.startingFor('job2', []), idOf(50));
  proc.kill('SIGKILL');
  rmSync(r.root, { recursive: true, force: true });
});

test('the answer equals the unshortcut reading for every phase: starting wins only with a live child and no book row', async () => {
  const r = rootWith(0);
  const s = createStarter({ root: r.root });
  const proc = await liveFwdloop(path.join(r.root, 'fake'));
  const live = { pid: proc.pid, procStart: procStartOf(proc.pid), startedAt: Date.now() };
  r.start(1, { pid: live, booksRow: true });      // live child, book row written: started, not starting
  assert.equal(s.startingFor('job2', []), null);
  r.start(2, { pid: live });                      // live child, no row: starting
  assert.equal(s.startingFor('job2', []), idOf(2));
  r.start(3, { pid: { pid: 999999, procStart: '1', startedAt: 1 } });   // dead child, no row: refused
  assert.equal(s.startingFor('job2', []), idOf(2), 'the newest live starting one');
  proc.kill('SIGKILL');
  rmSync(r.root, { recursive: true, force: true });
});
