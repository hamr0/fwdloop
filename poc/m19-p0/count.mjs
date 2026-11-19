// F223 / M19 P0: count ~ rules left Not checked, and the candidate pool a real-bound shape field could cover. $0, no AI, read-only.
// Prints rule and job names only (never other file contents).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NEGATING_RE } from '../../src/rubricstep.js';

const FLOWS = path.join(os.homedir(), '.config', 'fwdloop', 'flows');
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

// the limit words bareloop's prompt names: a number, a count of chars/words/entries/items, a closed list, yes/no, "has a <name>"
const LIMIT_RE = /\d|\bone of\b|\b[\w'-]+(?:,\s*[\w' -]+)+,?\s+or\s+[\w'-]+|\byes\b|\bno\b|\bhas an? [\w-]+/i;

/** job lines of a prose text: {n, text, ask, rules[]} */
function parseProse(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (t === '' || /^Arbiter guardrails/.test(t)) { if (/^Arbiter/.test(t)) break; continue; }
    let m;
    if ((m = /^(\d+)\.\s+(.*)$/.exec(t))) lines.push({ n: Number(m[1]), text: m[2], ask: /^ask[: ]/i.test(m[2]), rules: [] });
    else if ((m = /^(?:guardrail:|~)\s*(.*)$/i.exec(t)) && lines.length) lines[lines.length - 1].rules.push(...m[1].split('; ').filter(Boolean));
  }
  return lines;
}

const sources = []; // {kind, name, path, declaration, prose}
const addDecl = (kind, name, dir, declFile, proseFiles) => {
  const decl = readJson(declFile);
  if (!decl || !Array.isArray(decl.checkList)) return;
  let prose = null;
  for (const f of proseFiles) { prose = readText(f); if (prose) break; }
  sources.push({ kind, name, path: dir, decl, prose });
};
// signed flows
for (const f of fs.readdirSync(FLOWS)) {
  if (f.startsWith('.')) continue;
  const dir = path.join(FLOWS, f);
  addDecl('signed', f, dir, path.join(dir, 'declaration.json'), [path.join(dir, 'prose.txt'), path.join(dir, 'signed', 'prose.txt')]);
}
// drafts
const DR = path.join(FLOWS, '.drafts');
const draftStats = { folders: 0, withCheckList: 0, notCheckedJson: 0, logJson: 0 };
const ncTexts = []; // supplementary: AI notChecked entries
if (fs.existsSync(DR)) for (const d of fs.readdirSync(DR)) {
  if (!d.startsWith('d-')) continue;
  for (const s of fs.readdirSync(path.join(DR, d))) {
    if (!s.startsWith('draft')) continue;
    const dir = path.join(DR, d, s);
    draftStats.folders++;
    if (fs.existsSync(path.join(dir, 'log.json'))) draftStats.logJson++;
    const nc = readJson(path.join(dir, 'not-checked.json'));
    const before = sources.length;
    addDecl('draft', `${d}/${s}`, dir, path.join(dir, 'declaration.json'), [path.join(dir, 'prose.txt'), path.join(DR, d, 'prose.txt')]);
    if (sources.length > before) draftStats.withCheckList++;
    if (nc && Array.isArray(nc.notChecked)) {
      draftStats.notCheckedJson++;
      const prose = readText(path.join(dir, 'prose.txt')) ?? readText(path.join(DR, d, 'prose.txt')) ?? '';
      for (const t of nc.notChecked) if (typeof t === 'string') ncTexts.push({ job: `${d}/${s}`, text: t, jobLine: (parseProse(prose)[0] || {}).text ?? '' });
    }
  }
}
// repo fixtures holding a signed list
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) walk(p);
  else if (e.name === 'declaration.json') addDecl('fixture', path.relative(FIX, path.dirname(p)), path.dirname(p), p, [path.join(path.dirname(p), 'prose.txt'), path.join(path.dirname(p), 'signed', 'prose.txt'), path.join(path.dirname(p), '..', 'prose.txt'), path.join(path.dirname(p), '..', 'job.txt')]);
} };
walk(FIX);

const seen = new Map(); // dedupe key -> record
const excluded = { ticket: 0, ask: 0, sheet: 0, noProse: 0, noText: 0 };
let notCheckedRows = 0;
for (const s of sources) {
  const lines = s.prose ? parseProse(s.prose) : [];
  const sheetLines = new Set(s.decl.checkList.filter((r) => r.kind === 'sheet').map((r) => r.line));
  for (const r of s.decl.checkList) {
    if (r.kind !== 'rule' || r.state !== 'not-checked') continue;
    notCheckedRows++;
    if (s.decl.flowType === 'tickets' || s.decl.ticketFilter || s.decl.ticketWatch) { excluded.ticket++; continue; }
    if (sheetLines.has(r.line)) { excluded.sheet++; continue; }
    if (!s.prose) { excluded.noProse++; continue; }
    const line = lines.find((l) => l.n === r.line);
    const rule = line && line.rules[r.rule - 1];
    if (!line || !rule) { excluded.noText++; continue; }
    if (line.ask) { excluded.ask++; continue; }
    const key = `${line.text}\u0000${rule}`;
    if (!seen.has(key)) seen.set(key, { job: s.name, kind: s.kind, path: s.path, line: line.text, rule, sources: 1 });
    else seen.get(key).sources++;
  }
}
const A = [...seen.values()];
const B = A.filter((x) => !NEGATING_RE.test(x.rule) && LIMIT_RE.test(x.rule));
// distinct jobs = distinct job line text (a signed flow, its drafts and fixtures of one job count once); also report distinct names
const jobsB = new Set(B.map((x) => x.line));
const verdict = B.length === 0 ? 'NO-GO' : (B.length >= 3 && jobsB.size >= 2 ? 'GO' : 'BETWEEN');

console.log(`sources with a checkList: signed ${sources.filter((s) => s.kind === 'signed').length}, draft ${sources.filter((s) => s.kind === 'draft').length}, fixture ${sources.filter((s) => s.kind === 'fixture').length}`);
console.log(`draft folders ${draftStats.folders}, with checkList ${draftStats.withCheckList}, with not-checked.json ${draftStats.notCheckedJson}, with log.json ${draftStats.logJson}`);
console.log(`rule rows Not checked before filters: ${notCheckedRows}; excluded:`, JSON.stringify(excluded));
console.log(`A = ${A.length}`);
for (const x of A) console.log(`  A [${x.kind}] ${x.job} | line: ${x.line.slice(0, 70)} | rule: ${x.rule}`);
console.log(`B = ${B.length} (distinct job lines ${jobsB.size})`);
for (const x of B) console.log(`  B [${x.kind}] job=${x.job} path=${x.path} | rule: ${x.rule}`);
// supplementary, NOT part of A/B: the drafter's free-text notChecked entries (not ~ rules)
const ncB = new Set(ncTexts.filter((t) => !NEGATING_RE.test(t.text) && LIMIT_RE.test(t.text)).map((t) => t.text));
console.log(`supplementary (not A/B): not-checked.json entries ${ncTexts.length}, distinct ${new Set(ncTexts.map((t) => t.text)).size}, distinct with a limit word and no negation ${ncB.size}`);
for (const t of ncB) console.log(`  S ${t}`);
console.log(`VERDICT: ${verdict}`);
