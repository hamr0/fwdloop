// M6 amendment 4 (SIGNED 2026-10-10, "sign m6 am4"): no "Resume" on an edited job. A stopped run (or one stopped at its money cap) whose
// job was edited and signed since reads "stopped — the job was edited; start a new run" in Runs, Ask and Inbox and has no Resume; every
// other stopped run keeps its old words. $0: a fake modelStep, in-process. The one signal is `sameJob` (M6 F5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow, writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep, requestStop, stopParkedRun } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import {
  getRunAsks, getRunControls, listRuns, listStops,
} from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const EDITED = 'stopped — the job was edited; start a new run';

/** A signed job2 run until it stops at its ask (`stop`: a Stop lands while it waits) or hits its money cap (`cap`). */
async function haltedRun(tag, kind) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m6am4-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const cap = kind === 'cap' ? '0.0105' : '0.25';
  w.prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`).replace('cap $0.25', `cap $${cap}`);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
  const modelStep = async (ctx) => {
    const emits = emitsOf(ctx);
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  if (kind === 'stop') {
    assert.equal(run.outcome, 'paused', run.red);
    requestStop(w.runDir);
    const stop = await stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
    assert.equal(stop.outcome, 'stopped', stop.red);
  } else assert.equal(run.outcome, 'cap-halt', run.red);
  return w;
}
function replaceJob(w, from, to) {
  const oldHash = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: w.prose.replace(from, to), declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash },
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
}
const runsRow = (w) => listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
const askRows = (w) => getRunAsks({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }).asks;
const inboxRows = (w) => listStops({ root: w.root, catalogue: CAT }).filter((x) => x.runId === 'run-1');
const controls = (w) => getRunControls({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });

test('am4: a run stopped at its ask, job replaced since: Runs, Ask and Inbox all say the new sentence, no Resume, glyph stays [■]', async () => {
  const w = await haltedRun('stop-edit', 'stop');
  replaceJob(w, 'cap $0.25', 'cap $0.30');
  const row = runsRow(w);
  assert.equal(row.glyph, '[■]');
  assert.equal(row.label, EDITED);
  assert.equal(controls(w).canResume, false);
  const asks = askRows(w).filter((a) => a.status === 'stopped');
  assert.ok(asks.length > 0, 'the stopped ask is listed');
  for (const a of asks) assert.equal(a.statusText, EDITED);
  const stops = inboxRows(w).filter((a) => a.status === 'stopped');
  assert.ok(stops.length > 0);
  for (const a of stops) assert.equal(a.statusText, EDITED);
});

test('am4: a cap-halted run, job replaced since: Runs says the new sentence, no Resume, glyph stays [■]', async () => {
  const w = await haltedRun('cap-edit', 'cap');
  assert.match(runsRow(w).label, /money cap was reached/, 'unedited baseline');
  assert.equal(controls(w).canResume, true);
  replaceJob(w, 'cap $0.0105', 'cap $0.0106');
  const row = runsRow(w);
  assert.equal(row.glyph, '[■]');
  assert.equal(row.label, EDITED);
  assert.equal(controls(w).canResume, false);
  for (const a of [...askRows(w), ...inboxRows(w)]) assert.notEqual(a.statusText, 'stopped — Resume to go on', 'no ask row offers a Resume either');
});

test('am4: the same runs with the job untouched keep their old words and their Resume', async () => {
  const s = await haltedRun('stop-same', 'stop');
  const label = runsRow(s).label;
  assert.match(label, /Resume to go on$/);
  assert.notEqual(label, EDITED);
  assert.equal(controls(s).canResume, true);
  for (const a of [...askRows(s), ...inboxRows(s)].filter((x) => x.status === 'stopped')) assert.notEqual(a.statusText, EDITED);
  const c = await haltedRun('cap-same', 'cap');
  assert.equal(runsRow(c).label, 'stopped — the money cap was reached; raise it and Resume');
  assert.equal(controls(c).canResume, true);
});
