// M6 review F5: the page never offers what the door refuses. A stopped run whose job was replaced since has no Resume button (the runner
// refuses it as "signature mismatch"); the same run with the job untouched keeps it. $0: a fake modelStep, in-process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow, writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep, requestStop } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { getRunControls } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

/** A signed job2, run until a Stop lands at its ask: `[■]` stopped, resumable. */
async function stoppedRun(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m6f5-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  w.prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
  const modelStep = async (ctx) => {
    const emits = emitsOf(ctx);
    if (emits === 'resume-summary') requestStop(w.runDir);
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  assert.equal(run.outcome, 'stopped', run.red);
  return w;
}
const controls = (w) => getRunControls({
  root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT,
});

test('F5: a stopped run with the job untouched keeps its Resume button', async () => {
  const w = await stoppedRun('same');
  assert.equal(controls(w).canResume, true);
});

test('F5: a stopped run whose job was replaced since has no Resume button', async () => {
  const w = await stoppedRun('swapped');
  const oldHash = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: w.prose.replace('cap $0.25', 'cap $0.30'), declaration: w.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: oldHash },
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  const c = controls(w);
  assert.equal(c.canResume, false, JSON.stringify(c));
  assert.equal(c.resumeOutcome, null);
});
