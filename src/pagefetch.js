// borrowed-from: bareloop src/pagefetch.js@56dc096 (adapted: secret check uses src/redact.js; TAG: bareloop src/labelscan.js@c59935e)
// URL inputs (PART 1c, docs/product/ITEM33-BUILD.md "4. URL inputs" + live fix L1, PRD item 33 RF21/RF22): an Inputs line may be a web
// address the person pastes (a results page). bareloop fetches it with barebrowse, READ ONLY, headless and incognito, as published:
//
//     page = await connect({ incognito: true, blockPrivateNetwork: true })
//     await page.goto(url); await page.waitForNetworkIdle({ idle, timeout }); await page.snapshot({ mode: 'act' })
//
// L1: one-shot `browse()` snapshots at load, before the page's own scripts fill a results list (the same URL gave 77,951 / 8,801 / 719
// chars). So we wait for the network to go quiet (bounded) before the snapshot. Generic: no site selector. The snapshot mode is the one
// proven in step 0 ('read' and 'full' returned almost nothing from a results page). The text that comes back is the input. An empty
// fetch is a plain-words stop, never a silent empty input. Nothing here touches a model.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from './redact.js';

/**
 * The page reader's bracketed tag (`[ref=549]`). The lookahead and lookbehind add no match and drop no match: a `[` that sits inside the run of an earlier
 * `[letters=` (no `]` or white space between) is skipped, because that earlier start reads the same run to the same end - it matches (and consumes this
 * one) or fails (and so does this one). Without them "[a=[a=[a=..." with no `]` is quadratic.
 */
const TAG = /\[(?=[A-Za-z]+=)(?<!\[[A-Za-z]+=[^\]\s]*?)[A-Za-z]+=[^\]\s]*\]/g;

/** the session options (incognito: no auth ever enters; blockPrivateNetwork: SSRF guard); ONE frozen object so a test can pin them */
export const CONNECT_OPTIONS = Object.freeze({ incognito: true, blockPrivateNetwork: true });
/** the snapshot options step 0 proved (a page) */
export const SNAPSHOT_OPTIONS = Object.freeze({ mode: 'act' });
/** M12 am1: a ticket's own page keeps its body text only in barebrowse's `data` mode (F89: `act` drops the body paragraphs) */
export const TICKET_SNAPSHOT_OPTIONS = Object.freeze({ mode: 'data' });
/** M12 am1: the ONE place that decides the snapshot mode per input kind. @param {boolean} isTicket */
export function snapshotOptionsFor(isTicket) { return isTicket ? TICKET_SNAPSHOT_OPTIONS : SNAPSHOT_OPTIONS; }
/** the page's network must be quiet this long (ms) before we read it: long enough to span the gap between a page's first load and the
 *  script requests that fill the results, short enough not to stretch a plain page */
export const NETWORK_IDLE_MS = 1500;
/** the most we wait for the network to go quiet (ms); a page that never settles (polling, streaming) is read as it stands after this */
export const NETWORK_IDLE_TIMEOUT_MS = 20_000;
/** the most we wait for the page to load at all (ms) */
export const GOTO_TIMEOUT_MS = 30_000;
/** a page that comes back with fewer characters than this (after trimming) is treated as "nothing came back" */
export const MIN_PAGE_CHARS = 200;
/** the page text left after the site's own header, menus and footer are taken out must hold at least this many characters, or the page is
 *  "only site chrome" (L2: a 719-character fetch of a site's header and sign-in passed the 200-character floor) */
export const MIN_CONTENT_CHARS = 100;
/** the page reader's landmark roles for a site's own chrome (the ARIA names of header, menu and footer); everything under one is not the page's content */
const CHROME_ROLES = new Set(['banner', 'navigation', 'contentinfo']);
/** our own deadline around one whole fetch (a hung browser leaves no trace; this is the only thing that fires on the absence of an answer) */
export const PAGE_FETCH_TIMEOUT_MS = 90_000;

/** @param {unknown} v @returns {boolean} an http(s) address (the one spelling of "this Inputs value is a web address") */
export function isWebUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}

/** M10 am3: the web pages a signed job names, role -> address (`source <role> = page:<address>`). The ONE reader of which roles are pages and what their signed address is.
 *  @param {{sources?: Array<{role: string, kind?: string, path: string}>}} arbiter @returns {Record<string, string>} */
export function pageAddressesOf(arbiter) {
  return Object.fromEntries((arbiter?.sources ?? []).filter((s) => s.kind === 'page').map((s) => [s.role, s.path]));
}

/** M10 am3: why a run may not name another address for a page input (the signed address is the job's; a different one is a changed job). @param {string} role @param {string} signed */
export function pageAddressRefusal(role, signed) {
  return `the input "${role}" is a web page signed as ${signed}; a run cannot name a different address (a changed address is a changed job, a new workflow). Nothing started.`;
}

/** M12 item 5: the ticket lists a signed job names, role -> list address (`source <role> = tickets:<address>`). The ONE reader of which roles are ticket roles and their signed list address.
 *  @param {{sources?: Array<{role: string, kind?: string, path: string}>}} arbiter @returns {Record<string, string>} */
export function ticketListsOf(arbiter) {
  return Object.fromEntries((arbiter?.sources ?? []).filter((s) => s.kind === 'ticket').map((s) => [s.role, s.path]));
}

/** M12 item 7: is `address` a ticket of `list`? Same origin, no credentials, and the list's own path plus exactly one more part (any text, not only digits).
 *  The query and fragment of either address are not part of the path. Decided on parsed addresses, never on prose.
 *  @param {string} address @param {string} list @returns {boolean} */
export function ticketUnderList(address, list) {
  let a; let l;
  try { a = new URL(String(address).trim()); l = new URL(String(list).trim()); } catch { return false; }
  if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
  if (a.username !== '' || a.password !== '') return false;
  if (a.origin !== l.origin) return false;
  const parts = (u) => u.pathname.split('/').filter((x) => x !== '');
  const base = parts(l);
  const mine = parts(a);
  if (mine.length !== base.length + 1 || !base.every((x, i) => x === mine[i])) return false;
  return !a.pathname.endsWith('/');
}

/** M12 item 7: why a run may not name this address for a ticket input. @param {string} role @param {string} list */
export function ticketRefusal(role, list) {
  return `the input "${role}" is a ticket from the list ${list}; the address given is not one ticket of that list (a ticket's address is the list's own path plus one more part, on the same site). Nothing started.`;
}

/**
 * How much of a fetched page is the page's own content: the snapshot's header lines (url, size note, hint) and every part of the tree
 * under a banner / navigation / contentinfo landmark are taken out, the page reader's bracketed tags are removed, and what is left is
 * counted. Generic - no site names, only the ARIA landmark roles. Text that is not a snapshot tree (a plain file) has no landmark, so it
 * counts whole.
 * @param {string} text @returns {number}
 */
export function pageContentChars(text) {
  const lines = String(text ?? '').split('\n');
  let skipIndent = -1;
  let n = 0;
  let head = true;
  for (const raw of lines) {
    if (head && (/^url: /.test(raw) || /^[\d,]+ chars → /.test(raw) || /^hint: /.test(raw))) continue;
    head = false;
    const m = /^(\s*)- ([A-Za-z_]+)\b/.exec(raw);
    const indent = m ? m[1].length : raw.length - raw.trimStart().length;
    if (skipIndent >= 0) {
      if (raw.trim() === '' || indent > skipIndent) continue;
      skipIndent = -1;
    }
    if (m && CHROME_ROLES.has(m[2])) { skipIndent = indent; continue; }
    n += raw.replace(TAG, ' ').replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim().length;
  }
  return n;
}

/**
 * @typedef {{goto: (url: string, timeout?: number) => Promise<{url: string, status: number}>, waitForNetworkIdle: (o?: {idle?: number, timeout?: number}) => Promise<void>,
 *   snapshot: (o?: {mode?: string}) => Promise<string>, close: () => Promise<void>}} FetchPage the part of barebrowse's page handle the fetch uses
 */

/** the oldest barebrowse we accept: 0.21.0 honours CONNECT_OPTIONS (incognito, blockPrivateNetwork; an older one would drop both guards without a word); 0.24.1 tethers Chromium to its launcher, so a killed run or an Abandoned draft leaves no browser behind; 0.26.0 makes goto() resolve to {url, status}, the HTTP status an error page is refused on (M10 am13) */
export const MIN_BAREBROWSE = [0, 26, 0];

/** @param {string} v @returns {boolean} true when `v` (x.y.z) is at least MIN_BAREBROWSE */
export function barebrowseNewEnough(v) {
  const p = String(v).split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const a = Number.isFinite(p[i]) ? p[i] : 0;
    if (a !== MIN_BAREBROWSE[i]) return a > MIN_BAREBROWSE[i];
  }
  return true;
}

/** barebrowse is an optional peer: loaded here, on first use, and refused by name when missing or too old. */
async function loadConnect() {
  try {
    const mod = /** @type {any} */ (await import('barebrowse'));
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.resolve('barebrowse'))), '..', 'package.json'), 'utf8'));
    if (!barebrowseNewEnough(pkg.version)) return { ok: /** @type {const} */ (false), error: `the page reader (barebrowse ${pkg.version}) is too old: a web page needs 0.26.0 or newer, which keeps the browser private, off the local network, closed when the run ends, and says whether the page loaded` };
    return { ok: /** @type {const} */ (true), connect: /** @type {(opts: Record<string, any>) => Promise<FetchPage>} */ (mod.connect) };
  } catch (e) { return { ok: /** @type {const} */ (false), error: `the page reader (barebrowse) could not be loaded: ${/** @type {Error} */ (e).message}` }; }
}

/**
 * Fetch one page's text. `connect` is injected (a test never reaches the network); the default is barebrowse's own `connect`.
 * @param {string} url
 * @param {{ticket?: boolean, connect?: (opts: Record<string, any>) => Promise<FetchPage>, timeoutMs?: number, idleMs?: number, idleTimeoutMs?: number, closeWaitMs?: number}} [o]
 * @returns {Promise<{ok: true, text: string, url: string}|{ok: false, error: string}>} `error` is plain words, without a spend line
 */
export async function fetchPageText(url, { ticket = false, connect, timeoutMs = PAGE_FETCH_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS, idleTimeoutMs = NETWORK_IDLE_TIMEOUT_MS, closeWaitMs = 3000 } = {}) {
  let u;
  try { u = new URL(url.trim()); } catch { return { ok: false, error: `${url} is not a web address fwdloop can read` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: `${url} is not an http or https address` };
  if (redactSecrets(u.href) !== u.href) return { ok: false, error: 'the web address carries a known secret shape - secrets never enter a job' };
  if (u.username !== '' || u.password !== '') return { ok: false, error: 'a web address with a user name or password in it is refused - fwdloop reads a page with no credentials at all' };
  /** @type {(opts: Record<string, any>) => Promise<FetchPage>} */
  let open;
  if (connect) open = connect;
  else {
    const loaded = await loadConnect();
    if (!loaded.ok) return loaded;
    open = loaded.connect;
  }
  /** @type {NodeJS.Timeout|undefined} */
  let timer;
  /** @type {Promise<FetchPage>|undefined} */
  let opening;
  try {
    opening = open({ ...CONNECT_OPTIONS });
    const page = opening;
    const text = await Promise.race([
      (async () => {
        const p = await page;
        const nav = await p.goto(u.href, GOTO_TIMEOUT_MS);
        // M10 am13: the status is goto's typed result, never read from the page text; decided before any reading
        const st = nav && typeof nav === 'object' ? /** @type {any} */ (nav).status : undefined;
        if (typeof st !== 'number' || !Number.isFinite(st) || st <= 0) return { refused: `${u.href} did not say whether it loaded (no HTTP status), so it is not read` };
        if (st < 200 || st > 299) return { refused: `${u.href} came back as an error page (HTTP ${st}), so there is nothing to read` };
        // bounded: a page that never goes quiet (polling, streaming) is read as it stands (bareloop); the size and chrome floors below then decide
        try { await p.waitForNetworkIdle({ idle: idleMs, timeout: idleTimeoutMs }); } catch { /* read what is there */ }
        return p.snapshot({ ...snapshotOptionsFor(ticket) });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer inside ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs); }),
    ]);
    if (text && typeof text === 'object' && 'refused' in text) return { ok: false, error: String(text.refused) };
    if (typeof text !== 'string') return { ok: false, error: `${u.href} did not come back as text` };
    if (/\[BOT CHALLENGE DETECTED\]/.test(text)) return { ok: false, error: `${u.href} asked for a human check (a bot challenge), so the page could not be read` };
    const size = text.trim().length;
    if (size < MIN_PAGE_CHARS) return { ok: false, error: `${u.href} came back with ${size === 0 ? 'no text' : `only ${size} characters of text`} (less than ${MIN_PAGE_CHARS}) - the page did not load, or holds nothing to read` };
    if (pageContentChars(text) < MIN_CONTENT_CHARS) return { ok: false, error: `${u.href} came back with only the site's own header and menus - the page did not load its content, so there is nothing to read` };
    return { ok: true, text, url: u.href };
  } catch (e) {
    return { ok: false, error: `${u.href} could not be read: ${/** @type {Error} */ (e)?.message ?? String(e)}` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // always close the browser, also when the deadline fired while it was still starting or loading
    if (opening) {
      /** @type {NodeJS.Timeout|undefined} */
      let w;
      await Promise.race([opening.then((p) => p.close()).catch(() => {}), new Promise((r) => { w = setTimeout(r, closeWaitMs); })]);
      if (w !== undefined) clearTimeout(w);
    }
  }
}
