// F206 scorer: node poc/f205-search/score206.mjs <tag>   (bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath206 } from './run206.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score206.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath206(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath206(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const s = rows.filter((r) => r.kind === 'search'); const o = rows.filter((r) => r.kind === 'open');
const okS = s.filter((r) => r.ok);
const b1 = s.length === 5 && okS.length >= 4 && okS.every((r) => r.links.length >= 5);
console.log(`searches ${s.length}; read ok ${okS.length}; organic goto links per ok search: ${okS.map((r) => r.links.length).join(',')}; Bar 1 ${b1 ? 'PASS' : 'FAIL'}`);
const sum = (k) => s.reduce((t, r) => t + (r.excluded?.[k] ?? 0), 0);
console.log(`excluded (all searches): aclk ${sum('aclk')}; travelClk ${sum('travelClk')}; otherGoogle ${sum('otherGoogle')}`);
const good = o.filter((r) => r.landedOffGoogle && r.ok);
const b2 = o.length > 0 && good.length / o.length >= 0.6;
console.log(`opened ${o.length}; landed off Google ${o.filter((r) => r.landedOffGoogle).length}; read ok ${o.filter((r) => r.ok).length}; landed off Google AND ok ${good.length} (${o.length ? Math.round((100 * good.length) / o.length) : 0}%); Bar 2 (>=60%) ${b2 ? 'PASS' : 'FAIL'}`);
for (const q of [...new Set(o.map((r) => r.query))]) {
  console.log(`  ${q}:`);
  for (const r of o.filter((x) => x.query === q)) {
    let h = '?', p = ''; try { const u = new URL(r.landing); h = u.hostname; p = u.pathname; } catch { /* none */ }
    const lisbon = q.includes('Lisbon') ? ` lisbon-by-url=${/lisbo[an]|lisboa/i.test(h + p) ? 'yes' : 'no'}` : '';
    console.log(`    ${h}${p.slice(0, 50)} off=${r.landedOffGoogle} ok=${r.ok}${lisbon}${r.ok ? '' : ' | ' + (r.error ?? '').slice(0, 70)}`);
  }
}
console.log(`VERDICT: ${b1 && b2 ? 'GO' : 'NO-GO'}`);
