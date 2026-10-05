// M4c-fix group B (docs/wiki/the-module-ladder.md, "M4c-fix", items 8-17, negatives vi, ix, xi). $0: the CLI's
// fake model step. Each test below names its item and was run red with that item's src change taken out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, rmSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { listArchivedAsks, answerAsk } from '../src/ask.js';
import {
  getRunAsks, listRuns, listStops, stuckState, STUCK_LABEL, STUCK_LOCK_LABEL, BROKEN_LABEL,
} from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const loaded = loadCatalogue();
assert.equal(loaded.ok, true);
const CATALOGUE = loaded.primitives;

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4cfixb-${p}-`));
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE };
function cliRaw(args) {
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 20_000 });
}
function cli(args) {
  const r = cliRaw(args);
  assert.equal(r.status, 0, `fwdloop ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** job2 via the real CLI, parked once at its ask. */
function parkedJob2(tag) {
  const root = tmp(tag);
  const w = writeFlow({
    root, name: 'job2', proseText: fixture('job2-with-sources.signed.txt'), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const out = cli(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1']);
  return { root, runDir: path.join(root, 'job2', 'runs', 'run-1'), askId: /askId=(\S+)/.exec(out)[1] };
}

// ---- item 9, negative (vi) ----------------------------------------------------------------------
test('item 9 (vi): an answer.json that is null, a number, a string or an array is refused by name, never a crash, and stays on disk', () => {
  const { root, runDir } = parkedJob2('i9');
  for (const body of ['null', '5', '"x"', '[]']) {
    writeFileSync(path.join(runDir, 'answer.json'), body);
    const r = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', root]);
    assert.notEqual(r.status, 0, body);
    assert.match(r.stderr, /answer\.json for run "run-1" is not a JSON object/, `${body}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /TypeError|at \w+ \(/, `${body}: no crash trace`);
    assert.equal(readFileSync(path.join(runDir, 'answer.json'), 'utf8'), body, 'the refused file is left as it was');
  }
});

// ---- item 12 ------------------------------------------------------------------------------------
test('item 12: a consumed answer whose decision is "constructor" / "toString" reads as unrecognised, in ask.js and in the panel', () => {
  const { root, runDir, askId } = parkedJob2('i12');
  cli(['answer', askId, 'redo', 'why', '--root', root]);
  cli(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  const consumed = path.join(runDir, `answer.${askId}.consumed.json`);
  assert.ok(existsSync(consumed));
  for (const word of ['constructor', 'toString', '__proto__']) {
    const body = JSON.parse(readFileSync(consumed, 'utf8'));
    writeFileSync(consumed, JSON.stringify({ ...body, decision: word }));
    const archived = listArchivedAsks(runDir);
    const row = archived.asks.find((a) => a.askId === askId);
    assert.equal(row.answer.status, `unrecognised: ${word}`, word);
  }
  // the panel's pre-M4a-1 path: no asks/ archive, only the consumed marker
  renameSync(path.join(runDir, 'asks'), path.join(runDir, 'asks-gone'));
  writeFileSync(consumed, JSON.stringify({ ...JSON.parse(readFileSync(consumed, 'utf8')), decision: 'constructor' }));
  const rows = getRunAsks({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE }).asks;
  const legacy = rows.find((a) => a.askId === askId);
  assert.equal(legacy.status, 'unrecognised: constructor');
});

// ---- item 14 ------------------------------------------------------------------------------------
test('item 14: a run parked through a symlinked --root (state.json holds the link path) resumes by the real root; a different root is still refused', async () => {
  const { root, runDir, askId } = parkedJob2('i14');
  const { symlinkSync } = await import('node:fs');
  const link = path.join(tmp('i14-link'), 'root-link');
  symlinkSync(root, link);
  const statePath = path.join(runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.flow.root, root);
  writeFileSync(statePath, JSON.stringify({ ...state, flow: { ...state.flow, root: link } }));
  cli(['answer', askId, 'accept', '--root', root]);
  const r = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /complete: spentUsd=/);
  // a genuinely different root is still refused by name
  const other = tmp('i14-other');
  const { runDir: runDir2, askId: askId2 } = parkedJob2('i14b');
  cli(['answer', askId2, 'accept', '--root', path.dirname(path.dirname(path.dirname(runDir2)))]);
  const st2 = JSON.parse(readFileSync(path.join(runDir2, 'state.json'), 'utf8'));
  writeFileSync(path.join(runDir2, 'state.json'), JSON.stringify({ ...st2, flow: { ...st2.flow, root: other } }));
  const r2 = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', path.dirname(path.dirname(path.dirname(runDir2)))]);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /was parked against flow/);
});

// ---- item 15 (lock part): two resumers never delete each other's lock ---------------------------
test('item 15: a resume that finishes never deletes a resume.lock that is no longer its own', async () => {
  const { root, runDir, askId } = parkedJob2('i15lock');
  cli(['answer', askId, 'redo', 'again', '--root', root]);
  const lockPath = path.join(runDir, 'resume.lock');
  const other = JSON.stringify({ pid: 2 ** 22 - 3, procStart: '123456789' }); // another resumer's holder record
  const modelStep = async (ctx) => {
    // while this resume runs, its lock is replaced by another resumer's (A's lock cleared and retaken by B)
    unlinkSync(lockPath);
    writeFileSync(lockPath, other);
    assert.match(ctx.goal, /Draft the summary resume/);
    return { ok: true, costUsd: 0.001, artifact: { text: '## summary of work history blurb\nx\n## professional skills\ny\n## soft skills\nz', done: true } };
  };
  const { resumeRun } = await import('../src/runner.js');
  const r = await resumeRun({
    root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
  });
  assert.equal(r.outcome, 'paused', JSON.stringify(r));
  assert.equal(existsSync(lockPath), true, 'the other resumer\'s lock is still there');
  assert.equal(readFileSync(lockPath, 'utf8'), other);
  // and a resume that still owns its lock does release it
  rmSync(lockPath);
  const id2 = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId;
  cli(['answer', id2, 'redo', 'again', '--root', root]);
  const r2 = await resumeRun({
    root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep: async () => ({ ok: true, costUsd: 0.001, artifact: { text: '## summary of work history blurb\nx\n## professional skills\ny\n## soft skills\nz', done: true } }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
  });
  assert.equal(r2.outcome, 'paused', JSON.stringify(r2));
  assert.equal(existsSync(lockPath), false, 'an owned lock is released');
});

// ---- item 15 (stuck state), 16, 17 --------------------------------------------------------------
const page = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const rowOf = (root) => listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'run-1');
const stopOf = (root) => listStops({ root }).find((r) => r.runId === 'run-1');
const tabOf = (root) => getRunAsks({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE });
/** A parked run whose answer is saved and nothing is carrying it on. */
function stuckJob2(tag) {
  const p = parkedJob2(tag);
  cli(['answer', p.askId, 'redo', 'again', '--root', p.root]);
  return p;
}
function answerFile(runDir, edit) {
  const f = path.join(runDir, 'answer.json');
  const a = JSON.parse(readFileSync(f, 'utf8'));
  edit(a);
  writeFileSync(f, JSON.stringify(a));
}

test('item 15: an empty resume lock reads "remove the lock by hand" in every surface with NO refusal on record (a panel restart costs no click); a lock holder that cannot be told is never stuck', () => {
  const { root, runDir } = stuckJob2('i15state');
  assert.equal(rowOf(root).label, STUCK_LABEL, 'no lock: the ordinary label');
  writeFileSync(path.join(runDir, 'resume.lock'), '');
  assert.equal(rowOf(root).glyph, '[II]');
  assert.equal(rowOf(root).label, STUCK_LOCK_LABEL);
  assert.equal(stopOf(root).stuckLabel, STUCK_LOCK_LABEL);
  assert.equal(tabOf(root).resume.label, STUCK_LOCK_LABEL);
  assert.equal(tabOf(root).resume.lockPath, path.join(runDir, 'resume.lock'));
  assert.deepEqual(stuckState({ resume: { state: 'not-started' }, liveness: 'gone', lock: 'empty' }).reason, 'lock-no-holder');
  // an unknown holder is never stuck (liveness cannot be told: it may be running)
  assert.equal(stuckState({ resume: { state: 'not-started' }, liveness: 'gone', lock: 'unknown' }).stuck, false);
  assert.equal(stuckState({ resume: { state: 'not-started' }, liveness: 'gone', lock: 'none' }).reason, 'retry');
  // the label is not matched off a refusal string any more
  assert.doesNotMatch(readFileSync(path.join(HERE, '..', 'src', 'panel', 'data.js'), 'utf8'), /\.includes\(LOCK_NO_HOLDER\)/);
});

/** The page's own `answerControls`, evaluated (the page is one HTML file, so tests lift the function). */
function pageAnswerControls() {
  const start = page.indexOf('function answerControls(');
  const src = page.slice(start, page.indexOf('\n  }', start) + 4);
  return new Function('pendingText', `${src}; return answerControls;`)(() => '');
}

test('amendment 1 (a): a saved answer with no readable time gives the doors back with a note; answering again keeps the broken one aside as a write-once record', () => {
  const { root, runDir, askId } = stuckJob2('a1');
  answerFile(runDir, (a) => { delete a.answeredAt; });
  const tab = tabOf(root);
  assert.equal(tab.resume.state, 'broken');
  assert.equal(tab.resume.label, BROKEN_LABEL);
  assert.equal(rowOf(root).glyph, '[·]', 'waiting on you again, not stuck [II]');
  assert.equal(stopOf(root).stuck, false);
  const ask = tab.asks.find((x) => x.askId === askId);
  assert.equal(ask.waiting, true);
  const controls = pageAnswerControls()(ask, tab.resume, null);
  assert.equal(controls.kind, 'doors');
  assert.match(controls.note, /broken/);
  // the old dead-end label is gone from every surface
  assert.doesNotMatch(readFileSync(path.join(HERE, '..', 'src', 'panel', 'data.js'), 'utf8'), /STUCK_NO_TIME_LABEL|has no saved time — answer again/);
  // answering again: the broken file is kept aside, byte for byte, and the new answer is saved
  const brokenBytes = readFileSync(path.join(runDir, 'answer.json'), 'utf8');
  const r = answerAsk({ runDir, askId, decision: 'redo', reason: 'again' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.setAside, `answer.${askId}.broken.1.json`);
  assert.equal(readFileSync(path.join(runDir, r.setAside), 'utf8'), brokenBytes);
  assert.ok(Number.isFinite(Date.parse(JSON.parse(readFileSync(path.join(runDir, 'answer.json'), 'utf8')).answeredAt)));
  // a second broken answer never overwrites the first record
  writeFileSync(path.join(runDir, 'answer.json'), 'not json at all');
  const r2 = answerAsk({ runDir, askId, decision: 'redo', reason: 'again 2' });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.setAside, `answer.${askId}.broken.2.json`);
  assert.equal(readFileSync(path.join(runDir, `answer.${askId}.broken.1.json`), 'utf8'), brokenBytes);
  // a GOOD saved answer is never moved aside: a second answer is refused, the file stays
  const good = readFileSync(path.join(runDir, 'answer.json'), 'utf8');
  const r3 = answerAsk({ runDir, askId, decision: 'accept' });
  assert.equal(r3.ok, false);
  assert.match(r3.red, /already answered/);
  assert.equal(readFileSync(path.join(runDir, 'answer.json'), 'utf8'), good);
  assert.equal(existsSync(path.join(runDir, `answer.${askId}.broken.3.json`)), false);
});

test('amendment 1 (a): within the watch, a saved answer found broken ends the "working" state with the reason, and the doors come back', () => {
  const start = page.indexOf('function liveOutcome(');
  const src = page.slice(start, page.indexOf('\n  }', start) + 4);
  const liveOutcome = new Function(`${src}; return liveOutcome;`)();
  const o = liveOutcome('a1', { glyph: '[·]' }, { asks: [], resume: { state: 'broken', label: 'your saved answer is broken', reason: 'no readable saved time' } });
  assert.equal(o.done, true);
  assert.equal(o.cls, 'refused');
  assert.match(o.text, /broken: no readable saved time/);
  // not broken: the watch keeps waiting (the control)
  assert.equal(liveOutcome('a1', { glyph: '[·]' }, { asks: [], resume: { state: 'took-over', label: 'x' } }).done, false);
});

test('item 17 (replaced by amendment 1 (b)): a late saved answer reads as none and offers the reopen, never the resume that records the expiry', () => {
  const { root, runDir, askId } = stuckJob2('i17');
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`), path.join(runDir, 'state.json')]) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = '2020-01-02T00:00:00.000Z';
    if ('askedAt' in j) j.askedAt = '2020-01-01T23:30:00.000Z'; // a 30 min signed wait
    writeFileSync(f, JSON.stringify(j));
  }
  answerFile(runDir, (a) => { a.answeredAt = '2020-01-03T00:00:00.000Z'; });
  const tab = tabOf(root);
  assert.equal(tab.resume, null, 'a late saved answer is not a resumable answer');
  assert.equal(rowOf(root).glyph, '[!]', 'the run still reads [!] expired');
  assert.equal(stopOf(root).stuck, false);
  const ask = tab.asks.find((a) => a.askId === askId);
  assert.equal(ask.reopen && ask.reopen.waitMs, 1_800_000, 'the expired ask offers the reopen with the signed wait');
  const start = page.indexOf('function answerControls(');
  const src = page.slice(start, page.indexOf('\n  }', start) + 4);
  const answerControls = new Function('pendingText', `${src}; return answerControls;`)(() => '');
  assert.equal(answerControls(ask, tab.resume, null).kind, 'expired');
  assert.doesNotMatch(page, /Resume — record the expiry/);
});

test('item 12 follow-up: a consumed-answer marker holding `null` is skipped by the panel, never a crash', () => {
  const { root, runDir, askId } = parkedJob2('i12null');
  cli(['answer', askId, 'redo', 'why', '--root', root]);
  cli(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  renameSync(path.join(runDir, 'asks'), path.join(runDir, 'asks-gone'));
  writeFileSync(path.join(runDir, `answer.${askId}.consumed.json`), 'null');
  assert.doesNotThrow(() => getRunAsks({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE }));
});
