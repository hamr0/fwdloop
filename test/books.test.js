import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendAudit, appendHistory, auditRowTokens, auditRowTools,
} from '../src/books.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'fwdloop-books-'));
}

const AT = '2026-09-27T00:00:00.000Z';

test('appendAudit: writes one JSON line, append-only', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }, tools: { read: 1 },
  });
  appendAudit(dir, {
    step: 's1', attempt: 2, class: 'green', verdict: 'red', gap: 'oops', usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }, tools: { read: 1 },
  });
  const lines = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).attempt, 1);
  assert.equal(JSON.parse(lines[1]).verdict, 'red');
});

test('appendAudit: refuses a row whose usd is undefined — never "?? 0"', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, spendComplete: true, wallMs: 5, model: null, tokens: null, at: AT,
  }), /never "\?\? 0"/);
  assert.equal(existsSync(join(dir, 'audit.jsonl')), false);
});

test('appendAudit: a null usd is refused unless spendComplete is false', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'pricing-red', gap: null, usd: null, spendComplete: true, wallMs: 5, model: null, tokens: null, at: AT,
  }), /only allowed with spendComplete:false/);
});

test('appendAudit: a null usd is allowed with spendComplete:false', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'pricing-red', gap: null, usd: null, spendComplete: false, wallMs: 5, model: null, tokens: null, tools: null, at: AT,
  });
  const row = JSON.parse(readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim());
  assert.equal(row.usd, null);
});

// ---------------------------------------------------------------------------
// Amendment M4a-2 — SIGNED by hamr 2026-09-27 ("sign mfa2", = M4a-2).
// ---------------------------------------------------------------------------

test('M4a-2 (a): a model-call row written without tokens is refused, naming the row', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: null,
  }), /appendAudit.*tokens.*model/);
  assert.equal(existsSync(join(dir, 'audit.jsonl')), false);
});

test('M4a-2: tokens must be an object of three non-negative integers when not null', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: -1, outputTokens: 0, cacheReadTokens: 0 },
  }), /non-negative integer/);
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: 'nope',
  }), /must be null or an object/);
});

test('M4a-2: tokens is refused when omitted entirely (undefined) — never silently absent', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: null, strike: false, at: AT,
  }), /"tokens" must not be undefined/);
});

test('M4a-2: a no-model-call row carries tokens:null, cleanly', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: null, attempt: null, class: null, verdict: 'ask-expired', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: AT, tokens: null, tools: null,
  });
  const row = JSON.parse(readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim());
  assert.equal(row.tokens, null);
});

test('M4a-2 (c): a row with an invalid or missing "at" is refused', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: null, tokens: null, at: 'not-a-date',
  }), /"at" must be a valid ISO timestamp/);
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: null, tokens: null,
  }), /"at" must be a valid ISO timestamp/);
  assert.equal(existsSync(join(dir, 'audit.jsonl')), false);
});

test('M4a-2 (c) proven able to fail: a valid "at" is accepted', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: null, tokens: null, tools: null, at: AT,
  });
  const row = JSON.parse(readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim());
  assert.equal(row.at, AT);
});

test('auditRowTokens: a pre-M4a-2 row (no "tokens" key at all) reads as "not recorded", never invented', () => {
  const preM4a2Row = {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false,
  };
  const result = auditRowTokens(preM4a2Row);
  assert.equal(result.tokens, null);
  assert.match(result.why, /before M4a-2/);
});

test('auditRowTokens: a post-M4a-2 row reads back exactly what was written, including a genuine tokens:null', () => {
  assert.deepEqual(
    auditRowTokens({ model: 'x', tokens: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 } }),
    { tokens: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 } },
  );
  assert.deepEqual(auditRowTokens({ model: null, tokens: null }), { tokens: null });
});

// ---------------------------------------------------------------------------
// Amendment M4a-3 — SIGNED by hamr 2026-09-27 ("sign m4a3").
// ---------------------------------------------------------------------------

test('M4a-3 (a)/write-time: a model-call row written without "tools" is refused, naming the row', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
  }), /appendAudit.*"tools" must not be undefined/);
  assert.equal(existsSync(join(dir, 'audit.jsonl')), false);
});

test('M4a-3: "tools" must be null or a plain object of non-negative integers', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: { read: -1 },
  }), /non-negative integer/);
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: 'nope',
  }), /must be null or an object/);
});

test('M4a-3: "tools" is refused as null when the row IS a model call — mirrors the tokens/model check', () => {
  const dir = tmpDir();
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: null,
  }), /"tools" is null but "model" is "x"/);
});

test('M4a-3 (c): a no-model-call row cleanly carries tools:null', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: null, attempt: null, class: null, verdict: 'ask-expired', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: AT, tokens: null, tools: null,
  });
  const row = JSON.parse(readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim());
  assert.equal(row.tools, null);
});

test('M4a-3 (b)/write-time: "ungranted", when present, must be an array of strings', () => {
  const dir = tmpDir();
  appendAudit(dir, {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: { read: 1 }, ungranted: ['grep'],
  });
  const row = JSON.parse(readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim());
  assert.deepEqual(row.ungranted, ['grep']);

  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 2, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: { read: 1 }, ungranted: 'grep',
  }), /"ungranted" must be an array of strings/);
  assert.throws(() => appendAudit(dir, {
    step: 's1', attempt: 3, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: { read: 1 }, ungranted: [1, 2],
  }), /"ungranted" must be an array of strings/);
});

test('M4a-3 (c): auditRowTools — a pre-M4a-3 row (no "tools" key at all) reads as "not recorded", never invented', () => {
  const preM4a3Row = {
    step: 's1', attempt: 1, class: 'green', verdict: 'green', gap: null, usd: 0.01, spendComplete: true, wallMs: 5, model: 'x', modelMatch: true, strike: false, at: AT, tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
  };
  const result = auditRowTools(preM4a3Row);
  assert.equal(result.tools, null);
  assert.deepEqual(result.ungranted, []);
  assert.match(result.why, /before M4a-3/);
});

test('auditRowTools: a post-M4a-3 row reads back exactly what was written, including a genuine tools:null and a present ungranted', () => {
  assert.deepEqual(
    auditRowTools({ model: 'x', tools: { read: 2 }, ungranted: ['grep'] }),
    { tools: { read: 2 }, ungranted: ['grep'] },
  );
  assert.deepEqual(auditRowTools({ model: null, tools: null }), { tools: null, ungranted: [] });
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
