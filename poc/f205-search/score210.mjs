// F210 scorer: node poc/f205-search/score210.mjs <tag>   (bars as pre-registered; C against A; Z not run)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath210 } from './run210.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score210.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath210(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const all = readFileSync(resultsPath210(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const reads = all.filter((r) => r.kind === 'read');
const ns = [...new Set(reads.map((r) => r.n))];
const f = (x) => (x ? `ok=${x.ok} chars=${x.chars} dollar=${x.dollar} spec=${x.spec} ${x.seconds.toFixed(1)}s` : 'none');
const both = [];
for (const n of ns) {
  const A = reads.find((r) => r.n === n && r.arm === 'A'); const C = reads.find((r) => r.n === n && r.arm === 'C');
  console.log(`#${n} ${A?.url}\n   A ${f(A)}\n   C ${f(C)}${C && !C.ok ? ` | ${String(C.error).slice(0, 80)}` : ''}`);
  if (A?.ok && C?.ok) both.push({ A, C });
}
const N = both.length;
const b1n = both.filter(({ A, C }) => C.chars >= 1.5 * A.chars).length;
const b2n = both.filter(({ A, C }) => C.dollar + C.spec >= A.dollar + A.spec).length;
const totA = both.reduce((t, { A }) => t + A.dollar + A.spec, 0); const totC = both.reduce((t, { C }) => t + C.dollar + C.spec, 0);
const b1 = N > 0 && b1n / N >= 0.7;
const b2 = N > 0 && b2n / N >= 0.8 && totC >= 1.5 * totA;
console.log(`pages both arms read ok: ${N} of ${ns.length}`);
console.log(`Bar 1: C >= 1.5x A chars on ${b1n} of ${N} (${N ? Math.round((100 * b1n) / N) : 0}%, bar 70%): ${b1 ? 'PASS' : 'FAIL'}`);
console.log(`Bar 2: C dollar+spec >= A on ${b2n} of ${N} (${N ? Math.round((100 * b2n) / N) : 0}%, bar 80%); totals A ${totA} C ${totC} (${totA ? (totC / totA).toFixed(2) : 'n/a'}x, bar 1.5x): ${b2 ? 'PASS' : 'FAIL'}`);
const secs = (arm) => reads.filter((r) => r.arm === arm).reduce((t, r) => t + r.seconds, 0);
console.log(`read seconds: A ${secs('A').toFixed(0)}  C ${secs('C').toFixed(0)}`);
for (const arm of ['A', 'C']) { console.log(`up to 3 product-name + $ lines, arm ${arm} (reported only):`); for (const l of reads.filter((r) => r.arm === arm).flatMap((r) => r.named).slice(0, 3)) console.log(`   ${l}`); }
console.log('Z: not run (barebrowse 0.28.0 has no default pick for `within`)');
console.log(`VERDICT C: ${b1 && b2 ? 'GO' : 'NO-GO'}`);
