// M4e amendment 28/29 POC — $0 tests for the harness: a fake provider, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { ceilingCostUsd } from '../../src/provider.js';
import { parseSignedText } from '../../src/signed-text.js';
import { guardrailWordsPerSection } from '../../src/declaration.js';
import { runBatch, scoreJob, extractWrote, appearsInGuardrail, codePerSection } from './run.mjs';
import { am28Setup, AM28_RULE } from './draft.mjs';
import { JOBS } from './jobs.mjs';
import { RATES, MODEL, fakeProvider } from '../m6a/fixture.mjs';

const quiet = () => {};
const outDir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-am28-'));
const usage = { inputTokens: 1000, outputTokens: 200 };

/** A reply that writes maxWords on the guardrail's step (line 2). `extra` lets a test slip in a stray shape key. */
function replyFor(maxWords, extra = {}) {
  const shape = { ...(maxWords === undefined ? {} : { maxWords }), ...extra };
  const steps = [
    { primitives: ['read'], reads: [], emits: 'src', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['src'], emits: 'doc', fromLine: 2, close: { class: 'softgreen', shape } },
  ];
  return { text: '', toolCalls: [{ id: 't', name: 'emit_declaration', arguments: { steps, guardrailClasses: { 2: 'softgreen' }, unjudgeable: {}, refused: [] } }], usage, stopReason: 'tool_calls', model: MODEL };
}
const BROKEN = { text: 'sorry, here is prose instead', toolCalls: [], usage, stopReason: 'end_turn', model: MODEL };
/** Fake provider that answers call i with `answers[i]`: [maxWords] or BROKEN (a reply with no tool call); records calls. */
function answering(answers) {
  const calls = [];
  return {
    calls,
    lastMalformedToolCall: null,
    async generate(messages, tools, options) {
      calls.push({ messages, tools, options });
      const a = answers[calls.length - 1];
      return a === BROKEN ? BROKEN : replyFor(a[0]);
    },
  };
}
const rightAnswers = () => JOBS.map((j) => [j.expect.maxWords]);
const inj = (provider) => ({ provider, rates: RATES, modelId: MODEL });

test('fixtures: 10 jobs, unique ids, each parses, the guardrail is on line 2 and the expected numbers are in it', () => {
  assert.equal(JOBS.length, 10);
  assert.equal(new Set(JOBS.map((j) => j.id)).size, 10);
  for (const j of JOBS) {
    const p = parseSignedText(j.prose);
    assert.equal(p.ok, true, `${j.id}: ${p.ok ? '' : p.reds}`);
    assert.equal(p.lines.find((l) => l.n === j.guardrailLine).guardrail, j.guardrail, j.id);
    assert.equal(appearsInGuardrail(j.expect.maxWords, j.guardrail), true, `${j.id} maxWords in guardrail`);
    if (j.expect.wordsPerSection !== null) assert.equal(appearsInGuardrail(j.expect.wordsPerSection, j.guardrail), true, j.id);
    assert.equal(guardrailWordsPerSection(j.guardrail), j.expect.wordsPerSection, `${j.id}: code reads the right per-section size`);
  }
});

test('wording swap: the am29 sentence is in the prompt and the schema, "smallest" is in neither, wordsPerSection is NOT offered', async () => {
  const { wiredMenu } = await import('../../src/primitives.js');
  const { readInputFacts } = await import('../../src/input-facts.js');
  const p = parseSignedText(JOBS[0].prose);
  const { system, schema } = am28Setup({ menu: wiredMenu(['core']), lines: p.lines, arbiter: p.arbiter, factsInfo: readInputFacts(p.arbiter.sources).info });
  const s = JSON.stringify(schema);
  assert.ok(system.includes(AM28_RULE) && s.includes(AM28_RULE));
  assert.ok(!/use the smallest/.test(system) && !/use the smallest/.test(s));
  assert.equal(AM28_RULE, "use the guardrail's ceiling for the whole output");
  assert.ok(!/each section/.test(AM28_RULE));
  assert.ok(!s.includes('wordsPerSection'), 'the model schema has no wordsPerSection');
});

test('guard: empty key is refused at $0, before any ledger write', async () => {
  for (const env of [{}, { DEEPSEEK_API_KEY: '' }]) {
    const dir = outDir();
    await assert.rejects(runBatch({ tag: 't1', outDir: dir, env, writeLine: quiet }), /DEEPSEEK_API_KEY/);
    assert.equal(existsSync(path.join(dir, 'spend.jsonl')), false, 'no ledger written');
    assert.equal(existsSync(path.join(dir, 'results-t1.json')), false);
  }
});

test('scoring: all right passes; a wrong maxWords fails; code per-section scoring is independent of the model', async () => {
  const dir = outDir();
  const ok = await runBatch({ tag: 'ok', outDir: dir, env: {}, injected: inj(answering(rightAnswers())), writeLine: quiet });
  assert.equal(ok.summary.verdict.pass, true);
  assert.equal(ok.summary.verdict.maxRight, 10);
  assert.equal(ok.summary.verdict.perRight, 10);
  const wrongMax = rightAnswers(); wrongMax[0][0] = 3; // heading limit picked
  const r = await runBatch({ tag: 'a', outDir: dir, env: {}, injected: inj(answering(wrongMax)), spendPath: path.join(dir, 's-a.jsonl'), writeLine: quiet });
  assert.equal(r.summary.verdict.pass, false);
  assert.equal(r.summary.verdict.maxRight, 9);
  assert.equal(r.summary.verdict.perRight, 10);
  assert.deepEqual(r.records.filter((x) => !x.pass).map((x) => x.id), ['w01']);
  // a stray wordsPerSection the model slips in is ignored by the score: the per-section number is code's
  const stray = { ...JOBS[4] };
  const wrote = extractWrote(replyFor(300, { wordsPerSection: 5 }).toolCalls[0].arguments.steps, 2);
  assert.equal(scoreJob(stray, wrote).pass, true);
  assert.equal(codePerSection(JOBS[2]), 150);
  assert.equal(codePerSection(JOBS[0]), null);
  // a job whose expected per-section is not what code reads fails the per-section half
  assert.equal(scoreJob({ ...JOBS[2], expect: { ...JOBS[2].expect, wordsPerSection: 99 } }, { stepFound: true, maxWords: 600 }).perOk, false);
  assert.equal(scoreJob(JOBS[0], extractWrote([], 2)).pass, false, 'no step on the guardrail line is wrong');
});

test('retry: a broken call is retried ONCE, both rounds are metered and booked; a good retry scores; no third try', async () => {
  const dir = outDir();
  const ans = [BROKEN, ...rightAnswers()]; // job 1: broken, then right on the retry
  const prov = answering(ans);
  const one = JOBS.slice(0, 1);
  const r = await runBatch({ tag: 'retry', outDir: dir, jobs: one, env: {}, injected: inj(prov), writeLine: quiet });
  assert.equal(prov.calls.length, 2);
  assert.match(prov.calls[1].messages[1].content, /not a usable tool call/);
  assert.equal(r.records[0].pass, true);
  assert.equal(r.records[0].calls, 2);
  assert.equal(r.records[0].rounds, 2);
  const rows = readFileSync(path.join(dir, 'spend.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]).calls, 2);
  assert.ok(JSON.parse(rows[0]).costUsd > 0, 'both rounds priced into the one row');
  // two broken in a row: stop after exactly two calls, red, not a third
  const dir2 = outDir();
  const prov2 = answering([BROKEN, BROKEN, [600], [600]]);
  const r2 = await runBatch({ tag: 'retry2', outDir: dir2, jobs: one, env: {}, injected: inj(prov2), writeLine: quiet });
  assert.equal(prov2.calls.length, 2, 'no third try');
  assert.equal(r2.records[0].stop, 'structure');
  assert.equal(r2.records[0].pass, false);
  assert.equal(r2.summary.verdict.broken, 1);
});

test('invented number: reported as not in the guardrail', async () => {
  const dir = outDir();
  const ans = rightAnswers(); ans[0][0] = 777;
  const r = await runBatch({ tag: 'inv', outDir: dir, env: {}, injected: inj(answering(ans)), writeLine: quiet });
  assert.equal(r.records[0].maxInGuardrail, false);
  assert.equal(r.records[1].maxInGuardrail, true);
});

test('cap: the ledger stops the run before the next job would pass the line; the short run is not a pass', async () => {
  const dir = outDir();
  const ceiling = ceilingCostUsd(MODEL);
  const provider = answering(rightAnswers());
  const r = await runBatch({ tag: 'cap', outDir: dir, env: {}, injected: inj(provider), stopUsd: ceiling * 2 + 0.0007, writeLine: quiet });
  assert.ok(r.summary.ran < 10, `ran ${r.summary.ran}`);
  assert.match(r.summary.stoppedBy, /^spend:/);
  assert.equal(provider.calls.length, r.summary.ran, 'no call past the stop');
  assert.equal(r.summary.verdict.pass, false);
  const lines = readFileSync(path.join(dir, 'spend.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, r.summary.ran, 'every call booked');
});

test('tag reuse is refused, and the first results file is untouched', async () => {
  const dir = outDir();
  await runBatch({ tag: 'same', outDir: dir, env: {}, injected: inj(answering(rightAnswers())), writeLine: quiet });
  const before = readFileSync(path.join(dir, 'results-same.json'), 'utf8');
  const provider = answering(rightAnswers());
  await assert.rejects(runBatch({ tag: 'same', outDir: dir, env: {}, injected: inj(provider), writeLine: quiet }), /already has results/);
  assert.equal(provider.calls.length, 0);
  assert.equal(readFileSync(path.join(dir, 'results-same.json'), 'utf8'), before);
});

test('a hung call hits the deadline: stop, booked, not a pass', async () => {
  const dir = outDir();
  const hang = { async generate() { return new Promise(() => {}); }, lastMalformedToolCall: null };
  const r = await runBatch({ tag: 'dl', outDir: dir, env: {}, injected: inj(hang), deadlineMs: 50, writeLine: quiet });
  assert.equal(r.records[0].stop, 'deadline');
  assert.equal(r.summary.verdict.pass, false);
});

test('tag am28-1 is consumed by the first paid run: refused at $0 with the real results file in place', async () => {
  const provider = answering(rightAnswers());
  await assert.rejects(runBatch({ tag: 'am28-1', env: {}, injected: inj(provider), writeLine: quiet }), /already has results/);
  assert.equal(provider.calls.length, 0);
});
