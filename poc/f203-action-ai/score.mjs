// F203 scorer: node poc/f203-action-ai/score.mjs <tag>   (reads out/<tag>.jsonl; scores the FINAL row of each case/sample/ask)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score.mjs <tag>'); process.exit(2); }
const rows = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'out', `${tag}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const last = rows.find((r) => r.done) ?? {};
const finals = rows.filter((r) => r.case && r.final === true);
const allCalls = rows.filter((r) => r.case && !r.stop);
const spent = allCalls.reduce((s, r) => s + (r.cost ?? 0), 0);

const P = (s) => console.log(s);
let recRight = 0; let recTotal = 0; let minCase = 5;
let sugRight = 0; let sugTotal = 0;
let wrongLetThrough = 0; let refused = 0; let unreadable = 0; let nulls = 0;
const lets = [];
for (const c of CASES) {
  const rec = finals.filter((r) => r.case === c.id && r.ask === 'recognise');
  let right = 0;
  for (const r of rec) {
    const p = r.parsed ?? {};
    const lineRight = p.verdict === 'null' ? c.expected.line === null : (p.verdict === 'accepted' || p.verdict === 'refused') && p.line === c.expected.line;
    if (lineRight) right += 1;
    if (p.verdict === 'refused') refused += 1;
    if (p.verdict === 'unreadable') unreadable += 1;
    if (p.verdict === 'null') nulls += 1;
    // bar 3: code lets a wrong answer through = accepted on a no-action case, or accepted with the wrong `reads` on an action case.
    // A refused answer is caught by code; a null leads to SUGGEST; neither is let through.
    if (p.verdict === 'accepted' && (c.expected.line === null || p.reads !== c.expected.reads)) { wrongLetThrough += 1; lets.push(`${c.id}/s${r.sample} recognise ${JSON.stringify(r.raw)}`); }
  }
  recRight += right; recTotal += rec.length; if (rec.length) minCase = Math.min(minCase, right);
  let line = `${c.id} (${c.kind}, ${c.draft}) RECOGNISE ${right}/${rec.length}`;
  if (c.kind === 'none') {
    const sug = finals.filter((r) => r.case === c.id && r.ask === 'suggest');
    let sr = 0;
    for (const r of sug) {
      const p = r.parsed ?? {};
      if (p.verdict === 'accepted' && p.reads === c.expected.reads && p.oneLine) sr += 1;
      if (p.verdict === 'refused') refused += 1;
      if (p.verdict === 'unreadable') unreadable += 1;
      if (p.verdict === 'accepted' && p.reads !== c.expected.reads) { wrongLetThrough += 1; lets.push(`${c.id}/s${r.sample} suggest ${JSON.stringify(r.raw)}`); }
    }
    sugRight += sr; sugTotal += sug.length;
    line += `  SUGGEST ${sr}/${sug.length}`;
  }
  P(line);
}
const readsIsAsk = finals.filter((r) => r.parsed?.readsIsAsk).length;
const est = allCalls.filter((r) => r.estimatedAtCeiling).length;
P('');
P(`RECOGNISE overall ${recRight}/${recTotal} (bar >= 36/40; no case below 4/5: lowest ${minCase}/5)`);
P(`SUGGEST overall ${sugRight}/${sugTotal} (bar >= 18/20)`);
P(`refused by code ${refused}; unreadable ${unreadable}; null answers ${nulls}; wrong answers let through ${wrongLetThrough}`);
for (const l of lets) P(`  let through: ${l}`);
P(`diagnostic: answers whose reads names an Ask line ${readsIsAsk}; calls priced at the ceiling (no usage) ${est}; calls ${allCalls.length}; spent $${spent.toFixed(5)}; capped ${last.capped}`);
const b1 = recTotal === 40 && recRight >= 36 && minCase >= 4;
const b2 = sugTotal === 20 && sugRight >= 18;
const b3 = wrongLetThrough === 0;
P(`bar 1 ${b1 ? 'PASS' : 'FAIL'}; bar 2 ${b2 ? 'PASS' : 'FAIL'}; bar 3 ${b3 ? 'PASS' : 'FAIL'}; OVERALL ${b1 && b2 && b3 ? 'PASS' : 'FAIL'}`);
