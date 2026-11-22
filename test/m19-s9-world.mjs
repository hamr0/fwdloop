// M19 S9 / P8 (F231) fixture: a green SHAPE plan on the panel's real HTTP door, drafted by the real `fwdloop draft` child with the test fake provider answering the shape look (FWDLOOP_TEST_DRAFT_SHAPE).
// A first draft in the panel asks about every rule it cannot check, and such a rule is never a shape candidate; the plan after the answers is drafted with `--no-questions` and its folder carries `redraft-<n>.json`.
// This fixture reaches that same state in two steps with nothing else changed: the child is the real bin with `--no-questions` added (poc/m19-p8/noq/fwdloop), a Revise makes `draft-1`, and `redraft-1.json` is written
// as the answers' redraft writes it (no `rowEdit`), so the route reads the plan as drafted without asks (src/panel/author.js `rowEdit`).
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFwdloopAlive } from '../src/liveness.js';
import { until, world } from './m4e-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NOQ_BIN = path.join(HERE, '..', 'poc', 'm19-p8', 'noq', 'fwdloop');
const FX = new URL('./fixtures/shape-contested/', import.meta.url);
const TRACKER = readFileSync(new URL('research-tracker.txt', FX), 'utf8');
const RAW1 = readFileSync(new URL('shape-map.raw.json', FX), 'utf8');
/** the saved shape answer of the tracker job, put on job line 3; its extra field `owner` has no word of the job (Suggested), `entry` has (on, droppable) */
export const RAW_OWNER = RAW1.replace('"line":1', '"line":3');
export const RAW_ENTRY = RAW_OWNER.replace('"name":"owner"', '"name":"entry"');
export const JOB = ['Read my resume,', 'and read the JD to compare it against,', 'List every research item in the tracker, one entry each,', '~each item has a title', '~status is one of in progress, closed, finished', '~summary is under 200 characters', 'Ask 30m: check it with me,', '~nothing goes out before I accept', 'write it out'].join('\n');

export const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
export const settle = (w, id, phases = ['green', 'red', 'stopped']) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
export const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
export const readIn = (w, id, rel) => readFileSync(path.join(w.dir(id), rel), 'utf8');
export const readJsonIn = (w, id, rel) => JSON.parse(readIn(w, id, rel));

/**
 * A green shape plan (`draft-1`) with the provider shut: `calls()` counts every provider call a child made (any kind), `deny()` makes the fake throw on any call from then on.
 * @param {{raw?: string}} [o]
 */
export async function shapePlan({ raw = RAW_OWNER } = {}) {
  const w = await world({ bin: NOQ_BIN, extraEnv: {} });
  const callsFile = path.join(w.work, 'calls.log');
  const denyFile = path.join(w.work, 'deny');
  w.env.FWDLOOP_TEST_DRAFT_SHAPE = raw;
  w.env.FWDLOOP_TEST_DRAFT_CALLS = callsFile;
  w.env.FWDLOOP_TEST_DRAFT_DENY = denyFile;
  writeFileSync(path.join(w.inDir, 'tracker.txt'), TRACKER);
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const first = await settle(w, id);
  await childGone(w, id);
  const card = readJsonIn(w, id, 'card.json');
  const rv = await w.post(`/api/author/${id}/revise`, { ...card, capUsd: Number(card.capUsd) + 1 });
  if (rv.status !== 202) throw new Error(`revise ${rv.status} ${rv.text}`);
  await until(async () => (await state(w, id)).plan !== first.plan);
  const g = await settle(w, id);
  await childGone(w, id);
  writeFileSync(path.join(w.dir(id), 'redraft-1.json'), `${JSON.stringify({ fromPlan: first.plan, answers: [] })}\n`);
  const calls = () => (existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length : 0);
  const deny = () => writeFileSync(denyFile, 'x');
  const allow = () => rmSync(denyFile, { force: true });
  return { w, id, g, calls, deny, allow, callsFile, denyFile };
}
