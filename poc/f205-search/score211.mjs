// F211 scorer (a marked copy of score208.mjs without the rule 2 part: the job has one rule): node poc/f205-search/score211.mjs <tag>
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath211 } from './run211.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score211.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath211(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath211(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = rows.find((r) => r.kind === 'done');
const samples = [...new Set(rows.filter((r) => r.kind === 'search').map((r) => r.sample))];
let pass = 0;
for (const s of samples) {
  const pages = rows.filter((r) => r.kind === 'page' && r.sample === s);
  const byHost = {};
  for (const p of pages) { const h = (byHost[p.host ?? '?'] ??= { read: false, rows: 0, other: 0, over: 0, unsigned: 0, cost: 0 }); h.read ||= p.ok; h.rows += p.priceRows?.length ?? 0; h.other += p.otherCurrency?.length ?? 0; h.over += p.over?.length ?? 0; h.unsigned += p.unsigned?.length ?? 0; h.cost += p.cost ?? 0; }
  const hosts = Object.entries(byHost).filter(([, v]) => v.rows >= 1).length;
  const ok = hosts >= 2; if (ok) pass += 1;
  console.log(`sample ${s}: hosts with >=1 price row ${hosts}; ${ok ? 'PASS' : 'FAIL'}`);
  for (const [h, v] of Object.entries(byHost)) console.log(`   ${h}: read ${v.read ? 'ok' : 'NO'}; price rows ${v.rows}; other-currency ${v.other}; over ${v.over}; unsigned ${v.unsigned}; cost $${v.cost.toFixed(5)}`);
}
const looks = rows.filter((r) => r.kind === 'page' && r.looked);
const total = looks.reduce((t, r) => t + (r.cost ?? 0), 0);
const secs = looks.reduce((t, r) => t + (r.seconds ?? 0), 0);
console.log(`looks ${looks.length}; total cost $${total.toFixed(5)}${looks.length ? `; per look $${(total / looks.length).toFixed(5)}` : ''}; look seconds ${secs.toFixed(0)}${done?.stop ? `; STOPPED: ${done.stop}` : ''}`);
const reasons = {};
for (const p of looks) for (const d of p.dropped ?? []) { const k = `${p.host}: ${d.reason}${d.word !== undefined ? ` ${JSON.stringify(d.word)}` : ''}`; reasons[k] = (reasons[k] ?? 0) + 1; }
console.log('dropped reasons per host:');
for (const [k, v] of Object.entries(reasons).sort()) console.log(`   ${k} x${v}`);
const verdict = samples.length === 5 && pass >= 3;
console.log(`samples PASS ${pass} of ${samples.length} (bar >= 3 of 5); VERDICT: ${verdict ? 'PASS' : 'FAIL'}`);
