// F81 POC — $0 tests for the harness: a fake provider (no key, no network) through the WHOLE path:
// draft -> poc-f81 sign in a temp root -> run -> stop at the ask. Proves the injection (B's drafter requests carry the block, A's and every
// step request do not), the cap stop, the temp-root cleanup, the config door, the gates, and that the bar can FAIL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { ceilingCostUsd } from '../../src/provider.js';
import {
  runBatch, evaluate, totals, paired, stepsOf, injectionProof, sampleCap, gateJobs, loadPool, SPEND_STOP_USD, PER_ARM, SIGNER, SLOT, MIN_SAMPLE_CAP_USD,
} from './run.mjs';
import { withCap, JOB_CAP_USD, loadJobs } from './notes.mjs';
import { HINT_HEADER } from './learn-ours.mjs';
import { armProvider, DRAFTER_PROMPT_START } from '../m8-refused/run.mjs';
import { HINT_HEADER as F80_HEADER } from '../m8-refused/learn-poc.mjs';
import {
  RATES, MODEL, validArgs, toolReply, textReply,
} from '../m6a/fixture.mjs';

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = 'just some words with no headings at all';
const SECRET_BODY = 'Senior engineer, ten years.'; // the resume content: must never reach a results file

function fixtureProse(dest) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-f81-in-'));
  const resume = path.join(dir, 'resume.md');
  const jd = path.join(dir, 'jd.md');
  writeFileSync(resume, `# Jo Doe\n\n${SECRET_BODY}\n`);
  writeFileSync(jd, '# About the role\n\nBuild things.\n\n## Responsibilities\n\nShip.\n');
  return readFileSync(new URL('../../test/fixtures/job2-m6a.prose.txt', import.meta.url), 'utf8')
    .replace('@RESUME@', resume).replace('@JD@', jd).replace('file:poc/m0/out', `file:${dest}`);
}
const HINT = `${HINT_HEADER}\n1. [this job, seen 1 time] check "summary (line 3, softgreen)" failed; fixed later in the same run.\n   It said: no heading`;
function mkJobs(ids = ['j1', 'j2']) {
  const dest = mkdtempSync(path.join(tmpdir(), 'fwdloop-f81-dest-'));
  return ids.map((id) => ({ id, proseText: fixtureProse(dest), hint: HINT, hintInfo: { hints: 1, chars: HINT.length } }));
}
const outDir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-f81-out-'));
const quiet = () => {};
const usage = { inputTokens: 1000, outputTokens: 200 };

/**
 * One fake model for drafter and steps. The drafter always answers the known-valid plan. A step answers well, except the summary step's FIRST try,
 * which is bad unless `listens` and the latest draft request carried the block (the test model that "benefits from the notes").
 */
function scenario({ listens }) {
  const calls = [];
  let hinted = false;
  let summaryTries = 0;
  return {
    calls,
    lastMalformedToolCall: null,
    async generate(messages) {
      const system = String(messages.find((m) => m.role === 'system')?.content ?? '');
      calls.push({
        system, config: { NODE_ENV: process.env.NODE_ENV, home: process.env.FWDLOOP_CONFIG_HOME }, liveRoots: readdirSync(tmpdir()).filter((n) => /^fwdloop-f81-[A-Za-z0-9]{6}$/.test(n)).length,
      });
      if (system.startsWith(DRAFTER_PROMPT_START)) { hinted = system.includes(HINT_HEADER); summaryTries = 0; return toolReply(validArgs()); }
      if (messages.at(-1).role === 'tool') return textReply('done');
      const ctx = JSON.parse(messages.filter((m) => m.role === 'user').at(-1).content);
      let text = 'ok';
      if (String(ctx.goal).includes('summary resume')) {
        summaryTries += 1;
        text = summaryTries === 1 && !(listens && hinted) ? BAD : GOOD;
      }
      return {
        text: '', toolCalls: [{ id: `t${calls.length}`, name: 'emit_artifact', arguments: { text, done: true } }], usage, stopReason: 'tool_calls', model: MODEL,
      };
    },
  };
}
const run = (provider, extra = {}) => runBatch({
  tag: 't1', jobs: mkJobs(), outDir: outDir(), injected: { provider, rates: RATES, modelId: MODEL }, writeLine: quiet, perArm: 3, ...extra,
});

test('whole path: B carries the block on every drafter request, A none, no step request; poc-f81 signs; runs stop at the ask; roots are removed', async () => {
  const p = scenario({ listens: true });
  const { records, summary, tmpRoots } = await run(p);
  assert.equal(records.length, 12);
  // round-robin over jobs: n=1: j1 A, j1 B, j2 A, j2 B, then n=2 ...
  assert.deepEqual(records.slice(0, 5).map((r) => `${r.job}${r.arm}${r.n}`), ['j1A1', 'j1B1', 'j2A1', 'j2B1', 'j1A2']);
  for (const r of records) {
    const id = `${r.job}${r.arm}${r.n}`;
    assert.equal(r.draft.ok, true, id);
    assert.equal(r.sign.ok, true, id);
    assert.equal(r.sign.signedBy, SIGNER, id);
    assert.notEqual(r.sign.signedBy, 'hamr');
    assert.equal(r.run.kind, 'paused-at-ask', `${id}: ${r.run.red}`);
    assert.equal(r.injectionOk, true, id);
    assert.ok(r.requests.drafterCalls >= 1 && r.requests.stepCalls >= 1, id);
    assert.equal(r.requests.drafterCarried, r.arm === 'B' ? r.requests.drafterCalls : 0, id);
    assert.equal(r.requests.stepCarried, 0, id);
    assert.ok(r.costUsd > 0, 'priced, never 0');
    assert.ok(r.run.steps.length >= 3);
  }
  // what the provider really saw: the block appears in exactly B's drafter prompts, never in a step prompt
  const withBlock = p.calls.filter((c) => c.system.includes(HINT_HEADER));
  assert.ok(withBlock.length > 0 && withBlock.every((c) => c.system.startsWith(DRAFTER_PROMPT_START)));
  assert.equal(withBlock.length, records.filter((r) => r.arm === 'B').reduce((s, r) => s + r.requests.drafterCalls, 0));
  // the notes helped (this model listens): A's summary step went red once, B's never
  const A = totals(records.filter((r) => r.arm === 'A'));
  const B = totals(records.filter((r) => r.arm === 'B'));
  assert.equal(A.redStepTries, 6);
  assert.equal(B.redStepTries, 0);
  assert.equal(summary.verdict, 'HELPS');
  assert.equal(summary.pass, true);
  assert.ok(summary.ledgerTotalUsd > 0 && summary.ledgerTotalUsd < SPEND_STOP_USD);
  // every temp root is gone; the config door was a temp dir under a test process and is restored
  assert.ok(tmpRoots.length === 12 && tmpRoots.every((t) => !existsSync(t)));
  assert.ok(p.calls.every((c) => c.liveRoots === 1), 'a sample root is removed as soon as its record is written: only the current one is ever on disk');
  assert.ok(p.calls.every((c) => c.config.NODE_ENV === 'test' && c.config.home.startsWith(path.join(tmpdir(), 'fwdloop-f81-cfg-'))));
});

test('the results file holds counts, red lines and hint text: no artifact or input content, no key', async () => {
  const dir = outDir();
  const p = scenario({ listens: false });
  await runBatch({ tag: 'r1', jobs: mkJobs(), outDir: dir, injected: { provider: p, rates: RATES, modelId: MODEL }, writeLine: quiet, perArm: 1 });
  const text = readFileSync(path.join(dir, 'results-r1.json'), 'utf8');
  const doc = JSON.parse(text);
  assert.equal(doc.records.length, 4);
  assert.ok(!text.includes(SECRET_BODY), 'the resume content is not in the results');
  assert.ok(!text.includes('worked places'), 'no artifact text in the results');
  assert.ok(text.includes(HINT_HEADER), 'the hint text is');
  assert.ok(doc.records.every((r) => r.run.steps.every((s) => s.redLines.every((l) => l.length <= 200))));
  assert.ok(doc.records.some((r) => r.run.steps.some((s) => s.redTries > 0 && s.redLines.length === s.redTries)), 'a red line is kept per red try');
});

test('the bar can FAIL: a model that ignores the notes -> DOES NOT HELP (red tries equal)', async () => {
  const { summary } = await run(scenario({ listens: false }));
  assert.equal(summary.bars.redStepTries.ok, false);
  assert.equal(summary.pass, false);
  assert.equal(summary.verdict, 'DOES NOT HELP');
});

test('the injection guard can FAIL: if B stops carrying the block the batch stops by name, never reports a result as B', async () => {
  const noAppend = (base, hint, calls) => armProvider(base, '', calls); // the append removed
  const { records, summary } = await run(scenario({ listens: true }), { wrapDrafter: noAppend });
  assert.equal(records.at(-1).arm, 'B');
  assert.equal(records.at(-1).injectionOk, false);
  assert.match(summary.stoppedBy, /^injection: /);
  assert.equal(records.length, 2);
});

test('injectionProof: B needs every drafter call carrying it; A none; a step request carrying it breaks both', () => {
  const d = (drafter, carried) => ({ drafter, carried });
  assert.equal(injectionProof('B', [d(true, true), d(true, true)], [d(false, false)]).ok, true);
  assert.equal(injectionProof('B', [d(true, true), d(true, false)], []).ok, false);
  assert.equal(injectionProof('B', [], []).ok, false, 'no drafter call at all proves nothing');
  assert.equal(injectionProof('A', [d(true, false)], [d(false, false)]).ok, true);
  assert.equal(injectionProof('A', [d(true, true)], []).ok, false);
  assert.equal(injectionProof('B', [d(true, true)], [d(false, true)]).ok, false);
  assert.equal(injectionProof('B', [d(true, true), d(false, true)], []).ok, false, 'a map call carrying it');
});

test('cap stop: stops before a sample whose cap would be under the minimum; the verdict is INCONCLUSIVE, not a pass', async () => {
  assert.ok(MIN_SAMPLE_CAP_USD >= 1.25 * ceilingCostUsd(RATES));
  // each sample here costs a few tenths of a cent; allow roughly the first two samples
  const stopUsd = 2 * MIN_SAMPLE_CAP_USD + 0.004;
  const { records, summary } = await run(scenario({ listens: true }), { stopUsd });
  assert.ok(records.length > 0 && records.length < 12, `ran ${records.length}`);
  assert.match(summary.stoppedBy, /^spend: /);
  assert.match(summary.verdict, /^INCONCLUSIVE/);
  assert.equal(summary.pass, false);
  assert.ok(summary.ledgerTotalUsd <= stopUsd, 'the ledger never passes the stop line');
});

test('sampleCap: the job cap, or half of what is left', () => {
  assert.equal(sampleCap(0), JOB_CAP_USD);
  assert.equal(sampleCap(0.3, 0.5), 0.1);
  assert.ok(Math.abs(sampleCap(0.4, 0.5) - 0.05) < 1e-9);
  assert.ok(sampleCap(0.5, 0.5) <= 0);
});

test('runaway guard: with the f81-1 ledger ($0.38584) and $0.20 spent per sample, all 8 samples of n=3..4 still start', () => {
  const ceiling = ceilingCostUsd(RATES);
  const minCap = Math.max(MIN_SAMPLE_CAP_USD, 1.25 * ceiling);
  let ledger = 0.38584;
  for (let i = 0; i < 8; i += 1) {
    const cap = sampleCap(ledger);
    assert.ok(cap >= minCap, `sample ${i + 1} would be refused: ledger $${ledger.toFixed(4)}, cap $${cap.toFixed(4)}`);
    assert.equal(cap, JOB_CAP_USD, 'the per-sample job cap is unchanged');
    ledger += 0.2;
  }
});

test('a draft that never goes green is a failed draft: no sign, no run, its cost kept; counts against the arm', async () => {
  const bad = { lastMalformedToolCall: null, calls: [], async generate() { const a = validArgs(); a.steps[1].primitives = ['nope']; return toolReply(a); } };
  const { records } = await run(bad, { perArm: 1 });
  assert.ok(records.every((r) => r.draft.ok === false && r.sign.ok === false && r.run === null && r.requests.stepCalls === 0));
  assert.ok(records.every((r) => r.costUsd > 0), 'a failed draft still has its cost');
  assert.equal(totals(records).failedDrafts, 4);
});

test('an unknown cost is never 0: totals are null and the cost bar cannot pass', () => {
  const mk = (arm, extra = {}) => ({
    job: 'j', n: 1, arm, draft: { ok: true }, sign: { ok: true }, run: { kind: 'paused-at-ask', steps: [{ tries: 2, redTries: arm === 'A' ? 1 : 0 }] }, costUsd: 0.01, ...extra,
  });
  const recs = [mk('A'), mk('B', { costUsd: null })];
  assert.equal(totals(recs.filter((r) => r.arm === 'B')).costUsd, null);
  const ev = evaluate(recs, { minPerArm: 1 });
  assert.equal(ev.bars.cost.ok, false);
  assert.equal(ev.verdict, 'DOES NOT HELP');
});

test('bars: cost allows +10% only; red runs + failed drafts count together; fewer than 3 paired samples is INCONCLUSIVE for the job', () => {
  const mk = (arm, n, o = {}) => ({
    job: 'j', n, arm, draft: { ok: true }, sign: { ok: true }, run: { kind: 'paused-at-ask', steps: [{ tries: 2, redTries: arm === 'A' ? 1 : 0 }] }, costUsd: 0.01, ...o,
  });
  const set = (b) => [1, 2, 3].flatMap((n) => [mk('A', n), mk('B', n, b)]);
  assert.equal(evaluate(set({ costUsd: 0.011 })).verdict, 'HELPS');
  assert.equal(evaluate(set({ costUsd: 0.0111 })).verdict, 'DOES NOT HELP', 'over A + 10%');
  assert.equal(evaluate(set({ run: { kind: 'red', steps: [{ tries: 2, redTries: 0 }] } })).verdict, 'DOES NOT HELP', 'B reds 3 runs, A none');
  assert.equal(evaluate(set({ draft: { ok: false }, run: null })).verdict, 'DOES NOT HELP', 'B fails every draft');
  assert.match(evaluate(set({}).slice(0, 4)).verdict, /^INCONCLUSIVE: j \(INCONCLUSIVE: 2 A \/ 2 B/);
  const none = [1, 2, 3].flatMap((n) => [mk('A', n, { run: { kind: 'paused-at-ask', steps: [{ tries: 1, redTries: 0 }] } }), mk('B', n, { run: { kind: 'paused-at-ask', steps: [{ tries: 1, redTries: 0 }] } })]);
  assert.match(evaluate(none).verdict, /^INCONCLUSIVE/);
});

test('paired: an A sample whose B never ran is left out of the totals, and said', () => {
  const r = (arm, n) => ({ job: 'j', arm, n });
  const ev = evaluate([r('A', 1), r('B', 1), r('A', 2)].map((x) => ({ ...x, draft: { ok: true }, sign: { ok: true }, run: { kind: 'paused-at-ask', steps: [] }, costUsd: 0.01 })), { minPerArm: 1 });
  assert.equal(ev.pairedSamples, 2);
  assert.equal(ev.unpairedDropped, 1);
  assert.equal(paired([r('A', 1), r('B', 1), r('A', 2)]).length, 2);
});

test('stepsOf: tries, red tries, how each step ended; a pause row and a stop row are not tries; red lines are cut', () => {
  const rows = [
    { step: 's1', class: 'hitl', attempt: 1, verdict: 'hitl' },
    { step: 's3', class: 'softgreen', attempt: 1, verdict: 'red', gap: 'x'.repeat(500) },
    { step: 's3', class: 'softgreen', attempt: 2, verdict: 'softgreen' },
    { step: 's4', class: 'hitl', attempt: 1, verdict: 'paused' },
    { step: 's5', class: 'green', attempt: null, verdict: 'stopped' },
    { step: 's6', class: 'hitl', attempt: 1, verdict: 'not-done', gap: 'done: false' },
  ];
  const s = stepsOf(rows, (x) => String(x).slice(0, 200));
  assert.deepEqual(s.map((x) => [x.step, x.tries, x.redTries, x.ended]), [['s1', 1, 0, 'green'], ['s3', 2, 1, 'green'], ['s6', 1, 1, 'red']]);
  assert.equal(s[1].redLines[0].length, 200);
});

test('refuses at $0: a used tag, an empty key (no ledger written), an unticked model, a job without a hint, a bad tag; never overwrites', async () => {
  const dir = outDir();
  const inj = { provider: scenario({ listens: true }), rates: RATES, modelId: MODEL };
  await runBatch({
    tag: 'dup', jobs: mkJobs(), outDir: dir, injected: inj, writeLine: quiet, perArm: 1,
  });
  assert.ok(existsSync(path.join(dir, 'results-dup.json')));
  await assert.rejects(runBatch({ tag: 'dup', jobs: mkJobs(), outDir: dir, injected: inj, writeLine: quiet }), /already has results/);
  const dir2 = outDir();
  await assert.rejects(runBatch({
    tag: 'k1', jobs: mkJobs(), outDir: dir2, env: { [SLOT]: '' }, writeLine: quiet,
  }), /DEEPSEEK_API_KEY is not set/);
  assert.ok(!existsSync(path.join(dir2, 'spend.jsonl')), 'no ledger written');
  // a key but a Settings with the model not ticked: refused by name before any call or ledger write
  const emptyHome = mkdtempSync(path.join(tmpdir(), 'fwdloop-f81-home-'));
  await assert.rejects(runBatch({
    tag: 'k2', jobs: mkJobs(), outDir: dir2, env: { [SLOT]: 'sk-test-not-a-real-key-0000000000' }, realConfigHome: emptyHome, writeLine: quiet,
  }), /deepseek-flash under DEEPSEEK_API_KEY is not in Settings/);
  assert.ok(!existsSync(path.join(dir2, 'spend.jsonl')));
  await assert.rejects(runBatch({
    tag: 'k3', jobs: mkJobs().map((j) => ({ ...j, hint: '' })), outDir: dir2, injected: inj, writeLine: quiet,
  }), /no hint block/);
  await assert.rejects(runBatch({
    tag: 'bad tag', jobs: mkJobs(), outDir: dir2, injected: inj, writeLine: quiet,
  }), /--tag is required/);
  assert.ok(!existsSync(path.join(dir2, 'spend.jsonl')));
});

test('the gate refuses a job whose send folder or input is missing, by name, at $0', () => {
  const jobs = mkJobs(['g1']);
  assert.doesNotThrow(() => gateJobs(jobs, path.join(tmpdir(), 'x')));
  const noDest = jobs.map((j) => ({ ...j, proseText: j.proseText.replace(/file:\/tmp\/[^\s]*dest-[^\s]*/, 'file:/nonexistent/f81-dest') }));
  assert.throws(() => gateJobs(noDest, path.join(tmpdir(), 'x')), /not an existing folder/);
  const noIn = jobs.map((j) => ({ ...j, proseText: j.proseText.replace(/resume\.md/, 'gone.md') }));
  assert.throws(() => gateJobs(noIn, path.join(tmpdir(), 'x')), /inputs do not read|does not parse/);
});

test('constants: HINT_HEADER is the one string F80 used; the stop line is the 2.5 runaway guard (hamr: no cap stop); withCap only touches the cap line', () => {
  assert.equal(HINT_HEADER, F80_HEADER);
  assert.equal(SPEND_STOP_USD, 2.5);
  assert.equal(PER_ARM >= 3, true);
  const prose = 'x\n\nArbiter guardrails (y):\nguardrail: cap $1 per run\nguardrail: send at line 2 to file:/a\n';
  assert.equal(withCap(prose, 0.1), prose.replace('cap $1 per', 'cap $0.1 per'));
  assert.throws(() => withCap('no cap line here', 0.1), /no cap line/);
});

// M4b am7: the jobs live in ~/.config/fwdloop/flows (read-only here); a machine without them skips.
const JOBS_ROOT = path.join(homedir(), '.config', 'fwdloop', 'flows');
test('the real jobs (only where the jobs folder exists): each block is a hint block, every input reads and every send folder is allowed', { skip: !existsSync(path.join(JOBS_ROOT, 'm7-walk-2', 'prose.txt')) || !existsSync(path.join(JOBS_ROOT, 'm10b-expenses', 'prose.txt')) }, () => {
  const jobs = loadJobs(JOBS_ROOT);
  assert.deepEqual(jobs.map((j) => j.id), ['m7-walk-2', 'm10b-expenses']);
  for (const j of jobs) assert.ok(j.hint.startsWith(HINT_HEADER) && j.hint.length <= 2000);
  gateJobs(jobs, path.join(tmpdir(), 'x'));
  assert.deepEqual(readdirSync(tmpdir()).filter(() => false), []);
});

test('pooling: a second tag from --start-n adds to the first; the totals sum both, the results file keeps only its own records, the first file is untouched', async () => {
  const dir = outDir();
  const inj = (p) => ({ provider: p, rates: RATES, modelId: MODEL });
  const first = await runBatch({
    tag: 'p1', jobs: mkJobs(), outDir: dir, injected: inj(scenario({ listens: false })), writeLine: quiet, perArm: 1,
  });
  assert.equal(first.records.length, 4);
  const before = readFileSync(path.join(dir, 'results-p1.json'), 'utf8');
  const lines = [];
  const second = await runBatch({
    tag: 'p2', jobs: mkJobs(), outDir: dir, injected: inj(scenario({ listens: false })), writeLine: (l) => lines.push(l), perArm: 3, startN: 2, pool: ['results-p1.json'],
  });
  assert.deepEqual(second.records.map((r) => r.n).filter((n, i, a) => a.indexOf(n) === i), [2, 3], 'runs n = 2 and 3 only');
  assert.ok(second.records.every((r) => r.tag === 'p2'));
  assert.equal(second.summary.ran, 8);
  assert.equal(second.summary.requested, 8);
  assert.deepEqual(second.summary.pooled, [{ tag: 'p1', records: 4 }, { tag: 'p2', records: 8 }]);
  assert.equal(second.summary.pairedSamples, 12);
  assert.equal(second.summary.A.samples, 6, 'A of both tags together');
  assert.equal(second.summary.B.samples, 6);
  assert.equal(second.summary.perJob.j1.A.samples, 3, 'three paired samples per arm per job only because the tags are pooled');
  assert.ok(!second.summary.perJob.j1.verdict.startsWith('INCONCLUSIVE: 2 A') && !/fewer than 3/.test(second.summary.perJob.j1.verdict));
  assert.ok(lines.some((l) => /^POOLED p1=4 p2=8 records/.test(l)));
  const file = JSON.parse(readFileSync(path.join(dir, 'results-p2.json'), 'utf8'));
  assert.equal(file.records.length, 8, 'the new file holds only its own records');
  assert.equal(readFileSync(path.join(dir, 'results-p1.json'), 'utf8'), before, 'the first results file is never rewritten');
});

test('pairing keys on (tag, job, n): one tag\'s unpaired A3 never pairs with another tag\'s B3', () => {
  const rec = (tag, arm, n) => ({
    tag, job: 'j', arm, n, draft: { ok: true }, sign: { ok: true }, run: { kind: 'paused-at-ask', steps: [] }, costUsd: 0.01,
  });
  const cross = [rec('t1', 'A', 3), rec('t2', 'B', 3)];
  assert.equal(paired(cross).length, 0);
  const ev = evaluate(cross, { minPerArm: 1 });
  assert.equal(ev.pairedSamples, 0);
  assert.equal(ev.unpairedDropped, 2);
  assert.equal(paired([...cross, rec('t1', 'B', 3), rec('t2', 'A', 3)]).length, 4, 'each tag now has its own pair');
});

test('a bad pool file is refused by name at $0, before any ledger write: missing, unreadable, other model, other job set, same tag, bad --start-n', async () => {
  const dir = outDir();
  const inj = { provider: scenario({ listens: true }), rates: RATES, modelId: MODEL };
  const mkFile = (name, o = {}) => writeFileSync(path.join(dir, name), JSON.stringify({ summary: { tag: name.replace(/^results-|\.json$/g, ''), model: MODEL === 'x' ? 'y' : 'deepseek-flash', ...o.summary }, hints: o.hints ?? { j1: {}, j2: {} }, records: [] }));
  writeFileSync(path.join(dir, 'results-junk.json'), '{not json');
  mkFile('results-othermodel.json', { summary: { model: 'some-other-model' } });
  mkFile('results-otherjobs.json', { hints: { j1: {}, zzz: {} } });
  mkFile('results-same.json', { summary: { tag: 't9' } });
  const go = (pool, extra = {}) => runBatch({
    tag: 't9', jobs: mkJobs(), outDir: dir, injected: inj, writeLine: quiet, perArm: 1, pool, ...extra,
  });
  await assert.rejects(go(['results-nope.json']), /--pool results-nope\.json does not exist/);
  await assert.rejects(go(['results-junk.json']), /--pool results-junk\.json is unreadable/);
  await assert.rejects(go(['results-othermodel.json']), /is model "some-other-model"/);
  await assert.rejects(go(['results-otherjobs.json']), /is for jobs \[j1,zzz\]/);
  await assert.rejects(go(['results-same.json']), /the tag of this run/);
  await assert.rejects(go([], { startN: 2 }), /--start-n must be an integer from 1 to 1/);
  assert.throws(() => loadPool(['results-nope.json'], { outDir: dir, model: 'deepseek-flash', jobIds: ['j1', 'j2'], tag: 'x' }), /does not exist/);
  assert.ok(!existsSync(path.join(dir, 'spend.jsonl')), 'no ledger written');
  assert.ok(!existsSync(path.join(dir, 'results-t9.json')), 'nothing written for the refused tag');
});
