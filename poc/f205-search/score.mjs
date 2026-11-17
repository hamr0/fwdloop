// F205 scorer: node poc/f205-search/score.mjs <tag>   (reads .claude/scratch/f205/results-<tag>.jsonl; bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath } from './run.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let go = false;
for (const eng of ['google', 'duckduckgo', 'bing']) {
  const s = rows.filter((r) => r.kind === 'search' && r.engine === eng);
  const good = s.filter((r) => r.ok && r.links.length >= 5);
  const okReads = s.filter((r) => r.ok).length;
  const b1 = s.length === 5 && okReads >= 4 && good.length === okReads;
  console.log(`${eng}: searches ${s.length}; read ok ${okReads}; with >=5 links ${good.length}; Bar 1 (>=4 of 5 ok, each with >=5 links) ${b1 ? 'PASS' : 'FAIL'}`);
  if (!b1) continue;
  const o = rows.filter((r) => r.kind === 'open' && r.engine === eng);
  const ok = o.filter((r) => r.ok).length;
  const b2 = o.length > 0 && ok / o.length >= 0.6;
  console.log(`  opened ${o.length}; ok ${ok} (${o.length ? Math.round((100 * ok) / o.length) : 0}%); Bar 2 (>=60%) ${b2 ? 'PASS' : 'FAIL'}`);
  const byHost = {};
  for (const r of o.filter((x) => !x.ok)) { let h = '?'; try { h = new URL(r.url).hostname; } catch {} (byHost[h] ??= []).push(r.error); }
  for (const [h, errs] of Object.entries(byHost)) console.log(`    fail ${h}: ${errs.map((e) => e.slice(0, 90)).join(' / ')}`);
  if (b2) go = true;
}
console.log(`VERDICT: ${go ? 'GO' : 'NO-GO'}`);
