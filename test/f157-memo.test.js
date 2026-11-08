// F157: the carry memo never shows the class word `hitl` as a result; it reads "done, for you to check at the Ask". Other verdict words stay as they are. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { buildMemo } from '../src/memo.js';

const row = (step, verdict, gap = null) => ({ step, attempt: 1, class: 'hitl', verdict, gap, usd: 0, spendComplete: true, wallMs: 1, model: 'm-1', modelMatch: true, strike: false, at: '2026-11-08T10:00:00.000Z', tokens: null, tools: {}, refused: [] });

function makeRun(rows) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-f157-'));
  mkdirSync(path.join(dir, 'job'));
  mkdirSync(path.join(dir, 'asks'));
  writeFileSync(path.join(dir, 'job', 'declaration.json'), JSON.stringify({ steps: [{ emits: 'garden_lines' }, { emits: 'jobs' }] }));
  writeFileSync(path.join(dir, 'audit.jsonl'), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ thinking: false, inputs: [] }));
  writeFileSync(path.join(dir, 'asks', 'a1.json'), JSON.stringify({ askId: 'a1', question: 'q', askedAt: '2026-11-08T10:01:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', evidence: {}, emits: 'garden_lines' }));
  writeFileSync(path.join(dir, 'answer.a1.consumed.json'), JSON.stringify({ askId: 'a1', decision: 'accept', answeredAt: '2026-11-08T10:01:00.000Z' }));
  return dir;
}

test('a hitl last try reads "done, for you to check at the Ask", never the class word', () => {
  const memo = buildMemo(makeRun([row('garden_lines', 'hitl')]), { step: 'jobs' });
  assert.ok(memo.split('\n').includes('last try: step garden_lines try 1 — result: done, for you to check at the Ask'), memo);
  assert.ok(!/hitl/.test(memo), memo);
});

test('other verdict words are unchanged', () => {
  for (const v of ['green', 'red', 'softgreen']) {
    const memo = buildMemo(makeRun([row('garden_lines', v)]), { step: 'jobs' });
    assert.ok(memo.includes(`last try: step garden_lines try 1 — result: ${v}`), memo);
  }
});
