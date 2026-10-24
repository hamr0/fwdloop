// F83 bug 2: a lesson's run-end notes count on ONE row per workflow, whatever the plan version (signature hash) of each run.
// M8 item 3 (signed): "'This job' means the same workflow name". Fake run folders in mkdtemp; the real ~/.config/fwdloop is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { learnAtRunEnd, readLedger, hintsForRun, placeSpecOf } from '../src/learnstore.js';

const GAP = '640 words, limit 600; no line is exactly the heading "Work History"';
const NOW = new Date('2026-10-23T12:00:00Z');
const jl = (/** @type {any[]} */ rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const tryRow = (/** @type {any} */ o) => ({ step: 's1', attempt: 1, class: 'softgreen', verdict: 'red', gap: null, usd: 0.001, spendComplete: true, model: 'deepseek-flash', at: '2026-10-23T10:00:00.000Z', ...o });
const ROWS = [tryRow({ gap: GAP }), tryRow({ attempt: 2, verdict: 'softgreen' })];

function runFolder(/** @type {any} */ t) {
  const root = mkdtempSync(join(tmpdir(), 'fwdloop-f83-row-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'run-1');
  mkdirSync(join(dir, 'job'), { recursive: true });
  mkdirSync(join(dir, 'artifacts'));
  writeFileSync(join(dir, 'audit.jsonl'), jl(ROWS));
  writeFileSync(join(dir, 'log.json'), JSON.stringify({ runId: 'run-1', outcome: 'complete', attempts: [{ step: 's1', attempt: 1, modelOutput: { text: 'long' } }, { step: 's1', attempt: 2, modelOutput: { text: 'short' } }], artifacts: {} }));
  writeFileSync(join(dir, 'checks.jsonl'), jl([{ step: 's1', try: 1, checks: [{ n: 1, text: 'at most 600 words', ok: false }] }]));
  writeFileSync(join(dir, 'job', 'prose.txt'), 'Write a short resume summary.\n\nMore.');
  writeFileSync(join(dir, 'job', 'declaration.json'), JSON.stringify({ steps: [{ emits: 's1', goal: 'summarise', fromLine: 3 }] }));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ inputs: [{ id: 'resume', source: '/nonexistent/resume.docx' }] }));
  writeFileSync(join(dir, 'artifacts', 's1.json'), '{}');
  return dir;
}
const home = (/** @type {any} */ t) => { const d = mkdtempSync(join(tmpdir(), 'fwdloop-f83-home-')); t.after(() => rmSync(d, { recursive: true, force: true })); writeFileSync(join(d, 'config.json'), JSON.stringify({ learningHints: true })); return d; };

test('F83: two runs of one workflow under different plan hashes fold the same lesson onto one row (count 2), shown once', (t) => {
  const h = home(t);
  learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: runFolder(t), specHash: 'hash-a', now: NOW });
  learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-2', runDir: runFolder(t), specHash: 'hash-b', now: NOW });
  const { ledger } = readLedger(h);
  assert.equal(ledger.rows.length, 1, 'one lesson, one row');
  assert.equal(ledger.rows[0].count, 2);
  assert.deepEqual(ledger.rows[0].runIds, ['aging-1/run-1', 'aging-1/run-2']);
  const block = hintsForRun({ home: h, spec: placeSpecOf('aging-1', '/nonexistent/resume.docx'), specHash: null, now: NOW });
  assert.equal(block?.ids.length, 1, 'the hint block shows the lesson once');
});

test('F83: a different workflow name still gets its own row', (t) => {
  const h = home(t);
  learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: runFolder(t), specHash: 'hash-a', now: NOW });
  learnAtRunEnd({ home: h, workflow: 'aging-2', runId: 'run-1', runDir: runFolder(t), specHash: 'hash-a', now: NOW });
  assert.equal(readLedger(h).ledger.rows.length, 2);
});
