// F212 scorer: node poc/f205-search/score212.mjs <tag>   (bars as pre-registered; arm A scored, arm C reported)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath212, SITES } from './run212.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score212.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath212(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath212(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'read');
const f = (x) => (x ? `ok=${x.ok} chars=${x.chars} usd=${x.usd} eur=${x.eur} product=${x.product} landing=${x.landing ?? '-'} hostDiffers=${x.hostDiffers}${x.ok ? '' : ` | ${String(x.error).slice(0, 100)}`}` : 'not read');
let pass = 0;
for (const s of SITES) {
  const A = rows.find((r) => r.site === s.id && r.arm === 'A'); const C = rows.find((r) => r.site === s.id && r.arm === 'C');
  const ok = !!A && A.ok && A.product >= 5 && A.usd > A.eur;
  if (ok) pass += 1;
  console.log(`${s.id}: ${ok ? 'PASS' : 'FAIL'}\n   A ${f(A)}\n   C ${f(C)} (reported only)`);
  if (ok) for (const q of A.quotes) console.log(`   quote: ${q}`);
}
console.log(`sites PASS ${pass} of ${SITES.length} (bar >= 3 of 6); VERDICT: ${pass >= 3 ? 'GO' : 'NO-GO'}`);
