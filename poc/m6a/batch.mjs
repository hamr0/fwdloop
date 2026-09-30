// M6a POC — paid-batch runner. NOT the product.
//
//   export DEEPSEEK_API_KEY="$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')"
//   setsid nohup node poc/m6a/batch.mjs --n 20 --tag m6a-poc-1 > poc/m6a/out/m6a-poc-1.log 2>&1 &
//
// Gates, all $0 and all before the first paid round:
//   - key preflight (unset / empty / whitespace / newline key refuses)
//   - a used --tag refuses (never overwrite live evidence)
//   - the M6a cap ($1.00 across ALL of M6a, poc/m6a/out/spend.jsonl): refuse to
//     start, or to start the next draft, if the ledger total (an unpriced row
//     counts at its ceiling) plus this draft's own hard budget could cross it.
// Every draft is booked in the ledger even when it fails or throws. Nothing
// written contains the key (literal scrub on write + a sweep at the end).

import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkKeyPreflight, appendSpendRow, readSpendRows, ceilingCostUsd,
} from '../../src/provider.js';
import { draft } from './draft.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const OUT_DIR = join(__dirname, 'out');
export const M6A_CAP_USD = 1.00;
export const PER_DRAFT_BUDGET_USD = 0.10;
export const DRAFT_DEADLINE_MS = 600_000;
export const BAR = { n: 20, valid: 18 };
const DEFAULT_MODEL = 'deepseek-flash';
const PROSE_TEMPLATE = join(__dirname, 'job2.prose.txt');
const INPUTS = join(REPO_ROOT, 'poc', 'm0', 'out', 'job2-probe-1', 'inputs');

/** Literal (never RegExp) key scrub; a secret under 8 chars is skipped so a short value can't blank ordinary text. */
export function scrub(text, secrets) {
  let out = text;
  for (const s of secrets) if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('[redacted-key]');
  return out;
}

export function secretsFromEnv(value) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const t = value.trim();
  return t === value ? [t] : [t, value];
}

/**
 * One row's cost, never under-counted. A row with `spendComplete === false` (src/authoring.js: some call died
 * unmetered) counts its priced floor PLUS one round ceiling per unmetered call — `calls - rounds` when both are
 * numbers, at least 1. A null cost is an unpriced row at its ceiling, as in src/provider.js. Rows without the
 * field behave as before.
 */
export function rowCostUsd(r) {
  const ceiling = ceilingCostUsd(r.model ?? DEFAULT_MODEL);
  if (r.spendComplete === false) {
    const unmetered = Number.isInteger(r.calls) && Number.isInteger(r.rounds) ? Math.max(1, r.calls - r.rounds) : 1;
    return (r.costUsd ?? 0) + unmetered * ceiling;
  }
  return r.costUsd ?? ceiling;
}

/** Ledger total: unpriced rows at ceiling, incomplete rows at floor + unmetered ceilings (see rowCostUsd). */
export function ledgerTotalUsd(spendPath) {
  return readSpendRows(spendPath).reduce((sum, r) => sum + rowCostUsd(r), 0);
}

/** Refuse (throw) when the ledger plus this draft's hard budget could cross the cap. */
export function assertRoomForDraft(spendPath, capUsd, draftBudgetUsd) {
  const total = ledgerTotalUsd(spendPath);
  if (total + draftBudgetUsd > capUsd) {
    throw new Error(`cap: ledger $${total.toFixed(4)} + next draft budget $${draftBudgetUsd.toFixed(2)} could cross the $${capUsd.toFixed(2)} M6a cap (${spendPath})`);
  }
  return total;
}

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runBatch({
  n, tag, proseText, outDir = OUT_DIR, spendPath = join(outDir, 'spend.jsonl'), capUsd = M6A_CAP_USD,
  draftBudgetUsd = PER_DRAFT_BUDGET_USD, deadlineMs = DRAFT_DEADLINE_MS, env = process.env,
  injected, model = DEFAULT_MODEL, writeLine = (s) => process.stdout.write(`${s}\n`),
}) {
  // ---- $0 gates ---------------------------------------------------------------
  if (!Number.isInteger(n) || n < 1) throw new Error(`batch: --n must be a positive integer, got "${n}"`);
  if (!tag || /[^A-Za-z0-9._-]/.test(tag)) throw new Error('batch: --tag is required (letters, digits, . _ - only)');
  if (!injected) {
    const key = checkKeyPreflight('deepseek', env);
    if (!key.ok) throw new Error(key.message);
  }
  const jsonl = join(outDir, `${tag}.jsonl`);
  const draftsDir = join(outDir, `${tag}.drafts`);
  if (existsSync(jsonl) || existsSync(draftsDir)) {
    throw new Error(`batch: tag "${tag}" already has results — use a new --tag, never overwrite live evidence`);
  }
  assertRoomForDraft(spendPath, capUsd, draftBudgetUsd);
  mkdirSync(draftsDir, { recursive: true });
  const secrets = secretsFromEnv(env.DEEPSEEK_API_KEY);
  const write = (path, text, flag) => (flag === 'a' ? appendFileSync : writeFileSync)(path, scrub(text, secrets));
  write(join(draftsDir, 'prose.txt'), proseText);

  // ---- drafts -------------------------------------------------------------------
  const records = [];
  let stoppedBy = null;
  for (let i = 1; i <= n; i += 1) {
    try { assertRoomForDraft(spendPath, capUsd, draftBudgetUsd); } catch (err) { stoppedBy = err.message; break; }
    const started = Date.now();
    let r;
    try {
      // eslint-disable-next-line no-await-in-loop
      r = await withDeadline(draft({ proseText, model, budgetUsd: draftBudgetUsd, ...(injected ?? {}) }), deadlineMs);
    } catch (err) {
      r = { ok: false, declaration: null, reds: [`crash: ${err.message}`], rounds: null, costUsd: null, stop: 'crash', log: [] };
    }
    if (r.__timedOut) r = { ok: false, declaration: null, reds: ['wall-halt: draft deadline'], rounds: null, costUsd: null, stop: 'deadline', log: [] };
    const wallMs = Date.now() - started;
    // Booked even when red/crashed; an unknown cost is null (the ledger reprices it at the ceiling), never 0.
    appendSpendRow(spendPath, {
      runId: `m6a-${tag}-${i}`, step: 'draft-m6a', model, modelReturned: r.modelReturned ?? null,
      costUsd: r.costUsd, rounds: r.rounds, wallMs,
    });
    const rec = {
      i, ok: r.ok, stop: r.stop, rounds: r.rounds, structureRetries: r.structureRetries ?? null, revisions: r.revisions ?? null,
      costUsd: r.costUsd, modelReturned: r.modelReturned ?? null, wallMs, reds: r.reds,
    };
    write(jsonl, `${JSON.stringify(rec)}\n`, 'a');
    write(join(draftsDir, `draft-${i}.json`), JSON.stringify({ declaration: r.declaration, reds: r.reds, log: r.log }, null, 2));
    records.push(rec);
    writeLine(`draft ${i}/${n}: ${r.ok ? 'VALID' : `RED (${r.stop})`} rounds=${r.rounds} retries=${r.structureRetries ?? '-'}/${r.revisions ?? '-'} cost=${r.costUsd === null ? 'UNKNOWN' : `$${r.costUsd.toFixed(5)}`}`);
  }

  // ---- summary + key sweep -----------------------------------------------------------
  const valid = records.filter((x) => x.ok).length;
  const unknown = records.some((x) => x.costUsd === null);
  const cost = records.reduce((s, x) => s + (x.costUsd ?? ceilingCostUsd(model)), 0);
  const summary = {
    tag, n, ran: records.length, valid, bar: n === BAR.n ? `${BAR.valid}/${BAR.n}` : 'n/a (bar is defined for n=20)',
    barMet: n === BAR.n && records.length === n ? valid >= BAR.valid : null,
    costUsd: unknown ? `at least ${cost.toFixed(5)} (some draft unpriced)` : Number(cost.toFixed(5)),
    ledgerTotalUsd: Number(ledgerTotalUsd(spendPath).toFixed(5)), stoppedBy,
    keyLeaks: sweepForSecrets([draftsDir, jsonl, spendPath], secrets),
  };
  writeFileSync(join(outDir, `${tag}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  writeLine(`SUMMARY ${JSON.stringify(summary)}`);
  return { records, summary };
}

/** Count files (recursively) under the given paths that contain a secret literally. */
export function sweepForSecrets(paths, secrets) {
  const live = secrets.filter((s) => s.length >= 8);
  if (live.length === 0) return 0;
  let leaks = 0;
  const visit = (p) => {
    if (!existsSync(p)) return;
    let names = null;
    try { names = readdirSync(p); } catch { /* a file */ }
    if (names) { names.forEach((nm) => visit(join(p, nm))); return; }
    const text = readFileSync(p, 'utf8');
    if (live.some((s) => text.includes(s))) leaks += 1;
  };
  paths.forEach(visit);
  return leaks;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const get = (flag, dflt) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : dflt; };
  const n = Number(get('--n', '20'));
  const tag = get('--tag');
  const resume = get('--resume', join(INPUTS, 'resume.docx'));
  const jd = get('--jd', join(INPUTS, 'jd.md'));
  const proseText = readFileSync(PROSE_TEMPLATE, 'utf8').replace('@RESUME@', resume).replace('@JD@', jd);
  runBatch({ n, tag, proseText }).then(
    ({ summary }) => process.exit(summary.keyLeaks > 0 ? 2 : 0),
    (err) => { process.stderr.write(`REFUSED: ${scrub(err.message, secretsFromEnv(process.env.DEEPSEEK_API_KEY))}\n`); process.exit(1); },
  );
}
