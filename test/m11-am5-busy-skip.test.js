// M11 am5 ledger item 7 (src/panel/scheduler.js): the scheduler's busy question (and Edit's block) no longer builds a run context for a run that has ended.
// `canStop` needs no end row (runControls), so an ended run is skipped by the same `endRow` rule, read fresh on every call: NO cache, so nothing can be
// stale. The proof is equivalence: for every state a run can be in, the door answers exactly what the old walk (getRunControls on every run) answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendFileSync, mkdirSync, renameSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { isFwdloopAlive, procStartOf } from '../src/liveness.js';
import { getRunControls } from '../src/panel/data.js';
import { createStarter } from '../src/panel/authorstart.js';
import { createFlowsDoor } from '../src/panel/authorflows.js';
import { killChildrenAfter, until } from './m4e-world.mjs';
import { greenWorld, seedGreen } from './m9-trigger-world.mjs';

killChildrenAfter();
const CAT = loadCatalogue().primitives;
const procs = [];
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } } });

/** A live process the liveness rule reads as fwdloop (`node <dir>/fwdloop`). */
async function liveFwdloop(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fwdloop'), 'setInterval(() => {}, 1000);\n');
  const c = spawn(process.execPath, [path.join(dir, 'fwdloop')], { stdio: 'ignore' });
  c.unref();
  procs.push(c);
  await until(() => isFwdloopAlive(c.pid) === true);
  return c;
}
const pidRow = (c) => `${JSON.stringify({ pid: c.pid, startedAt: new Date().toISOString(), procStart: procStartOf(c.pid), leg: 'run' })}\n`;
const endRowOf = (runId, outcome = 'complete') => `${JSON.stringify({ runId, at: '2026-10-13T10:00:00.000Z', outcome, spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1, signatureHash: 'x' })}\n`;

/** a door over the world's root, and the OLD walk (every run, getRunControls) as the reference it must equal */
async function fixture() {
  const g = await greenWorld();
  const starter = createStarter({ root: g.w.root });
  const door = createFlowsDoor({ root: g.w.root, loadEnv: () => ({ ok: true, env: {} }), starter, monthlyClaim: () => ({}), modelRefusal: () => [] });
  const runsDir = path.join(g.flowDir, 'runs');
  const reference = (counts) => {
    const ids = ['seed-pass', ...[...Array(20).keys()].map((n) => `run-${n}`)].filter((id) => /^run-\d+$/.test(id)).sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
    for (const id of ids) if (counts(getRunControls({ root: g.w.root, flow: 'job2', runId: id, catalogue: CAT }))) return id;
    return null;
  };
  const refBusy = () => reference((c) => c?.canStop === true && c.atAsk !== true);
  const refEdit = () => reference((c) => c?.canStop === true);
  const same = (label) => {
    assert.equal(door.scheduleBusy('job2') === null, refBusy() === null, `scheduleBusy vs the old walk: ${label}`);
    assert.equal(door.editBlock('job2') === null, refEdit() === null, `editBlock vs the old walk: ${label}`);
    const b = refBusy();
    if (b !== null) assert.match(String(door.editBlock('job2')), new RegExp(refEdit() ?? '^$'), label);
  };
  return { ...g, door, runsDir, same, run: (id) => { const d = path.join(runsDir, id); mkdirSync(d, { recursive: true }); return d; } };
}

test('busy flips with the run: starts, ends, parks at its ask, continues - each answered on the very next call, equal to the old walk', async () => {
  const f = await fixture();
  const proc = await liveFwdloop(path.join(f.w.work, 'fake'));
  f.same('only a seeded green run');
  assert.equal(f.door.scheduleBusy('job2'), null);
  assert.equal(f.door.editBlock('job2'), null);

  // run-3 starts: a live process with a book row and no end row
  const r3 = f.run('run-3');
  writeFileSync(path.join(r3, 'pids.jsonl'), pidRow(proc));
  f.same('run-3 working');
  assert.notEqual(f.door.scheduleBusy('job2'), null, 'a working run is busy');
  assert.notEqual(f.door.editBlock('job2'), null);

  // it ends: the end row lands -> the next call says free (the end row is written in the same millisecond as nothing else; no timestamp is read)
  appendFileSync(path.join(f.flowDir, 'history.jsonl'), endRowOf('run-3'));
  f.same('run-3 ended');
  assert.equal(f.door.scheduleBusy('job2'), null, 'an ended run is not busy');
  assert.equal(f.door.editBlock('job2'), null);

  // a new run-4 starts and the first run-3 end row is still in the file: only the newer run counts
  const r4 = f.run('run-4');
  writeFileSync(path.join(r4, 'pids.jsonl'), pidRow(proc));
  f.same('run-4 working, run-3 ended');
  assert.notEqual(f.door.scheduleBusy('job2'), null);

  // run-4 parks at its ask (open, unexpired): the schedule is free, Edit is still blocked (M6 vs M9 am8)
  writeFileSync(path.join(r4, 'ask.json'), JSON.stringify({ askId: 'a1', step: 'x', deadline: new Date(Date.now() + 3_600_000).toISOString() }));
  proc.kill('SIGKILL');
  await until(() => isFwdloopAlive(proc.pid) !== true);
  f.same('run-4 parked, process gone');
  assert.equal(f.door.scheduleBusy('job2'), null, 'parked at its ask: the schedule is free');
  assert.notEqual(f.door.editBlock('job2'), null, 'parked at its ask: Edit is still blocked');

  // a stopped run that a continue has taken over (halt row, halt.json renamed to a consumed file) has NO end row; its live process counts
  const proc2 = await liveFwdloop(path.join(f.w.work, 'fake2'));
  const r5 = f.run('run-5');
  writeFileSync(path.join(r5, 'pids.jsonl'), pidRow(proc2));
  appendFileSync(path.join(f.flowDir, 'history.jsonl'), endRowOf('run-5', 'stopped'));
  writeFileSync(path.join(r5, 'halt.json'), '{}');
  f.same('run-5 stopped, halt.json still there: ended');
  renameSync(path.join(r5, 'halt.json'), path.join(r5, 'halt.1.consumed.json'));
  f.same('run-5 continuing');
  assert.notEqual(f.door.scheduleBusy('job2'), null, 'a continuing run is busy: the old halt row is not its end');
  appendFileSync(path.join(f.flowDir, 'history.jsonl'), endRowOf('run-5', 'complete'));
  f.same('run-5 ended for good');
  assert.equal(f.door.scheduleBusy('job2'), null);
  proc2.kill('SIGKILL');
});

test('a start folder in phase starting is still busy, answered before any run is read', async () => {
  const f = await fixture();
  const proc = await liveFwdloop(path.join(f.w.work, 'fake'));
  const dir = path.join(f.w.root, '.starts', 's-0000000001-aaaa');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, 'start.json'), JSON.stringify({ kind: 'run', flow: 'job2', runId: 'run-1', startedAt: new Date().toISOString() }));
  writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid: proc.pid, procStart: procStartOf(proc.pid), startedAt: Date.now() }));
  mkdirSync(path.join(f.runsDir, 'run-1'), { recursive: true });
  assert.notEqual(f.door.scheduleBusy('job2'), null);
  proc.kill('SIGKILL');
  await until(() => isFwdloopAlive(proc.pid) !== true);
  assert.equal(f.door.scheduleBusy('job2'), null, 'the child is gone: the start no longer blocks');
});
