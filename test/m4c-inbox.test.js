// M4c piece 2 (docs/wiki/the-module-ladder.md "M4c — the answers read clearly",
// scope items 1, 3, 4; negatives iv, v, viii): Inbox (N), order + sections, the
// pulse rule. $0: fake model step, no key. Real child processes through bin/fwdloop.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  writeFileSync, readFileSync, readdirSync, statSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import {
  listStops, listRuns, inboxOpenCount, glyphPulses, orderStops,
} from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const HANG = path.join(HERE, 'fixtures', 'm4c-hang-model-step.mjs');
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

const loaded = loadCatalogue();
assert.equal(loaded.ok, true);
const CATALOGUE = loaded.primitives;

const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4c2-${p}-`));
const env = (model) => ({ PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: model });

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

function cli(args, model) {
  const child = spawn(process.execPath, [BIN, ...args], { env: env(model), stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(child);
  let stdout = '';
  child.stdout.on('data', (b) => { stdout += b; });
  const done = new Promise((resolve) => { child.on('exit', (code) => resolve({ code, stdout })); });
  return { child, done };
}

/** A real run parked at its ask; returns the askId. */
async function park(root, runId) {
  const r = await cli(['run', 'job2', '--root', root, ...sources(), '--run-id', runId], FAKE).done;
  assert.equal(r.code, 0, r.stdout);
  return /askId=(\S+)/.exec(r.stdout)[1];
}

function answer(root, askId, decision, reason) {
  const a = spawnSync(process.execPath, [BIN, 'answer', askId, decision, ...(reason ? [reason] : []), '--root', root], { env: env(FAKE), encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
}

/** Move an ask's expiry (ask.json and its archive copy) — fixture setup only. */
function setExpiry(runDir, askId, iso) {
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`)]) {
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = iso;
    writeFileSync(f, JSON.stringify(j));
  }
}

const runDirOf = (root, id) => path.join(root, 'job2', 'runs', id);
const rowsOf = (root, id) => listStops({ root }).filter((r) => r.runId === id);
async function waitFor(fn, ms = 10_000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('waitFor timed out');
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

test('negative (iv): N is 1 for one open ask, still 1 once the answer is saved with nothing carrying it on (stuck, amendment 2), expired not counted, zero still reads 0', async () => {
  const root = tmp('count');
  makeFlow(root);
  assert.equal(inboxOpenCount(listStops({ root })), 0, 'no runs: zero, and the label is always present (page test below)');
  const askId = await park(root, 'r1');
  assert.equal(inboxOpenCount(listStops({ root })), 1);
  answer(root, askId, 'redo', 'why not');
  assert.ok(existsSync(path.join(runDirOf(root, 'r1'), 'answer.json')), 'saved, resume not started');
  assert.equal(inboxOpenCount(listStops({ root })), 1, 'saved answer, no live process: stuck, counted (M4c amendment 2 (b))');

  const root2 = tmp('count-exp');
  makeFlow(root2);
  const id2 = await park(root2, 'r1');
  assert.equal(inboxOpenCount(listStops({ root: root2 })), 1);
  setExpiry(runDirOf(root2, 'r1'), id2, new Date(Date.now() - 60_000).toISOString());
  assert.equal(inboxOpenCount(listStops({ root: root2 })), 0, 'an expired ask is not counted');
});

test('the page always shows Inbox (N) from the server count, including 0', () => {
  assert.match(PAGE, /id="inbox-count-label"> \(0\)<\/span>/, 'the tab says (0) before any data');
  assert.match(PAGE, /textContent = " \(" \+ \(typeof openCount === "number" \? openCount : 0\) \+ "\)"/);
  assert.doesNotMatch(PAGE, /openCount > 0 \?/, 'no hide-when-zero');
});

test('negative (v): with two runs waiting, the one with less time left is first, whichever was asked first', async () => {
  const root = tmp('order');
  makeFlow(root);
  const a = await park(root, 'asked-first'); // asked first, expires LATER
  await sleep(30);
  const b = await park(root, 'asked-second'); // asked second, expires SOONER
  setExpiry(runDirOf(root, 'asked-first'), a, new Date(Date.now() + 2 * 3600_000).toISOString());
  setExpiry(runDirOf(root, 'asked-second'), b, new Date(Date.now() + 10 * 60_000).toISOString());
  const rows = listStops({ root }).filter((r) => r.section === 1);
  assert.deepEqual(rows.map((r) => r.runId), ['asked-second', 'asked-first']);
  assert.equal(inboxOpenCount(listStops({ root })), 2);
});

test('orderStops: sections 1 waiting, 2 working/answer-saved, 3 answered+expired newest first; one function orders', () => {
  const rows = [
    { id: 'old-done', status: 'accepted', answeredAt: '2026-09-01T00:00:00Z' },
    { id: 'expired', status: 'expired', expiresAt: '2026-09-03T00:00:00Z' },
    { id: 'saved', open: true, resume: { state: 'not-started' }, answeredAt: null },
    { id: 'wait-long', waiting: true, timeLeftMs: 9000 },
    { id: 'new-done', status: 'redo', answeredAt: '2026-09-02T00:00:00Z' },
    { id: 'working', status: 'redo', working: 'redo', answeredAt: '2026-09-05T00:00:00Z' },
    { id: 'wait-short', waiting: true, timeLeftMs: 10 },
  ];
  assert.deepEqual(orderStops(rows).map((r) => r.id), ['wait-short', 'wait-long', 'working', 'saved', 'expired', 'new-done', 'old-done']);
  assert.deepEqual(orderStops(rows).map((r) => r.section), [1, 1, 2, 2, 3, 3, 3]);
});

test('a live resume after a redo is section 2 "working on your redo" with a pulsing [▶]; a finished one moves to section 3', async () => {
  const root = tmp('working');
  makeFlow(root);
  const askId = await park(root, 'r1');
  answer(root, askId, 'redo', 'shorter');
  const resume = cli(['resume', 'r1', '--flow', 'job2', '--root', root], HANG);
  await waitFor(() => existsSync(path.join(runDirOf(root, 'r1'), 'pids.jsonl'))
    && existsSync(path.join(runDirOf(root, 'r1'), `answer.${askId}.consumed.json`)));
  const [row] = rowsOf(root, 'r1');
  assert.equal(row.section, 2);
  assert.equal(row.working, 'redo');
  assert.equal(row.waiting, false);
  assert.equal(inboxOpenCount(listStops({ root })), 0);
  resume.child.kill('SIGKILL');
  await resume.done;
  // the process is gone: no longer "working" — it drops to section 3
  assert.equal(rowsOf(root, 'r1')[0].working, undefined);
  assert.equal(rowsOf(root, 'r1')[0].section, 3);

  const root2 = tmp('finished');
  makeFlow(root2);
  const id2 = await park(root2, 'r1');
  answer(root2, id2, 'accept');
  const fin = await cli(['resume', 'r1', '--flow', 'job2', '--root', root2], FAKE).done;
  assert.equal(fin.code, 0, fin.stdout);
  const done = rowsOf(root2, 'r1');
  assert.ok(done.length >= 1);
  assert.ok(done.every((r) => r.section === 3 && !r.working), 'a finished run is only ever section 3');
});

test('pulse: only [▶], [II] stuck and waiting [·]; placeholder dots, answered-not-resumed and resume-starting do not', async () => {
  assert.equal(glyphPulses({ glyph: '[▶]', label: 'running' }), true);
  assert.equal(glyphPulses({ glyph: '[·]', label: 'waiting on you (parked, unanswered)' }), true);
  assert.equal(glyphPulses({ glyph: '[·]', label: 'answered, not resumed yet' }), false);
  assert.equal(glyphPulses({ glyph: '[·]', label: 'your answer is saved; the run is picking it up' }), false);
  assert.equal(glyphPulses({ glyph: '[II]', label: 'stuck — answer saved, click try the resume again' }), true);
  for (const g of ['[✓]', '[✗]', '[!]', '[?]']) assert.equal(glyphPulses({ glyph: g, label: 'x' }), false);

  const root = tmp('pulse');
  makeFlow(root);
  const askId = await park(root, 'r1');
  let row = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'r1');
  assert.equal(row.glyph, '[·]');
  assert.equal(row.pulse, true, 'waiting on you pulses');
  answer(root, askId, 'redo', 'again');
  row = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'r1');
  assert.equal(row.glyph, '[II]');
  assert.equal(row.pulse, true, 'answer saved, nobody carrying it on: stuck pulses (amendment 2 (a))');

  // the page: pulse is a class the server decides, never a colour class
  assert.doesNotMatch(PAGE, /\.dot\.(grey|amber)::before\{animation/);
  assert.match(PAGE, /\.dot\.pulse::before\{animation:signPulse/);
  assert.match(PAGE, /<span class="dot grey" id="active-wf-dot">/, 'placeholder header dot carries no pulse');
  assert.match(PAGE, /<span class="dot grey"><\/span>'/, 'no-runs placeholder carries no pulse');
  assert.match(PAGE, /prefers-reduced-motion: reduce\)\{\s*\.dot\.pulse::before\{animation:none/);
});

test('negative (viii): runs from before M4c (no pids.jsonl) still list in the inbox and nothing is rewritten', async () => {
  const root = tmp('old');
  makeFlow(root);
  const a = await park(root, 'r1');
  const b = await park(root, 'r2');
  answer(root, b, 'accept');
  const fs = await import('node:fs');
  fs.rmSync(path.join(runDirOf(root, 'r1'), 'pids.jsonl'));
  fs.rmSync(path.join(runDirOf(root, 'r2'), 'pids.jsonl'));
  const before = hashTree(path.join(root, 'job2'));
  const rows = listStops({ root });
  inboxOpenCount(rows);
  assert.deepEqual(rows.filter((r) => r.runId === 'r1').map((r) => r.section), [1]);
  assert.ok(rows.some((r) => r.runId === 'r2'));
  assert.ok(a);
  assert.deepEqual(hashTree(path.join(root, 'job2')), before);
  assert.ok(!existsSync(path.join(runDirOf(root, 'r1'), 'pids.jsonl')));
});
