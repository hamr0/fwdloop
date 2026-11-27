// F266 ($0): am2's step lines (step-start {no,id,label,at}, step-end {no,status,label,at}) from the draft child into child.log, joined by id. Runs inside the prototype root (test/p2.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { draftStepList } from '../src/draft-steps.js';
import { killChildrenAfter, until, world, JOB } from './m4e-world.mjs';

killChildrenAfter();
const jf = (f) => JSON.parse(readFileSync(f, 'utf8'));
const poll = (w, id) => async () => (await w.get(`/api/author/${id}`)).json();

test('a live: steps so far, exactly one running', async () => {
  const w = await world({ mode: 'hang', extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'applied' } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const j = await until(async () => { const s = await poll(w, id)(); return s?.steps?.length >= 2 ? s : null; }, 60000);
  console.log('LIVE', JSON.stringify(j.steps.map((s) => [s.no, s.id, s.label, s.status])));
  assert.equal(j.phase, 'drafting');
  assert.equal(j.steps.filter((s) => s.status === 'running').length, 1);
});

test('b after the draft ends, joined by id; c no lines, no times', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'applied' } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const j = await until(async () => { const s = await poll(w, id)(); return s?.phase === 'green' ? s : null; }, 60000);
  const dir = path.join(w.dir(id), 'draft');
  const want = draftStepList({ log: jf(path.join(dir, 'log.json')), declaration: jf(path.join(dir, 'declaration.json')) });
  const used = new Set();
  const joined = want.map((x) => { const m = j.steps.find((s) => s.id === x.id && !used.has(s.no)); if (m) used.add(m.no); return { ...x, line: m ?? null }; });
  console.log('ENDED', JSON.stringify(joined.map((x) => [x.id, x.label, x.line && [x.line.label, x.line.startedAt !== null, x.line.endedAt !== null]])));
  assert.ok(want.length >= 3);
  for (const x of joined) {
    if (x.id === 'thinking' || x.note) { assert.equal(x.line, null, `${x.id} shows no time`); continue; }
    assert.ok(x.line, `${x.id} has a line`);
    assert.ok(x.line.startedAt && x.line.endedAt, `${x.id} start and end`);
    assert.equal(x.line.label, x.label, `${x.id} final label`);
  }
  assert.equal(j.steps.length, joined.filter((x) => x.line).length, 'no stray line');
  console.log('LISTING', JSON.stringify(readdirSync(w.dir(id), { recursive: true }).filter((n) => !/pages/.test(n)).sort()));
  const log = path.join(w.dir(id), 'child.log');
  writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/^fwdloop: step-(start|end) /.test(l)).join('\n'));
  assert.deepEqual((await poll(w, id)()).steps, []);
});
