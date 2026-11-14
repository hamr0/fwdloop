// F186 parity POC ($0). Counts only; no job text is ever printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { numbersSaid } from '../../src/citedwords.js';
import { wordsSaidOn } from '../../src/pagebits.js';
import { parseSignedText } from '../../src/signed-text.js';
import { groundedLiterals, canon } from './reader.mjs';

const root = path.join(os.homedir(), '.config/fwdloop/flows');
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const NUM = ['gt', 'gte', 'lt', 'lte', 'eq', 'between'];
const DAT = ['before', 'after', 'dateOn', 'dateBetween'];
const logs = [];
const log = (s) => { logs.push(s); console.log(s); };

/** classify why fwd grounds a number but #82 does not, from the raw tokens fwd reads (never printed) */
function classify(text, v) {
  const cls = new Set();
  for (const m of text.matchAll(/(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)|(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})|([$€£]\s?\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)/g)) {
    const tok = m[3] ?? m[4];
    if (!tok || Number(tok.replace(/[^\d.]/g, '')) !== v) continue;
    const pre = m.index > 0 ? text[m.index - 1] : '';
    const post = text[m.index + m[0].length] ?? '';
    const body = tok.replace(/^[^\d]+/, '');
    if (/,/.test(body) && !/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(body)) cls.add('1 commas');
    if (pre === '-' ) cls.add('2 minus (sign at token start)');
    if (/\p{L}/u.test(post) || /\p{L}/u.test(pre)) cls.add('3 letters glued');
    if (pre === '.' || pre === ',' || pre === '(') cls.add('4 leading . , or (');
    if (/[$€£]\s/.test(tok)) cls.add('5 space after symbol');
  }
  return cls.size ? [...cls] : ['other'];
}

const stat = { flows: 0, signedFlows: 0, sheetJobs: 0, sheetSteps: 0, noLine: 0, lit: 0, agree: 0, agreeGround: 0, agreeUngr: 0, fwdOnly: 0, b82Only: 0, numLit: 0, dateLit: 0, asOf: 0, typeMismatch: 0, bconst: 0, bconstFwd: 0, bconst82: 0 };
const classes = new Map();
const refused = [];
const refusedAll = [];

for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  if (!fs.existsSync(path.join(d, 'declaration.json')) || !fs.existsSync(path.join(d, 'prose.txt'))) continue;
  stat.flows++;
  const signed = fs.existsSync(path.join(d, 'signature.json'));
  if (signed) stat.signedFlows++;
  let decl; let parsed;
  try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); parsed = parseSignedText(fs.readFileSync(path.join(d, 'prose.txt'), 'utf8')); } catch { continue; }
  if (!parsed.ok) continue;
  let jobHas = false;
  for (const st of Array.isArray(decl.steps) ? decl.steps : []) {
    const sheet = st?.close?.sheet;
    if (!Array.isArray(sheet)) continue;
    stat.sheetSteps++; jobHas = true;
    const line = parsed.lines.find((l) => l.n === st.fromLine);
    if (!line) { stat.noLine++; continue; }
    const jl = { n: line.n, text: line.text, ...(line.guardrail ? { rule: line.guardrail } : {}) };
    const text = wordsSaidOn(jl);
    const said = numbersSaid(text);
    for (const c of sheet) {
      if (!isRec(c)) continue;
      const g = groundedLiterals(c, text, { constToo: true });
      const missPaths = new Set(g.missing.map((m) => m.path));
      const lits = [];
      if (c.asOf !== undefined) lits.push({ path: 'asOf', kind: 'date', v: c.asOf });
      (Array.isArray(c.where) ? c.where : []).forEach((w, i) => {
        if (!isRec(w)) return;
        if (NUM.includes(w.cmp)) for (const k of w.cmp === 'between' ? ['lo', 'hi'] : ['value']) lits.push({ path: `where[${i}].${k}`, kind: 'number', v: w[k] });
        else if (DAT.includes(w.cmp)) for (const k of w.cmp === 'dateBetween' ? ['lo', 'hi'] : ['value']) lits.push({ path: `where[${i}].${k}`, kind: 'date', v: w[k] });
      });
      for (const L of lits) {
        stat.lit++; if (L.path === 'asOf') stat.asOf++; else if (L.kind === 'number') stat.numLit++; else stat.dateLit++;
        // fwd: only a value of the right JS type is checked at all (a wrong-typed one is silently not scanned)
        const fwdScanned = L.kind === 'number' ? typeof L.v === 'number' : typeof L.v === 'string';
        if (!fwdScanned) stat.typeMismatch++;
        const fwdG = !fwdScanned ? true : L.kind === 'number' ? (said.bare.has(L.v) || said.amount.has(L.v)) : said.date.has(L.v);
        const b82G = !missPaths.has(L.path);
        if (fwdG === b82G) { stat.agree++; if (fwdG) stat.agreeGround++; else stat.agreeUngr++; continue; }
        if (b82G && !fwdG) { stat.b82Only++; continue; }
        stat.fwdOnly++;
        const cl = L.kind === 'date' ? ['7 dates (not real ISO / shape)'] : classify(text, L.v);
        for (const k of cl) classes.set(k, (classes.get(k) ?? 0) + 1);
        refusedAll.push(`${name} line ${line.n}${signed ? ' [signed]' : ' [unsigned]'}`);
        if (signed) refused.push(`${name} line ${line.n}`);
      }
      if (isRec(c.b) && c.b.const !== undefined) {
        stat.bconst++;
        const v = c.b.const;
        const f = typeof v === 'number' && (said.bare.has(v) || said.amount.has(v));
        const b = !missPaths.has('b.const');
        if (f) stat.bconstFwd++;
        if (b) stat.bconst82++;
      }
    }
  }
  if (jobHas) stat.sheetJobs++;
}
log(`flows scanned ${stat.flows}; with signature.json ${stat.signedFlows}; jobs with close.sheet ${stat.sheetJobs}; sheet steps ${stat.sheetSteps}; steps whose job line was not found ${stat.noLine}`);
log(`literals total ${stat.lit} (number ${stat.numLit}, date ${stat.dateLit}, asOf ${stat.asOf}); wrong-typed (fwd skips) ${stat.typeMismatch}`);
log(`agree ${stat.agree} (both grounded ${stat.agreeGround}, both ungrounded ${stat.agreeUngr}); fwd grounds / #82 refuses ${stat.fwdOnly}; #82 grounds / fwd refuses ${stat.b82Only}`);
for (const [k, v] of [...classes].sort()) log(`  divergence ${k}: ${v}`);
log(`row-math b.const ${stat.bconst}: grounded by fwd numbersSaid ${stat.bconstFwd}, by #82 ${stat.bconst82}`);
log(`flow lines where #82 refuses what fwd grounds, all flows: ${[...new Set(refusedAll)].length ? [...new Set(refusedAll)].join('; ') : 'none'}`);
log(`SIGNED jobs refused by #82 that numbersSaid grounds: ${[...new Set(refused)].length ? [...new Set(refused)].join('; ') : 'none'}`);
log(refused.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
fs.writeFileSync(new URL('./result-1.log', import.meta.url), logs.join('\n') + '\n');
