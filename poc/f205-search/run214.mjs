// F214 harness (docs/logs/FINDINGS.md "F214 PRE-REGISTRATION" + "AMENDMENT 1"). PAID (hard cap $0.25, no model call from spent $0.20) unless --dry. Never prints the key.
// Search + Fetch: node's built-in fetch (callApi, run213.mjs). The model call is a marked POC copy of src/model-step.js makeLiveModelStep's call (one forced emit_artifact tool).
// usage: DEEPSEEK_API_KEY=... node poc/f205-search/run214.mjs --tag <tag> [--dry] [--dry-break] [--samples N]
import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Loop, HaltError } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { DRAFT_MAX_TOKENS } from '../../src/drafter.js';
import { makeProvider, readPriceConfig, resolveUsableModel, checkKeyPreflight } from '../../src/provider.js';
import { SCRATCH } from './run.mjs';
import { callApi, PRICE_USD } from './run213.mjs';

export const resultsPath214 = (tag) => join(SCRATCH, `results-f214-${tag}.jsonl`);
export const pagesDir214 = join(SCRATCH, 'f214-pages');
export const SLOT = 'DEEPSEEK_API_KEY';
export const MODEL = 'deepseek-flash';
export const STOP_AT_USD = 0.20;
export const CAP_USD = 0.25;
export const JOBS = [
  { q: 1, search: 'best budget laptop 2026', line: 'find the best budget laptops for 2026', rule: 'under $500', limit: 500 },
  { q: 2, search: 'best robot vacuum under $400', line: 'find the best robot vacuums under $400', rule: 'under $400', limit: 400 },
  { q: 3, search: 'lenovo refurbished laptop', line: 'find lenovo refurbished laptops', rule: 'under $500', limit: 500 },
];
/** the job line exactly as the real parser keeps it (the goal of a step is the signed line verbatim) */
export const goalOf = (job) => { const p = parseSignedText(`1. ${job.line},\n   guardrail: ${job.rule}\n2. ask 30m: check it with me,\n3. write it out.\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $0.25 per run\nguardrail: send at line 3 to file:poc/m0/out\nguardrail: source page = page:https://example.test/x\n`); if (!p.ok) throw new Error(`job did not parse: ${p.reds.join('; ')}`); return p.lines[0].text; };
/** POC rule (not a product rule): scheme + host + path, no query string, no #hash */
export const canonical = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname}`; } catch { return u; } };
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
export const norm = (t) => String(t ?? '').replace(/[\s ]+/g, ' ').trim();

export const SYSTEM = 'You are executing one step of a signed, human-authored automation. Call emit_artifact exactly once with this step\'s result. Ground every value in the reads you were handed or the tools you were granted — never invent a figure.';
export const QUOTING = 'Give one row for each item on the page that fits the goal: name = the item\'s name, price = the price as the page writes it, quote = the exact sentence or line from the page that holds the name and the price, copied character for character. Give no row for an item the page does not price. If the page holds none, give an empty rows list and say why in blocker.';
export const SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' }, quote: { type: 'string' } }, required: ['name', 'price', 'quote'] } }, done: { type: 'boolean' }, blocker: { type: ['string', 'null'] } }, required: ['rows', 'done', 'blocker'], additionalProperties: false };
export const NUDGE = 'You answered in text. Call emit_artifact now with that answer; do not reply in text.';

/** the code check of one row (reasons as pre-registered) */
export function checkRow(row, pageText, limit) {
  const page = norm(pageText); const quote = norm(row?.quote); const price = norm(row?.price);
  if (quote === '' || !page.includes(quote)) return 'quote-not-on-page';
  if (price === '' || !quote.includes(price)) return 'price-not-in-quote';
  const num = /(\d[\d,]*(?:\.\d+)?)/.exec(price);
  if (!num) return 'unreadable-price';
  if (/[€£]|EUR|GBP/i.test(price) || !(/\$/.test(price) || /USD/i.test(price))) return 'not-usd';
  const amount = Number(num[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return 'unreadable-price';
  return amount < limit ? 'pass' : 'over-limit';
}

/** ONE model call (marked copy of makeLiveModelStep's: Loop + onLlmResult, forced emit_artifact on round 1, a nudge round 2; maxTokens 16000, thinking off). */
async function modelCall({ provider, rates, goal, pageText }) {
  const user = JSON.stringify({ goal, reads: { page: pageText }, quoting: QUOTING });
  /** @type {any} */ let captured = null; const events = []; const answers = [];
  const tool = { name: 'emit_artifact', description: 'Emit this step\'s result.', parameters: SCHEMA, execute: async (a) => { captured = a; throw new HaltError('emit_artifact captured', { rule: 'captured' }); } };
  let messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
  for (let round = 1; round <= 2 && captured === null; round += 1) {
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
    let res; let threw = null;
    try { res = await loop.run(messages, [tool], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: 'off', toolChoice: { name: 'emit_artifact' } }); } catch (e) { threw = e; }
    answers.push({ round, text: typeof res?.text === 'string' ? res.text.slice(0, 2000) : null, stopReason: res?.stopReason ?? null, error: threw && !(captured && threw instanceof HaltError) ? String(threw.message ?? threw).slice(0, 200) : null });
    if (captured === null) messages = [...messages, { role: 'assistant', content: res?.text ?? '' }, { role: 'user', content: NUDGE }];
  }
  const unpriced = events.length === 0 || events.some((e) => typeof e.costUsd !== 'number');
  const cost = events.reduce((t, e) => t + (typeof e.costUsd === 'number' ? e.costUsd : 0), 0);
  const tokens = events.reduce((t, e) => ({ in: t.in + (e.usage?.inputTokens ?? 0), out: t.out + (e.usage?.outputTokens ?? 0) }), { in: 0, out: 0 });
  return { captured, answers, unpriced, cost, tokens, rounds: events.length };
}

function fakeFetch(brk) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const res = (obj, status = 200) => ({ status, text: async () => JSON.stringify(obj) });
    if (url.endsWith('/search')) return res({ results: [0, 1, 2, 3, 4].map((i) => ({ title: `T${i}`, url: `https://shop${i === 4 ? 0 : i}.example.com/p?utm=${i}#${i}`, snippet: 's', summary: 'x', content: '' })) });
    return res({ title: 'T', content: `# Deals\n${Array.from({ length: 6 }, (_, i) => `- Lenovo ThinkPad T${i} refurbished 16GB, $${300 + i * 50} with free shipping and a long description line`).join('\n')}\n${'padding '.repeat(30)}\n` });
  };
}
function fakeProvider(brk) {
  return {
    lastMalformedToolCall: null,
    async generate(messages) {
      const user = JSON.parse(messages.find((m) => m.role === 'user' && m.content.startsWith('{')).content);
      const lines = user.reads.page.split('\n').filter((l) => /\$\d/.test(l));
      const rows = brk
        ? [{ name: 'Made Up 9000', price: '$99', quote: 'The Made Up 9000 laptop costs $99 at a store that is not on the page' }]
        : lines.map((l) => ({ name: 'Lenovo ThinkPad', price: /\$\d+/.exec(l)[0], quote: l.replace(/^- /, '') }));
      return { text: '', toolCalls: [{ id: 'c1', name: 'emit_artifact', arguments: { rows, done: true, blocker: null } }], usage: { inputTokens: 900, outputTokens: 120 }, stopReason: 'tool_calls', model: 'fake' };
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(n);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tag = val('--tag');
  if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: run214.mjs --tag <tag> [--dry] [--dry-break] [--samples N]'); process.exit(2); }
  const dry = flag('--dry');
  const samples = val('--samples') ? Number(val('--samples')) : 2;
  let provider; let rates; let key = process.env.DEEPSEEK_API_KEY ?? '';
  if (dry) {
    const u = resolveUsableModel(SLOT, { config: readPriceConfig(), model: MODEL });
    if (!u.ok) { console.error(u.say); process.exit(2); }
    ({ rates } = u); provider = fakeProvider(flag('--dry-break')); key = 'dry-key';
  } else {
    const k = checkKeyPreflight(SLOT, process.env);
    if (!k.ok) { console.error(`REFUSED at $0: ${k.message}`); process.exit(2); }
    ({ provider, rates } = makeProvider(SLOT, { model: MODEL, ...LIVE_PROVIDER_OPTIONS }));
  }
  mkdirSync(SCRATCH, { recursive: true });
  const file = resultsPath214(tag);
  if (existsSync(file)) { console.error(`refused: ${file} already has results for tag "${tag}"; use a new tag`); process.exit(2); }
  const fd = openSync(file, 'wx');
  mkdirSync(pagesDir214, { recursive: true });
  const rec = (row) => writeSync(fd, JSON.stringify(row) + '\n');
  const doFetch = dry ? fakeFetch(flag('--dry-break')) : fetch;
  const gap = (ms) => (dry ? Promise.resolve() : sleep(ms));
  rec({ kind: 'config', apiPrice: PRICE_USD, stop: STOP_AT_USD, cap: CAP_USD, dry, note: 'canonical URL = scheme+host+path (POC rule); model call = marked copy of makeLiveModelStep call' });
  let spent = 0; let stop = null; let first = true;
  const apiCost = (r, billed) => (!r.billingKnown ? PRICE_USD : billed ? PRICE_USD : 0);

  for (let s = 1; s <= samples && stop === null; s += 1) {
    for (const job of JOBS) {
      if (stop) break;
      const goal = goalOf(job);
      if (!first) await gap(2_000); first = false;
      const sr = await callApi(doFetch, key, '/v1/tools/search', { query: job.search, count: 5 });
      const results = Array.isArray(sr.json?.results) ? sr.json.results : [];
      const billedS = sr.status === 200 && results.length > 0; spent += apiCost(sr, billedS);
      const urls = []; const seen = new Set();
      for (const u of results.map((x) => x?.url).filter((u) => typeof u === 'string')) { const c = canonical(u); if (!seen.has(c)) { seen.add(c); urls.push(u); } }
      rec({ kind: 'search', sample: s, q: job.q, status: sr.status, ok: billedS, error: sr.error, urlsRaw: results.length, urls, seconds: sr.seconds, billingUnknown: !sr.billingKnown });
      console.log(`sample ${s} q${job.q}: search status=${sr.status} results=${results.length} canonical=${urls.length}${sr.error ? ` | ${sr.error}` : ''}`);
      if (!sr.billingKnown) { stop = `search s${s} q${job.q}: billing unknown (${sr.error})`; break; }
      let k = 0;
      for (const url of urls) {
        k += 1; await gap(2_000);
        const fr = await callApi(doFetch, key, '/v1/tools/fetch', { url });
        const content = typeof fr.json?.content === 'string' ? fr.json.content : '';
        const billedF = fr.status === 200 && content !== ''; spent += apiCost(fr, billedF);
        let pageFile = null;
        if (content) { pageFile = join(pagesDir214, `${tag}-s${s}-q${job.q}-${k}.txt`); writeFileSync(pageFile, content, { flag: 'wx' }); }
        const base = { sample: s, q: job.q, k, url, host: hostOf(url), fetchStatus: fr.status, fetchOk: billedF, fetchError: fr.error, chars: content.length, pageFile };
        if (!fr.billingKnown) { rec({ kind: 'fetch', ...base, billingUnknown: true }); stop = `fetch s${s} q${job.q}-${k}: billing unknown (${fr.error})`; break; }
        if (!billedF) { rec({ kind: 'fetch', ...base, called: false }); console.log(`  ${base.host} fetch status=${fr.status} (no model call)`); continue; }
        if (spent >= STOP_AT_USD) { stop = `spent $${spent.toFixed(4)} >= $${STOP_AT_USD}`; rec({ kind: 'fetch', ...base, called: false, stop }); break; }
        const t0 = Date.now();
        const m = await modelCall({ provider, rates, goal, pageText: content });
        const seconds = (Date.now() - t0) / 1000;
        spent += m.cost;
        const claimed = Array.isArray(m.captured?.rows) ? m.captured.rows : [];
        const verdicts = claimed.map((r) => ({ name: r?.name ?? null, price: r?.price ?? null, quote: String(r?.quote ?? '').slice(0, 300), reason: checkRow(r, content, job.limit) }));
        rec({ kind: 'call', ...base, called: true, goal, limit: job.limit, answers: m.answers, captured: m.captured !== null, done: m.captured?.done ?? null, blocker: m.captured?.blocker ?? null, rowsClaimed: claimed.length, verdicts, cost: m.cost, costUnpriced: m.unpriced, tokens: m.tokens, rounds: m.rounds, seconds, spentSoFar: spent });
        console.log(`  ${base.host} chars=${content.length} rows=${claimed.length} pass=${verdicts.filter((v) => v.reason === 'pass').length} cost=$${m.cost.toFixed(5)} spent=$${spent.toFixed(4)}${m.captured === null ? ' (no emit_artifact)' : ''}`);
        if (m.unpriced) { stop = 'an unpriced round: batch stopped, never priced as 0'; rec({ kind: 'stop', stop }); break; }
        if (spent >= CAP_USD) { stop = `cap $${CAP_USD} reached`; break; }
      }
    }
  }
  rec({ kind: 'done', spent, stop, dry });
  closeSync(fd);
  console.log(`done: spent $${spent.toFixed(5)}${stop ? `, STOPPED: ${stop}` : ''}; ${file}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
