// M4e amendment 24 POC — $0 tests for the harness: a fake provider, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { ceilingCostUsd } from '../../src/provider.js';
import { runBatch, evaluate } from './run.mjs';
import { normalizeQuestions, buildPocSchema, QUESTIONS_PROMPT, draftWithQuestions } from './draft.mjs';
import { JOBS, VAGUE, CLEAR } from './jobs.mjs';
import {
  RATES, MODEL, validArgs, fakeProvider, toolReply, truncatedReply,
} from '../m6a/fixture.mjs';

/** job 2 prose with a signed ask wait (poc/m6a/job2.prose.txt predates the wait rule; the test fixture has it), sources in tmp. */
function job2Fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am24-in-'));
  const resume = path.join(dir, 'resume.md');
  const jd = path.join(dir, 'jd.md');
  writeFileSync(resume, '# Jo Doe\n\nSenior engineer, ten years.\n');
  writeFileSync(jd, '# About the role\n\nBuild things.\n\n## Responsibilities\n\nShip.\n');
  const prose = readFileSync(new URL('../../test/fixtures/job2-m6a.prose.txt', import.meta.url), 'utf8')
    .replace('@RESUME@', resume).replace('@JD@', jd);
  return { dir, prose };
}

const quiet = () => {};
const outDir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-am24-'));
const inj = (replies) => ({ provider: fakeProvider(replies), rates: RATES, modelId: MODEL });
const withQ = (questions, extra = {}) => ({ ...validArgs(), questions, ...extra });

test('fixtures: 10 vague + 10 clear, every one parses, unique ids', async () => {
  assert.equal(VAGUE.length, 10); assert.equal(CLEAR.length, 10);
  assert.equal(new Set(JOBS.map((j) => j.id)).size, 20);
  const { parseSignedText } = await import('../../src/signed-text.js');
  for (const j of JOBS) assert.equal(parseSignedText(j.prose).ok, true, j.id);
});

test('normalizeQuestions: bad line dropped, nonexistent line dropped, third dropped, each with a reason', () => {
  const lines = [1, 2, 3, 4];
  const r = normalizeQuestions([
    { question: 'no line at all' },
    { line: 9, question: 'line 9 in a 4-line job' },
    { line: 2, question: 'ok one' },
    { line: 3, question: 'ok two' },
    { line: 1, question: 'a third question' },
  ], lines);
  assert.deepEqual(r.kept.map((q) => q.line), [2, 3]);
  assert.deepEqual(r.dropped.map((d) => d.reason), ['no line', 'line 9 does not exist', 'third question']);
  assert.deepEqual(normalizeQuestions(undefined, lines), { kept: [], dropped: [] });
});

test('schema: questions/notChecked are optional additions to the real drafter schema; prompt carries the real checkable list', () => {
  const s = buildPocSchema([{ verb: 'read' }]);
  assert.ok(s.properties.questions && s.properties.notChecked && s.properties.steps);
  assert.ok(!s.required.includes('questions') && !s.required.includes('notChecked'));
  for (const w of ['green', 'sections', 'wordsPerSection', 'linesPerInvoice', 'mustCarry', 'hitl']) assert.match(QUESTIONS_PROMPT, new RegExp(w));
});

test('draft: bad-line and third-question are dropped and counted; declaration still valid; notChecked recorded', async () => {
  const { prose } = job2Fixture();
  const r = await draftWithQuestions({
    proseText: prose,
    ...inj([toolReply(withQ([
      { line: 9, question: 'beyond the job' }, { line: 3, question: 'how long?' }, { line: 4, question: 'where to?' }, { line: 1, question: 'third' },
    ], { notChecked: ['tone', ' '] }))]),
  });
  assert.equal(r.stop, null);
  assert.equal(r.declarationValid, true);
  assert.deepEqual(r.questions.map((q) => q.line), [3, 4]);
  assert.deepEqual(r.droppedQuestions.map((d) => d.reason), ['line 9 does not exist', 'third question']);
  assert.deepEqual(r.notChecked, ['tone']);
  assert.ok(r.costUsd > 0 && r.tokens.outputTokens > 0 && r.rounds === 1);
});

test('draft: a max_tokens stop is truncation (stop structure), never "no tool call"; both rounds metered', async () => {
  const { prose } = job2Fixture();
  const r = await draftWithQuestions({ proseText: prose, ...inj([truncatedReply()]) });
  assert.equal(r.stop, 'structure');
  assert.match(r.stopReason, /^truncated/);
  assert.equal(r.rounds, 2);
  assert.equal(r.declarationValid, false);
  assert.ok(r.costUsd > 0);
});

test('batch: empty / missing key refuses at $0 before any ledger write', async () => {
  const dir = outDir();
  for (const env of [{ DEEPSEEK_API_KEY: '' }, {}, { DEEPSEEK_API_KEY: '   ' }]) {
    await assert.rejects(runBatch({ tag: 'k', outDir: dir, env, writeLine: quiet }), /key:/);
  }
  assert.equal(existsSync(path.join(dir, 'spend.jsonl')), false);
  assert.equal(existsSync(path.join(dir, 'results-k.json')), false);
});

test('batch: runs, books every job, writes results-<tag>.json; an existing tag refuses', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  const jobs = [{ id: 'a', kind: 'vague', prose, why: 'x' }, { id: 'b', kind: 'clear', prose, why: 'y' }];
  const provider = fakeProvider([toolReply(withQ([{ line: 3, question: 'size?' }])), toolReply(withQ([]))]);
  const { records } = await runBatch({ tag: 't1', jobs, outDir: dir, injected: { provider, rates: RATES, modelId: MODEL }, writeLine: quiet, env: {} });
  assert.equal(records[0].questions.length, 1);
  assert.equal(records[1].questions.length, 0);
  const res = JSON.parse(readFileSync(path.join(dir, 'results-t1.json'), 'utf8'));
  assert.equal(res.records.length, 2);
  assert.equal(res.records[0].declarationValid, true);
  assert.equal(readFileSync(path.join(dir, 'spend.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(res.summary.verdict.pass, false, 'a 2-job run is incomplete, never a pass');
  await assert.rejects(runBatch({ tag: 't1', jobs, outDir: dir, injected: inj([toolReply(withQ([]))]), writeLine: quiet, env: {} }), /already has results/);
});

test('batch: the spend stop halts before the next job would pass the line, and says so', async () => {
  const { prose } = job2Fixture();
  const jobs = ['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'clear', prose, why: '' }));
  const ceiling = ceilingCostUsd(MODEL);
  const probe = await runBatch({ tag: 'p', jobs: jobs.slice(0, 1), outDir: outDir(), injected: inj([toolReply(withQ([]))]), writeLine: quiet, env: {} });
  const one = probe.records[0].costUsd;
  assert.ok(one > 0);
  const dir = outDir();
  const r = await runBatch({
    tag: 's', jobs, outDir: dir, stopUsd: ceiling + one * 1.5, injected: inj([toolReply(withQ([]))]), writeLine: quiet, env: {},
  });
  assert.equal(r.records.length, 2, 'job 1 and 2 ran; before job 3 the ledger + ceiling passes the line');
  assert.match(r.summary.stoppedBy, /^spend:/);
  assert.equal(r.summary.verdict.pass, false);
  // a pre-seeded ledger over the line stops before the first job
  const dir2 = outDir();
  writeFileSync(path.join(dir2, 'spend.jsonl'), `${JSON.stringify({ runId: 'x', model: MODEL, costUsd: 0.39999 })}\n`);
  const r2 = await runBatch({ tag: 's2', jobs, outDir: dir2, injected: inj([toolReply(withQ([]))]), writeLine: quiet, env: {} });
  assert.equal(r2.records.length, 0);
});

test('evaluate: the bar can fail (vague silent, clear chatty, a broken call, an invalid declaration)', () => {
  const rec = (kind, q, over = {}) => ({ kind, questions: Array(q).fill({ line: 1, question: 'x' }), stop: null, declarationValid: true, ...over });
  const good = [...Array(10).fill(0).map(() => rec('vague', 1)), ...Array(10).fill(0).map(() => rec('clear', 0))];
  assert.equal(evaluate(good).pass, true);
  assert.equal(evaluate([...good.slice(0, 3).map(() => rec('vague', 0)), ...good.slice(3)]).pass, false, 'vague jobs got no question');
  assert.equal(evaluate([...good.slice(0, 10), ...Array(10).fill(0).map(() => rec('clear', 1))]).pass, false, 'clear jobs all got a question');
  assert.equal(evaluate([rec('vague', 1, { stop: 'structure' }), ...good.slice(1)]).pass, false, 'a call broke');
  assert.equal(evaluate(good.map((r, i) => (i < 3 ? { ...r, declarationValid: false } : r))).pass, false, '3 invalid declarations');
});
