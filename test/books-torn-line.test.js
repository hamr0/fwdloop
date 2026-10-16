// Fix ledger (2026-10-16): a crash can tear the last line of an append-only book. The next append must start on a fresh line, or it glues onto the torn
// bytes, the glued line fails to parse, is skipped, and the row is lost (an end row lost = the run reads as not ended, the books stop balancing).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { appendAudit, appendHistory, appendPidRow, readAudit, readHistory, readPidRows } from '../src/books.js';
import { appendOutcome, readOutcomes } from '../src/panel/authortrigger.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-booktorn-'));
const TORN = '{"runId":"run-1","at":"2026-10-1';   // a row cut off mid-write: no closing brace, no newline

test('history.jsonl: an end row appended after a torn last line is read back, and the torn bytes stay on their own line', () => {
  const flowDir = tmp();
  appendHistory(flowDir, { runId: 'run-1', at: '2026-10-16T09:00:00Z', outcome: 'green', spentUsd: 0.01, spendComplete: true, capUsd: 1, wallMs: 5, signatureHash: 'h' });
  appendFileSync(path.join(flowDir, 'history.jsonl'), TORN);
  appendHistory(flowDir, { runId: 'run-2', at: '2026-10-16T10:00:00Z', outcome: 'green', spentUsd: 0.02, spendComplete: true, capUsd: 1, wallMs: 6, signatureHash: 'h' });
  assert.deepEqual(readHistory(flowDir).map((r) => r.runId), ['run-1', 'run-2'], 'the new end row survives the torn line before it');
  assert.equal(readFileSync(path.join(flowDir, 'history.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"run-2"')).length, 1);
});

test('audit.jsonl: an attempt row appended after a torn last line is read back', () => {
  const runDir = tmp();
  const row = (step) => ({ step, attempt: 1, class: 'x', verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 1, model: null, modelMatch: true, strike: 0, at: '2026-10-16T09:00:00Z', tokens: null, tools: null });
  appendAudit(runDir, row('a'));
  appendFileSync(path.join(runDir, 'audit.jsonl'), '{"step":"b","att');
  appendAudit(runDir, row('c'));
  assert.deepEqual(readAudit(runDir).map((r) => r.step), ['a', 'c']);
});

test('pids.jsonl: a pid row appended after a torn last line is read back', () => {
  const runDir = tmp();
  appendPidRow(runDir, { pid: 1, startedAt: 'a', procStart: null, leg: 'run' });
  appendFileSync(path.join(runDir, 'pids.jsonl'), '{"pid":2,"sta');
  appendPidRow(runDir, { pid: 3, startedAt: 'c', procStart: null, leg: 'resume' });
  assert.deepEqual(readPidRows(runDir).map((r) => r.pid), [1, 3]);
});

test('triggers.jsonl: an outcome appended after a torn last line is read back', () => {
  const flowDir = tmp(); mkdirSync(flowDir, { recursive: true });
  appendOutcome(flowDir, { at: '2026-10-16T09:00:00Z', outcome: 'started' });
  appendFileSync(path.join(flowDir, 'triggers.jsonl'), '{"at":"2026-10-16T09:30');
  appendOutcome(flowDir, { at: '2026-10-16T10:00:00Z', outcome: 'refused' });
  assert.deepEqual(readOutcomes(flowDir).map((r) => r.outcome), ['started', 'refused']);
});

test('a clean file gets no blank line, and a first row needs no file at all', () => {
  const flowDir = tmp();
  appendHistory(flowDir, { runId: 'run-1', at: '2026-10-16T09:00:00Z', outcome: 'green', spentUsd: 0, spendComplete: true, capUsd: 1, wallMs: 1, signatureHash: 'h' });
  appendHistory(flowDir, { runId: 'run-2', at: '2026-10-16T09:01:00Z', outcome: 'green', spentUsd: 0, spendComplete: true, capUsd: 1, wallMs: 1, signatureHash: 'h' });
  const text = readFileSync(path.join(flowDir, 'history.jsonl'), 'utf8');
  assert.equal(text.split('\n').length, 3, 'two rows, each ended by a newline, nothing between them');
  assert.ok(!text.includes('\n\n'));
});
