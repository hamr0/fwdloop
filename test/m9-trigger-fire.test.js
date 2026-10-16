// M9 piece 4 (docs/wiki/the-module-ladder.md, "M9" items 3-6, am1, am2): the panel's scheduler FIRES the signed trigger.
// No real waits: the clock is injected (`now`) and the test calls `tick()` itself (the interval is switched off with intervalMs: 0).
// The runs are the real `fwdloop run` child with the test model step ($0); the job parks at its ask, so one started run stays "waiting".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { createPanelServer } from '../src/panel/server.js';
import { appendHistory } from '../src/books.js';
import { readOutcomes } from '../src/panel/authortrigger.js';
import {
  killChildrenAfter, until, sleep, tickedConfig,
} from './m4e-world.mjs';
import {
  DAILY, greenWorld, ls, readJsonl, seenOf, setTrigger,
} from './m9-trigger-world.mjs';
import { STABLE_POLLS } from '../src/trigger-files.js';

killChildrenAfter();
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
/** a green job2 in a world whose clock is `clock.t` and whose scheduler is driven by hand */
async function fireWorld(start = at(13, 8), o = {}) {
  const clock = { t: start };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 }, ...o });
  const rows = () => readOutcomes(g.flowDir);
  const runs = () => ls(path.join(g.flowDir, 'runs')).filter((n) => /^run-\d+$/.test(n));
  const tick = () => g.w.h.tick();
  return { ...g, clock, rows, runs, tick };
}
const pollFiles = (f, n = STABLE_POLLS + 2) => { for (let i = 0; i < n; i++) f.tick(); };

test('a daily trigger fires once when its time comes: the run starts through the one start path, kind trigger, reason in the run folder', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(13, 8, 59); f.tick();
  assert.deepEqual(f.rows(), [], 'not yet');
  f.clock.t = at(13, 9, 0, 30); f.tick();
  assert.equal(f.rows().length, 1);
  const row = f.rows()[0];
  assert.equal(row.outcome, 'started');
  assert.equal(row.catchUp, false);
  assert.equal(row.runId, 'run-1');
  assert.deepEqual(f.runs(), ['run-1']);
  const rec = JSON.parse(readFileSync(path.join(f.flowDir, 'runs', 'run-1', 'trigger.json'), 'utf8'));
  assert.equal(rec.catchUp, false);
  assert.match(rec.reason, /trigger.*daily 09:00/);
  const start = JSON.parse(readFileSync(path.join(f.w.root, '.starts', f.w.starts()[0], 'start.json'), 'utf8'));
  assert.equal(start.kind, 'trigger');
  assert.deepEqual(start.sources.map((s) => s.role).sort(), ['jd', 'resume'], 'the other inputs are the newest run\'s');
  f.tick(); f.tick();
  assert.equal(f.rows().length, 1, 'the same slot never fires twice');
});

test('Must fail: three times missed while the panel was off give ONE catch-up run, and its history row says catch-up', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(16, 12, 0); // the panel was off over the 13th..16th at 09:00
  f.tick();
  const rows = f.rows();
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].outcome, 'started');
  assert.equal(rows[0].catchUp, true);
  assert.ok(rows[0].missed >= 3, `missed ${rows[0].missed}`);
  f.tick(); f.tick();
  assert.equal(f.rows().length, 1);
  assert.equal(f.runs().length, 1);
  // the history row of that run (written by the one appendHistory when the run ends) carries the mark
  const runDir = path.join(f.flowDir, 'runs', 'run-1');
  appendHistory(f.flowDir, { runId: 'run-1', at: 'x', outcome: 'complete', spentUsd: 0, spendComplete: true, capUsd: 0.25, wallMs: 1, signatureHash: 'x' });
  const hist = readJsonl(path.join(f.flowDir, 'history.jsonl')).pop();
  assert.equal(hist.trigger.catchUp, true, 'the run\'s history row says catch-up');
  assert.ok(existsSync(runDir));
});

test('a job that starts 5 minutes late shows catch-up; on time does not (am2 item 1)', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(13, 9, 5, 0); f.tick();
  assert.equal(f.rows()[0].catchUp, true);
});

test('M9 am8: a trigger firing while the job waits at its ask starts the next run (the waiting run does not block); it is busy only while a run works', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(13, 9, 0, 10); f.tick();
  await until(async () => { const v = (await f.w.get(`/api/author/start/${f.w.starts()[0]}`)).json(); return v.state === 'parked' ? v : null; });
  f.clock.t = at(14, 9, 0, 10); f.tick();
  const rows = f.rows();
  assert.deepEqual(rows.map((r) => r.outcome), ['started', 'started'], JSON.stringify(rows));
  assert.deepEqual(f.runs(), ['run-1', 'run-2']);
  assert.equal(f.w.starts().length, 2);
});

test('Must fail: a month that cannot fund a run records monthly-exhausted with what is left and what is needed, starts nothing, spends $0', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  writeFileSync(path.join(f.w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 0.1 }))); // the month shrinks after the job was set up
  const books = path.join(f.w.home, 'runs.jsonl');
  const before = existsSync(books) ? readFileSync(books, 'utf8') : '';
  f.clock.t = at(13, 9, 0, 10); f.tick();
  const [row] = f.rows();
  assert.equal(row.outcome, 'monthly-exhausted');
  assert.equal(row.needUsd, 0.25);
  assert.ok(row.leftUsd > 0 && row.leftUsd <= 0.1, `left ${row.leftUsd}`); // the drafting of the job already took a cent
  assert.deepEqual(f.runs(), []);
  assert.deepEqual(f.w.starts(), []);
  assert.equal(existsSync(books) ? readFileSync(books, 'utf8') : '', before, 'no hold, no spend row');
});

test('a clock fire with no earlier run to take inputs from is refused by name, nothing starts', async () => {
  const f = await fireWorld();
  // the green run exists, but its inputs.json is gone: there is nothing to take the inputs from
  const { rmSync } = await import('node:fs');
  rmSync(path.join(f.flowDir, 'runs', 'seed-pass', 'inputs.json'));
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(13, 9, 0, 10); f.tick();
  const [row] = f.rows();
  assert.equal(row.outcome, 'refused');
  assert.match(row.why, /resume/);
  assert.deepEqual(f.w.starts(), []);
});

test('Must fail: a folder holding 3 files when its trigger is set starts no run; a file that arrives after does, once, with that file as the input', async () => {
  const f = await fireWorld();
  const inbox = path.join(f.w.work, 'inbox'); mkdirSync(inbox);
  for (const n of ['a.md', 'b.md', 'c.md']) writeFileSync(path.join(inbox, n), `# ${n}\n`);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  pollFiles(f);
  assert.deepEqual(f.rows(), [], 'the 3 files that were there are the starting point');
  const fresh = path.join(inbox, 'd.md'); writeFileSync(fresh, '# new job description\n');
  pollFiles(f);
  const rows = f.rows();
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].outcome, 'started');
  const start = JSON.parse(readFileSync(path.join(f.w.root, '.starts', f.w.starts()[0], 'start.json'), 'utf8'));
  const jd = start.sources.find((s) => s.role === 'jd').path;
  assert.equal(readFileSync(jd, 'utf8'), '# new job description\n');
  assert.equal(path.basename(jd), 'd.md');
  assert.equal(start.sources.find((s) => s.role === 'resume').path, path.join(f.w.inDir, 'resume.md'), 'the other input is the newest run\'s');
});

test('Must fail: the same file dropped twice runs once (same bytes under a new name, or put back), and records nothing the second time', async () => {
  const f = await fireWorld();
  const inbox = path.join(f.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  writeFileSync(path.join(inbox, 'x.md'), 'same bytes\n');
  pollFiles(f);
  assert.equal(f.rows().length, 1);
  writeFileSync(path.join(inbox, 'x-copy.md'), 'same bytes\n');
  pollFiles(f);
  assert.equal(f.rows().length, 1, 'a version whose sha256 already ran is never run again: not even a busy row');
  assert.equal(f.runs().length, 1);
});

test('file-updated: runs when the sha changes, with the new version; the current version at arm does not run', async () => {
  const f = await fireWorld();
  const watched = path.join(f.w.work, 'watched.md'); writeFileSync(watched, 'v1\n');
  assert.equal((await setTrigger(f.w, { kind: 'file-updated', role: 'resume', path: watched })).status, 200);
  pollFiles(f);
  assert.deepEqual(f.rows(), []);
  writeFileSync(watched, 'v2 changed\n');
  pollFiles(f);
  assert.equal(f.rows().length, 1);
  const start = JSON.parse(readFileSync(path.join(f.w.root, '.starts', f.w.starts()[0], 'start.json'), 'utf8'));
  assert.equal(start.sources.find((s) => s.role === 'resume').path, watched);
});

test('a trigger changed while the panel was off does not inherit the old ledger: the missed slots of the old trigger do not run, its first slot is after it was set', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(15, 12, 0); // two of the old trigger's slots (13th, 14th, 15th at 09:00) went by with no tick: the panel was off
  const ten = { kind: 'daily', hour: 10, minute: 0 };
  assert.equal((await setTrigger(f.w, ten)).status, 200);
  f.tick();
  assert.deepEqual(f.rows(), [], 'the old trigger\'s missed slots do not run under the new one');
  f.clock.t = at(16, 10, 0, 5); f.tick();
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].catchUp, false);
});

test('the real timer ticks by itself and stops with the server: no tick after close', async () => {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 20 } });
  assert.equal((await setTrigger(g.w, DAILY)).status, 200);
  clock.t = at(13, 9, 0, 10);
  await until(() => readOutcomes(g.flowDir).length >= 1);
  assert.equal(readOutcomes(g.flowDir)[0].outcome, 'started');
  await g.w.h.close();
  clock.t = at(20, 9, 0, 10); // a week later, and a free job would fire again
  const n = readOutcomes(g.flowDir).length;
  await sleep(150);
  assert.equal(readOutcomes(g.flowDir).length, n, 'closed: no timer left');
});

test('F4 a fire runs the Run door\'s model checks: no model record -> one refused row, nothing started (clock slot spent); unticked model -> refused', async () => {
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  const { rmSync } = await import('node:fs');
  const rec = readFileSync(path.join(f.flowDir, 'model.json'), 'utf8');
  rmSync(path.join(f.flowDir, 'model.json'));
  f.clock.t = at(13, 9, 0, 10); f.tick();
  let rows = f.rows();
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].outcome, 'refused');
  assert.match(rows[0].why, /model/i);
  assert.deepEqual(f.w.starts(), [], 'nothing started');
  assert.deepEqual(f.runs(), []);
  f.tick();
  assert.equal(f.rows().length, 1, 'the slot is spent: no retry');
  // the record is back but its model is no longer ticked in Settings
  writeFileSync(path.join(f.flowDir, 'model.json'), rec);
  const { slot, model } = JSON.parse(rec);
  writeFileSync(path.join(f.w.home, 'config.json'), JSON.stringify(tickedConfig({ models: { [slot]: [{ model, use: false, inPerM: 0.75, outPerM: 1.625 }] } })));
  f.clock.t = at(14, 9, 0, 10); f.tick();
  rows = f.rows();
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.equal(rows[1].outcome, 'refused');
  assert.deepEqual(f.w.starts(), []);
});

test('F4 a file whose job has no model record stays queued (no ran row), is told once, and starts once the model is back', async () => {
  const f = await fireWorld();
  const inbox = path.join(f.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  const { rmSync } = await import('node:fs');
  const rec = readFileSync(path.join(f.flowDir, 'model.json'), 'utf8');
  rmSync(path.join(f.flowDir, 'model.json'));
  writeFileSync(path.join(inbox, 'd.md'), '# jd\n');
  pollFiles(f); pollFiles(f);
  assert.equal(f.rows().filter((r) => r.outcome === 'refused').length, 1, `told once: ${JSON.stringify(f.rows())}`);
  assert.deepEqual(f.w.starts(), []);
  const led = seenOf(f.flowDir);
  assert.equal(led.some((r) => r.kind === 'ran'), false, 'no ran row: it stays queued');
  assert.equal(led.some((r) => r.kind === 'arrived'), true);
  writeFileSync(path.join(f.flowDir, 'model.json'), rec);
  pollFiles(f);
  assert.equal(f.rows().at(-1).outcome, 'started');
});

test('F4 a start the starter refuses (409) is one refused row with its say, never started', async () => {
  const { createTriggerDoor } = await import('../src/panel/authortrigger.js');
  const f = await fireWorld();
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  const slot = JSON.parse(readFileSync(path.join(f.flowDir, 'model.json'), 'utf8')).slot;
  const door = createTriggerDoor({
    root: f.w.root,
    flowsDoor: { editBlock: () => null, scheduleBusy: () => null, lastSourcesOf: () => ({ sources: { resume: path.join(f.w.inDir, 'resume.md'), jd: path.join(f.w.inDir, 'jd.md') } }) },
    starter: { canStart: () => null, start: () => ({ status: 409, body: { ok: false, refused: 'start-live', say: 'A run of this flow is already starting. Wait for it.' } }) },
    loadEnv: () => ({ ok: true, env: {}, keyNames: [slot] }),
    monthlyClaim: () => null,
    modelRefusal: () => [],
    now: () => at(13, 9, 0, 10),
  });
  const [job] = door.scan();
  const row = door.fire(job, { kind: 'clock', slot: at(13, 9), catchUp: false, missed: 0 });
  assert.equal(row.outcome, 'refused');
  assert.match(row.why, /already starting/);
  assert.deepEqual(f.rows().map((r) => r.outcome), ['refused']);
});
