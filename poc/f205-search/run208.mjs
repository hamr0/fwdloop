// F208 harness (docs/logs/FINDINGS.md "F208 PRE-REGISTRATION"). PAID (hard cap $0.15) unless --dry. Never prints a key.
// A marked copy of run207.mjs: the differences are the job (laptops, two rules), the price limit (700), the search words, the caps, and the saving of each page's text.
// usage: DEEPSEEK_API_KEY=... node poc/f205-search/run208.mjs --tag <tag> [--dry] [--dry-break] [--samples N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { lookAtPage } from '../../src/pagelook.js';
import { MAP_SYSTEM } from '../../src/pagemap.js';
import { moneyResultLines } from '../../src/pagedry.js';
import { squash } from '../../src/pagebits.js';
import { hideCounts, DRAFT_MAX_TOKENS } from '../../src/drafter.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { makeProvider, readPriceConfig, resolveUsableModel, checkKeyPreflight } from '../../src/provider.js';
import { fetchSearchPage, SCRATCH } from './run.mjs';
import { extractGotoLinks, fetchPageOpen, isGoogleHost } from './run206.mjs';
import { SLOT, MODEL, hostOf } from './run207.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const resultsPath208 = (tag) => join(SCRATCH, `results-f208-${tag}.jsonl`);
export const pagesDir = join(SCRATCH, 'f208-pages');
export const QUERY = 'best budget laptop 2026';
export const searchUrl208 = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us`;
export const STOP_AT_USD = 0.13;
export const LIMIT = 700;

export function buildJob(pageUrl) {
  const p = parseSignedText(`1. find the best budget laptops for 2026,
   guardrail: under $${LIMIT}; at least 16GB RAM
2. ask 30m: check it with me,
3. write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source laptops = page:${pageUrl}
`);
  if (!p.ok) throw new Error(`the job did not parse: ${p.reds.join('; ')}`);
  const jobLines = p.lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) }));
  const askOrSend = new Set([...p.arbiter.asks.map((a) => a.line), ...p.arbiter.sends.map((x) => x.line)]);
  return hideCounts(jobLines, new Set(p.lines.map((l) => l.n).filter((n) => !askOrSend.has(n)))).seenLines;
}

/** price rows (copy of run207 priceRowsOf, limit LIMIT): rule 1 money facts, words verbatim, fwd's moneyResultLines, currency by the sign after the label */
export function priceRowsOf(text, facts) {
  const hay = squash(text);
  const out = { rows: [], otherCurrency: [], over: [], unsigned: [] };
  for (const f of facts) {
    if (f.shape !== 'money' || f.forRule !== 1) continue;
    if (!f.words.length || !f.words.every((w) => hay.includes(squash(w).trim()))) continue;
    for (const r of moneyResultLines(text, f)) {
      const ln = squash(r.quote);
      let sign = null;
      for (const w of f.words) { const at = ln.indexOf(squash(w)); if (at !== -1) { sign = /^\s*([$€£])/.exec(ln.slice(at + squash(w).length))?.[1] ?? ''; break; } }
      const usdListed = (f.currency ?? []).some((c) => /^(\$|usd|us dollars?)$/i.test(c.trim()));
      const item = { fact: f.name, quote: r.quote, value: Number(r.value) };
      if (sign === '€' || sign === '£') out.otherCurrency.push({ ...item, sign });
      else if (sign === '$' || (sign === '' && usdListed)) (item.value < LIMIT ? out.rows : out.over).push(item);
      else out.unsigned.push(item);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeConnect() {
  const sample = readFileSync(join(HERE, 'sample206.txt'), 'utf8');
  const page = readFileSync(join(HERE, 'sample208-page.txt'), 'utf8');
  return async () => {
    let cur = '';
    return {
      goto: async (url) => { cur = url; if (/google\.com\/search/.test(url)) return { url, status: 200 }; return { url: `https://site-${/url=([^&]+)/.exec(url)?.[1] ?? 'x'}.example.com/p`, status: 200 }; },
      waitForNetworkIdle: async () => {},
      snapshot: async (o) => (/google\.com\/search/.test(cur) ? (o?.links ? sample : '- main\n') : page),
      close: async () => {},
    };
  };
}
function fakeProvider(brk) {
  return {
    lastMalformedToolCall: null,
    async generate() {
      const facts = [
        { name: 'price', from: 'line 1 rule 1', shape: 'money', words: [brk ? 'Cost:' : 'Price:'], why: 'the price of a result', currency: ['$'], unit: [] },
        { name: 'memory', from: 'line 1 rule 2', shape: 'phrase', words: ['16GB RAM'], why: 'the memory of a result' },
      ];
      return { text: JSON.stringify({ facts, cannot: [] }), toolCalls: [], usage: { inputTokens: 3000, outputTokens: 150 }, stopReason: 'stop', model: 'fake' };
    },
  };
}

async function main() {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(n);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tag = val('--tag');
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run208.mjs --tag <tag> [--dry] [--dry-break] [--samples N]'); process.exit(2); }
  const dry = flag('--dry');
  const samples = val('--samples') ? Number(val('--samples')) : 5;
  let provider; let rates;
  if (dry) {
    const u = resolveUsableModel(SLOT, { config: readPriceConfig(), model: MODEL });
    if (!u.ok) { console.error(u.say); process.exit(2); }
    ({ rates } = u); provider = fakeProvider(flag('--dry-break'));
  } else {
    const k = checkKeyPreflight(SLOT, process.env);
    if (!k.ok) { console.error(`REFUSED at $0: ${k.message}`); process.exit(2); }
    ({ provider, rates } = makeProvider(SLOT, { model: MODEL, ...LIVE_PROVIDER_OPTIONS }));
  }
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath208(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect() : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  let spent = 0; let stop = null; let looks = 0;

  for (let s = 1; s <= samples && stop === null; s += 1) {
    if (s > 1) await gap(20_000);
    const url = searchUrl208(QUERY);
    const r = await fetchSearchPage(url, { connect });
    const { organic, excluded } = r.ok ? extractGotoLinks(r.text) : { organic: [], excluded: {} };
    rec({ kind: 'search', sample: s, url, ok: r.ok, error: r.ok ? null : r.error, links: organic.length, excluded });
    console.log(`sample ${s}: search ok=${r.ok} organic=${organic.length}`);
    const seen = new Set(); let n = 0;
    for (const href of organic) {
      await gap(5_000);
      n += 1;
      const o = await fetchPageOpen(href, { connect });
      const landing = o.landing; const host = hostOf(landing);
      const off = host !== null && !isGoogleHost(host);
      const dup = off && seen.has(landing);
      if (off) seen.add(landing);
      let pageFile = null;
      if (o.ok) { pageFile = join(pagesDir, `${tag}-s${s}-${n}.txt`); writeFileSync(pageFile, o.text, { flag: 'wx' }); }
      const base = { kind: 'page', sample: s, n, href, landing, host, landedOffGoogle: off, duplicate: dup, ok: o.ok, error: o.ok ? null : o.error, chars: o.ok ? o.text.length : 0, pageFile };
      if (!off || dup || !o.ok) { rec({ ...base, looked: false }); console.log(`  ${host} off=${off} dup=${dup} ok=${o.ok} (no look)`); continue; }
      if (spent >= STOP_AT_USD) { stop = `spent $${spent.toFixed(4)} >= $${STOP_AT_USD}`; rec({ ...base, looked: false, stop }); break; }
      const jobLines = buildJob(url);
      const attempts = []; const events = [];
      const callModel = async (content, attempt) => {
        const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
        let res;
        try {
          res = await loop.run([{ role: 'system', content: MAP_SYSTEM }, { role: 'user', content }], [], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: attempt === 1 ? 'off' : 'on' });
        } catch (err) { attempts.push({ attempt, error: String(err?.message ?? err) }); return { error: String(err?.message ?? err) }; }
        const cutOff = res?.stopReason === 'max_tokens';
        attempts.push({ attempt, raw: res?.text ?? '', cutOff, stopReason: res?.stopReason ?? null });
        if (res?.error && !cutOff) return { error: String(res.error) };
        return { text: res?.text ?? '', cutOff };
      };
      const t0 = Date.now();
      const got = await lookAtPage({ label: 'laptops', text: o.text, jobLines, callModel });
      const seconds = (Date.now() - t0) / 1000;
      const unpriced = events.length === 0 || events.some((e) => typeof e.costUsd !== 'number');
      const cost = events.reduce((t, e) => t + (typeof e.costUsd === 'number' ? e.costUsd : 0), 0);
      const tokens = events.reduce((t, e) => ({ in: t.in + (e.usage?.inputTokens ?? 0), out: t.out + (e.usage?.outputTokens ?? 0) }), { in: 0, out: 0 });
      spent += cost; looks += 1;
      const pr = got.ok ? priceRowsOf(o.text, got.look.facts) : { rows: [], otherCurrency: [], over: [], unsigned: [] };
      rec({ ...base, looked: true, lookOk: got.ok, reason: got.ok ? null : got.reason, attempts: got.attempts, answers: attempts, mapping: got.ok ? got.mapping : null, kept: got.ok ? got.look.facts : [], dropped: got.ok ? got.look.dropped : [], priceRows: pr.rows, otherCurrency: pr.otherCurrency, over: pr.over, unsigned: pr.unsigned, cost, costUnpriced: unpriced, tokens, seconds, spentSoFar: spent });
      console.log(`  ${host} look ok=${got.ok} rows=${pr.rows.length} other=${pr.otherCurrency.length} cost=$${cost.toFixed(5)} spent=$${spent.toFixed(4)}`);
      if (unpriced) { stop = 'an unpriced round: batch stopped, never priced as 0'; rec({ kind: 'stop', stop }); break; }
    }
  }
  rec({ kind: 'done', looks, spent, stop, dry });
  closeSync(fd);
  console.log(`done: ${looks} looks, spent $${spent.toFixed(5)}${stop ? `, STOPPED: ${stop}` : ''}; ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
