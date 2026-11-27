// M20 am1 item 3 (src/books.js haltFileExists, read by src/panel/authorstart.js): a Resume start whose run has a halt.json that EXISTS is
// still "starting" (the child has not taken the run), even when the file does not parse. Swapping the reader for readHaltRecord().ok would
// call a torn halt.json "taken" and fail this test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isFwdloopAlive, procStartOf } from '../src/liveness.js';
import { createStarter } from '../src/panel/authorstart.js';
import { until } from './m4e-world.mjs';

test('a corrupt halt.json still reads as waiting at the start watcher', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m20a1-'));
  const procs = [];
  try {
    mkdirSync(path.join(root, '.starts'));
    const runDir = path.join(root, 'job2', 'runs', 'run-1');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(root, 'fake'));
    writeFileSync(path.join(root, 'fake', 'fwdloop'), 'setInterval(() => {}, 1000);\n');
    const c = spawn(process.execPath, [path.join(root, 'fake', 'fwdloop')], { stdio: 'ignore' });
    procs.push(c);
    await until(() => isFwdloopAlive(c.pid) === true);
    const id = 's-0000000001-abcd';
    const d = path.join(root, '.starts', id);
    mkdirSync(d);
    writeFileSync(path.join(d, 'start.json'), JSON.stringify({ kind: 'resume', flow: 'job2', runId: 'run-1', sources: [], startedAt: 'x' }));
    writeFileSync(path.join(d, 'pid.json'), JSON.stringify({ pid: c.pid, procStart: procStartOf(c.pid), startedAt: Date.now() }));
    writeFileSync(path.join(runDir, 'halt.json'), '{ not json');
    const s = createStarter({ root });
    assert.equal(s.startingFor('job2', []), id, 'a halt.json that exists, torn or not, means the child has not taken the run');
    rmSync(path.join(runDir, 'halt.json'));
    assert.equal(s.startingFor('job2', []), null, 'no halt.json: taken, no longer starting');
  } finally {
    for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    rmSync(root, { recursive: true, force: true });
  }
});
