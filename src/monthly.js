// borrowed-from: bareloop src/monthly.js@0e55685 (the claim protocol, the refusal text shape, the spend summary's honesty rules)
// M4d piece 3 (docs/wiki/the-module-ladder.md, "M4d", scope items 4-5): the monthly limit.
//
// ONE record: `<configHome>/runs.jsonl`, append-only, mode 0600, one row per hold and per terminal note.
//   hold:     { kind:'hold', holdId, what:'run'|'resume'|'draft', flow, runId, runDir, pid, procStart, holdUsd, spentAtHold, at }
//   terminal: { kind:'settled'|'released'|'refused', holdId, at, why [, alsoRunDirs] }
// Rows are only ever appended. Month spend is read from each named run/draft dir's OWN `spend.jsonl`
// (so the total is the same whichever `--root` a run used) — this file carries no money of its own.
//
// The claim (bareloop `claimRun`): the door APPENDS its hold FIRST, then reads the file; only live,
// unsettled holds that come BEFORE its own row count against it, so whoever is first holds. A hold whose
// process is gone (src/liveness.js `isFwdloopAlive`, M4c's one rule) is settled by the checker.
// No limit set = a hold row of $0 and no check (the row is what names the run dir, so its spend is counted
// once a limit is set). An unreadable/invalid config.json THROWS ConfigError: the gate refuses
// by name, it never reads as "no limit".
//
// Honesty: a row whose cost is unknown counts as `spendRowCost` says (floor + ceiling at its own price) and
// makes its figure "at least". A row with no `at` (written before M4d, reachable only when an old run is
// resumed) counts in "to date" only and is counted in `undatedRows`. Model time is the sum of rows' `wallMs`;
// a row without one (a draft row) adds nothing and marks that figure "at least"; none at all = null.
import {
  appendFileSync, mkdirSync, readFileSync, realpathSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { readConfig, configHome, ConfigError } from './config.js';
import { isFwdloopAlive, procStartOf } from './liveness.js';
import { spendRowCost } from './provider.js';
import { readDirSpendRows } from './draftspend.js';

export { ConfigError };

export const REFUSAL_SENTENCE = 'Nothing spent. Raise the monthly limit in Settings, or wait for next month.';
export const NOT_RECORDED = 'not recorded';

const runsPath = (home) => join(configHome(home), 'runs.jsonl');

/** realpath of the longest existing prefix of `p`, the rest appended (a run dir does not exist yet at claim time). @param {string} p */
export function realpathLoose(p) {
  const abs = resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    try { return join(realpathSync(cur), ...rest.reverse()); } catch { /* not there yet */ }
    const up = dirname(cur);
    if (up === cur) return abs;
    rest.push(basename(cur));
    cur = up;
  }
}

function appendRow(home, row) {
  mkdirSync(configHome(home), { recursive: true, mode: 0o700 });
  appendFileSync(runsPath(home), `${JSON.stringify(row)}\n`, { mode: 0o600 });
}

/** @param {string} [home] @returns {any[]} every well-formed row in file order (a torn line is skipped) */
export function readRuns(home) {
  let text;
  try { text = readFileSync(runsPath(home), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object') rows.push(r); } catch { /* skip */ }
  }
  return rows;
}

const tokensOf = (t) => (t && typeof t === 'object'
  ? ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'].reduce((n, k) => n + (Number.isFinite(t[k]) ? t[k] : 0), 0)
  : 0);
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** Every run/draft dir the record names (deduped by realpath), including dirs a settle note adds. */
function namedDirs(rows) {
  const dirs = new Set();
  for (const r of rows) {
    if (r.kind === 'hold' && typeof r.runDir === 'string') dirs.add(r.runDir);
    if (Array.isArray(r.alsoRunDirs)) for (const d of r.alsoRunDirs) if (typeof d === 'string') dirs.add(d);
  }
  return [...dirs];
}

/** One dir's total spend (every row, `spendRowCost`; a draft dir's live record until its final row exists — src/draftspend.js). */
function dirSpend(dir) {
  return readDirSpendRows(dir).reduce((n, r) => n + spendRowCost(r).usd, 0);
}

/**
 * The Money tab's figures (piece 4 reads this) and the check's month total.
 * @param {{ home?: string, now?: () => number }} [opts]
 */
export function spendSummary(opts = {}) {
  const nowDate = new Date((opts.now ?? Date.now)());
  const newBucket = () => ({
    usd: 0, atLeast: false, tokens: 0, modelMs: null, modelMsAtLeast: false, rows: 0,
  });
  const total = newBucket();
  const month = newBucket();
  /** @type {Record<string, {label: string, month: ReturnType<typeof newBucket>, total: ReturnType<typeof newBucket>}>} */
  const byProvider = {};
  let undatedRows = 0;
  const add = (b, usd, complete, tokens, wall) => {
    b.rows += 1; b.usd += usd; b.tokens += tokens;
    if (!complete) b.atLeast = true;
    if (wall === null) b.modelMsAtLeast = true;
    else b.modelMs = (b.modelMs ?? 0) + wall;
  };
  for (const dir of namedDirs(readRuns(opts.home))) {
    for (const row of readDirSpendRows(dir)) {
      const { usd, complete } = spendRowCost(row);
      const tokens = tokensOf(row.tokens);
      const wall = Number.isFinite(row.wallMs) && row.wallMs >= 0 ? row.wallMs : null;
      const key = typeof row.provider === 'string' && row.provider !== '' ? row.provider : NOT_RECORDED;
      const p = (byProvider[key] ??= { label: key, month: newBucket(), total: newBucket() });
      add(total, usd, complete, tokens, wall);
      add(p.total, usd, complete, tokens, wall);
      if (row.at === undefined || row.at === null) { undatedRows += 1; continue; }
      const at = new Date(row.at);
      if (Number.isNaN(at.getTime())) { month.atLeast = true; p.month.atLeast = true; continue; } // could be this month: unknown, never dropped
      if (sameMonth(at, nowDate)) {
        add(month, usd, complete, tokens, wall);
        add(p.month, usd, complete, tokens, wall);
      }
    }
  }
  const minutes = (b) => ({ modelMinutes: b.modelMs === null ? null : b.modelMs / 60000, modelMinutesAtLeast: b.modelMs === null || b.modelMsAtLeast });
  const fin = (b) => ({
    usd: b.usd, atLeast: b.atLeast, tokens: b.tokens, ...minutes(b),
  });
  return {
    month: fin(month),
    total: fin(total),
    byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, { label: v.label, month: fin(v.month), total: fin(v.total) }])),
    undatedRows,
    // Runs from before M4d were never written to runs.jsonl: their money is in no figure here.
    preM4dRunsNotCounted: true,
  };
}

/**
 * Settle every unsettled hold BEFORE `idx` whose process is gone; return what the live ones still hold.
 * `null` from the liveness check ("cannot tell") never settles: it holds. `settle: false` (the page's read-only note) counts the same
 * but writes nothing.
 */
function liveHeldBefore(rows, idx, home, nowIso, settle = true) {
  const ended = new Set(rows.filter((r) => r.kind === 'settled' || r.kind === 'released' || r.kind === 'refused').map((r) => r.holdId));
  let heldUsd = 0;
  let heldRuns = 0;
  for (const r of rows.slice(0, idx)) {
    if (r.kind !== 'hold' || ended.has(r.holdId) || !Number.isFinite(r.holdUsd)) continue;
    if (isFwdloopAlive(r.pid, typeof r.procStart === 'string' ? r.procStart : null) === false) {
      if (settle) appendRow(home, { kind: 'settled', holdId: r.holdId, at: nowIso, why: 'process gone' });
      continue;
    }
    const spentSince = Math.max(0, dirSpend(r.runDir) - (Number.isFinite(r.spentAtHold) ? r.spentAtHold : 0));
    const extra = Math.max(0, r.holdUsd - spentSince);
    if (extra > 0) { heldUsd += extra; heldRuns += 1; }
  }
  return { heldUsd, heldRuns };
}

/**
 * The ONE computation of "does a hold of `holdUsd` fit this month": the limit minus this month's counted spend minus what live
 * runs before `idx` still hold, in whole cents. `claimHold` (the door) and `checkMonthlyRoom` (the page's note) both call it, so the
 * note and the refusal are never two opinions.
 * @param {{ limit: number, holdUsd: number, rows: any[], idx: number, home?: string, now: () => number, nowIso: string, settle?: boolean }} a
 */
function roomFor({ limit, holdUsd, rows, idx, home, now, nowIso, settle = true }) {
  const { heldUsd, heldRuns } = liveHeldBefore(rows, idx, home, nowIso, settle);
  const month = spendSummary({ home, now }).month;
  const leftCents = Math.max(0, Math.floor((limit - month.usd - heldUsd) * 100 + 1e-6));
  const needCents = Math.ceil(holdUsd * 100 - 1e-6); // a non-finite hold never fits — never read as $0
  return {
    ok: needCents <= leftCents, leftUsd: leftCents / 100, heldUsd, heldRuns, atLeast: month.atLeast,
  };
}

// borrowed-from: bareloop src/monthly.js@c1d87ce (`checkMonthlyRoom`, shape only: fwdloop's holds and rows differ)
/**
 * Read-only: would a run holding `capUsd` fit this month? The same numbers `claimHold` decides on, but no hold row and no settle is
 * written — it is what the panel's note under Cap shows. Throws ConfigError when config.json is broken.
 * @param {{ capUsd: number, home?: string, now?: () => number }} a
 * @returns {Claim}
 */
export function checkMonthlyRoom({ capUsd, home, now = Date.now }) {
  const limit = readConfig({ home }).monthlyLimitUsd ?? null;
  const room = { limitUsd: limit, leftUsd: null, heldUsd: 0, heldRuns: 0, needUsd: capUsd, atLeast: false };
  if (limit === null) return { ok: true, holdId: '', room };
  const rows = readRuns(home);
  const { ok, ...found } = roomFor({ limit, holdUsd: capUsd, rows, idx: rows.length, home, now, nowIso: new Date(now()).toISOString(), settle: false });
  Object.assign(room, found);
  return { ok, holdId: '', room };
}

/**
 * The short line under the Cap box (M4e amendment 4 item 1), from the same room: `needs $0.50 ($0.10 left monthly)` (red) when the
 * cap does not fit, `$4.90 left monthly` when it does; '' when no limit is set. Money is never rounded down to look like it fits.
 * @param {Claim} claim
 * @returns {{ text: string, red: boolean }}
 */
export function monthlyNote(claim) {
  const { room } = claim;
  if (room.limitUsd === null || room.leftUsd === null) return { text: '', red: false };
  const left = `$${room.leftUsd.toFixed(2)}`;
  if (!claim.ok) return { text: `needs $${(Math.ceil(room.needUsd * 100 - 1e-6) / 100).toFixed(2)} (${left} left monthly)`, red: true };
  return { text: `${room.atLeast ? 'at most ' : ''}${left} left monthly`, red: false };
}

/**
 * @typedef {object} Claim
 * @property {boolean} ok the hold fits (or no limit is set)
 * @property {string} holdId the hold row's id (a $0 hold when no limit is set)
 * @property {{limitUsd:number|null, leftUsd:number|null, heldUsd:number, heldRuns:number, needUsd:number, atLeast:boolean}} room
 */

/**
 * The check at a door. Appends the hold row first (always, even with no limit), then decides. Throws ConfigError when config.json is
 * broken (nothing is appended) or the row cannot be written. A refusal appends a `refused` row.
 * @param {{ what: 'run'|'resume'|'draft', flow: string|null, runId: string|null, runDir: string, holdUsd: number, spentAtHold?: number, home?: string, now?: () => number }} a
 * @returns {Claim}
 */
export function claimHold({
  what, flow, runId, runDir, holdUsd, spentAtHold = 0, home, now = Date.now,
}) {
  const cfg = readConfig({ home });
  const limit = cfg.monthlyLimitUsd ?? null;
  const room = { limitUsd: limit, leftUsd: null, heldUsd: 0, heldRuns: 0, needUsd: holdUsd, atLeast: false };
  const nowIso = new Date(now()).toISOString();
  const holdId = randomUUID();
  try {
    appendRow(home, {
      kind: 'hold', holdId, what, flow, runId, runDir: realpathLoose(runDir), pid: process.pid, procStart: procStartOf('self'),
      // No limit set: $0 is held and no check runs, but the row still names the run dir so its spend is counted.
      holdUsd: limit === null ? 0 : holdUsd, spentAtHold, at: nowIso,
    });
  } catch (/** @type {any} */ e) {
    throw new ConfigError(`cannot write this hold to ${runsPath(home)} (${e?.code ?? 'error'}) — refusing rather than run with its spend unrecorded or past the monthly limit unchecked`);
  }
  if (limit === null) return { ok: true, holdId, room };
  const rows = readRuns(home);
  const idx = rows.findIndex((r) => r.kind === 'hold' && r.holdId === holdId);
  const { ok, ...found } = roomFor({ limit, holdUsd, rows, idx: idx < 0 ? rows.length : idx, home, now, nowIso });
  Object.assign(room, found);
  if (!ok) {
    try { appendRow(home, { kind: 'refused', holdId, at: nowIso, why: 'over the monthly limit' }); } catch { /* the refusal stands; a dead process's hold is settled by the next check */ }
    return { ok: false, holdId, room };
  }
  return { ok: true, holdId, room };
}

/**
 * The run's own process ends or parks: give the hold back. Never throws (a failed settle is closed by the
 * next check as "process gone"). `alsoRunDirs` names dirs this process also spent into (a rerun's new run).
 * @param {{ holdId: string|null, why: string, home?: string, now?: () => number, alsoRunDirs?: string[] }} a
 */
export function settleHold({
  holdId, why, home, now = Date.now, alsoRunDirs,
}) {
  if (!holdId) return;
  try {
    appendRow(home, {
      kind: 'settled', holdId, at: new Date(now()).toISOString(), why, ...(alsoRunDirs?.length ? { alsoRunDirs: alsoRunDirs.map(realpathLoose) } : {}),
    });
  } catch { /* see above */ }
}

/**
 * The ONE refusal text (CLI and page): the amount line, then the signed sentence.
 * @param {Claim['room']} room
 */
export function monthlyRefusalText(room) {
  const held = room.heldUsd > 0 ? `, $${room.heldUsd.toFixed(2)} held by ${room.heldRuns > 1 ? 'runs' : 'a run'} in progress` : '';
  return `Max $${(room.leftUsd ?? 0).toFixed(2)} left this month (monthly limit $${(room.limitUsd ?? 0).toFixed(2)}${held}); this needs $${room.needUsd.toFixed(2)}.\n${REFUSAL_SENTENCE}`;
}
