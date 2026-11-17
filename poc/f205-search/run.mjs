// F205 harness (docs/logs/FINDINGS.md "F205 PRE-REGISTRATION" + "AMENDMENT 1"). $0, no AI, no keys.
// usage: node poc/f205-search/run.mjs --tag <tag> [--dry] [--dry-break] [--max-searches N] [--no-open]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchPageText, pageContentChars, CONNECT_OPTIONS, SNAPSHOT_OPTIONS, GOTO_TIMEOUT_MS, NETWORK_IDLE_MS, NETWORK_IDLE_TIMEOUT_MS,
  MIN_PAGE_CHARS, MIN_CONTENT_CHARS, PAGE_FETCH_TIMEOUT_MS,
} from '../../src/pagefetch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const SCRATCH = join(ROOT, '.claude', 'scratch', 'f205');
export const resultsPath = (tag) => join(SCRATCH, `results-${tag}.jsonl`);

export const ENGINES = [
  { id: 'google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en` },
  { id: 'duckduckgo', url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=us-en` },
  { id: 'bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en` },
];
export const QUERIES = ['flights Boston to Chicago', 'cheap flights Madrid to Rome', 'best budget laptop 2026', 'python read csv file', 'weather Lisbon this week'];

// the engine's own hosts (never a result) and its ad / click-tracking links
const OWN_HOST = {
  google: /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|googleadservices\.com|doubleclick\.net|youtube\.com|g\.co|goo\.gl)$/i,
  duckduckgo: /(^|\.)(duckduckgo\.com|duck\.co)$/i,
  bing: /(^|\.)(bing\.com|bingj\.com|msn\.com)$/i,
};
const AD_PATH = [/^\/aclk/i, /^\/pagead\//i, /^\/aclick/i, /^\/y\.js/i];

/** the target of an engine redirect link, or null when `u` is not one (only a redirect the text shows is unwrapped) */
function unwrap(engine, u) {
  try {
    if (engine === 'google' && /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') ?? u.searchParams.get('url');
    if (engine === 'duckduckgo' && /duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith('/l/')) return u.searchParams.get('uddg');
    if (engine === 'bing' && /bing\.com$/i.test(u.hostname) && u.pathname.startsWith('/ck/a')) {
      const v = u.searchParams.get('u');
      if (v && /^a1/.test(v)) return Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
  } catch { /* not unwrappable */ }
  return null;
}

/** the first 5 organic result URLs in a results page's text: only the real ` <url>` markers of `link` lines; engine hosts and ad links dropped; redirects unwrapped only if shown; deduped */
export function extractResultLinks(engine, text, max = 5) {
  const out = []; const seen = new Set();
  for (const line of String(text).split('\n')) {
    if (!/^\s*- link /.test(line)) continue;
    const m = line.match(/ <(https?:\/\/[^>\s]+)>/);
    if (!m) continue;
    let u;
    try { u = new URL(m[1]); } catch { continue; }
    if (AD_PATH.some((r) => r.test(u.pathname)) && OWN_HOST[engine]?.test(u.hostname)) continue;
    const target = unwrap(engine, u);
    if (target !== null) { try { u = new URL(target); } catch { continue; } }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (OWN_HOST[engine]?.test(u.hostname)) continue;
    if (AD_PATH.some((r) => r.test(u.pathname)) && /ad|click/i.test(u.hostname)) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href); out.push(u.href);
    if (out.length >= max) break;
  }
  return out;
}

// borrowed-from: src/pagefetch.js fetchPageText (this repo). ONE difference: the snapshot is {...SNAPSHOT_OPTIONS, links: true}, so link lines carry their real href. Everything else is the same; the connect loader (barebrowse >=0.26.0 version check) is not exported there, so it is a plain import here.
export async function fetchSearchPage(url, { connect, timeoutMs = PAGE_FETCH_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS, idleTimeoutMs = NETWORK_IDLE_TIMEOUT_MS, closeWaitMs = 3000 } = {}) {
  const u = new URL(url);
  const open = connect ?? (await import('barebrowse')).connect;
  let timer; let opening;
  try {
    opening = open({ ...CONNECT_OPTIONS });
    const page = opening;
    const text = await Promise.race([
      (async () => {
        const p = await page;
        const nav = await p.goto(u.href, GOTO_TIMEOUT_MS);
        const st = nav && typeof nav === 'object' ? nav.status : undefined;
        if (typeof st !== 'number' || !Number.isFinite(st) || st <= 0) return { refused: `${u.href} did not say whether it loaded (no HTTP status), so it is not read` };
        if (st < 200 || st > 299) return { refused: `${u.href} came back as an error page (HTTP ${st}), so there is nothing to read` };
        try { await p.waitForNetworkIdle({ idle: idleMs, timeout: idleTimeoutMs }); } catch { /* read what is there */ }
        return p.snapshot({ ...SNAPSHOT_OPTIONS, links: true });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer inside ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs); }),
    ]);
    if (text && typeof text === 'object' && 'refused' in text) return { ok: false, error: String(text.refused) };
    if (typeof text !== 'string') return { ok: false, error: `${u.href} did not come back as text` };
    if (/\[BOT CHALLENGE DETECTED\]/.test(text)) return { ok: false, error: `${u.href} asked for a human check (a bot challenge), so the page could not be read` };
    const size = text.trim().length;
    if (size < MIN_PAGE_CHARS) return { ok: false, error: `${u.href} came back with ${size === 0 ? 'no text' : `only ${size} characters of text`} (less than ${MIN_PAGE_CHARS})` };
    if (pageContentChars(text) < MIN_CONTENT_CHARS) return { ok: false, error: `${u.href} came back with only the site's own header and menus` };
    return { ok: true, text, url: u.href };
  } catch (e) {
    return { ok: false, error: `${u.href} could not be read: ${e?.message ?? String(e)}` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (opening) {
      let w;
      await Promise.race([opening.then((p) => p.close()).catch(() => {}), new Promise((r) => { w = setTimeout(r, closeWaitMs); })]);
      if (w !== undefined) clearTimeout(w);
    }
  }
}

/** --dry: a fake `connect` that reaches no network. A search url gets the saved sample snapshot; any other url gets a plain page (or a 404 / bot challenge under --dry-break). */
function fakeConnect(brk) {
  const sample = readFileSync(join(HERE, 'sample-snapshot.txt'), 'utf8');
  const body = '- main [ref=1]\n' + Array.from({ length: 6 }, (_, i) => `  - paragraph [ref=${i + 2}]\n    - StaticText "This is dry-run paragraph number ${i} with enough words to count as the page's own content." [ref=${i + 20}]`).join('\n');
  return async () => {
    let cur = '';
    return {
      goto: async (url) => { cur = url; return { status: brk && !/google\.com\/search/.test(url) ? 404 : 200 }; },
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
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run.mjs --tag <tag> [--dry] [--dry-break] [--max-searches N] [--no-open]'); process.exit(2); }
  const dry = flag('--dry'); const noOpen = flag('--no-open');
  const maxS = val('--max-searches') ? Number(val('--max-searches')) : Infinity;
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx'); // wx: a second writer of the same tag fails too
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  const searches = [];
  for (const q of QUERIES) for (const e of ENGINES) searches.push({ e, q });
  let n = 0; const opened = [];
  for (const { e, q } of searches.slice(0, maxS)) {
    if (n++ > 0) await gap(20_000);
    const url = e.url(q); const t0 = Date.now();
    const r = await fetchSearchPage(url, { connect });
    const links = r.ok ? extractResultLinks(e.id, r.text) : [];
    rec({ kind: 'search', engine: e.id, query: q, url, ok: r.ok, error: r.ok ? null : r.error, chars: r.ok ? r.text.length : 0, links, ms: Date.now() - t0 });
    console.log(`search ${e.id} | ${q} | ok=${r.ok} links=${links.length}${r.ok ? '' : ' | ' + r.error}`);
    if (r.ok && links.length && !noOpen) opened.push({ e, q, from: url, links });
  }
  for (const s of opened) for (const link of s.links) {
    await gap(5_000);
    const t0 = Date.now();
    const r = await fetchPageText(link, { connect });
    rec({ kind: 'open', engine: s.e.id, query: s.q, from: s.from, url: link, ok: r.ok, error: r.ok ? null : r.error, chars: r.ok ? r.text.length : 0, links: [], ms: Date.now() - t0 });
    console.log(`open ${s.e.id} | ${link} | ok=${r.ok}${r.ok ? '' : ' | ' + r.error}`);
  }
  closeSync(fd);
  console.log(`wrote ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
