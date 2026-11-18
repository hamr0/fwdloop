// F215 scorer: node poc/f205-search/score215.mjs <tag>   (bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath215 } from './run215.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score215.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath215(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath215(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = rows.find((r) => r.kind === 'done');
const samples = [...new Set(rows.filter((r) => r.kind === 'search').map((r) => r.sample))];
let pass = 0; const winners = [];
for (const s of samples) {
  const pages = rows.filter((r) => r.kind === 'page' && r.sample === s);
  const win = pages.find((p) => p.qualified);
  if (win) { pass += 1; winners.push(win.landing); }
  console.log(`sample ${s}: ${win ? `PASS, luck depth ${win.n} (${win.host})  ${win.landing}` : 'FAIL'}; pages tried ${pages.length}`);
  if (win) for (const q of win.priceRows.slice(0, 2)) console.log(`   price row: ${q.quote.slice(0, 140)} | raw ${q.raw} value ${q.value}`);
  for (const p of pages.filter((x) => !x.qualified)) console.log(`   #${p.n} ${p.host}: ${p.why}${p.dropped?.length ? ` | dropped: ${[...new Set(p.dropped.map((d) => d.reason + (d.word !== undefined ? ` ${JSON.stringify(d.word)}` : '')))].join(', ')}` : ''}`);
}
const looks = rows.filter((r) => r.kind === 'page' && r.looked);
const total = looks.reduce((t, r) => t + (r.cost ?? 0), 0); const secs = looks.reduce((t, r) => t + (r.seconds ?? 0), 0);
console.log(`looks ${looks.length}; total cost $${total.toFixed(5)}${looks.length ? `; per look $${(total / looks.length).toFixed(5)}` : ''}; look seconds ${secs.toFixed(0)}${done?.stop ? `; STOPPED: ${done.stop}` : ''}`);
const same = winners.length > 1 && new Set(winners).size === 1;
console.log(`winning pages: ${winners.length ? `${new Set(winners).size} distinct among ${winners.length}${same ? ' (the same page wins every time)' : ''}` : 'none'}`);
console.log(`samples PASS ${pass} of ${samples.length} (bar >= 4 of 5); VERDICT: ${samples.length === 5 && pass >= 4 ? 'PASS' : 'FAIL'}`);
