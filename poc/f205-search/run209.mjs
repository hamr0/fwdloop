// F209 harness (docs/logs/FINDINGS.md "F209 PRE-REGISTRATION"). $0, no AI, no keys.
// usage: node poc/f205-search/run209.mjs --tag <tag> [--dry] [--dry-break] [--pages N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPageText, CONNECT_OPTIONS, GOTO_TIMEOUT_MS, NETWORK_IDLE_MS, NETWORK_IDLE_TIMEOUT_MS, PAGE_FETCH_TIMEOUT_MS } from '../../src/pagefetch.js';
import { SCRATCH } from './run.mjs';

export const resultsPath209 = (tag) => join(SCRATCH, `results-f209-${tag}.jsonl`);
export const pagesDir209 = join(SCRATCH, 'f209-pages');
export const PAGES = [
  { id: 'pcworld', url: 'https://www.pcworld.com/article/436674/best-pc-laptops.html' },
  { id: 'reddit', url: 'https://www.reddit.com/r/LaptopForStudent/comments/1te3pqh/best_budget_laptop_for_students_in_2026_honest/' },
  { id: 'tomshardware', url: 'https://www.tomshardware.com/laptops/best-laptops' },
  { id: 'cnn', url: 'https://edition.cnn.com/cnn-underscored/reviews/best-budget-laptops' },
  { id: 'realpython', url: 'https://realpython.com/python-csv/' },
  { id: 'docs-python', url: 'https://docs.python.org/3/library/csv.html' },
  { id: 'accuweather', url: 'https://www.accuweather.com/en/pt/lisbon/274087/weather-forecast/274087' },
  { id: 'weather-com', url: 'https://weather.com/pt/lisbon/city/lisbon/tenday' },
];
const BRAND = /\b(Acer|Asus|Dell|HP|Lenovo|Apple|MacBook|Microsoft|Surface|Samsung|Razer|MSI)\b/;
const SPEC = /\b\d+\s?GB\b/i;
const DOLLAR = /\$\d/;
export const countsOf = (text) => {
  const lines = String(text ?? '').split('\n');
  return { brand: lines.filter((l) => BRAND.test(l)).length, spec: lines.filter((l) => SPEC.test(l)).length, dollar: lines.filter((l) => DOLLAR.test(l)).length };
};

// borrowed-from: src/pagefetch.js fetchPageText (this repo). Differences: arm B calls page.readable() and arm C snapshot({mode:'read'}) instead of the act snapshot; the text/size floors are NOT applied (a short result is measured, not hidden). Same connect options, goto with status check, idle wait and bot-challenge floor. The connect loader (version check) is not exported there, so it is a plain import here.
export async function readArm(url, arm, { connect, timeoutMs = PAGE_FETCH_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS, idleTimeoutMs = NETWORK_IDLE_TIMEOUT_MS, closeWaitMs = 3000 } = {}) {
  const u = new URL(url);
  const open = connect ?? (await import('barebrowse')).connect;
  let timer; let opening;
  try {
    opening = open({ ...CONNECT_OPTIONS });
    const page = opening;
    const out = await Promise.race([
      (async () => {
        const p = await page;
        const nav = await p.goto(u.href, GOTO_TIMEOUT_MS);
        const st = nav && typeof nav === 'object' ? nav.status : undefined;
        if (typeof st !== 'number' || !Number.isFinite(st) || st <= 0) return { refused: `${u.href} did not say whether it loaded (no HTTP status)` };
        if (st < 200 || st > 299) return { refused: `${u.href} came back as an error page (HTTP ${st})` };
        try { await p.waitForNetworkIdle({ idle: idleMs, timeout: idleTimeoutMs }); } catch { /* read what is there */ }
        if (arm === 'B') {
          const r = await p.readable();
          if (!r?.ok) return { refused: `readable() not ok: ${r?.hint ?? 'no text'}` };
          return { text: `${r.title ?? ''}\n\n${r.text}` };
        }
        return { text: await p.snapshot({ mode: 'read' }) };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer inside ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs); }),
    ]);
    if ('refused' in out) return { ok: false, error: out.refused, text: '' };
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

/** --dry: a fake connect, no network. act keeps little, read/readable keep the article; --dry-break makes readable() fail. */
function fakeConnect(brk) {
  const article = Array.from({ length: 30 }, (_, i) => `The Acer Aspire ${i} has 16GB RAM and costs $${500 + i} today.`).join('\n');
  return async () => ({
    goto: async () => ({ status: 200 }),
    waitForNetworkIdle: async () => {},
    snapshot: async (o) => (o?.mode === 'read' ? `url: x\n${article}\n` : `url: x\n- main\n  - StaticText "Acer Aspire 16GB RAM $500 and some more words to pass the floors of the real reader," [ref=1]\n  - StaticText "a long second line of padding so the chrome floor of the act reader sees real content: ${'x'.repeat(120)}" [ref=2]\n`),
    readable: async () => (brk ? { ok: false, hint: 'not an article' } : { ok: true, title: 'Best laptops', text: article }),
    close: async () => {},
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(n);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tag = val('--tag');
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run209.mjs --tag <tag> [--dry] [--dry-break] [--pages N]'); process.exit(2); }
  const dry = flag('--dry');
  const maxP = val('--pages') ? Number(val('--pages')) : Infinity;
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath209(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir209, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  let first = true;
  for (const [i, pg] of PAGES.slice(0, maxP).entries()) {
    const n = i + 1;
    for (const arm of ['A', 'B', 'C']) {
      if (!first) await gap(5_000);
      first = false;
      const t0 = Date.now();
      let r;
      if (arm === 'A') { const f = await fetchPageText(pg.url, { connect }); r = f.ok ? { ok: true, text: f.text } : { ok: false, error: f.error, text: '' }; } else r = await readArm(pg.url, arm, { connect });
      const c = countsOf(r.text);
      const pageFile = r.ok ? join(pagesDir209, `${tag}-${arm}-${n}.txt`) : null;
      if (pageFile) writeFileSync(pageFile, r.text, { flag: 'wx' });
      rec({ kind: 'read', page: pg.id, n, url: pg.url, arm, ok: r.ok, error: r.ok ? null : r.error, chars: r.text.length, ...c, ms: Date.now() - t0, pageFile });
      console.log(`${pg.id} ${arm}: ok=${r.ok} chars=${r.text.length} brand=${c.brand} spec=${c.spec} dollar=${c.dollar}${r.ok ? '' : ` | ${String(r.error).slice(0, 90)}`}`);
    }
  }
  rec({ kind: 'done', dry });
  closeSync(fd);
  console.log(`wrote ${file}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
