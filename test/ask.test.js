// Tests for src/ask.js — M2 piece 2. Real filesystem, temp directories,
// short timeouts/poll intervals so the suite stays fast; never a fixed
// sleep-then-assert — every wait polls the condition itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { makeFileAskStep, answerAsk } from '../src/ask.js';

function tmpRunDir() {
  return mkdtempSync(path.join(tmpdir(), 'fwdloop-ask-'));
}

test('writes ask.json with the question and evidence, then resolves once answer.json appears', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000 });
  const promise = askStep({ question: 'accept this draft?', evidence: { text: 'draft body' }, runDir });

  // Poll for ask.json to exist before answering — never a fixed sleep.
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  assert.ok(existsSync(askPath));
  const askJson = JSON.parse(readFileSync(askPath, 'utf8'));
  assert.equal(askJson.question, 'accept this draft?');
  assert.deepEqual(askJson.evidence, { text: 'draft body' });

  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: new Date().toISOString() }));
  const result = await promise;
  assert.equal(result.decision, 'accept');
});

test('consume-once: the answer file is renamed away after being read, never left for a second read to find', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: '2026-09-24T12:00:05.000Z' }));
  await promise;
  assert.equal(existsSync(path.join(runDir, 'answer.json')), false, 'answer.json must be consumed (renamed away)');
  assert.equal(existsSync(path.join(runDir, 'answer.2026-09-24T12-00-00-000Z.consumed.json')), true);
});

test('a stale answer (answeredAt before this ask\'s askedAt) is quarantined and never applied — the ask keeps waiting', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }

  // A stale answer arrives (answeredAt predates this ask's askedAt) —
  // simulates a redraft mid-flight racing an answer from the PRIOR ask.
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: '2026-09-24T11:59:00.000Z' }));

  // Poll: the stale file should get quarantined (answer.stale.1.json appears) while the promise
  // is still pending — proves the stale answer was NOT applied.
  const staleDeadline = Date.now() + 2000;
  while (!existsSync(path.join(runDir, 'answer.stale.1.json')) && Date.now() < staleDeadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(existsSync(path.join(runDir, 'answer.stale.1.json')), 'stale answer must be quarantined');

  let settled = false;
  promise.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settled, false, 'the ask must still be waiting — a stale answer never resolves it');

  const auditRows = readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(auditRows.some((r) => r.verdict === 'stale-answer-ignored'));

  // Now the REAL (fresh) answer arrives and the ask resolves.
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: '2026-09-24T12:00:10.000Z' }));
  const result = await promise;
  assert.equal(result.decision, 'accept');
});

test('PROOF the stale check can fail: a genuinely fresh answer (answeredAt after askedAt) is applied immediately, not quarantined', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'reject', reason: 'too long', answeredAt: '2026-09-24T12:00:01.000Z' }));
  const result = await promise;
  assert.equal(result.decision, 'reject');
  assert.equal(result.reason, 'too long');
  assert.equal(existsSync(path.join(runDir, 'answer.stale.1.json')), false);
});

test('timeout: no answer.json within timeoutMs resolves { decision: "timeout" }, never throws, never hangs', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 150 });
  const result = await askStep({ question: 'q', evidence: null, runDir });
  assert.equal(result.decision, 'timeout');
});

test('a rerun/reject decision with no reason is returned as-is — refusing an empty reason is runner.js\'s job, not ask.js\'s', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'rerun', answeredAt: '2026-09-24T12:00:01.000Z' }));
  const result = await promise;
  assert.equal(result.decision, 'rerun');
  assert.equal(result.reason, undefined);
});

// ---------------------------------------------------------------------------
// A present-but-unparseable ask.json "expiresAt" (Date.parse -> NaN) must
// never read as "not expired" — `NaN > x` and `x > NaN` are both false, so
// the naive comparison would silently treat garbage as open forever.
// answerAsk must refuse, naming the askId and the bad value.
// ---------------------------------------------------------------------------
test('answerAsk refuses a garbage (unparseable) expiresAt, naming the askId and the bad value, never treating it as not-expired', () => {
  const runDir = tmpRunDir();
  writeFileSync(path.join(runDir, 'ask.json'), JSON.stringify({
    askId: 'ask-1', question: 'q', evidence: null, askedAt: '2026-09-24T12:00:00.000Z', expiresAt: 'not-a-real-date',
  }));

  const result = answerAsk({ runDir, askId: 'ask-1', decision: 'accept' });
  assert.equal(result.ok, false);
  assert.match(result.red, /askId "ask-1" has an unparseable expiresAt "not-a-real-date"/);
  assert.equal(existsSync(path.join(runDir, 'answer.json')), false, 'a refused answerAsk must never write answer.json');
});
