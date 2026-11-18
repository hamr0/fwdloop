// F212 harness (docs/logs/FINDINGS.md "F212 PRE-REGISTRATION"). $0, no AI, no keys.
// usage: node poc/f205-search/run212.mjs --tag <tag> [--dry] [--dry-break] [--sites N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPageText } from '../../src/pagefetch.js';
import { SCRATCH } from './run.mjs';
import { readC } from './run210.mjs';

export const resultsPath212 = (tag) => join(SCRATCH, `results-f212-${tag}.jsonl`);
export const pagesDir212 = join(SCRATCH, 'f212-pages');
export const QUERY = 'lenovo refurbished laptop';
export const SITES = [
  { id: 'ebay', url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  { id: 'backmarket', url: (q) => `https://www.backmarket.com/en-us/search?q=${encodeURIComponent(q)}` },
  { id: 'bestbuy', url: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}` },
  { id: 'newegg', url: (q) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}` },
  { id: 'amazon', url: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
  { id: 'walmart', url: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}` },
];
const USD = /\$\s?\d/; const EUR = /€\s?\d|\d\s?€/; const LENOVO = /lenovo/i;
export const countsOf = (text) => {
  const l = String(text ?? '').split('\n');
  return { usd: l.filter((x) => USD.test(x)).length, eur: l.filter((x) => EUR.test(x)).length, product: l.filter((x) => LENOVO.test(x) && USD.test(x)).length };
};
export const productLines = (text, n = 2) => String(text ?? '').split('\n').filter((x) => LENOVO.test(x) && USD.test(x)).slice(0, n).map((x) => x.trim().slice(0, 220));
/** the page's current URL as barebrowse writes it at the top of a snapshot (`url: <address>`), or null */
export const landingOf = (text) => /^url:\s*(\S+)/m.exec(String(text ?? '').slice(0, 2000))?.[1] ?? null;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

/** --dry: a fake connect, no network. A product list with a lenovo line and a $ amount; --dry-break: euros and no lenovo. */
function fakeConnect(brk) {
  const good = `url: https://www.fake.example/search\n${Array.from({ length: 8 }, (_, i) => `- StaticText "Lenovo ThinkPad T4${i} refurbished, 16GB, $${300 + i * 10}.00 with free shipping today, great condition" [ref=${i}]`).join('\n')}\n- StaticText "padding text so the page is long enough to pass the floors of the real reader ${'x'.repeat(100)}" [ref=99]\n`;
  const bad = `url: https://www.fake.example/search\n${Array.from({ length: 8 }, (_, i) => `- StaticText "HP Elitebook ${i} refurbished, 16GB, €${300 + i * 10},00 with free shipping today, great condition" [ref=${i}]`).join('\n')}\n- StaticText "padding text so the page is long enough to pass the floors of the real reader ${'x'.repeat(100)}" [ref=99]\n`;
  return async () => ({ goto: async (url) => ({ status: 200, url }), waitForNetworkIdle: async () => {}, snapshot: async () => (brk ? bad : good), close: async () => {} });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(n);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tag = val('--tag');
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run212.mjs --tag <tag> [--dry] [--dry-break] [--sites N]'); process.exit(2); }
  const dry = flag('--dry');
  const maxN = val('--sites') ? Number(val('--sites')) : Infinity;
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath212(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir212, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  let first = true;
  for (const site of SITES.slice(0, maxN)) {
    const url = site.url(QUERY);
    for (const arm of ['A', 'C']) {
      if (!first) await gap(5_000);
      first = false;
      const t0 = Date.now();
      let r;
      if (arm === 'A') { const f = await fetchPageText(url, { connect }); r = f.ok ? { ok: true, text: f.text } : { ok: false, error: f.error, text: '' }; } else r = await readC(url, 'read', { connect });
      const c = countsOf(r.text);
      const landing = r.ok ? landingOf(r.text) : null;
      const pageFile = r.ok ? join(pagesDir212, `${tag}-${arm}-${site.id}.txt`) : null;
      if (pageFile) writeFileSync(pageFile, r.text, { flag: 'wx' });
      rec({ kind: 'read', site: site.id, arm, url, ok: r.ok, error: r.ok ? null : r.error, chars: r.text.length, ...c, landing, hostDiffers: landing ? hostOf(landing) !== hostOf(url) : null, quotes: productLines(r.text), seconds: (Date.now() - t0) / 1000, pageFile });
      console.log(`${site.id} ${arm}: ok=${r.ok} chars=${r.text.length} usd=${c.usd} eur=${c.eur} product=${c.product} landing=${landing ?? '-'}${r.ok ? '' : ` | ${String(r.error).slice(0, 100)}`}`);
    }
  }
  rec({ kind: 'done', dry });
  closeSync(fd);
  console.log(`wrote ${file}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
