// M10 amendment 3: in a schedule and on a trigger a page input is its signed address; another address is refused at $0 naming the input,
// a file arrival can't stand for a page, and a clock fire starts the run with the signed address. $0, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { killChildrenAfter, tickedConfig, world } from './m4e-world.mjs';
import { DAILY, seedGreen } from './m9-trigger-world.mjs';
import { readOutcomes } from '../src/panel/authortrigger.js';
import { readSchedule } from '../src/schedule.js';

killChildrenAfter();
const SIGNED = 'http://127.0.0.1:1/signed-page';
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();

async function pageWorld() {
  const clock = { t: at(13, 8) };
  const w = await world({ limit: 5, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  await w.signedFlow({ inputs: `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${SIGNED}` });
  seedGreen(w);
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 5 })));
  return { w, clock, flowDir: path.join(w.root, 'job2') };
}
const resume = (w) => ({ role: 'resume', path: path.join(w.inDir, 'resume.md') });
const prepare = (w, extra) => w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, ...extra });

test('schedule: a different address for a page input is refused at the first click naming the input; nothing is armed', async () => {
  const f = await pageWorld();
  const r = await prepare(f.w, { inputs: [resume(f.w), { role: 'jd', path: 'https://evil.example/x' }] });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().refused, 'bad-inputs');
  assert.match(r.json().say, /the input "jd" is a web page signed as http:\/\/127\.0\.0\.1:1\/signed-page/);
  assert.equal(readSchedule(f.flowDir), null);
});

test('schedule: a blank or signed page row is accepted and the schedule stores the SIGNED address; a clock fire starts the run with it', async () => {
  const f = await pageWorld();
  const inputs = [resume(f.w), { role: 'jd', path: '' }];
  const p = await prepare(f.w, { inputs });
  assert.equal(p.status, 200, p.text);
  const s = await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, inputs, hash: p.json().hash });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(readSchedule(f.flowDir).inputs, [{ role: 'resume', path: resume(f.w).path }, { role: 'jd', path: SIGNED }]);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'started', JSON.stringify(row));
  const st = JSON.parse(readFileSync(path.join(f.w.root, '.starts', f.w.starts().at(-1), 'start.json'), 'utf8'));
  assert.deepEqual(st.sources.find((x) => x.role === 'jd'), { role: 'jd', path: SIGNED });
});

test('trigger: a file arrival cannot stand for a page input (refused at $0, naming the input)', async () => {
  const f = await pageWorld();
  const r = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: { kind: 'new-file', role: 'jd', folder: f.w.inDir } });
  assert.equal(r.status, 400, r.text);
  assert.match(r.json().say, /The input "jd" is a web page/);
});

test('fire: a schedule with no stored inputs still fires a page input from its signed address, not from an earlier run', async () => {
  const f = await pageWorld();
  const p = await prepare(f.w, {});
  assert.equal((await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: p.json().hash })).status, 200);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  assert.equal(readOutcomes(f.flowDir).at(-1).outcome, 'started');
  const st = JSON.parse(readFileSync(path.join(f.w.root, '.starts', f.w.starts().at(-1), 'start.json'), 'utf8'));
  assert.deepEqual(st.sources.find((x) => x.role === 'jd'), { role: 'jd', path: SIGNED });
});

test('the Job tab Schedule field shows a page input\'s FULL address and a file input\'s name', async () => {
  const f = await pageWorld();
  const inputs = [resume(f.w), { role: 'jd', path: '' }];
  const p = await prepare(f.w, { inputs });
  assert.equal((await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, inputs, hash: p.json().hash })).status, 200);
  const j = (await f.w.get('/api/runs/job2/seed-pass/job')).json();
  assert.match(j.schedule, new RegExp(` · resume\\.md, ${SIGNED.replace(/[.?/]/g, '\\$&')}$`), j.schedule);
});
