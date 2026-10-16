// M6 am9 piece 3: the draft door. A RED (`[✗]`) source run drafts even when the job is unchanged, and the new plan runs as the next run of the SAME workflow
// (no new workflow, the workflow's files untouched). Green, stopped and waiting source runs keep the am6 guard. The server reads "red" itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, readdirSync,
} from 'node:fs';
import path from 'node:path';

import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  w.seedPassed('job2', 'seed-red', { outcome: 'red' });
  w.seedPassed('job2', 'seed-stop', { outcome: 'stopped' });
  return w;
}
const entryOf = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
const snap = (w) => Object.fromEntries(['prose.txt', 'declaration.json', 'signature.json', 'signed/prose.txt'].map((f) => [f, readFileSync(path.join(w.root, 'job2', f), 'utf8')]));
const draftBody = async (w, fromRun, over = {}) => {
  const e = await entryOf(w);
  return { ...w.card({ flowName: 'job2-2', capUsd: '0.30' }), job: e.edit.card.job, reuseOf: { flow: 'job2', fromRun }, ...over };
};

test('a red run\'s Reuse card with the job UNCHANGED drafts (202), as a run of the same workflow: the card is named for the workflow and the draft records it', async () => {
  const w = await signedWorld();
  const d = await w.post('/api/author/draft', await draftBody(w, 'seed-red'));
  assert.equal(d.status, 202, d.text);
  const dir = w.dir(d.json().draftId);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'run-of.json'), 'utf8')), { flow: 'job2', fromRun: 'seed-red' });
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'card.json'), 'utf8')).flowName, 'job2', 'the draft is named for the SAME workflow, not job2-2');
  await until(async () => { const j = (await w.get(`/api/author/${d.json().draftId}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
});

test('must fail: a green, stopped or unknown source run with the job unchanged is still refused job-unchanged, creating nothing', async () => {
  const w = await signedWorld();
  const before = existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0;
  for (const fromRun of ['seed-pass', 'seed-stop', 'no-such-run', '']) {
    const d = await w.post('/api/author/draft', await draftBody(w, fromRun));
    assert.equal(d.status, 409, `${fromRun}: ${d.text}`);
    assert.equal(d.json().refused, 'job-unchanged');
  }
  const none = await w.post('/api/author/draft', { ...(await draftBody(w, 'seed-red')), reuseOf: { flow: 'job2' } });
  assert.equal(none.status, 409, 'a page that names no run cannot claim red');
  const after = existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0;
  assert.equal(after, before);
});

test('a red run with a CHANGED job is still a new workflow: its taken name is refused as before, and no run-of record is written', async () => {
  const w = await signedWorld();
  const e = await entryOf(w);
  const taken = await w.post('/api/author/draft', await draftBody(w, 'seed-red', { flowName: 'job2', job: `${e.edit.card.job}\nand one more step` }));
  assert.equal(taken.status, 400, taken.text);
  const ok = await w.post('/api/author/draft', await draftBody(w, 'seed-red', { flowName: 'job2-2', job: `${e.edit.card.job}\nand one more step` }));
  assert.equal(ok.status, 202, ok.text);
  assert.equal(existsSync(path.join(w.dir(ok.json().draftId), 'run-of.json')), false);
  await until(async () => { const j = (await w.get(`/api/author/${ok.json().draftId}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
});

test('red redraft end to end: sign makes run-N of the SAME workflow and starts it; the workflow\'s files are byte-identical; no job2-2', async () => {
  const w = await signedWorld();
  const before = snap(w);
  const d = await w.post('/api/author/draft', await draftBody(w, 'seed-red'));
  assert.equal(d.status, 202, d.text);
  const id = d.json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g).slice(0, 300));
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 202, s.text);
  const runId = s.json().runId;
  assert.match(runId, /^run-\d+$/);
  assert.deepEqual(snap(w), before, 'the workflow is never changed');
  assert.equal(existsSync(path.join(w.root, 'job2-2')), false);
  assert.equal(existsSync(path.join(w.root, 'job2', 'runs', runId, 'plan.json')), true);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'signed.json'), 'utf8')).flow, 'job2');
  // the run itself executes the plan it keeps: its book row carries the signature of runs/<run>/job, not the workflow's
  const kept = JSON.parse(readFileSync(path.join(w.root, 'job2', 'runs', runId, 'job', 'signature.json'), 'utf8')).flow;
  const state = await until(() => {
    try { return JSON.parse(readFileSync(path.join(w.root, 'job2', 'runs', runId, 'state.json'), 'utf8')); } catch { return null; }
  });
  assert.equal(state.signatureHash, kept);
  assert.notEqual(kept, JSON.parse(before['signature.json']).flow);
});
