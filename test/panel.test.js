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
  computeGlyph, costDisplay, listRuns, getRunDetail, getRunAudit, getRunJob, listInbox,
} from '../src/panel/data.js';

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
//     artifact, to prove the Inbox surfaces it labelled by step. -----------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-unjudged');
  writeJson(runDir, 'ask.json', {
    askId: 'ask-unjudged-1',
    question: 'Check the draft (scrubbed test question)',
    askedAt: '2026-09-25T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: {
      artifact: { text: 'the draft under review, scrubbed' },
      unjudged: [{ step: 'jd-text', artifact: { text: 'an unjudged artifact, scrubbed' } }],
    },
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

describe('listInbox', () => {
  const rows = listInbox({ root: ROOT });

  test('an open ask (M2-shape evidence) shows question + draft', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-waiting');
    assert.equal(row.status, 'open');
    assert.match(row.question, /Does this look right/);
    assert.match(row.evidence.draft, /fake drafted summary/);
  });

  test('an already-answered ask is never listed as open', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-answered');
    assert.equal(row, undefined);
  });

  test('a legacy (pre-M3) ask shows status "legacy", never "open"', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-legacy');
    assert.ok(row);
    assert.equal(row.status, 'legacy');
    assert.notEqual(row.status, 'open');
  });

  test('an M3-shape ask surfaces its unjudged artifact, labelled by step', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-unjudged');
    assert.equal(row.evidence.unjudged.length, 1);
    assert.equal(row.evidence.unjudged[0].step, 'jd-text');
  });

  test('a run with no ask.json at all is never listed', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-done');
    assert.equal(row, undefined);
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

  test('GET /api/inbox returns open asks read-only', async () => {
    const r = await get(handle.port, '/api/inbox');
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.ok(parsed.rows.some((row) => row.runId === 'run-waiting' && row.status === 'open'));
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
      assert.doesNotMatch(line, /row\.question|evidence\.draft|u\.artifact|\.artifact\.text/, `book text reached innerHTML: ${line.trim()}`);
    }
    assert.match(source, /q\.textContent = "question: " \+ row\.question/);
    assert.match(source, /draftEl\.textContent = row\.evidence\.draft/);
    assert.match(source, /art\.textContent = /);
  });

  test('every empty state names why (no bare "unknown" with no explanation path)', () => {
    assert.match(source, /no runs listed yet/);
    assert.match(source, /nothing waiting on you/);
    assert.match(source, /not attempted yet/);
  });
});
