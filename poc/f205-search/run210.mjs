// F210 harness (docs/logs/FINDINGS.md "F210 PRE-REGISTRATION"). $0, no AI, no keys.
// usage: node poc/f205-search/run210.mjs --tag <tag> [--dry] [--dry-break] [--searches N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchPageText, CONNECT_OPTIONS, GOTO_TIMEOUT_MS, NETWORK_IDLE_MS, NETWORK_IDLE_TIMEOUT_MS, PAGE_FETCH_TIMEOUT_MS } from '../../src/pagefetch.js';
import { fetchSearchPage, SCRATCH } from './run.mjs';
import { extractGotoLinks, isGoogleHost } from './run206.mjs';

export const resultsPath210 = (tag) => join(SCRATCH, `results-f210-${tag}.jsonl`);
export const pagesDir210 = join(SCRATCH, 'f210-pages');
const BB028 = join(SCRATCH, '..', 'f210', 'bb028', 'node_modules', 'barebrowse', 'src', 'index.js');
export const QUERIES = ['best noise cancelling headphones 2026', 'best robot vacuum under $400', 'best budget smartphone 2026'];
export const searchUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us`;
const DOLLAR = /\$\d/;
const SPEC = /\b\d+(\.\d+)?\s?(GB|TB|mAh|hours?|hrs?|Hz|W|Pa|mm|inch(es)?|")\b/i;
const NAMED = /\b[A-Z][A-Za-z]+\s+[A-Z0-9][\w-]*\b.*\$\d/;
export const countsOf = (text) => { const l = String(text ?? '').split('\n'); return { dollar: l.filter((x) => DOLLAR.test(x)).length, spec: l.filter((x) => SPEC.test(x)).length }; };
export const namedLines = (text) => String(text ?? '').split('\n').filter((x) => NAMED.test(x)).slice(0, 3).map((x) => x.trim().slice(0, 200));

async function connect028() { return (await import(pathToFileURL(BB028).href)).connect; }

// borrowed-from: src/pagefetch.js fetchPageText (this repo). Differences: runs on barebrowse 0.28.0 (installed in .claude/scratch/f210/bb028, not the repo's 0.26.0); `what` 'landing' only goes to the url and returns goto's final url (no snapshot), 'read' takes snapshot({mode:'read'}); no size floors. Same connect options, goto with status check, idle wait, bot-challenge floor.
export async function readC(url, what, { connect, timeoutMs = PAGE_FETCH_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS, idleTimeoutMs = NETWORK_IDLE_TIMEOUT_MS, closeWaitMs = 3000 } = {}) {
  const u = new URL(url);
  const open = connect ?? (await connect028());
  let timer; let opening;
  try {
    opening = open({ ...CONNECT_OPTIONS });
    const page = opening;
    const out = await Promise.race([
      (async () => {
        const p = await page;
        const nav = await p.goto(u.href, GOTO_TIMEOUT_MS);
        const st = nav && typeof nav === 'object' ? nav.status : undefined;
        const landing = nav && typeof nav === 'object' && typeof nav.url === 'string' ? nav.url : null;
        if (what === 'landing') return { landing };
        if (typeof st !== 'number' || !Number.isFinite(st) || st <= 0) return { refused: `${u.href} did not say whether it loaded (no HTTP status)` };
        if (st < 200 || st > 299) return { refused: `${u.href} came back as an error page (HTTP ${st})` };
        try { await p.waitForNetworkIdle({ idle: idleMs, timeout: idleTimeoutMs }); } catch { /* read what is there */ }
        return { text: await p.snapshot({ mode: 'read' }) };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer inside ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs); }),
    ]);
    if ('refused' in out) return { ok: false, error: out.refused, text: '' };
    if (what === 'landing') return { ok: true, landing: out.landing };
    if (typeof out.text !== 'string') return { ok: false, error: `${u.href} did not come back as text`, text: '' };
    if (/\[BOT CHALLENGE DETECTED\]/.test(out.text)) return { ok: false, error: `${u.href} asked for a human check (a bot challenge)`, text: '' };
    return { ok: true, text: out.text };
  } catch (e) {
    return { ok: false, error: `${u.href} could not be read: ${e?.message ?? String(e)}`, text: '' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (opening) {
      let w;
      await Promise.race([opening.then((p) => p.close()).catch(() => {}), new Promise((r) => { w = setTimeout(r, closeWaitMs); })]);
      if (w !== undefined) clearTimeout(w);
    }
  }
}

/** --dry: a fake connect, no network. Search pages give 7 distinct /goto links per query; a /goto "lands" on a made-up host; act snapshots are short, read snapshots long (--dry-break: read = act). */
function fakeConnect(brk) {
  const links = (q) => Array.from({ length: 5 }, (_, i) => `  - link "R${i}" <https://www.google.com/goto?url=${q}${i}> [ref=${i}]`).join('\n');
  const act = `url: x\n- main\n  - StaticText "Sony WH-1000XM6 is $449 with 30 hours of battery, padding padding padding padding padding padding padding padding" [ref=1]\n  - StaticText "a second line so the chrome floor sees content ${'x'.repeat(80)}" [ref=2]\n`;
  const read = `url: x\n${Array.from({ length: 20 }, (_, i) => `Sony WH-${i} costs $${300 + i} and runs ${20 + i} hours on a charge, with 8 GB of storage.`).join('\n')}\n`;
  return async () => {
    let cur = '';
    return {
      goto: async (url) => { cur = url; return { status: 200, url: /google\.com\/search/.test(url) ? url : /goto\?url=/.test(url) ? `https://site-${/url=([^&]+)/.exec(url)[1]}.example.com/p` : url }; },
      waitForNetworkIdle: async () => {},
      snapshot: async (o) => (/google\.com\/search/.test(cur) ? `url: ${cur}\n${links(decodeURIComponent(/q=([^&]+)/.exec(cur)?.[1] ?? 'q').replace(/\W/g, ''))}\n` : (o?.mode === 'read' && !brk ? read : act)),
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
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run210.mjs --tag <tag> [--dry] [--dry-break] [--searches N]'); process.exit(2); }
  const dry = flag('--dry');
  const maxS = val('--searches') ? Number(val('--searches')) : Infinity;
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath210(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir210, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));

  // 1. the page list: searches (F206 path), each /goto resolved once by goto only, landing URLs deduped across all searches
  const pages = []; const seen = new Set();
  for (const [qi, q] of QUERIES.slice(0, maxS).entries()) {
    if (qi > 0) await gap(20_000);
    const r = await fetchSearchPage(searchUrl(q), { connect });
    const { organic } = r.ok ? extractGotoLinks(r.text) : { organic: [] };
    rec({ kind: 'search', query: q, ok: r.ok, error: r.ok ? null : r.error, links: organic.length });
    console.log(`search "${q}": ok=${r.ok} organic=${organic.length}`);
    for (const href of organic) {
      await gap(5_000);
      const l = await readC(href, 'landing', { connect });
      let host = null; try { host = new URL(l.landing).hostname; } catch { /* none */ }
      const off = l.ok && host !== null && !isGoogleHost(host);
      const dup = off && seen.has(l.landing);
      if (off && !dup) { seen.add(l.landing); pages.push({ n: pages.length + 1, query: q, url: l.landing }); }
      rec({ kind: 'link', query: q, landing: l.landing ?? null, landedOffGoogle: off, duplicate: dup, error: l.ok ? null : l.error });
    }
  }
  rec({ kind: 'pagelist', pages });
  console.log(`page list: ${pages.length} distinct landing pages`);

  // 2. every page, A then C, 5 s apart
  let first = true;
  for (const pg of pages) {
    for (const arm of ['A', 'C']) {
      if (!first) await gap(5_000);
      first = false;
      const t0 = Date.now();
      let r;
      if (arm === 'A') { const f = await fetchPageText(pg.url, { connect: dry ? connect : undefined }); r = f.ok ? { ok: true, text: f.text } : { ok: false, error: f.error, text: '' }; } else r = await readC(pg.url, 'read', { connect });
      const seconds = (Date.now() - t0) / 1000;
      const c = countsOf(r.text);
      const pageFile = r.ok ? join(pagesDir210, `${tag}-${arm}-${pg.n}.txt`) : null;
      if (pageFile) writeFileSync(pageFile, r.text, { flag: 'wx' });
      rec({ kind: 'read', n: pg.n, query: pg.query, url: pg.url, arm, ok: r.ok, error: r.ok ? null : r.error, chars: r.text.length, ...c, named: namedLines(r.text), seconds, pageFile });
      console.log(`#${pg.n} ${arm}: ok=${r.ok} chars=${r.text.length} dollar=${c.dollar} spec=${c.spec} ${seconds.toFixed(1)}s${r.ok ? '' : ` | ${String(r.error).slice(0, 80)}`}`);
    }
  }
  rec({ kind: 'done', dry, zoom: 'Z not run: barebrowse has no default pick for within' });
  closeSync(fd);
  console.log(`wrote ${file}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
