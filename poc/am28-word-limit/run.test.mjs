// M4e amendment 28 POC — $0 tests for the harness: a fake provider, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { ceilingCostUsd } from '../../src/provider.js';
import { parseSignedText } from '../../src/signed-text.js';
import { runBatch, scoreJob, extractWrote, appearsInGuardrail } from './run.mjs';
import { am28Setup, AM28_RULE } from './draft.mjs';
import { JOBS } from './jobs.mjs';
import { RATES, MODEL, fakeProvider } from '../m6a/fixture.mjs';

const quiet = () => {};
const outDir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-am28-'));
const usage = { inputTokens: 1000, outputTokens: 200 };

/** A reply that writes the given numbers on the guardrail's step (line 2). Per call, `pick(job)` decides what the fake "model" writes. */
function replyFor(maxWords, wordsPerSection) {
  const shape = { ...(maxWords === undefined ? {} : { maxWords }), ...(wordsPerSection === undefined ? {} : { wordsPerSection }) };
  const steps = [
    { primitives: ['read'], reads: [], emits: 'src', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['src'], emits: 'doc', fromLine: 2, close: { class: 'softgreen', shape } },
  ];
  return { text: '', toolCalls: [{ id: 't', name: 'emit_declaration', arguments: { steps, guardrailClasses: { 2: 'softgreen' }, unjudgeable: {}, refused: [] } }], usage, stopReason: 'tool_calls', model: MODEL };
}
/** Fake provider that answers each job (in order) with what `answers[i]` says; records calls. */
function answering(answers) {
  const calls = [];
  return {
    calls,
    lastMalformedToolCall: null,
    async generate(messages, tools, options) {
      calls.push({ messages, tools, options });
      const a = answers[calls.length - 1];
      return replyFor(a[0], a[1]);
    },
  };
}
const rightAnswers = () => JOBS.map((j) => [j.expect.maxWords, j.expect.wordsPerSection ?? undefined]);
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
  }
});

test('wording swap: the am28 sentence is in the prompt and the schema, "smallest" is in neither, wordsPerSection is offered', async () => {
  const { wiredMenu } = await import('../../src/primitives.js');
  const { readInputFacts } = await import('../../src/input-facts.js');
  const p = parseSignedText(JOBS[0].prose);
  const { system, schema } = am28Setup({ menu: wiredMenu(['core']), lines: p.lines, arbiter: p.arbiter, factsInfo: readInputFacts(p.arbiter.sources).info });
  const s = JSON.stringify(schema);
  assert.ok(system.includes(AM28_RULE) && s.includes(AM28_RULE));
  assert.ok(!/use the smallest/.test(system) && !/use the smallest/.test(s));
  assert.ok('wordsPerSection' in schema.properties.steps.items.properties.close.properties.shape.properties);
});

test('guard: empty key is refused at $0, before any ledger write', async () => {
  for (const env of [{}, { DEEPSEEK_API_KEY: '' }]) {
    const dir = outDir();
    await assert.rejects(runBatch({ tag: 't1', outDir: dir, env, writeLine: quiet }), /DEEPSEEK_API_KEY/);
    assert.equal(existsSync(path.join(dir, 'spend.jsonl')), false, 'no ledger written');
    assert.equal(existsSync(path.join(dir, 'results-t1.json')), false);
  }
});

test('scoring: all right passes; one wrong maxWords, one wrong wordsPerSection, one extra wordsPerSection each fail the bar', async () => {
  const dir = outDir();
  const ok = await runBatch({ tag: 'ok', outDir: dir, env: {}, injected: inj(answering(rightAnswers())), writeLine: quiet });
  assert.equal(ok.summary.verdict.pass, true);
  assert.equal(ok.summary.verdict.right, 10);
  const wrongMax = rightAnswers(); wrongMax[0][0] = 3; // heading limit picked
  const wrongPer = rightAnswers(); wrongPer[2][1] = 600;
  const extraPer = rightAnswers(); extraPer[4][1] = 5; // wrote a size where the guardrail gives none
  for (const [tag, ans, id] of [['a', wrongMax, 'w01'], ['b', wrongPer, 'w03'], ['c', extraPer, 'w05']]) {
    const r = await runBatch({ tag, outDir: dir, env: {}, injected: inj(answering(ans)), spendPath: path.join(dir, `s-${tag}.jsonl`), writeLine: quiet });
    assert.equal(r.summary.verdict.pass, false, tag);
    assert.equal(r.summary.verdict.right, 9, tag);
    assert.deepEqual(r.records.filter((x) => !x.pass).map((x) => x.id), [id], tag);
  }
  assert.equal(scoreJob(JOBS[0], extractWrote(replyFor(600).toolCalls[0].arguments.steps, 2)).pass, true);
  assert.equal(scoreJob(JOBS[0], extractWrote([], 2)).pass, false, 'no step on the guardrail line is wrong');
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
  const r = await runBatch({ tag: 'cap', outDir: dir, env: {}, injected: inj(provider), stopUsd: ceiling + 0.0007, writeLine: quiet });
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
