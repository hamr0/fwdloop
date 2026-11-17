// F209 scorer: node poc/f205-search/score209.mjs <tag>   (bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath209, PAGES } from './run209.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score209.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath209(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath209(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'read');
const get = (id, arm) => rows.find((r) => r.page === id && r.arm === arm);
const more2 = (b, a) => (a === 0 ? b > 0 : b >= 2 * a);
let b1n = 0;
for (const pg of PAGES) {
  const A = get(pg.id, 'A'); const B = get(pg.id, 'B'); const C = get(pg.id, 'C');
  if (!A || !B) continue;
  const keeps = B.ok && A.ok && B.chars >= 2 * A.chars || (B.ok && !A.ok && B.chars > 0);
  if (keeps) b1n += 1;
  const f = (x) => (x ? `ok=${x.ok} chars=${x.chars} brand=${x.brand} spec=${x.spec} dollar=${x.dollar}` : 'not read');
  console.log(`${pg.id}: B keeps >=2x A chars: ${keeps ? 'yes' : 'no'}\n   A ${f(A)}\n   B ${f(B)}${B.ok ? '' : ` | ${String(B.error).slice(0, 80)}`}\n   C ${f(C)} (reported only)`);
}
const b1 = b1n >= 6;
console.log(`Bar 1: B ok and >=2x A chars on ${b1n} of ${PAGES.length} pages (bar >= 6): ${b1 ? 'PASS' : 'FAIL'}`);
let b2 = true;
for (const id of ['pcworld', 'tomshardware']) {
  const A = get(id, 'A'); const B = get(id, 'B');
  const ok = !!A && !!B && B.ok && more2(B.brand, A.brand) && more2(B.spec, A.spec);
  if (!ok) b2 = false;
  console.log(`Bar 2 ${id}: brand A ${A?.brand} B ${B?.brand}; spec A ${A?.spec} B ${B?.spec}: ${ok ? 'ok' : 'no'}`);
}
console.log(`Bar 2: ${b2 ? 'PASS' : 'FAIL'}`);
const pw = get('pcworld', 'B');
if (pw?.pageFile && existsSync(pw.pageFile)) {
  const lines = readFileSync(pw.pageFile, 'utf8').split('\n').filter((l) => /\$\d/.test(l));
  console.log(`pcworld B dollar lines ${lines.length} (reported only); up to 3:`);
  for (const l of lines.slice(0, 3)) console.log(`   ${l.slice(0, 200)}`);
}
console.log(`VERDICT: ${b1 && b2 ? 'GO' : 'NO-GO'}`);
