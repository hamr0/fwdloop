// F213 harness (docs/logs/FINDINGS.md "F213 PRE-REGISTRATION"). PAID (hard cap $0.05) unless --dry. Never prints the key. Node's built-in fetch only.
// usage: DEEPSEEK_API_KEY=... node poc/f205-search/run213.mjs --tag <tag> [--dry] [--dry-break] [--queries N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRATCH } from './run.mjs';

export const resultsPath213 = (tag) => join(SCRATCH, `results-f213-${tag}.jsonl`);
export const pagesDir213 = join(SCRATCH, 'f213-pages');
export const BASE = 'https://api.deepseek.com';
export const QUERIES = ['best budget laptop 2026', 'best robot vacuum under $400', 'lenovo refurbished laptop'];
export const PRICE_USD = 0.00075; // pricing page + Search & Fetch guide: $0.75 per 1,000 successful requests
export const CAP_USD = 0.05;
const USD = /\$\s?\d/; const EUR = /€\s?\d|\d\s?€|EUR\s?\d/; const CHALLENGE = /robot or human|press (&|and) hold|captcha|BOT CHALLENGE|verify you are human|testchallengepage/i;
export const countsOf = (text) => { const l = String(text ?? '').split('\n'); return { usd: l.filter((x) => USD.test(x)).length, eur: l.filter((x) => EUR.test(x)).length, challenge: l.filter((x) => CHALLENGE.test(x)).length }; };
export const usdLines = (text, n = 2) => String(text ?? '').split('\n').filter((x) => USD.test(x)).slice(0, n).map((x) => x.trim().slice(0, 220));

/** one API call. `billingKnown` is false when no HTTP answer came back, or a 200 body was not JSON. Never throws. */
export async function callApi(doFetch, key, path, body, timeoutMs = 60_000) {
  const t0 = Date.now();
  try {
    const res = await doFetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const raw = await res.text();
    let json = null; try { json = JSON.parse(raw); } catch { /* not json */ }
    const seconds = (Date.now() - t0) / 1000;
    if (res.status === 200 && json === null) return { status: 200, json: null, seconds, billingKnown: false, error: '200 with a body that is not JSON' };
    const error = res.status === 200 ? null : (json?.error?.message ? `${json.error.type ?? ''} ${json.error.message}`.trim() : raw.slice(0, 160));
    return { status: res.status, json, seconds, billingKnown: true, error };
  } catch (e) {
    return { status: 0, json: null, seconds: (Date.now() - t0) / 1000, billingKnown: false, error: `no HTTP answer: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}

/** --dry: a fake HTTP layer (no network, no key) */
function fakeFetch(brk) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const res = (obj, status = 200) => ({ status, text: async () => JSON.stringify(obj) });
    if (url.endsWith('/search')) return res({ results: Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, url: `https://shop${i % 5}.example.com/${encodeURIComponent(body.query)}/${i}`, snippet: 's', summary: 'x', content: '' })) });
    const text = brk ? `# Shop\nPress & Hold to verify\nPrice EUR 299 and €310\n${'x'.repeat(50)}\n` : `# Lenovo ThinkPad deals\n${Array.from({ length: 8 }, (_, i) => `- Lenovo ThinkPad T${i} refurbished, 16GB, $${300 + i} with free shipping and a long description line to pass the floor`).join('\n')}\n${'padding line to make the page long enough for the one thousand characters floor. '.repeat(15)}\n`;
    return res({ title: 'T', content: text });
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(n);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tag = val('--tag');
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run213.mjs --tag <tag> [--dry] [--dry-break] [--queries N]'); process.exit(2); }
  const dry = flag('--dry');
  const maxQ = val('--queries') ? Number(val('--queries')) : Infinity;
  let key = process.env.DEEPSEEK_API_KEY ?? '';
  if (!dry) {
    if (key === '') { console.error('REFUSED at $0: DEEPSEEK_API_KEY is not set (or empty) - export it before running'); process.exit(2); }
    if (/[\s\x00-\x1F\x7F]/.test(key)) { console.error('REFUSED at $0: DEEPSEEK_API_KEY holds whitespace or control characters - export only the first line of the pass entry'); process.exit(2); }
  } else key = 'dry-key';
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath213(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir213, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const doFetch = dry ? fakeFetch(flag('--dry-break')) : fetch;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  rec({ kind: 'config', note: 'no locale/region field exists in the docs; `localization` (an IP address) left empty; count 5; need_content false', price: PRICE_USD, cap: CAP_USD, dry });
  let spent = 0; let stop = null; let first = true;
  const charge = (r, billed) => { if (!r.billingKnown) return PRICE_USD; return billed ? PRICE_USD : 0; };

  for (const [qi, q] of QUERIES.slice(0, maxQ).entries()) {
    if (stop) break;
    if (spent + PRICE_USD > CAP_USD) { stop = 'cap'; break; }
    if (!first) await gap(2_000); first = false;
    const s = await callApi(doFetch, key, '/v1/tools/search', { query: q, count: 5 });
    const results = Array.isArray(s.json?.results) ? s.json.results : [];
    const billedS = s.status === 200 && results.length > 0;
    const costS = charge(s, billedS); spent += costS;
    const urls = [...new Set(results.map((x) => x?.url).filter((u) => typeof u === 'string'))].slice(0, 5);
    rec({ kind: 'search', q: qi + 1, query: q, status: s.status, ok: billedS, error: s.error, chars: JSON.stringify(s.json ?? '').length, urls, titles: results.map((x) => x?.title).slice(0, 5), seconds: s.seconds, cost: costS, billingUnknown: !s.billingKnown });
    console.log(`search ${qi + 1} "${q}": status=${s.status} urls=${urls.length}${s.error ? ` | ${s.error}` : ''}`);
    if (!s.billingKnown) { stop = `search ${qi + 1}: billing unknown (${s.error})`; break; }
    let k = 0;
    for (const url of urls) {
      k += 1;
      if (spent + PRICE_USD > CAP_USD) { stop = 'cap'; break; }
      await gap(2_000);
      const f = await callApi(doFetch, key, '/v1/tools/fetch', { url });
      const content = typeof f.json?.content === 'string' ? f.json.content : '';
      const billedF = f.status === 200 && content !== '';
      const costF = charge(f, billedF); spent += costF;
      const c = countsOf(content);
      let pageFile = null;
      if (content) { pageFile = join(pagesDir213, `${tag}-q${qi + 1}-${k}.txt`); writeFileSync(pageFile, content, { flag: 'wx' }); }
      rec({ kind: 'fetch', q: qi + 1, k, url, status: f.status, ok: billedF, error: f.error, chars: content.length, ...c, usdQuotes: usdLines(content), seconds: f.seconds, cost: costF, billingUnknown: !f.billingKnown, pageFile });
      console.log(`  fetch q${qi + 1}-${k}: status=${f.status} ok=${billedF} chars=${content.length} usd=${c.usd} eur=${c.eur} challenge=${c.challenge} ${f.seconds.toFixed(1)}s${f.error ? ` | ${f.error.slice(0, 80)}` : ''}`);
      if (!f.billingKnown) { stop = `fetch q${qi + 1}-${k}: billing unknown (${f.error})`; break; }
    }
  }
  rec({ kind: 'done', spent, stop, dry });
  closeSync(fd);
  console.log(`done: spent $${spent.toFixed(5)}${stop ? `, STOPPED: ${stop}` : ''}; ${file}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
