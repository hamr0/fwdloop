// F216 harness (docs/logs/FINDINGS.md "F216 PRE-REGISTRATION"). $0, no AI, no keys. The anti-bot copy of barebrowse is imported from its own checkout, unmodified.
// usage: node poc/f205-search/run216.mjs --tag <tag> [--dry] [--dry-break] [--sites N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRATCH } from './run.mjs';

export const resultsPath216 = (tag) => join(SCRATCH, `results-f216-${tag}.jsonl`);
export const pagesDir216 = join(SCRATCH, 'f216-pages');
const BB = '/home/hamr/PycharmProjects/bb-antibot/src/index.js';
const Q = 'lenovo refurbished laptop';
export const SITES = [
  { id: 'ebay', url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(Q)}` },
  { id: 'newegg', url: `https://www.newegg.com/p/pl?d=${encodeURIComponent(Q)}` },
  { id: 'backmarket', url: `https://www.backmarket.com/en-us/search?q=${encodeURIComponent(Q)}` },
  { id: 'bestbuy', url: `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(Q)}` },
  { id: 'amazon', url: `https://www.amazon.com/s?k=${encodeURIComponent(Q)}` },
  { id: 'walmart', url: `https://www.walmart.com/search?q=${encodeURIComponent(Q)}` },
  { id: 'duckduckgo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(Q)}` },
];
export const ENGINES = ['chromium', 'firefox'];
const USD = /\$\s?\d/; const EUR = /€\s?\d|\d\s?€|EUR\s?\d/; const LENOVO = /lenovo/i;
export const CHALLENGE = /robot or human|press (&|and) hold|captcha|BOT CHALLENGE|verify you are human|testchallengepage|human verification/i;
export const productLines = (t) => String(t ?? '').split('\n').filter((l) => LENOVO.test(l) && (USD.test(l) || EUR.test(l))).length;
export const hasChallengeWords = (t) => CHALLENGE.test(String(t ?? ''));
export const holdRef = (t) => /button "Press & Hold Human Challenge" \[ref=(\d+)\]/.exec(String(t ?? ''))?.[1] ?? null;

/** --dry: a fake library. walmart is blocked until hold(); --dry-break: hold clears nothing and amazon is falsely flagged. */
function fakeConnect(brk) {
  return async (opts) => {
    let cur = ''; let held = false;
    const lines = (n) => Array.from({ length: n }, (_, i) => `  - StaticText "Lenovo ThinkPad T${i} refurbished $${300 + i} with free shipping and some more words" [ref=${i + 20}]`).join('\n');
    return {
      get botBlocked() { return /walmart/.test(cur) ? (!held || brk) : (brk && /amazon/.test(cur)); },
      goto: async (url) => { cur = url; return { status: /ebay|newegg/.test(url) ? 403 : 200, url }; },
      waitForNetworkIdle: async () => {},
      snapshot: async () => (/ebay|newegg/.test(cur) ? '' : /walmart/.test(cur) && !held ? `url: ${cur}\n[BOT CHALLENGE DETECTED — page content may be incomplete or blocked]\n- dialog "Robot or human?" [ref=7]\n  - button "Press & Hold Human Challenge" [ref=12]\n` : `url: ${cur}\n- main [ref=1]\n${lines(8)}\n`),
      hold: async () => { held = true; },
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
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run216.mjs --tag <tag> [--dry] [--dry-break] [--sites N]'); process.exit(2); }
  const dry = flag('--dry');
  const maxN = val('--sites') ? Number(val('--sites')) : Infinity;
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath216(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir216, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : (await import(BB)).connect;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  let first = true;
  for (const site of SITES.slice(0, maxN)) for (const engine of ENGINES) {
    if (!first) await gap(5_000);
    first = false;
    const t0 = Date.now();
    let page; const row = { kind: 'read', site: site.id, engine, url: site.url };
    try {
      page = await connect({ engine, mode: 'headless', incognito: true, blockPrivateNetwork: true });
      const nav = await page.goto(site.url, 30_000);
      row.status = nav?.status ?? null; row.landing = nav?.url ?? null;
      try { await page.waitForNetworkIdle({ idle: 1500, timeout: 20_000 }); } catch { /* read what is there */ }
      const text = await page.snapshot({ mode: 'act' });
      row.botBlocked = page.botBlocked; row.chars = text.length; row.marker = /BOT CHALLENGE DETECTED/.test(text); row.challengeWords = hasChallengeWords(text); row.product = productLines(text);
      row.pageFile = join(pagesDir216, `${tag}-${engine}-${site.id}.txt`); writeFileSync(row.pageFile, text, { flag: 'wx' });
      if (site.id === 'walmart') {
        const ref = holdRef(text);
        row.hold = { attempted: false, ref };
        if (page.botBlocked && ref !== null) {
          await page.hold(Number(ref), 12_000); await gap(8_000);
          const after = await page.snapshot({ mode: 'act' });
          const u = /^url:\s*(\S+)/m.exec(after)?.[1] ?? null;
          row.hold = { attempted: true, ref, botBlockedAfter: page.botBlocked, urlAfter: u, charsAfter: after.length, productAfter: productLines(after), challengeWordsAfter: hasChallengeWords(after) };
          const f = join(pagesDir216, `${tag}-${engine}-${site.id}-after-hold.txt`); writeFileSync(f, after, { flag: 'wx' }); row.hold.pageFile = f;
        }
      }
      row.error = null;
    } catch (e) { row.error = String(e?.message ?? e).slice(0, 200); }
    finally { try { await page?.close(); } catch { /* closed */ } }
    row.seconds = (Date.now() - t0) / 1000;
    rec(row);
    console.log(`${site.id} ${engine}: status=${row.status ?? '-'} botBlocked=${row.botBlocked} marker=${row.marker} words=${row.challengeWords} chars=${row.chars ?? 0} product=${row.product ?? 0}${row.hold?.attempted ? ` | hold: blockedAfter=${row.hold.botBlockedAfter} productAfter=${row.hold.productAfter}` : ''}${row.error ? ` | ERROR ${row.error}` : ''}`);
  }
  rec({ kind: 'done', dry });
  closeSync(fd);
  console.log(`wrote ${file}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
