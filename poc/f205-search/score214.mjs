// F214 scorer: node poc/f205-search/score214.mjs <tag>   (bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath214, JOBS } from './run214.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score214.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath214(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath214(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const calls = rows.filter((r) => r.kind === 'call'); const done = rows.find((r) => r.kind === 'done');
const samples = [...new Set(rows.filter((r) => r.kind === 'search').map((r) => r.sample))];
let pass = 0; let total = 0;
for (const s of samples) for (const j of JOBS) {
  const cs = calls.filter((c) => c.sample === s && c.q === j.q);
  if (!rows.some((r) => r.kind === 'search' && r.sample === s && r.q === j.q)) continue;
  total += 1;
  const byHost = {};
  for (const c of cs) { const h = (byHost[c.host] ??= { claimed: 0, pass: 0 }); h.claimed += c.rowsClaimed; h.pass += c.verdicts.filter((v) => v.reason === 'pass').length; }
  const hosts = Object.values(byHost).filter((h) => h.pass >= 1).length;
  const ok = hosts >= 2; if (ok) pass += 1;
  console.log(`sample ${s} q${j.q} (limit $${j.limit}): hosts with >=1 pass row ${hosts}; ${ok ? 'PASS' : 'FAIL'}`);
  for (const [h, v] of Object.entries(byHost)) console.log(`   ${h}: claimed ${v.claimed}; pass ${v.pass}`);
}
const reasons = {}; let claimed = 0;
for (const c of calls) for (const v of c.verdicts) { reasons[v.reason] = (reasons[v.reason] ?? 0) + 1; claimed += 1; }
const passed = reasons.pass ?? 0;
console.log(`rows claimed ${claimed}; passed ${passed}; rejected ${claimed - passed}${claimed ? ` (${Math.round((100 * (claimed - passed)) / claimed)}% of claimed rows rejected by code)` : ''}`);
for (const [k, v] of Object.entries(reasons).sort()) console.log(`   ${k}: ${v}`);
const noEmit = calls.filter((c) => !c.captured).length;
const cost = calls.reduce((t, c) => t + (c.cost ?? 0), 0); const secs = calls.reduce((t, c) => t + (c.seconds ?? 0), 0);
console.log(`model calls ${calls.length} (no emit_artifact: ${noEmit}); model cost $${cost.toFixed(5)}${calls.length ? ` ($${(cost / calls.length).toFixed(5)} per call)` : ''}; seconds ${secs.toFixed(0)}; total spent incl. Search/Fetch $${(done?.spent ?? 0).toFixed(5)}${done?.stop ? `; STOPPED: ${done.stop}` : ''}`);
for (const j of JOBS) {
  const ps = calls.filter((c) => c.q === j.q).flatMap((c) => c.verdicts.filter((v) => v.reason === 'pass').map((v) => ({ host: c.host, ...v }))).slice(0, 3);
  if (ps.length) { console.log(`up to 3 passing rows, query ${j.q}:`); ps.forEach((p) => console.log(`   [${p.host}] ${p.name} | ${p.price} | ${p.quote.slice(0, 160)}`)); }
}
console.log(`query-samples PASS ${pass} of ${total} (bar >= 4 of 6); VERDICT: ${total === 6 && pass >= 4 ? 'PASS' : 'FAIL'}`);
