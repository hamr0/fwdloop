// borrowed-from: bareloop src/pagefetch.js@v0.61.0 (fc56e1f3)
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

import { SECRET_PATTERNS, redactSecrets } from './validate.js';
import { TAG } from './labelscan.js';

/** the session options (incognito: no auth ever enters; blockPrivateNetwork: SSRF guard); ONE frozen object so a test can pin them */
export const CONNECT_OPTIONS = Object.freeze({ incognito: true, blockPrivateNetwork: true });
/** the snapshot options step 0 proved */
export const SNAPSHOT_OPTIONS = Object.freeze({ mode: 'act' });
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
 *  "only site chrome" (L2: a 719-character fetch of Google's header and sign-in passed the 200-character floor) */
export const MIN_CONTENT_CHARS = 100;
/** the page reader's landmark roles for a site's own chrome (the ARIA names of header, menu and footer); everything under one is not the page's content */
const CHROME_ROLES = new Set(['banner', 'navigation', 'contentinfo']);
/** how many times one fetch is tried when it comes back header-only or times out (a real Dell page was header-only on one try and whole on the next) */
export const FETCH_ATTEMPTS = 3;
/** the pause between attempts (ms) */
export const RETRY_WAIT_MS = 3000;
/** a header-only snapshot is re-taken (same open page) every this many ms until content shows up (live: Dell de-de gave header-only 3 times in ~5 s
 *  each, while its content arrived ~18-35 s after load; a fast refetch hits the same unsettled page) */
export const SETTLE_INTERVAL_MS = 2000;
/** the most one attempt keeps re-reading a header-only page (ms) before it counts as header-only; the per-attempt deadline below still bounds the whole attempt */
export const SETTLE_BUDGET_MS = 20_000;
/** how many characters of a header-only page's content (after the snapshot header) the failure record keeps */
export const HEAD_KEEP_CHARS = 300;
/** our own deadline around ONE attempt (a fetch that retries can take up to FETCH_ATTEMPTS of these, plus the pauses); a hung browser leaves no trace, this is the only thing that fires on the absence of an answer */
export const PAGE_FETCH_TIMEOUT_MS = 90_000;

/** @param {unknown} v @returns {boolean} an http(s) address (the one spelling of "this Inputs value is a web address") */
export function isWebUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
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
 * @typedef {{goto: (url: string, timeout?: number) => Promise<void>, waitForNetworkIdle: (o?: {idle?: number, timeout?: number}) => Promise<void>,
 *   snapshot: (o?: {mode?: string}) => Promise<string>, close: () => Promise<void>}} FetchPage the part of barebrowse's page handle the fetch uses
 */

/** @typedef {{chars: number, ms: number, head: string}} AttemptRecord what a header-only attempt saw: content characters, elapsed ms, the first characters of the content (secret-masked) */

/**
 * Fetch one page's text. `connect` is injected (a test never reaches the network); the default is barebrowse's own `connect`.
 * The whole fetch (own browser, own page, closed each time) is tried up to FETCH_ATTEMPTS times, but ONLY when an attempt ends header-only (the page
 * loaded its menus and not its content) or times out (our deadline, or the page load's own timeout). A bot challenge, a refused or private address, any
 * other load error, a near-empty page and a non-text answer are final on the first attempt.
 * @param {string} url
 * @param {{connect?: (opts: Record<string, any>) => Promise<FetchPage>, timeoutMs?: number, idleMs?: number, idleTimeoutMs?: number, closeWaitMs?: number, retryWaitMs?: number, settleMs?: number, settleIntervalMs?: number}} [o] `retryWaitMs` - the pause between attempts (a test passes 0); `settleMs`/`settleIntervalMs` - the in-attempt re-read budget and pace for a header-only page
 * @returns {Promise<{ok: true, text: string, url: string}|{ok: false, error: string, attempts?: AttemptRecord[]}>} `error` is plain words, without a spend line
 */
export async function fetchPageText(url, { connect, timeoutMs = PAGE_FETCH_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS, idleTimeoutMs = NETWORK_IDLE_TIMEOUT_MS, closeWaitMs = 3000, retryWaitMs = RETRY_WAIT_MS, settleMs = SETTLE_BUDGET_MS, settleIntervalMs = SETTLE_INTERVAL_MS } = {}) {
  let u;
  try { u = new URL(url.trim()); } catch { return { ok: false, error: `${url} is not a web address bareloop can read` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: `${url} is not an http or https address` };
  if (u.username !== '' || u.password !== '') return { ok: false, error: 'a web address with a user name or password in it is refused - bareloop reads a page with no credentials at all' };
  if (SECRET_PATTERNS.some((re) => re.test(u.href))) return { ok: false, error: 'the web address carries a known secret shape - secrets never enter a job' };
  /** @type {(opts: Record<string, any>) => Promise<FetchPage>} */
  let open;
  if (connect) open = connect;
  else {
    try { open = /** @type {any} */ ((await import('barebrowse')).connect); } catch (e) { return { ok: false, error: `the page reader (barebrowse) could not be loaded: ${/** @type {Error} */ (e).message}` }; }
  }
  /** @type {{ok: false, error: string}} */
  let last = { ok: false, error: '' };
  /** @type {AttemptRecord[]} */
  const attempts = [];
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const r = await attemptOnce(u, open, { timeoutMs, idleMs, idleTimeoutMs, closeWaitMs, settleMs, settleIntervalMs });
    if (r.ok) return r;
    if (!r.retry) return { ok: false, error: r.error, ...(attempts.length || r.record ? { attempts: r.record ? [...attempts, r.record] : attempts } : {}) };
    if (r.record) attempts.push(r.record);
    last = { ok: false, error: r.error };
    if (attempt < FETCH_ATTEMPTS && retryWaitMs > 0) await new Promise((res) => setTimeout(res, retryWaitMs));
  }
  return { ok: false, error: `${last.error} (tried ${FETCH_ATTEMPTS} times)`, ...(attempts.length ? { attempts } : {}) };
}

/**
 * ONE attempt: opens its own browser and page and always closes them. `retry: true` marks the two endings worth another go (header-only, timeout).
 * @param {URL} u @param {(opts: Record<string, any>) => Promise<FetchPage>} open
 * @param {{timeoutMs: number, idleMs: number, idleTimeoutMs: number, closeWaitMs: number, settleMs: number, settleIntervalMs: number}} o
 * @returns {Promise<{ok: true, text: string, url: string}|{ok: false, error: string, retry: boolean, record?: AttemptRecord}>}
 */
async function attemptOnce(u, open, { timeoutMs, idleMs, idleTimeoutMs, closeWaitMs, settleMs, settleIntervalMs }) {
  const t0 = Date.now();
  let stopped = false;
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
        await p.goto(u.href, GOTO_TIMEOUT_MS);
        // bounded: a page that never goes quiet (polling, streaming) is read as it stands - the wait is for a page that is still filling
        try { await p.waitForNetworkIdle({ idle: idleMs, timeout: idleTimeoutMs }); } catch { /* read what is there */ }
        let snap = await p.snapshot({ ...SNAPSHOT_OPTIONS });
        // header-only: the page's scripts may still be filling it (network idle came early). Keep the page open and re-read it, up to settleMs;
        // only then does this attempt count as header-only. The attempt's own deadline still bounds all of it.
        const settleEnd = Date.now() + settleMs;
        while (!stopped && Date.now() < settleEnd && isHeaderOnly(snap)) {
          await new Promise((res) => setTimeout(res, Math.min(settleIntervalMs, Math.max(0, settleEnd - Date.now()))));
          if (stopped) break;
          snap = await p.snapshot({ ...SNAPSHOT_OPTIONS });
        }
        return snap;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`no answer inside ${Math.round(timeoutMs / 1000)} seconds`), { deadline: true })), timeoutMs); }),
    ]);
    if (typeof text !== 'string') return { ok: false, retry: false, error: `${u.href} did not come back as text` };
    if (/\[BOT CHALLENGE DETECTED[\] ]/.test(text)) return { ok: false, retry: false, error: `${u.href} asked for a human check (a bot challenge), so the page could not be read` };
    const size = text.trim().length;
    if (size < MIN_PAGE_CHARS) return { ok: false, retry: false, error: `${u.href} came back with ${size === 0 ? 'no text' : `only ${size} characters of text`} (less than ${MIN_PAGE_CHARS}) - the page did not load, or holds nothing to read` };
    if (pageContentChars(text) < MIN_CONTENT_CHARS) return { ok: false, retry: true, error: `${u.href} came back with only the site's own header and menus - the page did not load its content, so there is nothing to read`, record: headerRecord(text, Date.now() - t0) };
    return { ok: true, text, url: u.href };
  } catch (e) {
    const msg = /** @type {Error} */ (e)?.message ?? String(e);
    const timedOut = /** @type {any} */ (e)?.deadline === true || /time[d ]?-?out/i.test(msg);
    return { ok: false, retry: timedOut, error: `${u.href} could not be read: ${msg}` };
  } finally {
    stopped = true;
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

/** @param {unknown} text @returns {boolean} text long enough to pass the near-empty floor, yet with no content outside the site's own chrome (the one case worth re-reading) */
function isHeaderOnly(text) {
  return typeof text === 'string' && !/\[BOT CHALLENGE DETECTED[\] ]/.test(text) && text.trim().length >= MIN_PAGE_CHARS && pageContentChars(text) < MIN_CONTENT_CHARS;
}

/** the short failure record of a header-only attempt; the head is secret-masked (the log is append-only) @param {string} text @param {number} ms @returns {AttemptRecord} */
function headerRecord(text, ms) {
  const body = text.split('\n').filter((l) => !/^url: /.test(l) && !/^[\d,]+ chars → /.test(l) && !/^hint: /.test(l)).join(' ').replace(/\s+/g, ' ').trim();
  return { chars: pageContentChars(text), ms, head: redactSecrets(body.slice(0, HEAD_KEEP_CHARS)) };
}
