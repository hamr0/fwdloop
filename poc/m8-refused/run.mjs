// F80 POC (m8-refused) — do refused-plan notes help the next draft of the same job? NOT the product.
//
//   export DEEPSEEK_API_KEY="$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')"
//   setsid nohup timeout 1800 node poc/m8-refused/run.mjs --tag f80-1 > poc/m8-refused/f80-1.log 2>&1 &
//
// The REAL `draft()` of src/drafter.js (unchanged) drafts each of 3 jobs 3 times per arm, interleaved A,B,A,B,A,B per job.
//   A = as today.  B = same, the hint block appended to the system message by wrapping provider.generate (src/ is untouched).
// Both arms use the same wrapper, which records per call whether the request carried the block.
// Gates ($0, before any ledger write): empty/odd key refuses, an existing tag refuses, each job's inputs must read.
// Spend: before each draft, ledger total (unpriced row at its ceiling) + one round's ceiling must stay <= $0.25, and the
// draft's own budget is the prose cap ($0.25) less the ledger total (priorSpend), so the drafter itself stops a round that cannot fit.
// Nothing written holds the key (literal scrub) or an input/artifact (counts, refusal texts and hint text only).

import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../../src/drafter.js';
import { parseSignedText } from '../../src/signed-text.js';
import { readInputFacts } from '../../src/input-facts.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import {
  checkKeyPreflight, appendSpendRow, ceilingCostUsd, priceRecord, makeProvider,
} from '../../src/provider.js';
import { ratesFor } from '../rates.mjs';
import { ledgerTotalUsd, scrub, secretsFromEnv } from '../m6a/batch.mjs';
import { loadJobs } from './notes.mjs';
import { HINT_HEADER } from './learn-poc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SPEND_STOP_USD = 0.25;
export const DRAFTS_PER_ARM = 3;
export const DRAFT_DEADLINE_MS = 600_000;
const DEFAULT_MODEL = 'deepseek-flash';
/** how src/drafter.js buildSystemPrompt starts: the one system prompt arm B adds the block to */
export const DRAFTER_PROMPT_START = 'You are the fwdloop drafter.';

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * `base` with generate() wrapped: arm B appends `hint` to the system message; both arms record, per call, whether the
 * request that went to the provider carried the hint header (the proof the arm differs). Reads fall through to `base`
 * (lastMalformedToolCall is set on it by its own generate).
 */
export function armProvider(base, hint, calls) {
  const wrapped = Object.create(base);
  wrapped.generate = async (messages, tools, options) => {
    // only the drafter's own system prompt gets the block; a page/sheet map call (a different system prompt) is left alone in both arms
    const at = messages.findIndex((x) => x.role === 'system' && String(x.content).startsWith(DRAFTER_PROMPT_START));
    const sent = hint && at !== -1 ? messages.map((m, i) => (i === at ? { ...m, content: `${m.content}\n\n${hint}` } : m)) : messages;
    const sys = sent.find((m) => m.role === 'system');
    calls.push({ drafter: at !== -1, carried: String(sys?.content ?? '').includes(HINT_HEADER), systemChars: String(sys?.content ?? '').length });
    return base.generate(sent, tools, options);
  };
  return wrapped;
}

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

/** Totals for one set of draft records. cost is null when ANY draft's cost is unknown (never 0). */
export function totals(recs) {
  const unknown = recs.some((r) => r.costUsd === null);
  return {
    drafts: recs.length,
    failed: recs.filter((r) => !r.ok).length,
    refusalRounds: sum(recs, (r) => r.refusalRounds),
    structureRetries: sum(recs, (r) => r.structureRetries ?? 0),
    rounds: sum(recs, (r) => r.rounds ?? 0),
    costUsd: unknown ? null : Number(sum(recs, (r) => r.costUsd).toFixed(6)),
    unknownCostDrafts: recs.filter((r) => r.costUsd === null).length,
    refusedDrafts: recs.filter((r) => r.refusalRounds > 0).length,
  };
}

/** The pre-registered bar (F80): B wins only if all three hold; INCONCLUSIVE when the test cannot tell. */
export function evaluate(records, { complete }) {
  const A = records.filter((r) => r.arm === 'A');
  const B = records.filter((r) => r.arm === 'B');
  const a = totals(A);
  const b = totals(B);
  const costKnown = a.costUsd !== null && b.costUsd !== null;
  const bars = {
    refusalRounds: { A: a.refusalRounds, B: b.refusalRounds, ok: b.refusalRounds < a.refusalRounds },
    failed: { A: a.failed, B: b.failed, ok: b.failed <= a.failed },
    cost: { A: a.costUsd, B: b.costUsd, ok: b.costUsd !== null && a.costUsd !== null && b.costUsd <= a.costUsd, unknown: !costKnown },
  };
  const pass = complete && bars.refusalRounds.ok && bars.failed.ok && bars.cost.ok;
  let verdict;
  if (!complete) verdict = 'INCONCLUSIVE: the run stopped before all 18 drafts';
  else if (a.refusalRounds === 0 && b.refusalRounds === 0) verdict = 'INCONCLUSIVE: no draft was refused in either arm, the test cannot tell';
  else if (pass) verdict = 'HELPS';
  else if (b.costUsd === null || a.costUsd === null) verdict = 'DOES NOT HELP: a cost is unknown, so the cost bar cannot be met';
  else verdict = 'DOES NOT HELP';
  const perJob = {};
  for (const id of [...new Set(records.map((r) => r.job))]) {
    const ja = totals(A.filter((r) => r.job === id));
    const jb = totals(B.filter((r) => r.job === id));
    perJob[id] = { A: ja, B: jb };
  }
  return { A: a, B: b, bars, pass, verdict, perJob };
}

export async function runBatch({
  tag, jobs, outDir = __dirname, spendPath = join(outDir, 'spend.jsonl'), stopUsd = SPEND_STOP_USD, perArm = DRAFTS_PER_ARM,
  deadlineMs = DRAFT_DEADLINE_MS, env = process.env, injected, model = DEFAULT_MODEL, draftFn = draft,
  writeLine = (s) => process.stdout.write(`${s}\n`),
}) {
  // ---- $0 gates, before any ledger write ------------------------------------------------
  if (!tag || /[^A-Za-z0-9._-]/.test(tag)) throw new Error('run: --tag is required (letters, digits, . _ - only)');
  if (!injected) {
    const key = checkKeyPreflight('DEEPSEEK_API_KEY', env);
    if (!key.ok) throw new Error(key.message);
  }
  const resultsPath = join(outDir, `results-${tag}.json`);
  if (existsSync(resultsPath)) throw new Error(`run: tag "${tag}" already has results — use a new --tag, never overwrite evidence`);
  const rates = ratesFor(injected, model); // an unpriced / unticked model refuses here, by name
  const roundCeiling = ceilingCostUsd(rates);
  for (const j of jobs) {
    const p = parseSignedText(j.proseText);
    if (!p.ok) throw new Error(`run: job ${j.id} prose does not parse: ${p.reds.join('; ')}`);
    const f = readInputFacts(p.arbiter.sources);
    if (!f.ok) throw new Error(`run: job ${j.id} inputs do not read: ${f.reds.join('; ')}`);
    if (!j.hint || !j.hint.startsWith(HINT_HEADER)) throw new Error(`run: job ${j.id} has no hint block (arm B would equal arm A)`);
  }
  const secrets = secretsFromEnv(env.DEEPSEEK_API_KEY);
  let live = injected;
  if (!live) {
    const made = makeProvider('DEEPSEEK_API_KEY', { model, env, ...LIVE_PROVIDER_OPTIONS });
    live = { provider: made.provider, rates: made.rates, modelId: made.modelId };
  }

  const records = [];
  let stoppedBy = null;
  outer:
  for (const job of jobs) {
    for (let i = 1; i <= perArm; i += 1) {
      for (const arm of ['A', 'B']) {
        const total = ledgerTotalUsd(spendPath);
        if (total + roundCeiling > stopUsd) {
          stoppedBy = `spend: ledger $${total.toFixed(4)} + one round's ceiling $${roundCeiling.toFixed(4)} would pass $${stopUsd.toFixed(2)}`;
          break outer;
        }
        const calls = [];
        const provider = armProvider(live.provider, arm === 'B' ? job.hint : '', calls);
        const started = Date.now();
        let r;
        try {
          // eslint-disable-next-line no-await-in-loop
          r = await withDeadline(draftFn({
            proseText: job.proseText, provider, rates: live.rates, modelId: live.modelId, model, env,
            priorSpend: () => ledgerTotalUsd(spendPath),
          }), deadlineMs);
        } catch (err) {
          r = { ok: false, reds: [`crash: ${err.message}`], rounds: null, costUsd: null, stop: 'crash', log: [] };
        }
        const timedOut = !!r.__timedOut;
        if (timedOut) r = { ok: false, reds: ['wall-halt: draft deadline'], rounds: null, costUsd: null, stop: 'deadline', log: [] };
        const wallMs = Date.now() - started;
        // Booked even when red/crashed; an unknown cost is null (the ledger reprices it at the ceiling), never 0.
        appendSpendRow(spendPath, {
          runId: `f80-${tag}-${job.id}-${arm}${i}`, step: 'draft-f80', model, modelReturned: r.modelReturned ?? null,
          costUsd: r.costUsd ?? null, rounds: r.rounds ?? null, calls: r.calls ?? null, spendComplete: r.spendComplete ?? false, wallMs, price: priceRecord(null, live.rates),
        });
        const log = r.log ?? [];
        const rec = {
          job: job.id, arm, n: i, ok: r.ok === true, stop: r.stop ?? null,
          refusalRounds: log.filter((e) => Array.isArray(e.reds) && e.reds.length > 0).length,
          structureRetries: r.structureRetries ?? null, rounds: log.length, meteredRounds: r.rounds ?? null, calls: r.calls ?? null,
          costUsd: r.costUsd ?? null, spendComplete: r.spendComplete ?? false,
          roundLog: log.map((e) => ({ round: e.round, kind: e.kind, outcome: e.outcome, reds: e.reds ?? [] })),
          finalReds: r.ok ? [] : (r.reds ?? []),
          draftRounds: log.filter((e) => e.kind !== 'page-map' && e.kind !== 'sheet-map').length, mapRounds: log.filter((e) => e.kind === 'page-map' || e.kind === 'sheet-map').length,
          requests: {
            calls: calls.length, drafterCalls: calls.filter((c) => c.drafter).length, carriedHint: calls.filter((c) => c.carried).length, carriedOnNonDrafter: calls.filter((c) => c.carried && !c.drafter).length, systemChars: calls.map((c) => c.systemChars),
          },
          modelReturned: r.modelReturned ?? null, wallMs,
        };
        records.push(rec);
        writeLine(`${job.id} ${arm}${i}: ${rec.ok ? 'ok' : `FAILED(${rec.stop})`} refusals=${rec.refusalRounds} structure=${rec.structureRetries} rounds=${rec.rounds} `
          + `cost=${rec.costUsd === null ? 'UNKNOWN' : `$${rec.costUsd.toFixed(5)}`} carried=${rec.requests.carriedHint}/${rec.requests.drafterCalls} drafter calls (${rec.mapRounds} map)`);
        if (timedOut) { stoppedBy = 'deadline: a draft hung; stopping, its cost booked at the ceiling'; break outer; }
      }
    }
  }

  const complete = records.length === jobs.length * perArm * 2;
  const verdict = evaluate(records, { complete });
  const summary = {
    tag, model, ran: records.length, of: jobs.length * perArm * 2, stoppedBy, ledgerTotalUsd: Number(ledgerTotalUsd(spendPath).toFixed(5)), roundCeilingUsd: roundCeiling,
    verdict: verdict.verdict, pass: verdict.pass, bars: verdict.bars, A: verdict.A, B: verdict.B, perJob: verdict.perJob,
  };
  const hints = Object.fromEntries(jobs.map((j) => [j.id, { text: j.hint, info: j.hintInfo ?? null }]));
  writeFileSync(resultsPath, scrub(`${JSON.stringify({ summary, hints, records }, null, 2)}\n`, secrets), { flag: 'wx' });
  writeLine(`SUMMARY ${JSON.stringify({ ...summary, perJob: undefined })}`);
  for (const [id, v] of Object.entries(verdict.perJob)) writeLine(`  ${id}: A ${JSON.stringify(v.A)} | B ${JSON.stringify(v.B)}`);
  writeLine(`BARS: refusal rounds B<A ${verdict.bars.refusalRounds.ok} (${verdict.bars.refusalRounds.B} vs ${verdict.bars.refusalRounds.A}); failed B<=A ${verdict.bars.failed.ok} (${verdict.bars.failed.B} vs ${verdict.bars.failed.A}); cost B<=A ${verdict.bars.cost.ok} (${verdict.bars.cost.B} vs ${verdict.bars.cost.A})`);
  writeLine(`VERDICT: ${verdict.verdict}`);
  return { records, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--tag');
  const tag = i !== -1 ? process.argv[i + 1] : undefined;
  runBatch({ tag, jobs: loadJobs() }).then(
    () => process.exit(0),
    (err) => { process.stderr.write(`REFUSED: ${scrub(err.message, secretsFromEnv(process.env.DEEPSEEK_API_KEY))}\n`); process.exit(1); },
  );
}
