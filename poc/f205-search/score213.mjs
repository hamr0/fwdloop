// F213 scorer: node poc/f205-search/score213.mjs <tag>   (bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resultsPath213 } from './run213.mjs';
import { SCRATCH } from './run.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score213.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath213(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rd = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rows = rd(resultsPath213(tag));
const searches = rows.filter((r) => r.kind === 'search'); const fetches = rows.filter((r) => r.kind === 'fetch'); const done = rows.find((r) => r.kind === 'done');
for (const s of searches) console.log(`search q${s.q} "${s.query}": status ${s.status} urls ${s.urls.length} ${s.seconds.toFixed(1)}s${s.error ? ` | ${s.error}` : ''}`);
for (const f of fetches) console.log(`fetch q${f.q}-${f.k}: status ${f.status} ok=${f.ok} chars=${f.chars} usd=${f.usd} eur=${f.eur} challenge=${f.challenge} ${f.seconds.toFixed(1)}s ${f.url.slice(0, 80)}${f.error ? ` | ${String(f.error).slice(0, 70)}` : ''}`);
const b1n = searches.filter((s) => s.urls.length >= 5).length; const b1 = b1n >= 2;
const good = fetches.filter((f) => f.ok && f.chars >= 1000 && f.challenge === 0).length;
const b2 = fetches.length > 0 && good / fetches.length >= 0.6;
const usd = fetches.reduce((t, f) => t + f.usd, 0); const eur = fetches.reduce((t, f) => t + f.eur, 0);
const q3 = fetches.filter((f) => f.q === 3 && f.usd >= 3).length;
const b3 = usd > eur && q3 >= 2;
console.log(`Bar 1: ${b1n} of ${searches.length} searches with >= 5 URLs (bar >= 2 of 3): ${b1 ? 'PASS' : 'FAIL'}`);
console.log(`Bar 2: ${good} of ${fetches.length} fetches ok, >= 1000 chars, 0 challenge lines (${fetches.length ? Math.round((100 * good) / fetches.length) : 0}%, bar 60%): ${b2 ? 'PASS' : 'FAIL'}`);
console.log(`Bar 3: usd lines ${usd} vs eur lines ${eur}; query 3 pages with >= 3 usd lines: ${q3} (bar >= 2): ${b3 ? 'PASS' : 'FAIL'}`);
// reported, not scored: chars next to F210 / F211 read-mode chars for the same URL
const known = new Map();
for (const r of rd(join(SCRATCH, 'results-f210-r1.jsonl'))) if (r.kind === 'read' && r.arm === 'C' && r.ok) known.set(r.url, `F210 read ${r.chars}`);
for (const r of rd(join(SCRATCH, 'results-f211-p1.jsonl'))) if (r.kind === 'page' && r.ok && r.landing) known.set(r.landing, `F211 read ${r.chars}`);
for (const f of fetches) if (known.has(f.url)) console.log(`   same URL as ${known.get(f.url)}: Fetch ${f.chars}  ${f.url.slice(0, 70)}`);
for (const q of [1, 2, 3]) { const l = fetches.filter((f) => f.q === q).flatMap((f) => f.usdQuotes ?? []).slice(0, 2); if (l.length) { console.log(`up to 2 usd lines, query ${q}:`); l.forEach((x) => console.log(`   ${x}`)); } }
console.log(`spent $${(done?.spent ?? 0).toFixed(5)}${done?.stop ? `; STOPPED: ${done.stop}` : ''}`);
console.log(`VERDICT: ${b1 && b2 && b3 ? 'GO' : 'NO-GO'}`);
