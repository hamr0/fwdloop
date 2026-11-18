// F215 harness (docs/logs/FINDINGS.md "F215 PRE-REGISTRATION"). PAID (hard cap $0.15) unless --dry. Never prints a key. No DeepSeek Search/Fetch.
// A marked copy of run208.mjs: the job (refurbished laptop under EUR 600), EUR price rows with the pre-registered d.ddd guard, "feeling lucky" (stop at the first qualifying page),
// the page read by the REAL fetchPageText, Google as the EU/NL (gl=nl), the landing URL resolved by goto only (readC, run210.mjs).
// usage: DEEPSEEK_API_KEY=... node poc/f205-search/run215.mjs --tag <tag> [--dry] [--dry-break] [--samples N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { lookAtPage } from '../../src/pagelook.js';
import { MAP_SYSTEM } from '../../src/pagemap.js';
import { moneyResultLines } from '../../src/pagedry.js';
import { squash } from '../../src/pagebits.js';
import { fetchPageText } from '../../src/pagefetch.js';
import { hideCounts, DRAFT_MAX_TOKENS } from '../../src/drafter.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { makeProvider, readPriceConfig, resolveUsableModel, checkKeyPreflight } from '../../src/provider.js';
import { fetchSearchPage, SCRATCH } from './run.mjs';
import { extractGotoLinks, isGoogleHost } from './run206.mjs';
import { readC } from './run210.mjs';
import { SLOT, MODEL, hostOf } from './run207.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const resultsPath215 = (tag) => join(SCRATCH, `results-f215-${tag}.jsonl`);
export const pagesDir215 = join(SCRATCH, 'f215-pages');
export const QUERY = 'refurbished laptop under 600 euro';
export const searchUrl215 = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=nl`;
export const STOP_AT_USD = 0.13;
export const LIMIT = 600;
export const MAX_PAGES = 5;
export const canonical = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname}`; } catch { return u; } };

export function buildJob(pageUrl) {
  const p = parseSignedText(`1. find a refurbished laptop under €${LIMIT},
   guardrail: under €${LIMIT}; refurbished
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

const SUSPECT = /\d\.\d{3}(?:,\d+)?(?!\d)/; // Dutch thousands, e.g. 1.299,00: fwd's reader reads it as 1.299 (pre-registered guard)
/** price rows: rule 1 money facts, words verbatim, fwd's moneyResultLines, EUR by the sign after the label (or the fact's currency list), pre-registered d.ddd guard */
export function priceRowsOf(text, facts) {
  const hay = squash(text);
  const out = { rows: [], otherCurrency: [], over: [], suspect: [], unsigned: [] };
  for (const f of facts) {
    if (f.shape !== 'money' || f.forRule !== 1) continue;
    if (!f.words.length || !f.words.every((w) => hay.includes(squash(w).trim()))) continue;
    for (const r of moneyResultLines(text, f)) {
      const ln = squash(r.quote);
      let sign = null; let raw = '';
      for (const w of f.words) { const at = ln.indexOf(squash(w)); if (at !== -1) { const rest = ln.slice(at + squash(w).length); sign = /^\s*([$€£])/.exec(rest)?.[1] ?? ''; raw = /^\s*(?:[$€£]\s*)?(\d[\d,.]*)/.exec(rest)?.[1] ?? ''; break; } }
      const eurListed = (f.currency ?? []).some((c) => c.trim() === '€' || /^eur/i.test(c.trim()));
      const item = { fact: f.name, quote: r.quote, value: Number(r.value), raw };
      if (sign === '$' || sign === '£') out.otherCurrency.push({ ...item, sign });
      else if (sign === '€' || (sign === '' && eurListed)) { if (SUSPECT.test(raw)) out.suspect.push(item); else (item.value < LIMIT ? out.rows : out.over).push(item); } else out.unsigned.push(item);
    }
  }
  return out;
}
/** kept facts tied to rule 2 (refurbished) whose words are all verbatim on the page */
export const refurbFacts = (text, facts) => { const hay = squash(text); return facts.filter((f) => f.forRule === 2 && f.words.length > 0 && f.words.every((w) => hay.includes(squash(w).trim()))); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeConnect(brk) {
  const sample = readFileSync(join(HERE, 'sample206.txt'), 'utf8');
  const page = readFileSync(join(HERE, 'sample215-page.txt'), 'utf8');
  const bad = page.replace(/€(\d+)\.00/g, '€ $1,00');
  return async () => {
    let cur = '';
    return {
      goto: async (url) => { cur = url; if (/google\.com\/search/.test(url)) return { url, status: 200 }; return { url: /goto\?url=/.test(url) ? `https://site-${/url=([^&]+)/.exec(url)?.[1] ?? 'x'}.example.com/p` : url, status: 200 }; },
      waitForNetworkIdle: async () => {},
      snapshot: async (o) => (/google\.com\/search/.test(cur) ? (o?.links ? sample : '- main\n') : (brk ? bad : page)),
      close: async () => {},
    };
  };
}
function fakeProvider(brk) {
  return {
    lastMalformedToolCall: null,
    async generate() {
      const facts = [
        { name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['Price:'], why: 'the price of a result', currency: ['€'], unit: [] },
        { name: 'condition', from: 'line 1 rule 2', shape: 'phrase', words: ['Refurbished'], why: 'a result says it is refurbished' },
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
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run215.mjs --tag <tag> [--dry] [--dry-break] [--samples N]'); process.exit(2); }
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
  const file = resultsPath215(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir215, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const connect = dry ? fakeConnect(flag('--dry-break')) : undefined;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  let spent = 0; let stop = null; let looks = 0;

  for (let s = 1; s <= samples && stop === null; s += 1) {
    if (s > 1) await gap(20_000);
    const url = searchUrl215(QUERY);
    const r = await fetchSearchPage(url, { connect });
    const { organic } = r.ok ? extractGotoLinks(r.text, 10) : { organic: [] };
    rec({ kind: 'search', sample: s, url, ok: r.ok, error: r.ok ? null : r.error, links: organic.length });
    console.log(`sample ${s}: search ok=${r.ok} organic=${organic.length}`);
    const seen = new Set(); let n = 0; let qualified = false; let firstPage = true;
    for (const href of organic) {
      if (qualified || n >= MAX_PAGES || stop) break;
      if (!firstPage) await gap(5_000);
      const l = await readC(href, 'landing', { connect });
      const landing = l.ok ? l.landing : null; const host = hostOf(landing);
      const off = host !== null && !isGoogleHost(host);
      const canon = off ? canonical(landing) : null;
      const dup = off && seen.has(canon);
      if (!off || dup) { rec({ kind: 'link', sample: s, href, landing, host, landedOffGoogle: off, duplicate: dup, error: l.ok ? null : l.error }); console.log(`  link: ${host} off=${off} dup=${dup} (skipped)`); continue; }
      seen.add(canon); n += 1; firstPage = false;
      await gap(5_000);
      const pr = await fetchPageText(landing, { connect });
      let pageFile = null;
      if (pr.ok) { pageFile = join(pagesDir215, `${tag}-s${s}-${n}.txt`); writeFileSync(pageFile, pr.text, { flag: 'wx' }); }
      const base = { kind: 'page', sample: s, n, href, landing, host, chars: pr.ok ? pr.text.length : 0, read: pr.ok, readError: pr.ok ? null : pr.error, pageFile };
      if (!pr.ok) { rec({ ...base, looked: false, qualified: false, why: `refused: ${pr.error}` }); console.log(`  #${n} ${host}: refused | ${pr.error.slice(0, 90)}`); continue; }
      if (spent >= STOP_AT_USD) { stop = `spent $${spent.toFixed(4)} >= $${STOP_AT_USD}`; rec({ ...base, looked: false, qualified: false, stop }); break; }
      const jobLines = buildJob(url);
      const attempts = []; const events = [];
      const callModel = async (content, attempt) => {
        const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
        let res;
        try { res = await loop.run([{ role: 'system', content: MAP_SYSTEM }, { role: 'user', content }], [], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: attempt === 1 ? 'off' : 'on' }); } catch (err) { attempts.push({ attempt, error: String(err?.message ?? err) }); return { error: String(err?.message ?? err) }; }
        const cutOff = res?.stopReason === 'max_tokens';
        attempts.push({ attempt, raw: res?.text ?? '', cutOff, stopReason: res?.stopReason ?? null });
        if (res?.error && !cutOff) return { error: String(res.error) };
        return { text: res?.text ?? '', cutOff };
      };
      const t0 = Date.now();
      const got = await lookAtPage({ label: 'laptops', text: pr.text, jobLines, callModel });
      const seconds = (Date.now() - t0) / 1000;
      const unpriced = events.length === 0 || events.some((e) => typeof e.costUsd !== 'number');
      const cost = events.reduce((t, e) => t + (typeof e.costUsd === 'number' ? e.costUsd : 0), 0);
      const tokens = events.reduce((t, e) => ({ in: t.in + (e.usage?.inputTokens ?? 0), out: t.out + (e.usage?.outputTokens ?? 0) }), { in: 0, out: 0 });
      spent += cost; looks += 1;
      const price = got.ok ? priceRowsOf(pr.text, got.look.facts) : { rows: [], otherCurrency: [], over: [], suspect: [], unsigned: [] };
      const refurb = got.ok ? refurbFacts(pr.text, got.look.facts) : [];
      const a1 = price.rows.length >= 1; const b1 = refurb.length >= 1;
      qualified = a1 && b1;
      const why = qualified ? 'qualifies' : [!got.ok ? `look failed: ${got.reason}` : null, got.ok && !a1 ? `no price row (over ${price.over.length}, other-currency ${price.otherCurrency.length}, suspect-format ${price.suspect.length}, unsigned ${price.unsigned.length})` : null, got.ok && !b1 ? 'no refurbished fact' : null].filter(Boolean).join('; ');
      rec({ ...base, looked: true, lookOk: got.ok, reason: got.ok ? null : got.reason, attempts: got.attempts, answers: attempts, mapping: got.ok ? got.mapping : null, kept: got.ok ? got.look.facts : [], dropped: got.ok ? got.look.dropped : [], priceRows: price.rows, otherCurrency: price.otherCurrency, over: price.over, suspect: price.suspect, unsigned: price.unsigned, refurbFacts: refurb, qualified, why, cost, costUnpriced: unpriced, tokens, seconds, spentSoFar: spent });
      console.log(`  #${n} ${host}: rows=${price.rows.length} refurb=${refurb.length} qualified=${qualified} cost=$${cost.toFixed(5)} spent=$${spent.toFixed(4)}`);
      if (unpriced) { stop = 'an unpriced round: batch stopped, never priced as 0'; rec({ kind: 'stop', stop }); break; }
    }
  }
  rec({ kind: 'done', looks, spent, stop, dry });
  closeSync(fd);
  console.log(`done: ${looks} looks, spent $${spent.toFixed(5)}${stop ? `, STOPPED: ${stop}` : ''}; ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
