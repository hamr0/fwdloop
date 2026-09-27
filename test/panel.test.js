// Tests for M4a piece 2 (docs/wiki/the-module-ladder.md, "M4a — read-only
// panel — SIGNED", scope item 2): the panel's data layer (src/panel/data.js)
// and HTTP shell (src/panel/server.js). Every fixture flow is built here,
// under a fresh `mkdtempSync` root — never `flows/` (gitignored, and the
// brief says never to use it for fixtures). No network beyond binding
// 127.0.0.1 on an OS-assigned port (`port: 0`). Every value in every fixture
// is scrubbed/fake — no real names, emails, or phone numbers.

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import http from 'node:http';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow, appendAudit, appendHistory } from '../src/index.js';
import { loadCatalogue } from '../src/catalogue.js';
import { createPanelServer, DEFAULT_PORT } from '../src/panel/server.js';
import {
  computeGlyph, costDisplay, listRuns, getRunDetail, getRunAudit, getRunJob, listStops, getRunAsks,
  deriveRunModel, deriveAuditAction, summarizeSpendRows,
} from '../src/panel/data.js';
import { readSpendRows, appendSpendRow } from '../src/provider.js';
import { writeAskArchive } from '../src/ask.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-21T12:00:00Z';

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'fwdloop-panel-test-'));
}

/** Writes a real signed flow (job #2's fixture, shared with test/flow.test.js)
 *  under `root/name`, and returns its `runs/<runId>` dir maker. */
function writeTestFlow(root, name) {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result.dir;
}

function makeRunDir(flowDir, runId) {
  const runDir = path.join(flowDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

function writeJson(dir, name, obj) {
  writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
}

// A single shared root + fixture flow with several runs, one per scenario
// this suite needs to prove. Built once (`before`-style, at module load) so
// every test shares the same read-only fixtures.
const ROOT = tmpRoot();
const FLOW = 'job2-fixture';
const FLOW_DIR = writeTestFlow(ROOT, FLOW);

// --- run-done: a clean complete run, every step attempted once, green. ----
{
  const runDir = makeRunDir(FLOW_DIR, 'run-done');
  for (const row of [
    {
      step: 'resume-text', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    },
    {
      step: 'jd-text', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    },
    {
      step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 500, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    },
    {
      step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0, spendComplete: true, wallMs: 10, model: null, modelMatch: null, strike: false,
    },
    {
      step: 'resume-summary-output', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0, spendComplete: true, wallMs: 10, model: null, modelMatch: null, strike: false,
    },
  ]) appendAudit(runDir, row);
  writeJson(runDir, 'log.json', {
    runId: 'run-done', outcome: 'complete', artifacts: { 'resume-summary-output': { path: 'poc/m0/out' } }, attempts: [{ step: 'resume-summary', modelOutput: 'a fake drafted summary, scrubbed' }],
  });
  appendHistory(FLOW_DIR, {
    runId: 'run-done', at: '2026-09-24T13:52:07.007Z', outcome: 'complete', spentUsd: 0.004, spendComplete: true, capUsd: 0.25, wallMs: 720, signatureHash: 'deadbeef',
  });
  // hamr's review #1: run-level spend.jsonl totals for the Summary tab —
  // two real rounds, so tokensIn/tokensOut/cacheReadTokens all sum > 0.
  appendSpendRow(path.join(runDir, 'spend.jsonl'), {
    model: 'deepseek-flash', modelReturned: 'deepseek-flash', rounds: 1, costUsd: 0.001, wallMs: 400,
    tokens: {
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 0,
    },
  });
  appendSpendRow(path.join(runDir, 'spend.jsonl'), {
    model: 'deepseek-flash', modelReturned: 'deepseek-flash', rounds: 1, costUsd: 0.002, wallMs: 500,
    tokens: {
      inputTokens: 200, outputTokens: 80, cacheReadTokens: 5, cacheCreationTokens: 0,
    },
  });
}

// --- run-failed: a completed-but-red run (a real bareloop-adjacent
//     "not-done" outcome) — must show [✗], never [?]. -----------------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-failed');
  appendAudit(runDir, {
    step: 'jd-text', attempt: 1, class: 'hitl', verdict: 'not-done', gap: 'the JD could not be read — scrubbed test gap text', usd: 0.05, spendComplete: true, wallMs: 3000, model: 'deepseek-flash', modelMatch: 'match', strike: false,
  });
  writeJson(runDir, 'log.json', { runId: 'run-failed', outcome: 'not-done', red: 'jd-text: the JD could not be read — scrubbed test gap text', artifacts: {} });
  appendHistory(FLOW_DIR, {
    runId: 'run-failed', at: '2026-09-24T15:24:16.283Z', outcome: 'not-done', spentUsd: 0.05, spendComplete: true, capUsd: 0.25, wallMs: 3000, signatureHash: null,
  });
}

// --- run-done-after-reject: a real M4a piece 3 fix #1 shape, caught live
//     against `flows/` (not a synthetic edge case) — a step's early attempt
//     carries a superseded not-done, a LATER attempt on the SAME step
//     passes, and the run as a whole completes clean. The summary's "why"
//     must never surface that superseded gap for a passed run. ------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-done-after-reject');
  appendAudit(runDir, {
    step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'missing a required section, scrubbed test gap', usd: 0.001, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false,
  });
  appendAudit(runDir, {
    step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 400, model: 'deepseek-flash', modelMatch: 'match', strike: false,
  });
  writeJson(runDir, 'log.json', { runId: 'run-done-after-reject', outcome: 'complete', artifacts: {} });
  appendHistory(FLOW_DIR, {
    runId: 'run-done-after-reject', at: '2026-09-26T05:56:30.292Z', outcome: 'complete', spentUsd: 0.003, spendComplete: true, capUsd: 0.25, wallMs: 368000, signatureHash: 'deadbeef',
  });
}

// --- run-partial: a completed history row whose own spend is a floor
//     (spendComplete:false) — negative (iv). ------------------------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-partial');
  appendAudit(runDir, {
    step: 'resume-text', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: null, spendComplete: false, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
  });
  appendHistory(FLOW_DIR, {
    runId: 'run-partial', at: '2026-09-25T00:00:00.000Z', outcome: 'not-done', spentUsd: 0.033, spendComplete: false, capUsd: 0.25, wallMs: 900, signatureHash: null,
  });
}

// --- run-waiting: parked, an open ask, no answer at all — [·] waiting on
//     you. Also the fixture the Inbox tests read (M2-shape evidence.text). -
{
  const runDir = makeRunDir(FLOW_DIR, 'run-waiting');
  writeJson(runDir, 'ask.json', {
    askId: 'ask-waiting-1',
    question: 'Does this look right? (scrubbed test question)',
    askedAt: '2026-09-25T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z', // far future — never "expired" in this test suite's lifetime
    evidence: { text: 'a fake drafted summary under review, scrubbed for the test suite' },
  });
}

// --- run-answered: parked, then answered (a consumed-answer marker exists)
//     but no history row yet — resume hasn't finished. [·] "answered, not
//     resumed yet", distinct from "waiting on you", never [?]. -------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-answered');
  writeJson(runDir, 'ask.json', {
    askId: 'ask-answered-1',
    question: 'Does this look right? (scrubbed test question)',
    askedAt: '2026-09-25T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: { text: 'a fake drafted summary, scrubbed' },
  });
  writeJson(runDir, `answer.${'ask-answered-1'}.consumed.json`, { askId: 'ask-answered-1', decision: 'accept', answeredAt: '2026-09-25T01:00:00.000Z' });
}

// --- run-died: no history row, no ask.json, no state.json at all —
//     [?] "running or died: unknown", never [✗], never [✓]. ----------------
{
  makeRunDir(FLOW_DIR, 'run-died');
}

// --- run-legacy: an M2-era ask.json (no askId/expiresAt) — shown as
//     "legacy", never "open" in the Inbox. ---------------------------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-legacy');
  writeJson(runDir, 'ask.json', { question: 'a pre-M3 legacy ask, scrubbed', askedAt: '2026-09-01T00:00:00.000Z' });
}

// --- run-unjudged: an open ask carrying M3-shape evidence with an unjudged
//     artifact, to prove the Inbox surfaces it labelled by step. hamr review
//     #9 (2026-09-27): the fixture's "step" field is the GOAL prose (matching
//     real ask.json shapes — see test/ask.test.js's m3-shape fixture), and
//     "emits" is the real step id; the Inbox must label by emits, not goal. -
{
  const runDir = makeRunDir(FLOW_DIR, 'run-unjudged');
  writeJson(runDir, 'ask.json', {
    askId: 'ask-unjudged-1',
    question: 'Check the draft (scrubbed test question)',
    askedAt: '2026-09-25T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: {
      artifact: { text: 'the draft under review, scrubbed' },
      unjudged: [{
        step: 'Read the job description markdown file and expose its full text as an artifact, scrubbed goal text',
        emits: 'jd-text',
        artifact: { text: 'an unjudged artifact, scrubbed, long enough to prove the scroll box actually renders it end to end' },
      }],
    },
  });
}

// --- run-archived-2asks: M4a-1 shape — an `asks/` archive with TWO asks,
//     reject then accept, each paired with its own consumed-answer file by
//     askId. Proves `getRunAsks`/`listStops` list both, correctly paired and
//     correctly statused, off the real archive reader (`listArchivedAsks`).
{
  const runDir = makeRunDir(FLOW_DIR, 'run-archived-2asks');
  writeAskArchive({
    runDir,
    askId: 'ask-2a-first',
    question: 'Does the first draft look right? (scrubbed)',
    askedAt: '2026-09-20T00:00:00.000Z',
    expiresAt: '2026-09-20T01:00:00.000Z',
    evidence: { artifact: { text: 'first draft under review, scrubbed' }, unjudged: [] },
  });
  writeJson(runDir, 'answer.ask-2a-first.consumed.json', {
    askId: 'ask-2a-first', decision: 'reject', reason: 'missing a section, scrubbed test reason', answeredAt: '2026-09-20T00:10:00.000Z',
  });
  writeAskArchive({
    runDir,
    askId: 'ask-2a-second',
    question: 'Does the redraft look right? (scrubbed)',
    askedAt: '2026-09-20T00:20:00.000Z',
    expiresAt: '2026-09-20T01:20:00.000Z',
    evidence: { artifact: { text: 'second draft under review, scrubbed' }, unjudged: [] },
  });
  writeJson(runDir, 'answer.ask-2a-second.consumed.json', {
    askId: 'ask-2a-second', decision: 'accept', answeredAt: '2026-09-20T00:30:00.000Z',
  });
}

// --- run-archive-order: askId sorts alphabetically OPPOSITE its real
//     chronological (askedAt) order — proves the panel re-sorts by askedAt
//     rather than trusting `listArchivedAsks`'s own filename-sorted order
//     (a UUID askId carries no chronological meaning at all). ---------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-archive-order');
  writeAskArchive({
    runDir,
    askId: 'a-asked-second',
    question: 'asked second, scrubbed',
    askedAt: '2026-09-21T01:00:00.000Z',
    expiresAt: '2026-09-21T02:00:00.000Z',
    evidence: { artifact: { text: 'draft, scrubbed' }, unjudged: [] },
  });
  writeJson(runDir, 'answer.a-asked-second.consumed.json', {
    askId: 'a-asked-second', decision: 'accept', answeredAt: '2026-09-21T01:10:00.000Z',
  });
  writeAskArchive({
    runDir,
    askId: 'z-asked-first',
    question: 'asked first, scrubbed',
    askedAt: '2026-09-21T00:00:00.000Z',
    expiresAt: '2026-09-21T01:00:00.000Z',
    evidence: { artifact: { text: 'draft, scrubbed' }, unjudged: [] },
  });
  writeJson(runDir, 'answer.z-asked-first.consumed.json', {
    askId: 'z-asked-first', decision: 'accept', answeredAt: '2026-09-21T00:10:00.000Z',
  });
}

// --- run-archived-open: an `asks/` archive with ONE ask, still open (no
//     consumed answer, far-future expiry) — proves the archived path (not
//     just the legacy path) also reports "unanswered"/time-left correctly.
{
  const runDir = makeRunDir(FLOW_DIR, 'run-archived-open');
  writeAskArchive({
    runDir,
    askId: 'ask-archived-open-1',
    question: 'Still waiting on this one (scrubbed)',
    askedAt: '2026-09-25T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: { artifact: { text: 'draft still under review, scrubbed' }, unjudged: [] },
  });
}

// A flow with zero runs at all — the "no runs yet" empty-state row.
writeTestFlow(ROOT, 'job2-empty');

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// computeGlyph / costDisplay — unit-level, no filesystem.
// ---------------------------------------------------------------------------

describe('computeGlyph', () => {
  test('a complete history row is [✓]', () => {
    const g = computeGlyph({
      historyRow: { outcome: 'complete' }, askJson: null, consumedAnswerExists: false, hasStateJson: false,
    });
    assert.equal(g.glyph, '[✓]');
  });

  test('a non-complete history row is [✗], never [?]', () => {
    const g = computeGlyph({
      historyRow: { outcome: 'not-done' }, askJson: null, consumedAnswerExists: false, hasStateJson: false,
    });
    assert.equal(g.glyph, '[✗]');
    assert.notEqual(g.glyph, '[?]');
  });

  test('negative (iii): no history row, no park at all is [?], never [✗] and never [✓]', () => {
    const g = computeGlyph({
      historyRow: null, askJson: null, consumedAnswerExists: false, hasStateJson: false,
    });
    assert.equal(g.glyph, '[?]');
    assert.notEqual(g.glyph, '[✗]');
    assert.notEqual(g.glyph, '[✓]');
  });

  test('an open, unanswered ask is [·] "waiting on you"', () => {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a' }, consumedAnswerExists: false, hasStateJson: true,
    });
    assert.equal(g.glyph, '[·]');
    assert.match(g.label, /waiting on you/);
  });

  test('negative (iii): answered but not yet resumed is worded distinctly, never [?] and never "waiting on you"', () => {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a' }, consumedAnswerExists: true, hasStateJson: true,
    });
    assert.equal(g.glyph, '[·]');
    assert.match(g.label, /answered, not resumed yet/);
    assert.doesNotMatch(g.label, /waiting on you/);
    assert.notEqual(g.glyph, '[?]');
  });
});

describe('costDisplay', () => {
  test('a complete spend shows a bare total', () => {
    const r = costDisplay(0.0117834, true);
    assert.equal(r.ok, true);
    assert.equal(r.display, '$0.0118');
    assert.doesNotMatch(r.display, /at least/);
  });

  test('negative (iv): spendComplete:false shows "at least $X", never a bare total', () => {
    const r = costDisplay(0.033, false);
    assert.equal(r.ok, true);
    assert.match(r.display, /^at least \$0\.0330$/);
  });

  test('a non-number spentUsd is refused, never coerced to $0', () => {
    const r = costDisplay(undefined, true);
    assert.equal(r.ok, false);
  });
});

describe('deriveRunModel (hamr review #1/#7: model on the Summary/Job tabs)', () => {
  test('the LAST audit row naming a model wins, not the first', () => {
    const m = deriveRunModel([
      { model: 'deepseek-flash' },
      { model: null },
      { model: 'deepseek-flash' },
    ]);
    assert.equal(m, 'deepseek-flash');
  });

  test('no row ever names a model: null, never a guessed default', () => {
    assert.equal(deriveRunModel([{ model: null }, { model: null }]), null);
    assert.equal(deriveRunModel([]), null);
  });
});

describe('deriveAuditAction (hamr review #6: the Audit tab Action column)', () => {
  test('a row with a model is "model call (<model>)"', () => {
    assert.equal(deriveAuditAction({ verdict: 'green', model: 'deepseek-flash', class: 'softgreen' }), 'model call (deepseek-flash)');
  });

  test('a paused row is "paused for you", even if it somehow also carried a model', () => {
    assert.equal(deriveAuditAction({ verdict: 'paused', model: null, class: 'hitl' }), 'paused for you');
    assert.equal(deriveAuditAction({ verdict: 'paused', model: 'deepseek-flash', class: 'hitl' }), 'paused for you');
  });

  test('a hitl-classed row with no model is "human"', () => {
    assert.equal(deriveAuditAction({ verdict: 'hitl', model: null, class: 'hitl' }), 'human');
    assert.equal(deriveAuditAction({ verdict: 'red', model: null, class: 'hitl' }), 'human');
  });

  test('a mechanical row with no model and no hitl class falls back to its own verdict word, never "unknown action"', () => {
    assert.equal(deriveAuditAction({ verdict: 'not-done', model: null, class: 'softgreen' }), 'not-done');
    assert.notEqual(deriveAuditAction({ verdict: 'not-done', model: null, class: 'softgreen' }), 'unknown action');
  });

  test('proof this can fail: reverting to a fixed "unknown action" string for every row breaks the model-call assertion above', () => {
    // This test documents the red line the real fix removes — see the report
    // for the actual revert-and-restore proof (this file doesn't re-run git).
    assert.notEqual(deriveAuditAction({ verdict: 'green', model: 'deepseek-flash', class: 'softgreen' }), 'unknown action');
  });
});

describe('summarizeSpendRows (hamr review #1: run-level spend.jsonl totals)', () => {
  test('zero rows: empty with a why, never a fabricated zero total', () => {
    const s = summarizeSpendRows([]);
    assert.equal(s.empty, true);
    assert.match(s.why, /no rows/);
  });

  test('rounds/tokens sum across every row when every row carries them', () => {
    const rows = [
      { rounds: 1, tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 } },
      { rounds: 2, tokens: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 5 } },
    ];
    const s = summarizeSpendRows(rows);
    assert.equal(s.empty, false);
    assert.equal(s.rounds, 3);
    assert.equal(s.tokensIn, 300);
    assert.equal(s.tokensOut, 130);
    assert.equal(s.cacheReadTokens, 15);
  });

  test('a field no row ever populated is null with its own why, never folded into 0', () => {
    const s = summarizeSpendRows([{ rounds: 1, tokens: {} }]);
    assert.equal(s.tokensIn, null);
    assert.match(s.tokensInWhy, /no spend.jsonl row/);
  });
});

// ---------------------------------------------------------------------------
// data.js, direct calls (no HTTP) — the full endpoint surface.
// ---------------------------------------------------------------------------

describe('listRuns', () => {
  const rows = listRuns({ root: ROOT, catalogue: CATALOGUE });

  test('every fixture run is listed', () => {
    const ids = rows.filter((r) => r.flow === FLOW).map((r) => r.runId);
    for (const id of ['run-done', 'run-failed', 'run-partial', 'run-waiting', 'run-answered', 'run-died', 'run-legacy', 'run-unjudged']) {
      assert.ok(ids.includes(id), `expected ${id} in listRuns`);
    }
  });

  test('a flow with zero runs still gets a row, with a why', () => {
    const row = rows.find((r) => r.flow === 'job2-empty');
    assert.ok(row, 'job2-empty should be listed');
    assert.equal(row.runId, null);
    assert.match(row.why, /no runs yet/);
  });

  test('run-done glyph is [✓] and spend is a bare total', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-done');
    assert.equal(row.glyph, '[✓]');
    assert.equal(row.spend, '$0.0040');
  });

  test('run-partial spend is a floor ("at least"), never a bare total', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-partial');
    assert.match(row.spend, /^at least \$/);
  });

  test('run-died is [?], never [✗]/[✓], and carries no invented spend', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-died');
    assert.equal(row.glyph, '[?]');
    assert.notEqual(row.spend, '$0');
    assert.notEqual(row.spend, 0);
  });

  test('run-answered reads distinctly from run-waiting', () => {
    const waiting = rows.find((r) => r.flow === FLOW && r.runId === 'run-waiting');
    const answered = rows.find((r) => r.flow === FLOW && r.runId === 'run-answered');
    assert.match(waiting.label, /waiting on you/);
    assert.match(answered.label, /answered, not resumed yet/);
    assert.notEqual(waiting.label, answered.label);
  });

  test('browser re-walk bug #4: a parked run with an open ask carries the ask\'s own askedAt, never the generic "no history row" why', () => {
    const waiting = rows.find((r) => r.flow === FLOW && r.runId === 'run-waiting');
    assert.equal(waiting.at, null);
    assert.equal(waiting.askedAt, '2026-09-25T00:00:00.000Z');
    assert.equal(waiting.atWhy, null);
  });

  test('browser re-walk bug #4: a run with no history row and no ask either keeps the generic why, and no askedAt', () => {
    const died = rows.find((r) => r.flow === FLOW && r.runId === 'run-died');
    assert.equal(died.at, null);
    assert.equal(died.askedAt, null);
    assert.match(died.atWhy, /no history row/);
  });
});

describe('getRunDetail', () => {
  test('the step map comes from declaration.steps, attempts joined from audit.jsonl', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(detail.glyph, '[✓]');
    assert.ok(Array.isArray(detail.steps));
    assert.equal(detail.steps.length, 5);
    const summaryStep = detail.steps.find((s) => s.emits === 'resume-summary');
    assert.equal(summaryStep.attempts.length, 1);
    assert.equal(summaryStep.attempts[0].verdict, 'green');
    assert.equal(summaryStep.attempts[0].cost, 0.002);
  });

  test('what the model wrote comes from log.json', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.ok(detail.modelWrote);
    assert.ok(detail.modelWrote.artifacts['resume-summary-output']);
  });

  test('a red run carries its stop reason, from log.json\'s "red" field', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-failed', catalogue: CATALOGUE,
    });
    assert.equal(detail.glyph, '[✗]');
    assert.match(detail.stopReason, /JD could not be read/);
  });

  test('M4a piece 3 fix #1: a PASSED run never surfaces a superseded not-done from an earlier attempt as its stop reason', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-done-after-reject', catalogue: CATALOGUE,
    });
    assert.equal(detail.outcome, 'complete');
    assert.equal(detail.stopReason, null);
    assert.match(detail.stopReasonWhy, /completed clean/);
    assert.doesNotMatch(detail.stopReasonWhy || '', /missing a required section/);
  });

  test('a genuinely stopped run\'s fallback stop reason names the step, from the LAST matching audit row', () => {
    const runDir = makeRunDir(FLOW_DIR, 'run-multi-fail');
    appendAudit(runDir, {
      step: 'jd-text', attempt: 1, class: 'hitl', verdict: 'not-done', gap: 'an EARLIER, superseded-by-later-failure gap', usd: 0.01, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    });
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'the LATEST gap, and the one that should show', usd: 0.01, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    });
    // no log.json at all — a died-with-partial-audit shape; no history row either.
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-multi-fail', catalogue: CATALOGUE,
    });
    assert.match(detail.stopReason, /resume-summary/);
    assert.match(detail.stopReason, /the LATEST gap/);
    assert.doesNotMatch(detail.stopReason, /EARLIER/);
  });

  test('M4a piece 3 fix #5: wallMs comes straight from the history row, never invented', () => {
    const done = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(done.wallMs, 720);
    assert.equal(done.wallMsWhy, null);

    const died = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-died', catalogue: CATALOGUE,
    });
    assert.equal(died.wallMs, null);
    assert.match(died.wallMsWhy, /no history row/);
  });

  test('M4a piece 3 fix #6 re-walk: an ask (hitl) step\'s own paused-then-resolved pair never gets a reject-boundary label', () => {
    // The EXACT shape the coordinator's re-walk found (job2-live-1/m3-live-2,
    // step "resume-summary-approved"): (1 paused), (1 red = the reject),
    // (2 paused), (2 green = accepted). Nothing here is a "restart" — it's
    // one attempt (park + its own resolution), twice. Labelling either row
    // was the exact bug: the fix must never fire on a hitl-classed step.
    const runDir = makeRunDir(FLOW_DIR, 'run-ask-pause-reject-shape');
    for (const row of [
      {
        step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      },
      {
        step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'red', gap: 'shorter work history blurb', usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      },
      {
        step: 'resume-summary-approved', attempt: 2, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      },
      {
        step: 'resume-summary-approved', attempt: 2, class: 'hitl', verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      },
    ]) appendAudit(runDir, row);
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-ask-pause-reject-shape', catalogue: CATALOGUE,
    });
    const step = detail.steps.find((s) => s.emits === 'resume-summary-approved');
    assert.equal(step.attempts.length, 4);
    for (const a of step.attempts) assert.equal(a.afterReject, null, `attempt ${a.attempt}/${a.verdict} must not carry a boundary label`);
    // browser re-walk bug #2: this exact paused/reject/paused/accept shape
    // (4 audit rows) is 2 asks shown to the human, never 4 — a pause row
    // and its very next resolution row are the SAME try.
    assert.equal(step.tryCount, 2);
  });

  test('browser re-walk bug #2: a model step\'s tryCount is its attempt count (4 drafts), unlike an ask step', () => {
    const runDir = makeRunDir(FLOW_DIR, 'run-model-tries');
    for (let i = 1; i <= 4; i += 1) {
      appendAudit(runDir, {
        step: 'resume-summary', attempt: i, class: 'softgreen', verdict: i < 4 ? 'not-done' : 'green', gap: i < 4 ? 'missing a section' : null, usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
      });
    }
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-model-tries', catalogue: CATALOGUE,
    });
    const step = detail.steps.find((s) => s.emits === 'resume-summary');
    assert.equal(step.attempts.length, 4);
    assert.equal(step.tryCount, 4);
  });

  test('M4a piece 3 fix #6: a NON-ask step\'s genuine attempt-number restart after an interleaved human reject IS labelled', () => {
    const runDir = makeRunDir(FLOW_DIR, 'run-real-reject-restart');
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'missing a section, scrubbed', usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    });
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    });
    // the ask step parks, then the human rejects — interleaved between the
    // two "attempt 2" rows on resume-summary.
    appendAudit(runDir, {
      step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
    });
    appendAudit(runDir, {
      step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'red', gap: 'shorter work history blurb', usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
    });
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false,
    });
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-real-reject-restart', catalogue: CATALOGUE,
    });
    const step = detail.steps.find((s) => s.emits === 'resume-summary');
    assert.equal(step.attempts.length, 3);
    assert.equal(step.attempts[0].afterReject, null);
    assert.equal(step.attempts[1].afterReject, null);
    assert.equal(step.attempts[2].afterReject, 'shorter work history blurb');
  });

  test('hamr review #1: model + spend.jsonl totals are filled from run-done\'s own rows', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(detail.model, 'deepseek-flash');
    assert.equal(detail.modelWhy, null);
    assert.equal(detail.spendSummary.empty, false);
    assert.equal(detail.spendSummary.rounds, 2);
    assert.equal(detail.spendSummary.tokensIn, 300);
    assert.equal(detail.spendSummary.tokensOut, 130);
    assert.equal(detail.spendSummary.cacheReadTokens, 15);
  });

  test('hamr review #1: a run with no spend.jsonl rows and no model call reports why, never a made-up value', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-died', catalogue: CATALOGUE,
    });
    assert.equal(detail.model, null);
    assert.match(detail.modelWhy, /no audit.jsonl row/);
    assert.equal(detail.spendSummary.empty, true);
  });

  test('browser re-walk bug #4: getRunDetail also carries askedAt for a parked run with an open ask, distinct from outcomeWhy', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-waiting', catalogue: CATALOGUE,
    });
    assert.equal(detail.at, null);
    assert.equal(detail.askedAt, '2026-09-25T00:00:00.000Z');
    assert.equal(detail.atWhy, null);
    // outcomeWhy is a SEPARATE book fact (this run truly has no outcome
    // yet) — it must stay, but never leak into the date field's own why.
    assert.match(detail.outcomeWhy, /no history row/);
  });

  test('an unknown run returns null (caller renders 404)', () => {
    assert.equal(getRunDetail({
      root: ROOT, flow: FLOW, runId: 'no-such-run', catalogue: CATALOGUE,
    }), null);
  });

  test('negative (v): a path-escape runId resolves to null, nothing read', () => {
    assert.equal(getRunDetail({
      root: ROOT, flow: FLOW, runId: '../../../../etc', catalogue: CATALOGUE,
    }), null);
    assert.equal(getRunDetail({
      root: ROOT, flow: FLOW, runId: 'a/../../b', catalogue: CATALOGUE,
    }), null);
  });

  test('negative (v): a path-escape flow name resolves to null', () => {
    assert.equal(getRunDetail({
      root: ROOT, flow: '../outside', runId: 'run-done', catalogue: CATALOGUE,
    }), null);
  });
});

describe('getRunAudit', () => {
  test('rows are scoped to exactly this run\'s own audit.jsonl', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    assert.equal(result.rows.length, 5);
    assert.ok(result.rows.every((r) => ['resume-text', 'jd-text', 'resume-summary', 'resume-summary-approved', 'resume-summary-output'].includes(r.step)));
  });

  test('an empty audit.jsonl carries a why, never a bare empty array', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-died' });
    assert.equal(result.empty, true);
    assert.ok(result.why && result.why.length > 0);
  });

  test('negative (v): a path-escape runId returns null', () => {
    assert.equal(getRunAudit({ root: ROOT, flow: FLOW, runId: '..' }), null);
  });

  test('hamr review #6: every row carries a server-derived action, never "unknown action"', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    const summaryRow = result.rows.find((r) => r.step === 'resume-summary');
    assert.equal(summaryRow.action, 'model call (deepseek-flash)');
    const approvedRow = result.rows.find((r) => r.step === 'resume-summary-approved');
    assert.equal(approvedRow.action, 'human');
    for (const r of result.rows) assert.notEqual(r.action, 'unknown action');
  });

  test('hamr review #1: no tool-call-count field on any row — no fwdloop book has one', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    for (const r of result.rows) {
      assert.equal(Object.prototype.hasOwnProperty.call(r, 'toolCalls'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(r, 'toolCallCount'), false);
    }
  });
});

describe('getRunJob', () => {
  test('signed prose lines, arbiter block, and signature come from readFlow', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(job.resolved, true);
    assert.ok(Array.isArray(job.lines) && job.lines.length === 5);
    assert.equal(job.arbiter.capUsd, 0.25);
    assert.equal(typeof job.arbiter.redoCap, 'number'); // this fixture names no explicit "redo cap" line — the signed default applies
    assert.ok(Array.isArray(job.arbiter.asks) && job.arbiter.asks.length === 1);
    assert.equal(job.arbiter.asks[0].line, 4);
    assert.ok(Array.isArray(job.arbiter.sends) && job.arbiter.sends.length === 1);
    assert.ok(Array.isArray(job.arbiter.sources) && job.arbiter.sources.length === 2);
    assert.equal(job.signature.signedBy, SIGNED_BY);
    assert.equal(job.signature.signedAt, SIGNED_AT);
    assert.ok(job.signature.hash && job.signature.hash.length > 0);
  });

  test('hamr review #7: the Job tab carries the model, read from this run\'s own audit.jsonl rows', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(job.model, 'deepseek-flash');
    assert.equal(job.modelWhy, null);
  });

  test('hamr review #7: a run with no model call names why, never a made-up model', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-died', catalogue: CATALOGUE,
    });
    assert.equal(job.model, null);
    assert.match(job.modelWhy, /no audit.jsonl row/);
  });

  test('every run under one flow reads the SAME signed job (one signature.json per flow)', () => {
    const a = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    const b = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-failed', catalogue: CATALOGUE,
    });
    assert.equal(a.signature.hash, b.signature.hash);
  });
});

describe('listStops (M4a-1: every stop across every flow)', () => {
  const rows = listStops({ root: ROOT });

  test('an open ask (legacy/M2-shape run) shows status "unanswered", open:true, and a real time-left', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-waiting');
    assert.ok(row);
    assert.equal(row.status, 'unanswered');
    assert.equal(row.open, true);
    assert.match(row.question, /Does this look right/);
    assert.match(row.evidence.draft, /fake drafted summary/);
    assert.equal(typeof row.timeLeftMs, 'number');
    assert.ok(row.timeLeftMs > 0);
  });

  test('an already-answered legacy ask is listed as PAST (accepted), never open, and its draft is not invented', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-answered');
    assert.ok(row);
    assert.equal(row.status, 'accepted');
    assert.equal(row.open, false);
    assert.equal(row.timeLeftMs, null);
    assert.equal(row.evidence.draft, null);
    assert.match(row.evidence.why, /draft not kept \(before M4a-1\)/);
    // negative: the question is not invented from the still-on-disk
    // ask.json either — the brief's consumed-answer shape names only
    // askId/decision/reason/answeredAt.
    assert.equal(row.question, null);
  });

  test('a pre-M3 legacy ask (no askId/expiresAt) is shown as "unanswered" with its own why, never crashing the listing', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-legacy');
    assert.ok(row);
    assert.equal(row.status, 'unanswered');
    assert.match(row.why, /pre-M3/);
  });

  test('an M3-shape ask surfaces its unjudged artifact, with both its goal ("step") and its real id ("emits")', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-unjudged');
    assert.ok(row);
    assert.equal(row.evidence.unjudged.length, 1);
    const u = row.evidence.unjudged[0];
    assert.equal(u.emits, 'jd-text');
    assert.match(u.step, /scrubbed goal text/);
    assert.notEqual(u.step, u.emits);
    assert.match(u.text, /an unjudged artifact, scrubbed/);
  });

  test('a run with no ask.json at all is never listed', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-done');
    assert.equal(row, undefined);
  });

  test('M4a-1: an archived run with 2 asks (reject then accept) lists both, paired by askId, correctly statused', () => {
    const own = rows.filter((r) => r.flow === FLOW && r.runId === 'run-archived-2asks');
    assert.equal(own.length, 2);
    const first = own.find((r) => r.askId === 'ask-2a-first');
    const second = own.find((r) => r.askId === 'ask-2a-second');
    assert.ok(first && second);
    assert.equal(first.status, 'rejected');
    assert.match(first.reason, /missing a section/);
    assert.equal(first.evidence.draft, 'first draft under review, scrubbed');
    assert.equal(second.status, 'accepted');
    assert.equal(second.evidence.draft, 'second draft under review, scrubbed');
    assert.ok(first.archived && second.archived);
  });

  test('M4a-1 PROOF (pairing can fail): pairing by index instead of askId would swap first/second\'s statuses', () => {
    // Pins the EXACT value each askId must carry (not just "differs from
    // the other") — see the report for the revert-and-restore proof: a
    // positional pairing (e.g. `normalizeArchivedRow(a, idx, arr)` reading
    // `arr[arr.length - 1 - idx]`) makes this assertion fail red.
    const own = rows.filter((r) => r.flow === FLOW && r.runId === 'run-archived-2asks');
    const byAskId = {};
    own.forEach((r) => { byAskId[r.askId] = r.status; });
    assert.equal(byAskId['ask-2a-first'], 'rejected');
    assert.equal(byAskId['ask-2a-second'], 'accepted');
  });

  test('M4a-1: an archived run\'s own open ask (no consumed answer yet) is "unanswered"/open with time-left, same as the legacy path', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-archived-open');
    assert.ok(row);
    assert.equal(row.status, 'unanswered');
    assert.equal(row.open, true);
    assert.equal(typeof row.timeLeftMs, 'number');
    assert.equal(row.evidence.draft, 'draft still under review, scrubbed');
  });

  test('open stops sort before every past stop', () => {
    const openIdx = [];
    const pastIdx = [];
    rows.forEach((r, i) => { (r.open ? openIdx : pastIdx).push(i); });
    if (openIdx.length && pastIdx.length) {
      assert.ok(Math.max(...openIdx) < Math.min(...pastIdx), 'every open row must sort before every past row');
    }
  });
});

describe('getRunAsks (M4a-1: the Ask tab)', () => {
  test('lists every ask of a run, in askedAt order, re-sorted off the archive\'s own filename order', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-archive-order' });
    assert.ok(result);
    assert.equal(result.asks.length, 2);
    // "z-asked-first" sorts AFTER "a-asked-second" alphabetically, but was
    // asked earlier — the real order must be chronological, not filename.
    assert.equal(result.asks[0].askId, 'z-asked-first');
    assert.equal(result.asks[1].askId, 'a-asked-second');
  });

  test('PROOF (order can fail): sorting by askId (filename order) instead of askedAt would reverse this pair', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-archive-order' });
    const filenameOrder = ['a-asked-second', 'z-asked-first']; // listArchivedAsks's own entries.sort() order
    const actualOrder = result.asks.map((a) => a.askId);
    assert.notDeepEqual(actualOrder, filenameOrder);
  });

  test('a pre-M4a-1 run\'s past ask carries the "why" string, and invents no draft/question', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-answered' });
    assert.ok(result);
    assert.equal(result.asks.length, 1);
    const ask = result.asks[0];
    assert.equal(ask.archived, false);
    assert.equal(ask.evidence.draft, null);
    assert.match(ask.evidence.why, /draft not kept \(before M4a-1\)/);
    assert.equal(ask.question, null);
  });

  test('an open ask carries a real, non-null expiresAt for the client to compute time-left from', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-waiting' });
    const ask = result.asks.find((a) => a.status === 'unanswered');
    assert.ok(ask);
    assert.equal(ask.expiresAt, '2099-01-01T00:00:00.000Z');
  });

  test('an unknown run returns null (caller renders 404)', () => {
    assert.equal(getRunAsks({ root: ROOT, flow: FLOW, runId: 'no-such-run' }), null);
  });

  test('negative (v): a path-escape runId resolves to null, nothing read', () => {
    assert.equal(getRunAsks({ root: ROOT, flow: FLOW, runId: '../../../../etc' }), null);
  });
});

// ---------------------------------------------------------------------------
// HTTP shell (src/panel/server.js) — real socket, port 0 (OS-assigned).
// ---------------------------------------------------------------------------

function get(port, urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('panel HTTP shell', () => {
  let handle;

  test('starts on an OS-assigned port bound to 127.0.0.1', async () => {
    handle = await createPanelServer({ port: 0, root: ROOT });
    assert.ok(handle.port > 0);
    assert.notEqual(handle.port, DEFAULT_PORT); // OS-assigned, not the default
  });

  test('DEFAULT_PORT is 4800, not bareloop\'s 4700', () => {
    assert.equal(DEFAULT_PORT, 4800);
  });

  test('GET / serves the panel page', async () => {
    const r = await get(handle.port, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
  });

  test('GET /api/runs lists fixture runs as JSON', async () => {
    const r = await get(handle.port, '/api/runs');
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.ok(Array.isArray(parsed.rows));
    assert.ok(parsed.rows.some((row) => row.flow === FLOW && row.runId === 'run-done' && row.glyph === '[✓]'));
  });

  test('GET /api/runs/:flow/:runId returns the run detail', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/run-done`);
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.glyph, '[✓]');
  });

  test('GET /api/runs/:flow/:runId/audit returns the raw rows', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/run-done/audit`);
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.rows.length, 5);
  });

  test('GET /api/runs/:flow/:runId/job returns the signed job', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/run-done/job`);
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.signature.signedBy, SIGNED_BY);
  });

  test('GET /api/inbox returns every stop (open and past) read-only', async () => {
    const r = await get(handle.port, '/api/inbox');
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.ok(parsed.rows.some((row) => row.runId === 'run-waiting' && row.status === 'unanswered' && row.open === true));
    assert.ok(parsed.rows.some((row) => row.runId === 'run-answered' && row.status === 'accepted' && row.open === false));
  });

  test('GET /api/runs/:flow/:runId/asks returns this run\'s asks in order', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/run-archived-2asks/asks`);
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.asks.length, 2);
    assert.equal(parsed.asks[0].askId, 'ask-2a-first');
    assert.equal(parsed.asks[0].status, 'rejected');
    assert.equal(parsed.asks[1].status, 'accepted');
  });

  test('GET /api/runs/:flow/:runId/asks 404s for an unknown run', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/does-not-exist/asks`);
    assert.equal(r.status, 404);
  });

  test('an unknown run 404s', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/does-not-exist`);
    assert.equal(r.status, 404);
  });

  test('negative (v): a path-escape flow segment never reads outside root', async () => {
    const r = await get(handle.port, '/api/runs/..%2f..%2f..%2fetc/run-done');
    assert.ok(r.status === 400 || r.status === 404);
    assert.doesNotMatch(r.body, /root:x:/); // /etc/passwd's own first line, never leaked
  });

  test('negative (v): a path-escape runId segment never reads outside root', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/..%2f..%2f..%2fetc%2fpasswd`);
    assert.ok(r.status === 400 || r.status === 404);
    assert.doesNotMatch(r.body, /root:x:/);
  });

  test('negative (v): a secret-looking env var never appears in any response', async () => {
    process.env.FWDLOOP_TEST_FAKE_SECRET = 'sk-test-should-never-leak-9f8a7b6c';
    try {
      const responses = await Promise.all([
        get(handle.port, '/'),
        get(handle.port, '/api/runs'),
        get(handle.port, `/api/runs/${FLOW}/run-done`),
        get(handle.port, `/api/runs/${FLOW}/run-done/audit`),
        get(handle.port, `/api/runs/${FLOW}/run-done/job`),
        get(handle.port, `/api/runs/${FLOW}/run-archived-2asks/asks`),
        get(handle.port, '/api/inbox'),
      ]);
      for (const r of responses) {
        assert.doesNotMatch(r.body, /sk-test-should-never-leak-9f8a7b6c/);
      }
    } finally {
      delete process.env.FWDLOOP_TEST_FAKE_SECRET;
    }
  });

  test('negative: a non-GET method is refused with 405 and writes nothing', async () => {
    const before = readdirSync(path.join(FLOW_DIR, 'runs')).length;
    const r = await get(handle.port, '/api/runs', 'POST');
    assert.equal(r.status, 405);
    const after1 = readdirSync(path.join(FLOW_DIR, 'runs')).length;
    assert.equal(after1, before);
  });

  test('DELETE is also refused with 405', async () => {
    const r = await get(handle.port, `/api/runs/${FLOW}/run-done`, 'DELETE');
    assert.equal(r.status, 405);
  });

  test('closes cleanly', async () => {
    await handle.close();
  });
});

describe('createPanelServer refuses without a root', () => {
  test('rejects rather than defaulting to cwd silently', async () => {
    await assert.rejects(() => createPanelServer({ port: 0 }));
  });
});

describe('a taken port fails loudly, never silently retries', () => {
  test('EADDRINUSE surfaces as a rejection naming the port', async () => {
    const first = await createPanelServer({ port: 0, root: ROOT });
    try {
      await assert.rejects(
        () => createPanelServer({ port: first.port, root: ROOT }),
        (err) => {
          assert.equal(err.code, 'EADDRINUSE');
          assert.equal(err.port, first.port);
          return true;
        },
      );
    } finally {
      await first.close();
    }
  });
});

// ---------------------------------------------------------------------------
// index.html — the page itself (M4a piece 3, docs/wiki/the-module-ladder.md,
// "M4a — read-only panel — SIGNED", step 7 cleanup): source-level checks a
// real browser walk would otherwise have to make (no jsdom/browser in this
// stack — the orchestrator does the actual visual/browser check, never this
// agent). These are static text checks against the shipped file, not a DOM
// render.
// ---------------------------------------------------------------------------
describe('index.html — page source', () => {
  const PAGE_PATH = path.join(HERE, '..', 'src', 'panel', 'index.html');
  const source = readFileSync(PAGE_PATH, 'utf8');

  // Strip every comment form the page actually uses (HTML `<!-- -->`, JS
  // `//` line comments, JS `/* */` block comments) before scanning for
  // banned words — the borrowed-from/ADAPTED header (an HTML comment) and
  // this file's own explanatory comments (same posture as server.js's own
  // header, which also says "bareloop" outside its first line) are allowed
  // to name bareloop; live markup/script/UI text is not.
  function stripComments(text) {
    return text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  }

  test('is served at "/" as real HTML', async () => {
    const handle = await createPanelServer({ port: 0, root: ROOT });
    try {
      const r = await get(handle.port, '/');
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /text\/html/);
      assert.match(r.body, /<title>fwdloop panel<\/title>/);
    } finally {
      await handle.close();
    }
  });

  test('no non-GET fetch anywhere on the page — read-only by construction', () => {
    const fetchCalls = source.match(/fetch\([^)]*\)/g) || [];
    assert.ok(fetchCalls.length > 0, 'expected at least one fetch( call to check');
    for (const call of fetchCalls) {
      assert.doesNotMatch(call, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i, `non-GET fetch found: ${call}`);
    }
    // no bare XHR/other request path either.
    assert.doesNotMatch(source, /\.open\(\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });

  test('no bareloop sample strings or bareloop-only words outside comments/header', () => {
    const stripped = stripComments(source);
    const banned = [/bareloop/i, /\bscout\b/i, /fix loop/i, /\bjudge\b/i, /\breplay\b/i, /\bspine\b/i, /\bsidecar\b/i];
    for (const re of banned) {
      assert.doesNotMatch(stripped, re, `banned word ${re} found outside a comment`);
    }
  });

  test('fwdloop glyph/close-class vocabulary is present; bareloop verdict words are not live UI text', () => {
    assert.match(source, /cited/);
    assert.match(source, /shape/);
    assert.match(source, /human check/);
    // never the raw close-class words as USER-FACING text (they still exist
    // as the class values themselves, e.g. `cls === "softgreen"`, which is
    // fine — internal data, not rendered prose).
    assert.doesNotMatch(source, />\s*softgreen\s*</);
  });

  test('cost display never renders a bare "$0" for an unknown spend, and honors "at least" for a floor', () => {
    assert.match(source, /"at least "/);
    assert.doesNotMatch(source, /"\$0"/);
  });

  test('book text (question/draft/unjudged-artifact) is set via textContent, never interpolated into innerHTML', () => {
    const innerHtmlLines = source.split('\n').filter((l) => l.includes('.innerHTML'));
    for (const line of innerHtmlLines) {
      assert.doesNotMatch(line, /row\.question|evidence\.draft|u\.artifact|\.artifact\.text|ask\.question/, `book text reached innerHTML: ${line.trim()}`);
    }
    // M4a-1: both the Inbox stop rows and the Ask tab route book text
    // through `textDiv` (a plain `d.textContent = text` helper), never a
    // string built into innerHTML — the stop row's question, the Ask tab's
    // question label, the draft box, and each unjudged artifact box.
    assert.match(source, /textDiv\("step-meta", "question: " \+ row\.question\)/);
    assert.match(source, /textDiv\("wf-name", qText\)/);
    assert.match(source, /draftEl\.textContent = evidence\.draft/);
    assert.match(source, /art\.textContent = /);
  });

  test('every empty state names why (no bare "unknown" with no explanation path)', () => {
    assert.match(source, /no runs listed yet/);
    assert.match(source, /nothing waiting on you/);
    assert.match(source, /not attempted yet/);
  });

  // M4a piece 3 follow-up (coordinator's browser walk against real flows/):
  // fixes #2/#3/#4 are all checkable statically — the exact banned/required
  // strings a real browser walk found wrong or right.
  test('fix #2/#3: no "verdict green"/"verdict red"/"verdict paused" — a plain word replaces the raw verdict everywhere', () => {
    assert.doesNotMatch(source, /"verdict "/);
    assert.match(source, /paused for you/);
    assert.match(source, /rejected by you/);
  });

  test('fix #4: the map legend pairs each word with the scope-correct glyph — [·] waiting on you, no dot at all for "not started"', () => {
    assert.match(source, /<span class="dot"><\/span>waiting on you/);
    assert.match(source, /<span>not started<\/span>/);
    // never the OLD (wrong) pairing this fix replaced.
    assert.doesNotMatch(source, /dot amber"><\/span>waiting on you/);
    assert.doesNotMatch(source, /dot grey"><\/span>not started/);
  });

  test('fix #6: a step\'s attempt-numbering boundary after a human reject is labelled, never silently renumbered, and never guessed when it can\'t be named', () => {
    assert.match(source, /after reject: /);
    assert.match(source, /a\.afterReject/);
    // no generic/vague fallback label — a missing hint beats a wrong one
    // (the re-walk found the OLD generic fallback mislabelling the ask
    // step's own normal paused-then-resolved pair as a "reject boundary").
    assert.doesNotMatch(source, /a new attempt count starts here/);
  });

  test('fix #5: header date is human-readable (toLocaleString), never a raw ISO string alone; "took Xs" comes from wallMs', () => {
    assert.match(source, /readableDateTime/);
    assert.match(source, /toLocaleString/);
    assert.match(source, /detail\.wallMs/);
  });

  test('fix #7: the runs-list meta line does not truncate at phone width', () => {
    assert.match(source, /\.wf-meta-line\{white-space:normal;overflow:visible;text-overflow:clip;\}/);
  });

  // hamr's 2026-09-27 review items #1-#7.
  test('review #1: the Summary box shows model, close class(es), and spend.jsonl totals, never a made-up tool-call count', () => {
    assert.match(source, /data-testid="summary-model"/);
    assert.match(source, /data-testid="summary-close"/);
    assert.match(source, /data-testid="summary-spend"/);
    assert.match(source, /closeClassSummaryText/);
    assert.match(source, /spendSummaryText/);
    assert.match(source, /cache-read/);
    // no fwdloop book records tool-call counts — never rendered as 0 or
    // "unknown" as LIVE UI text (comments discussing bareloop's dropped
    // per-round tool-call rows are fine, same posture as the bareloop-word
    // check above).
    assert.doesNotMatch(stripComments(source), /tool.?calls?/i);
  });

  test('review #2: a map/step title shows a "try N" count when a step has more than one attempt', () => {
    assert.match(source, /try /);
  });

  test('review #3: map boxes are compact (never stretched to fill the full available width) and centered', () => {
    assert.match(source, /\.map-box\{[^}]*text-align:center/);
  });

  test('review #4: clicking a map node or a step card switches to the Audit tab and scrolls to that step\'s group', () => {
    assert.match(source, /openAuditGroup/);
    assert.match(source, /tab-audit["']\)\.click\(\)/);
  });

  test('review #5/#6: the Audit tab has a Grouped/Flat toggle and the column order Attempt \\| Step \\| Action \\| Gap \\| Cost \\| Verdict \\| Close', () => {
    assert.match(source, /audit-view-grouped/);
    assert.match(source, /audit-view-flat/);
    assert.match(source, /<th>Attempt<\/th><th>Step<\/th><th>Action<\/th><th>Gap<\/th><th>Cost<\/th><th>Verdict<\/th><th>Close<\/th>/);
  });

  test('review #6: Action is derived server-side (row.action), never a client-side "unknown action" guess', () => {
    assert.match(source, /r\.action/);
    assert.doesNotMatch(stripComments(source), /"unknown action"/);
  });

  test('review #8: the unjudged artifact renderer reads u.text, never a nonexistent u.artifact.text', () => {
    assert.match(source, /u\.text/);
    assert.doesNotMatch(stripComments(source), /u\.artifact/);
  });

  test('review #9: the unjudged label prefers u.emits (the real step id), falling back to u.step only when emits is absent', () => {
    assert.match(source, /u\.emits/);
    assert.match(source, /typeof u\.emits === "string" && u\.emits\.length > 0 \? u\.emits : u\.step/);
  });

  test('review #7: the Job tab shows the model name, and the cap row is first in the arbiter block', () => {
    assert.match(source, /details-model/);
    var capIdx = source.indexOf('id="details-cap-money"');
    var redoIdx = source.indexOf('id="details-redo-cap"');
    var asksIdx = source.indexOf('id="details-asks"');
    assert.ok(capIdx > 0 && redoIdx > capIdx && asksIdx > redoIdx, 'cap must render before redo cap/asks in the arbiter block');
  });

  // browser re-walk (2026-09-27), bugs #1-#4.
  test('re-walk #1: a map node\'s title never carries the per-attempt list (that lives on the step card below) — only number/name/try N', () => {
    assert.doesNotMatch(source, /function attemptsInlineText/);
    var stepTitleFn = source.slice(source.indexOf('function stepTitleText'), source.indexOf('function stepTitleText') + 400);
    assert.doesNotMatch(stepTitleFn, /attemptsInlineText/);
  });

  test('re-walk #4: the run header\'s date never borrows outcomeWhy, and shows a parked run\'s own askedAt when the books hold one', () => {
    assert.doesNotMatch(source, /detail\.at \? readableDateTime\(detail\.at\) : \(detail\.outcomeWhy/);
    assert.match(source, /detail\.askedAt \? "asked " \+ readableDateTime\(detail\.askedAt\)/);
    assert.match(source, /r\.askedAt \? "asked " \+ readableDateTime\(r\.askedAt\)/);
  });

  test('re-walk #3: a grouped audit header\'s cost only says "at least" when some row in the group is spendComplete:false, never the inverse', () => {
    // the exact bug: `money(sum, partial)` where `partial` is "some row
    // incomplete" (true => at-least) but money's own 2nd arg means "this
    // row's own spendComplete" (false => at-least) — an all-complete group
    // (partial === false) then satisfied money's `=== false` check and
    // printed "at least" on every group, regardless of the real rows.
    assert.match(source, /money\(sum, !partial\)/);
    assert.doesNotMatch(source, /money\(sum, partial\)/);
  });

  // ---------------------------------------------------------------------
  // M4a-1: the Ask tab (right pane, after Job) + the Inbox-as-stops-list
  // (left pane). Static source checks — the orchestrator does the real
  // browser/visual check.
  // ---------------------------------------------------------------------
  test('M4a-1: an "Ask" tab exists in the right pane, positioned after "Job"', () => {
    assert.match(source, /id="tab-ask"[^>]*>Ask<\/button>/);
    const jobIdx = source.indexOf('id="tab-details"');
    const askIdx = source.indexOf('id="tab-ask"');
    assert.ok(jobIdx > 0 && askIdx > jobIdx, 'the Ask tab button must come after the Job ("tab-details") tab button');
    const jobPanelIdx = source.indexOf('id="panel-details"');
    const askPanelIdx = source.indexOf('id="panel-ask"');
    assert.ok(jobPanelIdx > 0 && askPanelIdx > jobPanelIdx, 'the Ask panel section must come after the Job panel section');
  });

  test('M4a-1: no <button> or <input> element anywhere inside the Ask panel (no answer controls — M4b)', () => {
    const start = source.indexOf('<section id="panel-ask"');
    assert.ok(start > 0, 'panel-ask section not found');
    // No <section> nests inside another in this page — the first </section>
    // after the opening tag is this section's own close.
    const end = source.indexOf('</section>', start);
    assert.ok(end > start, 'could not find the closing </section> for panel-ask');
    const panelAskHtml = stripComments(source.slice(start, end));
    assert.doesNotMatch(panelAskHtml, /<button/i, 'a <button> was found inside the Ask panel — M4a-1 is read-only, no answer controls until M4b');
    assert.doesNotMatch(panelAskHtml, /<input/i, 'an <input> was found inside the Ask panel — M4a-1 is read-only, no answer controls until M4b');
    // The empty slot for M4b's future controls is built by script (the Ask
    // panel's static markup carries no fixed answer area at all — it's
    // rendered per-ask) — check the whole page source for it, named.
    assert.match(source, /data-testid", "ask-answer-slot"/);
  });

  test('M4a-1: the Ask tab\'s collapse/expand toggle is a div with role="button", never a real <button> element', () => {
    assert.match(source, /head\.setAttribute\("role", "button"\)/);
  });

  test('M4a-1: clicking an Inbox stop selects its run, switches to the Ask tab, and passes the ask\'s id to focus', () => {
    assert.match(source, /selectRun\(row\.flow, row\.runId, wrap, "\.inbox-row", row\.askId\)/);
    assert.match(source, /document\.getElementById\("tab-ask"\)\.click\(\)/);
  });

  test('M4a-1: the Inbox tab label shows the open-stop count', () => {
    assert.match(source, /inbox-count-label/);
    assert.match(source, /openCount > 0 \? \(" \(" \+ openCount \+ "\)"\) : ""/);
  });

  test('M4a-1: status vocabulary used in the Inbox/Ask UI is exactly the books\' own words — never a second, made-up vocabulary', () => {
    assert.match(source, /"accepted"/);
    assert.match(source, /"rejected"/);
    assert.match(source, /"reran"/);
    assert.match(source, /"expired"/);
    assert.match(source, /"unanswered"/);
    // the OLD (pre-M4a-1) vocabulary this replaces must not survive as live UI text.
    assert.doesNotMatch(stripComments(source), /"legacy"|"unreadable"/);
  });
});
