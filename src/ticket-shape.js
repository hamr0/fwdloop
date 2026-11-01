// M12 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 5, 7): the signed SHAPES of a ticket job, in one file with no imports so the signing, schedule and
// declaration code can read them without reaching the MCP bridge. The ticket list address (`tickets:<list page URL>`, a GitHub issues page), the watchable fields.

/** The fields a signed schedule may watch (item 7): typed values the list already carries. */
export const WATCHABLE = Object.freeze(['state', 'labels']);

/** the shape of a ticket list address: owner and repo are the two groups */
export const LIST_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/?$/;

/**
 * The one reader of a ticket list address: its owner and repo and the address of one ticket on it, or the one refusal every caller shows.
 * @param {unknown} listUrl @returns {{ok: true, owner: string, repo: string, ticketUrl: (number: number) => string} | {ok: false, error: string}}
 */
export function parseTicketList(listUrl) {
  const text = String(listUrl).trim();
  const m = LIST_URL.exec(text);
  if (!m) return { ok: false, error: `${listUrl} is not a GitHub issues address (the issues page of one repository)` };
  return { ok: true, owner: m[1], repo: m[2], ticketUrl: (number) => `${text.replace(/\/$/, '')}/${number}` };
}

/** The ticket lists a signed job names: role -> address, for every page input whose address has the list shape. @param {{sources?: Array<{role: string, kind?: string, path: string}>}} arbiter @returns {Record<string, string>} */
export function ticketListsOf(arbiter) {
  return Object.fromEntries((arbiter?.sources ?? []).filter((s) => s.kind === 'page' && LIST_URL.test(String(s.path).trim())).map((s) => [s.role, String(s.path).trim()]));
}

/** M13 piece 7 (9.7): the one cap on a ticket number, 10 digits. Every door that takes or reads a ticket number uses `isTicketNumber`. Under 2^53, so a safe JS number. */
export const TICKET_MAX = 9_999_999_999;

/** The one check of a ticket number: a whole number from 1 to `TICKET_MAX`. @param {unknown} n @returns {n is number} */
export const isTicketNumber = (n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 1 && /** @type {number} */ (n) <= TICKET_MAX;

/** The words every refusal of a ticket number uses. */
export const TICKET_NUMBER_WORDS = `a whole number from 1 to ${TICKET_MAX.toLocaleString('en-US')}`;
