// M4e amendment 17 (SIGNED 2026-10-08): 1A (a stopped ask's step number comes from its own place), 2A (a stop time that is not a date
// is "now"), 3A (a "process gone" run is never rolled), 5 (header, a docs item; nothing to test but the words). $0: fake model steps.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import * as R from '../src/runner.js';
import * as monthly from '../src/monthly.js';
import { getRunAsks, listStops } from '../src/panel/data.js';

const {
  runFlow, resumeRun, makeParkingAskStep, requestStop, STOP_FILE,
} = R;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am17-${tag}-`));
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
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
const stepFn = async (ctx) => {
  const emits = emitsOf(ctx);
  return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
};
const args = (w, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: stepFn, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});
async function parked(tag) {
  const w = mk(tag);
  const r = await runFlow({ ...args(w), sources: w.sources });
  assert.equal(r.outcome, 'paused', r.red);
  w.ask = JSON.parse(readFileSync(path.join(w.runDir, 'ask.json'), 'utf8'));
  return w;
}
const view = (w) => ({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });

// ---- 1A ----
test('1A a Stop before any ask parks, then a Stop at the ask of step 4: the ask reads its own step, not the earlier stop\'s', async () => {
  const w = await parked('a1');
  requestStop(w.runDir);
  const s = await R.stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(s.outcome, 'stopped', s.red);
  const ask = getRunAsks(view(w)).asks[0];
  assert.equal(ask.statusText, 'stopped at the ask of step 4', 'sanity: alone, the ask reads step 4');
  // an earlier Stop that landed before any ask parked (nothing written for an ask): its row sits BEFORE this one in the audit, other step
  const rows = readAudit(w.runDir);
  const mine = rows.find((r) => r.verdict === 'stopped' && /at the ask/.test(r.gap));
  const earlier = { ...mine, step: 'jd-text', gap: 'stopped at the ask of step 2', at: '2026-01-01T00:00:00.000Z' };
  const lines = rows.flatMap((r) => (r === mine ? [earlier, r] : [r])).map((r) => JSON.stringify(r));
  writeFileSync(path.join(w.runDir, 'audit.jsonl'), `${lines.join('\n')}\n`);
  assert.equal(getRunAsks(view(w)).asks[0].statusText, 'stopped at the ask of step 4', 'getRunAsks');
  assert.equal(listStops({ root: w.root }).find((x) => x.runId === 'run-1').statusText, 'stopped at the ask of step 4', 'Inbox');
});

