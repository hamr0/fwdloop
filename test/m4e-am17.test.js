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

// ---- 2A ----
test('2A a stop time that is no date ({}, number, empty, non-date, torn file) is "now"; all end the same way', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am17-2a-'));
  const NOWISO = '2026-10-08T12:00:00.000Z';
  for (const body of ['{}', '{"at":5}', '{"at":""}', '{"at":null}', '{"at":"last tuesday"}', '{not json']) {
    writeFileSync(path.join(dir, STOP_FILE), `${body}\n`);
    assert.equal(R.readStopRequest(dir, () => NOWISO)?.at, NOWISO, body);
  }
  writeFileSync(path.join(dir, STOP_FILE), '{"at":"2026-10-08T09:00:00.000Z"}\n');
  assert.equal(R.readStopRequest(dir, () => NOWISO).at, '2026-10-08T09:00:00.000Z', 'a real date is kept');
});
test('2A a Stop with no time, a number, or a non-date, landing as an answer is given, all end the same way', async () => {
  const ends = [];
  for (const [i, body] of ['{}', '{"at":5}', '{"at":"last tuesday"}'].entries()) {
    const w = await parked(`b${i}`);
    assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
    writeFileSync(path.join(w.runDir, STOP_FILE), `${body}\n`);
    const r = await resumeRun(args(w));
    const rows = readAudit(w.runDir).filter((x) => /^stop/.test(x.verdict));
    ends.push({ outcome: r.outcome, verdicts: rows.map((x) => x.verdict), recorded: rows.every((x) => !/unrecorded/.test(x.gap)) });
  }
  assert.deepEqual(ends[0], ends[2], '{} ends like "last tuesday"');
  assert.deepEqual(ends[1], ends[2], '{"at":5} ends like "last tuesday"');
  assert.equal(ends[2].recorded, true);
});

// ---- 3A ----
const NOW = Date.parse('2026-10-08T12:00:00Z');
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
function monthWorld() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-am17-3a-'));
  const home = path.join(base, 'cfg');
  mkdirSync(home, { mode: 0o700 });
  const dirs = ['gone', 'fine'].map((n) => {
    const d = path.join(base, 'runs', n);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'spend.jsonl'), `${JSON.stringify({ kind: 'step', provider: 'deepseek', costUsd: 0.01, spendComplete: true, at: iso(1) })}\n`);
    return d;
  });
  const L = [
    { kind: 'hold', holdId: 'g', what: 'run', flow: 'j', runId: 'gone', runDir: dirs[0], pid: 1, procStart: null, holdUsd: 0.25, spentAtHold: 0, at: iso(1) },
    { kind: 'settled', holdId: 'g', at: iso(1), why: 'process gone' },
    { kind: 'hold', holdId: 'f', what: 'run', flow: 'j', runId: 'fine', runDir: dirs[1], pid: 1, procStart: null, holdUsd: 0.25, spentAtHold: 0, at: iso(1) },
    { kind: 'settled', holdId: 'f', at: iso(1), why: 'ended or parked' },
  ];
  writeFileSync(path.join(home, 'runs.jsonl'), `${L.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return { base, home, dirs };
}
test('3A a "process gone" run is never rolled: its later spend still counts in the month and the total', () => {
  const w = monthWorld();
  try {
    monthly.rollSettled({ home: w.home, now: () => NOW });
    const rolled = monthly.readRuns(w.home).filter((r) => r.kind === 'rolled').flatMap((r) => Object.keys(r.dirs));
    assert.deepEqual(rolled, [w.dirs[1]], 'only the run that finished on its own is rolled');
    appendFileSync(path.join(w.dirs[0], 'spend.jsonl'), `${JSON.stringify({ kind: 'step', provider: 'deepseek', costUsd: 0.5, spendComplete: true, at: iso(0) })}\n`);
    const s = monthly.spendSummary({ home: w.home, now: () => NOW });
    assert.ok(Math.abs(s.month.usd - 0.52) < 1e-9, `month ${s.month.usd}`);
    assert.ok(Math.abs(s.total.usd - 0.52) < 1e-9, `total ${JSON.stringify(s.total)}`);
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});
test('3A a rolled run whose folder is later deleted keeps its spend', () => {
  const w = monthWorld();
  try {
    monthly.rollSettled({ home: w.home, now: () => NOW });
    rmSync(w.dirs[1], { recursive: true, force: true });
    const s = monthly.spendSummary({ home: w.home, now: () => NOW });
    assert.ok(Math.abs(s.month.usd - 0.02) < 1e-9, `month ${s.month.usd} (gone dir 0.01 live + fine dir 0.01 rolled)`);
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});

