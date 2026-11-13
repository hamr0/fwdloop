// F190 rescan POC ($0): `node poc/f190-rescan/run.mjs <tree root>` -> JSON lines on stdout. Counts, ids and red-class only; no job or cell text is printed.
// Reads ~/.config/fwdloop/flows READ-ONLY. Per flow with a signature.json: (a) readFlow (signature check + validateDeclaration incl. checkListReds, the run door);
// (b) per sheet check with a frozen input in a run folder: sheetCheckReds, sheetCheckWordReds, tableChecksFailingOnInput on that run's table.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const tree = path.resolve(process.argv[2] ?? '.');
const imp = (f) => import(pathToFileURL(path.join(tree, 'src', f)).href);
const { readFlow } = await imp('flow.js');
const { loadCatalogue } = await imp('catalogue.js');
const { parseSignedText } = await imp('signed-text.js');
const { sheetCheckReds, sheetCheckWordReds } = await imp('sheetchecks.js');
const { readRunSheets, tableChecksFailingOnInput } = await imp('sheetrun.js');

const root = path.join(os.homedir(), '.config/fwdloop/flows');
const cat = loadCatalogue();
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
// a red's class: quoted text and digits stripped, first 70 chars (fixed message words only)
const cls = (r) => String(r).replace(/'[^']*'|"[^"]*"/g, '_').replace(/\d+/g, 'N').slice(0, 70);
const out = (o) => console.log(JSON.stringify(o));
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  if (!fs.existsSync(path.join(d, 'signature.json'))) continue;
  let r;
  try { r = readFlow({ root, name, catalogue: cat.primitives }); } catch (e) { r = { ok: false, reds: [`THROW ${e.message}`] }; }
  out({ k: 'flow', flow: name, ok: r.ok, reds: r.ok ? 0 : r.reds.length, classes: r.ok ? [] : [...new Set(r.reds.map(cls))], redsSha: r.ok ? null : sha(r.reds.join('\n')) });
  let decl; let parsed;
  try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); parsed = parseSignedText(fs.readFileSync(path.join(d, 'prose.txt'), 'utf8')); } catch { continue; }
  if (!parsed.ok) continue;
  const runsDir = path.join(d, 'runs');
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
  for (const st of Array.isArray(decl.steps) ? decl.steps : []) {
    const sheet = st?.close?.class === 'green' && Array.isArray(st.close.sheet) ? st.close.sheet.filter(isRec) : null;
    if (!sheet) continue;
    const line = parsed.lines.find((l) => l.n === st.fromLine);
    if (!line) continue;
    const jl = { n: line.n, text: line.text, ...(line.guardrail ? { rule: line.guardrail } : {}) };
    for (const run of runs) {
      const runDir = path.join(runsDir, run);
      if (!fs.existsSync(path.join(runDir, 'run.json'))) continue;
      let rs;
      try { rs = readRunSheets(runDir, sheet); } catch (e) { rs = { ok: false, red: `THROW ${e.message}` }; }
      if (!rs.ok) { out({ k: 'run', flow: name, line: line.n, run, tables: false, why: cls(rs.red) }); continue; }
      // the tables of the checks the run froze; a check whose table was not read is skipped by readRunSheets (it returns ok:false then)
      for (const c of sheet) {
        const id = String(c.id);
        let red = []; let word = [];
        try { red = sheetCheckReds([c], line.n, rs.tables); } catch (e) { red = [`THROW ${e.message}`]; }
        try { word = sheetCheckWordReds([c], jl); } catch (e) { word = [`THROW ${e.message}`]; }
        out({ k: 'check', flow: name, line: line.n, run, id, rule: c.rule, sheetCheckReds: red.length === 0 ? 'green' : 'red', redClass: [...new Set(red.map(cls))], sheetCheckWordReds: word.length === 0 ? 'green' : 'red', wordClass: [...new Set(word.map(cls))] });
      }
      // table checks failing on the input, one record per table check (each judged alone, as the draft door does)
      for (const c of sheet.filter((x) => x.rule === 'table')) {
        let f = [];
        try { f = await tableChecksFailingOnInput({ steps: [{ fromLine: st.fromLine, close: { class: 'green', sheet: [c] } }] }, rs.tables); } catch (e) { f = [`THROW ${e.message}`]; }
        out({ k: 'tablecheck', flow: name, line: line.n, run, id: String(c.id), failsOnInput: f.length > 0 ? 'red' : 'green' });
      }
    }
  }
}
