// NOT the product. F163: the M10 am24 candidate (no page question on a count guardrail) as a pure filter around the real askableFromLook, replayed over saved drafts. $0, read only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSignedText } from '../../src/signed-text.js';
import { askableFromLook, MAX_LOOK_ASKS } from '../../src/pageask.js';
import { offerRules } from '../../src/checkpick.js';
import { isCountGuardrail } from '../../src/declaration.js';

const out = []; let ok = true;
const say = (s) => out.push(s);
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const todayAsks = (facts, lines) => askableFromLook({ facts }, lines);
const candAsks = (facts, lines) => todayAsks(facts, lines).filter((a) => !isCountGuardrail(a.ruleText));
const label = (a) => `L${a.line}.${a.rule} ${a.ask} "${a.ruleText}"`;

// replay one saved draft dir (containing page-look.json and prose.txt)
function replay(dir) {
  const look = rj(path.join(dir, 'page-look.json')); if (!look) return null;
  let prose; try { prose = fs.readFileSync(path.join(dir, 'prose.txt'), 'utf8'); } catch { return null; }
  const p = parseSignedText(prose); if (!p.ok) return null;
  const facts = [...(look.look?.facts ?? []), ...(look.sheets ?? []).flatMap((x) => x.facts ?? [])];
  const askLines = new Set(p.arbiter.asks.map((a) => a.line));
  const jobLines = p.lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) })).filter((l) => !askLines.has(l.n));
  const picks = offerRules(p.lines, p.arbiter, facts);
  const today = todayAsks(facts, jobLines), cand = candAsks(facts, jobLines);
  return { facts, picks, today, cand };
}
const sameList = (a, b) => JSON.stringify(a.map((x) => x.question)) === JSON.stringify(b.map((x) => x.question));

const S = process.argv[2];
const dd = (n) => { const root = path.join(S, n, 'flows/.drafts'); const id = fs.readdirSync(root).find((d) => fs.existsSync(path.join(root, d, 'draft/page-look.json'))); return path.join(root, id, 'draft'); };

// (a) run 1 and 3b
for (const n of ['f162-1', 'f162-3b']) {
  const r = replay(dd(n));
  const w = (a) => a.ruleText === 'under 80 words';
  const pick = r.picks.some((x) => x.text === 'under 80 words');
  const todayHas = r.today.some(w), candHas = r.cand.some(w);
  const pass = todayHas && pick && !candHas && r.facts.length > 0;
  say(`(a) ${n}: today page asks [${r.today.map(label).join(' | ')}] + pick of "under 80 words": ${pick}; candidate page asks [${r.cand.map(label).join(' | ')}] + pick ${pick} => ${pass ? 'ok' : 'FAIL'}`); ok &&= pass;
}
// (b) run 2 and comparator
for (const n of ['f162-2', 'f162-cmp']) {
  const r = replay(dd(n));
  const pass = sameList(r.today, r.cand);
  say(`(b) ${n}: today page asks [${r.today.map(label).join(' | ') || 'none'}]; candidate [${r.cand.map(label).join(' | ') || 'none'}]; picks [${r.picks.map((x) => `${x.line}.${x.rule} ${x.text}`).join(' | ') || 'none'}] => ${pass ? 'ok' : 'FAIL'}`); ok &&= pass;
}
// (c) + (d) 41 saved looks
const drafts = path.join(os.homedir(), '.config/fwdloop/flows/.drafts');
let n = 0, changed = 0, bad = 0, capChange = 0;
for (const d of fs.readdirSync(drafts).sort()) {
  const base = path.join(drafts, d);
  if (!fs.statSync(base).isDirectory()) continue;
  for (const s of fs.readdirSync(base).sort()) {
    if (!/^draft(-\d+)?$/.test(s)) continue;
    const r = replay(path.join(base, s)); if (!r) continue;
    n++;
    const removed = r.today.filter((a) => !r.cand.some((c) => c.line === a.line && c.rule === a.rule && c.ask === a.ask));
    const added = r.cand.filter((c) => !r.today.some((a) => a.line === c.line && a.rule === c.rule && a.ask === c.ask));
    const badRemoved = removed.filter((a) => !isCountGuardrail(a.ruleText));
    if (added.length || badRemoved.length) { bad++; say(`BAD ${d}/${s}: added [${added.map(label)}] non-count removed [${badRemoved.map(label)}]`); }
    if (removed.length) { changed++; const cantBefore = r.today.length, cantAfter = r.cand.length; if (cantBefore !== cantAfter) capChange++; say(`changed ${d}/${s}: removed [${removed.map(label).join(' | ')}]; page asks ${cantBefore} -> ${cantAfter}`); }
  }
}
const cPass = n === 41 && bad === 0;
say(`(c) replayed ${n} looks (expect 41): ${changed} lose a count page question, ${bad} bad (facts are never touched: the filter sees only the asks) => ${cPass ? 'ok' : 'FAIL'}`); ok &&= cPass;
say(`(d) cap ${MAX_LOOK_ASKS}: ${capChange} of ${n} saved looks change their page-ask count`);
// F162 cap effect
for (const x of ['f162-1', 'f162-3b']) { const r = replay(dd(x)); say(`(d) ${x}: page asks ${r.today.length} -> ${r.cand.length}`); }
say(`VERDICT: ${ok ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(new URL('./out/replay.txt', import.meta.url), out.join('\n') + '\n');
console.log(out.join('\n'));
