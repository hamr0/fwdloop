// F97 scorer: reads <work>/draft-*/declaration.json, scores D1-D6 on the letter. Usage: node score.mjs <work-dir> -> prints JSON, writes <work>/score.json
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const work = process.argv[2];
const jobs = ['a', 'b', 'c', 'd'];
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lc = (a) => (a ?? []).map((v) => String(v).toLowerCase());
const S = { drafts: {}, D: {} };
let spend = 0.0114; // smoke
for (const j of jobs) for (const n of [1, 2, 3]) {
  const d = join(work, `draft-${j}${n}`);
  const rec = { exists: existsSync(join(d, 'declaration.json')) };
  if (existsSync(join(d, 'draft-spend.json'))) { rec.cost = rd(join(d, "draft-spend.json")).costUsd; spend += rec.cost ?? 0; }
  if (existsSync(join(d, 'log.json'))) { const l = rd(join(d, 'log.json')); rec.ok = l.ok; rec.reds = l.reds; rec.rounds = l.rounds; }
  if (rec.exists) {
    const dec = rd(join(d, 'declaration.json'));
    rec.boxes = dec.ticketFilter ?? null; rec.classes = dec.guardrailClasses; rec.unjudgeable = dec.unjudgeable;
    rec.steps = dec.steps.map((s) => ({ line: s.fromLine, prim: s.primitives, reads: s.reads, cls: s.close?.class }));
  }
  S.drafts[j + n] = rec;
}
const boxOn = (r, line) => (r.boxes ?? []).find((b) => b.fromLine === line);
const count = (j, f) => [1, 2, 3].filter((n) => S.drafts[j + n].exists && f(S.drafts[j + n])).length;
// D1
const d1 = {
  'a.priority(line1: allowed==[P2], values cover P0..P3)': count('a', (r) => { const b = boxOn(r, 1); return b && JSON.stringify(b.allowed.map((v) => v.toUpperCase())) === '["P2"]' && ['P0', 'P1', 'P2', 'P3'].every((p) => b.values.map((v) => v.toUpperCase()).includes(p)); }),
  'a.topic(line2: allowed names crash and hang)': count('a', (r) => { const b = boxOn(r, 2); const t = lc(b?.allowed).join('|'); return b && /crash/.test(t) && /hang/.test(t); }),
  'b.topic(line1: allowed names network outage)': count('b', (r) => { const b = boxOn(r, 1); const t = lc(b?.allowed).join('|'); return b && /network/.test(t); }),
};
S.D.D1 = { counts: d1, verdict: Object.values(d1).every((v) => v >= 2) ? 'PASS' : 'FAIL' };
// D2
const withBox = Object.entries(S.drafts).filter(([, r]) => r.boxes?.length);
const d2bad = withBox.filter(([, r]) => r.boxes.some((b) => b.values[b.values.length - 1] !== 'unsure' || b.allowed.includes('unsure'))).map(([k]) => k);
S.D.D2 = { draftsWithBox: withBox.length, bad: d2bad, verdict: withBox.length > 0 && d2bad.length === 0 ? 'PASS' : 'FAIL' };
// D3
const d3 = [1, 2, 3].map((n) => { const r = S.drafts['d' + n]; return r.exists && !(r.boxes?.length) && r.classes?.['1'] === 'hitl'; });
S.D.D3 = { perDraft: d3, verdict: d3.every(Boolean) ? 'PASS' : 'FAIL' };
// D4: boxes only on the which-tickets guardrail lines of the job (a:1,2  b:1  c:1,2  d:1); never 3 (words), 4 (ask), 5, or a line without guardrail
const lines = { a: [1, 2], b: [1], c: [1, 2], d: [1] };
const d4bad = [];
for (const [k, r] of Object.entries(S.drafts)) for (const b of r.boxes ?? []) if (!lines[k[0]].includes(b.fromLine)) d4bad.push(`${k}: box ${b.box} on line ${b.fromLine}`);
S.D.D4 = { bad: d4bad, verdict: d4bad.length === 0 && Object.values(S.drafts).every((r) => r.exists) ? 'PASS' : 'FAIL' };
// D5: validator green (ok true, no reds), ask still an ask (line 4: prim [], hitl), step for line 1 reads issue, no get anywhere, write only on line 5
const d5bad = [];
for (const [k, r] of Object.entries(S.drafts)) {
  if (!r.exists || r.ok !== true || (r.reds ?? []).length) { d5bad.push(`${k}: not green`); continue; }
  const ask = r.steps.filter((s) => s.line === 4);
  if (ask.length !== 1 || ask[0].prim.length || ask[0].cls !== 'hitl') d5bad.push(`${k}: ask not a pure stop`);
  const s1 = r.steps.find((s) => s.line === 1);
  if (!s1 || !s1.reads.includes('issue')) d5bad.push(`${k}: step 1 does not read issue`);
  if (r.steps.some((s) => s.prim.includes('get'))) d5bad.push(`${k}: get granted`);
  if (r.steps.some((s) => s.line !== 5 && s.prim.some((p) => p === 'write' || p === 'edit'))) d5bad.push(`${k}: write before the send`);
}
S.D.D5 = { bad: d5bad, verdict: d5bad.length === 0 ? 'PASS' : 'FAIL' };
S.D.D6 = { spendIncludingSmoke: Number(spend.toFixed(6)), verdict: spend < 0.10 ? 'PASS' : 'FAIL' };
// recorded, not judged
S.recorded = Object.fromEntries(Object.entries(S.drafts).map(([k, r]) => [k, { boxes: r.boxes, classes: r.classes, unjudgeable: r.unjudgeable, rounds: r.rounds, cost: r.cost }]));
writeFileSync(join(work, 'score.json'), JSON.stringify(S, null, 2));
console.log(JSON.stringify({ D: S.D }, null, 1));
