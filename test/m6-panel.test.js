// M6 piece C/D (server side, over real HTTP): Edit a signed job. The Signed-flow list offers each job's card (`edit`); a draft whose card
// carries `editOf` drafts, revises and signs as a NEW plan under the SAME name, and signing REPLACES the job. An unsigned edit never
// changes the job: abandon it, or leave it green and unsigned, and every file of the flow is byte-identical and it still runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import path from 'node:path';

import { isFwdloopAlive } from '../src/liveness.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, writeFlow } from '../src/flow.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();

const CAT = loadCatalogue().primitives;
/** every file under dir (relative path -> sha256) */
function snapshot(dir, rel = '') {
  const out = {};
  for (const n of readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}
const phaseOf = (w, id, phases) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return phases.includes(j?.phase) ? j : null; });
const flowEntry = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');

/** A world with a signed, once-passed job2 */
async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  const read = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  assert.equal(read.ok, true);
  return { w, hash: read.signature.flow, flowDir: path.join(w.root, 'job2') };
}
const editCard = (w, entry, over = {}) => ({ ...w.card(), ...entry.edit.card, flowName: 'job2', editOf: { flow: 'job2', flowHash: entry.edit.flowHash }, ...over });

test('(1) the Signed-flow list offers each job as a card: its lines, guardrails, inputs, destination, cap and waits, with the hash it is at', async () => {
  const { w, hash } = await signedWorld();
  const entry = await flowEntry(w);
  assert.equal(entry.edit.ok, true, JSON.stringify(entry.edit));
  assert.equal(entry.edit.flowHash, hash);
  const c = entry.edit.card;
  assert.equal(c.capUsd, '0.25');
  assert.equal(c.destination, w.outDir);
  assert.match(c.job, /^Ask 30m: check it with me,$/m);
  assert.match(c.job, /^~ 3 sections, all under 600 words$/m);
  assert.match(c.inputs, /^resume: .*resume\.md$/m);
});

test('(2) edit -> draft -> sign REPLACES the job under the same name; runs/ stays; the run it starts runs the NEW job', async () => {
  const { w, hash, flowDir } = await signedWorld();
  const entry = await flowEntry(w);
  const d = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  assert.equal(d.status, 202, d.text);
  const id = d.json().draftId;
  const g = await phaseOf(w, id, ['green', 'red', 'stopped']);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  assert.deepEqual(JSON.parse(readFileSync(path.join(w.dir(id), 'card.json'), 'utf8')).editOf, { flow: 'job2', flowHash: hash });
  const seededRuns = snapshot(path.join(flowDir, 'runs'));
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow, hash, 'drafting changed nothing');
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 202, s.text);
  const after = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  assert.equal(after.ok, true);
  assert.notEqual(after.signature.flow, hash);
  assert.equal(after.arbiter.capUsd, 0.30);
  for (const [f, h] of Object.entries(seededRuns)) assert.equal(snapshot(path.join(flowDir, 'runs'))[f], h, `${f} untouched`);
  assert.deepEqual(readdirSync(flowDir).filter((n) => n.startsWith('.')), [], 'no backup or staging left');
});

test('(3) must fail: an edit that is abandoned, or drafted and never signed, leaves every file of the job byte-identical, and it still runs', async () => {
  const { w, flowDir } = await signedWorld();
  const before = snapshot(flowDir);
  const entry = await flowEntry(w);
  // a) abandon right after drafting starts
  const d1 = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  assert.equal(d1.status, 202, d1.text);
  const id1 = d1.json().draftId;
  await phaseOf(w, id1, ['green', 'red', 'stopped']);
  assert.equal((await w.post(`/api/author/${id1}/abandon`, {})).status, 200);
  assert.deepEqual(snapshot(flowDir), before, 'abandoned: the job is byte-identical');
  // b) drafted green, sign-prepare (the first click) and then walk away
  const d2 = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.40' }));
  const id2 = d2.json().draftId;
  const g = await phaseOf(w, id2, ['green']);
  assert.equal((await w.post(`/api/author/${id2}/sign-prepare`, {})).status, 200);
  assert.equal(g.phase, 'green');
  assert.deepEqual(snapshot(flowDir), before, 'never signed: the job is byte-identical');
  // and the job still runs (the real `fwdloop run` child, test model step)
  const run = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'after-edit' });
  assert.equal(run.status, 202, run.text);
  const parked = await until(async () => { const v = (await w.get(`/api/author/start/${run.json().startId}`)).json(); return v.state === 'parked' ? v : null; });
  assert.equal(parked.phase, 'started');
});

test('(4) a job signed again while an edit was open: signing that edit is refused by name and changes nothing; a new card at the old hash is refused at the card', async () => {
  const { w, hash, flowDir } = await signedWorld();
  const entry = await flowEntry(w);
  const d = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  const id = d.json().draftId;
  const g = await phaseOf(w, id, ['green']);
  // meanwhile the job is signed again by someone else, through the same one writer, from the hash this edit was opened at
  const again = writeFlow({
    root: w.root, name: 'job2', proseText: readFileSync(path.join(flowDir, 'prose.txt'), 'utf8').replace('cap $0.25', 'cap $0.20'),
    declaration: JSON.parse(readFileSync(path.join(flowDir, 'declaration.json'), 'utf8')), signedBy: 'else', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT, replaces: { flowHash: hash },
  });
  assert.equal(again.ok, true, JSON.stringify(again.reds));
  const signedAgain = snapshot(flowDir);
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 409, s.text);
  assert.equal(s.json().refused, 'sign-refused');
  assert.match(JSON.stringify(s.json().reds), /was signed again since you opened it/);
  assert.deepEqual(snapshot(flowDir), signedAgain, 'the newer signing stands, untouched');
  await w.post(`/api/author/${id}/abandon`, {});
  const stale = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.45' }));
  assert.equal(stale.status, 400, stale.text);
  assert.ok(stale.json().refusals.some((r) => r.field === 'flowName' && /signed again since you opened it/.test(r.say)), stale.text);
  assert.deepEqual(snapshot(flowDir), signedAgain);
});

test('(5) a brand-new card whose name is taken is refused exactly as before', async () => {
  const { w, flowDir } = await signedWorld();
  const before = snapshot(flowDir);
  const r = await w.post('/api/author/draft', w.card());
  assert.equal(r.status, 400, r.text);
  assert.ok(r.json().refusals.some((x) => x.field === 'flowName' && /already a flow named "job2"/.test(x.say)));
  assert.deepEqual(snapshot(flowDir), before);
  assert.equal(existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0, 1, 'only the job signed in setup left a draft folder; the refusal made none');
});

test('(6) a Revise of an edit keeps editing: with editOf it drafts and signs as a replacement; without it the name is taken and the revise is refused', async () => {
  const { w, hash, flowDir } = await signedWorld();
  const entry = await flowEntry(w);
  const d = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  const id = d.json().draftId;
  await phaseOf(w, id, ['green']);
  const pid = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
  const before = snapshot(flowDir);
  const plain = await w.post(`/api/author/${id}/revise`, { ...editCard(w, entry, { capUsd: '0.33' }), editOf: undefined });
  assert.equal(plain.status, 400, plain.text);
  assert.ok(plain.json().refusals.some((r) => r.field === 'flowName'));
  assert.deepEqual(snapshot(flowDir), before);
  const rv = await w.post(`/api/author/${id}/revise`, editCard(w, entry, { capUsd: '0.33' }));
  assert.equal(rv.status, 202, rv.text);
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return j?.phase === 'green' && j.revises?.length ? j : null; });
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 202, s.text);
  const after = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  assert.equal(after.arbiter.capUsd, 0.33);
  assert.notEqual(after.signature.flow, hash);
});
