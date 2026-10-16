// Shared by the M9 am10 / am20 tests: a signed job2 in its own folder (no panel, $0, a fake modelStep) with one finished green run-0, so a schedule can be set,
// and the trigger door over it (`w.click(trigger)` = both clicks; null = Cancel). With `values`, run-1 already carries `signed-values.json` (what Sign & run writes).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, writeFlow } from '../src/flow.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { valuesHash, writeRunValues } from '../src/runvalues.js';
import { createTriggerDoor } from '../src/panel/authortrigger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
export const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
export const DAILY = { kind: 'daily', hour: 9, minute: 0 };
const at = (day, hh = 0) => new Date(2026, 9, day, hh).getTime();

/** A signed job2 with one finished (green) run-0 so a schedule can be set; a door over it; run-1 carries SIGNED VALUES. */
export async function scheduledJob({ values = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m9am20-b-'));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'), goals: [] };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  w.prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({ root: w.root, name: 'job2', proseText: w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  w.args = (runId) => ({ root: w.root, name: 'job2', runId, catalogue: CAT, modelStep: w.modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, sources: w.sources });
  const first = await runFlow({ ...w.args('run-0'), askStep: makeParkingAskStep() });
  assert.equal(first.outcome, 'paused', first.red);
  assert.equal(answerAsk({ runDir: path.join(w.flowDir, 'runs', 'run-0'), askId: first.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun({ ...w.args('run-0'), askStep: makeParkingAskStep() });
  assert.equal(done.outcome, 'complete', done.red);
  const door = createTriggerDoor({
    root: w.root,
    flowsDoor: { editBlock: () => null, scheduleBusy: () => null, lastSourcesOf: () => ({ sources: {} }) },
    starter: /** @type {any} */ ({ canStart: () => null, start: () => ({ status: 500, body: {} }) }),
    loadEnv: () => ({ ok: true, env: {}, keyNames: [] }),
    monthlyClaim: () => null,
    modelRefusal: () => [],
    now: () => at(13, 8),
  });
  w.door = door;
  const click = (trigger) => {
    const p = door.prepare({ flow: 'job2', trigger });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    return door.set({ flow: 'job2', trigger, hash: p.body.hash });
  };
  w.click = click;
  assert.equal(click(DAILY).status, 200, 'the schedule is set (the job has a green run)');
  const runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.runDir = runDir;
  if (!values) return w;
  mkdirSync(runDir, { recursive: true });   // run-1 carries signed values (written once, before the run starts: what Sign & run does)
  const rec = {
    flow: 'job2', flowSignatureHash: readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow, runId: null, version: 0, values: { capUsd: 0.25, destination: w.dest, askWaits: { 4: '30m' } }, signedBy: 't', at: '2026-10-16T00:00:00.000Z',
  };
  assert.equal(writeRunValues(runDir, { ...rec, runId: 'run-1', hash: valuesHash(rec) }).ok, true);
  return w;
}

