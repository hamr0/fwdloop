import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendAudit, appendHistory } from '../src/books.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'fwdloop-books-'));
}

test('appendAudit: writes one JSON line, append-only', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false,
  });
  appendAudit(dir, {
    step: 's1', attempt: 2, class: 'green', verdict: 'red', gap: 'oops', usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false,
  });
  const lines = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).attempt, 1);
  assert.equal(JSON.parse(lines[1]).verdict, 'red');
});

test('appendAudit: refuses a row whose usd is undefined — never "?? 0"', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, spendComplete: true, wallMs: 5,
  }), /never "\?\? 0"/);
  assert.equal(existsSync(join(dir, 'audit.jsonl')), false);
});

test('appendAudit: a null usd is refused unless spendComplete is false', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'pricing-red', gap: null, usd: null, spendComplete: true, wallMs: 5,
  }), /only allowed with spendComplete:false/);
});

test('appendAudit: a null usd is allowed with spendComplete:false', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'pricing-red', gap: null, usd: null, spendComplete: false, wallMs: 5,
  });
  const row = JSON.parse(readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim());
  assert.equal(row.usd, null);
});

test('appendHistory: writes one row keyed by spentUsd, same discipline', () => {
  const dir = tmpDir();
  appendHistory(dir, {
    runId: 'r1', at: '2026-09-24T00:00:00Z', outcome: 'complete', spentUsd: 0.5, spendComplete: true, capUsd: 5, wallMs: 100, signatureHash: 'abc',
  });
  assert.throws(() => appendHistory(dir, {
    runId: 'r2', at: '2026-09-24T00:00:00Z', outcome: 'provider-red', spendComplete: true, capUsd: 5, wallMs: 100, signatureHash: null,
  }), /never "\?\? 0"/);
  const lines = readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
});
