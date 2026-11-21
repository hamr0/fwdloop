// borrowed-from: bareloop src/ticket.js@v0.61.0 (fc56e1f3)
// MCP + tickets piece 1b (ITEM33-BUILD addendum 2026-11-02): the ONE source-neutral ticket shape, whether a ticket came from an MCP server or from a page
// read with barebrowse. The filter, the ledger rows, the run's record and the grid read only this shape; none of them knows the source.
// Every ticket text is MASKED with the one secret inventory (`redactSecrets`, src/validate.js) BEFORE the sha is taken, so the sha, the frozen bytes and every
// record carry the masked text (a secret in a ticket is masked, never refused). The honest ceiling: `SECRET_PATTERNS` are token shapes only.
import { createHash } from 'node:crypto';
import { readTicketMcp } from './ticketmcp.js';
import { fetchPageText } from './pagefetch.js';
import { isTicketNumber } from './ticketshape.js';
import { redactSecrets, scanSecrets } from './validate.js';

/**
 * @typedef {object} Ticket
 * @property {'mcp'|'page'} source
 * @property {string} url the address of this ticket
 * @property {number|null} number null = a page address that carries no ticket number (the grid row reads `#?`)
 * @property {string} title
 * @property {'open'|'closed'|'unknown'} state
 * @property {string[]|null} labels null = not readable (a page); a priority filter finds none, and `unsure` never skips
 * @property {string} text the MASKED text, as frozen
 * @property {string} sha256 of the masked text's UTF-8 bytes
 * @property {number} bytes
 * @property {number} masked how many secret-shaped strings were masked (a count; never the values)
 * @property {{server: string, exposed: string[], missing: Array<{server: string, tool: string}>, calls: Array<Record<string, any>>}|null} record the MCP read's own record (null for a page)
 */

/** said on the plan card, in code-owned words, when a ticket comes from a page */
export const PAGE_TICKET_LIMIT_WORDS = 'A ticket read from a page may lack its body, and its labels and state may be missing.';

const TITLE_MAX = 200;
const clip = (/** @type {string} */ s) => s.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX);

/**
 * Mask a text and measure it: the masked text, its sha256 and byte length, and how many secret shapes it carried.
 * @param {string} raw @returns {{text: string, sha256: string, bytes: number, masked: number}}
 */
export function maskTicketText(raw) {
  const masked = scanSecrets(raw).length;
  const text = redactSecrets(raw);
  const buf = Buffer.from(text, 'utf8');
  return { text, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, masked };
}

/** the number a GitHub ticket or pull address carries, or null @param {string} url @returns {number|null} */
function numberOfUrl(url) {
  const m = /\/(?:issues|pull)\/(\d+)(?:[/?#]|$)/.exec(url);
  const n = m ? Number(m[1]) : NaN;
  return isTicketNumber(n) ? n : null;
}

/**
 * A ticket from the text of a PAGE (barebrowse act mode). Weaker than an MCP read, said plainly: the body may be missing (fwd F89: a page reader drops it),
 * labels are null (not read from a page), and state is `closed` only when the text says `Closed`, else `unknown`.
 * @param {string} rawText @param {string} url @returns {Ticket}
 */
export function ticketFromPage(rawText, url) {
  const m = maskTicketText(rawText);
  const firstLine = m.text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '') ?? '';
  return { source: 'page', url, number: numberOfUrl(url), title: clip(firstLine), state: /\bClosed\b/.test(m.text) ? 'closed' : 'unknown', labels: null, ...m, record: null };
}

/**
 * A ticket from an MCP `issue_read` reply (a JSON document on GitHub's server; anything else keeps its text, with the first line as the title and the
 * state and labels unknown).
 * @param {string} rawText @param {string} url @param {number} number
 * @param {Ticket['record']} record @returns {Ticket}
 */
export function ticketFromMcp(rawText, url, number, record) {
  const m = maskTicketText(rawText);
  /** @type {any} */
  let doc = null;
  try { doc = JSON.parse(rawText); } catch { doc = null; }
  const obj = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  const firstLine = m.text.split('\n').find((l) => l.trim() !== '') ?? '';
  const title = clip(typeof obj?.title === 'string' ? redactSecrets(obj.title) : firstLine);
  const st = typeof obj?.state === 'string' ? obj.state.toLowerCase() : '';
  const state = st === 'open' || st === 'closed' ? st : 'unknown';
  /** @type {string[]|null} */
  let labels = null;
  if (Array.isArray(obj?.labels)) {
    labels = obj.labels.map((/** @type {any} */ l) => (typeof l === 'string' ? l : typeof l?.name === 'string' ? l.name : null)).filter((/** @type {any} */ l) => typeof l === 'string').map((/** @type {string} */ l) => redactSecrets(l));
  }
  return { source: 'mcp', url, number, title, state, labels, ...m, record };
}

/**
 * The pull request a `pull_request_read` ticket froze, as the object the checkout reads (`head.sha`, `base.ref`, `base.sha`): the parsed, MASKED reply (the same bytes the
 * sha256 covers - a sha is not a secret shape, so masking leaves it whole). Null when the text is not a JSON object.
 * @param {Ticket} ticket @returns {Record<string, any>|null}
 */
export function prRecordOfTicket(ticket) {
  try {
    const doc = JSON.parse(ticket.text);
    return doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  } catch { return null; }
}

/**
 * Read one ticket, whatever its source. An MCP-backed row (`mcp` present) goes to the MCP reader; a page row to the page reader.
 * @param {{mcp?: {server: string, tools: string[]}, listUrl?: string, number?: number, url?: string}} row
 * @param {{configPath?: string, home?: string, timeoutMs?: number, fetchPage?: typeof fetchPageText}} [deps] test seams
 * @returns {Promise<{ok: true, ticket: Ticket} | {ok: false, error: string}>}
 */
export async function readTicket(row, deps = {}) {
  if (row.mcp) {
    const r = await readTicketMcp({ listUrl: String(row.listUrl ?? ''), number: /** @type {number} */ (row.number), mcp: row.mcp, ...(deps.configPath ? { configPath: deps.configPath } : {}), ...(deps.home ? { home: deps.home } : {}), ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}) });
    if (!r.ok) return r;
    return { ok: true, ticket: ticketFromMcp(r.text, r.url, /** @type {number} */ (row.number), r.record) };
  }
  const url = String(row.url ?? '');
  const p = await (deps.fetchPage ?? fetchPageText)(url);
  if (!p.ok) return { ok: false, error: p.error };
  return { ok: true, ticket: ticketFromPage(p.text, p.url || url) };
}
