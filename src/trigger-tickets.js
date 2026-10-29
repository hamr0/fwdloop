// M12 piece 2 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 5-7, 12; PRD "Update 2026-10-29 (M12 design ...)"): the ticket trigger.
// Proven first in poc/mcp/f103/look.mjs (newest-first cursor walk, F103) and poc/mcp/f104/watch.mjs (watched fields, F104/F104b), borrowed here.
//
// This file only says WHAT is new on a ticket list: `lookTickets` is ONE $0 look through the user's own MCP server, started with `allow` = only the
// schedule's signed tool, and it writes nothing. The ledger rows (arrived / ran / baseline / unreadable) are the scheduler's, written by the functions
// below, the same rows as the file trigger's (src/trigger-files.js): a ticket is `sha: ticket:<number>` (a re-arrival by a watched change: `ticket:<number>:<n>`)
// and `name: #<number>`, so `queueOf`, `recordRan` and `recordDropped` work on it unchanged.
import { createMCPBridge, discoverServers } from 'bare-agent/mcp';

import {
  LIST_URL, USER_MCP_CONFIG, firstLine, isDeviceLogin,
} from './ticket-mcp.js';
import { appendSeen, readSeen } from './trigger-files.js';

/** A look every 15 minutes, fixed (item 8). */
export const TICKET_LOOK_MS = 15 * 60_000;
/** The fields a signed schedule may watch (item 7): typed values the list already carries. */
export const WATCHABLE = Object.freeze(['state', 'labels']);
/** The most pages one look follows (a flood bigger than this is `unreadable`, never silently cut). */
const MAX_PAGES = 20;

/** The ticket lists a signed job names: role -> address, for every page input whose address is `https://github.com/<owner>/<repo>/issues`. @param {{sources?: Array<{role: string, kind?: string, path: string}>}} arbiter @returns {Record<string, string>} */
export function ticketListsOf(arbiter) {
  return Object.fromEntries((arbiter?.sources ?? []).filter((s) => s.kind === 'page' && LIST_URL.test(String(s.path).trim())).map((s) => [s.role, String(s.path).trim()]));
}

/** @param {unknown} reply */
const textOf = (reply) => (typeof reply === 'string' ? reply : (Array.isArray(reply) ? reply : /** @type {any} */ (reply)?.content ?? []).map((/** @type {any} */ c) => c?.text ?? '').join(''));
/** @param {any} i */
const labelsOf = (i) => (Array.isArray(i?.labels) ? i.labels : []).map((/** @type {any} */ l) => (typeof l === 'string' ? l : l?.name)).filter((/** @type {unknown} */ n) => typeof n === 'string').sort();
/** @param {any} i the typed values of the watched fields */
export const watchedOf = (i) => ({ state: String(i?.state ?? '').toLowerCase(), labels: labelsOf(i) });

/**
 * Why a ticket changed, in words, only for the watched fields; '' = nothing changed. @param {{state: string, labels: string[]}} prev @param {{state: string, labels: string[]}} cur @param {string[]} watch
 */
export function reasonFor(prev, cur, watch) {
  const r = [];
  if (watch.includes('state') && prev.state !== cur.state) r.push(`state ${prev.state}→${cur.state}`);
  if (watch.includes('labels')) {
    for (const l of cur.labels) if (!prev.labels.includes(l)) r.push(`label added: ${l}`);
    for (const l of prev.labels) if (!cur.labels.includes(l)) r.push(`label removed: ${l}`);
  }
  return r.join('; ');
}

/**
 * One look. `seen` null = the first look after signing (the first page is the starting point, nothing runs). Otherwise newest first with the cursor, stopping at a seen
 * number; with watched fields the walk goes on past it only as far as the oldest tracked ticket, comparing each tracked ticket's watched values with `last`.
 * Every failure is `{ok:false, error}` naming its cause, at $0; none reads as "0 new".
 * @param {{listUrl: string, mcp: {server: string, tool: string}, configPath?: string, seen: Set<number>|null, last: Map<number, {state: string, labels: string[]}>, watch: string[], perPage?: number, timeoutMs?: number}} o
 * @returns {Promise<{ok: true, first: boolean, found: Array<{number: number, state: string, labels: string[], createdAt: string|null}>, changed: Array<{number: number, reason: string, state: string, labels: string[]}>, pages: number} | {ok: false, error: string}>}
 */
export async function lookTickets({
  listUrl, mcp, configPath = USER_MCP_CONFIG(), seen, last, watch, perPage = 10, timeoutMs = 90000,
}) {
  const m = LIST_URL.exec(String(listUrl).trim());
  if (!m) return { ok: false, error: `${listUrl} is not a GitHub issues address (https://github.com/<owner>/<repo>/issues)` };
  const [, owner, repo] = m;
  const { server, tool } = mcp;
  if (!discoverServers([configPath]).has(server)) return { ok: false, error: `${server} is not in ~/.mcp.json` };
  const first = seen === null;
  let bridge;
  try {
    bridge = await createMCPBridge({ configPaths: [configPath], timeout: timeoutMs, callTimeout: timeoutMs, confirmServer: () => true, allow: { [server]: [tool] } });
    const failed = bridge.errors.find((/** @type {any} */ e) => e.server === server);
    if (failed) return { ok: false, error: `${server} did not start: ${firstLine(failed.error)}` };
    if (bridge.missing?.[0]) return { ok: false, error: `${server} does not offer ${bridge.missing[0].tool}` };
    for (const t of bridge.tools) if (t.annotations?.readOnlyHint !== true) return { ok: false, error: `${server} does not mark ${t.name.slice(`${server}_`.length)} read-only (readOnlyHint is not true)` };
    const list = bridge.tools.find((/** @type {any} */ t) => t.name === `${server}_${tool}`);
    if (!list) return { ok: false, error: `${server} does not offer ${tool}` };

    /** @param {Record<string, unknown>} args @returns {Promise<{issues: any[], pageInfo?: any}|{error: string}>} one page; a page with no list is asked for once more (F103) */
    const page = async (args) => {
      let cause = 'no ticket list in the answer';
      for (let n = 0; n < 2; n++) {
        let text;
        try { text = textOf(await list.execute(args)); } catch (e) { cause = `${server}: ${tool} failed: ${firstLine(e)}`; continue; }
        if (isDeviceLogin(text)) return { error: 'GitHub token unavailable — is pass locked?' };
        let o;
        try { o = JSON.parse(text); } catch { o = null; }
        if (o && Array.isArray(o.issues)) return o;
        cause = text.trim() === '' ? 'no ticket list in the answer (it was empty)' : `no ticket list in the answer: ${firstLine(text)}`;
        if (/^\S*Could not|error/i.test(text)) break;   // an error text will not change by asking again
      }
      return { error: cause };
    };

    const found = [];
    /** @type {Array<{number: number, reason: string, state: string, labels: string[]}>} */
    const changed = [];
    const tracked = new Set(first ? [] : last.keys());
    const oldestTracked = tracked.size > 0 ? Math.min(...tracked) : Infinity;
    const stillNeeded = new Set(tracked);
    let after;
    let pages = 0;
    let hitSeen = false;
    for (;;) {
      const args = {
        owner, repo, orderBy: 'CREATED_AT', direction: 'DESC', perPage, ...(watch.length === 0 ? { state: 'OPEN' } : {}), fields: ['number', 'created_at', 'state', 'labels'], ...(after ? { after } : {}),
      };
      // eslint-disable-next-line no-await-in-loop
      const r = await page(args);
      if ('error' in r) return { ok: false, error: r.error };
      pages++;
      if (pages === 1 && r.issues.length === 0) return { ok: false, error: `the list at ${listUrl} came back empty; an empty list is unreadable, not "no new tickets"` };
      let lowest = Infinity;
      for (const i of r.issues) {
        const n = i.number;
        if (!Number.isInteger(n)) continue;
        lowest = Math.min(lowest, n);
        const rec = { number: n, ...watchedOf(i), createdAt: typeof i.created_at === 'string' ? i.created_at : null };
        if (first) { found.push(rec); continue; }
        if (seen.has(n)) {
          hitSeen = true;
          const prev = last.get(n);
          stillNeeded.delete(n);
          if (prev && watch.length > 0) {
            const reason = reasonFor(prev, rec, watch);
            if (reason) changed.push({ number: n, reason, state: rec.state, labels: rec.labels });
          }
        } else if (!hitSeen) found.push(rec);
      }
      if (first) break;
      const done = hitSeen && (watch.length === 0 || stillNeeded.size === 0 || lowest < oldestTracked);
      if (done || !r.pageInfo?.hasNextPage || !r.pageInfo?.endCursor) break;
      if (pages >= MAX_PAGES) return { ok: false, error: `more than ${MAX_PAGES} pages of new tickets in one look` };
      after = r.pageInfo.endCursor;
    }
    return {
      ok: true, first, found, changed: changed.sort((a, b) => a.number - b.number), pages,
    };
  } catch (e) {
    return { ok: false, error: `${server} did not start: ${firstLine(e)}` };
  } finally {
    try { await bridge?.close(); } catch { /* already closed */ }
  }
}

// ---- the ledger rows (THE writers; only the scheduler calls them) ----------------------------------------------------------------------------------------------

/** The numbers a signing has a baseline or an arrived row for. @param {string} ledger @param {string} sig */
export function seenNumbers(ledger, sig) {
  return new Set(readSeen(ledger, sig).filter((r) => (r.kind === 'baseline' || r.kind === 'arrived') && Number.isInteger(/** @type {any} */ (r).number)).map((r) => /** @type {any} */ (r).number));
}
/** Last-seen watched values per number: the newest baseline/arrived row's. @param {string} ledger @param {string} sig @returns {Map<number, {state: string, labels: string[]}>} */
export function lastSeen(ledger, sig) {
  const m = new Map();
  for (const r of /** @type {any[]} */ (readSeen(ledger, sig))) if ((r.kind === 'baseline' || r.kind === 'arrived') && r.watch) m.set(r.number, r.watch);
  return m;
}
/** Has this signing had its first look (its baseline written)? @param {string} ledger @param {string} sig */
export const hasBaseline = (ledger, sig) => readSeen(ledger, sig).some((r) => r.kind === 'baseline');

/**
 * Write what a look found, once. First look: a `baseline` row per ticket on the page (never runs). Later: an `arrived` row per new ticket, oldest first (its arrival
 * time is this clock), and one `arrived` row per watched change with its `reason`. A look that could not read writes one `unreadable` row with its cause.
 * @param {string} ledger @param {string} sig @param {Awaited<ReturnType<typeof lookTickets>>} look @param {number} at
 * @returns {{arrived: number[], unreadable: string|null}}
 */
export function recordLook(ledger, sig, look, at) {
  if (!look.ok) {
    appendSeen(ledger, /** @type {any} */ ({ id: `unreadable:${at}`, kind: 'unreadable', sha: `unreadable:${at}`, name: '', size: 0, at, why: look.error }), sig);
    return { arrived: [], unreadable: look.error };
  }
  const arrived = [];
  const watch = (/** @type {{state: string, labels: string[]}} */ w) => ({ state: w.state, labels: w.labels });
  if (look.first) {
    for (const i of [...look.found].reverse()) {
      appendSeen(ledger, /** @type {any} */ ({
        id: `baseline:ticket:${i.number}`, kind: 'baseline', sha: `ticket:${i.number}`, name: `#${i.number}`, size: 0, at, number: i.number, watch: watch(i),
      }), sig);
    }
    return { arrived, unreadable: null };
  }
  for (const i of [...look.found].reverse()) {
    appendSeen(ledger, /** @type {any} */ ({
      id: `arrived:ticket:${i.number}`, kind: 'arrived', sha: `ticket:${i.number}`, name: `#${i.number}`, size: 0, at, number: i.number, watch: watch(i),
    }), sig);
    arrived.push(i.number);
  }
  for (const c of look.changed) {
    const n = readSeen(ledger, sig).filter((r) => r.kind === 'arrived' && /** @type {any} */ (r).number === c.number).length;
    appendSeen(ledger, /** @type {any} */ ({
      id: `arrived:ticket:${c.number}:${n}`, kind: 'arrived', sha: `ticket:${c.number}:${n}`, name: `#${c.number}`, size: 0, at, number: c.number, watch: watch(c), reason: c.reason,
    }), sig);
    arrived.push(c.number);
  }
  return { arrived, unreadable: null };
}
