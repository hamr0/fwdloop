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

test('(1) the Signed-flow list offers each job as a card: its lines, guardrails, inputs, destination, cap and waits', async () => {
  const { w, hash } = await signedWorld();
  const entry = await flowEntry(w);
  assert.equal(entry.edit.ok, true, JSON.stringify(entry.edit));
  const c = entry.edit.card;
  assert.equal(c.capUsd, '0.25');
  assert.equal(c.destination, w.outDir);
  assert.match(c.job, /^Ask 30m: check it with me,$/m);
  assert.match(c.job, /^~ 3 sections, all under 600 words$/m);
  assert.match(c.inputs, /^resume: .*resume\.md$/m);
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

