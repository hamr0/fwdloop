// F201 scorer: node poc/f201-lookprompt/score.mjs --tag <name>   Bars: docs/logs/FINDINGS.md "F201" (pre-registered).
import fs from 'node:fs';
import path from 'node:path';
import { CASES } from './cases.mjs';

const i = process.argv.indexOf('--tag'); const tag = process.argv[i + 1];
const file = path.resolve(import.meta.dirname, `../../.claude/scratch/f201/results-${tag}.jsonl`);
if (i < 0 || !fs.existsSync(file)) { console.error(`no results for tag ${tag}`); process.exit(1); }
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const key = (r) => `${r.ref?.line}:${r.ref?.rule}`;
const T = { A: { nonsense: 0, kept: 0, cost: 0, looks: 0, unreadable: 0, unpriced: 0 }, B: { nonsense: 0, kept: 0, cost: 0, looks: 0, unreadable: 0, unpriced: 0 } };
const per = {}; const newTies = [];
for (const r of rows) {
  const c = CASES.find((x) => x.id === r.case); const t = T[r.arm];
  const p = (per[`${r.case}|${r.arm}`] ??= { looks: 0, nonsense: 0, kept: 0, expected: 0, unreadable: 0, cannot: 0, cost: 0 });
  p.looks += 1; t.looks += 1;
  if (!r.ok) { p.unreadable += 1; t.unreadable += 1; }
  if (!r.priced) t.unpriced += 1; else { p.cost += r.costUsd; t.cost += r.costUsd; }
  const tied = new Set(r.facts.filter((f) => f.ref && f.ref.rule !== null).map(key));
  if (c.nonsense.some((n) => tied.has(n))) { p.nonsense += 1; if (c.id.startsWith('c1')) t.nonsense += 1; }
  { const k = c.expect.filter((e) => tied.has(e)).length; p.kept += k; if (!c.id.startsWith('c1')) t.kept += k; }
  p.expected += c.expect.length; p.cannot += r.cannot.length;
  for (const f of r.facts) if (f.ref && f.ref.rule !== null && !c.expect.includes(key(f)) && !c.nonsense.includes(key(f))) newTies.push({ arm: r.arm, case: r.case, sample: r.sample, from: f.from, name: f.name, shape: f.shape, words: f.words, why: f.why });
}
const f = (x) => x.toFixed(4);
console.log(`tag ${tag}: ${rows.length} looks\n`);
console.log('case | arm | looks | nonsense(~ be friendly) | kept/expected(non-c1: sum over looks) | unreadable | cannot items | cost');
for (const [k, p] of Object.entries(per)) console.log(`${k.replace('|', ' | ')} | ${p.looks} | ${p.nonsense} | ${p.kept}/${p.expected} | ${p.unreadable} | ${p.cannot} | $${f(p.cost)}`);
console.log('\nper arm:'); for (const a of ['A', 'B']) console.log(`${a}: looks ${T[a].looks}, NONSENSE(c1) ${T[a].nonsense}, KEPT(c2-4) ${T[a].kept}, unreadable ${T[a].unreadable}, unpriced ${T[a].unpriced}, COST $${f(T[a].cost)}`);
const eq = T.A.looks === T.B.looks; 
const b1 = T.A.nonsense === 0 ? 'INCONCLUSIVE (A count 0: the test cannot tell the arms apart)' : T.B.nonsense < T.A.nonsense ? 'PASS' : 'FAIL';
const b2 = T.B.kept >= T.A.kept - 1 ? 'PASS' : 'FAIL';
const b3 = T.B.cost <= T.A.cost * 1.2 ? 'PASS' : 'FAIL';
console.log(`\nbar (1) NONSENSE B ${T.B.nonsense} < A ${T.A.nonsense}: ${b1}\nbar (2) KEPT B ${T.B.kept} >= A ${T.A.kept} - 1: ${b2}\nbar (3) COST B $${f(T.B.cost)} <= A $${f(T.A.cost)} x 1.2: ${b3}`);
console.log(`overall: ${b1 === 'PASS' && b2 === 'PASS' && b3 === 'PASS' ? 'PASS' : b1.startsWith('INCONCLUSIVE') ? 'INCONCLUSIVE (bar 1)' : 'FAIL'}${eq ? '' : ' (arms have unequal look counts: the run stopped early)'}`);
console.log(`\nnew ties not in the expected list (${newTies.length}), for hand labelling, not scored:`);
const seen = new Map(); for (const n of newTies) { const k = `${n.arm}|${n.case}|${n.from}|${JSON.stringify(n.words)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
for (const [k, n] of seen) console.log(`  x${n} ${k}`);
