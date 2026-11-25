// M20 am1 item 9: a cap-halt that cannot be resumed (its halt.json missing) wears [■] with the word "capped"; a resumable one keeps
// "stopped"; the Run tab's words (summary-words.js) are unchanged. $0: a fake modelStep, in-process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { listRuns, getRunDetail } from '../src/panel/data.js';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

async function capHalted(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m20capped-${tag}-`));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8').replaceAll('file:poc/m0/out', `file:${w.dest}`).replace('cap $0.25', 'cap $0.0105');
  const decl = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'job2.m1.declaration.json'), 'utf8'));
  const r = writeFlow({ root: w.root, name: 'job2', proseText: prose, declaration: decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  assert.equal(run.outcome, 'cap-halt', run.red);
  w.cleanup = () => rmSync(base, { recursive: true, force: true });
  return w;
}
const rowOf = (w) => listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');

test('a cap-halt that cannot be resumed wears [■] "capped"; a resumable one keeps "stopped"', async () => {
  const w = await capHalted('a');
  try {
    const live = rowOf(w);
    assert.equal(live.glyph, '[■]');
    assert.equal(live.word, 'stopped', 'resumable: today\'s words');
    assert.equal(live.controls.canResume, true);
    rmSync(path.join(w.runDir, 'halt.json'));
    const gone = rowOf(w);
    assert.equal(gone.glyph, '[■]', 'was [✗] failed (cap-halt)');
    assert.equal(gone.word, 'capped');
    assert.equal(gone.line, null);
    assert.equal(gone.controls.canResume, false);
    const det = getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
    assert.equal(det.glyph, '[■]');
    assert.equal(det.word, 'capped');
  } finally { w.cleanup(); }
});
