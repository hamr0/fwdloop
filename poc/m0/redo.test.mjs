import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askWithRedo } from './redo.mjs';

function newRunDir() {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-redo-'));
  return { runDir, auditPath: join(runDir, 'audit.jsonl') };
}

function readAudit(auditPath) {
  let raw;
  try {
    raw = readFileSync(auditPath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

// Fake `attempt` that always writes to the same artifact path (attempt
// content doesn't matter for these tests — the fakes script decisions).
function fakeAttempt(calls) {
  return async (n, reason) => {
    calls.push({ n, reason });
    return { ok: true, artifactPath: `/fake/artifact-${n}.txt`, costUsd: 0.01 };
  };
}

function scriptedAsk(script) {
  let i = 0;
  return async (n, artifactPath) => {
    if (i >= script.length) throw new Error(`scriptedAsk: ran out of scripted answers at call ${i} (n=${n}, artifactPath=${artifactPath})`);
    const answer = script[i];
    i += 1;
    return answer;
  };
}

const alwaysGreen = () => ({ verdict: 'green' });

test('accept on attempt 1 writes exactly one audit row', async () => {
  const { runDir, auditPath } = newRunDir();
  const attemptCalls = [];
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt(attemptCalls),
    ask: scriptedAsk([{ decision: 'accept', text: null }]),
    close: alwaysGreen,
    auditPath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(attemptCalls.length, 1);
  const rows = readAudit(auditPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attempt');
  assert.equal(rows[0].decision, 'accept');
  assert.equal(rows[0].attempt, 1);
  assert.equal(rows[0].parent, null);
});

test('reject twice then accept: 3 attempts, reasons threaded to the NEXT attempt call', async () => {
  const { runDir, auditPath } = newRunDir();
  const attemptCalls = [];
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt(attemptCalls),
    ask: scriptedAsk([
      { decision: 'rerun', text: 'too long, trim it' },
      { decision: 'rerun', text: 'missing the JD comparison' },
      { decision: 'accept', text: null },
    ]),
    close: alwaysGreen,
    auditPath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(attemptCalls.length, 3);
  assert.equal(attemptCalls[0].reason, null);
  assert.equal(attemptCalls[1].reason, 'too long, trim it');
  assert.equal(attemptCalls[2].reason, 'missing the JD comparison');
  // PROOF the reasons are actually threaded, not coincidentally identical:
  assert.notEqual(attemptCalls[1].reason, attemptCalls[2].reason);

  const rows = readAudit(auditPath);
  const attemptRows = rows.filter((r) => r.kind === 'attempt');
  assert.equal(attemptRows.length, 3);
  assert.equal(attemptRows[1].parent, 1);
  assert.equal(attemptRows[2].parent, 2);
});

test('a reason-less rerun is refused and re-asks the SAME attempt — no second attempt() call', async () => {
  const { runDir, auditPath } = newRunDir();
  const attemptCalls = [];
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt(attemptCalls),
    ask: scriptedAsk([
      { decision: 'rerun', text: '   ' }, // whitespace only -> refused
      { decision: 'accept', text: null },
    ]),
    close: alwaysGreen,
    auditPath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(attemptCalls.length, 1, 'attempt() must be called exactly once — a refusal is not a redo');
  const rows = readAudit(auditPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'refused');
  assert.equal(rows[0].why, 'reason required');
  assert.equal(rows[1].kind, 'attempt');
  assert.equal(rows[1].decision, 'accept');
});

test('PROOF the test can fail: 4 rejections halt naming the step, with exactly 4 attempt rows plus a halt row', async () => {
  const { runDir, auditPath } = newRunDir();
  const attemptCalls = [];
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt(attemptCalls),
    ask: scriptedAsk([
      { decision: 'rerun', text: 'reason 1' },
      { decision: 'rerun', text: 'reason 2' },
      { decision: 'rerun', text: 'reason 3' },
      { decision: 'rerun', text: 'reason 4' },
    ]),
    close: alwaysGreen,
    redoCap: 3,
    auditPath,
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /redo cap 3 reached at step summarize after 4 rejections/);
  assert.equal(attemptCalls.length, 4);
  const rows = readAudit(auditPath);
  const attemptRows = rows.filter((r) => r.kind === 'attempt');
  const haltRows = rows.filter((r) => r.kind === 'halt');
  assert.equal(attemptRows.length, 4);
  assert.equal(haltRows.length, 1);
  assert.equal(haltRows[0].stepName, 'summarize');
  assert.equal(haltRows[0].rejections, 4);
});

test('a close red ends the run red WITHOUT calling ask for that attempt', async () => {
  const { runDir, auditPath } = newRunDir();
  const attemptCalls = [];
  let askCalls = 0;
  const ask = async () => { askCalls += 1; return { decision: 'accept', text: null }; };
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt(attemptCalls),
    ask,
    close: () => ({ verdict: 'red', red: '601 words, limit 600' }),
    auditPath,
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /close red/);
  assert.equal(askCalls, 0, 'a machine close-red must never reach the ask');
});

test('redoCap outside 1..3 is refused as red naming the cap', async () => {
  const { runDir, auditPath } = newRunDir();
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt([]),
    ask: scriptedAsk([]),
    close: alwaysGreen,
    redoCap: 4,
    auditPath,
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /redo cap 4 is invalid/);
});

test('a null (unknown) cost is never coerced to 0 and flips costUnknown true', async () => {
  const { runDir, auditPath } = newRunDir();
  const attempt = async (n) => ({ ok: true, artifactPath: `/fake/a-${n}.txt`, costUsd: null });
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt,
    ask: scriptedAsk([{ decision: 'accept', text: null }]),
    close: alwaysGreen,
    auditPath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.costUnknown, true);
  assert.equal(result.costUsd, 0, 'known-cost sum stays 0 (no attempts had a known cost) — costUnknown carries the "not really zero" signal');
});

test('PROOF the test can fail: an unrecognised ask decision is red naming it', async () => {
  const { runDir, auditPath } = newRunDir();
  const result = await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt([]),
    ask: scriptedAsk([{ decision: 'maybe', text: null }]),
    close: alwaysGreen,
    auditPath,
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /unrecognised ask decision "maybe"/);
});

test('audit rows carry at (ISO) and runDir', async () => {
  const { runDir, auditPath } = newRunDir();
  mkdirSync(runDir, { recursive: true });
  await askWithRedo({
    runDir,
    stepName: 'summarize',
    attempt: fakeAttempt([]),
    ask: scriptedAsk([{ decision: 'accept', text: null }]),
    close: alwaysGreen,
    auditPath,
  });
  const rows = readAudit(auditPath);
  assert.equal(rows[0].runDir, runDir);
  assert.equal(typeof rows[0].at, 'string');
  assert.doesNotThrow(() => new Date(rows[0].at).toISOString());
});
