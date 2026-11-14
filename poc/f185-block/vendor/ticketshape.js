// borrowed-from: bareloop src/ticketshape.js@v0.56.0 (3383cce)
// borrowed-from: fwdloop src/ticket-shape.js@9650320
// M12 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 5, 7): the signed SHAPES of a ticket job, in one file with no imports so the signing, schedule and
// declaration code can read them without reaching the MCP bridge. The ticket list address (`tickets:<list page URL>`, a GitHub issues page), the watchable fields.

/** The fields a signed schedule may watch (item 7): typed values the list already carries. */
export const WATCHABLE = Object.freeze(['state', 'labels']);

/** the shape of a ticket list address: owner and repo are the first two groups; the third is `issues` (a ticket list) or `pulls` (a pull request list, MCP PR reader) */
export const LIST_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pulls)\/?$/;

/**
 * The one reader of a ticket list address: its kind (`issue` or `pull`), owner and repo and the address of one ticket on it, or the one refusal every caller shows.
 * A pull address is `/pull/<n>` (GitHub's own spelling), an issue address `/issues/<n>`.
 * @param {unknown} listUrl @returns {{ok: true, kind: 'issue'|'pull', owner: string, repo: string, ticketUrl: (number: number) => string} | {ok: false, error: string}}
 */
export function parseTicketList(listUrl) {
  const text = String(listUrl).trim();
  const m = LIST_URL.exec(text);
  if (!m) return { ok: false, error: `${listUrl} is not a GitHub issues or pull requests address (the issues or pulls page of one repository)` };
  const kind = m[3] === 'pulls' ? 'pull' : 'issue';
  return { ok: true, kind, owner: m[1], repo: m[2], ticketUrl: (number) => `${text.replace(/\/$/, '').replace(/\/(?:issues|pulls)$/, kind === 'pull' ? '/pull' : '/issues')}/${number}` };
}

/** The ISSUE lists a signed job names (the new-ticket look reads these with `list_issues`; a pulls list is not one): role -> address, for every page input whose address has the issues-list shape. @param {{sources?: Array<{role: string, kind?: string, path: string}>}} arbiter @returns {Record<string, string>} */
export function ticketListsOf(arbiter) {
  return Object.fromEntries((arbiter?.sources ?? []).filter((s) => { const p = s.kind === 'page' ? parseTicketList(s.path) : null; return p?.ok === true && p.kind === 'issue'; }).map((s) => [s.role, String(s.path).trim()]));
}

/** M13 piece 7 (9.7): the one cap on a ticket number, 10 digits. Every door that takes or reads a ticket number uses `isTicketNumber`. Under 2^53, so a safe JS number. */
export const TICKET_MAX = 9_999_999_999;

/** The one check of a ticket number: a whole number from 1 to `TICKET_MAX`. @param {unknown} n @returns {n is number} */
export const isTicketNumber = (n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 1 && /** @type {number} */ (n) <= TICKET_MAX;

/** The words every refusal of a ticket number uses. */
export const TICKET_NUMBER_WORDS = `a whole number from 1 to ${TICKET_MAX.toLocaleString('en-US')}`;

/**
 * The ONE reader of a typed ticket number (the CLI's `--ticket` and the panel's Ticket box): a whole number written in digits, no sign, no zero in front, at most 10 digits.
 * @param {unknown} text @returns {number|undefined} the number, or undefined when the text is not one
 */
export function ticketNumberOf(text) {
  const n = typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text.trim()) ? Number(text.trim()) : undefined;
  return isTicketNumber(n) ? n : undefined;
}
