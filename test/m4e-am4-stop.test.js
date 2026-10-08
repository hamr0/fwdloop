// M4e amendment 4 item 4 (Stop) and negative (d): the runner's stop seam, the `stopped` outcome with its halt record, the Stop door
// and the one sign/word for it. $0: a fake modelStep in-process, and the real `bin/fwdloop run` child with the gated test model step
// over real HTTP for the door. Every temp dir is removed and every child killed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import {
  runFlow, resumeRun, makeParkingAskStep, STOP_FILE, HALT_FILE, requestStop, readHaltRecord,
} from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { getRunDetail, listRuns } from '../src/panel/data.js';
import {
  GATED_STEP, killChildrenAfter, rq, until, world,
} from './m4e-world.mjs';
import { fileURLToPath } from 'node:url';

killChildrenAfter();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CAT = cat.primitives;

/** A signed job #2 flow (3 model steps, an ask, a send) in a scratch root; the send goes to `w.dest`. */
function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am4-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}

function step(onCall) {
  const calls = [];
  const fn = async (ctx) => {
    let emits; let text;
    if (ctx.goal.includes('resume .docx')) { emits = 'resume-text'; text = 'resume text'; } else if (ctx.goal.includes('job description markdown')) { emits = 'jd-text'; text = 'jd text'; } else {
      emits = 'resume-summary';
      text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
    }
    calls.push(emits);
    if (onCall) await onCall(emits);
    return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
  };
  return { fn, calls };
}
const args = (w, modelStep, runId = 'run-1', extra = {}) => ({
  root: w.root, name: 'job2', runId, catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});

test('am4 (d): a stop that lands during step 2 ends the run `stopped` AFTER step 2 closed — its artifact and green row written, spend booked, step 3 never starts', async () => {
  const w = mk('d');
  const runDir = path.join(w.flowDir, 'runs', 'run-1');
  const { fn, calls } = step(async (emits) => { if (emits === 'jd-text') assert.equal(requestStop(runDir), 'written'); });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.deepEqual(calls, ['resume-text', 'jd-text'], 'step 3 never started');
  assert.equal(existsSync(path.join(runDir, 'artifacts', 'jd-text.json')), true, 'step 2 artifact written');
  assert.equal(existsSync(path.join(runDir, 'artifacts', 'resume-summary.json')), false);
  const audit = readAudit(runDir);
  assert.ok(audit.some((x) => x.step === 'jd-text' && x.usd === 0.001), `step 2 row booked: ${JSON.stringify(audit)}`);
  const hist = readHistory(w.flowDir).at(-1);
  assert.equal(hist.outcome, 'stopped');
  assert.ok(Math.abs(hist.spentUsd - 0.002) < 1e-9, `steps 1+2 booked, got ${hist.spentUsd}`);
  assert.equal(existsSync(path.join(runDir, STOP_FILE)), false, 'the seam consumed the request');
  const halt = readHaltRecord(runDir);
  assert.equal(halt.ok && halt.halt.stepIndex, 2, 'resumable at step 3');
  assert.equal(halt.halt.outcome, 'stopped');
  assert.equal(JSON.parse(readFileSync(path.join(runDir, 'log.json'), 'utf8')).outcome, 'stopped', 'log.json kept on this exit too');
});

test('am4 (d) control: the same run with no stop request goes on past step 2 to its ask', async () => {
  const w = mk('dc');
  const { fn, calls } = step();
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'paused');
  assert.deepEqual(calls, ['resume-text', 'jd-text', 'resume-summary']);
  assert.equal(existsSync(path.join(w.flowDir, 'runs', 'run-1', HALT_FILE)), false);
});

test('am4 (d): a stop during step 3 stops BEFORE the ask (the seam sits in front of every step, an ask included); a stop that lands as a run parks stops it AT the ask (amendment 13), nothing carried to a later resume', async () => {
  const w = mk('dl');
  const runDir = path.join(w.flowDir, 'runs', 'run-1');
  const { fn } = step(async (emits) => { if (emits === 'resume-summary') requestStop(runDir); });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(readHaltRecord(runDir).halt.stepIndex, 3, 'resumable at the ask step');
  // a stop that lands while the run is parking
  const w2 = mk('dl2');
  const runDir2 = path.join(w2.flowDir, 'runs', 'run-1');
  const { fn: fn2 } = step();
  const parkAndStop = async () => { requestStop(runDir2); return { decision: 'park' }; };
  const p = await runFlow({ ...args(w2, fn2, 'run-1', { askStep: parkAndStop }), sources: w2.sources });
  // amendment 13 replaces "a Stop as the run parks is cleared (paused)": a park is not an end, the run stops at the ask
  assert.equal(p.outcome, 'stopped', p.red);
  assert.equal(existsSync(path.join(runDir2, STOP_FILE)), false, 'the request is consumed, not carried');
  assert.equal(existsSync(path.join(runDir2, 'ask.json')), false, 'no ask waits');
  assert.equal(readHaltRecord(runDir2).halt.stepIndex, 3, 'Resume asks again at the ask step');
});

test('am4 (d): the seam reads the request for EVERY kind of step — a stop pending when an accepted ask hands over to the signed send stops BEFORE the send (nothing shipped)', async () => {
  const w = mk('ds');
  const runDir = path.join(w.flowDir, 'runs', 'run-1');
  const { fn } = step();
  const parked = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(parked.outcome, 'paused');
  const ask = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8'));
  assert.equal(answerAsk({ runDir, askId: ask.askId, decision: 'accept' }).ok, true);
  requestStop(runDir); // the human clicked Stop while the answer was being applied
  const r = await resumeRun(args(w, fn));
  assert.equal(r.outcome, 'stopped', r.red);
  assert.deepEqual(readdirSync(w.dest), [], 'the send step never ran: nothing reached the destination');
  assert.equal(readHaltRecord(runDir).halt.stepIndex, 4, 'resumable at the send step');
});

test('am4 (d): the Stop door over HTTP — running -> 202 and a stop file; the run ends [■] stopped (never failed) with Resume offered; a second Stop and a Stop on a parked run are refused in words, writing nothing', async () => {
  const w = await world({ step: GATED_STEP });
  await w.signedFlow();
  const runDir = path.join(w.root, 'job2', 'runs', 'r1');
  // nothing to stop yet: no such run
  assert.equal((await w.post('/api/stop', { flow: 'job2', runId: 'r1' })).status, 404);
  const start = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r1' })).json();
  await until(async () => { const j = (await w.get(`/api/author/start/${start.startId}`)).json(); return j?.phase === 'started' && j.state === 'working' ? j : null; });
  // foreign origin / host: refused, nothing written
  assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/stop', body: { flow: 'job2', runId: 'r1' }, headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal(existsSync(path.join(runDir, STOP_FILE)), false);
  const shown = (await w.get('/api/runs/job2/r1')).json();
  assert.equal(shown.controls.canStop, true);
  assert.equal(shown.controls.stopRequested, false);
  const ok = await w.post('/api/stop', { flow: 'job2', runId: 'r1' });
  assert.equal(ok.status, 202, ok.text);
  assert.equal(existsSync(path.join(runDir, STOP_FILE)), true);
  assert.equal((await w.get('/api/runs/job2/r1')).json().controls.stopRequested, true, 'the page can say "stopping after this step…"');
  writeFileSync(w.gate, 'go'); // release the held step: it closes, then the seam reads the request
  const end = await until(async () => { const d = (await w.get('/api/runs/job2/r1')).json(); return d.glyph === '[■]' ? d : null; });
  assert.equal(end.word, 'stopped');
  assert.equal(end.outcome, 'stopped');
  assert.equal(end.controls.canStop, false);
  assert.equal(end.controls.canResume, true);
  assert.doesNotMatch(JSON.stringify([end.label, end.line, end.word]), /failed/);
  assert.equal(existsSync(path.join(runDir, 'artifacts', 'resume-text.json')), true, 'the step that was running closed cleanly');
  assert.equal(existsSync(path.join(runDir, 'artifacts', 'jd-text.json')), false, 'no next step started');
  const list = (await w.get('/api/runs')).json().rows.find((r) => r.runId === 'r1');
  assert.equal(list.glyph, '[■]');
  assert.equal(list.word, 'stopped');
  // a second Stop on a stopped run
  const again = await w.post('/api/stop', { flow: 'job2', runId: 'r1' });
  assert.equal(again.status, 409);
  assert.equal(again.json().say, 'This run is not running, so there is nothing to stop.');
  assert.equal(existsSync(path.join(runDir, STOP_FILE)), false, 'a refused Stop writes nothing');
  // a parked run: its own flow, run to the ask
  const start2 = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r2' })).json();
  await until(async () => { const j = (await w.get(`/api/author/start/${start2.startId}`)).json(); return j?.phase === 'started' && j.state === 'parked' ? j : null; });
  // amendment 13: a Stop on a waiting run is accepted and stops the run at the ask (was: refused in words)
  assert.equal((await w.get('/api/runs/job2/r2')).json().controls.canStop, true, 'a waiting run shows Stop');
  const parked = await w.post('/api/stop', { flow: 'job2', runId: 'r2' });
  assert.equal(parked.status, 202, parked.text);
  assert.equal(existsSync(path.join(w.root, 'job2', 'runs', 'r2', STOP_FILE)), false, 'the request is consumed at the ask');
  assert.equal((await w.get('/api/runs/job2/r2')).json().glyph, '[■]');
});

test('am4: a cap-halted run that has its halt record reads [■] stopped (resumable); one without it (a run from before the record existed) stays failed', async () => {
  const w = mk('cap');
  const { fn } = step();
  const r = await runFlow({ ...args(w, fn, 'run-1', { ceilingUsd: 0.01 }), sources: w.sources });
  assert.equal(r.outcome, 'paused');
  const w2 = mk('cap2');
  // cap $0.0105 funds step 1 only: sign a flow with that cap
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w2.dest}`).replace('cap $0.25', 'cap $0.0105');
  const small = writeFlow({
    root: w2.root, name: 'small', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(small.ok, true, small.ok ? '' : small.reds.join('\n'));
  const halted = await runFlow({ ...args(w2, fn, 'run-1', { name: 'small', ceilingUsd: 0.01 }), name: 'small', sources: w2.sources });
  assert.equal(halted.outcome, 'cap-halt', halted.red);
  const d = getRunDetail({ root: w2.root, flow: 'small', runId: 'run-1', catalogue: CAT });
  assert.equal(d.glyph, '[■]');
  assert.equal(d.word, 'stopped');
  assert.equal(d.controls.canResume, true);
  assert.equal(d.controls.resumeOutcome, 'cap-halt');
  // the same run as an old one: remove the record -> failed, no Resume
  unlinkSync(path.join(w2.root, 'small', 'runs', 'run-1', HALT_FILE));
  const old = getRunDetail({ root: w2.root, flow: 'small', runId: 'run-1', catalogue: CAT });
  assert.equal(old.glyph, '[✗]');
  assert.equal(old.word, 'failed');
  assert.equal(old.controls.canResume, false);
  assert.equal(listRuns({ root: w2.root, catalogue: CAT }).find((x) => x.runId === 'run-1').controls.canResume, false);
});
