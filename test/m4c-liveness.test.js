// M4c piece 1 (docs/wiki/the-module-ladder.md "M4c — the answers read clearly",
// scope items 1-2, negatives i, ii, iii, viii): pid rows + the `[▶]` running
// sign. $0: no provider, no key. Real child processes through bin/fwdloop.
// Panel children bind ports 4840-4849 only.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { listRuns, getRunDetail } from '../src/panel/data.js';
import { isFwdloopAlive, runLiveness, procStartOf } from '../src/liveness.js';
import { appendAudit } from '../src/books.js';
import { resolvePrimitives } from '../src/primitives.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const HANG = path.join(HERE, 'fixtures', 'm4c-hang-model-step.mjs');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

const loaded = loadCatalogue();
assert.equal(loaded.ok, true);
const CATALOGUE = loaded.primitives;

const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4c-${p}-`));

function env(model) {
  return { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: model };
}

function makeFlow(root, name = 'job2') {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr',
    signedAt: '2026-09-30T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
}

function sources() {
  const d = tmp('src');
  writeFileSync(path.join(d, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(d, 'jd.md'), 'JD text goes here.');
  return ['--source', `resume=${path.join(d, 'resume.docx')}`, '--source', `jd=${path.join(d, 'jd.md')}`];
}

/** Async child through bin/fwdloop; resolves {pid, code, stdout}. */
function cli(args, model) {
  const child = spawn(process.execPath, [BIN, ...args], { env: env(model), stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(child);
  let stdout = '';
  child.stdout.on('data', (b) => { stdout += b; });
  const done = new Promise((resolve) => { child.on('exit', (code) => resolve({ pid: child.pid, code, stdout })); });
  return { child, done };
}

const glyphOf = (root, runId) => listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === runId)?.glyph;
const pidRows = (runDir) => readFileSync(path.join(runDir, 'pids.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

async function waitFor(fn, ms = 10_000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('waitFor timed out');
}

let portN = 4840;
/** A long-lived real fwdloop process (the panel), for a live pid that is fwdloop. */
async function liveFwdloop() {
  const c = spawn(process.execPath, [BIN, 'panel', '--root', tmp('panelroot'), '--port', String(portN++)], { stdio: 'ignore' });
  kids.push(c);
  await waitFor(() => { const s = procStartOf(c.pid); return s !== null && isFwdloopAlive(c.pid) === true; });
  await sleep(200);
  return c;
}

/** A pre-M4c-shaped run dir: books only (audit row), no pids.jsonl, no end row. */
function oldRun(root, runId) {
  const runDir = path.join(root, 'job2', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  appendAudit(runDir, {
    step: 'a', attempt: 1, class: 'shape', verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 1, model: null, modelMatch: null, strike: false, at: '2026-09-30T12:00:00Z', tokens: null, tools: null, refused: [],
  });
  return runDir;
}

function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(dir, f)] = createHash('sha256').update(readFileSync(f)).digest('hex') + statSync(f).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

function setOld(runDir) {
  const old = new Date(Date.now() - 30 * 60 * 1000);
  for (const f of readdirSync(runDir)) utimesSync(path.join(runDir, f), old, old);
}

test('the runner writes one pid row per leg: run (parks) then resume, each by its own process', async () => {
  const root = tmp('legs');
  makeFlow(root);
  const a = cli(['run', 'job2', '--root', root, ...sources(), '--run-id', 'r1'], FAKE);
  const ra = await a.done;
  assert.equal(ra.code, 0, ra.stdout);
  const runDir = path.join(root, 'job2', 'runs', 'r1');
  let rows = pidRows(runDir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].leg, 'run');
  assert.equal(rows[0].pid, ra.pid);
  assert.match(rows[0].procStart, /^\d+$/);
  assert.ok(!Number.isNaN(Date.parse(rows[0].startedAt)));

  const askId = /askId=(\S+)/.exec(ra.stdout)[1];
  const ans = spawnSync(process.execPath, [BIN, 'answer', askId, 'accept', '--root', root], { env: env(FAKE), encoding: 'utf8' });
  assert.equal(ans.status, 0, ans.stderr);
  const b = cli(['resume', 'r1', '--flow', 'job2', '--root', root], FAKE);
  const rb = await b.done;
  assert.equal(rb.code, 0, rb.stdout);
  rows = pidRows(runDir);
  assert.equal(rows.length, 2, 'exactly one more row for the resume leg');
  assert.equal(rows[1].leg, 'resume');
  assert.equal(rows[1].pid, rb.pid);
  assert.notEqual(rows[1].pid, rows[0].pid);
  assert.equal(glyphOf(root, 'r1'), '[✓]', 'an end row wins over any pid row');
});

test('negative (ii): a real run process mid-step reads [▶]; after SIGKILL it reads [?], never [▶]', async () => {
  const root = tmp('kill');
  makeFlow(root);
  const a = cli(['run', 'job2', '--root', root, ...sources(), '--run-id', 'r1'], HANG);
  const runDir = path.join(root, 'job2', 'runs', 'r1');
  await waitFor(() => existsSync(path.join(runDir, 'pids.jsonl')));
  assert.equal(pidRows(runDir)[0].pid, a.child.pid);
  assert.equal(runLiveness(runDir), 'running');
  assert.equal(glyphOf(root, 'r1'), '[▶]');
  assert.equal(getRunDetail({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE }).glyph, '[▶]');
  a.child.kill('SIGKILL');
  await a.done;
  // Books are still fresh here: only the pid check can make this [?].
  assert.equal(glyphOf(root, 'r1'), '[?]');
  assert.equal(runLiveness(runDir), 'gone');
});

test('negative (ii): a pre-M4c run (no pids.jsonl) is [▶] while its books are fresh, [?] once older than 10 minutes', () => {
  const root = tmp('old');
  makeFlow(root);
  const runDir = oldRun(root, 'r1');
  assert.equal(runLiveness(runDir), 'unknown');
  assert.equal(glyphOf(root, 'r1'), '[▶]');
  setOld(runDir);
  assert.equal(glyphOf(root, 'r1'), '[?]');
});

test('negative (i): a run parked at an open ask never reads [▶], even with a live fwdloop pid row', async () => {
  const root = tmp('parked');
  makeFlow(root);
  const a = cli(['run', 'job2', '--root', root, ...sources(), '--run-id', 'r1'], FAKE);
  assert.equal((await a.done).code, 0);
  const runDir = path.join(root, 'job2', 'runs', 'r1');
  const live = await liveFwdloop();
  writeFileSync(path.join(runDir, 'pids.jsonl'), `${JSON.stringify({ pid: live.pid, startedAt: new Date().toISOString(), procStart: procStartOf(live.pid), leg: 'run' })}\n`);
  assert.equal(runLiveness(runDir), 'running', 'control: the row does read as running');
  assert.equal(glyphOf(root, 'r1'), '[·]');
});

test('negative (iii): a live non-fwdloop pid, or a live fwdloop with a different procStart, does not read as running', async () => {
  const root = tmp('recycled');
  makeFlow(root);
  const runDir = oldRun(root, 'r1'); // fresh books: only the pid check may say no
  const setRow = (pid, procStart) => writeFileSync(path.join(runDir, 'pids.jsonl'), `${JSON.stringify({ pid, startedAt: new Date().toISOString(), procStart, leg: 'run' })}\n`);

  const plain = spawn(process.execPath, ['-e', 'setTimeout(()=>{},8000)'], { stdio: 'ignore' });
  kids.push(plain);
  const trapDir = tmp('fwdloop-trap');
  writeFileSync(path.join(trapDir, 'other.js'), 'setTimeout(()=>{},8000)');
  const trap = spawn(process.execPath, [path.join(trapDir, 'other.js'), '--root', '/home/x/fwdloop'], { stdio: 'ignore' });
  kids.push(trap);
  const live = await liveFwdloop();
  await sleep(300);

  for (const k of [plain, trap]) {
    setRow(k.pid, procStartOf(k.pid));
    assert.equal(runLiveness(runDir), 'gone', `pid ${k.pid} is live but not fwdloop`);
    assert.equal(glyphOf(root, 'r1'), '[?]');
  }
  setRow(live.pid, '1'); // live fwdloop, not the process that recorded it
  assert.equal(runLiveness(runDir), 'gone');
  assert.equal(glyphOf(root, 'r1'), '[?]');
  setRow(live.pid, procStartOf(live.pid)); // control: the matching row reads running
  assert.equal(runLiveness(runDir), 'running');
  assert.equal(glyphOf(root, 'r1'), '[▶]');
  setRow(live.pid, null); // procStart unreadable at record time: pid + cmdline decide
  assert.equal(runLiveness(runDir), 'running');
});

test('negative (viii): a pre-M4c run dir renders and a panel read rewrites none of its files', () => {
  const root = tmp('nowrite');
  makeFlow(root);
  const runDir = oldRun(root, 'r1');
  const before = hashTree(path.join(root, 'job2'));
  glyphOf(root, 'r1');
  assert.ok(getRunDetail({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE }));
  const after2 = hashTree(path.join(root, 'job2'));
  assert.deepEqual(after2, before);
  assert.ok(!existsSync(path.join(runDir, 'pids.jsonl')), 'a read never creates pids.jsonl');
});

test('a step can never write pids.jsonl: the step fs gate writes only <runDir>/out', async () => {
  const runDir = tmp('gate');
  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  await assert.rejects(() => tools.write.execute({ path: path.join(runDir, 'pids.jsonl'), content: '{}' }), /outside the sandbox/);
  assert.ok(!existsSync(path.join(runDir, 'pids.jsonl')));
});

test('a consumed answer with a live resume process reads [▶] "working on your answer"; with the process gone, [?]', async () => {
  const root = tmp('working');
  makeFlow(root);
  const a = cli(['run', 'job2', '--root', root, ...sources(), '--run-id', 'r1'], FAKE);
  const ra = await a.done;
  const askId = /askId=(\S+)/.exec(ra.stdout)[1];
  const runDir = path.join(root, 'job2', 'runs', 'r1');
  writeFileSync(path.join(runDir, `answer.${askId}.consumed.json`), JSON.stringify({ askId, decision: 'redo', reason: 'x' }));
  const live = await liveFwdloop();
  writeFileSync(path.join(runDir, 'pids.jsonl'), `${JSON.stringify({ pid: live.pid, startedAt: new Date().toISOString(), procStart: procStartOf(live.pid), leg: 'resume' })}\n`);
  const row = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'r1');
  assert.equal(row.glyph, '[▶]');
  assert.equal(row.label, 'working on your answer');
  live.kill('SIGKILL');
  await waitFor(() => runLiveness(runDir) === 'gone');
  assert.equal(glyphOf(root, 'r1'), '[?]');
});
