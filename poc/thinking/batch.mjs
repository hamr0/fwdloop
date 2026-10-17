#!/usr/bin/env node
// POC (throwaway, never shipped): runs signed jobs under the three thinking arms, headless, through the ENGINE COPY's CLI
// (poc/thinking/engine, built by make-engine.mjs). Never writes inside the repo's flows/: each job's signed files are copied
// to <out>/<arm>/<job> and the runs happen there. One JSON line per run -> <out>/results.jsonl.
//
//   node poc/thinking/batch.mjs --job aging-live-4,am29-walk-2 --arm today,on,retry --n 5 \
//        --out ~/thinking-batch-1 --budget-usd 0.50 [--flows ./flows] [--fake]
//
// Arms are interleaved per iteration (today, on, retry, today, ...) so provider drift hits each arm alike.
// Every ask is answered `accept` through the real `answer` verb, then the real `resume` verb. Nothing is redone, so the
// retry arm's "redo -> on" rule is covered by the arm mapping test, not by this batch (see report).
// Money rules: refuse to start a run if spent-so-far + the job's cap would exceed --budget-usd; an unknown cost stops the batch.
import { parseArgs } from 'node:util';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, cpSync, appendFileSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS } from './arm.mjs';
import { makeEngine } from './make-engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const CLI_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ASKS = 10;
const RUN_BASE = 1000;

const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const die = (m) => { process.stderr.write(`batch: ${m}\n`); process.exit(2); };

export function parseBatchArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      job: { type: 'string' }, arm: { type: 'string', default: ARMS.join(',') }, n: { type: 'string', default: '1' },
      out: { type: 'string' }, 'budget-usd': { type: 'string' }, flows: { type: 'string', default: join(repo, 'flows') },
      fake: { type: 'boolean', default: false },
    },
  });
  const jobs = (values.job ?? '').split(',').filter(Boolean);
  const arms = values.arm.split(',').filter(Boolean);
  const n = Number(values.n);
  const budget = Number(values['budget-usd']);
  if (jobs.length === 0) die('--job <name[,name]> is required');
  for (const a of arms) if (!ARMS.includes(a)) die(`unknown arm "${a}" (expected ${ARMS.join(', ')})`);
  if (!Number.isInteger(n) || n < 1 || n > 99) die('--n must be a whole number >= 1');
  if (!values.out) die('--out <dir> is required (outside the repo)');
  if (!Number.isFinite(budget) || budget <= 0) die('--budget-usd <number > 0> is required');
  const out = resolve(values.out);
  if (out === repo || out.startsWith(`${repo}/`)) die('--out must be outside the repo');
  const flows = resolve(values.flows);
  if (existsSync(join(out, 'results.jsonl')) || (existsSync(out) && readdirSync(out).length > 0)) die(`--out ${out} already has content; use a new --out (consumed batches are never overwritten)`);
  for (const j of jobs) if (!existsSync(join(flows, j, 'signature.json'))) die(`job "${j}" has no signature.json under ${flows}`);
  return { jobs, arms, n, budget, out, flows, fake: values.fake };
}

/** The job's source roles -> file paths: the frozen inputs of its latest run (read-only). */
function jobSources(flows, job) {
  const runsDir = join(flows, job, 'runs');
  const ids = existsSync(runsDir) ? readdirSync(runsDir).filter((r) => /^run-\d+$/.test(r) && existsSync(join(runsDir, r, 'inputs.json'))) : [];
  ids.sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  if (ids.length === 0) die(`job "${job}" has no earlier run with inputs.json to take its sources from`);
  const manifest = JSON.parse(readFileSync(join(runsDir, ids[0], 'inputs.json'), 'utf8'));
  return manifest.map((m) => {
    const p = join(runsDir, ids[0], 'inputs', `${m.id}${extname(m.frozen)}`);
    if (!existsSync(p)) die(`job "${job}": frozen input ${basename(p)} is missing`);
    return { role: m.id, path: p };
  });
}

function copyJob(flows, job, dest) {
  const skip = new Set(['runs', 'triggers', 'triggers.jsonl', 'schedule.json', 'schedule-ledger.jsonl', 'history.jsonl']);
  mkdirSync(join(dest, 'runs'), { recursive: true });
  for (const n of readdirSync(join(flows, job))) if (!skip.has(n)) cpSync(join(flows, job, n), join(dest, n), { recursive: true });
}

function cli(engineBin, args, env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [engineBin, ...args], { env, encoding: 'utf8', timeout: CLI_TIMEOUT_MS });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', wallMs: Date.now() - t0, timedOut: r.error?.code === 'ETIMEDOUT' };
}

/** Rolls one finished run into its result row. Exported for the tests. */
export function rollup({ job, arm, runId, flowDir, runDir, callsPath, wallMs, note }) {
  const hist = readJsonl(join(flowDir, 'history.jsonl')).filter((h) => h.runId === runId).at(-1) ?? null;
  const audit = readJsonl(join(runDir, 'audit.jsonl')).filter((a) => a.model != null);
  const calls = readJsonl(callsPath);
  const turnsPerStep = {}; const attemptsPerStep = {}; const toolsPerStep = {};
  for (const c of calls) turnsPerStep[c.step] = (turnsPerStep[c.step] ?? 0) + 1;
  for (const a of audit) {
    attemptsPerStep[a.step] = Math.max(attemptsPerStep[a.step] ?? 0, a.attempt ?? 0);
    toolsPerStep[a.step] ??= {};
    for (const [k, v] of Object.entries(a.tools ?? {})) toolsPerStep[a.step][k] = (toolsPerStep[a.step][k] ?? 0) + v;
  }
  const outcome = hist?.outcome ?? 'no-history-row';
  const known = hist && hist.spendComplete === true && typeof hist.spentUsd === 'number';
  return {
    job, arm, runId, outcome, pass: outcome === 'complete',
    costUsd: known ? hist.spentUsd : null, // unknown is null, never 0
    wallMs, turns: calls.length, turnsPerStep, attemptsPerStep, toolsPerStep,
    calls: calls.map((c) => ({ step: c.step, attempt: c.attempt, modeSent: c.hasKey ? c.modeSent : null, thinkingStatus: c.thinkingStatus, toolCalls: c.toolCalls, ...(c.error ? { error: c.error } : {}) })),
    ...(note ? { note } : {}),
  };
}

async function main() {
  const a = parseBatchArgs(process.argv.slice(2));
  const { engine } = makeEngine();
  const engineBin = join(engine, 'bin', 'fwdloop');
  const { readPlan } = await import(join(engine, 'src', 'flow.js'));
  const { loadCatalogue } = await import(join(engine, 'src', 'catalogue.js'));
  const cat = loadCatalogue();
  if (!cat.ok) die(`catalogue: ${cat.reds.join('; ')}`);

  mkdirSync(a.out, { recursive: true });
  mkdirSync(join(a.out, 'calls'));
  const resultsPath = join(a.out, 'results.jsonl');
  const jobInfo = {};
  for (const job of a.jobs) {
    const sources = jobSources(a.flows, job);
    const probeRoot = join(a.out, '.probe');
    copyJob(a.flows, job, join(probeRoot, job));
    const read = readPlan({ root: probeRoot, name: job, catalogue: cat.primitives });
    rmSync(probeRoot, { recursive: true, force: true });
    if (!read.ok) die(`job "${job}": ${read.reds.join('; ')}`);
    const capUsd = read.arbiter.capUsd;
    if (typeof capUsd !== 'number') die(`job "${job}" has no numeric cap`);
    jobInfo[job] = { sources, capUsd };
  }
  for (const arm of a.arms) for (const job of a.jobs) copyJob(a.flows, job, join(a.out, arm, job));

  const baseEnv = { ...process.env };
  delete baseEnv.FWDLOOP_POC_SEND_DIR; // live sends go to the signed destination; only --fake redirects
  if (a.fake) {
    mkdirSync(join(a.out, 'send-sink'), { recursive: true }); baseEnv.FWDLOOP_POC_SEND_DIR = join(a.out, 'send-sink'); baseEnv.NODE_ENV = 'test'; baseEnv.FWDLOOP_TEST_MODEL_STEP = join(here, 'fake-step.mjs'); }
  let spent = 0;
  let stopped = null;
  for (let i = 1; i <= a.n && !stopped; i += 1) {
    for (const arm of a.arms) {
      for (const job of a.jobs) {
        const { sources, capUsd } = jobInfo[job];
        if (spent + capUsd > a.budget) { stopped = `budget: spent $${spent} + ${job} cap $${capUsd} would exceed --budget-usd ${a.budget}`; break; }
        const root = join(a.out, arm);
        const flowDir = join(root, job);
        const runId = `run-${RUN_BASE + a.arms.indexOf(arm) * 100 + i}`; // clear of earlier run ids: the signed send never overwrites a name that exists
        const runDir = join(flowDir, 'runs', runId);
        const callsPath = join(a.out, 'calls', `${job}-${arm}-${runId}.jsonl`);
        const env = { ...baseEnv, FWDLOOP_POC_ARM: arm, FWDLOOP_POC_CALLS: callsPath };
        let wallMs = 0; let note = null;
        let r = cli(engineBin, ['run', job, '--root', root, '--run-id', runId, ...sources.flatMap((s) => ['--source', `${s.role}=${s.path}`])], env);
        wallMs += r.wallMs;
        for (let k = 0; k < MAX_ASKS; k += 1) {
          const m = /parked: askId=(\S+)/.exec(r.out);
          if (!m) break;
          const ans = cli(engineBin, ['answer', m[1], 'accept', '--root', root], env);
          wallMs += ans.wallMs;
          if (ans.status !== 0) { note = `answer failed: ${ans.err.trim().slice(0, 200)}`; break; }
          r = cli(engineBin, ['resume', runId, '--flow', job, '--root', root], env);
          wallMs += r.wallMs;
        }
        if (r.timedOut) note = 'cli timed out';
        else if (!note && r.status !== 0 && !/complete:/.test(r.out)) note = (r.err.trim().split('\n').at(-1) ?? '').slice(0, 300);
        const row = rollup({ job, arm, runId, flowDir, runDir, callsPath, wallMs, note });
        appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
        process.stdout.write(`${job} ${arm} ${runId}: ${row.outcome} cost=${row.costUsd} turns=${row.turns}\n`);
        if (row.costUsd === null) { stopped = `unknown cost on ${job} ${arm} ${runId}: batch stopped`; break; }
        spent += row.costUsd;
      }
      if (stopped) break;
    }
  }
  process.stdout.write(`${stopped ? `STOPPED: ${stopped}\n` : 'done\n'}spent so far: $${spent}\nresults: ${resultsPath}\n`);
  if (stopped) process.exitCode = 3;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { process.stderr.write(`batch: ${e.stack}\n`); process.exit(1); });
