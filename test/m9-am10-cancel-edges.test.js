// M9 amendment 10, the two cases test/m9-am10-cancel.test.js names but never ran (fix ledger 2026-10-16): Cancel while a run is STARTING, and Cancel while a
// run is [II] stuck. M9 am20 (signed): a schedule is its own file, so Cancel never touches the job: the starting run is not halted by it (the M6 F3
// "the job was replaced while this run was starting" halt no longer has a cause here). In-process, $0, a fake modelStep, Cancel through the real schedule door.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readFlow } from '../src/flow.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { CAT, scheduledJob } from './m9-sched-job.mjs';

const sigOf = (w) => readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;

test('Cancel while a run is STARTING: the schedule is gone, the starting run carries on and keeps its job copy, and the job is untouched', async () => {
  const w = await scheduledJob();
  const before = sigOf(w);
  let cancelled = false;
  // the existing seam (m6-runcopy F3): runFlow reads `primitiveReds.length` after reading the job and before writing its copy
  const primitiveReds = { get length() { cancelled = w.click(null).status === 200; return 0; } };
  const r = await runFlow({ ...w.args('run-1'), askStep: makeParkingAskStep(), primitiveReds });
  assert.equal(cancelled, true, 'the Cancel landed while the run was starting');
  assert.equal(r.outcome, 'paused', JSON.stringify(r));
  assert.equal(existsSync(path.join(w.runDir, 'job', 'prose.txt')), true, 'the run keeps its own job copy');
  assert.equal(existsSync(path.join(w.flowDir, 'schedule.json')), false, 'the schedule is cancelled');
  assert.equal(sigOf(w), before, 'the job still has its signature');
});

test('Cancel while a run is [II] stuck (answer saved, no process): the stuck run still resumes from its own copy and completes', async () => {
  const w = await scheduledJob();
  const parked = await runFlow({ ...w.args('run-1'), askStep: makeParkingAskStep() });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(answerAsk({ runDir: w.runDir, askId: parked.askId, decision: 'accept' }).ok, true);   // saved, and no resume was started: stuck
  const copyBefore = readFileSync(path.join(w.runDir, 'job', 'prose.txt'), 'utf8');
  assert.equal(w.click(null).status, 200);
  assert.equal(existsSync(path.join(w.flowDir, 'schedule.json')), false, 'the schedule is cancelled');
  assert.equal(readFileSync(path.join(w.runDir, 'job', 'prose.txt'), 'utf8'), copyBefore, 'the Cancel did not touch the run\'s own copy');
  const done = await resumeRun({ ...w.args('run-1'), askStep: makeParkingAskStep() });
  assert.equal(done.outcome, 'complete', done.red);
});
