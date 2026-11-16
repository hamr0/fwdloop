// F204 scorer: node poc/f204-action-ai/score.mjs <tag>   (reads out/<tag>.jsonl; scores the FINAL row of each case/sample/ask)
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
let recRight = 0; let recTotal = 0; let minCase = 5; let hoRight = 0; let hoTotal = 0;
let sugRight = 0; let sugTotal = 0;
let refused = 0; let unreadable = 0; let nullsOnAction = 0; let nullsOnNone = 0; let acceptedOnNone = 0;
for (const c of CASES) {
  const rec = finals.filter((r) => r.case === c.id && r.ask === 'recognise');
  let right = 0;
  for (const r of rec) {
    const p = r.parsed ?? {};
    // right = accepted (the last line, so equal to the expected line) on an action case; null on a no-action case. Refused / unreadable are wrong.
    const ok = c.expected.line === null ? p.verdict === 'null' : (p.verdict === 'accepted' && p.line === c.expected.line);
    if (ok) right += 1;
    if (p.verdict === 'refused') refused += 1;
    if (p.verdict === 'unreadable') unreadable += 1;
    if (p.verdict === 'null' && c.expected.line !== null) nullsOnAction += 1; // bar 3: a null here would lead to a second write
    if (p.verdict === 'null' && c.expected.line === null) nullsOnNone += 1;
    if (p.verdict === 'accepted' && c.expected.line === null) acceptedOnNone += 1; // diagnostic: a write step spotted where there is none
  }
  recRight += right; recTotal += rec.length; if (rec.length) minCase = Math.min(minCase, right);
  if (c.heldOut) { hoRight += right; hoTotal += rec.length; }
  let line = `${c.id} (${c.kind}${c.heldOut ? ', held-out' : ''}, ${c.draft}) RECOGNISE ${right}/${rec.length}`;
  if (c.kind === 'none') {
    const sug = finals.filter((r) => r.case === c.id && r.ask === 'suggest');
    let sr = 0;
    for (const r of sug) {
      const p = r.parsed ?? {};
      if (p.verdict === 'accepted' && p.oneLine && p.says) sr += 1;
      if (p.verdict === 'refused') refused += 1;
      if (p.verdict === 'unreadable') unreadable += 1;
    }
    sugRight += sr; sugTotal += sug.length;
    line += `  SUGGEST ${sr}/${sug.length}`;
  }
  P(line);
}
const est = allCalls.filter((r) => r.estimatedAtCeiling).length;
P('');
P(`RECOGNISE overall ${recRight}/${recTotal} (bar >= 54/60; no case below 4/5: lowest ${minCase}/5); held-out ${hoRight}/${hoTotal} (bar >= 18/20)`);
P(`SUGGEST overall ${sugRight}/${sugTotal} (bar >= 27/30; right = one non-empty line <= 100 chars AND contains the Destination path or a word starting write/save/send, case-insensitive)`);
P(`bar 3: null answers on action cases ${nullsOnAction} (bar 0)`);
P(`diagnostic: refused ${refused}; unreadable ${unreadable}; nulls on no-action cases ${nullsOnNone}; accepted on no-action cases ${acceptedOnNone}; calls priced at the ceiling (no usage) ${est}; calls ${allCalls.length}; spent $${spent.toFixed(5)}; capped ${last.capped}`);
const b1 = recTotal === 60 && recRight >= 54 && minCase >= 4 && hoTotal === 20 && hoRight >= 18;
const b2 = sugTotal === 30 && sugRight >= 27;
const b3 = nullsOnAction === 0;
P(`bar 1 ${b1 ? 'PASS' : 'FAIL'}; bar 2 ${b2 ? 'PASS' : 'FAIL'}; bar 3 ${b3 ? 'PASS' : 'FAIL'}; OVERALL ${b1 && b2 && b3 ? 'PASS' : 'FAIL'}`);
