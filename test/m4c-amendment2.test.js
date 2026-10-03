// M4c amendment 2 (docs/wiki/the-module-ladder.md "M4c amendment 2 (revised)"): a stuck run and how
// to unstick it. $0: fake model step, no key. Real child processes through bin/fwdloop; a real
// fwdloop-named holder process that is really kill -9'd stands in for a resumer that died holding
// the lock (test/fixtures/lock-holder.mjs).

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import {
  listStops, listRuns, getRunAsks, inboxOpenCount, glyphPulses, computeGlyph, isStuck, STUCK_LABEL, CRASHED_LABEL,
} from '../src/panel/data.js';
import { readResumeLock } from '../src/liveness.js';
import { spawnHolder } from './fixtures/lock-holder.mjs';

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
const holders = [];
after(async () => {
  for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } }
  for (const h of holders) { try { await h.kill(); } catch { /* gone */ } }
});
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4c-a2-${p}-`));
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

function cli(args, model = FAKE) {
  const child = spawn(process.execPath, [BIN, ...args], { env: env(model), stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(child);
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { out += b; });
  const done = new Promise((resolve) => { child.on('exit', (code) => resolve({ code, out })); });
  return { child, done };
}

const runDirOf = (root, id) => path.join(root, 'job2', 'runs', id);
const lockOf = (root, id) => path.join(runDirOf(root, id), 'resume.lock');
const rowOf = (root, id) => listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === id);
const stopsOf = (root, id) => listStops({ root }).filter((r) => r.runId === id);
const asksCount = (root, id) => readdirSync(path.join(runDirOf(root, id), 'asks')).length;
const consumed = (root, id) => readdirSync(runDirOf(root, id)).filter((f) => /^answer\..*\.consumed\.json$/.test(f));

async function park(root, runId) {
  const r = await cli(['run', 'job2', '--root', root, ...sources(), '--run-id', runId]).done;
  assert.equal(r.code, 0, r.out);
  return /askId=(\S+)/.exec(r.out)[1];
}
function answer(root, askId, decision = 'redo', reason = 'again') {
  const a = spawnSync(process.execPath, [BIN, 'answer', askId, decision, ...(decision === 'accept' ? [] : [reason]), '--root', root], { env: env(FAKE), encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
}
/** A parked run with its answer saved and no process anywhere: stuck. */
async function stuckRun(root, runId) {
  const askId = await park(root, runId);
  answer(root, askId);
  assert.ok(existsSync(path.join(runDirOf(root, runId), 'answer.json')));
  return askId;
}
async function deadHolderLock(root, runId) {
  const h = await spawnHolder(tmp('holder'));
  holders.push(h);
  writeFileSync(lockOf(root, runId), h.lockText);
  await h.kill();
  return h;
}
function setExpiry(root, runId, askId, iso) {
  const runDir = runDirOf(root, runId);
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`)]) {
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = iso;
    writeFileSync(f, JSON.stringify(j));
  }
}
async function waitFor(fn, ms = 10_000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('waitFor timed out');
}

// ---------------------------------------------------------------------------
// (a) the one stuck rule
// ---------------------------------------------------------------------------

test('(a) answer saved, no lock, no process (resume not-started): [II] stuck, pulsing, in the books by the one rule', async () => {
  const root = tmp('a1');
  makeFlow(root);
  await stuckRun(root, 'r1');
  const row = rowOf(root, 'r1');
  assert.equal(row.glyph, '[II]');
  assert.equal(row.label, STUCK_LABEL);
  assert.equal(row.pulse, true);
  assert.equal(row.stuck, true);
});

test('(a) answer saved + a lock left by a DEAD holder (real kill -9): [II] stuck, pulsing', async () => {
  const root = tmp('a2');
  makeFlow(root);
  await stuckRun(root, 'r1');
  await deadHolderLock(root, 'r1');
  assert.equal(readResumeLock(runDirOf(root, 'r1')).state, 'dead');
  const row = rowOf(root, 'r1');
  assert.equal(row.glyph, '[II]');
  assert.equal(row.pulse, true);
});

test('(a) answer saved + a lock held by a LIVE holder: not stuck, [▶] working on your answer', async () => {
  const root = tmp('a3');
  makeFlow(root);
  await stuckRun(root, 'r1');
  const h = await spawnHolder(tmp('holder'));
  holders.push(h);
  writeFileSync(lockOf(root, 'r1'), h.lockText);
  assert.equal(readResumeLock(runDirOf(root, 'r1')).state, 'live');
  const row = rowOf(root, 'r1');
  assert.equal(row.glyph, '[▶]');
  assert.equal(row.label, 'working on your answer');
  assert.equal(row.stuck, false);
  assert.equal(stopsOf(root, 'r1').some((s) => s.stuck), false);
});

test('(a) the transient "starting" is not stuck (the glyph rule, every liveness)', () => {
  const resume = { state: 'starting', label: 'answer saved, resume starting' };
  for (const liveness of ['gone', 'unknown', 'running']) {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a', expiresAt: null }, consumedAnswerExists: false, hasStateJson: true, resume, liveness, lock: 'none',
    });
    assert.deepEqual(g, { glyph: '[·]', label: 'answer saved, resume starting' }, liveness);
    assert.equal(glyphPulses(g), false);
  }
  assert.equal(isStuck({ resume, liveness: 'gone', lock: 'none' }), false);
  assert.equal(isStuck({ resume: { state: 'not-started' }, liveness: 'gone', lock: 'none' }), true);
  assert.equal(isStuck({ resume: { state: 'not-started' }, liveness: 'running', lock: 'none' }), false);
  assert.equal(isStuck({ resume: { state: 'not-started' }, liveness: 'gone', lock: 'live' }), false);
  assert.equal(isStuck({ resume: null, liveness: 'gone', lock: 'none' }), false);
});

// ---------------------------------------------------------------------------
// (f) taken and died
// ---------------------------------------------------------------------------

test('(f) a real resumer took the answer and was kill -9: [?] crashed label, no pulse, not counted in Inbox (N)', async () => {
  const root = tmp('f1');
  makeFlow(root);
  const askId = await park(root, 'r1');
  answer(root, askId);
  const res = cli(['resume', 'r1', '--flow', 'job2', '--root', root], HANG);
  await waitFor(() => consumed(root, 'r1').length === 1);
  await sleep(300);
  res.child.kill('SIGKILL');
  await res.done;
  const row = rowOf(root, 'r1');
  assert.equal(row.glyph, '[?]');
  assert.equal(row.label, CRASHED_LABEL);
  assert.equal(row.label, 'crashed after taking your answer — start a fresh run');
  assert.equal(row.pulse, false);
  assert.equal(row.stuck, false);
  assert.equal(inboxOpenCount(listStops({ root })), 0, 'not counted');
  assert.equal(stopsOf(root, 'r1').some((s) => s.stuck), false);
});

// ---------------------------------------------------------------------------
// (b) Inbox (N) and ordering
// ---------------------------------------------------------------------------

test('(b) Inbox (N) counts a stuck run; Inbox section 1 puts it below the timed asks, even one asked later', async () => {
  const root = tmp('b1');
  makeFlow(root);
  await stuckRun(root, 'stuck-one');
  const late = await park(root, 'timed-late');
  const soon = await park(root, 'timed-soon');
  setExpiry(root, 'timed-late', late, new Date(Date.now() + 2 * 3600_000).toISOString());
  setExpiry(root, 'timed-soon', soon, new Date(Date.now() + 10 * 60_000).toISOString());
  const rows = listStops({ root });
  assert.equal(inboxOpenCount(rows), 3, 'two timed asks and one stuck run');
  const s1 = rows.filter((r) => r.section === 1);
  assert.deepEqual(s1.map((r) => r.runId), ['timed-soon', 'timed-late', 'stuck-one']);
  const stuck = s1[2];
  assert.equal(stuck.stuck, true);
  assert.equal(stuck.stuckLabel, STUCK_LABEL);
  assert.equal(stuck.waiting, false, 'the human already answered; it is stuck, not waiting');
});

test('(b) Runs: the stuck run sits with the waiting runs, after the timed ones and above a running/finished run', async () => {
  const root = tmp('b2');
  makeFlow(root);
  const doneAsk = await park(root, 'finished');
  answer(root, doneAsk, 'accept');
  assert.equal((await cli(['resume', 'finished', '--flow', 'job2', '--root', root]).done).code, 0);
  await stuckRun(root, 'stuck-one');
  const t = await park(root, 'timed');
  setExpiry(root, 'timed', t, new Date(Date.now() + 10 * 60_000).toISOString());
  const order = listRuns({ root, catalogue: CATALOGUE }).map((r) => `${r.runId}:${r.glyph}`);
  assert.deepEqual(order, ['timed:[·]', 'stuck-one:[II]', 'finished:[✓]']);
});

// ---------------------------------------------------------------------------
// (c) the card opens the Ask tab, where the button is
// ---------------------------------------------------------------------------

test('(c) a stuck Inbox card has the [II] sign and opens the Ask tab, whose stuck block carries "Try the resume again"', async () => {
  const root = tmp('c1');
  makeFlow(root);
  const askId = await stuckRun(root, 'r1');
  const s = stopsOf(root, 'r1');
  assert.equal(s.length, 1);
  assert.equal(s[0].askId, askId);
  assert.equal(s[0].stuck, true);
  // the page: the card's sign, its status line, the click -> Ask tab, and the button for a not-started resume
  assert.match(PAGE, /row\.stuck \? "stuck pulse"/);
  assert.match(PAGE, /if\(row\.stuck\) return row\.stuckLabel;/);
  assert.match(PAGE, /selectRun\(row\.flow, row\.runId, wrap, "\.inbox-row", row\.askId\);\s*document\.getElementById\("tab-ask"\)\.click\(\);/);
  assert.match(PAGE, /resume\.state === "not-started"\)\{\s*return \{ kind: "stuck"/);
  assert.match(PAGE, /makeButton\(isLate \? "Resume — record the expiry" : "Try the resume again", "btn-resume-again"/);
  assert.match(PAGE, /\.dot\.stuck::before\{content:"\[II\]"/);
  assert.match(PAGE, /if\(g === "\[II\]"\) return "stuck";/);
  // reduced motion keeps the sign, drops only the pulse (the one existing rule covers [II])
  assert.match(PAGE, /prefers-reduced-motion: reduce\)\{\s*\.dot\.pulse::before\{animation:none/);
});

test('(c) the Ask tab says the same as the run list: a stuck run\'s resume label is the stuck label; a live holder\'s is not', async () => {
  const root = tmp('c2');
  makeFlow(root);
  await stuckRun(root, 'r1');
  const asks = () => getRunAsks({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE });
  assert.equal(asks().resume.label, STUCK_LABEL);
  assert.equal(asks().resume.state, 'not-started', 'the state itself is unchanged: the page keys the button on it');
  assert.equal(asks().asks[0].resume.label, STUCK_LABEL, 'the ask header line too');
  const h = await spawnHolder(tmp('holder'));
  holders.push(h);
  writeFileSync(lockOf(root, 'r1'), h.lockText);
  assert.equal(asks().resume.label, 'answer saved, resume not started', 'a live holder: not stuck, label untouched');
});

test('(c) the Ask header for a stuck run: server marks exactly the saved-answer ask stuck; the page draws [II] pulsing there and says the stuck text once in the header', async () => {
  const root = tmp('c3');
  makeFlow(root);
  const askId = await stuckRun(root, 'r1');
  const asks = () => getRunAsks({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE });
  const a = asks().blocks[0].current;
  assert.equal(a.askId, askId);
  assert.equal(a.stuck, true, 'the one stuck rule (isStuck), decided on the server');
  const h = await spawnHolder(tmp('holder3'));
  holders.push(h);
  writeFileSync(lockOf(root, 'r1'), h.lockText);
  assert.equal(asks().blocks[0].current.stuck, false, 'a live holder: not stuck, no [II]');
  // page: the header sign is the same dot class as the Inbox card; the status line under the header is not drawn for a saved answer
  const head = PAGE.slice(PAGE.indexOf('function renderAskRow'), PAGE.indexOf('function renderAsk(result'));
  assert.match(head, /if\(ask\.stuck\)\{[^}]*badge\.className = "dot stuck pulse";/);
  const at = PAGE.indexOf('function askStatusBlock');
  const status = PAGE.slice(at, PAGE.indexOf('// ---- M4b piece 4', at));
  assert.match(status, /if\(ask\.open && ask\.resume\) return null;/);
  assert.doesNotMatch(status, /resume\.label/, 'the resume label is said by the header meta line only');
  assert.match(head, /if\(statusBlock\) body\.appendChild\(statusBlock\)/);
});

// ---------------------------------------------------------------------------
// (d) the lock records its holder; try-again clears only a dead holder's lock
// ---------------------------------------------------------------------------

test('(d) a resume records {pid, procStart} of its process in resume.lock right after taking it', async () => {
  const root = tmp('d0');
  makeFlow(root);
  const askId = await park(root, 'r1');
  answer(root, askId);
  const res = cli(['resume', 'r1', '--flow', 'job2', '--root', root], HANG);
  await waitFor(() => consumed(root, 'r1').length === 1);
  const lock = JSON.parse(readFileSync(lockOf(root, 'r1'), 'utf8'));
  assert.equal(lock.pid, res.child.pid);
  assert.match(lock.procStart, /^\d+$/);
  assert.equal(readResumeLock(runDirOf(root, 'r1')).state, 'live');
  res.child.kill('SIGKILL');
  await res.done;
  assert.equal(readResumeLock(runDirOf(root, 'r1')).state, 'dead');
});

test('(d) try-again with a dead holder clears the lock and the resume proceeds to its next state (real kill -9 holder)', async () => {
  const root = tmp('d1');
  makeFlow(root);
  await stuckRun(root, 'r1');
  await deadHolderLock(root, 'r1');
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.equal(r.code, 0, r.out);
  assert.equal(consumed(root, 'r1').length, 1, 'the saved answer was consumed once');
  assert.equal(asksCount(root, 'r1'), 2, 'the redo re-parked at a new ask');
  assert.equal(existsSync(lockOf(root, 'r1')), false, 'the lock is released at the end');
  assert.equal(rowOf(root, 'r1').glyph, '[·]', 'the next state: waiting on you again');
});

test('(d) try-again with a LIVE holder refuses by name and leaves the lock and the answer alone', async () => {
  const root = tmp('d2');
  makeFlow(root);
  await stuckRun(root, 'r1');
  const h = await spawnHolder(tmp('holder'));
  holders.push(h);
  writeFileSync(lockOf(root, 'r1'), h.lockText);
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.notEqual(r.code, 0);
  assert.match(r.out, new RegExp(`locked by another resumer \\(pid ${h.pid}, `));
  assert.equal(readFileSync(lockOf(root, 'r1'), 'utf8'), h.lockText, 'lock untouched');
  assert.ok(existsSync(path.join(runDirOf(root, 'r1'), 'answer.json')), 'answer untouched');
  assert.equal(consumed(root, 'r1').length, 0);
});

test('(d) an EMPTY lock (pre-amendment) is refused by name with its path, never cleared', async () => {
  const root = tmp('d3');
  makeFlow(root);
  await stuckRun(root, 'r1');
  writeFileSync(lockOf(root, 'r1'), '');
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.notEqual(r.code, 0);
  assert.match(r.out, /resume lock with no recorded holder/);
  assert.ok(r.out.includes(lockOf(root, 'r1')), 'names the lock path');
  assert.ok(existsSync(lockOf(root, 'r1')));
  assert.equal(readFileSync(lockOf(root, 'r1'), 'utf8'), '');
  assert.equal(consumed(root, 'r1').length, 0);
  // a garbage lock and a symlinked lock read the same: no recorded holder
  writeFileSync(lockOf(root, 'r1'), 'not json');
  assert.equal(readResumeLock(runDirOf(root, 'r1')).state, 'empty');
});

test('(d) a symlinked lock is never followed: read as empty, refused', async () => {
  const root = tmp('d4');
  makeFlow(root);
  await stuckRun(root, 'r1');
  const h = await spawnHolder(tmp('holder'));
  holders.push(h);
  const target = path.join(tmp('lnk'), 'lock.json');
  writeFileSync(target, h.lockText);
  symlinkSync(target, lockOf(root, 'r1'));
  assert.equal(readResumeLock(runDirOf(root, 'r1')).state, 'empty');
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no recorded holder/);
});

test('(d) two concurrent try-agains on a dead holder\'s lock: exactly one resumes, never two at once', async () => {
  for (let i = 0; i < 4; i += 1) {
    const root = tmp(`d5-${i}`);
    makeFlow(root);
    await stuckRun(root, 'r1');
    await deadHolderLock(root, 'r1');
    const [a, b] = await Promise.all([
      cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done,
      cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done,
    ]);
    assert.deepEqual([a.code === 0, b.code === 0].sort(), [false, true], `round ${i}: ${a.out} | ${b.out}`);
    assert.equal(consumed(root, 'r1').length, 1, 'the answer was taken once');
    assert.equal(asksCount(root, 'r1'), 2, 'one re-park, not two');
  }
});

// (e) is covered by "live holder: [▶] working on your answer" above and by panel-resume (viii).
