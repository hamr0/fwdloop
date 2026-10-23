// F80 POC — $0 tests for the harness: a fake provider, no key, no network. Proves: arm B's request carries the hint block and
// arm A's does not, per-draft metering and counts, the A,B interleave, the cap stop, the refusals, and that the bar can FAIL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { ceilingCostUsd } from '../../src/provider.js';
import { runBatch, evaluate, totals, armProvider, SPEND_STOP_USD, DRAFTS_PER_ARM, DRAFTER_PROMPT_START } from './run.mjs';
import { hintsForJob, withPocCap, jobTextOf } from './notes.mjs';
import { HINT_HEADER } from './learn-poc.mjs';
import {
  RATES, MODEL, validArgs, toolReply,
} from '../m6a/fixture.mjs';

function fixtureProse() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-f80-in-'));
  const resume = path.join(dir, 'resume.md');
  const jd = path.join(dir, 'jd.md');
  writeFileSync(resume, '# Jo Doe\n\nSenior engineer, ten years.\n');
  writeFileSync(jd, '# About the role\n\nBuild things.\n\n## Responsibilities\n\nShip.\n');
  return withPocCap(readFileSync(new URL('../../test/fixtures/job2-m6a.prose.txt', import.meta.url), 'utf8').replace('@RESUME@', resume).replace('@JD@', jd));
}
const HINT = `${HINT_HEADER}\n1. [this job, seen 1 time] check "the drafted plan" failed; refused by the plan check; fixed in a later round of the same draft.\n   It said: declaration: line 2 is red`;
const mkJobs = () => ['j1', 'j2', 'j3'].map((id) => ({ id, proseText: fixtureProse(), hint: HINT, hintInfo: null }));
const bad = () => { const a = validArgs(); a.steps[1].primitives = ['nope']; return a; };
const outDir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-f80-'));
const quiet = () => {};

/** A fake provider whose reply depends on the request: `rule(systemText, userText)` -> 'bad' | 'good'. Records every request. */
function ruleProvider(rule) {
  const calls = [];
  return {
    calls,
    lastMalformedToolCall: null,
    async generate(messages) {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
      calls.push({ system, user });
      return toolReply(rule(system, user) === 'good' ? validArgs() : bad());
    },
  };
}
// a model that listens to the hint: refused once without it, clean with it
const listens = (system, user) => (system.includes(HINT_HEADER) || user.includes('REFUSED') ? 'good' : 'bad');
// a model that ignores the hint: refused once either way
const ignores = (system, user) => (user.includes('REFUSED') ? 'good' : 'bad');
const always = (system, user) => 'good';
const run = (provider, extra = {}) => runBatch({
  tag: 't1', jobs: mkJobs(), outDir: outDir(), injected: { provider, rates: RATES, modelId: MODEL }, writeLine: quiet, ...extra,
});

test('B carries the block on every request, A on none; interleaved A,B; counts and metering per draft', async () => {
  const p = ruleProvider(listens);
  const { records, summary } = await run(p);
  assert.equal(records.length, 18);
  assert.deepEqual(records.slice(0, 4).map((r) => `${r.job}${r.arm}${r.n}`), ['j1A1', 'j1B1', 'j1A2', 'j1B2']);
  for (const r of records) {
    assert.equal(r.requests.carriedHint, r.arm === 'B' ? r.requests.calls : 0, `${r.job}${r.arm}${r.n}`);
    assert.ok(r.costUsd > 0, 'priced, never 0');
    assert.equal(r.ok, true);
  }
  // the requests the provider really saw
  assert.equal(p.calls.filter((c) => c.system.includes(HINT_HEADER)).length, records.filter((r) => r.arm === 'B').reduce((s, r) => s + r.requests.calls, 0));
  assert.equal(p.calls.filter((c) => !c.system.includes(HINT_HEADER)).length, records.filter((r) => r.arm === 'A').reduce((s, r) => s + r.requests.calls, 0));
  const A = records.filter((r) => r.arm === 'A');
  const B = records.filter((r) => r.arm === 'B');
  assert.ok(A.every((r) => r.refusalRounds === 1 && r.rounds === 2));
  assert.ok(B.every((r) => r.refusalRounds === 0 && r.rounds === 1));
  assert.equal(summary.verdict, 'HELPS');
  assert.equal(summary.pass, true);
  assert.ok(summary.ledgerTotalUsd > 0 && summary.ledgerTotalUsd < SPEND_STOP_USD);
});

test('the bar can FAIL: a model that ignores the notes gives DOES NOT HELP (refusal rounds equal)', async () => {
  const { summary } = await run(ruleProvider(ignores));
  assert.equal(summary.bars.refusalRounds.ok, false);
  assert.equal(summary.pass, false);
  assert.equal(summary.verdict, 'DOES NOT HELP');
});

test('no refusal in either arm -> INCONCLUSIVE, not a pass', async () => {
  const { summary } = await run(ruleProvider(always));
  assert.match(summary.verdict, /^INCONCLUSIVE: no draft was refused/);
  assert.equal(summary.pass, false);
});

test('cap stop: stops before the next draft would cross the stop line; incomplete is INCONCLUSIVE', async () => {
  const ceil = ceilingCostUsd(RATES);
  // each draft here costs a few tenths of a cent; allow about 3 drafts
  const { records, summary } = await run(ruleProvider(listens), { stopUsd: ceil + 0.004 });
  assert.ok(records.length > 0 && records.length < 18, `ran ${records.length}`);
  assert.match(summary.stoppedBy, /^spend: /);
  assert.match(summary.verdict, /^INCONCLUSIVE: the run stopped/);
  assert.ok(summary.ledgerTotalUsd + 0 <= summary.roundCeilingUsd + 0.004 + 1, 'ledger stays near the line');
});

test('the draft budget is the cap less what was spent (priorSpend): a tiny cap refuses the round at $0, spending nothing', async () => {
  const jobs = mkJobs().map((j) => ({ ...j, proseText: withPocCap(j.proseText, 0.001) }));
  const p = ruleProvider(listens);
  const { records } = await run(p, { jobs });
  assert.equal(p.calls.length, 0, 'no provider call: one round at its ceiling does not fit the cap');
  assert.ok(records.every((r) => !r.ok && r.stop === 'pre-flight'));
});

test('refuses: used tag, no key (live path), a job without a hint block; never overwrites', async () => {
  const dir = outDir();
  const inj = { provider: ruleProvider(always), rates: RATES, modelId: MODEL };
  await runBatch({ tag: 'dup', jobs: mkJobs(), outDir: dir, injected: inj, writeLine: quiet });
  assert.ok(existsSync(path.join(dir, 'results-dup.json')));
  await assert.rejects(runBatch({ tag: 'dup', jobs: mkJobs(), outDir: dir, injected: inj, writeLine: quiet }), /already has results/);
  await assert.rejects(runBatch({ tag: 'k1', jobs: mkJobs(), outDir: dir, env: { DEEPSEEK_API_KEY: '' }, writeLine: quiet }), /DEEPSEEK_API_KEY is not set/);
  await assert.rejects(runBatch({ tag: 'k2', jobs: mkJobs().map((j) => ({ ...j, hint: '' })), outDir: dir, injected: inj, writeLine: quiet }), /no hint block/);
  await assert.rejects(runBatch({ tag: 'bad tag', jobs: mkJobs(), outDir: dir, injected: inj, writeLine: quiet }), /--tag is required/);
});

test('an unknown cost is never 0: totals are null and the cost bar cannot pass', () => {
  const rec = (arm, extra) => ({ job: 'j', arm, ok: true, refusalRounds: arm === 'A' ? 2 : 0, structureRetries: 0, rounds: 1, costUsd: 0.001, ...extra });
  const recs = [rec('A', {}), rec('B', { costUsd: null })];
  assert.equal(totals(recs.filter((r) => r.arm === 'B')).costUsd, null);
  const ev = evaluate(recs, { complete: true });
  assert.equal(ev.bars.cost.ok, false);
  assert.match(ev.verdict, /^DOES NOT HELP/);
});

test('armProvider: only the system message is changed, the user text and tools pass through, lastMalformedToolCall reads through', async () => {
  const seen = [];
  const base = { lastMalformedToolCall: 'x', async generate(m, t, o) { seen.push({ m, t, o }); return { ok: 1 }; } };
  const calls = [];
  const w = armProvider(base, `${HINT_HEADER}\nx`, calls);
  await w.generate([{ role: 'system', content: `${DRAFTER_PROMPT_START} S` }, { role: 'user', content: 'U' }], ['tool'], { a: 1 });
  assert.equal(seen[0].m[0].content, `${DRAFTER_PROMPT_START} S\n\n${HINT_HEADER}\nx`);
  assert.equal(seen[0].m[1].content, 'U');
  assert.deepEqual(seen[0].t, ['tool']);
  assert.equal(w.lastMalformedToolCall, 'x');
  // a map call (another system prompt) is not touched, even in arm B
  await w.generate([{ role: 'system', content: 'You map a person\'s job' }, { role: 'user', content: 'U' }], [], {});
  assert.equal(seen[1].m[0].content, 'You map a person\'s job');
  assert.deepEqual(calls.map((c) => [c.drafter, c.carried]), [[true, true], [false, false]]);
});

test('notes: refused drafts of the same job text become a hint block; noise lines are left out; other jobs and clean drafts give none', () => {
  const root = outDir();
  const prose = (job) => `${job}\n\nArbiter guardrails (x):\nguardrail: cap $1 per run\n`;
  const put = (d, job, log) => {
    mkdirSync(path.join(root, d, 'draft'), { recursive: true });
    writeFileSync(path.join(root, d, 'prose.txt'), prose(job));
    writeFileSync(path.join(root, d, 'draft', 'log.json'), JSON.stringify(log));
  };
  put('d1', '1. Read it\n2. Write it', { ok: true, reds: [], log: [{ round: 1, reds: ['declaration: steps[0] reads artifact "x" that no earlier step declared', 'the tool call was not valid JSON'] }, { round: 2, outcome: 'valid' }] });
  put('d2', '1. Read it\n2. Write it', { ok: false, reds: ['declaration: line 2 is bad'], log: [{ round: 1, reds: ['declaration: line 2 is bad'] }] });
  put('d3', '1. Other\n2. Job', { ok: false, reds: ['declaration: other'], log: [{ round: 1, reds: ['declaration: other'] }] });
  const h = hintsForJob(jobTextOf(prose('1. Read it\n2. Write it')), 'job-a', { root });
  assert.ok(h.text.startsWith(HINT_HEADER));
  assert.equal(h.ids.length, 2);
  assert.match(h.text, /fixed in a later round of the same draft/);
  assert.match(h.text, /the draft failed/);
  assert.doesNotMatch(h.text, /valid JSON/);
  assert.doesNotMatch(h.text, /other/);
  put('d4', '1. Clean\n2. Job', { ok: true, reds: [], log: [{ round: 1, outcome: 'valid' }] });
  assert.equal(hintsForJob(jobTextOf(prose('1. Clean\n2. Job')), 'clean', { root }).text, '');
});

test('DRAFTS_PER_ARM is 3 and the stop line is the signed $0.25', () => {
  assert.equal(DRAFTS_PER_ARM, 3);
  assert.equal(SPEND_STOP_USD, 0.25);
});

test('draft() is called with offerQuestions:false and the prior-spend hook (no stop for a human question)', async () => {
  const seen = [];
  const draftFn = async (a) => { seen.push(a); return { ok: true, log: [], rounds: 1, calls: 1, costUsd: 0.001, spendComplete: true, structureRetries: 0 }; };
  await runBatch({ tag: 'o1', jobs: mkJobs().slice(0, 1), outDir: outDir(), injected: { provider: ruleProvider(always), rates: RATES, modelId: MODEL }, draftFn, writeLine: quiet });
  assert.equal(seen.length, 6);
  assert.ok(seen.every((a) => a.offerQuestions === false && typeof a.priorSpend === 'function'));
});
