// F81 POC (m8-step) — do step-failure notes (M8 shape) make the next RUN of the same job better? NOT the product.
// PAID. hamr launches it from his own terminal (see docs/logs/FINDINGS.md F81); no agent starts it.
//
//   export DEEPSEEK_API_KEY="$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')"
//   setsid nohup timeout 2400 node poc/m8-step/run.mjs --tag f81-2 --start-n 3 --pool results-f81-1.json > poc/m8-step/f81-2.log 2>&1 &
//
// Per sample, in a fresh mkdtemp root: draftToDir() (real, unchanged, noQuestions) -> signDraft() as `poc-f81` -> runFlow() with the real model
// step and a parking ask (the run ends at its first ask; code never answers it, the send step refuses).
//   A = no notes.  B = the M8 note block appended to the DRAFTER system prompt only (provider.generate wrapper; src/ untouched).
// Both arms wrap the run's provider too (appending nothing) and record whether any request carried the block.
// Limits on the POC signature (F81): signer `poc-f81`; only inside a mkdtemp root; config home = the test door (NODE_ENV=test +
// FWDLOOP_CONFIG_HOME inside the temp root, a copy of the deepseek rows only); the temp roots are removed once their record is written.
// Gates ($0, before any ledger write): empty key, used tag, unpriced model, a job that does not parse / whose inputs or send folder do not read.
// Runaway guard $2.50 over every tag (one ledger; not a decider, F81 [RULING]); per-sample job cap stays $0.10.
// A later tag pools with an earlier one: `--tag f81-2 --start-n 3 --pool results-f81-1.json` runs n = 3..PER_ARM and judges both tags' records, paired by (tag, job, n). Results: counts, red lines (cut, masked) and hint text only; never an artifact or an input.

import {
  existsSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  join, dirname, extname, isAbsolute,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { draftToDir, signDraft } from '../../src/authoring.js';
import { runFlow, makeParkingAskStep, checkSendDestination } from '../../src/runner.js';
import { readFlow, resolveRunDir } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { resolvePrimitives } from '../../src/primitives.js';
import { readAudit } from '../../src/books.js';
import { parseSignedText } from '../../src/signed-text.js';
import { readInputFacts } from '../../src/input-facts.js';
import { makeLiveModelStep, LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { configHome, readConfig } from '../../src/config.js';
import {
  checkKeyPreflight, appendSpendRow, ceilingCostUsd, priceRecord, makeProvider,
} from '../../src/provider.js';
import { ledgerTotalUsd, scrub, secretsFromEnv } from '../m6a/batch.mjs';
import { armProvider } from '../m8-refused/run.mjs';
import { HINT_HEADER } from './learn-ours.mjs';
import { loadJobs, withCap, JOB_CAP_USD } from './notes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Runaway guard ONLY, not a decider (hamr 2026-10-23 after f81-1: "run as much as you need to finish it, no need to stop for a cap"; F81 [RULING]).
// Worst case n=3..4: 8 samples x 2 x $0.10 job cap = $1.60 + $0.386 ledger + $0.20 headroom = about $2.2, under this line.
export const SPEND_STOP_USD = 2.5;
export const PER_ARM = 4; // requested; the cap decides; aim at least MIN_PER_ARM
export const MIN_PER_ARM = 3;
/** A sample is not started under this cap: the runner holds one round's ceiling ($0.0384) per attempt, so a smaller cap would cap-halt a run the plan did not earn. */
export const MIN_SAMPLE_CAP_USD = 0.07;
export const SIGNER = 'poc-f81';
export const SLOT = 'DEEPSEEK_API_KEY';
export const DRAFT_DEADLINE_MS = 600_000;
export const RUN_DEADLINE_MS = 1_200_000;
const DEFAULT_MODEL = 'deepseek-flash';
const TRY_VERDICTS = new Set(['green', 'softgreen', 'hitl', 'red', 'not-done']);
const REFUSING_SEND = async () => ({ ok: false, red: 'f81: the POC never sends' });

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** One sample's cap: the job cap, or half of what is left under the stop line, whichever is less. */
export const sampleCap = (ledgerUsd, stopUsd = SPEND_STOP_USD, jobCap = JOB_CAP_USD) => Math.min(jobCap, (stopUsd - ledgerUsd) / 2);

/** Per step from the run's audit rows: tries, red tries, how it ended. Red lines are cut to 200 chars (and masked by the caller's scrub). */
export function stepsOf(audit, clip = (s) => String(s)) {
  const by = new Map();
  for (const r of audit) {
    if (!Number.isInteger(r.attempt) || !TRY_VERDICTS.has(r.verdict)) continue;
    if (r.class === 'hitl' && r.verdict === 'red') continue;
    const s = by.get(r.step) ?? {
      step: r.step, class: r.class ?? null, tries: 0, redTries: 0, ended: null, redLines: [],
    };
    const red = r.verdict === 'red' || r.verdict === 'not-done';
    s.tries += 1;
    s.ended = red ? 'red' : 'green';
    if (red) { s.redTries += 1; s.redLines.push(clip(r.gap ?? '')); }
    by.set(r.step, s);
  }
  return [...by.values()];
}

/** The injection proof for one sample: B's drafter requests all carried the block, A's none, no step request of either arm. */
export function injectionProof(arm, draftCalls, runCalls) {
  const drafter = draftCalls.filter((c) => c.drafter);
  const carried = drafter.filter((c) => c.carried).length;
  const ok = (arm === 'B' ? drafter.length > 0 && carried === drafter.length : carried === 0)
    && draftCalls.filter((c) => c.carried && !c.drafter).length === 0
    && runCalls.filter((c) => c.carried).length === 0;
  return {
    ok, drafterCalls: drafter.length, drafterCarried: carried, draftCallsOnOtherPrompts: draftCalls.length - drafter.length, stepCalls: runCalls.length, stepCarried: runCalls.filter((c) => c.carried).length,
  };
}

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

/** Totals for one set of sample records. cost is null when ANY sample's cost is unknown (never 0). */
export function totals(recs) {
  const unknown = recs.some((r) => r.costUsd === null);
  return {
    samples: recs.length,
    failedDrafts: recs.filter((r) => !r.draft.ok || !r.sign.ok).length,
    runs: recs.filter((r) => r.run !== null).length,
    redRuns: recs.filter((r) => r.run !== null && r.run.kind === 'red').length,
    pausedRuns: recs.filter((r) => r.run !== null && r.run.kind === 'paused-at-ask').length,
    stepTries: sum(recs, (r) => (r.run?.steps ?? []).reduce((s, x) => s + x.tries, 0)),
    redStepTries: sum(recs, (r) => (r.run?.steps ?? []).reduce((s, x) => s + x.redTries, 0)),
    costUsd: unknown ? null : Number(sum(recs, (r) => r.costUsd).toFixed(6)),
    unknownCostSamples: recs.filter((r) => r.costUsd === null).length,
  };
}

/** Only samples whose pair (same tag, same job, same n) both ran: a cap stop between A_n and B_n must not skew the totals, and one tag's A3 never pairs with another tag's B3. */
export function paired(records) {
  const has = (tag, job, n, arm) => records.some((r) => r.tag === tag && r.job === job && r.n === n && r.arm === arm);
  return records.filter((r) => has(r.tag, r.job, r.n, 'A') && has(r.tag, r.job, r.n, 'B'));
}

/** Read earlier tags' results files for pooling. Refuses by name, before any ledger write: missing, unreadable, another model, another job set, the current tag. */
export function loadPool(files, {
  outDir, model, jobIds, tag,
}) {
  const pools = [];
  for (const f of files) {
    const p = isAbsolute(f) ? f : join(outDir, f);
    if (!existsSync(p)) throw new Error(`run: --pool ${f} does not exist`);
    let data;
    try { data = JSON.parse(readFileSync(p, 'utf8')); } catch (err) { throw new Error(`run: --pool ${f} is unreadable: ${err.message}`); }
    const ptag = data?.summary?.tag;
    if (typeof ptag !== 'string' || !Array.isArray(data.records)) throw new Error(`run: --pool ${f} is not a results file (no summary.tag or records)`);
    if (ptag === tag) throw new Error(`run: --pool ${f} is tag "${ptag}", the tag of this run`);
    if (pools.some((x) => x.tag === ptag)) throw new Error(`run: --pool ${f} repeats tag "${ptag}"`);
    if (data.summary.model !== model) throw new Error(`run: --pool ${f} is model "${data.summary.model}", this run is "${model}"`);
    const theirs = Object.keys(data.hints ?? {}).sort().join(',');
    const ours = [...jobIds].sort().join(',');
    if (theirs !== ours) throw new Error(`run: --pool ${f} is for jobs [${theirs}], this run is for [${ours}]`);
    pools.push({ tag: ptag, records: data.records.map((r) => ({ ...r, tag: ptag })) });
  }
  return pools;
}

function judge(A, B) {
  const a = totals(A);
  const b = totals(B);
  const bars = {
    redStepTries: { A: a.redStepTries, B: b.redStepTries, ok: b.redStepTries < a.redStepTries },
    redRunsPlusFailedDrafts: { A: a.redRuns + a.failedDrafts, B: b.redRuns + b.failedDrafts, ok: b.redRuns + b.failedDrafts <= a.redRuns + a.failedDrafts },
    cost: {
      A: a.costUsd, B: b.costUsd, limitB: a.costUsd === null ? null : Number((a.costUsd * 1.1).toFixed(6)), ok: a.costUsd !== null && b.costUsd !== null && b.costUsd <= a.costUsd * 1.1, unknown: a.costUsd === null || b.costUsd === null,
    },
  };
  return { A: a, B: b, bars, pass: bars.redStepTries.ok && bars.redRunsPlusFailedDrafts.ok && bars.cost.ok };
}

/** The pre-registered bar (F81): B helps only if all three hold, per job and overall; <3 paired samples per arm in a job = INCONCLUSIVE for it. */
export function evaluate(allRecords, { minPerArm = MIN_PER_ARM } = {}) {
  const records = paired(allRecords);
  const jobs = [...new Set(allRecords.map((r) => r.job))];
  const perJob = {};
  for (const id of jobs) {
    const A = records.filter((r) => r.job === id && r.arm === 'A');
    const B = records.filter((r) => r.job === id && r.arm === 'B');
    const j = judge(A, B);
    const short = A.length < minPerArm || B.length < minPerArm;
    const blind = j.A.redStepTries === 0 && j.B.redStepTries === 0 && j.A.failedDrafts + j.A.redRuns + j.B.failedDrafts + j.B.redRuns === 0;
    perJob[id] = { ...j, verdict: short ? `INCONCLUSIVE: ${A.length} A / ${B.length} B paired samples, fewer than ${minPerArm}` : blind ? 'INCONCLUSIVE: nothing went red in either arm, the test cannot tell' : j.pass ? 'HELPS' : 'DOES NOT HELP' };
  }
  const all = judge(records.filter((r) => r.arm === 'A'), records.filter((r) => r.arm === 'B'));
  const inconclusive = Object.entries(perJob).filter(([, v]) => v.verdict.startsWith('INCONCLUSIVE'));
  const blindAll = all.A.redStepTries === 0 && all.B.redStepTries === 0;
  let verdict;
  if (jobs.length === 0) verdict = 'INCONCLUSIVE: no sample ran';
  else if (inconclusive.length > 0) verdict = `INCONCLUSIVE: ${inconclusive.map(([id, v]) => `${id} (${v.verdict})`).join('; ')}`;
  else if (blindAll) verdict = 'INCONCLUSIVE: neither arm had any red step try, the test cannot tell';
  else verdict = all.pass ? 'HELPS' : 'DOES NOT HELP';
  return {
    ...all, verdict, perJob, pairedSamples: records.length, unpairedDropped: allRecords.length - records.length,
  };
}

/** $0 gate for every job: parses, inputs read (files only), send folders exist and are allowed, hint block present. Throws by name. */
export function gateJobs(jobs, flowsRoot) {
  for (const j of jobs) {
    const p = parseSignedText(withCap(j.proseText, JOB_CAP_USD));
    if (!p.ok) throw new Error(`run: job ${j.id} prose does not parse: ${p.reds.join('; ')}`);
    if (p.arbiter.sources.some((s) => s.kind !== 'file')) throw new Error(`run: job ${j.id} has a non-file input; the POC runs file inputs only`);
    const f = readInputFacts(p.arbiter.sources);
    if (!f.ok) throw new Error(`run: job ${j.id} inputs do not read: ${f.reds.join('; ')}`);
    for (const s of p.arbiter.sends) {
      const d = checkSendDestination(`${s.target.kind}:${s.target.path}`, { root: flowsRoot });
      if (!d.ok) throw new Error(`run: job ${j.id}: ${d.red}`);
    }
    if (!j.hint || !j.hint.startsWith(HINT_HEADER)) throw new Error(`run: job ${j.id} has no hint block (arm B would equal arm A)`);
  }
}

/** One sample. Everything that touches disk lives under `tmpRoot`, removed by the caller. */
async function runSample({
  job, arm, n, tag, capUsd, tmpRoot, live, model, env, deadlines, wrapDrafter = armProvider, clip,
}) {
  const root = join(tmpRoot, 'flows');
  const dir = join(tmpRoot, 'draft');
  mkdirSync(root, { recursive: true });
  const name = job.id;
  const prose = withCap(job.proseText, Number(capUsd.toFixed(3)));
  const draftCalls = [];
  const runCalls = [];
  const rec = {
    tag, job: job.id, arm, n, capUsd: Number(capUsd.toFixed(3)),
    draft: { ok: false, stop: null, rounds: null, calls: null, costUsd: null, spendComplete: false, reds: [], wallMs: null },
    sign: { ok: false, signedBy: null, reds: [] },
    run: null, costUsd: null, requests: null, injectionOk: false, timedOut: false,
  };

  // ---- draft -----------------------------------------------------------------
  const started = Date.now();
  let d;
  try {
    d = await withDeadline(draftToDir({
      proseRead: { ok: true, text: prose }, dir, root, name, slot: SLOT, model, provider: wrapDrafter(live.provider, arm === 'B' ? job.hint : '', draftCalls), rates: live.rates, modelId: live.modelId, env, noQuestions: true,
    }), deadlines.draft);
  } catch (err) {
    d = { ok: false, wrote: false, reds: [`crash: ${err.message}`], costUsd: null, spendComplete: false, stop: 'crash' };
  }
  if (d.__timedOut) { rec.timedOut = true; d = { ok: false, wrote: false, reds: ['wall-halt: draft deadline'], costUsd: null, spendComplete: false, stop: 'deadline' }; }
  rec.draft = {
    ok: d.ok === true, stop: d.stop ?? null, rounds: d.rounds ?? null, calls: d.calls ?? null, costUsd: d.costUsd ?? null, spendComplete: d.spendComplete === true || (d.wrote === false && d.costUsd === 0), reds: (d.reds ?? []).map((x) => clip(x)).slice(0, 5), wallMs: Date.now() - started,
  };
  let runCost = 0;
  let runComplete = true;
  const draftBook = { costUsd: rec.draft.costUsd, spendComplete: rec.draft.spendComplete, rounds: rec.draft.rounds, calls: rec.draft.calls, wallMs: rec.draft.wallMs };

  // ---- sign (POC signature: poc-f81, temp root only) --------------------------
  let signed = false;
  if (rec.draft.ok && !rec.timedOut) {
    const s = signDraft({ dir, approve: d.hash, signedBy: SIGNER, env: {}, keyNames: [] });
    rec.sign = { ok: s.ok === true, signedBy: s.ok ? (s.signature?.signedBy ?? null) : null, reds: (s.reds ?? []).map((x) => clip(x)).slice(0, 5) };
    signed = rec.sign.ok;
  }

  // ---- run to the first ask ---------------------------------------------------
  const runWall = Date.now();
  if (signed) {
    let runBook;
    try {
      const cat = loadCatalogue();
      if (!cat.ok) throw new Error(`catalogue: ${cat.reds.join('; ')}`);
      const flow = readFlow({ root, name, catalogue: cat.primitives });
      if (!flow.ok) throw new Error(`signed flow does not read: ${flow.reds.join('; ')}`);
      const sources = flow.arbiter.sources.map((s) => ({ id: s.role, path: s.path }));
      const flowDir = join(root, name);
      const rr = resolveRunDir(flowDir, 'run-1');
      if (!rr.ok) throw new Error(rr.red);
      const runDir = rr.runDir;
      const predicted = sources.map((s) => ({ id: s.id, frozen: join(runDir, 'inputs', `${s.id}${extname(s.path)}`) }));
      const verbs = [...new Set(flow.declaration.steps.flatMap((s) => s.primitives ?? []))];
      const { tools: primitives, reds: primitiveReds } = resolvePrimitives(cat.primitives, verbs, { runDir, inputs: predicted });
      const runProvider = armProvider(live.provider, '', runCalls); // wraps, appends nothing, records whether any step request carried the block
      const modelStep = makeLiveModelStep({
        slot: SLOT, model, spendPath: join(runDir, 'spend.jsonl'), provider: runProvider, rates: live.rates, modelId: live.modelId, env,
      });
      const res = await withDeadline(runFlow({
        root, name, runId: 'run-1', runModel: { slot: SLOT, model }, sources, catalogue: cat.primitives, modelStep, ceilingUsd: ceilingCostUsd(live.rates), askStep: makeParkingAskStep(), sendStep: REFUSING_SEND, primitives, primitiveReds, businessDate: new Date().toISOString().slice(0, 10),
      }), deadlines.run);
      if (res.__timedOut) { rec.timedOut = true; throw new Error('wall-halt: run deadline'); }
      const audit = readAudit(runDir);
      const complete = audit.every((r) => r.spendComplete !== false) && typeof res.spentUsd === 'number';
      runCost = complete ? res.spentUsd : null;
      runComplete = complete;
      rec.run = {
        outcome: res.outcome, kind: res.outcome === 'paused' ? 'paused-at-ask' : res.outcome === 'complete' ? 'green' : 'red', red: res.red ? clip(res.red) : null, steps: stepsOf(audit, clip), costUsd: runCost, spendComplete: complete, wallMs: Date.now() - runWall,
      };
    } catch (err) {
      runCost = null;
      runComplete = false;
      rec.run = {
        outcome: 'crash', kind: 'red', red: clip(err.message), steps: [], costUsd: null, spendComplete: false, wallMs: Date.now() - runWall,
      };
    }
    runBook = { costUsd: runCost, spendComplete: runComplete, wallMs: rec.run.wallMs };
    rec.runBook = runBook;
  }

  rec.costUsd = rec.draft.costUsd === null || runCost === null ? null : Number((rec.draft.costUsd + runCost).toFixed(6));
  const proof = injectionProof(arm, draftCalls, runCalls);
  rec.requests = proof;
  rec.injectionOk = proof.ok;
  rec.draftBook = draftBook;
  return rec;
}

export async function runBatch({
  tag, jobs, startN = 1, pool = [], outDir = __dirname, spendPath = join(outDir, 'spend.jsonl'), stopUsd = SPEND_STOP_USD, perArm = PER_ARM, minPerArm = MIN_PER_ARM, env = process.env, injected, model = DEFAULT_MODEL, realConfigHome,
  deadlines = { draft: DRAFT_DEADLINE_MS, run: RUN_DEADLINE_MS }, wrapDrafter = armProvider, writeLine = (s) => process.stdout.write(`${s}\n`), flowsRoot = join(tmpdir(), 'fwdloop-f81-gate'),
}) {
  // ---- $0 gates, before any ledger write ---------------------------------------------------
  if (!tag || /[^A-Za-z0-9._-]/.test(tag)) throw new Error('run: --tag is required (letters, digits, . _ - only)');
  if (!injected) {
    const key = checkKeyPreflight(SLOT, env);
    if (!key.ok) throw new Error(key.message);
  }
  const resultsPath = join(outDir, `results-${tag}.json`);
  if (existsSync(resultsPath)) throw new Error(`run: tag "${tag}" already has results — use a new --tag, never overwrite evidence`);
  if (!Number.isInteger(startN) || startN < 1 || startN > perArm) throw new Error(`run: --start-n must be an integer from 1 to ${perArm}`);
  const pools = loadPool(pool, {
    outDir, model, jobIds: jobs.map((j) => j.id), tag,
  });
  const cfgHome = mkdtempSync(join(tmpdir(), 'fwdloop-f81-cfg-'));
  const prevEnv = { NODE_ENV: process.env.NODE_ENV, FWDLOOP_CONFIG_HOME: process.env.FWDLOOP_CONFIG_HOME };
  const secrets = secretsFromEnv(env[SLOT]);
  const clip = (s) => scrub(String(s).replace(/\s+/g, ' ').slice(0, 200), secrets);
  const tmpRoots = [];
  try {
    let live = injected;
    if (!live) {
      // the temp config holds a copy of the deepseek rows only (read from the real config, read-only); the run reads prices from there
      const real = readConfig({ home: realConfigHome ?? configHome() });
      const prov = real.providers?.[SLOT];
      const row = (real.models?.[SLOT] ?? []).find((m) => m.model === model);
      if (!prov || !row) throw new Error(`run: ${model} under ${SLOT} is not in Settings > Providers - tick it with both prices; refused at $0`);
      writeFileSync(join(cfgHome, 'config.json'), `${JSON.stringify({ providers: { [SLOT]: prov }, models: { [SLOT]: [row] } }, null, 2)}\n`, { mode: 0o600 });
      chmodSync(join(cfgHome, 'config.json'), 0o600);
      const made = makeProvider(SLOT, {
        model, env, configHome: cfgHome, ...LIVE_PROVIDER_OPTIONS,
      }); // an unpriced / unticked model refuses here, by name
      live = { provider: made.provider, rates: made.rates, modelId: made.modelId };
    }
    const roundCeiling = ceilingCostUsd(live.rates);
    gateJobs(jobs, flowsRoot);
    // the test door: a test process reads only FWDLOOP_CONFIG_HOME, which is inside a temp root, never ~/.config/fwdloop
    process.env.NODE_ENV = 'test';
    process.env.FWDLOOP_CONFIG_HOME = cfgHome;

    const records = [];
    let stoppedBy = null;
    outer:
    for (let n = startN; n <= perArm; n += 1) {
      for (const job of jobs) {
        for (const arm of ['A', 'B']) {
          const total = ledgerTotalUsd(spendPath);
          const cap = sampleCap(total, stopUsd);
          const minCap = Math.max(MIN_SAMPLE_CAP_USD, 1.25 * roundCeiling);
          if (cap < minCap) {
            stoppedBy = `spend: ledger $${total.toFixed(4)}; a sample cap of $${cap.toFixed(4)} is under the $${minCap.toFixed(4)} minimum (one round's ceiling is $${roundCeiling.toFixed(4)}) under the $${stopUsd.toFixed(2)} stop`;
            break outer;
          }
          const tmpRoot = mkdtempSync(join(tmpdir(), 'fwdloop-f81-'));
          tmpRoots.push(tmpRoot);
          let rec;
          try {
            // eslint-disable-next-line no-await-in-loop
            rec = await runSample({
              job, arm, n, tag, capUsd: cap, tmpRoot, live, model, env, deadlines, wrapDrafter, clip,
            });
          } finally {
            // the record is complete before this runs (it holds only counts and cut red lines); the root, with its signed flow, goes now
            rmSync(tmpRoot, { recursive: true, force: true });
          }
          // Booked even when red/crashed; an unknown cost is null (the ledger reprices it at the ceiling), never 0.
          const book = (suffix, b, step) => appendSpendRow(spendPath, {
            runId: `f81-${tag}-${job.id}-${arm}${n}-${suffix}`, step, model, modelReturned: null, costUsd: b.costUsd ?? null, rounds: b.rounds ?? null, calls: b.calls ?? null, spendComplete: b.spendComplete === true, wallMs: b.wallMs ?? null, price: priceRecord(null, live.rates),
          });
          book('draft', rec.draftBook, 'draft-f81');
          if (rec.runBook) book('run', rec.runBook, 'run-f81');
          delete rec.draftBook;
          delete rec.runBook;
          records.push(rec);
          writeLine(`${job.id} ${arm}${n}: cap=$${rec.capUsd} draft=${rec.draft.ok ? 'ok' : `FAILED(${rec.draft.stop})`} sign=${rec.sign.ok ? 'ok' : 'no'} run=${rec.run ? rec.run.kind : '-'}`
            + ` stepTries=${(rec.run?.steps ?? []).reduce((s, x) => s + x.tries, 0)} redTries=${(rec.run?.steps ?? []).reduce((s, x) => s + x.redTries, 0)} cost=${rec.costUsd === null ? 'UNKNOWN' : `$${rec.costUsd.toFixed(5)}`}`
            + ` inject=${rec.injectionOk ? 'ok' : 'BROKEN'} (${rec.requests.drafterCarried}/${rec.requests.drafterCalls} drafter, ${rec.requests.stepCarried}/${rec.requests.stepCalls} step)`);
          if (!rec.injectionOk) { stoppedBy = `injection: ${job.id} ${arm}${n} did not carry the block as registered (B on every drafter call, A on none, steps on none); the arms are not what F81 registered`; break outer; }
          if (rec.timedOut) { stoppedBy = 'deadline: a draft or run hung; stopping, its cost booked at the ceiling'; break outer; }
        }
      }
    }

    const pooledRecords = [...pools.flatMap((p) => p.records), ...records];
    const ev = evaluate(pooledRecords, { minPerArm });
    const summary = {
      tag, model, ran: records.length, requested: jobs.length * (perArm - startN + 1) * 2, startN, pooled: [...pools.map((p) => ({ tag: p.tag, records: p.records.length })), { tag, records: records.length }], stoppedBy, ledgerTotalUsd: Number(ledgerTotalUsd(spendPath).toFixed(5)), roundCeilingUsd: roundCeiling, verdict: ev.verdict, pass: ev.verdict === 'HELPS', bars: ev.bars, A: ev.A, B: ev.B, perJob: ev.perJob, pairedSamples: ev.pairedSamples, unpairedDropped: ev.unpairedDropped,
    };
    const hints = Object.fromEntries(jobs.map((j) => [j.id, { text: j.hint, info: j.hintInfo ?? null }]));
    writeFileSync(resultsPath, scrub(`${JSON.stringify({ summary, hints, records }, null, 2)}\n`, secrets), { flag: 'wx' });
    writeLine(`POOLED ${summary.pooled.map((p) => `${p.tag}=${p.records}`).join(' ')} records; judged together, paired by (tag, job, n)`);
    writeLine(`SUMMARY ${JSON.stringify({ ...summary, perJob: undefined })}`);
    for (const [id, v] of Object.entries(ev.perJob)) writeLine(`  ${id}: ${v.verdict} | A ${JSON.stringify(v.A)} | B ${JSON.stringify(v.B)}`);
    writeLine(`BARS: red step tries B<A ${ev.bars.redStepTries.ok} (${ev.bars.redStepTries.B} vs ${ev.bars.redStepTries.A}); red runs + failed drafts B<=A ${ev.bars.redRunsPlusFailedDrafts.ok} (${ev.bars.redRunsPlusFailedDrafts.B} vs ${ev.bars.redRunsPlusFailedDrafts.A}); cost B<=A+10% ${ev.bars.cost.ok} (${ev.bars.cost.B} vs ${ev.bars.cost.A})`);
    writeLine(`VERDICT: ${ev.verdict}`);
    return { records, summary, tmpRoots, cfgHome };
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(cfgHome, { recursive: true, force: true });
    for (const r of tmpRoots) rmSync(r, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : undefined; };
  const per = arg('--per-arm');
  const start = arg('--start-n');
  const pool = process.argv.flatMap((a, i) => (a === '--pool' && process.argv[i + 1] ? process.argv[i + 1].split(',').filter(Boolean) : []));
  runBatch({
    tag: arg('--tag'), jobs: loadJobs(), pool, ...(per ? { perArm: Number(per) } : {}), ...(start ? { startN: Number(start) } : {}),
  }).then(
    () => process.exit(0),
    (err) => { process.stderr.write(`REFUSED: ${scrub(err.message, secretsFromEnv(process.env[SLOT]))}\n`); process.exit(1); },
  );
}
