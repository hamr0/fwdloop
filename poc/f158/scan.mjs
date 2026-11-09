// F158: read-only scan of ~/.config/fwdloop/flows for agreed check picks dropped on a green line (applyPicks, src/checkpick.js).
// A try = a drafting folder's draft / draft-N dir. Picks come from its picks-record.json (entries tied to line WORDS); the line is found
// by matching the entry's lineWords to a step goal (the goal is the signed line verbatim, machine-set). Prints ids, line numbers, rules only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.join(os.homedir(), '.config/fwdloop/flows');
const drafts = path.join(root, '.drafts');
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const kindOf = (c) => (c.cited !== undefined ? 'cited' : c.sheet !== undefined ? 'sheet' : c.columns !== undefined ? 'columns' : 'other');

const c = { tries: 0, noDecl: 0, withRecord: 0, noRecord: 0, entries: 0, checkPicks: 0, ownOrLeft: 0, landed: 0, dropped: 0, droppedOwn: 0, unresolved: 0 };
const out = [];
const drops = [];
for (const d of fs.readdirSync(drafts).sort()) {
  const dd = path.join(drafts, d);
  if (!fs.statSync(dd).isDirectory()) continue;
  for (const s of fs.readdirSync(dd).sort()) {
    if (!/^draft(-\d+)?$/.test(s)) continue;
    c.tries++;
    const decl = rj(path.join(dd, s, 'declaration.json'));
    if (!decl || !Array.isArray(decl.steps)) { c.noDecl++; continue; }
    const rec = rj(path.join(dd, s, 'picks-record.json'));
    if (!rec || !Array.isArray(rec.picks)) { c.noRecord++; out.push(`${d}/${s}: declaration, no picks-record.json -> unknown (none given, or drafted before am17's record)`); continue; }
    c.withRecord++;
    // line number -> words, from the step goals (verbatim signed line); equal lines keep their order
    const byWords = new Map();
    for (const st of [...decl.steps].sort((a, b) => a.fromLine - b.fromLine)) {
      const w = norm(st.goal ?? '');
      const arr = byWords.get(w) ?? [];
      if (!arr.includes(st.fromLine)) arr.push(st.fromLine);
      byWords.set(w, arr);
    }
    for (const e of rec.picks) {
      c.entries++;
      const isCheck = e.check && typeof e.check === 'object';
      if (isCheck) c.checkPicks++; else c.ownOrLeft++;
      const line = (byWords.get(e.lineWords) ?? [])[e.occurrence];
      if (line === undefined) { c.unresolved++; out.push(`${d}/${s}: entry "${e.ruleText}" line words not matched to a step goal -> unknown`); continue; }
      const onLine = decl.steps.filter((st) => st.fromLine === line);
      const green = onLine.find((st) => st.close?.class === 'green');
      const readout = (() => { try { return fs.readFileSync(path.join(dd, s, 'readout.txt'), 'utf8'); } catch { return ''; } })();
      const name = isCheck ? JSON.stringify(e.check) : e.left ? 'left (Not checked)' : 'own words';
      if (green) {
        const row = { folder: `${d}/${s}`, line, pick: name, closeKind: kindOf(green.close), youPickedRow: /you picked:/.test(readout.split(/\n(?=\s+\d+\. \(line )/).find((b) => b.includes(`(line ${line})`)) ?? '') };
        if (isCheck) { c.dropped++; drops.push(row); } else c.droppedOwn++;
        out.push(`${isCheck ? 'DROP' : 'drop-own/left'}: ${JSON.stringify(row)}`);
      } else if (isCheck) {
        const got = onLine.some((st) => st.close?.class === 'softgreen' && JSON.stringify(st.close.shape?.picked ?? []).includes(JSON.stringify(e.check)));
        if (got) c.landed++; else out.push(`NOT-LANDED-NOT-GREEN: ${d}/${s} line ${line} ${name} (line class ${onLine.map((st) => st.close?.class).join(',')})`);
      }
    }
  }
}
// signed flows: their plans hold no pick record; counted only for context
let signedGreen = 0, signedFlows = 0;
for (const f of fs.readdirSync(root)) {
  if (f.startsWith('.')) continue;
  const dec = rj(path.join(root, f, 'declaration.json'));
  if (!dec?.steps) continue;
  signedFlows++;
  if (dec.steps.some((st) => st.close?.class === 'green')) signedGreen++;
}
const lines = [
  'F158 scan', JSON.stringify(c),
  `signed flows read: ${signedFlows}; with a green step: ${signedGreen} (no pick record on a signed flow: picks there are unknown unless a drafting folder holds them, counted above)`,
  `agreed check picks: ${c.checkPicks}; landed on a non-green line: ${c.landed}; dropped on a green line: ${c.dropped}`,
  `own-words/left entries on a green line: ${c.droppedOwn}`,
  ...out,
  `VERDICT: ${c.dropped >= 1 ? 'NEEDED' : 'NOT SEEN'}`,
];
fs.writeFileSync(new URL('./out/scan.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.join('\n'));
