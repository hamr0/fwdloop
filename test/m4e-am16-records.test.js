// M4e amendment 16, group 2 "Records always balance" (SIGNED 2026-10-08): C7, C6, C8, C11, I2, C2. $0: fake model steps, injected faults,
// scratch dirs (all removed at exit). C2 drives the real bin/fwdloop with a test model step and a scratch config home.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import * as R from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { readRuns, spendSummary } from '../src/monthly.js';

const {
  runFlow, resumeRun, makeParkingAskStep, requestStop, STOP_FILE, HALT_FILE, readHaltRecord,
} = R;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function mk(tag, cap = '0.25') {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am16r-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`).replace('cap $0.25', `cap $${cap}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  w.sigHash = readJson(path.join(w.flowDir, 'signature.json')).flow;
  return w;
}
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
function fake({ onCall, retry } = {}) {
  const calls = [];
  const fn = async (ctx) => {
    const emits = emitsOf(ctx);
    calls.push(emits);
    if (onCall) await onCall(emits, calls.length);
    if (retry && emits === 'resume-summary') return retry(calls.filter((c) => c === 'resume-summary').length);
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  return { fn, calls };
}
const args = (w, modelStep, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});
const auditSum = (runDir) => readAudit(runDir).reduce((a, r) => a + (typeof r.usd === 'number' ? r.usd : 0), 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const lastHist = (w) => readHistory(w.flowDir).at(-1);

/** A clock that returns a unique ISO time per call and remembers what log.json said at that tick. */
function snapClock(runDir) {
  let t = Date.parse('2026-10-08T10:00:00Z');
  const seen = new Map();
  const clock = () => {
    t += 1000;
    const iso = new Date(t).toISOString();
    let outcome = null;
    try { outcome = readJson(path.join(runDir, 'log.json')).outcome; } catch { /* none yet */ }
    seen.set(iso, outcome);
    return iso;
  };
  return { clock, logAt: (iso) => seen.get(iso) };
}

async function parked(tag) {
  const w = mk(tag);
  const f = fake();
  const r = await runFlow({ ...args(w, f.fn), sources: w.sources });
  assert.equal(r.outcome, 'paused', r.red);
  w.model = f;
  w.ask = readJson(path.join(w.runDir, 'ask.json'));
  return w;
}

// ---- C7: a cap-halt always leaves its history row, real hash, real spend ----
async function capHaltWith(tag, inject) {
  const w = mk(tag, '0.0105');
  const { fn } = fake({ onCall: (emits) => { if (emits === 'resume-text') inject(w); } });
  let threw = null;
  try { await runFlow({ ...args(w, fn), sources: w.sources }); } catch (e) { threw = e; }
  return { w, threw };
}
test('C7 a cap-halt whose log.json write fails still writes its history row with the real hash and spend', async () => {
  const { w } = await capHaltWith('c7a', (x) => mkdirSync(path.join(x.runDir, 'log.json'), { recursive: true }));
  const h = lastHist(w);
  assert.equal(h?.outcome, 'cap-halt', `history ${JSON.stringify(readHistory(w.flowDir))}`);
  assert.equal(h.signatureHash, w.sigHash);
  assert.ok(near(h.spentUsd, 0.001), `spent ${h.spentUsd}`);
  assert.ok(near(h.spentUsd, auditSum(w.runDir) - 0), 'books balance');
});
test('C7 a cap-halt whose halt.json write fails (already there) still writes its history row', async () => {
  const { w } = await capHaltWith('c7b', (x) => writeFileSync(path.join(x.runDir, HALT_FILE), '{}'));
  const h = lastHist(w);
  assert.equal(h?.outcome, 'cap-halt');
  assert.equal(h.signatureHash, w.sigHash);
  assert.ok(near(h.spentUsd, 0.001));
});
// ---- C6: on complete and rerun the history end row is written last ----
test('C6 a completed run writes its history row after log.json and the stop rows', async () => {
  const w = await parked('c6a');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
  const sc = snapClock(w.runDir);
  const r = await resumeRun(args(w, w.model.fn, { clock: sc.clock }));
  assert.equal(r.outcome, 'complete', r.red);
  const h = lastHist(w);
  assert.equal(h.outcome, 'complete');
  assert.equal(sc.logAt(h.at), 'complete', `log.json said ${sc.logAt(h.at)} when the history row was stamped`);
});
test('C6 a completed run whose log.json write fails still has its history row with the spend', async () => {
  const w = await parked('c6b');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'accept' }).ok, true);
  rmSync(path.join(w.runDir, 'log.json'));
  mkdirSync(path.join(w.runDir, 'log.json'));
  try { await resumeRun(args(w, w.model.fn)); } catch { /* the injected write error may surface */ }
  const h = lastHist(w);
  assert.equal(h?.outcome, 'complete');
  assert.ok(near(h.spentUsd, 0.003), `spent ${h.spentUsd}`);
  assert.equal(h.signatureHash, w.sigHash);
});
test('C6 a rerun writes its history row after log.json', async () => {
  const w = await parked('c6c');
  assert.equal(answerAsk({ runDir: w.runDir, askId: w.ask.askId, decision: 'rerun', reason: 'start over' }).ok, true);
  const sc = snapClock(w.runDir);
  const r = await resumeRun(args(w, w.model.fn, { clock: sc.clock }));
  assert.equal(r.outcome, 'rerun', r.red);
  const h = readHistory(w.flowDir).filter((x) => x.runId === 'run-1' && x.outcome === 'rerun').at(-1);
  assert.equal(sc.logAt(h.at), 'rerun', `log.json said ${sc.logAt(h.at)}`);
});

// ---- C8: only ENOENT counts as "another Stop took it" ----
test('C8 a Stop whose ask cannot be set aside says the stop failed, names the error, and leaves the run as it was', async () => {
  const w = await parked('c8a');
  const blocker = path.join(w.runDir, `ask.${w.ask.askId}.stopped.json`);
  mkdirSync(blocker);
  writeFileSync(path.join(blocker, 'x'), 'x');
  const r = await R.stopParkedRun({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.notEqual(r.outcome, 'stopped', JSON.stringify(r));
  assert.match(r.red, /the stop failed/i);
  assert.match(r.red, /E[A-Z]+/, 'names the error code');
  assert.equal(existsSync(path.join(w.runDir, 'ask.json')), true, 'the ask is still waiting');
  assert.equal(existsSync(path.join(w.runDir, 'state.json')), true);
  assert.equal(existsSync(path.join(w.runDir, HALT_FILE)), false);
  assert.equal(readAudit(w.runDir).filter((x) => /^stop/.test(x.verdict)).length, 0, 'no stop rows');
  assert.equal(readHistory(w.flowDir).filter((x) => x.outcome === 'stopped').length, 0);
});
test('C8 a real double Stop still stops once', async () => {
  const w = await parked('c8b');
  const go = () => R.stopParkedRun({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT,
  });
  const [a, b] = await Promise.all([go(), go()]);
  assert.equal([a, b].filter((x) => x.outcome === 'stopped').length, 1, JSON.stringify([a, b]));
  assert.equal(readAudit(w.runDir).filter((x) => x.verdict === 'stopped').length, 1);
  assert.equal(readHistory(w.flowDir).filter((x) => x.outcome === 'stopped').length, 1);
});
test('C8 a Stop that loses the rename (ENOENT: taken by another Stop) is still just "stopped", no throw, no second set of rows', async () => {
  const w = mk('c8c');
  const { fn } = fake();
  let fired = false;
  const clock = () => {
    if (!fired && existsSync(path.join(w.runDir, 'ask.json')) && existsSync(path.join(w.runDir, 'state.json'))) {
      fired = true; requestStop(w.runDir); rmSync(path.join(w.runDir, 'ask.json'));
    }
    return new Date().toISOString();
  };
  const r = await runFlow({ ...args(w, fn, { clock }), sources: w.sources });
  assert.equal(fired, true);
  assert.equal(r.outcome, 'stopped', r.red);
});

// ---- C11: a stop time that is not a date is "now" ----
test('C11 {"at":"last tuesday"} stops cleanly with full records', async () => {
  const w = await parked('c11');
  writeFileSync(path.join(w.runDir, STOP_FILE), '{"at":"last tuesday"}\n');
  const r = await R.stopParkedRun({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT,
  });
  assert.equal(r.outcome, 'stopped', r.red);
  const rows = readAudit(w.runDir).filter((x) => /^stop/.test(x.verdict));
  assert.deepEqual(rows.map((x) => x.verdict), ['stop-asked', 'stopped']);
  assert.match(rows[0].gap, /^stop asked \(you\) at \d{4}-\d\d-\d\dT/, rows[0].gap);
  assert.ok(!Number.isNaN(Date.parse(rows[0].at)), `row time ${rows[0].at}`);
  assert.equal(readHaltRecord(w.runDir).ok, true);
  assert.equal(lastHist(w).outcome, 'stopped');
  assert.equal(existsSync(path.join(w.runDir, STOP_FILE)), false);
  assert.equal(existsSync(path.join(w.runDir, 'ask.json')), false);
});
test('C11 the reader gives "now" for a time that is not a date', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am16r-c11u-'));
  writeFileSync(path.join(dir, STOP_FILE), '{"at":"last tuesday"}\n');
  assert.equal(R.readStopRequest(dir, () => '2026-10-08T12:00:00.000Z').at, '2026-10-08T12:00:00.000Z');
});

// ---- I2: fault, then Stop during the retry ----
test('I2 a transport fault, then a Stop during the retry: the audit rows add up to the run\'s history total', async () => {
  for (const [label, retryCost] of [['smaller', 0.0005], ['larger', 0.004], ['unknown', null]]) {
    const w = mk(`i2-${label}`);
    const { fn } = fake({
      retry: (n) => {
        if (n === 1) return { ok: false, transport: true, costUsd: 0.002, red: 'socket hang up' };
        requestStop(w.runDir);
        return { ok: false, stopped: true, costUsd: retryCost, turns: 0 };
      },
    });
    const r = await runFlow({ ...args(w, fn), sources: w.sources });
    assert.equal(r.outcome, 'stopped', `${label}: ${r.red}`);
    const h = lastHist(w);
    assert.ok(near(h.spentUsd, auditSum(w.runDir)), `${label}: history ${h.spentUsd} vs audit ${auditSum(w.runDir)}`);
  }
});

// ---- C2: a rerun names its new run dir in the money records when it starts ----
function cliWorld(tag) {
  const w = mk(tag);
  w.home = mkdtempSync(path.join(tmpdir(), `fwdloop-am16r-home-${tag}-`));
  w.mark = path.join(w.base, 'mark.jsonl');
  return w;
}
const cli = (w, argv, extraEnv = {}, model = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs')) => spawnSync(process.execPath, [BIN, ...argv], {
  env: {
    PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: w.home, FWDLOOP_TEST_MODEL_STEP: model, AM16_ROOT: w.root, AM16_MARK: w.mark, ...extraEnv,
  },
  encoding: 'utf8',
  timeout: 30_000,
});
function parkAndAnswerRerun(w) {
  const a = cli(w, ['run', 'job2', '--root', w.root, '--source', `resume=${w.sources[0].path}`, '--source', `jd=${w.sources[1].path}`, '--run-id', 'run-1']);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  const askId = /askId=(\S+)/.exec(a.stdout)[1];
  const b = cli(w, ['answer', askId, 'rerun', 'start over', '--root', w.root]);
  assert.equal(b.status, 0, b.stderr || b.stdout);
}
const REMODEL = path.join(HERE, 'fixtures', 'am16-rerun-model-step.mjs');
test('C2 a run-again killed hard still has its spend counted in the month and the total', () => {
  const w = cliWorld('c2a');
  parkAndAnswerRerun(w);
  const r = cli(w, ['resume', 'run-1', '--flow', 'job2', '--root', w.root], { AM16_KILL: '1' }, REMODEL);
  assert.equal(r.status, null, 'the child died hard');
  assert.match(readFileSync(w.mark, 'utf8'), /"named":true/, 'the new run dir was in the money record before the first call');
  const s = spendSummary({ home: w.home });
  assert.ok(near(s.total.usd, 0.001), `total ${s.total.usd}`);
  assert.ok(near(s.month.usd, 0.001), `month ${s.month.usd}`);
});
test('C2 a normal run-again is counted once', () => {
  const w = cliWorld('c2b');
  parkAndAnswerRerun(w);
  const r = cli(w, ['resume', 'run-1', '--flow', 'job2', '--root', w.root], { AM16_KILL: '0' }, REMODEL);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const s = spendSummary({ home: w.home });
  assert.ok(near(s.total.usd, 0.003), `total ${s.total.usd}`);
  assert.equal(s.total.rows, 3);
  assert.ok(readRuns(w.home).length > 0);
});
