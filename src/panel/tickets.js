// M12 piece 3 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" item 9; mockup docs/product/m12-ticket-results-mock.html, variant E): the ticket list in the
// Result tab of the run the ticket schedule was set from. One row per ticket NUMBER, for all time: the ticket's newest run decides its group. The rows are read
// from the runs themselves (`run.json` keeps `ticket: {number, title}` for every ticket run, M12 p3) and the schedule ledger's `arrived` rows (arrival time, and
// the reason a watched change made a ticket arrive again). No file of its own; nothing written. Pure of the panel: the run lookups are injected.
import { join } from 'node:path';

import { readSchedule, ledgerOf } from '../schedule.js';
import { readSeen } from '../trigger-files.js';
import { readRunInputs } from '../runfile.js';
import { recordAnyway } from '../trigger-tickets.js';

/** the four groups, in the mockup's order: key, label, open at first. The page draws them; it types none of these words. */
export const TICKET_GROUPS = Object.freeze([
  { key: 'wait', label: 'Needs you', open: true },
  { key: 'stop', label: 'Stopped', open: true },
  { key: 'done', label: 'Passed', open: false },
  { key: 'skip', label: 'Skipped', open: false },
]);

/** a run's sign -> its group. Running / stuck / expired / waiting all need a person or are still going: Needs you. */
const GROUP_OF = Object.freeze({
  '[·]': 'wait', '[▶]': 'wait', '[II]': 'wait', '[!]': 'wait', '[✓]': 'done', '[–]': 'skip', '[✗]': 'stop', '[■]': 'stop', '[?]': 'stop',
});

/**
 * The ticket schedule this run was set from, or null (no schedule, not a ticket schedule, or set from another run).
 * @param {string} flowDir @param {string} runId @param {(dir: string) => any} [readSched]
 */
export function ticketScheduleOf(flowDir, runId, readSched = readSchedule) {
  const s = readSched(flowDir);
  return s && s.trigger?.kind === 'new-ticket' && s.from === runId ? s : null;
}

/**
 * @param {{flowDir: string, runId: string, runIdsOf: (flowDir: string) => string[], glyphOf: (runId: string) => {glyph: string, label: string}|null, atOf?: (runId: string) => number|null, readSched?: (dir: string) => any}} a
 * @returns {null | {line: string, list: string, groups: Array<{key: string, label: string, open: boolean, rows: any[]}>}}
 */
export function ticketListOf({ flowDir, runId, runIdsOf, glyphOf, atOf = () => null, readSched }) {
  const sched = ticketScheduleOf(flowDir, runId, readSched);
  if (!sched) return null;
  const arrivals = new Map();
  for (const r of /** @type {any[]} */ (readSeen(ledgerOf(flowDir), sched.sig))) {
    if (r.kind !== 'arrived' || !Number.isInteger(r.number)) continue;
    const a = arrivals.get(r.number) ?? { first: r.at, last: r.at, count: 0, reason: null };
    arrivals.set(r.number, { first: Math.min(a.first, r.at), last: Math.max(a.last, r.at), count: a.count + 1, reason: typeof r.reason === 'string' ? r.reason : a.reason });
  }
  /** @type {Map<number, any>} */
  const byNumber = new Map();
  for (const id of runIdsOf(flowDir)) {
    const runDir = join(flowDir, 'runs', id);
    const inputs = readRunInputs(runDir);
    const entry = inputs.ok ? inputs.entries.find((e) => e && e.ticket && Number.isInteger(e.ticket.number)) : null;
    if (!entry) continue;
    const g = glyphOf(id);
    if (!g) continue;
    const at = atOf(id) ?? Date.now();
    const n = entry.ticket.number;
    const arr = arrivals.get(n);
    const row = {
      number: n, title: typeof entry.ticket.title === 'string' ? entry.ticket.title : null, group: GROUP_OF[g.glyph] ?? 'stop', glyph: g.glyph,
      runId: id, at: arr ? arr.last : at,
      reason: g.glyph === '[–]' ? g.label.replace(/^skipped — ?/, '') || null : null,
      changed: arr && arr.count > 1 ? arr.reason : null,
    };
    const prior = byNumber.get(n);
    if (!prior || Number(id.replace(/\D/g, '')) > Number(prior.runId.replace(/\D/g, ''))) byNumber.set(n, row);
  }
  const rows = [...byNumber.values()].sort((a, b) => b.at - a.at || b.number - a.number);
  return {
    line: `When a new ticket arrives in ${sched.trigger.role} · looks every 15 min`,
    list: sched.trigger.list,
    groups: TICKET_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.key) })),
  };
}

/** a "Run it anyway" reason: short, never blank. The same bar as a rerun's. */
export const ANYWAY_REASON_MAX = 500;

/**
 * `POST /api/author/ticket-anyway`: queue a SKIPPED ticket as a new arrival, after a short reason. Without a reason nothing starts. The queue is the schedule builder's:
 * `queue.arriveAnyway({flow, number, reason})` is the ONE seam (production: `arriveAnywayOf`).
 * @param {{body: any, listOf: (flow: string, runId: string) => ReturnType<typeof ticketListOf>, queue: {arriveAnyway: (a: {flow: string, runId: string, number: number, reason: string}) => {ok: boolean, say?: string}}}} a
 * @returns {{status: number, body: Record<string, any>}}
 */
export function ticketAnyway({ body, listOf, queue }) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason === '') return { status: 400, body: { ok: false, refused: 'reason-required', say: 'Write why you want it to run, then press Run it anyway. Nothing started.' } };
  if (reason.length > ANYWAY_REASON_MAX) return { status: 400, body: { ok: false, refused: 'reason-too-long', say: `Keep the reason under ${ANYWAY_REASON_MAX} characters. Nothing started.` } };
  if (typeof b.flow !== 'string' || typeof b.runId !== 'string' || !Number.isInteger(b.number)) return { status: 400, body: { ok: false, refused: 'bad-request', say: 'Name the job, the run and the ticket number. Nothing started.' } };
  const list = listOf(b.flow, b.runId);
  const row = list?.groups.find((g) => g.key === 'skip')?.rows.find((r) => r.number === b.number);
  if (!row) return { status: 409, body: { ok: false, refused: 'not-skipped', say: `Ticket #${b.number} is not a skipped ticket of this list. Nothing started.` } };
  const r = queue.arriveAnyway({ flow: b.flow, runId: b.runId, number: b.number, reason });
  if (!r.ok) return { status: 409, body: { ok: false, refused: 'queue', say: r.say ?? 'The ticket was not queued. Nothing started.' } };
  return { status: 202, body: { ok: true, queued: true, number: b.number, say: `Ticket #${b.number} is queued; it runs when its turn comes.` } };
}

/**
 * The production queue seam: ONE `arrived` row (`recordAnyway`, the ledger's writer) in the job's schedule ledger, so the scheduler's queue starts the ticket as a new
 * arrival under the job's normal cap. A job with no live ticket schedule is refused by name, at $0, with nothing written.
 * @param {{scan: () => any[], now: () => number}} a
 * @returns {{arriveAnyway: (a: {flow: string, runId: string, number: number, reason: string}) => {ok: boolean, say?: string}}}
 */
export function arriveAnywayOf({ scan, now }) {
  return {
    arriveAnyway({ flow, number, reason }) {
      const job = scan().find((j) => j.flow === flow && j.trigger?.kind === 'new-ticket');
      if (!job) return { ok: false, say: `Job "${flow}" has no live ticket schedule, so Run it anyway has no queue to join. Nothing started.` };
      return recordAnyway(ledgerOf(job.flowDir), job.sig, { number, reason }, now());
    },
  };
}
