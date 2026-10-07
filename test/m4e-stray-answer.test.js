// M4e: a stray answer.json naming an ask that is not the open one is not "your answer" for this run. A run waiting at a
// NEW ask must still read waiting (Stop offered, one Inbox row); a run stopped at its ask must still read stopped
// (Resume offered). Readers never write: the stray file stays where it is. $0: a fake modelStep; temp dirs removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import * as R from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import {
  getRunControls, getRunDetail, listStops, inboxOpenCount,
} from '../src/panel/data.js';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();

const { runFlow, continueRun, makeParkingAskStep, requestStop } = R;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CAT = cat.primitives;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-stray-${tag}-`));
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
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}
const modelFn = async (ctx) => {
  const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
  return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
};
const args = (w) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: modelFn, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(),
});
const stray = (w, askId) => writeFileSync(path.join(w.runDir, 'answer.json'), JSON.stringify({ askId, decision: 'accept', answeredAt: new Date().toISOString() }));
const view = (w) => ({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });

async function stoppedAtAsk(tag) {
  const w = mk(tag);
  const r = await runFlow({ ...args(w), sources: w.sources });
  assert.equal(r.outcome, 'paused', r.red);
  w.old = readJson(path.join(w.runDir, 'ask.json'));
  requestStop(w.runDir);
  const s = await R.stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(s.outcome, 'stopped', s.red);
  return w;
}

test('stray (a) a run waiting at a NEW ask with a stray answer for the OLD askId: waiting, Stop offered, Inbox counts 1', async () => {
  const w = await stoppedAtAsk('a');
  const c = await continueRun(args(w));
  assert.equal(c.outcome, 'paused', c.red);
  const fresh = readJson(path.join(w.runDir, 'ask.json'));
  assert.notEqual(fresh.askId, w.old.askId);
  stray(w, w.old.askId);
  const d = getRunDetail(view(w));
  assert.notEqual(d.glyph, '[II]', `stuck: ${d.label}`);
  assert.equal(d.glyph, '[·]');
  assert.equal(getRunControls(view(w)).canStop, true, 'Stop offered');
  const rows = listStops({ root: w.root }).filter((s) => s.runId === 'run-1');
  assert.equal(rows.length, 1, `one Inbox row, got ${JSON.stringify(rows.map((r) => [r.stuck, r.waiting]))}`);
  assert.equal(rows[0].stuck, false);
  assert.equal(inboxOpenCount(listStops({ root: w.root })), 1);
  assert.equal(existsSync(path.join(w.runDir, 'answer.json')), true, 'a reader never moves the stray file');
});

test('stray (b) a run stopped at its ask with a stray answer for the stopped askId: still [■] stopped, Resume offered, not stuck', async () => {
  const w = await stoppedAtAsk('b');
  stray(w, w.old.askId);
  const d = getRunDetail(view(w));
  assert.equal(d.glyph, '[■]', `${d.glyph} ${d.label}`);
  assert.equal(d.controls.canResume, true);
  assert.equal(listStops({ root: w.root }).some((s) => s.runId === 'run-1' && s.stuck), false);
  assert.equal(existsSync(path.join(w.runDir, 'answer.json')), true);
});
