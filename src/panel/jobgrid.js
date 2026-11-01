// M13 piece 6 (docs/wiki/the-module-ladder.md, M13 item 8; mock docs/product/m13-setup-mock.html Part 3, variant B): the Result tab's ONE grid for a job.
// Rows are the job's runs; the four buckets (Needs you / Stopped / Passed / Skipped) are fold rows; columns are `every step: exists, done`, `output judged`,
// cost and time. Pure of the panel: the run lookups are injected (data.js `getJobGrid`). Nothing is written.
//
// ONE decider of a run's bucket: `bucketOf` below reads the run's glyph (`computeGlyph`) through the M12 map in tickets.js (`GROUP_OF`); this module has no second
// outcome reader. What it throws away: any diary field but a check's `n`, `text`, `ok`, `result` and `source`; a run's money is only the history row's total, or the
// priced spend rows when the run has no history row yet.
import { GROUP_OF, TICKET_GROUPS } from './tickets.js';
import { EVERY_STEP } from '../try-checks.js';

/** the buckets, in the mock's order (the same four as the M12 ticket list: one list of words) */
export const GRID_BUCKETS = TICKET_GROUPS;

/** @param {string} glyph @returns {'wait'|'stop'|'done'|'skip'} */
export const bucketOf = (glyph) => /** @type {any} */ (GROUP_OF[glyph] ?? 'stop');

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
/** a run id's number, compared as a number (`run-10` is after `run-9`) @param {string} id */
const runNumber = (id) => Number(String(id).replace(/\D/g, '')) || 0;

/** a figure in dollars: `$0` for an exact zero, `$0.0412`, or `at least $0.0412` when the figure is only a floor (never `$0` for unknown) @param {number} usd @param {boolean} complete */
export function moneyWords(usd, complete) {
  const body = complete && usd === 0 ? '$0' : `$${usd.toFixed(4)}`;
  return complete ? body : `at least ${body}`;
}

/**
 * One run's money: its history row's total when it has one (complete unless the row says the figure is a floor), else the priced spend rows (always a floor), else unknown.
 * @param {{spentUsd?: unknown, spendComplete?: unknown}|null} history @param {any[]} spendRows
 * @returns {{usd: number|null, complete: boolean}}
 */
export function runMoney(history, spendRows) {
  if (history && isNum(history.spentUsd)) return { usd: /** @type {number} */ (history.spentUsd), complete: history.spendComplete !== false };
  const priced = (spendRows ?? []).filter((r) => isNum(r?.costUsd));
  return priced.length === 0 ? { usd: null, complete: false } : { usd: priced.reduce((a, r) => a + r.costUsd, 0), complete: false };
}

/** the stats line's money: the sum of the runs' money, a floor when any run's is a floor or unknown; `null` usd = nothing is known @param {Array<{usd: number|null, complete: boolean}>} moneys */
export function sumMoney(moneys) {
  const known = moneys.filter((m) => m.usd !== null);
  return { usd: known.length === 0 ? null : known.reduce((a, m) => a + (m.usd ?? 0), 0), complete: moneys.every((m) => m.usd !== null && m.complete) };
}

/**
 * The newest try of each step in the run's check record (`diary.jsonl` kind checks), in step order.
 * @param {any[]} diary @returns {Array<{step: string, checks: Array<{n: number, text: string, ok: boolean, result: string|null, source: string|null}>}>}
 */
function newestTries(diary) {
  const by = new Map();
  for (const r of diary ?? []) {
    if (!r || typeof r.step !== 'string' || !Number.isInteger(r.try) || !Array.isArray(r.checks)) continue;
    const prev = by.get(r.step);
    if (!prev || r.try >= prev.try) by.set(r.step, r);
  }
  return [...by.values()].map((r) => ({
    step: r.step,
    checks: r.checks.filter((c) => c && typeof c.text === 'string' && typeof c.ok === 'boolean')
      .map((c) => ({ n: c.n, text: c.text, ok: c.ok, result: typeof c.result === 'string' ? c.result : null, source: typeof c.source === 'string' ? c.source : null })),
  }));
}

/**
 * The two check columns of one run, from the run's own check record (the Audit grid's rows, by the same identities: #1 and #2 are `every step`, #3 and up are the
 * close's checks, `try-checks.js`). `g` passed, `r` failed, `n` nothing ran or nothing was judged (a human's yes is not a check), `q` no verdict (the run ended
 * red and its record holds no check at all). Also the detail lines the row opens to.
 * @param {{diary: any[], steps: any[], ended: boolean, red: boolean, skipped: boolean}} a
 * @returns {{ex: 'g'|'r'|'n'|'q', oj: 'g'|'r'|'n'|'q', lines: string[]}}
 */
export function checkCells({ diary, steps, ended, red, skipped }) {
  if (skipped) return { ex: 'n', oj: 'n', lines: [] };
  const tries = newestTries(diary);
  if (tries.length === 0) { const v = ended && red ? 'q' : 'n'; return { ex: v, oj: v, lines: [] }; }
  const lines = [];
  let exBad = false;
  let ojBad = false;
  let ojAny = false;
  for (const t of tries) {
    const at = (steps ?? []).findIndex((s) => s?.emits === t.step);
    const goal = at >= 0 && typeof steps[at].goal === 'string' ? steps[at].goal.replace(/[\s,.;:]+$/, '') : t.step;
    const name = `step ${at >= 0 ? at + 1 : '?'} ${goal}`;
    const every = t.checks.filter((c) => c.source === EVERY_STEP || c.n === 1 || c.n === 2);
    const closes = t.checks.filter((c) => !every.includes(c));
    const badEvery = every.find((c) => !c.ok);
    if (badEvery) { exBad = true; lines.push(`${name}: ${badEvery.text}${badEvery.result ? ` (${badEvery.result})` : ''}`); } else lines.push(`${name}: exists, done`);
    for (const c of closes) {
      ojAny = true;
      if (!c.ok) ojBad = true;
      lines.push(`output judged: ${c.text}${c.result ? ` (${c.result})` : ''}${c.ok ? '' : ' - failed'}`);
    }
  }
  return { ex: exBad ? 'r' : 'g', oj: ojBad ? 'r' : (ojAny ? 'g' : 'n'), lines };
}

/**
 * The grid of one job: every run a row in its bucket, newest first inside each bucket, and the stats line's numbers.
 * @param {{runs: Array<{runId: string, glyph: string, ticket: number|null, at: number|null, history: any, spendRows: any[], diary: any[], steps: any[], reason: string|null}>, anyway?: {runId: string, numbers: Set<number>}|null, now?: number}} a
 */
export function buildJobGrid({ runs, anyway = null, now = Date.now() }) {
  const rows = runs.map((r) => {
    const bucket = bucketOf(r.glyph);
    const money = runMoney(r.history, r.spendRows);
    const cells = checkCells({ diary: r.diary, steps: r.steps, ended: r.history !== null, red: bucket === 'stop', skipped: bucket === 'skip' });
    const wall = r.history && isNum(r.history.wallMs) ? r.history.wallMs : null;
    const lines = [...cells.lines];
    if (money.usd === null) lines.push('cost unknown, not shown as $0');
    return {
      runId: r.runId, name: r.ticket !== null ? `#${r.ticket}` : r.runId, number: r.ticket, bucket, glyph: r.glyph, at: r.at ?? now,
      ex: cells.ex, oj: cells.oj,
      cost: { mark: money.usd !== null && money.complete ? 'g' : 'q', value: money.usd === null ? '—' : moneyWords(money.usd, money.complete) },
      time: { mark: bucket === 'skip' ? 'n' : (wall !== null ? 'g' : 'q'), value: wall }, // value: ms, or null = unknown
      reason: bucket === 'skip' ? r.reason : null,
      anyway: bucket === 'skip' && r.ticket !== null && anyway !== null && anyway.numbers.has(r.ticket),
      lines, money,
    };
  });
  const order = (a, b) => b.at - a.at || runNumber(b.runId) - runNumber(a.runId);
  const groups = GRID_BUCKETS.map((g) => ({ ...g, rows: rows.filter((r) => r.bucket === g.key).sort(order).map(({ money, ...row }) => row) }));
  const total = sumMoney(rows.map((r) => r.money));
  return {
    groups,
    anywayRunId: anyway ? anyway.runId : null,
    stats: {
      counts: Object.fromEntries(groups.map((g) => [g.key, g.rows.length])),
      spent: total.usd === null ? null : moneyWords(total.usd, total.complete),
      spentUsd: total.usd, spentComplete: total.complete,
    },
  };
}
