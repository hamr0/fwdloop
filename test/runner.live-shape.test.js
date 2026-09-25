// M2 piece 2 — the end-to-end live-shape test: job #2's REAL signed fixture
// flow runs through `runFlow` with `makeLiveModelStep` on a FAKE provider
// (canned tool calls, $0-priced via injected rates — zero real network,
// zero real key) and the REAL file-ask protocol (`makeFileAskStep`),
// answered by this test writing `answer.json` while the run is paused.
// Proves: a planted softgreen red heals on attempt 2 (the M2 POC's own
// question — "a step that sees only the gap can heal" — exercised here
// through the real wiring, not the POC harness), the ask reaches a human
// and resumes on accept, the run completes, both books exist, and every
// spend.jsonl row carries `modelMatch`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow } from '../src/runner.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { makeFileAskStep } from '../src/ask.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-${prefix}-`));
}

/** A fake provider matching bare-agent's own `generate(messages, tools, options)`
 *  contract: consumes `artifacts` in order, one per successful round (a
 *  tool-call round emitting `emit_artifact`, then a finishing round with no
 *  tool call — the exact two-generate()-calls-per-round shape a real
 *  bare-agent Loop produces). */
function scriptedArtifactProvider(artifacts) {
  let i = 0;
  let awaitingFinish = false;
  let toolCallId = 0;
  return {
    generate: async () => {
      if (!awaitingFinish) {
        const artifact = artifacts[i];
        i += 1;
        awaitingFinish = true;
        toolCallId += 1;
        return {
          text: null,
          toolCalls: [{ id: `t${toolCallId}`, name: 'emit_artifact', arguments: artifact }],
          usage: { inputTokens: 50, outputTokens: 50 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      awaitingFinish = false;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash',
      };
    },
  };
}

const BAD_SUMMARY = { text: 'This draft has no headings at all and will not match the declared shape.', done: true };
const GOOD_SUMMARY = {
  text: 'summary of work history blurb\n'
    + 'Led engineering teams for five years, shipping several distributed systems products.\n\n'
    + 'professional skills\n'
    + 'Python, distributed systems, cloud infrastructure, API design.\n\n'
    + 'soft skills\n'
    + 'Clear technical writing, mentorship, and cross-team communication.',
  done: true,
};

async function waitFor(predicate, { timeoutMs = 3000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, pollMs); });
  }
}

test('job #2 live-shape: a planted softgreen red heals on attempt 2, the file ask resumes on accept, the run completes with both books and modelMatch on every spend row', async () => {
  const root = tmpRoot('live-shape');
  const written = writeFlow({
    root,
    name: 'job2',
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: 'hamr',
    signedAt: '2026-09-24T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

  const inputsDir = mktempInputs();
  const resumePath = path.join(inputsDir, 'resume.docx');
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(resumePath, 'placeholder — the fake provider never actually calls readDocx');
  writeFileSync(jdPath, '# JD placeholder — the fake provider never actually calls read');

  const runId = 'live-shape-1';
  const runDir = path.join(root, 'job2', 'runs', runId);
  const spendPath = path.join(runDir, 'spend.jsonl');

  const provider = scriptedArtifactProvider([
    { text: 'Resume: five years of engineering leadership.', done: true }, // step1 (hitl, readDocx)
    { text: 'JD: looking for an applied AI architect.', done: true }, // step2 (hitl, read)
    BAD_SUMMARY, // step3 attempt 1 — plants the red (no headings at all)
    GOOD_SUMMARY, // step3 attempt 2 — heals on the gap alone
  ]);
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });

  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000 });
  const sendStep = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

  const runPromise = runFlow({
    root,
    name: 'job2',
    runId,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep,
    primitives: {}, // the fake provider never calls a granted primitive tool
    businessDate: '2026-06-01',
  });

  // Wait for the ask to open, then answer it as a human would.
  const askPath = path.join(runDir, 'ask.json');
  const askOpened = await waitFor(() => existsSync(askPath));
  assert.ok(askOpened, 'the run must reach the human ask (job #2 fromLine 4)');
  const askJson = JSON.parse(readFileSync(askPath, 'utf8'));
  assert.match(askJson.question, /check it with me/);
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: new Date().toISOString() }));

  const result = await runPromise;
  assert.equal(result.outcome, 'complete', result.red ?? JSON.stringify(result.reds));

  // The softgreen red on attempt 1, then a green on attempt 2 — proved via audit.jsonl, not
  // just the final outcome (the POC's own question: does a gap-only channel heal?).
  const auditRows = readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const composeRows = auditRows.filter((r) => r.class === 'softgreen');
  assert.equal(composeRows.length, 2, 'exactly one red attempt then one green attempt for the compose step');
  assert.equal(composeRows[0].verdict, 'red');
  assert.match(composeRows[0].gap, /no line is exactly the heading/);
  assert.equal(composeRows[1].verdict, 'green');

  // Both books exist.
  assert.ok(existsSync(path.join(runDir, 'audit.jsonl')));
  assert.ok(existsSync(path.join(root, 'job2', 'history.jsonl')));
  const historyRows = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(historyRows[historyRows.length - 1].outcome, 'complete');

  // Every spend.jsonl row carries modelMatch (M2 scope item 7).
  const spendRows = readFileSync(spendPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(spendRows.length >= 4, `expected at least one spend row per model round, got ${spendRows.length}`);
  assert.ok(spendRows.every((r) => typeof r.modelMatch === 'string'));
  assert.ok(spendRows.every((r) => r.modelMatch === 'match'));
});

function mktempInputs() {
  return mkdtempSync(path.join(tmpdir(), 'fwdloop-live-shape-inputs-'));
}

test('job #2 live-shape: an ask timeout halts the run "ask-timeout", a pause spends nothing beyond the steps already run', async () => {
  const root = tmpRoot('live-shape-timeout');
  // M3 scope item 1 (fixes F43): the runner now threads the SIGNED ttl into
  // every ask, and no code default (e.g. `makeFileAskStep`'s own
  // `timeoutMs`) ever overrides it — so this test needs a short SIGNED ttl
  // ("ask 1s:") rather than relying on `timeoutMs` alone to fire fast.
  const shortTtlProse = fixture('job2-with-sources.signed.txt').replace('4. ask: check it with me,', '4. ask 1s: check it with me,');
  const written = writeFlow({
    root,
    name: 'job2',
    proseText: shortTtlProse,
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: 'hamr',
    signedAt: '2026-09-24T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

  const inputsDir = mktempInputs();
  const resumePath = path.join(inputsDir, 'resume.docx');
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(resumePath, 'placeholder');
  writeFileSync(jdPath, 'placeholder');

  const runId = 'live-shape-timeout-1';
  const spendPath = path.join(root, 'job2', 'runs', runId, 'spend.jsonl');

  const provider = scriptedArtifactProvider([
    { text: 'Resume placeholder.', done: true },
    { text: 'JD placeholder.', done: true },
    GOOD_SUMMARY,
  ]);
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  // The signed "ask 1s:" governs the wait (F43) — nobody ever answers.
  const askStep = makeFileAskStep({ pollMs: 10, timeoutMs: 50 });
  const sendStep = async () => ({ ok: true, bytes: 1 });

  const result = await runFlow({
    root,
    name: 'job2',
    runId,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep,
    primitives: {},
    businessDate: '2026-06-01',
  });

  assert.equal(result.outcome, 'ask-timeout');
  assert.match(result.red, /ask-timeout: step .* expired waiting for a human answer/);

  const historyRows = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = historyRows[historyRows.length - 1];
  assert.equal(last.outcome, 'ask-timeout');
});
