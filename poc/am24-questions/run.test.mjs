// M4e amendment 25 POC — $0 tests for the harness: a fake provider, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { ceilingCostUsd } from '../../src/provider.js';
import { runBatch, evaluate } from './run.mjs';
import * as D from './draft.mjs';
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
/** Fails validateDeclaration; its red names steps[1] = job line 2. */
const bad = () => { const a = validArgs(); a.steps[1].primitives = ['nope']; return a; };
/** A fake provider that also records the tool schema each call was offered. */
function recProvider(replies) {
  const p = fakeProvider(replies);
  const inner = p.generate.bind(p);
  p.schemas = [];
  p.generate = async (messages, tools, options) => {
    p.schemas.push(JSON.parse(JSON.stringify(tools[0].parameters ?? tools[0].function?.parameters ?? tools[0].input_schema ?? null)));
    return inner(messages, tools, options);
  };
  return p;
}
const NUMBERISH = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|pair|dozen|single|once|twice|max|maximum|at most|up to|limit)\b/i;

test('fixtures: 10 vague + 10 clear, every one parses, unique ids', async () => {
  assert.equal(VAGUE.length, 10); assert.equal(CLEAR.length, 10);
  assert.equal(new Set(JOBS.map((j) => j.id)).size, 20);
  const { parseSignedText } = await import('../../src/signed-text.js');
  for (const j of JOBS) assert.equal(parseSignedText(j.prose).ok, true, j.id);
});

test('normalizeQuestions: a line try 2 did not fail on is dropped, a third is dropped, each with a reason', () => {
  const r = normalizeQuestions([
    { question: 'no line at all' },
    { line: 9, question: 'line 9 in a 4-line job' },
    { line: 1, question: 'a real line, but try 2 did not fail on it' },
    { line: 2, question: 'ok one' },
    { line: 3, question: 'ok two' },
    { line: 2, question: 'a third question' },
  ], [2, 3]);
  assert.deepEqual(r.kept.map((q) => q.line), [2, 3]);
  assert.deepEqual(r.dropped.map((d) => d.reason), [
    'no line', "line 9 is not a line try 2's checks failed on", "line 1 is not a line try 2's checks failed on", 'third question']);
  assert.deepEqual(normalizeQuestions(undefined, [1]), { kept: [], dropped: [] });
  assert.equal(normalizeQuestions([{ line: 1, question: 'x' }], []).kept.length, 0, 'no failed line means nothing may be asked');
});

test('linesNamedByReds: line N, steps[i] via fromLine, step N\'s check; a red naming no line names none', () => {
  const decl = { steps: [{ fromLine: 1 }, { fromLine: 3 }, { fromLine: null }] };
  const nums = [1, 2, 3, 4];
  assert.deepEqual(D.linesNamedByReds(['declaration: ask at line 4 has no step bound to it'], decl, nums), [4]);
  assert.deepEqual(D.linesNamedByReds(['declaration: steps[1].primitives names "x"'], decl, nums), [3]);
  assert.deepEqual(D.linesNamedByReds(["declaration: step 1's check reads its reply"], decl, nums), [1]);
  assert.deepEqual(D.linesNamedByReds(['declaration: steps[2] has no line', 'declaration: "refused" is required', 'line 9 is not real'], decl, nums), []);
});

test('schema: questions/notChecked are optional, off by default; no number or number word in the questions text', () => {
  const plain = buildPocSchema([{ verb: 'read' }]);
  assert.ok(!plain.properties.questions && !plain.properties.notChecked && plain.properties.steps);
  const s = buildPocSchema([{ verb: 'read' }], { questions: true, notChecked: true });
  assert.ok(s.properties.questions && s.properties.notChecked);
  assert.ok(!s.required.includes('questions') && !s.required.includes('notChecked'));
  assert.doesNotMatch(QUESTIONS_PROMPT, NUMBERISH);
  assert.doesNotMatch(JSON.stringify(s.properties.questions), NUMBERISH);
  assert.doesNotMatch(D.NOTCHECKED_PROMPT, NUMBERISH);
  for (const w of ['green', 'sections', 'wordsPerSection', 'linesPerInvoice', 'mustCarry', 'hitl']) assert.match(D.NOTCHECKED_PROMPT, new RegExp(w));
});

test('draft: a clean first draft offers no questions (schema had no questions property) and keeps none', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([toolReply(validArgs())]);
  const r = await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL });
  assert.equal(provider.calls.length, 1);
  assert.ok(provider.schemas[0] && provider.schemas[0].properties.steps, 'the recorded schema is the real one');
  assert.equal(provider.schemas[0].properties.questions, undefined);
  assert.equal(provider.schemas[0].properties.notChecked, undefined);
  assert.equal(r.passedTry1, true);
  assert.equal(r.passedTry2, null);
  assert.equal(r.declarationValid, true);
  assert.deepEqual(r.questions, []);
});

test('draft: try 2 is the real revision with no questions; a try 2 that passes never opens questions', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([toolReply(bad()), toolReply(validArgs())]);
  const r = await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL });
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.schemas[1].properties.questions, undefined, 'try 2 offers no questions');
  assert.match(provider.calls[1].messages[1].content, /REFUSED by the validator/);
  assert.match(provider.calls[1].messages[1].content, /steps\[1\]/, 'the reds are fed back');
  assert.doesNotMatch(provider.calls[1].messages[1].content, /"questions"/);
  assert.equal(provider.calls[1].messages[0].content, provider.calls[0].messages[0].content, 'same system prompt as try 1');
  assert.equal(r.passedTry1, false); assert.equal(r.passedTry2, true);
  assert.equal(r.declarationValid, true);
  assert.deepEqual(r.questions, []);
});

test('draft: a question sent on try 2 (not offered) is a stray key and reds, it is never kept', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([toolReply(bad()), toolReply(withQ([{ line: 2, question: 'sneaky' }])), toolReply(validArgs())]);
  const r = await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL });
  assert.equal(r.passedTry2, false);
  assert.deepEqual(r.questions, []);
});

test('draft: only after tries 1 and 2 both fail does try 3 offer questions; one on a non-failed line is dropped and logged', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([
    toolReply(bad()), toolReply(bad()),
    toolReply(withQ([{ line: 4, question: 'not a failed line' }, { line: 2, question: 'how long?' }], { notChecked: ['tone'] })),
  ]);
  const r = await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL });
  assert.equal(provider.calls.length, 3);
  assert.equal(provider.schemas[0].properties.questions, undefined);
  assert.equal(provider.schemas[1].properties.questions, undefined);
  assert.ok(provider.schemas[2].properties.questions && provider.schemas[2].properties.notChecked, 'try 3 offers them');
  assert.deepEqual(r.failedLines, [2]);
  assert.deepEqual(r.questions.map((q) => q.line), [2]);
  assert.deepEqual(r.droppedQuestions.map((d) => d.reason), ["line 4 is not a line try 2's checks failed on"]);
  assert.deepEqual(r.notChecked, ['tone']);
  assert.equal(r.passedTry1, false); assert.equal(r.passedTry2, false);
  assert.equal(r.stop, null);
  assert.ok(r.costUsd > 0 && r.rounds === 3);
});

test('draft: no number in what the drafter is told on try 3 beyond the real revision message', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([toolReply(bad()), toolReply(bad()), toolReply(withQ([]))]);
  await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL });
  const [, , c3] = provider.calls;
  const user = c3.messages[1].content;
  const added = user.slice(user.indexOf(QUESTIONS_PROMPT));
  assert.equal(added, QUESTIONS_PROMPT, 'try 3 ends with the questions line');
  assert.doesNotMatch(added, NUMBERISH);
  const sysAdded = c3.messages[0].content.slice(provider.calls[0].messages[0].content.length);
  assert.doesNotMatch(sysAdded, NUMBERISH);
  assert.doesNotMatch(JSON.stringify(provider.schemas[2].properties.questions), NUMBERISH);
});

test('draft: a max_tokens stop is truncation (stop structure), never "no tool call"; every round metered', async () => {
  const { prose } = job2Fixture();
  const r = await draftWithQuestions({ proseText: prose, ...inj([truncatedReply()]) });
  assert.equal(r.stop, 'structure');
  assert.match(r.stopReason, /^truncated/);
  assert.equal(r.rounds, 3, 'the real drafter allows two structure retries');
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
  const provider = fakeProvider([toolReply(bad()), toolReply(bad()), toolReply(withQ([{ line: 2, question: 'size?' }])), toolReply(validArgs())]);
  const { records } = await runBatch({ tag: 't1', jobs, outDir: dir, injected: { provider, rates: RATES, modelId: MODEL }, writeLine: quiet, env: {} });
  assert.equal(records[0].questions.length, 1);
  assert.deepEqual([records[0].passedTry1, records[0].passedTry2, records[0].failedLines], [false, false, [2]]);
  assert.equal(records[1].questions.length, 0);
  assert.equal(records[1].passedTry1, true);
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

test('evaluate: the bar can fail (a failed-twice vague job silent, clear chatty, a broken call, invalid plans)', () => {
  const rec = (kind, q, over = {}) => ({
    kind, questions: Array(q).fill({ line: 1, question: 'x' }), stop: null, declarationValid: true, passedTry1: false, passedTry2: false, ...over,
  });
  const good = [...Array(10).fill(0).map(() => rec('vague', 1)), ...Array(10).fill(0).map(() => rec('clear', 0, { passedTry1: true, passedTry2: null }))];
  assert.equal(evaluate(good).pass, true);
  assert.equal(evaluate([rec('vague', 0), ...good.slice(1)]).pass, false, 'a vague job that failed both tries asked nothing');
  assert.equal(evaluate([rec('vague', 0, { passedTry1: true, passedTry2: null }), ...good.slice(1)]).pass, true, 'a confident guess is not required to ask');
  assert.equal(evaluate([...good.slice(0, 10), ...Array(2).fill(0).map(() => rec('clear', 1)), ...good.slice(12)]).pass, false, '2 of 10 clear jobs asked');
  assert.equal(evaluate([...good.slice(0, 10), rec('clear', 1), ...good.slice(11)]).pass, true, '1 of 10 clear jobs asked is inside the bar');
  assert.equal(evaluate([rec('vague', 1, { stop: 'structure' }), ...good.slice(1)]).pass, false, 'a call broke');
  assert.equal(evaluate(good.map((r, i) => (i < 3 ? { ...r, declarationValid: false } : r))).pass, false, '3 invalid declarations');
  assert.equal(evaluate(good).report.vagueFailedBoth, 10);
  assert.equal(evaluate(good.map((r) => (r.kind === 'vague' ? { ...r, passedTry1: true } : r))).report.vacuous, true);
});

// ---- arm "first" (bareloop's way): questions offered on try 1 with the declaration; retries offer none ----
const FIRST_LINE = 'Most jobs need no questions. Ask only if something you need to draft a job line is truly missing (an undefined size, format, destination, or what done means), and name that line. Never ask to double-check what the job already says.';
const withQ1 = (base, questions, extra = {}) => ({ ...base, questions, ...extra });

test('arm first: questions + notChecked offered on try 1 only; retries offer none and carry no questions text', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([
    toolReply(withQ1(bad(), [{ line: 2, question: 'how long?' }], { notChecked: ['tone'] })), toolReply(bad()), toolReply(validArgs()),
  ]);
  const r = await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL, arm: 'first' });
  assert.equal(provider.calls.length, 3);
  assert.ok(provider.schemas[0].properties.questions && provider.schemas[0].properties.notChecked, 'try 1 offers both');
  assert.equal(provider.schemas[1].properties.questions, undefined);
  assert.equal(provider.schemas[2].properties.questions, undefined);
  assert.equal(provider.schemas[1].properties.notChecked, undefined);
  assert.match(provider.calls[0].messages[0].content, new RegExp(FIRST_LINE.replace(/[.()]/g, '\\$&')));
  assert.equal(provider.calls[1].messages[0].content.includes('Most jobs need no questions'), false);
  assert.equal(provider.calls[2].messages[0].content, provider.calls[1].messages[0].content, 'retries share the real drafter system prompt');
  assert.doesNotMatch(provider.calls[1].messages[1].content, /questions/i);
  assert.doesNotMatch(provider.calls[2].messages[1].content, /questions/i);
  assert.deepEqual(r.questions, [{ line: 2, question: 'how long?' }]);
  assert.deepEqual(r.notChecked, ['tone']);
  assert.equal(r.passedTry1, false); assert.equal(r.passedTry2, false);
  assert.equal(r.triesRun, 3); assert.equal(r.declarationValid, true); assert.equal(r.arm, 'first');
});

test('arm first: a clean first draft asks nothing; a question sent on a retry is a stray key, never kept', async () => {
  const { prose } = job2Fixture();
  const p1 = recProvider([toolReply(validArgs())]);
  const r1 = await draftWithQuestions({ proseText: prose, provider: p1, rates: RATES, modelId: MODEL, arm: 'first' });
  assert.deepEqual(r1.questions, []); assert.equal(r1.triesRun, 1); assert.equal(r1.passedTry1, true);
  const p2 = recProvider([toolReply(bad()), toolReply(withQ1(validArgs(), [{ line: 2, question: 'sneaky' }])), toolReply(validArgs())]);
  const r2 = await draftWithQuestions({ proseText: prose, provider: p2, rates: RATES, modelId: MODEL, arm: 'first' });
  assert.deepEqual(r2.questions, []);
  assert.equal(r2.passedTry2, false);
});

test('arm first: a question on a line that is not a job line is dropped and logged; a third is capped', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([toolReply(withQ1(validArgs(), [
    { line: 99, question: 'ghost line' }, { question: 'no line' }, { line: 1, question: 'a' }, { line: 2, question: 'b' }, { line: 3, question: 'c' },
  ]))]);
  const r = await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL, arm: 'first' });
  assert.deepEqual(r.questions.map((q) => q.line), [1, 2]);
  assert.deepEqual(r.droppedQuestions.map((d) => d.reason), ['line 99 is not a job line', 'no line', 'third question']);
  const n = normalizeQuestions([{ line: 1, question: 'x' }], [1, 2], 'a job line');
  assert.equal(n.kept.length, 1);
});

test('arm first: the prompt line is exact and no number is in the prompt or the schema', async () => {
  const { prose } = job2Fixture();
  const provider = recProvider([toolReply(bad()), toolReply(validArgs())]);
  await draftWithQuestions({ proseText: prose, provider, rates: RATES, modelId: MODEL, arm: 'first' });
  const sys1 = provider.calls[0].messages[0].content;
  const base = provider.calls[1].messages[0].content;
  const added = sys1.slice(base.length);
  assert.ok(added.includes(FIRST_LINE), 'the exact line is in the try 1 system prompt');
  assert.equal(D.FIRST_QUESTIONS_PROMPT, FIRST_LINE);
  assert.doesNotMatch(added, NUMBERISH);
  assert.doesNotMatch(JSON.stringify(provider.schemas[0].properties.questions), NUMBERISH);
});

test('arm: unknown arm refuses at $0; default arm is try3; results record the arm; evaluate(first) can fail', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  const jobs = [{ id: 'a', kind: 'vague', prose, why: 'x' }];
  await assert.rejects(runBatch({ tag: 'z', arm: 'bogus', jobs, outDir: dir, injected: inj([toolReply(validArgs())]), writeLine: quiet, env: {} }), /arm/);
  const lines = [];
  await runBatch({ tag: 'f1', arm: 'first', jobs, outDir: dir, injected: inj([toolReply(withQ1(validArgs(), [{ line: 2, question: 'q?' }]))]), writeLine: (s) => lines.push(s), env: {} });
  await runBatch({ tag: 't3', jobs, outDir: dir, injected: inj([toolReply(validArgs())]), writeLine: quiet, env: {} });
  const f1 = JSON.parse(readFileSync(path.join(dir, 'results-f1.json'), 'utf8'));
  const t3 = JSON.parse(readFileSync(path.join(dir, 'results-t3.json'), 'utf8'));
  assert.equal(f1.summary.arm, 'first'); assert.equal(f1.records[0].arm, 'first'); assert.equal(t3.summary.arm, 'try3');
  assert.match(lines[0], /BAR \(first\)/, 'the bar is printed before any run');
  const rec = (kind, q, over = {}) => ({ kind, questions: Array(q).fill({ line: 1, question: 'x' }), stop: null, declarationValid: true, ...over });
  const good = [...Array(10).fill(0).map(() => rec('vague', 1)), ...Array(10).fill(0).map(() => rec('clear', 0))];
  assert.equal(evaluate(good, JOBS, 'first').pass, true);
  assert.equal(evaluate([rec('vague', 0), ...good.slice(1)], JOBS, 'first').pass, false, 'a vague job asked nothing (a guess is not enough here)');
  assert.equal(evaluate([...good.slice(0, 10), rec('clear', 1), ...good.slice(11)], JOBS, 'first').pass, true);
  assert.equal(evaluate([...good.slice(0, 10), rec('clear', 1), rec('clear', 1), ...good.slice(12)], JOBS, 'first').pass, false);
  assert.equal(evaluate(good.map((r, i) => (i < 3 ? { ...r, declarationValid: false } : r)), JOBS, 'first').pass, false);
  assert.equal(evaluate([rec('vague', 1, { stop: 'structure' }), ...good.slice(1)], JOBS, 'first').pass, false);
});

test('compare: side-by-side table from two fixture results files, $0, reads files only', async () => {
  const { compare } = await import('./compare.mjs');
  const dir = outDir();
  const mk = (arm, q, cost) => ({
    summary: { tag: arm, arm, costUsd: cost, verdict: { pass: arm === 'first', declarationValid: { got: 2, of: 2, need: 18, ok: true } } },
    records: [
      { id: 'v1', kind: 'vague', questions: q ? [{ line: 2, question: 'which folder?' }] : [], declarationValid: true, triesRun: q ? 3 : 1 },
      { id: 'c1', kind: 'clear', questions: [], declarationValid: false, triesRun: 3 },
    ],
  });
  writeFileSync(path.join(dir, 'results-ta.json'), JSON.stringify(mk('try3', true, 0.05)));
  writeFileSync(path.join(dir, 'results-tb.json'), JSON.stringify(mk('first', false, 0.03)));
  const out = compare('ta', 'tb', dir);
  assert.match(out, /v1/); assert.match(out, /which folder\?/); assert.match(out, /valid/); assert.match(out, /RED/);
  assert.match(out, /try3/); assert.match(out, /first/);
  assert.match(out, /0\.05/); assert.match(out, /0\.03/);
  assert.match(out, /avg questions.*clear/i); assert.match(out, /avg questions.*vague/i);
  assert.match(out, /BAR: (PASS|FAIL)/);
  assert.throws(() => compare('ta', 'nope', dir), /no results/);
});
