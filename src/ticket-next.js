// M13 piece 4 (hamr ruling R2, 2026-10-31): a by-hand Run on a Tickets job has no ticket # box. It reads the NEWEST ticket that has not run yet; the run then reads it through the
// job's filter as always (a non-match ends skipped, grey, $0). Nothing new = one plain line at $0 and no run. "Has run" = this job's own runs hold the number (`run.json`
// `inputs[].ticket.number`, a skipped run included); "newest" is the schedule's own look (`lookTickets`, the job's signed `list_issues`, newest first, open tickets).
// A job with no ticket run yet takes the newest open ticket of the first page (item 6: the first run reads the newest ticket at the time it starts; older ones never run).
import { join } from 'node:path';

import { listRunIds } from './flow.js';
import { readRunInputs } from './runfile.js';
import { lookTickets } from './trigger-tickets.js';

/** the ticket numbers this job's runs have read @param {string} flowDir @returns {Set<number>} */
export function ranTicketNumbers(flowDir) {
  const out = new Set();
  for (const id of listRunIds(flowDir)) {
    const got = readRunInputs(join(flowDir, 'runs', id));
    if (!got.ok) continue;
    for (const e of got.entries) if (Number.isInteger(e?.ticket?.number)) out.add(e.ticket.number);
  }
  return out;
}

/**
 * @param {{flowDir: string, listUrl: string, mcp: {server: string, tool: string}, configPath?: string, look?: typeof lookTickets}} o `look` is a test seam
 * @returns {Promise<{ok: true, number: number} | {ok: false, say: string}>}
 */
export async function newestUnrunTicket({ flowDir, listUrl, mcp, configPath, look = lookTickets }) {
  const ran = ranTicketNumbers(flowDir);
  const r = await look({ listUrl, mcp, ...(configPath ? { configPath } : {}), seen: ran.size === 0 ? null : ran, last: new Map(), watch: [] });
  if (!r.ok) return { ok: false, say: String(r.error) };
  const numbers = r.found.map((f) => f.number);
  if (numbers.length === 0) return { ok: false, say: ran.size === 0 ? `No open ticket at ${listUrl}.` : `Nothing new: no ticket newer than #${Math.max(...ran)} has come in.` };
  return { ok: true, number: Math.max(...numbers) };
}
