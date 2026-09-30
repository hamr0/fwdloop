// Tests for M4b amendment 3 (docs/wiki/the-module-ladder.md, "M4b amendment 3
// — the word is "redo" everywhere ... — SIGNED by hamr 2026-09-30"),
// negatives (xii)-(xvii). $0: the CLI is the real `bin/fwdloop` with its
// test-only fake model step; the library/panel-data tests use no provider.
// The panel-POST half of (xii) lives in test/panel-resume.test.js (its
// happy-path test), which drives the real panel server + real resume child.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow, appendAudit, appendHistory } from '../src/index.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk, normalizeDecision } from '../src/ask.js';
import {
  computeGlyph, getRunDetail, listRuns, listStops, getRunAsks,
} from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_MODEL_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const tmpRoot = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-redo-${p}-`));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function writeJob2Flow(root, name = 'job2') {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

function writeSources(srcDir) {
  const resume = path.join(srcDir, 'resume.docx');
  const jd = path.join(srcDir, 'jd.md');
  writeFileSync(resume, 'Resume text goes here.');
  writeFileSync(jd, 'JD text goes here.');
  return { resume, jd };
}

const cliEnv = () => ({
  PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP,
});
const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { env: cliEnv(), encoding: 'utf8', timeout: 20_000 });

/** Park a job2 run through the CLI; returns { root, runDir, askId }. */
function cliParked(prefix) {
  const root = tmpRoot(prefix);
  writeJob2Flow(root);
  const { resume, jd } = writeSources(tmpRoot(`${prefix}-src`));
  const r = cli(['run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const askId = /askId=(\S+)/.exec(r.stdout)[1];
  return { root, runDir: path.join(root, 'job2', 'runs', 'run-1'), askId };
}

/** After the answer: resume, and prove the step before the ask was redone with
 *  the reason as the human's gap and the run re-parked under a NEW ask. */
function assertRedone({ root, runDir, askId }, reason) {
  const consumed = path.join(runDir, `answer.${askId}.consumed.json`);
  const before = readJson(path.join(runDir, 'answer.json'));
  assert.equal(before.decision, 'redo', 'the saved answer says redo');
  const res = cli(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /parked: askId=/, 're-parked at a new ask');
  assert.notEqual(/askId=(\S+)/.exec(res.stdout)[1], askId);
  assert.equal(readJson(consumed).decision, 'redo', 'the consumed answer on disk says redo');
  const rows = jsonl(path.join(runDir, 'audit.jsonl'));
  assert.ok(rows.some((r) => r.class === 'hitl' && r.verdict === 'red' && r.gap === reason), 'the human redo is audited with its reason');
  const summaryTries = rows.filter((r) => r.step === 'resume-summary' && r.class !== 'hitl' && r.verdict === 'green');
  assert.equal(summaryTries.length, 2, 'the step before the ask ran again');
}

// (xii) CLI half
test('(xii) CLI: `answer redo "<reason>"` redoes the step before the ask; the consumed answer says redo', () => {
  const run = cliParked('xii');
  const a = cli(['answer', run.askId, 'redo', 'tighten the skills section', '--root', run.root]);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.match(a.stdout, /decision=redo/);
  assertRedone(run, 'tighten the skills section');
});

// (xiii)
test('(xiii) CLI: the old word `reject` does the same thing and is recorded as redo', () => {
  const run = cliParked('xiii');
  const a = cli(['answer', run.askId, 'reject', 'tighten the skills section', '--root', run.root]);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.match(a.stdout, /decision=redo/);
  assertRedone(run, 'tighten the skills section');
});

// (xv)
test('(xv) a blank reason on redo is refused by name; the refusal says redo, never reject (library, CLI, and the old word)', () => {
  const run = cliParked('xv');
  for (const word of ['redo', 'reject']) {
    const lib = answerAsk({ runDir: run.runDir, askId: run.askId, decision: word, reason: '   ' });
    assert.equal(lib.ok, false);
    assert.match(lib.red, /needs a non-blank reason to redo/);
    assert.doesNotMatch(lib.red, /reject/i);
    const c = cli(['answer', run.askId, word, '--root', run.root]);
    assert.notEqual(c.status, 0);
    assert.match(c.stderr, /needs a non-blank reason to redo/);
    assert.doesNotMatch(c.stderr, /reject/i);
  }
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), false, 'nothing written');
  const bad = answerAsk({ runDir: run.runDir, askId: run.askId, decision: 'banana', reason: 'x' });
  assert.match(bad.red, /unrecognised decision "banana"/);
  const help = cli(['answer', run.askId, '--root', run.root]);
  assert.match(help.stderr, /accept\|redo\|rerun/);
});

test('normalizeDecision: reject -> redo; accept/redo/rerun pass; anything else is returned unchanged', () => {
  assert.equal(normalizeDecision('reject'), 'redo');
  for (const d of ['accept', 'redo', 'rerun', 'banana', undefined]) assert.equal(normalizeDecision(d), d);
});

// (xiv) a run whose files say `reject` (what an older version wrote)
const NOOP_SEND = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

function makeJob2ModelStep() {
  const calls = { summary: 0 };
  const fn = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      calls.summary += 1;
      const text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
  return { fn, calls };
}

const runArgs = (root, modelStep, extra = {}) => ({
  root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, sendStep: NOOP_SEND, primitives: {}, businessDate: '2026-06-01', ...extra,
});

test('(xiv) files that say `reject` (an older version\'s) resume as redo, the panel shows redo, and no pre-existing file is rewritten', async () => {
  const root = tmpRoot('xiv');
  writeJob2Flow(root);
  const { resume, jd } = writeSources(tmpRoot('xiv-src'));
  const { fn: modelStep, calls } = makeJob2ModelStep();
  const parked = await runFlow({
    ...runArgs(root, modelStep, { askStep: makeParkingAskStep() }),
    sources: [{ id: 'resume', path: resume }, { id: 'jd', path: jd }],
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const { runDir, askId } = parked;

  // As an older version would have left it: the answer file with the OLD word.
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({
    askId, decision: 'reject', reason: 'tighten the skills section', answeredAt: new Date().toISOString(),
  }, null, 2));
  const answerHash = sha(path.join(runDir, 'answer.json'));
  const archive = path.join(runDir, 'asks', `${askId}.json`);
  const archiveHash = sha(archive);
  const auditBefore = readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8');
  const artifactsBefore = readdirSync(path.join(runDir, 'artifacts')).map((f) => [f, sha(path.join(runDir, 'artifacts', f))]);

  assert.ok(artifactsBefore.length > 0, 'sanity: there are artifacts to compare');
  const res = await resumeRun(runArgs(root, modelStep));
  assert.equal(res.outcome, 'paused', res.red);
  assert.notEqual(res.askId, askId, 'the old word still redoes the step and re-parks under a new ask');
  assert.equal(calls.summary, 2, 'the step before the ask ran once more');

  const consumed = path.join(runDir, `answer.${askId}.consumed.json`);
  assert.equal(sha(consumed), answerHash, 'the old answer is renamed, byte-identical — never rewritten');
  assert.equal(readJson(consumed).decision, 'reject', 'the file on disk still says the old word');
  assert.equal(sha(archive), archiveHash, 'the archived ask is untouched');
  assert.ok(readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8').startsWith(auditBefore), 'audit rows already written are untouched (append only)');
  for (const [f, h] of artifactsBefore) {
    if (f.startsWith('resume-summary')) continue; // a redo deliberately replaces the redone step's own artifact
    assert.equal(sha(path.join(runDir, 'artifacts', f)), h, `${f} untouched`);
  }

  // The panel reads the old word as redo, everywhere it names the answer.
  const asks = getRunAsks({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE });
  assert.equal(asks.asks.find((a) => a.askId === askId).status, 'redo');
  const stop = listStops({ root }).find((r) => r.askId === askId);
  assert.equal(stop.status, 'redo');
  assert.equal(stop.reason, 'tighten the skills section');
  assert.equal(readJson(consumed).decision, 'reject', 'reading it did not rewrite it');
});

// (xvi) / (xvii) how a run the human ended with rerun, and a real red, render.
function historyRow(runId, outcome) {
  return {
    runId, at: '2026-09-30T05:56:30.292Z', outcome, spentUsd: 0.003, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: 'deadbeef',
  };
}

function endedRuns() {
  const root = tmpRoot('ended');
  const { dir: flowDir } = writeJob2Flow(root, 'endflow');
  for (const [runId, outcome] of [['run-rerun', 'rerun'], ['run-red', 'red']]) {
    const runDir = path.join(flowDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    // a real redo happened earlier in the run: its audit row is not "why it stopped"
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 1, class: 'hitl', verdict: 'red', gap: 'tighten it', usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-30T05:56:29.000Z', tokens: null, tools: null, refused: [],
    });
    writeFileSync(path.join(runDir, 'log.json'), JSON.stringify({ runId, outcome, artifacts: {}, ...(outcome === 'red' ? { red: 'step "x" went red' } : {}) }));
    appendHistory(flowDir, historyRow(runId, outcome));
  }
  return root;
}

// The page's own words for a run, from the real page function.
function pageLiveOutcome() {
  const html = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  const start = html.indexOf('function liveOutcome(');
  const end = html.indexOf('function startLive(');
  assert.ok(start > 0 && end > start, 'liveOutcome must be found in the page');
  return new Function(`${html.slice(start, end)}; return liveOutcome;`)(); // eslint-disable-line no-new-func
}

test('(xvi) a run ended by rerun is [✗] "stopped by you (rerun)..." and never renders the word "failed"', () => {
  const root = endedRuns();
  const g = computeGlyph({ historyRow: historyRow('r', 'rerun'), askJson: null, consumedAnswerExists: true, hasStateJson: true });
  assert.deepEqual(g, { glyph: '[✗]', label: 'stopped by you (rerun), a fresh run was started' });

  const detail = getRunDetail({ root, flow: 'endflow', runId: 'run-rerun', catalogue: CATALOGUE });
  assert.equal(detail.glyph, '[✗]');
  assert.equal(detail.label, 'stopped by you (rerun), a fresh run was started');
  assert.doesNotMatch(JSON.stringify(detail), /failed/i, 'run header, summary and stop reason never say failed');
  const row = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'run-rerun');
  assert.equal(row.glyph, '[✗]');
  assert.doesNotMatch(JSON.stringify(row), /failed/i, 'the run list row never says failed');

  const live = pageLiveOutcome()('ask-1', detail, { asks: [] });
  assert.doesNotMatch(live.text, /failed/i, 'the live message never says failed');
  assert.match(live.text, /rerun/);
});

test('(xvii) a run that ended red still renders "failed"', () => {
  const root = endedRuns();
  const detail = getRunDetail({ root, flow: 'endflow', runId: 'run-red', catalogue: CATALOGUE });
  assert.equal(detail.glyph, '[✗]');
  assert.equal(detail.label, 'failed (red)');
  const row = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'run-red');
  assert.match(row.label, /failed \(red\)/);
  const live = pageLiveOutcome()('ask-1', detail, { asks: [] });
  assert.match(live.text, /failed \(red\)/);
});

test('the page: doors are Accept, Redo, Rerun; the hint says what each does; the POST sends redo; no "reject" word is shown', () => {
  const html = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  assert.match(html, /makeButton\("Redo", "btn-redo", function\(\)\{ sendAnswer\(root, ask, ctx, "redo"\); \}\)/);
  assert.doesNotMatch(html, /btn-reject|makeButton\("Reject"/);
  assert.match(html, /redo: redo the last step with your reason/);
  assert.match(html, /rerun: end this run and start a fresh one from the top/);
  assert.match(html, /reason \(needed for redo and rerun\)/);
  assert.doesNotMatch(html, /library's reject/);
  // a rerun-ended run also carries [✗]; the filter chip never calls it "failed".
  const chip = html.match(/data-filter-value="\[✗\]" title="([^"]*)"/);
  assert.ok(chip, 'the [✗] filter chip must be found in the page');
  assert.notEqual(chip[1], 'failed');
  assert.equal(chip[1], 'stopped');
});
