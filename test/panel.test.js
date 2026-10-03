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
  mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync, readdirSync, existsSync, symlinkSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow, appendAudit, appendHistory } from '../src/index.js';
import { loadCatalogue } from '../src/catalogue.js';
import { createPanelServer, DEFAULT_PORT } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import {
  computeGlyph, costDisplay, listRuns, getRunDetail, getRunAudit, getRunJob, listStops, getRunAsks,
  deriveRunModel, deriveAuditAction, summarizeSpendRows, deriveAuditTokensDisplay, deriveAuditAtWhy,
  isBlockedVerdict, deriveStepTryMarks, deriveStepGroupState, deriveAuditGroups, deriveAskStepInfo,
  deriveStepSuccessText, deriveAuditToolsPhrase,
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
      step: 'resume-text', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T13:52:04.000Z', tokens: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0 }, tools: {},
    },
    {
      step: 'jd-text', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T13:52:05.000Z', tokens: { inputTokens: 110, outputTokens: 25, cacheReadTokens: 0 }, tools: {},
    },
    {
      step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 500, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T13:52:06.000Z', tokens: { inputTokens: 300, outputTokens: 130, cacheReadTokens: 15 }, tools: {},
    },
    {
      step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0, spendComplete: true, wallMs: 10, model: null, modelMatch: null, strike: false, at: '2026-09-24T13:52:06.500Z', tokens: null, tools: null, unjudgedCount: 0,
    },
    {
      step: 'resume-summary-output', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: 0, spendComplete: true, wallMs: 10, model: null, modelMatch: null, strike: false, at: '2026-09-24T13:52:07.000Z', tokens: null, tools: null,
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
    step: 'jd-text', attempt: 1, class: 'hitl', verdict: 'not-done', gap: 'the JD could not be read — scrubbed test gap text', usd: 0.05, spendComplete: true, wallMs: 3000, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T15:24:13.283Z', tokens: { inputTokens: 400, outputTokens: 0, cacheReadTokens: 0 }, tools: {},
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
    step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'missing a required section, scrubbed test gap', usd: 0.001, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-26T05:56:29.500Z', tokens: { inputTokens: 150, outputTokens: 60, cacheReadTokens: 0 }, tools: {},
  });
  appendAudit(runDir, {
    step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 400, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-26T05:56:30.000Z', tokens: { inputTokens: 300, outputTokens: 130, cacheReadTokens: 15 }, tools: {},
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
    step: 'resume-text', attempt: 1, class: 'hitl', verdict: 'hitl', gap: null, usd: null, spendComplete: false, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T23:59:59.000Z', tokens: { inputTokens: 90, outputTokens: 20, cacheReadTokens: 0 }, tools: {},
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

// --- run-waiting-after-earlier-gap: hamr's 2026-09-27 browser-walk bug #1 —
//     the EXACT shape found live: a step failed once, redid, and passed
//     BEFORE the run went on to park on its own ask. The Summary "why" must
//     show the open ask's own question, never that superseded earlier gap. -
{
  const runDir = makeRunDir(FLOW_DIR, 'run-waiting-after-earlier-gap');
  appendAudit(runDir, {
    step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'no line is exactly the heading, scrubbed test gap', usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-27T03:00:00.000Z', tokens: { inputTokens: 80, outputTokens: 20, cacheReadTokens: 0 }, tools: {},
  });
  appendAudit(runDir, {
    step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-27T03:00:01.000Z', tokens: { inputTokens: 150, outputTokens: 60, cacheReadTokens: 0 }, tools: {},
  });
  writeJson(runDir, 'ask.json', {
    askId: 'ask-waiting-2',
    question: 'Does this later draft look right? (scrubbed test question)',
    askedAt: '2026-09-27T03:00:02.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
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

// --- run-pre-m4a2-audit: a real pre-Amendment-M4a-2 audit row, written
//     RAW to audit.jsonl (bypassing appendAudit, which would refuse it) —
//     old rows like this genuinely exist on disk from before M4a-2 landed,
//     and the panel's "not recorded (before M4a-2)" display must be proven
//     against an actual old-shape row, never a fixture built through the
//     new, stricter writer. -------------------------------------------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-pre-m4a2-audit');
  appendFileSync(path.join(runDir, 'audit.jsonl'), `${JSON.stringify({
    step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'green', gap: null, usd: 0.0026, spendComplete: true, wallMs: 8200, model: 'deepseek-flash', modelMatch: 'match', strike: false,
  })}\n`);
}

// --- run-legacy: an M2-era ask.json (no askId/expiresAt) — shown as
//     "legacy", never "open" in the Inbox. ---------------------------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-legacy');
  writeJson(runDir, 'ask.json', { question: 'a pre-M3 legacy ask, scrubbed', askedAt: '2026-09-01T00:00:00.000Z' });
}

// --- run-ended-legacy-ask: hamr's 2026-09-27 live check, the EXACT shape
//     job2-live-1's run-1/run-2 hit — an M2-era run that ENDED clean (a real
//     history row) but still has its stale, single-slot `ask.json` sitting
//     on disk (no askId — the last thing that ask.json ever held), the SAME
//     ask already answered under a timestamp-named consumed marker
//     (`answer.<stamp>.consumed.json`), PLUS a never-applied `answer.json`
//     (a reject that arrived too late to matter — run-1's own shape) and a
//     quarantined `answer.stale.1.json` (run-2's own shape). None of the
//     three leftover files may ever be read back as "this run still has an
//     open, unanswered stop" — the run is over, and the one real decision
//     is already the consumed-marker row. -----------------------------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-ended-legacy-ask');
  writeJson(runDir, 'ask.json', { question: 'an M2-era ask, scrubbed, already resolved before the run ended', askedAt: '2026-09-10T00:00:00.000Z' });
  writeJson(runDir, 'answer.2026-09-10T00-10-00-000Z.consumed.json', {
    decision: 'accept', answeredAt: '2026-09-10T00:10:00.000Z',
  });
  // A reject that never got applied (run-1's own shape) — still named
  // `answer.json` (never renamed to `.consumed.json`), so the run finished
  // without ever consuming it.
  writeJson(runDir, 'answer.json', { decision: 'reject', reason: 'arrived too late, scrubbed', answeredAt: '2026-09-10T00:09:00.000Z' });
  // A quarantined stale answer (run-2's own shape, src/ask.js's own
  // `answer.stale.<n>.json` naming).
  writeJson(runDir, 'answer.stale.1.json', { decision: 'accept', answeredAt: '2026-09-09T23:00:00.000Z' });
  appendHistory(FLOW_DIR, {
    runId: 'run-ended-legacy-ask', at: '2026-09-10T00:11:00.000Z', outcome: 'complete', spentUsd: 0.001, spendComplete: true, capUsd: 0.25, wallMs: 500, signatureHash: 'deadbeef',
  });
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

// --- run-parked-expired: hamr's 2026-09-27 browser-walk bug #3 — a parked,
//     unanswered ask whose own expiresAt is already past, never resumed, no
//     history row. The runs list/header glyph must agree with the Inbox
//     (which already reports this correctly as "expired") instead of
//     showing [·] "waiting on you" for something nobody can still answer. -
{
  const runDir = makeRunDir(FLOW_DIR, 'run-parked-expired');
  writeJson(runDir, 'ask.json', {
    askId: 'ask-expired-1',
    question: 'This one timed out, scrubbed test question',
    askedAt: '2020-01-01T00:00:00.000Z',
    expiresAt: '2020-01-01T01:00:00.000Z', // long past — real, not a future-dated test flake
    evidence: { text: 'a fake drafted summary, scrubbed' },
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

// --- run-archived-open-but-ended: the genuine-anomaly shape listStops's own
//     `!hasHistoryRow` backstop exists for — an ARCHIVED ask left "open"
//     (no consumed answer) on a run whose history.jsonl nonetheless carries
//     a row (belt-and-braces: `legacyRunAsks`'s own guard only covers the
//     pre-M4a-1 fallback path, not the archived one) — hamr's 2026-09-27
//     live check's own rule is general ("a run with a history row never has
//     an open/unanswered stop"), so this must never count as open either. --
{
  const runDir = makeRunDir(FLOW_DIR, 'run-archived-open-but-ended');
  writeAskArchive({
    runDir,
    askId: 'ask-archived-anomaly-1',
    question: 'an archived ask left open on a run that somehow still ended, scrubbed',
    askedAt: '2026-09-26T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: { artifact: { text: 'draft, scrubbed' }, unjudged: [] },
  });
  appendHistory(FLOW_DIR, {
    runId: 'run-archived-open-but-ended', at: '2026-09-26T00:05:00.000Z', outcome: 'complete', spentUsd: 0.001, spendComplete: true, capUsd: 0.25, wallMs: 300, signatureHash: 'deadbeef',
  });
}

// --- run-ask-steps: hamr's 2026-09-27 exit-check review #3 — TWO archived
//     asks whose own "paused" audit row names a REAL declared step
//     (job2-fixture's own `resume-text` at fromLine 1, `resume-summary-
//     approved` at fromLine 4), in the SAME chronological order as the asks
//     themselves. Proves `getRunAsks`'s index/total ("N of M") and
//     stepName/stepLine (`deriveAskStepInfo`'s positional pairing).
{
  const runDir = makeRunDir(FLOW_DIR, 'run-ask-steps');
  appendAudit(runDir, {
    step: 'resume-text', attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T10:00:00.000Z', tokens: null, tools: null, unjudgedCount: 0,
  });
  writeAskArchive({
    runDir,
    askId: 'ask-steps-1',
    question: 'Is the resume text right? (scrubbed)',
    askedAt: '2026-09-27T10:00:00.000Z',
    expiresAt: '2026-09-27T11:00:00.000Z',
    evidence: { artifact: { text: 'resume text draft, scrubbed' }, unjudged: [] },
  });
  writeJson(runDir, 'answer.ask-steps-1.consumed.json', {
    askId: 'ask-steps-1', decision: 'accept', answeredAt: '2026-09-27T10:05:00.000Z',
  });
  appendAudit(runDir, {
    step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T10:10:00.000Z', tokens: null, tools: null, unjudgedCount: 0,
  });
  writeAskArchive({
    runDir,
    askId: 'ask-steps-2',
    question: 'Is the summary right? (scrubbed)',
    askedAt: '2026-09-27T10:10:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: { artifact: { text: 'summary draft, scrubbed' }, unjudged: [] },
  });
}

// --- run-ask-steps-mismatch: an archive with ONE ask but ZERO "paused"
//     audit rows — the positional-pairing counts disagree, so step/line
//     must come back null with a stated why, never a guess. -------------
{
  const runDir = makeRunDir(FLOW_DIR, 'run-ask-steps-mismatch');
  writeAskArchive({
    runDir,
    askId: 'ask-mismatch-1',
    question: 'no matching paused row exists for this one (scrubbed)',
    askedAt: '2026-09-27T11:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    evidence: { artifact: { text: 'draft, scrubbed' }, unjudged: [] },
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

  test('hamr 2026-09-27 browser-walk bug #3: a parked, unanswered ask whose own expiresAt is already past is [!] "ask expired, not resumed yet" — never [·] waiting, never [✗], never [?]', () => {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a', expiresAt: '2020-01-01T00:00:00.000Z' }, consumedAnswerExists: false, hasStateJson: true,
    });
    assert.equal(g.glyph, '[!]');
    assert.match(g.label, /ask expired, not resumed yet/);
    assert.notEqual(g.glyph, '[·]');
    assert.notEqual(g.glyph, '[✗]');
    assert.notEqual(g.glyph, '[?]');
  });

  test('a parked, unanswered ask whose expiresAt is still in the future stays [·] "waiting on you" — the expiry check is a real comparison, not a guess', () => {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a', expiresAt: '2099-01-01T00:00:00.000Z' }, consumedAnswerExists: false, hasStateJson: true,
    });
    assert.equal(g.glyph, '[·]');
    assert.match(g.label, /waiting on you/);
  });

  test('an ANSWERED (not-yet-resumed) ask past its own expiresAt still reads "answered, not resumed yet", never [!] — expiry only matters while nobody has answered yet', () => {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a', expiresAt: '2020-01-01T00:00:00.000Z' }, consumedAnswerExists: true, hasStateJson: true,
    });
    assert.equal(g.glyph, '[·]');
    assert.match(g.label, /answered, not resumed yet/);
  });

  test('PROOF (bug #3 can fail): reverting to the pre-fix computeGlyph (no expiresAt check at all) would show the expired-ask case above as [·] waiting on you', () => {
    const g = computeGlyph({
      historyRow: null, askJson: { askId: 'a', expiresAt: '2020-01-01T00:00:00.000Z' }, consumedAnswerExists: false, hasStateJson: true,
    });
    assert.notEqual(g.glyph, '[·]');
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

describe('deriveAuditAction (hamr review #6, tightened by hamr\'s 2026-09-27 live check: exactly "model call" / "human" / "no model call")', () => {
  test('a row with a model is "model call" — no model name in this column', () => {
    assert.equal(deriveAuditAction({ verdict: 'green', model: 'deepseek-flash', class: 'softgreen' }), 'model call');
  });

  test('an ask-slot row (carries unjudgedCount) is "human" — paused, and every one of the human\'s own accept/reject/rerun/refused answers', () => {
    assert.equal(deriveAuditAction({
      verdict: 'paused', model: null, class: 'hitl', unjudgedCount: 0,
    }), 'human');
    assert.equal(deriveAuditAction({
      verdict: 'green', model: null, class: 'hitl', unjudgedCount: 2,
    }), 'human');
    assert.equal(deriveAuditAction({
      verdict: 'red', model: null, class: 'hitl', unjudgedCount: 0,
    }), 'human');
    assert.equal(deriveAuditAction({
      verdict: 'refused', model: null, class: 'hitl', unjudgedCount: 0,
    }), 'human');
  });

  test('THE BUG THIS FIXES: a non-ask hitl step (e.g. a write step — hitl class, no model, NOT bound to the signed ask line) is "no model call", never "human" — class alone can\'t tell them apart, only unjudgedCount can', () => {
    assert.equal(deriveAuditAction({ verdict: 'hitl', model: null, class: 'hitl' }), 'no model call');
    assert.equal(deriveAuditAction({ verdict: 'green', model: null, class: 'hitl' }), 'no model call');
  });

  test('a mechanical row with no model, no unjudgedCount, and no hitl class is also "no model call" — never invented, never "unknown action"', () => {
    assert.equal(deriveAuditAction({ verdict: 'not-done', model: null, class: 'softgreen' }), 'no model call');
    assert.equal(deriveAuditAction({ verdict: 'cap-halt', model: null, class: null }), 'no model call');
  });

  test('PROOF (this can fail): keying off row.class === "hitl" instead of unjudgedCount (the old, buggy rule) would mislabel the write-step row above as "human"', () => {
    const writeStepRow = { verdict: 'hitl', model: null, class: 'hitl' };
    assert.notEqual(deriveAuditAction(writeStepRow), 'human');
  });
});

describe('deriveAuditTokensDisplay (hamr review 2026-09-27 item c: the Cost cell token phrase)', () => {
  test('a real (post-M4a-2) model-call row sums input+output+cacheRead into one total', () => {
    const d = deriveAuditTokensDisplay({
      model: 'deepseek-flash', at: '2026-09-27T00:00:00.000Z', tokens: { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 48 },
    });
    assert.deepEqual(d, { kind: 'total', total: 2448 });
  });

  test('a pre-M4a-2 row (no "tokens" key at all) is "not-recorded", never a made-up 0', () => {
    const d = deriveAuditTokensDisplay({ model: 'deepseek-flash', usd: 0.0026, wallMs: 8200 });
    assert.deepEqual(d, { kind: 'not-recorded' });
  });

  test('a post-M4a-2 row with no model call (tokens:null, model:null) omits the phrase entirely — "no-model", never "not-recorded"', () => {
    const d = deriveAuditTokensDisplay({
      model: null, at: '2026-09-27T00:00:00.000Z', tokens: null,
    });
    assert.deepEqual(d, { kind: 'no-model' });
  });

  test('PROOF (this can fail): reverting to `result.tokens === null ? {kind:"not-recorded"} : ...` (dropping the why check) would mislabel the no-model case above as "not-recorded"', () => {
    const d = deriveAuditTokensDisplay({ model: null, at: '2026-09-27T00:00:00.000Z', tokens: null });
    assert.notEqual(d.kind, 'not-recorded');
  });
});

describe('deriveAuditToolsPhrase (Amendment M4a-3: the Audit tab\'s Action cell tool tally)', () => {
  test('a model-call row with a recorded tools tally reads "name count" pairs, sorted by count desc then name', () => {
    const p = deriveAuditToolsPhrase({ model: 'deepseek-flash', tools: { read: 3, write: 1, grep: 3 } });
    assert.equal(p, 'grep 3, read 3, write 1');
  });

  test('a model-call row with tools:{} (zero tool calls, still recorded) appends nothing — never "· "', () => {
    assert.equal(deriveAuditToolsPhrase({ model: 'deepseek-flash', tools: {} }), null);
  });

  test('a pre-M4a-3 model row (no "tools" key at all) appends nothing, never an invented tally', () => {
    assert.equal(deriveAuditToolsPhrase({ model: 'deepseek-flash', usd: 0.001 }), null);
  });

  test('a non-model row (model:null) appends nothing, whatever its own tools field says', () => {
    assert.equal(deriveAuditToolsPhrase({ model: null, tools: null }), null);
  });

  test('PROOF (this can fail): a naive object-key-order read would print "read 3, write 1, grep 3" instead of the sorted "grep 3, read 3, write 1"', () => {
    const p = deriveAuditToolsPhrase({ model: 'deepseek-flash', tools: { read: 3, write: 1, grep: 3 } });
    assert.notEqual(p, 'read 3, write 1, grep 3');
  });
});

describe('deriveAuditAtWhy (hamr review 2026-09-27 item d: the Time column)', () => {
  test('a post-M4a-2 row carrying a real "at" has no why at all', () => {
    assert.equal(deriveAuditAtWhy({ at: '2026-09-27T00:00:00.000Z' }), null);
  });

  test('a pre-M4a-2 row (no "at" key at all) carries the fixed "not recorded" why', () => {
    assert.match(deriveAuditAtWhy({ model: 'deepseek-flash', usd: 0.0026 }), /not recorded \(before M4a-2\)/);
  });

  test('PROOF (this can fail): reverting to `row.at ?? null` (no hasOwnProperty check) would return null instead of the why string above', () => {
    const why = deriveAuditAtWhy({ model: 'deepseek-flash', usd: 0.0026 });
    assert.notEqual(why, null);
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

  test('hamr 2026-09-27 browser-walk bug #3: run-parked-expired is [!] "ask expired, not resumed yet" in the runs list, never [·] waiting', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-parked-expired');
    assert.ok(row);
    assert.equal(row.glyph, '[!]');
    assert.match(row.label, /ask expired, not resumed yet/);
    assert.notEqual(row.glyph, '[·]');
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

  test('hamr 2026-09-27 browser-walk bug #1: a WAITING run (parked, open ask) never surfaces a superseded gap from an earlier passed attempt — "why" is the open ask\'s own question', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-waiting-after-earlier-gap', catalogue: CATALOGUE,
    });
    assert.equal(detail.outcome, null);
    assert.equal(detail.stopReason, null);
    assert.match(detail.stopReasonWhy, /^waiting on you: /);
    assert.match(detail.stopReasonWhy, /Does this later draft look right/);
    assert.doesNotMatch(detail.stopReasonWhy, /no line is exactly the heading/);
  });

  test('PROOF (bug #1 can fail): the plain run-waiting fixture (no earlier gap at all) still shows the same "waiting on you: <question>" shape', () => {
    const detail = getRunDetail({
      root: ROOT, flow: FLOW, runId: 'run-waiting', catalogue: CATALOGUE,
    });
    assert.match(detail.stopReasonWhy, /^waiting on you: Does this look right/);
  });

  test('a genuinely stopped run\'s fallback stop reason names the step, from the LAST matching audit row', () => {
    const runDir = makeRunDir(FLOW_DIR, 'run-multi-fail');
    appendAudit(runDir, {
      step: 'jd-text', attempt: 1, class: 'hitl', verdict: 'not-done', gap: 'an EARLIER, superseded-by-later-failure gap', usd: 0.01, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T10:00:00.000Z', tokens: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0 }, tools: {},
    });
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'the LATEST gap, and the one that should show', usd: 0.01, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-24T10:00:01.000Z', tokens: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0 }, tools: {},
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
        step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T00:00:00.000Z', tokens: null, tools: null, unjudgedCount: 0,
      },
      {
        step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'red', gap: 'shorter work history blurb', usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T00:00:01.000Z', tokens: null, tools: null, unjudgedCount: 0,
      },
      {
        step: 'resume-summary-approved', attempt: 2, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T00:00:02.000Z', tokens: null, tools: null, unjudgedCount: 0,
      },
      {
        step: 'resume-summary-approved', attempt: 2, class: 'hitl', verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T00:00:03.000Z', tokens: null, tools: null, unjudgedCount: 0,
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
        step: 'resume-summary', attempt: i, class: 'softgreen', verdict: i < 4 ? 'not-done' : 'green', gap: i < 4 ? 'missing a section' : null, usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: `2026-09-27T01:00:0${i}.000Z`, tokens: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0 }, tools: {},
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
      step: 'resume-summary', attempt: 1, class: 'softgreen', verdict: 'not-done', gap: 'missing a section, scrubbed', usd: 0.001, spendComplete: true, wallMs: 100, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-27T02:00:00.000Z', tokens: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0 }, tools: {},
    });
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-27T02:00:01.000Z', tokens: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 0 }, tools: {},
    });
    // the ask step parks, then the human rejects — interleaved between the
    // two "attempt 2" rows on resume-summary.
    appendAudit(runDir, {
      step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T02:00:02.000Z', tokens: null, tools: null, unjudgedCount: 0,
    });
    appendAudit(runDir, {
      step: 'resume-summary-approved', attempt: 1, class: 'hitl', verdict: 'red', gap: 'shorter work history blurb', usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: '2026-09-27T02:00:03.000Z', tokens: null, tools: null, unjudgedCount: 0,
    });
    appendAudit(runDir, {
      step: 'resume-summary', attempt: 2, class: 'softgreen', verdict: 'green', gap: null, usd: 0.002, spendComplete: true, wallMs: 200, model: 'deepseek-flash', modelMatch: 'match', strike: false, at: '2026-09-27T02:00:04.000Z', tokens: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 0 }, tools: {},
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

  // -------------------------------------------------------------------
  // hamr's 2026-09-27 step-card review: each declared step now carries the
  // SAME per-step group pieces (timeMs/cost/costWhy/tokensTotal/tryMarks/
  // groupState) the Audit tab's own header reads, plus its declared
  // `primitives` (for the card's "granted" line) and a `stoppedReason`
  // (set on exactly the one step that stopped the run, else `null`).
  // -------------------------------------------------------------------
  describe('step-card fields (hamr\'s 2026-09-27 step-card review)', () => {
    test('one source for card + audit header numbers: a step\'s group fields on getRunDetail equal the SAME step\'s group on getRunAudit', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
      });
      const audit = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
      const auditGroupByStep = {};
      for (const g of audit.groups) auditGroupByStep[g.step] = g;
      for (const s of detail.steps) {
        const g = auditGroupByStep[s.emits];
        assert.ok(g, `expected an Audit group for attempted step "${s.emits}"`);
        assert.equal(s.timeMs, g.timeMs);
        assert.equal(s.cost, g.cost);
        assert.equal(s.costWhy, g.costWhy);
        assert.equal(s.tokensTotal, g.tokensTotal);
        assert.deepEqual(s.tryMarks, g.tryMarks);
        assert.equal(s.groupState, g.state);
      }
    });

    test('resume-summary\'s own numbers on run-done: $0.0020, 445 tokens (300+130+15), one green try', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
      });
      const step = detail.steps.find((s) => s.emits === 'resume-summary');
      assert.equal(step.timeMs, 500);
      assert.equal(step.cost, '$0.0020');
      assert.equal(step.tokensTotal, 445);
      assert.deepEqual(step.tryMarks, ['✓']);
      assert.equal(step.groupState, 'done');
    });

    test('PROOF (can fail): a step\'s group timeMs/tryMarks really sum/pair across EVERY attempt, not just the last one', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-model-tries', catalogue: CATALOGUE,
      });
      const step = detail.steps.find((s) => s.emits === 'resume-summary');
      assert.equal(step.timeMs, 400); // 100ms * 4 attempts, summed
      assert.deepEqual(step.tryMarks, ['✗', '✗', '✗', '✓']);
    });

    test('a step with no audit rows at all (never attempted) carries null/empty group fields, never a guessed 0', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-failed', catalogue: CATALOGUE,
      });
      // run-failed's own fixture only ever attempts "jd-text" — every other
      // declared step never ran at all.
      const untouched = detail.steps.find((s) => s.emits === 'resume-text');
      assert.equal(untouched.attempts.length, 0);
      assert.equal(untouched.timeMs, null);
      assert.equal(untouched.cost, null);
      assert.equal(untouched.tokensTotal, null);
      assert.deepEqual(untouched.tryMarks, []);
      assert.equal(untouched.groupState, null);
    });

    test('each step carries its own declared primitives (the card\'s "granted" line); an ask step that grants nothing carries an empty array', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
      });
      assert.deepEqual(detail.steps.find((s) => s.emits === 'jd-text').primitives, ['read']);
      assert.deepEqual(detail.steps.find((s) => s.emits === 'resume-summary-approved').primitives, []);
    });

    test('stoppedReason: only the step that stopped the run carries it, and it is the SAME full text as detail.stopReason', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-failed', catalogue: CATALOGUE,
      });
      const stopped = detail.steps.find((s) => s.emits === 'jd-text');
      assert.equal(stopped.stoppedReason, detail.stopReason);
      assert.match(stopped.stoppedReason, /JD could not be read/);
      for (const s of detail.steps) {
        if (s.emits !== 'jd-text') assert.equal(s.stoppedReason, null, `expected "${s.emits}" to carry no stop reason`);
      }
    });

    test('PROOF (can fail): the redRow-fallback stop path attaches stoppedReason to the LATEST failing step, never an earlier superseded one', () => {
      // Reuses the "run-multi-fail" fixture built above (jd-text's EARLIER,
      // superseded gap, then resume-summary's LATEST gap — no log.json).
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-multi-fail', catalogue: CATALOGUE,
      });
      const summaryStep = detail.steps.find((s) => s.emits === 'resume-summary');
      const jdStep = detail.steps.find((s) => s.emits === 'jd-text');
      assert.match(summaryStep.stoppedReason, /the LATEST gap/);
      assert.equal(jdStep.stoppedReason, null);
    });

    test('a run that completed clean never sets stoppedReason on any step', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
      });
      for (const s of detail.steps) assert.equal(s.stoppedReason, null);
    });

    test('a run that is still waiting (parked, open ask) never sets stoppedReason on any step either — it has not stopped', () => {
      const detail = getRunDetail({
        root: ROOT, flow: FLOW, runId: 'run-waiting-after-earlier-gap', catalogue: CATALOGUE,
      });
      for (const s of detail.steps) assert.equal(s.stoppedReason, null, `expected "${s.emits}" to carry no stop reason while waiting`);
    });
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

  test('hamr review #6, tightened by hamr\'s 2026-09-27 live check: every row carries a server-derived action ("model call"/"human"/"no model call"), never a model name and never "unknown action"', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    const summaryRow = result.rows.find((r) => r.step === 'resume-summary');
    assert.equal(summaryRow.action, 'model call');
    // resume-summary-approved is the signed ask slot (fromLine 4) — its own
    // row carries unjudgedCount, so it's "human".
    const approvedRow = result.rows.find((r) => r.step === 'resume-summary-approved');
    assert.equal(approvedRow.action, 'human');
    // THE BUG hamr caught live: resume-summary-output is a plain WRITE step
    // (hitl class, no model, NOT bound to the ask line) — it must be "no
    // model call", never "human" (class alone can't tell them apart).
    const outputRow = result.rows.find((r) => r.step === 'resume-summary-output');
    assert.equal(outputRow.action, 'no model call');
    for (const r of result.rows) {
      assert.notEqual(r.action, 'unknown action');
      assert.doesNotMatch(r.action, /\(/); // never a model name embedded in this column
    }
  });

  test('hamr review #1: no tool-call-count field on any row — no fwdloop book has one', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    for (const r of result.rows) {
      assert.equal(Object.prototype.hasOwnProperty.call(r, 'toolCalls'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(r, 'toolCallCount'), false);
    }
  });

  test('hamr review 2026-09-27 item c/d: a real post-M4a-2 model row carries a summed token total and no "at" why', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    const summaryRow = result.rows.find((r) => r.step === 'resume-summary');
    assert.deepEqual(summaryRow.tokensDisplay, { kind: 'total', total: 445 }); // 300 + 130 + 15
    assert.equal(summaryRow.atWhy, null);
    assert.equal(summaryRow.at, '2026-09-24T13:52:06.000Z');
  });

  test('hamr review 2026-09-27 item c/d: a no-model (hitl) row omits the tokens phrase entirely and still carries its own "at"', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    const approvedRow = result.rows.find((r) => r.step === 'resume-summary-approved');
    assert.deepEqual(approvedRow.tokensDisplay, { kind: 'no-model' });
    assert.equal(approvedRow.atWhy, null);
  });

  test('hamr review 2026-09-27 item c/d: a real pre-M4a-2 row on disk (written raw, bypassing appendAudit) reads "not-recorded" tokens and an "at" why, never a crash', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-pre-m4a2-audit' });
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.deepEqual(row.tokensDisplay, { kind: 'not-recorded' });
    assert.match(row.atWhy, /not recorded \(before M4a-2\)/);
    assert.equal(row.at, undefined);
    assert.equal(row.action, 'model call');
  });

  test('PROOF (item d can fail): reverting deriveAuditAtWhy to always return null would make the pre-M4a-2 row above report no why at all', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-pre-m4a2-audit' });
    assert.notEqual(result.rows[0].atWhy, null);
  });

  // hamr's 2026-09-27 exit-check review #2: every row also carries a
  // server-derived `blocked` boolean, off the SAME verdict the Action
  // column already reads — never a second guess.
  test('review #2: every row carries blocked, off isBlockedVerdict(row.verdict)', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    for (const r of result.rows) assert.equal(r.blocked, isBlockedVerdict(r.verdict));
    // run-done is entirely green/hitl passes — nothing in it is blocked.
    assert.ok(result.rows.every((r) => r.blocked === false));
  });

  test('review #2: a not-done row is blocked, the run\'s only red', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-failed' });
    assert.equal(result.rows[0].verdict, 'not-done');
    assert.equal(result.rows[0].blocked, true);
  });

  test('PROOF (review #2 can fail): reverting getRunAudit to omit the blocked field would make the assertion above undefined, never true', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-failed' });
    assert.notEqual(typeof result.rows[0].blocked, 'undefined');
  });

  // hamr's 2026-09-27 exit-check review #1: the Audit tab's grouped-by-step
  // header pieces, computed off these SAME enriched rows.
  test('review #1: one group per step, first-seen order, each with state/timeMs/cost/tryMarks/toolsTotal (Amendment M4a-3) — never a "calls" field (no such book)', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done' });
    assert.equal(result.groups.length, 5);
    assert.deepEqual(result.groups.map((g) => g.step), ['resume-text', 'jd-text', 'resume-summary', 'resume-summary-approved', 'resume-summary-output']);
    for (const g of result.groups) {
      assert.equal(Object.prototype.hasOwnProperty.call(g, 'calls'), false);
      assert.equal(g.state, 'done'); // every step in run-done passed on its only attempt
      assert.equal(g.tryCount, 1);
      assert.deepEqual(g.tryMarks, ['✓']);
    }
    const summaryGroup = result.groups.find((g) => g.step === 'resume-summary');
    assert.equal(summaryGroup.timeMs, 500); // this step's own single row's wallMs
    assert.equal(summaryGroup.cost, '$0.0020');
    assert.equal(summaryGroup.tokensTotal, 445); // 300 + 130 + 15, this step's only row
    // this fixture's model rows all carry tools:{} (zero tool calls that
    // round, recorded honestly, never "not recorded").
    assert.deepEqual(summaryGroup.toolsTotal, {});
    assert.equal(summaryGroup.toolsWhy, null);
    assert.deepEqual(summaryGroup.ungranted, []);
    // resume-summary-approved/-output are no-model (hitl, tokens:null/
    // tools:null) rows — the token phrase AND the tools total are both
    // omitted entirely (null), never "0 tokens"/an invented {}.
    const approvedGroup = result.groups.find((g) => g.step === 'resume-summary-approved');
    assert.equal(approvedGroup.tokensTotal, null);
    assert.equal(approvedGroup.toolsTotal, null);
    assert.equal(approvedGroup.toolsWhy, null);
  });

  describe('Amendment M4a-3: deriveAuditGroups\' toolsTotal/toolsWhy/ungranted', () => {
    test('toolsTotal sums auditRowTools across every row in the step, sorted by count desc then name — never a last-row-wins total', () => {
      const rows = [
        { step: 's1', model: 'x', tools: { read: 2, write: 1 } },
        { step: 's1', model: 'x', tools: { read: 1, grep: 3 } },
      ];
      const [g] = deriveAuditGroups(rows);
      assert.deepEqual(g.toolsTotal, { grep: 3, read: 3, write: 1 });
      assert.equal(g.toolsWhy, null);
    });

    test('PROOF (the sum can fail): a naive last-row-wins tools total would read {read:1, grep:3}, not the true summed {grep:3, read:3, write:1}', () => {
      const rows = [
        { step: 's1', model: 'x', tools: { read: 2, write: 1 } },
        { step: 's1', model: 'x', tools: { read: 1, grep: 3 } },
      ];
      const [g] = deriveAuditGroups(rows);
      assert.notDeepEqual(g.toolsTotal, { read: 1, grep: 3 });
    });

    test('a model row that predates M4a-3 (no "tools" key at all) withholds the WHOLE step total, never a partial sum shown as complete', () => {
      const rows = [
        { step: 's1', model: 'x', tools: { read: 2 } },
        { step: 's1', model: 'x' }, // pre-M4a-3 shape: no "tools" key at all
      ];
      const [g] = deriveAuditGroups(rows);
      assert.equal(g.toolsTotal, null);
      assert.match(g.toolsWhy, /not recorded \(before M4a-3\)/);
    });

    test('PROOF (the pre-M4a-3 why can fail): a naive summer would show {read:2} instead of honestly withholding the total', () => {
      const rows = [
        { step: 's1', model: 'x', tools: { read: 2 } },
        { step: 's1', model: 'x' },
      ];
      const [g] = deriveAuditGroups(rows);
      assert.notDeepEqual(g.toolsTotal, { read: 2 });
    });

    test('no model call at all in the step: toolsTotal and toolsWhy both null — nothing to sum, never a guessed {}', () => {
      const rows = [{ step: 's1', model: null, tools: null }];
      const [g] = deriveAuditGroups(rows);
      assert.equal(g.toolsTotal, null);
      assert.equal(g.toolsWhy, null);
    });

    test('ungranted is the union of every row\'s own ungranted list (deduped, insertion order), and is NEVER folded into toolsTotal\'s counts', () => {
      const rows = [
        { step: 's1', model: 'x', tools: { read: 2 }, ungranted: ['grep'] },
        { step: 's1', model: 'x', tools: { read: 1 }, ungranted: ['grep', 'write'] },
      ];
      const [g] = deriveAuditGroups(rows);
      assert.deepEqual(g.toolsTotal, { read: 3 });
      assert.deepEqual(g.ungranted, ['grep', 'write']);
      assert.equal(Object.prototype.hasOwnProperty.call(g.toolsTotal, 'grep'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(g.toolsTotal, 'write'), false);
    });

    test('PROOF (the ungranted separation can fail): a naive merge would fold ungranted "grep" into toolsTotal as if it had been a granted call', () => {
      const rows = [
        { step: 's1', model: 'x', tools: { read: 2 }, ungranted: ['grep'] },
      ];
      const [g] = deriveAuditGroups(rows);
      assert.notDeepEqual(g.toolsTotal, { read: 2, grep: 1 });
    });

    test('ungranted still surfaces even when an earlier row in the SAME step predates M4a-3 — a hole in one row never hides a real ungranted flag in another', () => {
      const rows = [
        { step: 's1', model: 'x' }, // pre-M4a-3: no tools/ungranted key
        { step: 's1', model: 'x', tools: { read: 1 }, ungranted: ['grep'] },
      ];
      const [g] = deriveAuditGroups(rows);
      assert.equal(g.toolsTotal, null);
      assert.match(g.toolsWhy, /not recorded/);
      assert.deepEqual(g.ungranted, ['grep']);
    });
  });

  test('review #1: a step with 2 attempts (a not-done then a passing redo) has 2 tries, marks ["✗","✓"], state "done", timeMs/cost SUMMED across both rows', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done-after-reject' });
    const g = result.groups.find((grp) => grp.step === 'resume-summary');
    assert.equal(g.tryCount, 2);
    assert.deepEqual(g.tryMarks, ['✗', '✓']);
    assert.equal(g.state, 'done');
    assert.equal(g.timeMs, 200 + 400);
    assert.equal(g.cost, '$0.0030'); // 0.001 + 0.002, both spendComplete
    assert.equal(g.tokensTotal, 655); // (150+60+0) + (300+130+15)
  });

  test('review #1: a floor row (spendComplete:false) in a group makes the WHOLE group cost "at least $X", never a bare total', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-partial' });
    const g = result.groups[0];
    // run-partial's own row has usd:null, so nothing priced at all — cost
    // stays null with a why, never a made-up "at least $0".
    assert.equal(g.cost, null);
    assert.match(g.costWhy, /no row in this step has a known cost/);
  });

  test('a group with a pre-M4a-2 row (tokens missing, not null) withholds the WHOLE group\'s token total, never a partial sum shown as complete', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-pre-m4a2-audit' });
    assert.equal(result.groups[0].tokensTotal, null);
  });

  test('PROOF (review #1 can fail): deriveAuditGroups sums wallMs/usd across EVERY row in the step, not just the last one', () => {
    const result = getRunAudit({ root: ROOT, flow: FLOW, runId: 'run-done-after-reject' });
    const g = result.groups[0];
    assert.notEqual(g.timeMs, 400); // the last row's own wallMs alone — the bug this proves against
    assert.equal(g.timeMs, 600);
  });
});

describe('isBlockedVerdict (hamr\'s 2026-09-27 exit-check review #2)', () => {
  test('blocked: not-done, red, refused, ask-timeout, ask-expired, cap-halt, provider-red, pricing-red, close-casualty', () => {
    for (const v of ['not-done', 'red', 'refused', 'ask-timeout', 'ask-expired', 'cap-halt', 'provider-red', 'pricing-red', 'close-casualty']) {
      assert.equal(isBlockedVerdict(v), true, `expected "${v}" to be blocked`);
    }
  });

  test('NOT blocked: green, hitl (passed), paused (still open), stale-answer-ignored (a book hygiene note)', () => {
    for (const v of ['green', 'hitl', 'paused', 'stale-answer-ignored']) {
      assert.equal(isBlockedVerdict(v), false, `expected "${v}" to NOT be blocked`);
    }
  });

  test('a non-string/unknown verdict is never blocked (never a throw)', () => {
    assert.equal(isBlockedVerdict(null), false);
    assert.equal(isBlockedVerdict(undefined), false);
    assert.equal(isBlockedVerdict('some-future-verdict-this-suite-does-not-know-about'), false);
  });
});

describe('deriveStepTryMarks / deriveStepGroupState (hamr\'s 2026-09-27 exit-check review #1)', () => {
  test('a non-hitl step: one mark per row, straight off each row\'s own verdict', () => {
    const rows = [{ verdict: 'not-done' }, { verdict: 'green' }];
    assert.deepEqual(deriveStepTryMarks('softgreen', rows), ['✗', '✓']);
    assert.equal(deriveStepGroupState(rows), 'done'); // last row passed
  });

  test('a hitl ask step: one paused+accept pair is ONE try, marked ✓', () => {
    const rows = [{ verdict: 'paused' }, { verdict: 'green' }];
    assert.deepEqual(deriveStepTryMarks('hitl', rows), ['✓']);
    assert.equal(deriveStepGroupState(rows), 'done');
  });

  test('a hitl ask step: paused, reject, paused, accept is TWO tries (✗, ✓), never four', () => {
    const rows = [{ verdict: 'paused' }, { verdict: 'red' }, { verdict: 'paused' }, { verdict: 'green' }];
    assert.deepEqual(deriveStepTryMarks('hitl', rows), ['✗', '✓']);
    assert.equal(deriveStepGroupState(rows), 'done');
  });

  test('a hitl ask step still open (paused, no resolution yet) marks its try "·", state "waiting"', () => {
    const rows = [{ verdict: 'paused' }];
    assert.deepEqual(deriveStepTryMarks('hitl', rows), ['·']);
    assert.equal(deriveStepGroupState(rows), 'waiting');
  });

  test('a blank-reason "refused" re-ask between a paused row and its real resolution belongs to the SAME try, not its own', () => {
    const rows = [{ verdict: 'paused' }, { verdict: 'refused' }, { verdict: 'refused' }, { verdict: 'green' }];
    assert.deepEqual(deriveStepTryMarks('hitl', rows), ['✓']);
  });

  test('a step with no rows at all has zero try marks', () => {
    assert.deepEqual(deriveStepTryMarks('hitl', []), []);
    assert.deepEqual(deriveStepTryMarks('softgreen', []), []);
  });

  test('PROOF (can fail): pairing by the FIRST non-paused row instead of the LAST would misread a mid-try "refused" as the resolution', () => {
    // the exact shape the fix above guards: if this returned '·' (refused's
    // own mark) instead of '✓' (the real, later resolution), the try would
    // wrongly show as still-open on a step that actually passed.
    const rows = [{ verdict: 'paused' }, { verdict: 'refused' }, { verdict: 'green' }];
    assert.deepEqual(deriveStepTryMarks('hitl', rows), ['✓']);
  });
});

describe('getRunJob', () => {
  // hamr's 2026-09-27 exit-check review #5: the bareloop-style one-field-
  // per-piece layout (prose / asks / model / cap / sources / sends /
  // guardrails / success / signature), replacing the old split
  // asks/sends/sources/signed-lines blocks.
  test('review #5: prose (no guardrail mixed in), cap/redo cap, sources (basename only), sends, and signature come from readFlow', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(job.resolved, true);
    assert.ok(Array.isArray(job.prose) && job.prose.length === 5);
    assert.deepEqual(Object.keys(job.prose[0]).sort(), ['line', 'text']); // never a `guardrail` key mixed in
    assert.equal(job.capUsd, 0.25);
    assert.equal(typeof job.redoCap, 'number'); // this fixture names no explicit "redo cap" line — the signed default applies
    assert.equal(job.sources.length, 2);
    // job2-with-sources.signed.txt signs `source resume = file:/.../Amr
    // Hassan - Resume.docx` — basename only, never the full signed path.
    const resumeSource = job.sources.find((s) => s.role === 'resume');
    assert.equal(resumeSource.basename, 'Amr Hassan - Resume.docx');
    assert.notEqual(resumeSource.basename, resumeSource.path);
    assert.equal(job.sends.length, 1);
    assert.equal(job.sends[0].line, 5);
    assert.equal(job.sends[0].kind, 'file');
    assert.equal(job.signature.signedBy, SIGNED_BY);
    assert.equal(job.signature.signedAt, SIGNED_AT);
    assert.ok(job.signature.hash && job.signature.hash.length > 0);
  });

  test('review #5: Ask — one row per signed ask line, question + raw waitMs (never a client-formatted string)', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(job.asks.length, 1);
    assert.equal(job.asks[0].line, 4);
    assert.match(job.asks[0].question, /check it with me/);
    assert.equal(typeof job.asks[0].waitMs, 'number');
  });

  test('review #5: Guardrails — one row per NUMBERED-LINE guardrail (job2-with-sources signs lines 3 and 4), never the separate cap/send/source arbiter guardrails', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.deepEqual(job.guardrails.map((g) => g.line), [3, 4]);
    assert.match(job.guardrails[0].guardrail, /600 words/);
    assert.match(job.guardrails[1].guardrail, /accept/);
  });

  test('review #5: Success — one row per declared step, in declaration order; the ask step (line 4) reads "human check (your accept)", the others plain "human check" or "shape: ..."', () => {
    const job = getRunJob({
      root: ROOT, flow: FLOW, runId: 'run-done', catalogue: CATALOGUE,
    });
    assert.equal(job.success.length, 5);
    assert.deepEqual(job.success.map((s) => s.step), ['resume-text', 'jd-text', 'resume-summary', 'resume-summary-approved', 'resume-summary-output']);
    assert.equal(job.success.find((s) => s.step === 'resume-text').text, 'human check');
    assert.equal(job.success.find((s) => s.step === 'resume-summary-approved').text, 'human check (your accept)');
    const summarySuccess = job.success.find((s) => s.step === 'resume-summary').text;
    assert.match(summarySuccess, /^shape: 3 headings \(/);
    assert.match(summarySuccess, /max 600 words/);
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

describe('deriveStepSuccessText (hamr\'s 2026-09-27 exit-check review #5: the Job tab\'s Success field)', () => {
  test('hitl, not bound to any signed ask line: "human check"', () => {
    const step = { close: { class: 'hitl' }, fromLine: 1 };
    assert.equal(deriveStepSuccessText(step, [{ line: 4 }]), 'human check');
  });

  test('hitl, bound to the signed ask line: "human check (your accept)"', () => {
    const step = { close: { class: 'hitl' }, fromLine: 4 };
    assert.equal(deriveStepSuccessText(step, [{ line: 4 }]), 'human check (your accept)');
  });

  test('softgreen with sections + maxWords: "shape: N headings (a / b / c), max W words"', () => {
    const step = { close: { class: 'softgreen', shape: { sections: ['a', 'b', 'c'], maxWords: 600 } } };
    assert.equal(deriveStepSuccessText(step, []), 'shape: 3 headings (a / b / c), max 600 words');
  });

  test('softgreen with the invoice-block shape keys (linesPerInvoice/mustCarry), never the sections wording', () => {
    const step = { close: { class: 'softgreen', shape: { linesPerInvoice: 4, mustCarry: ['total', 'date'] } } };
    assert.equal(deriveStepSuccessText(step, []), 'shape: blocks of 4 lines, must carry: total, date');
  });

  test('softgreen with NO shape signed at all: names it plainly, never invents sections/words', () => {
    const step = { close: { class: 'softgreen' } };
    assert.equal(deriveStepSuccessText(step, []), 'shape (no shape rules signed)');
  });

  test('green: "cited" — declaration.js never lets a step declare what it cites, so nothing is appended', () => {
    const step = { close: { class: 'green' } };
    assert.equal(deriveStepSuccessText(step, []), 'cited');
  });

  test('PROOF (can fail): an unknown/unsigned close class is named as unknown, never silently mapped to one of the three known words', () => {
    const step = { close: { class: 'some-future-class-this-suite-does-not-know-about' } };
    assert.equal(deriveStepSuccessText(step, []), 'unknown close class "some-future-class-this-suite-does-not-know-about"');
    // the exact bug this guards: falling through to "human check" (hitl's
    // own wording) for anything unrecognised, silently.
    assert.notEqual(deriveStepSuccessText(step, []), 'human check');
  });

  test('no close class recorded at all: named plainly, never a crash', () => {
    assert.equal(deriveStepSuccessText({}, []), 'no close class recorded');
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

  test('hamr 2026-09-27 browser-walk bug #3: run-parked-expired\'s stop is "expired" and open:false — the Inbox already agrees with the fixed runs-list glyph, never counted', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-parked-expired');
    assert.ok(row);
    assert.equal(row.status, 'expired');
    assert.equal(row.open, false);
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
    assert.equal(first.status, 'redo');
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
    assert.equal(byAskId['ask-2a-first'], 'redo');
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

  test('hamr 2026-09-27 live check: a legacy (no-askId) ask.json in an ENDED run (a real history row) is never listed as its own open/unanswered stop', () => {
    const ownRows = rows.filter((r) => r.flow === FLOW && r.runId === 'run-ended-legacy-ask');
    // exactly the one real decision (the timestamp-named consumed marker) —
    // never a second row rebuilt from the stale ask.json.
    assert.equal(ownRows.length, 1);
    assert.equal(ownRows[0].status, 'accepted');
    assert.equal(ownRows[0].open, false);
    assert.equal(ownRows.some((r) => r.status === 'unanswered'), false);
    assert.equal(ownRows.some((r) => r.askId === null), false);
  });

  test('hamr 2026-09-27 live check: neither the never-applied answer.json nor the quarantined answer.stale.1.json is ever shown as a decision', () => {
    const ownRows = rows.filter((r) => r.flow === FLOW && r.runId === 'run-ended-legacy-ask');
    // the never-applied reject (answeredAt 00:09) and the stale accept
    // (answeredAt 23:00 the day before) must never surface as this run's
    // own decision — only the one real consumed marker (accept, 00:10).
    for (const r of ownRows) {
      assert.notEqual(r.reason, 'arrived too late, scrubbed');
      assert.notEqual(r.answeredAt, '2026-09-09T23:00:00.000Z');
    }
  });

  test('hamr 2026-09-27 live check (belt-and-braces): an ARCHIVED ask left "open" on a run whose history.jsonl carries a row anyway is never counted open (the general rule, not just the legacy-path guard)', () => {
    const row = rows.find((r) => r.flow === FLOW && r.runId === 'run-archived-open-but-ended');
    assert.ok(row);
    assert.equal(row.open, false);
  });

  test('PROOF (this can fail): listStops without the hasHistoryRow guard would count run-ended-legacy-ask\'s stale ask.json as a second, open/unanswered stop, inflating the Inbox count', () => {
    // Documents the exact red the guard removes: legacyRunAsks(runDir) with
    // no hasHistoryRow argument (the pre-fix signature) rebuilds the
    // pre-M3-shape branch unconditionally — see the report for the real
    // revert-and-restore proof (this file doesn't re-run git).
    const ownRows = rows.filter((r) => r.flow === FLOW && r.runId === 'run-ended-legacy-ask');
    assert.notEqual(ownRows.length, 2);
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

  test('hamr 2026-09-27 live check: the Ask tab of an ENDED run with a stale legacy ask.json shows only its real past decision, never a fake open one', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-ended-legacy-ask' });
    assert.ok(result);
    assert.equal(result.asks.length, 1);
    assert.equal(result.asks[0].status, 'accepted');
  });

  test('an open ask carries a real, non-null expiresAt for the client to compute time-left from', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-waiting' });
    const ask = result.asks.find((a) => a.status === 'unanswered');
    assert.ok(ask);
    assert.equal(ask.expiresAt, '2099-01-01T00:00:00.000Z');
  });

  test('hamr 2026-09-27 browser-walk bug #4: an open ask from getRunAsks ALSO carries open:true and a real timeLeftMs, same as the Inbox\'s own listStops row for it', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-waiting' });
    const ask = result.asks.find((a) => a.status === 'unanswered');
    assert.ok(ask);
    assert.equal(ask.open, true);
    assert.equal(typeof ask.timeLeftMs, 'number');
    assert.ok(ask.timeLeftMs > 0);
  });

  test('a PAST ask from getRunAsks carries open:false and timeLeftMs:null — never a stale time-left', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-answered' });
    const ask = result.asks[0];
    assert.equal(ask.open, false);
    assert.equal(ask.timeLeftMs, null);
  });

  test('PROOF (bug #4 can fail): reverting getRunAsks to return runAsksInOrder\'s raw rows (no open/timeLeftMs) would make the open-ask assertion above fail', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-waiting' });
    const ask = result.asks.find((a) => a.status === 'unanswered');
    assert.notEqual(typeof ask.timeLeftMs, 'undefined');
  });

  // hamr's 2026-09-27 exit-check review #3: "Ask i of n" + which declared
  // step (and its signed prose line) each ask belongs to.
  test('review #3: each ask carries its own 1-based index/total ("N of M")', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-ask-steps' });
    assert.equal(result.asks.length, 2);
    assert.deepEqual(result.asks.map((a) => [a.index, a.total]), [[1, 2], [2, 2]]);
  });

  test('review #3: stepName/stepLine are read off the matching declared step, by the SAME positional pairing as afterReject — never invented', () => {
    const result = getRunAsks({
      root: ROOT, flow: FLOW, runId: 'run-ask-steps', catalogue: CATALOGUE,
    });
    const [first, second] = result.asks;
    assert.equal(first.stepName, 'resume-text');
    assert.equal(first.stepLine, 1);
    assert.equal(first.stepWhy, null);
    assert.equal(second.stepName, 'resume-summary-approved');
    assert.equal(second.stepLine, 4);
    assert.equal(second.stepWhy, null);
  });

  test('review #3: with no catalogue (the flow can\'t be read), stepName still comes back honestly off the paused row, stepLine null with a why — never a crash', () => {
    const result = getRunAsks({ root: ROOT, flow: FLOW, runId: 'run-ask-steps' });
    assert.equal(result.asks[0].stepName, 'resume-text');
    assert.equal(result.asks[0].stepLine, null);
    assert.match(result.asks[0].stepWhy, /no declared step/);
  });

  test('review #3: ask/paused-row count mismatch refuses to guess a step — null + a stated why, for every ask', () => {
    const result = getRunAsks({
      root: ROOT, flow: FLOW, runId: 'run-ask-steps-mismatch', catalogue: CATALOGUE,
    });
    assert.equal(result.asks.length, 1);
    assert.equal(result.asks[0].stepName, null);
    assert.equal(result.asks[0].stepLine, null);
    assert.match(result.asks[0].stepWhy, /does not match/);
  });

  test('PROOF (review #3 can fail): deriveAskStepInfo pairs by POSITION, not by re-reading the CURRENT ask.json — reverting to "always use the first paused row" would misname the second ask', () => {
    const auditRows = [
      { step: 'resume-text', verdict: 'paused' },
      { step: 'resume-summary-approved', verdict: 'paused' },
    ];
    const asks = [{ askedAt: '2026-09-27T10:00:00.000Z' }, { askedAt: '2026-09-27T10:10:00.000Z' }];
    const info = deriveAskStepInfo(asks, auditRows, [
      { emits: 'resume-text', fromLine: 1 }, { emits: 'resume-summary-approved', fromLine: 4 },
    ]);
    assert.equal(info[0].step, 'resume-text');
    assert.equal(info[1].step, 'resume-summary-approved');
    assert.notEqual(info[0].step, info[1].step, 'a broken "always first row" pairing would make both asks report the SAME step');
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
      host: '127.0.0.1', port, path: urlPath, method, headers: cookieHeader(port),
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
    handle = remember(await createPanelServer({ port: 0, root: ROOT }));
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
    assert.equal(parsed.asks[0].status, 'redo');
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

  test('negative (v): a symlinked run dir under runs/ pointing outside root is refused, not followed (debrief 2026-09-27)', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'fwdloop-panel-outside-'));
    writeFileSync(path.join(outside, 'audit.jsonl'), '{"leaked":"yes"}\n');
    try {
      symlinkSync(outside, path.join(FLOW_DIR, 'runs', 'evilrun'));
      const r = await get(handle.port, `/api/runs/${FLOW}/evilrun/audit`);
      assert.notEqual(r.status, 200, `expected the symlinked run to be refused, got 200: ${r.body}`);
      assert.ok(r.status === 400 || r.status === 404, `expected 400/404, got ${r.status}`);
      assert.doesNotMatch(r.body, /leaked/);
    } finally {
      rmSync(path.join(FLOW_DIR, 'runs', 'evilrun'), { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
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
    const handle = remember(await createPanelServer({ port: 0, root: ROOT }));
    try {
      const r = await get(handle.port, '/');
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /text\/html/);
      assert.match(r.body, /<title>fwdloop panel<\/title>/);
    } finally {
      await handle.close();
    }
  });

  test('M4b: the only non-GET fetches on the page are POST /api/answer and POST /api/resume, both through postJSON', () => {
    const code = stripComments(source);
    // Every fetch( call: its first argument and its options.
    const calls = [...code.matchAll(/fetch\(([^,]+),\s*\{([\s\S]*?)\}\)\.then/g)];
    assert.ok(calls.length >= 2, 'expected the getJSON and postJSON fetch calls');
    const nonGet = calls.filter((c) => !/method:\s*"GET"/.test(c[2]));
    assert.equal(nonGet.length, 1, `exactly one non-GET fetch call expected (postJSON), got ${nonGet.length}`);
    assert.match(nonGet[0][2], /method:\s*"POST"/);
    assert.doesNotMatch(code, /method:\s*["'](PUT|PATCH|DELETE)["']/i);
    assert.doesNotMatch(code, /\.open\(\s*["'](POST|PUT|PATCH|DELETE)["']/i);
    assert.doesNotMatch(code, /XMLHttpRequest|sendBeacon/);
    // postJSON is called with exactly two paths.
    const postPaths = [...code.matchAll(/postJSON\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(postPaths, ['/api/answer', '/api/resume']);
  });

  test('M4c-fix item 2: the page carries no token — no TOKEN variable, no token header, never a URL, storage, or a log', () => {
    const code = stripComments(source);
    assert.doesNotMatch(code, /\bTOKEN\b/, 'the page must not hold a token at all (the HttpOnly cookie authenticates)');
    assert.doesNotMatch(code, /__FWDLOOP_PANEL_TOKEN__/);
    assert.doesNotMatch(code, /x-fwdloop-token/i);
    assert.doesNotMatch(code, /document\.cookie/);
    assert.doesNotMatch(code, /[?&]t=/);
    // the only localStorage key this page writes is the theme.
    const keys = [...code.matchAll(/localStorage\.setItem\(\s*("[^"]+")/g)].map((m) => m[1]);
    assert.deepEqual(keys, ['"fwdloop-panel-theme"']);
  });

  test('M4b: no alert( / confirm( / prompt( anywhere on the page', () => {
    assert.doesNotMatch(stripComments(source), /\b(alert|confirm|prompt)\s*\(/);
  });

  test('M4b: the POST body is built from the rendered ask\'s askId (closure), not re-read from the page at click time', () => {
    const code = stripComments(source);
    assert.match(code, /askId: ask\.askId, decision: decision, reason: ta \? ta\.value : ""/);
    assert.match(code, /flow: ctx\.flow, runId: ctx\.runId, askId: ask\.askId/);
    // no decision path reads the askId from a DOM attribute or a global at click time.
    const fnStart = code.indexOf('function sendAnswer(');
    const fnEnd = code.indexOf('function sendResumeAgain(');
    const body = code.slice(fnStart, fnEnd);
    assert.doesNotMatch(body, /getAttribute|currentFlow|currentRunId|querySelector\([^)]*ask/);
    // the page sends the typed reason verbatim (no trim / blank check): the library judges it.
    assert.doesNotMatch(body, /\.trim\(\)/);
    // a stale ask / any refusal is shown and the page refreshes to the current ask.
    assert.match(body, /refusalText\(r\)/);
    assert.match(body, /reloadRun\(ctx\.flow, ctx\.runId\)/);
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
    // hamr's 2026-09-27 exit-check review #3: the Ask tab's question is now
    // its own bold heading element (`qHeading`), still set via
    // `.textContent` only, never interpolated into innerHTML.
    assert.match(source, /qHeading\.textContent = qText/);
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
    assert.match(source, /redo by you/);
  });

  test('fix #4: the map legend pairs each word with the scope-correct glyph — [·] waiting on you, no dot at all for "not started"', () => {
    assert.match(source, /<span class="dot"><\/span>waiting on you/);
    assert.match(source, /<span>not started<\/span>/);
    // never the OLD (wrong) pairing this fix replaced.
    assert.doesNotMatch(source, /dot amber"><\/span>waiting on you/);
    assert.doesNotMatch(source, /dot grey"><\/span>not started/);
  });

  // fix #6 originally required the "after reject: " boundary label to be
  // RENDERED on the Run tab's step cards; hamr's 2026-09-27 step-card
  // redesign removed the Run tab's per-attempt rows entirely (summarized
  // cards only — per-attempt detail, including any reject boundary, stays
  // in the Audit tab's own per-row Gap column). `s.attempts[].afterReject`
  // itself is still computed server-side and proven directly against
  // `getRunDetail` in this file's own `describe('getRunDetail', ...)` block
  // (fix #6/#6 re-walk tests) — never renumbered, never guessed — this
  // page-source test only needs to confirm no vague/wrong fallback label
  // ever crept back in.
  test('fix #6: a step\'s attempt-numbering boundary after a human reject is never silently renumbered or guessed with a vague fallback label', () => {
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

  test('fix #7 / hamr 2026-09-27 browser-walk bug #2: the runs-list meta line never truncates with an ellipsis, at phone width OR desktop width', () => {
    // bug #2: the old rule only wrapped inside the phone-width media query —
    // desktop kept a one-line ellipsis that silently cut real content (e.g.
    // "waiting on you (parked, unanswered) · at least $0…"). The wrap is now
    // the BASE rule (no media query gate), and no ellipsis rule survives.
    assert.match(source, /\.wf-meta-line\{white-space:normal;overflow:visible;text-overflow:clip;min-width:0;\}/);
    assert.doesNotMatch(source, /\.wf-meta-line\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
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

  test('review #5/#6, hamr 2026-09-27 item (d): the Audit tab has a Grouped/Flat toggle and the column order Attempt \\| Step \\| Action \\| Gap \\| Cost \\| Verdict \\| Close \\| Time (Step dropped in Grouped)', () => {
    assert.match(source, /audit-view-grouped/);
    assert.match(source, /audit-view-flat/);
    assert.match(source, /<th>Attempt<\/th><th>Step<\/th><th>Action<\/th><th>Gap<\/th><th>Cost<\/th><th>Verdict<\/th><th>Close<\/th><th>Time<\/th>/);
    assert.match(source, /<th>Attempt<\/th><th>Action<\/th><th>Gap<\/th><th>Cost<\/th><th>Verdict<\/th><th>Close<\/th><th>Time<\/th>/);
  });

  test('hamr 2026-09-27 item (c): the Audit tab Cost cell combines money, a token phrase, and wall time', () => {
    assert.match(source, /function auditCostCellText/);
    assert.match(source, /"tokens not recorded"/);
    assert.match(source, /td\.total \+ " tokens"/);
    // the row builder must actually CALL the helper, not just define it —
    // scoped to buildAuditRowEl's own body so a call removed from there
    // (even with the helper still defined/unused above it) is caught.
    var rowFnStart = source.indexOf('function buildAuditRowEl');
    var rowFnEnd = source.indexOf('\n  }', rowFnStart);
    var rowFnBody = source.slice(rowFnStart, rowFnEnd);
    assert.match(rowFnBody, /escapeXml\(auditCostCellText\(r\)\)/, 'buildAuditRowEl must call auditCostCellText(r) for its Cost cell');
  });

  // ---------------------------------------------------------------------------
  // fix (2026-09-28, borrowed-from: bareloop src/panel/index.html@2711b1b):
  // hamr's UI review found the Audit tab's Time cell (full local date+time,
  // e.g. "9/27/2026, 8:20:58 AM") overflowing its mobile stacked-card cell
  // sideways at 390px. auditTimeCellHtml now shows LOCAL time-only
  // (toLocaleTimeString) with the full local readableDateTime string kept
  // in the cell's title for hover — fwdloop reads every other timestamp on
  // this page in local time, so (unlike bareloop's raw-UTC ISO slice) this
  // helper stays local rather than switching to a raw UTC slice.
  // ---------------------------------------------------------------------------

  test('fix: auditTimeCellHtml renders a valid "at" as local time-only, with the full local timestamp in a title tooltip', () => {
    const start = source.indexOf('function auditTimeCellHtml(');
    const end = source.indexOf('\n  }', start);
    assert.ok(start !== -1, 'expected auditTimeCellHtml in src/panel/index.html');
    const helperSrc = source.slice(start, end + 4);
    // exercise the real helper with the page's own escapeXml/readableDateTime
    const escStart = source.indexOf('function escapeXml(');
    const escEnd = source.indexOf('\n  }', escStart);
    const escSrc = source.slice(escStart, escEnd + 4);
    const rdtStart = source.indexOf('function readableDateTime(');
    const rdtEnd = source.indexOf('\n  }', rdtStart);
    const rdtSrc = source.slice(rdtStart, rdtEnd + 4);
    const fn = new Function('Date', escSrc + rdtSrc + helperSrc + 'return auditTimeCellHtml;')(Date);
    const iso = '2026-09-27T08:20:58.924Z';
    const d = new Date(iso);
    const expectedShort = d.toLocaleTimeString();
    const expectedFull = d.toLocaleString();
    const html = fn({ at: iso });
    assert.match(html, /^<span title="/);
    assert.ok(html.indexOf(expectedFull) !== -1, `expected full local timestamp "${expectedFull}" in title, got: ${html}`);
    assert.ok(html.indexOf('>' + expectedShort + '<') !== -1, `expected local time-only "${expectedShort}", got: ${html}`);
  });

  test('fix: auditTimeCellHtml keeps atWhy/unknown plain text (no <span title>) for a missing/unparseable "at"', () => {
    const start = source.indexOf('function auditTimeCellHtml(');
    const end = source.indexOf('\n  }', start);
    const helperSrc = source.slice(start, end + 4);
    const escStart = source.indexOf('function escapeXml(');
    const escEnd = source.indexOf('\n  }', escStart);
    const escSrc = source.slice(escStart, escEnd + 4);
    const rdtStart = source.indexOf('function readableDateTime(');
    const rdtEnd = source.indexOf('\n  }', rdtStart);
    const rdtSrc = source.slice(rdtStart, rdtEnd + 4);
    const fn = new Function('Date', escSrc + rdtSrc + helperSrc + 'return auditTimeCellHtml;')(Date);
    assert.strictEqual(fn({ atWhy: 'not recorded (before M4a-2)' }), 'not recorded (before M4a-2)');
    assert.strictEqual(fn({}), 'unknown');
    assert.doesNotMatch(fn({ atWhy: 'not recorded (before M4a-2)' }), /<span/);
    assert.doesNotMatch(fn({}), /<span/);
  });

  test('fix: buildAuditRowEl\'s Time cell uses auditTimeCellHtml, not a raw readableDateTime(r.at)', () => {
    var rowFnStart = source.indexOf('function buildAuditRowEl');
    var rowFnEnd = source.indexOf('\n  }', rowFnStart);
    var rowFnBody = source.slice(rowFnStart, rowFnEnd);
    assert.match(rowFnBody, /auditTimeCellHtml\(r\)/, 'buildAuditRowEl must call auditTimeCellHtml(r) for its Time cell');
  });

  test('hamr 2026-09-27 exit-check review #1: an Audit step group\'s header is a role="button" div, COLLAPSED by default, foldable on click', () => {
    assert.match(source, /function renderAuditGroups/);
    var start = source.indexOf('function renderAuditGroups');
    var end = source.indexOf('\n  }', source.indexOf('function toggleAuditGroup', start));
    var body = source.slice(start, end);
    assert.match(body, /header\.setAttribute\("role", "button"\)/);
    // review #1: "Groups COLLAPSED by default" — the OLD default-expanded
    // behavior ("true" + a visible table) is replaced with "false" + a
    // hidden table; a map/step-card click (openAuditGroup) is the only
    // thing that force-expands one.
    assert.match(body, /header\.setAttribute\("aria-expanded", "false"\)/);
    assert.match(body, /table\.hidden = true/);
    assert.doesNotMatch(body, /header\.setAttribute\("aria-expanded", "true"\)/);
    assert.match(body, /function toggleAuditGroup/);
    assert.match(body, /header\.addEventListener\("click", toggleAuditGroup\)/);
  });

  test('hamr 2026-09-27 item (b): a jump to an Audit group (openAuditGroup) force-expands it before scrolling, never lands on a collapsed section', () => {
    var start = source.indexOf('function openAuditGroup');
    var end = source.indexOf('\n  }', start);
    var body = source.slice(start, end);
    assert.match(body, /table\.hidden = false/);
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

  test('review #7: the Job tab shows the model name', () => {
    assert.match(source, /details-model/);
  });

  // hamr's 2026-09-27 FINAL tweak #1: the field order changed again —
  // "Model · $ cap row · Job (prose) · Ask · Source · Destination ·
  // Guardrails · Success · Signed" — checked directly off the markup's own
  // field ids, in page order. This test can fail: reverting the HTML edit
  // that moved details-model/details-cap ahead of details-prose/details-asks
  // puts details-prose back first, and the positions[i] > positions[i-1]
  // check on the FIRST pair (details-model vs details-cap is unaffected, but
  // details-cap vs details-prose) goes red.
  test('final tweak #1: the Job tab\'s field order is Model, $ cap, Job (prose), Ask, Source, Destination, Guardrails, Success, Signed', () => {
    const ids = ['details-model', 'details-cap', 'details-prose', 'details-asks', 'details-sources', 'details-sends', 'details-guardrails', 'details-success', 'details-signature'];
    const positions = ids.map((id) => {
      const idx = source.indexOf(`id="${id}"`);
      assert.ok(idx > 0, `expected to find id="${id}" in the page`);
      return idx;
    });
    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i] > positions[i - 1], `${ids[i]} must render after ${ids[i - 1]}`);
    }
  });

  test('review #5: the $ cap field carries the redo cap too ("$0.25 · redo cap 3" shape), one field not two', () => {
    const fnStart = source.indexOf('function renderJob');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /redo cap/);
    assert.doesNotMatch(source, /id="details-redo-cap"/); // the OLD, separate field id is gone
  });

  // hamr's 2026-09-27 final tweak #1: fwdloop's signed arbiter (src/types.js
  // Arbiter typedef, src/declaration.js) carries capUsd/redoCap and each
  // ask's own ttlMs, but NO run-wide time-cap field at all — so the $ cap
  // row must always say plainly that no time cap is signed, never invent
  // one from an ask's ttlMs or any other value.
  test('final tweak #1: the $ cap row states "no time cap signed" (fwdloop\'s arbiter has no signed time-cap field)', () => {
    const fnStart = source.indexOf('function renderJob');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /no time cap signed/);
  });

  // hamr's 2026-09-27 final tweak #2: the signed timestamp is a raw ISO
  // string in the books (e.g. "2026-09-24T13:22:40.950Z") — the Signed row
  // must render it through the SAME readableDateTime formatter every other
  // date field on this page already uses, never the raw ISO string.
  test('final tweak #2: the Signed row renders sig.signedAt through readableDateTime, not the raw ISO string', () => {
    const fnStart = source.indexOf('function renderJob');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /readableDateTime\(sig\.signedAt\)/);
  });

  // hamr's 2026-09-27 final tweak #3: audit/ask block headers ("[done] ·
  // resume-text · 7.9s · $0.0026 · try 1 ✓") are book text rendered as-is,
  // lower case — the global `h2,h4{text-transform:uppercase}` rule must be
  // overridden back to none for these collapsible block headers, and no
  // later rule may re-uppercase them.
  test('final tweak #3: .audit-group h4 headers are NOT uppercased (overrides the global h2,h4 rule)', () => {
    const rule = source.match(/\.audit-group h4\s*\{[^}]*\}/);
    assert.ok(rule, 'expected a .audit-group h4 CSS rule');
    assert.match(rule[0], /text-transform:\s*none/);
    // no OTHER rule targeting .audit-group h4 (or a broader selector that
    // still matches it) reintroduces text-transform:uppercase afterward.
    const styleBlock = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    const uppercaseRules = styleBlock.match(/[^{}]+\{[^}]*text-transform:\s*uppercase[^}]*\}/g) || [];
    uppercaseRules.forEach((r) => {
      assert.doesNotMatch(r, /\.audit-group h4/, `no rule may re-uppercase .audit-group h4: ${r}`);
    });
  });

  // hamr's 2026-09-27 review (Audit group header colors): the collapsible
  // group header ("[done] · resume-text · ...") is (1) NOT bold and (2) its
  // status word is its own colored span, built off `g.state` directly
  // (server field), never parsed back out of the rendered header string —
  // reusing the SAME color vocabulary (`.badge`/glyphClass) the runs list
  // already uses, so it's one color vocabulary, not a second one.
  test('review: the Audit group header line itself is not bold', () => {
    // `.audit-group h4` (the shared rule, also matched by the Ask tab's own
    // `.ask-question-heading` h4, which review #3 requires stay bold) must
    // never declare font-weight itself — only a MORE specific selector
    // scoped to the status header may un-bold it, or it would un-bold the
    // ask question heading too (specificity: `.audit-group h4` outranks a
    // single class like `.ask-question-heading`).
    const sharedRule = source.match(/\.audit-group h4\s*\{[^}]*\}/);
    assert.ok(sharedRule, 'expected a .audit-group h4 CSS rule');
    assert.doesNotMatch(sharedRule[0], /font-weight/, '.audit-group h4 itself must not set font-weight (it would also affect .ask-question-heading)');
    // the status header's own, more specific rule sets it to normal weight.
    const headerRule = source.match(/\.audit-group h4\.audit-status-header\s*\{[^}]*\}/);
    assert.ok(headerRule, 'expected a .audit-group h4.audit-status-header CSS rule');
    assert.match(headerRule[0], /font-weight:\s*(400|normal)\b/);
    // the ask question heading keeps its own bold weight (review #3) — a
    // regression guard: without a scoped selector, un-bolding the audit
    // status header would also un-bold this one.
    const askHeadingRule = source.match(/\.ask-question-heading\s*\{[^}]*\}/);
    assert.ok(askHeadingRule, 'expected a .ask-question-heading CSS rule');
    assert.match(askHeadingRule[0], /font-weight:\s*(700|bold)\b/);
  });

  test('PROOF (bold check can fail): a font-weight:700 rule on the bare .audit-group h4 selector would be caught by the assertion above', () => {
    const styleBlock = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    const wouldFailIfPresent = /\.audit-group h4\s*\{[^}]*font-weight:\s*700[^}]*\}/;
    assert.doesNotMatch(styleBlock, wouldFailIfPresent, 'sanity: this shape is not currently present, proving the check above is not vacuous');
  });

  test('review: the group header status word is its own span carrying a status color class, built directly off g.state (never parsed from the header string)', () => {
    const fnStart = source.indexOf('function buildAuditGroupHeaderEl');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /stateSpan\.className = "badge " \+ auditStateClass\(g\.state\)/);
    assert.match(body, /stateSpan\.textContent = g\.state/);
    // never re-derived by slicing/parsing a rendered "[state]" string apart.
    assert.doesNotMatch(body, /\.split\(|\.match\(|\.indexOf\("\["|\.slice\(1/);
  });

  test('review: auditStateClass maps each of the three real group states to a DISTINCT status color, reusing the runs-list vocabulary (green/amber/red)', () => {
    const fnStart = source.indexOf('function auditStateClass');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /state === "done"/);
    assert.match(body, /state === "waiting"/);
    assert.match(body, /state === "stopped"/);
    // include the function's own closing brace (fnEnd stops just BEFORE it,
    // matching the other body-regex checks in this file) so this parses as
    // a complete function declaration.
    const fullFn = source.slice(fnStart, fnEnd + '\n  }'.length);
    const evalAuditStateClass = new Function(fullFn + '\nreturn auditStateClass;')();
    const seen = ['done', 'waiting', 'stopped'].map(evalAuditStateClass);
    assert.deepEqual(seen, ['green', 'amber', 'red']);
    assert.equal(new Set(seen).size, 3, 'the three real states must not collapse onto the same color');
  });

  test('PROOF (state-color check can fail): mapping every state to "grey" would fail the distinctness assertion above', () => {
    function auditStateClassAllGrey(){ return 'grey'; }
    const seen = ['done', 'waiting', 'stopped'].map(auditStateClassAllGrey);
    assert.equal(new Set(seen).size, 1, 'sanity: an all-grey stub collapses to one color, which is exactly what the real check must reject');
  });

  test('review: per-try marks (✓/✗/·) are colored spans too, off the same vocabulary (green/red/grey), never left as bare uncolored text', () => {
    const fnStart = source.indexOf('function buildAuditGroupHeaderEl');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /g\.tryMarks\.forEach/);
    assert.match(body, /markSpan\.className = "mark " \+ auditMarkClass\(mark\)/);
    const markFnStart = source.indexOf('function auditMarkClass');
    const markFnEnd = source.indexOf('\n  }', markFnStart);
    const markBody = source.slice(markFnStart, markFnEnd);
    assert.match(markBody, /mark === "✓"/);
    assert.match(markBody, /mark === "✗"/);
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

  test('hamr 2026-09-27 browser-walk bug #3: glyphClass maps the new [!] "ask expired" glyph to a real color, never the grey/red/magenta bucket', () => {
    var fnStart = source.indexOf('function glyphClass');
    var fnEnd = source.indexOf('\n  }', fnStart);
    var body = source.slice(fnStart, fnEnd);
    assert.match(body, /g === "\[!\]"/);
  });

  test('re-walk #3 / hamr 2026-09-27 exit-check review #1: a grouped audit header\'s cost floor is derived server-side (data.js\'s deriveAuditGroups), never re-summed client-side', () => {
    // the ORIGINAL bug lived in client-side `money(sum, partial)` vs
    // `money(sum, !partial)` — the whole derivation (sum, partial,
    // costDisplay's own spendComplete check) now lives server-side in
    // src/panel/data.js's deriveAuditGroups, proven directly by
    // test/panel.test.js's own deriveAuditGroups unit tests; the page only
    // ever renders `g.cost`, never recomputes a sum or a spendComplete flag.
    assert.doesNotMatch(source, /money\(sum,/);
    assert.match(source, /g\.cost \|\| "cost unknown"/);
  });

  // hamr's 2026-09-27 retry-loop review: a step map box with a server-derived
  // tryCount > 1 draws a dashed loop-back edge (bareloop commit 16825a7's own
  // shape). Extracts the real functions out of the page (never re-implements
  // them here) and calls them, so this proves actual rendering behavior, not
  // just a source-text grep.
  function loadStepMapGeometry() {
    const start = source.indexOf('function escapeXml');
    const end = source.indexOf('function mapAvailWidth');
    const body = source.slice(start, end);
    // eslint-disable-next-line no-new-func
    const factory = new Function(`${body}
      return { buildStepBoxes, buildStepMapSVG, boxRetryTry, tryCountText, stepTitleText };
    `);
    return factory();
  }

  test('boxRetryTry: a box with tryCount > 1 reports its own tryCount; tryCount 1 or 0 reports 0 (server-derived, never recounted from attempts)', () => {
    const { boxRetryTry } = loadStepMapGeometry();
    assert.equal(boxRetryTry({ tryCount: 4 }), 4);
    assert.equal(boxRetryTry({ tryCount: 1 }), 0);
    assert.equal(boxRetryTry({ tryCount: 0 }), 0);
  });

  test('buildStepMapSVG: a step with server tryCount 3 renders a dashed retry loop path labelled "try 3"', () => {
    const { buildStepBoxes, buildStepMapSVG } = loadStepMapGeometry();
    const steps = buildStepBoxes([
      { emits: 'flaky-step', goal: 'g', closeClass: 'green', attempts: [{ verdict: 'red' }, { verdict: 'red' }, { verdict: 'green' }], tryCount: 3 },
    ]);
    const svg = buildStepMapSVG(steps, 900);
    assert.match(svg, /stroke-dasharray="3,3"/, 'expected a dashed retry path when tryCount > 1');
    assert.match(svg, />try 3</, 'expected the retry label to carry the server tryCount');
  });

  test('buildStepMapSVG: a step with tryCount 1 (or missing) renders NO dashed retry path — proof the check above can fail', () => {
    const { buildStepBoxes, buildStepMapSVG } = loadStepMapGeometry();
    const steps = buildStepBoxes([
      { emits: 'clean-step', goal: 'g', closeClass: 'green', attempts: [{ verdict: 'green' }], tryCount: 1 },
      { emits: 'never-run', goal: 'g', closeClass: 'green', attempts: [], tryCount: 0 },
    ]);
    const svg = buildStepMapSVG(steps, 900);
    assert.doesNotMatch(svg, /stroke-dasharray="3,3"/, 'no box here has tryCount > 1, so no retry loop should render');
    assert.doesNotMatch(svg, />try /, 'no "try N" label should render either');
  });

  test('stepMapLegendHTML: names the retry loop so the dashed line is not left unexplained on the page', () => {
    const fnStart = source.indexOf('function stepMapLegendHTML');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /dashed = retry/);
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

  test('M4b: the Ask panel\'s static markup has no button/input (doors are built per ask by script); buttons exist only for the three doors + try-again', () => {
    const start = source.indexOf('<section id="panel-ask"');
    assert.ok(start > 0, 'panel-ask section not found');
    const end = source.indexOf('</section>', start);
    assert.ok(end > start, 'could not find the closing </section> for panel-ask');
    const panelAskHtml = stripComments(source.slice(start, end));
    assert.doesNotMatch(panelAskHtml, /<button|<input|<textarea/i);
    // Script-built buttons inside renderAnswerBlock: exactly these four test ids.
    const fnStart = source.indexOf('function renderAnswerBlock(');
    const fnEnd = source.indexOf('function renderAskEvidenceBlock(');
    assert.ok(fnStart > 0 && fnEnd > fnStart);
    const block = stripComments(source.slice(fnStart, fnEnd));
    const buttons = [...block.matchAll(/makeButton\("([^"]+)",\s*"([^"]+)"/g)].map((m) => m[2]);
    assert.deepEqual(buttons, ['btn-accept', 'btn-redo', 'btn-rerun', 'btn-resume-again']);
    // the reason box is a real, labelled textarea.
    assert.match(block, /createElement\("textarea"\)/);
    assert.match(block, /lab\.setAttribute\("for", idSafe\)/);
    // the answer-slot placeholder is gone and nothing on the page says "read-only panel" any more.
    assert.doesNotMatch(source, /ask-answer-slot|answer controls are not built yet/);
    assert.doesNotMatch(stripComments(source), /panel is read-only/);
  });

  test('M4a-1: the Ask tab\'s collapse/expand toggle is a div with role="button", never a real <button> element', () => {
    assert.match(source, /head\.setAttribute\("role", "button"\)/);
  });

  test('M4a-1: clicking an Inbox stop selects its run, switches to the Ask tab, and passes the ask\'s id to focus', () => {
    assert.match(source, /selectRun\(row\.flow, row\.runId, wrap, "\.inbox-row", row\.askId\)/);
    assert.match(source, /document\.getElementById\("tab-ask"\)\.click\(\)/);
  });

  test('M4a-1 / M4c item 3: the Inbox tab label always shows the server\'s open-stop count, (0) included', () => {
    assert.match(source, /inbox-count-label/);
    assert.match(source, /" \(" \+ \(typeof openCount === "number" \? openCount : 0\) \+ "\)"/);
  });

  test('M4a-1: status vocabulary used in the Inbox/Ask UI is exactly the books\' own words — never a second, made-up vocabulary', () => {
    assert.match(source, /"accepted"/);
    assert.match(source, /"redo"/);
    assert.match(source, /"reran"/);
    assert.match(source, /"expired"/);
    assert.match(source, /"unanswered"/);
    // the OLD (pre-M4a-1) vocabulary this replaces must not survive as live UI text.
    assert.doesNotMatch(stripComments(source), /"legacy"|"unreadable"/);
  });

  // hamr's 2026-09-27 exit-check review #1: Audit groups render server-
  // computed header pieces, never their own re-derivation.
  test('review #1: the Audit group header is built ONLY from server fields (state/step/timeMs/cost/tokensTotal/tryCount/tryMarks) — no client-side sum/pairing survives', () => {
    const fnStart = source.indexOf('function auditGroupHeaderText');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /g\.state/);
    assert.match(body, /g\.step/);
    assert.match(body, /duration\(g\.timeMs\)/);
    assert.match(body, /g\.cost/);
    assert.match(body, /g\.tryCount/);
    assert.match(body, /g\.tryMarks\.join/);
    assert.match(body, /g\.tokensTotal/);
    // never "calls"/"tools" — no such book (review #1's own instruction).
    assert.doesNotMatch(body, /calls|tools/);
  });

  test('review #1: Audit groups are COLLAPSED by default in the page markup too (no aria-expanded="true" default anywhere in the Audit section)', () => {
    const auditSectionStart = source.indexOf('id="panel-audit"');
    const auditSectionEnd = source.indexOf('</section>', auditSectionStart);
    assert.doesNotMatch(source.slice(auditSectionStart, auditSectionEnd), /aria-expanded="true"/);
  });

  test('PROOF (review #1 markup can fail): the OLD default-expanded HTML shape ("aria-expanded=\\"true\\"" on the audit group header) is gone from renderAuditGroups', () => {
    const fnStart = source.indexOf('function renderAuditGroups');
    const fnEnd = source.indexOf('\n  }', source.indexOf('function toggleAuditGroup', fnStart));
    assert.doesNotMatch(source.slice(fnStart, fnEnd), /"aria-expanded", "true"\)/);
  });

  // hamr's 2026-09-27 exit-check review #2: the Audit tab's All/Human/
  // Blocked filter bar.
  test('review #2: All/Human/Blocked chips exist, Human/Blocked read the server-derived action/blocked fields, never a second guess', () => {
    assert.match(source, /data-audit-filter="all"/);
    assert.match(source, /data-audit-filter="human"/);
    assert.match(source, /data-audit-filter="blocked"/);
    const fnStart = source.indexOf('function auditRowMatchesFilter');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /r\.action === "human"/);
    assert.match(body, /r\.blocked === true/);
  });

  test('review #2: the filter applies in both Grouped and Flat views, and a group with no matching rows is hidden', () => {
    const groupsFn = source.slice(source.indexOf('function renderAuditGroups'), source.indexOf('function renderAuditFlat'));
    assert.match(groupsFn, /\.filter\(auditRowMatchesFilter\)/);
    assert.match(groupsFn, /if\(rows\.length === 0\) return/);
    const flatFnStart = source.indexOf('function renderAuditFlat');
    const flatFnEnd = source.indexOf('\n  }', flatFnStart);
    assert.match(source.slice(flatFnStart, flatFnEnd), /\.filter\(auditRowMatchesFilter\)/);
  });

  test('review #2: an empty filtered result says why, never a silent blank screen', () => {
    assert.match(source, /audit-filter-empty/);
    assert.match(source, /"no " \+ auditFilterMode \+ " rows in this run's audit trail"/);
  });

  test('PROOF (review #2 can fail): reverting auditRowMatchesFilter to always return true would make Blocked show every row, including passes', () => {
    const fnStart = source.indexOf('function auditRowMatchesFilter');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    // the real function must branch on mode — a reverted "return true" stub
    // would have neither of these comparisons at all.
    assert.match(body, /auditFilterMode === "blocked"/);
    assert.match(body, /auditFilterMode === "human"/);
  });

  // hamr's 2026-09-27 exit-check review #3: Ask tab "Ask i of n" + bold
  // headers + Inbox-opened highlight.
  test('review #3 (M4c): the Ask block header names the step (+ line), "draft N", when it was asked, and its status — never "Ask i of n"', () => {
    const fnStart = source.indexOf('function blockMetaText');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.doesNotMatch(body, /" of "/);
    assert.match(body, /"draft " \+ block\.draftNo/);
    assert.match(body, /block\.stepName/);
    assert.match(body, /" \(line " \+ block\.stepLine \+ "\)"/);
    assert.match(body, /ask\.askedAt/);
  });

  test('review #3: the draft/unjudged-input box headers use the bold .evidence-heading class, never the faint .hint style', () => {
    assert.match(source, /textDiv\("evidence-heading", "draft " \+ ctx\.draftNo\)/);
    assert.match(source, /textDiv\("evidence-heading", "unjudged/);
    assert.match(source, /\.evidence-heading\{[^}]*font-weight:700/);
  });

  test('review #3: an ask opened from the Inbox (focusAskId) gets a visible highlight class', () => {
    const fnStart = source.indexOf('function renderAsk(result');
    const fnEnd = source.lastIndexOf('}');
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /focusAskId && block\.askIds\.indexOf\(focusAskId\) !== -1/);
    assert.match(body, /row\.classList\.add\("audit-group-highlight"\)/);
  });

  test('PROOF (review #3 can fail): the highlight is gated on the REAL focusAskId match — a bare "if(focusAskId)" would highlight every ask whenever ANY one was clicked from the Inbox', () => {
    const fnStart = source.indexOf('blocks.forEach(function(block){', source.indexOf('function renderAsk(result'));
    const fnEnd = source.indexOf('list.appendChild(row)', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /block\.askIds\.indexOf\(focusAskId\) !== -1/);
  });

  // hamr's 2026-09-27 exit-check review #4: no horizontal scroll at 390px.
  test('review #4: a max-width:480px rule stacks both audit tables into label:value mini-cards, keyed off the SAME data-label attribute buildAuditRowEl sets', () => {
    assert.match(source, /@media \(max-width: 480px\)\{/);
    const mqStart = source.indexOf('@media (max-width: 480px){');
    const mqEnd = source.indexOf('\n  }', source.lastIndexOf('}', source.indexOf('\n  }\n</style>')));
    const mq = source.slice(mqStart, source.indexOf('</style>'));
    assert.match(mq, /\[data-testid="audit-table"\] td::before, \.audit-group table td::before/);
    assert.match(mq, /content:attr\(data-label\)/);
    assert.match(mq, /display:block/);
    // the row-builder must set the SAME attribute the CSS reads.
    assert.match(source, /data-label=\\"Time\\"/);
    assert.match(source, /data-label=\\"Attempt\\"/);
  });

  test('PROOF (review #4 can fail): removing the max-width:480px stacking rule would leave the wide multi-column table as the only layout at phone width', () => {
    const withoutRule = source.replace(/@media \(max-width: 480px\)\{[\s\S]*?\n  \}\n<\/style>/, '</style>');
    assert.notEqual(withoutRule, source);
    assert.doesNotMatch(withoutRule, /\[data-testid="audit-table"\] td::before/);
  });

  // ---------------------------------------------------------------------
  // hamr's 2026-09-27 step-card redesign: the Run tab's step cards no
  // longer read like the Audit log (every attempt, full gap text) — a
  // 4-line-max summary per step instead. These checks are all static
  // (source-level), matching the rest of this describe block's own posture
  // (no jsdom/browser in this stack); the DATA the cards render is proven
  // separately, against `getRunDetail`, in this file's own
  // `describe('getRunDetail', ...)` block below.
  // ---------------------------------------------------------------------

  test('step-card styling ruling: the header line is upper case + bold; every other card line is explicitly normal case/weight', () => {
    assert.match(source, /\.step-card \.step-head\{[^}]*text-transform:uppercase[^}]*font-weight:700/);
    assert.match(source, /\.step-card \.step-line\{[^}]*text-transform:none[^}]*font-weight:400/);
  });

  test('PROOF (styling ruling can fail): removing the step-head uppercase/bold rule leaves no CSS rule at all forcing the header\'s case/weight', () => {
    const withoutRule = source.replace(/\.step-card \.step-head\{[^}]*\}\n/, '');
    assert.notEqual(withoutRule, source);
    assert.doesNotMatch(withoutRule, /\.step-card \.step-head\{[^}]*text-transform:uppercase/);
  });

  test('step cards are built from ONE header helper + a shared plain-line helper, never a second ad hoc line builder', () => {
    assert.match(source, /function buildStepCardHeadEl\(box, idx\)/);
    assert.match(source, /function textLineEl\(extraClass, text, testId\)/);
    assert.match(source, /function buildStepActionsLineEl\(box, idx\)/);
    // the header's state chip reuses the SAME color function the Audit tab's
    // own group headers use — never a second color scheme for the Run tab.
    const headFnStart = source.indexOf('function buildStepCardHeadEl(box, idx){');
    const headFnEnd = source.indexOf('\n  }', headFnStart);
    const headFnBody = source.slice(headFnStart, headFnEnd);
    assert.match(headFnBody, /auditStateClass\(box\.state\)/);
  });

  test('the actions line never renders a calls/tools count — fwdloop has no per-step call/tool book to fill it from', () => {
    const fnStart = source.indexOf('function buildStepActionsLineEl(box, idx){');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.doesNotMatch(body, /calls|tools/i);
    // tokens are the one OPTIONAL extra, and only ever added when the
    // server sent a real total — never a bare "0 tokens".
    assert.match(body, /typeof box\.tokensTotal === "number"/);
  });

  test('Amendment M4a-3: the tools/allowed line reads box.toolsTotal/box.toolsWhy for "tools:" and box.primitives (the signed grant) for "allowed:", and is wired into the card', () => {
    const fnStart = source.indexOf('function buildStepToolsLineEl(box, idx){');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /box\.toolsWhy/);
    assert.match(body, /box\.toolsTotal/);
    assert.match(body, /box\.primitives\.join\(", "\)/);
    assert.match(body, /box\.ungranted/);
    assert.match(source, /var toolsLineEl = buildStepToolsLineEl\(box, idx\);/);
    assert.match(source, /if\(toolsLineEl\) card\.appendChild\(toolsLineEl\);/);
  });

  test('Amendment M4a-3: the tools/allowed line\'s exact wording — "tools: " prefix (or its toolsWhy fallback), "allowed: " prefix, and a red "not allowed: " for ungranted calls', () => {
    const fnStart = source.indexOf('function buildStepToolsLineEl(box, idx){');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.match(body, /"tools: " \+ box\.toolsWhy/);
    assert.match(body, /"tools: " \+ pairs\.join\(" · "\)/);
    assert.match(body, /"allowed: " \+ box\.primitives\.join\(", "\)/);
    assert.match(body, /"not allowed: " \+ box\.ungranted\.join\(", "\)/);
    // the ungranted half uses the page's own red token, not a hardcoded hex
    // or a second color scheme — the SAME `--red` `.mark.red`/`.badge.red`
    // already read elsewhere on this page.
    assert.match(body, /var\(--red\)/);
  });

  test('the "stopped" line is gated on box.stoppedReason (server-derived, one step only) and shows the FULL reason, never a truncated slice', () => {
    assert.match(source, /if\(box\.stoppedReason\) card\.appendChild\(textLineEl\("hint", "stopped: " \+ box\.stoppedReason/);
    // no truncation of the reason anywhere near the card builder (no
    // .slice(/.substring(/character-count cap on the stop text).
    const fnStart = source.indexOf('stepBoxes.forEach(function(box, idx){');
    const fnEnd = source.indexOf('\n    });', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.doesNotMatch(body, /\.slice\(|\.substring\(|\.substr\(/);
  });

  test('per-attempt rows/gap texts no longer render on the Run tab\'s step cards (they stay in the Audit tab)', () => {
    assert.doesNotMatch(source, /"step-attempt-" \+/);
    // the OLD `.attempt-row` CSS rule/className is gone (a plain word-match
    // would also flag this test's own explanatory comment mentioning the
    // class by name, so this checks the LIVE forms only: the CSS selector
    // and the `className = "attempt-row"` assignment).
    assert.doesNotMatch(source, /\.attempt-row\{/);
    assert.doesNotMatch(source, /className = "attempt-row"/);
  });

  // hamr's 2026-09-27 browser-walk bug: an expired, unresumed ask
  // (src/panel/data.js computeGlyph returns glyph '[!]') rendered as the
  // running arrow [▶] instead, because glyphClass mapped BOTH "[!]" and
  // "[▶]" onto the same "amber" CSS class, and .dot.amber::before draws
  // only one glyph. This is a real mapping check, not a regex for the new
  // class name alone: it parses glyphClass's own branches out of the
  // source, then follows each glyph to its class's OWN .dot.<class>::before
  // rule and asserts that rule's content is the exact glyph glyphClass
  // returned that class for. A regression that put "[!]" (or any other
  // glyph) back onto a class whose CSS draws a different glyph fails here.
  test('glyphClass maps every real glyph to a CSS dot class whose own ::before content is that exact glyph (never two glyphs sharing one dot class)', () => {
    const fnStart = source.indexOf('function glyphClass(g){');
    assert.ok(fnStart >= 0, 'expected to find function glyphClass(g){');
    const fnEnd = source.indexOf('\n  }', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    const glyphs = ['[✓]', '[✗]', '[▶]', '[?]', '[!]', '[·]'];
    assert.deepEqual(glyphs, ['[✓]', '[✗]', '[▶]', '[?]', '[!]', '[·]']);

    function classFor(glyph) {
      const escaped = glyph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const explicit = fnBody.match(new RegExp('if\\(g === "' + escaped + '"\\) return "(\\w+)";'));
      if (explicit) return explicit[1];
      // no explicit branch for this glyph — it must fall through to the
      // function's own final, unconditional return (today's fallback for
      // "[·]", the default/grey "waiting on a human" state).
      const fallback = fnBody.match(/return "(\w+)"; \/\/ "\[·\]"/);
      assert.ok(fallback, 'expected glyphClass\'s fallback return to be commented with its glyph, e.g. return "grey"; // "[·]" ...');
      return fallback[1];
    }

    for (const glyph of glyphs) {
      const cls = classFor(glyph);
      assert.ok(cls, `expected glyphClass to resolve a class for glyph ${glyph}`);
      const ruleMatch = source.match(new RegExp('\\.dot\\.' + cls + '::before\\{content:"(\\[.\\])"'));
      assert.ok(ruleMatch, `expected a .dot.${cls}::before{content:"..."} CSS rule (glyphClass maps ${glyph} to class "${cls}")`);
      assert.equal(
        ruleMatch[1],
        glyph,
        `glyphClass("${glyph}") returns class "${cls}", but .dot.${cls}::before draws "${ruleMatch[1]}" instead of "${glyph}"`,
      );
    }
  });
});
