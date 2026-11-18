// F206 harness (docs/logs/FINDINGS.md "F206 PRE-REGISTRATION"). $0, no AI, no keys.
// usage: node poc/f205-search/run206.mjs --tag <tag> [--dry] [--dry-break] [--max-searches N] [--max-opens N] [--no-open]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pageContentChars, CONNECT_OPTIONS, GOTO_TIMEOUT_MS, NETWORK_IDLE_MS, NETWORK_IDLE_TIMEOUT_MS, MIN_PAGE_CHARS, MIN_CONTENT_CHARS, PAGE_FETCH_TIMEOUT_MS,
} from '../../src/pagefetch.js';
import { redactSecrets } from '../../src/redact.js';
import { fetchSearchPage, SCRATCH, QUERIES } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const resultsPath206 = (tag) => join(SCRATCH, `results-f206-${tag}.jsonl`);
export const searchUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us`;
export const isGoogleHost = (h) => /(^|\.)google\.[a-z.]+$/i.test(h);

/** organic links = the first `max` distinct https://www.google.com/goto?... hrefs on link lines; everything else google is excluded and counted by kind */
export function extractGotoLinks(text, max = 5) {
  const organic = []; const seen = new Set(); const excluded = { aclk: 0, travelClk: 0, otherGoogle: 0, nonGoogle: 0 };
  for (const line of String(text).split('\n')) {
    if (!/^\s*- link /.test(line)) continue;
    const m = line.match(/ <(https?:\/\/[^>\s]+)>/);
    if (!m) continue;
    let u; try { u = new URL(m[1]); } catch { continue; }
    if (!isGoogleHost(u.hostname)) { excluded.nonGoogle += 1; continue; }
    if (u.pathname === '/goto' && u.searchParams.has('url')) { if (!seen.has(u.href)) { seen.add(u.href); if (organic.length < max) organic.push(u.href); } continue; }
    if (u.pathname.startsWith('/aclk')) excluded.aclk += 1;
    else if (u.pathname.startsWith('/travel/clk')) excluded.travelClk += 1;
    else excluded.otherGoogle += 1;
  }
  return { organic, excluded };
}

// borrowed-from: src/pagefetch.js fetchPageText (this repo). ONE difference: it also returns `landing`, the final URL after redirects that barebrowse's goto() resolves to ({url, status}). Same connect options, status check, idle wait, bot-challenge and size floors. The connect loader (version check) is not exported there, so it is a plain import here.
export async function fetchPageOpen(url, { connect, timeoutMs = PAGE_FETCH_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS, idleTimeoutMs = NETWORK_IDLE_TIMEOUT_MS, closeWaitMs = 3000 } = {}) {
  let u;
  try { u = new URL(url.trim()); } catch { return { ok: false, landing: null, error: `${url} is not a web address fwdloop can read` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, landing: null, error: `${url} is not an http or https address` };
  if (redactSecrets(u.href) !== u.href) return { ok: false, landing: null, error: 'the web address carries a known secret shape - secrets never enter a job' };
  if (u.username !== '' || u.password !== '') return { ok: false, landing: null, error: 'a web address with a user name or password in it is refused' };
  const open = connect ?? (await import('barebrowse')).connect;
  let timer; let opening; let landing = null;
  try {
    opening = open({ ...CONNECT_OPTIONS });
    const page = opening;
    const text = await Promise.race([
      (async () => {
        const p = await page;
        const nav = await p.goto(u.href, GOTO_TIMEOUT_MS);
        const st = nav && typeof nav === 'object' ? nav.status : undefined;
        landing = nav && typeof nav === 'object' && typeof nav.url === 'string' ? nav.url : null;
        if (typeof st !== 'number' || !Number.isFinite(st) || st <= 0) return { refused: `${u.href} did not say whether it loaded (no HTTP status), so it is not read` };
        if (st < 200 || st > 299) return { refused: `${u.href} came back as an error page (HTTP ${st}), so there is nothing to read` };
        try { await p.waitForNetworkIdle({ idle: idleMs, timeout: idleTimeoutMs }); } catch { /* read what is there */ }
        return p.snapshot({ mode: 'act' });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer inside ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs); }),
    ]);
    if (text && typeof text === 'object' && 'refused' in text) return { ok: false, landing, error: String(text.refused) };
    if (typeof text !== 'string') return { ok: false, landing, error: `${u.href} did not come back as text` };
    if (/\[BOT CHALLENGE DETECTED\]/.test(text)) return { ok: false, landing, error: `${u.href} asked for a human check (a bot challenge), so the page could not be read` };
    const size = text.trim().length;
    if (size < MIN_PAGE_CHARS) return { ok: false, landing, error: `${u.href} came back with ${size === 0 ? 'no text' : `only ${size} characters of text`} (less than ${MIN_PAGE_CHARS})` };
    if (pageContentChars(text) < MIN_CONTENT_CHARS) return { ok: false, landing, error: `${u.href} came back with only the site's own header and menus` };
    return { ok: true, landing, text };
  } catch (e) {
    return { ok: false, landing, error: `${u.href} could not be read: ${e?.message ?? String(e)}` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (opening) {
      let w;
      await Promise.race([opening.then((p) => p.close()).catch(() => {}), new Promise((r) => { w = setTimeout(r, closeWaitMs); })]);
      if (w !== undefined) clearTimeout(w);
    }
  }
}

/** --dry: a fake `connect` that reaches no network. A /search url gets the synthetic sample; a /goto url "redirects" to a made-up host (under --dry-break: back to a google.com Redirect Notice page). */
function fakeConnect(brk) {
  const sample = readFileSync(join(HERE, 'sample206.txt'), 'utf8');
  const body = '- main [ref=1]\n' + Array.from({ length: 6 }, (_, i) => `  - paragraph [ref=${i + 2}]\n    - StaticText "This is dry-run paragraph number ${i} with enough words to count as the page's own content." [ref=${i + 20}]`).join('\n');
  return async () => {
    let cur = '';
    return {
      goto: async (url) => {
        cur = url;
        if (/google\.com\/search/.test(url)) return { url, status: 200 };
        const tok = /url=([^&]+)/.exec(url)?.[1] ?? 'x';
        return { url: brk ? 'https://www.google.com/url?q=redirect-notice' : `https://site-${tok}.example.com/page`, status: 200 };
      },
      waitForNetworkIdle: async () => {},
      snapshot: async (o) => (/google\.com\/search/.test(cur) ? (o?.links ? sample : '- main\n') : body),
      close: async () => {},
    };
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(n);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tag = val('--tag');
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run206.mjs --tag <tag> [--dry] [--dry-break] [--max-searches N] [--max-opens N] [--no-open]'); process.exit(2); }
  const dry = flag('--dry'); const noOpen = flag('--no-open');
  const maxS = val('--max-searches') ? Number(val('--max-searches')) : Infinity;
  const maxO = val('--max-opens') ? Number(val('--max-opens')) : Infinity;
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath206(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  const opened = []; let n = 0;
  for (const q of QUERIES.slice(0, maxS)) {
    if (n++ > 0) await gap(20_000);
    const url = searchUrl(q); const t0 = Date.now();
    const r = await fetchSearchPage(url, { connect });
    const { organic, excluded } = r.ok ? extractGotoLinks(r.text) : { organic: [], excluded: {} };
    rec({ kind: 'search', query: q, url, ok: r.ok, error: r.ok ? null : r.error, chars: r.ok ? r.text.length : 0, links: organic, excluded, ms: Date.now() - t0 });
    console.log(`search | ${q} | ok=${r.ok} organic=${organic.length} excluded=${JSON.stringify(excluded)}${r.ok ? '' : ' | ' + r.error}`);
    if (r.ok) opened.push({ q, links: organic });
  }
  let k = 0;
  if (!noOpen) for (const s of opened) for (const link of s.links) {
    if (k++ >= maxO) break;
    await gap(5_000);
    const t0 = Date.now();
    const r = await fetchPageOpen(link, { connect });
    let host = null; try { host = new URL(r.landing).hostname; } catch { /* no landing */ }
    const off = host !== null && !isGoogleHost(host);
    rec({ kind: 'open', query: s.q, href: link, landing: r.landing, landedOffGoogle: off, ok: r.ok, error: r.ok ? null : r.error, chars: r.ok ? r.text.length : 0, ms: Date.now() - t0 });
    console.log(`open | ${s.q} | landing=${r.landing} off=${off} ok=${r.ok}${r.ok ? '' : ' | ' + r.error.slice(0, 100)}`);
  }
  closeSync(fd);
  console.log(`wrote ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
