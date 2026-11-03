// M4d am37, hamr's ask 2026-11-03 (not signed text): when round 2 (forced) or round 3 (fallback) saves, log.json keeps the round-1 text on that try as `firstText`;
// a round-1 save has no such key. $0: fake provider for the model step, fake modelStep for the run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { readAudit } from '../src/books.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const U = { inputTokens: 10, outputTokens: 5 };
const textRound = (t) => ({ text: t, toolCalls: [], usage: U, stopReason: 'stop', model: 'm-1' });
const saveRound = () => ({ text: '', toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { text: GOOD, done: true } }], usage: U, stopReason: 'tool_calls', model: 'm-1' });

// a model step whose provider answers the summary step by `script(callNo, options)`; every other step saves on round 1
function liveFor(dir, script) {
  const provider = {
    generate: async (messages, tools, options = {}) => {
      if (messages[messages.length - 1]?.role === 'tool') return textRound('saved');
      const goal = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      if (!goal.includes('Draft the summary resume')) return saveRound();
      provider.n += 1;
      return script(provider.n, options);
    },
    n: 0,
  };
  return makeLiveModelStep({ spendPath: path.join(dir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'm-1' });
}

async function runWith(t, script) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am37ft-'));
  const src = mkdtempSync(path.join(tmpdir(), 'fwdloop-am37ft-src-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); });
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: cat.primitives,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const modelStep = liveFor(root, script);
  const parked = await runFlow({
    root, name: 'job2', runId: 'run-1', catalogue: cat.primitives, modelStep, sendStep: async () => ({ ok: true, bytes: 2 }), primitives: {}, businessDate: '2026-06-01',
    askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const log = JSON.parse(readFileSync(path.join(parked.runDir, 'log.json'), 'utf8'));
  return { log, rows: readAudit(parked.runDir) };
}

const summaryTry = (log) => log.attempts.find((a) => a.step === 'resume-summary');
const summaryRow = (rows) => rows.find((r) => r.step === 'resume-summary');

test('a forced save: log.json keeps the round-1 text exactly; the audit row does not carry it', async (t) => {
  const { log, rows } = await runWith(t, (n) => (n === 1 ? textRound('the long first answer') : saveRound()));
  assert.equal(summaryRow(rows).savedBy, 'forced');
  assert.equal(summaryTry(log).firstText, 'the long first answer');
  assert.ok(!('firstText' in summaryRow(rows)), 'rows stay small');
});

test('a fallback save: log.json keeps the round-1 text', async (t) => {
  const { log, rows } = await runWith(t, (n, o) => { if (n === 1) return textRound('first words'); if (o.toolChoice) throw new Error('400 tool_choice'); return saveRound(); });
  assert.equal(summaryRow(rows).savedBy, 'fallback');
  assert.equal(summaryTry(log).firstText, 'first words');
});

test('a round-1 save: no firstText key', async (t) => {
  const { log, rows } = await runWith(t, () => saveRound());
  assert.equal(summaryRow(rows).savedBy, 'first');
  assert.ok(!('firstText' in summaryTry(log)));
});

test('a long round-1 text is cut at the same bound as raw arguments, the cut said out loud', async (t) => {
  const { log } = await runWith(t, (n) => (n === 1 ? textRound('x'.repeat(2500)) : saveRound()));
  assert.equal(summaryTry(log).firstText, `${'x'.repeat(2000)}… (500 more chars)`);
});
