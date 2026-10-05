// M4c amendment 3 (docs/wiki/the-module-ladder.md "M4c amendment 3"): on time is on time — a resume
// checks when the answer was SAVED against the deadline, not the clock at restart. $0: fake model step, no key. Real child processes through bin/fwdloop; a real
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
  listStops, listRuns, getRunAsks, inboxOpenCount, STUCK_LABEL, STUCK_LOCK_LABEL,
} from '../src/panel/data.js';
import { sandboxSend } from './send-sandbox.js';

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
after(() => {
  for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } }
});
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4c-a3-${p}-`));
const env = (model) => ({ PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: model });

function makeFlow(root, name = 'job2') {
  const result = writeFlow({
    root,
    name,
    proseText: sandboxSend(fixture('job2-with-sources.signed.txt')),
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


const DEADLINE = '2020-01-02T00:00:00.000Z';
/** Move the ask's deadline into the past everywhere it is recorded, and stamp the saved answer's own time. */
function pastDeadline(root, runId, askId, answeredAt) {
  const runDir = runDirOf(root, runId);
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`), path.join(runDir, 'state.json')]) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = DEADLINE;
    writeFileSync(f, JSON.stringify(j));
  }
  const ap = path.join(runDir, 'answer.json');
  if (existsSync(ap)) {
    const a = JSON.parse(readFileSync(ap, 'utf8'));
    if (answeredAt === undefined) delete a.answeredAt; else a.answeredAt = answeredAt;
    writeFileSync(ap, JSON.stringify(a));
  }
}
const ON_TIME = '2020-01-01T00:00:00.000Z';
const LATE = '2020-01-03T00:00:00.000Z';
const historyOf = (root) => {
  const f = path.join(root, 'job2', 'history.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('(a) an answer saved in time is carried on by a resume that restarts after the deadline', async () => {
  const root = tmp('a1');
  makeFlow(root);
  const askId = await stuckRun(root, 'r1');
  pastDeadline(root, 'r1', askId, ON_TIME);
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.equal(r.code, 0, r.out);
  assert.equal(consumed(root, 'r1').length, 1, 'the saved answer was taken');
  assert.equal(asksCount(root, 'r1'), 2, 'the redo re-parked at a new ask, not cancelled');
  assert.equal(historyOf(root).some((h) => h.outcome === 'ask-expired'), false);
});

test('(b) an answer whose saved time is after the deadline cancels the run (M3 negative (i), unchanged)', async () => {
  const root = tmp('b1');
  makeFlow(root);
  const askId = await stuckRun(root, 'r1');
  pastDeadline(root, 'r1', askId, LATE);
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.ok(historyOf(root).some((h) => h.outcome === 'ask-expired'), r.out);
  assert.equal(asksCount(root, 'r1'), 1, 'nothing further ran');
});

test('(b) an answer with a missing or unparseable saved time is refused by name and left on disk', async () => {
  for (const [tag, stamp] of [['missing', undefined], ['garbage', 'not a date']]) {
    const root = tmp(`b2-${tag}`);
    makeFlow(root);
    const askId = await stuckRun(root, 'r1');
    pastDeadline(root, 'r1', askId, stamp);
    const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
    assert.notEqual(r.code, 0, tag);
    assert.match(r.out, /missing or unreadable answeredAt/, tag);
    assert.ok(existsSync(path.join(runDirOf(root, 'r1'), 'answer.json')), `${tag}: answer untouched`);
    assert.equal(consumed(root, 'r1').length, 0, tag);
    assert.equal(historyOf(root).length, 0, `${tag}: not cancelled, not completed`);
  }
});

test('(c) stuck after the deadline with an on-time answer: [II] in Inbox, Runs, and the Ask tab has the resume door — they agree', async () => {
  const root = tmp('c1');
  makeFlow(root);
  const askId = await stuckRun(root, 'r1');
  pastDeadline(root, 'r1', askId, ON_TIME);
  const row = rowOf(root, 'r1');
  assert.equal(row.glyph, '[II]');
  assert.equal(row.label, STUCK_LABEL);
  assert.equal(row.pulse, true);
  const stops = stopsOf(root, 'r1');
  assert.equal(stops.length, 1);
  assert.equal(stops[0].stuck, true);
  assert.equal(stops[0].stuckLabel, STUCK_LABEL);
  assert.equal(inboxOpenCount(listStops({ root })), 1);
  const tab = getRunAsks({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE });
  const ask = tab.asks.find((a) => a.askId === askId);
  assert.equal(ask.open, true, 'the Ask tab does not call it expired');
  assert.equal(ask.stuck, true);
  assert.equal(tab.resume.state, 'not-started');
  assert.equal(tab.resume.label, STUCK_LABEL, 'the same words as the Inbox');
});

test('(d) an ask that ran out with no answer is [!] expired: not stuck, not counted, no door', async () => {
  const root = tmp('d1');
  makeFlow(root);
  const askId = await park(root, 'r1');
  pastDeadline(root, 'r1', askId, undefined);
  const row = rowOf(root, 'r1');
  assert.equal(row.glyph, '[!]');
  assert.equal(inboxOpenCount(listStops({ root })), 0);
  const ask = getRunAsks({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE }).asks[0];
  assert.equal(ask.open, false);
  assert.equal(ask.stuck, false);
  assert.equal(ask.status, 'expired');
});

test('(d) a saved answer that was NOT in time, past the deadline, is [!] expired in every surface, never [II]', async () => {
  const root = tmp('d2');
  makeFlow(root);
  const askId = await stuckRun(root, 'r1');
  pastDeadline(root, 'r1', askId, LATE);
  assert.equal(rowOf(root, 'r1').glyph, '[!]');
  assert.equal(stopsOf(root, 'r1').some((s) => s.stuck || s.open), false);
  assert.equal(inboxOpenCount(listStops({ root })), 0);
  const tab = getRunAsks({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE });
  assert.equal(tab.asks[0].open, false);
  assert.equal(tab.asks[0].stuck, false);
});

test('(e) after a try-again refused for a lock with no recorded holder, the stuck label says to remove the lock by hand and the box shows its path', async () => {
  const root = tmp('e1');
  makeFlow(root);
  await stuckRun(root, 'r1');
  writeFileSync(lockOf(root, 'r1'), '');
  const r = await cli(['resume', 'r1', '--flow', 'job2', '--root', root]).done;
  assert.notEqual(r.code, 0);
  const refusal = /resume: run .*/.exec(r.out)[0];
  const resumeAttempt = (flow, runId) => (runId === 'r1'
    ? { flow, runId, askId: stopsOf(root, 'r1')[0].askId, state: 'stuck', tries: 1, maxTries: 1, refusal }
    : null);
  // M4c-fix 15: the typed reason comes from the lock file itself, so it reads the same before any refusal is
  // known (e.g. after a panel restart): no wasted click.
  assert.equal(rowOf(root, 'r1').label, STUCK_LOCK_LABEL);
  const row = listRuns({ root, catalogue: CATALOGUE, resumeAttempt }).find((x) => x.runId === 'r1');
  assert.equal(row.glyph, '[II]');
  assert.equal(row.label, STUCK_LOCK_LABEL);
  assert.equal(row.label, 'stuck — an old resume lock is in the way');
  const stop = listStops({ root, resumeAttempt }).find((x) => x.runId === 'r1');
  assert.equal(stop.stuckLabel, STUCK_LOCK_LABEL);
  const tab = getRunAsks({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE, resumeAttempt });
  assert.equal(tab.resume.label, STUCK_LOCK_LABEL);
  assert.equal(tab.resume.lockPath, lockOf(root, 'r1'));
  assert.doesNotMatch(PAGE, /Remove this file by hand/);
  assert.match(PAGE, /"An old resume lock is in the way\."/);
  // and whatever the last refusal said does not change it: the lock file decides
  const otherAttempt = (flow, runId) => ({ ...resumeAttempt(flow, runId), refusal: 'resume: run "r1" is locked by another resumer (pid 1, x)' });
  assert.equal(listRuns({ root, catalogue: CATALOGUE, resumeAttempt: otherAttempt }).find((x) => x.runId === 'r1').label, STUCK_LOCK_LABEL);
});
