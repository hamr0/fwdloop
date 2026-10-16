// M6 am5 items 2 and 4: a changed job signs as a NEW workflow `<name>-N`; the old workflow's signed files, runs and schedule are untouched,
// and the new one starts with no runs and no schedule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { readFlow } from '../src/flow.js';
import { killChildrenAfter, until } from './m4e-world.mjs';
import { CAT, DAILY, greenWorld, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();

function snapshot(dir, rel = '') {
  const out = {};
  for (const n of readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}
const green = (w, id) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });

test('must fail: signing a changed job leaves every byte of the old workflow (files, runs, schedule) as it was; the new one has no runs and no schedule', async () => {
  const { w, flowDir, read } = await greenWorld();
  assert.equal((await setTrigger(w, DAILY)).status, 200);
  const oldHash = read().signature.flow;
  const before = snapshot(flowDir);
  assert.ok(Object.keys(before).some((f) => f === 'schedule.json'), 'the old job really is scheduled');
  const e = (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
  const job = e.edit.card.job.replace('nothing goes out before I accept', 'nothing goes out before I say so');
  const d = await w.post('/api/author/draft', { ...w.card({ flowName: 'job2-2', job }), reuseOf: { flow: 'job2' } });
  assert.equal(d.status, 202, d.text);
  const id = d.json().draftId;
  const g = await green(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 202, s.text);
  assert.deepEqual(snapshot(flowDir), before, 'the old workflow is byte-identical');
  assert.equal(read().signature.flow, oldHash);
  const nu = readFlow({ root: w.root, name: 'job2-2', catalogue: CAT });
  assert.equal(nu.ok, true, JSON.stringify(nu));
  assert.equal(nu.arbiter.trigger, null, 'a new workflow has no schedule');
  const nd = path.join(w.root, 'job2-2');
  assert.deepEqual(readdirSync(nd).filter((n) => n.startsWith('schedule')), [], 'a new workflow has no schedule file and no queue file');
  assert.ok(readdirSync(path.join(nd, 'runs')).length <= 1, 'no earlier runs (only the run the sign itself starts)');
  assert.equal(readFileSync(path.join(nd, 'model.json'), 'utf8'), readFileSync(path.join(flowDir, 'model.json'), 'utf8'), 'the model carries over');
});

test('the suggested name cannot clash: a card named after an existing workflow is refused at the card, at $0', async () => {
  const { w } = await greenWorld();
  const e = (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
  const d = await w.post('/api/author/draft', { ...w.card({ flowName: 'job2', job: `${e.edit.card.job}\nmore` }), reuseOf: { flow: 'job2' } });
  assert.equal(d.status, 400, d.text);
  assert.match(JSON.stringify(d.json().refusals), /already a flow named/);
});
