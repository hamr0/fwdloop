// Shared by the M9 piece 3/4 tests: a signed, once-green job2 in a real panel (the M4e world), and the trigger door over real HTTP.
import {
  appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, writeRunJobCopy } from '../src/flow.js';
import { world } from './m4e-world.mjs';

export const CAT = loadCatalogue().primitives;
export const DAILY = { kind: 'daily', hour: 9, minute: 0 };

/** A passed run that ran THIS job: its own job copy plus a `complete` history row. */
export function seedGreen(w, flow = 'job2', runId = 'seed-pass') {
  const flowDir = path.join(w.root, flow);
  const runDir = path.join(flowDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const read = readFlow({ root: w.root, name: flow, catalogue: CAT });
  const c = writeRunJobCopy(flowDir, runDir, read.signature.flow);
  if (!c.ok) throw new Error(c.red);
  writeFileSync(path.join(runDir, 'inputs.json'), JSON.stringify([
    { id: 'resume', source: path.join(w.inDir, 'resume.md') }, { id: 'jd', source: path.join(w.inDir, 'jd.md') },
  ]));
  appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({
    runId, at: '2026-10-06T10:00:00.000Z', outcome: 'complete', spentUsd: 0.02, spendComplete: true, capUsd: 0.25, wallMs: 90_000, signatureHash: read.signature.flow,
  })}\n`);
  return runDir;
}

/** A world with a signed job2 that has one green run. */
export async function greenWorld(o = {}) {
  const w = await world({ limit: 5, ...o });
  await w.signedFlow();
  seedGreen(w);
  return { w, flowDir: path.join(w.root, 'job2'), read: () => readFlow({ root: w.root, name: 'job2', catalogue: CAT }) };
}

/** Prepare then set, both clicks. Returns the second response (or the first if it was refused). */
export async function setTrigger(w, trigger, flow = 'job2') {
  const p = await w.post('/api/author/trigger-prepare', { flow, trigger });
  if (p.status !== 200) return p;
  return w.post('/api/author/trigger', { flow, trigger, hash: p.json().hash });
}

export const readJsonl = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
export const ls = (d) => { try { return readdirSync(d).sort(); } catch { return []; } };
