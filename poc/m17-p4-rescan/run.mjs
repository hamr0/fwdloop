// M17 P4 rescan POC ($0): `node poc/m17-p4-rescan/run.mjs <tree root>` -> JSON lines on stdout. Counts, ids and fixed words only; no job text or cell is printed.
// Reads ~/.config/fwdloop/flows READ-ONLY. Per signed flow whose declaration carries a sheet check (close.sheet):
// (a) readFlow (signature check + validateDeclaration, the run door); (b) the saved checks' ids, rules and ops; (c) per run with a frozen input and a line-checks.json record:
// the verdict of closeSheet (bareguard checkStep) on each saved try's claims, run on the run's own frozen sheet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tree = path.resolve(process.argv[2] ?? '.');
const imp = (f) => import(pathToFileURL(path.join(tree, 'src', f)).href);
const { readFlow } = await imp('flow.js');
const { loadCatalogue } = await imp('catalogue.js');
const { readRunSheets, closeSheet } = await imp('sheetrun.js');

const root = path.join(os.homedir(), '.config/fwdloop/flows');
const cat = loadCatalogue();
const out = (o) => console.log(JSON.stringify(o));
const sheetsOf = (d) => (Array.isArray(d.steps) ? d.steps : []).flatMap((s) => (s?.close?.class === 'green' && Array.isArray(s.close.sheet) ? [{ line: s.fromLine, checks: s.close.sheet }] : []));

for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  let decl;
  try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); } catch { continue; }
  const sheets = sheetsOf(decl);
  if (sheets.length === 0) continue;
  let r;
  try { r = readFlow({ root, name, catalogue: cat.primitives }); } catch (e) { r = { ok: false, reds: [`THROW ${e.message}`] }; }
  out({ k: 'flow', flow: name, ok: r.ok, reds: r.ok ? 0 : r.reds.length, lines: sheets.map((s) => ({ line: s.line, checks: s.checks.map((c) => `${c.id}:${c.rule}:${c.op}`) })), list: Array.isArray(decl.checkList) ? decl.checkList.filter((x) => x?.kind === 'sheet').map((x) => `${x.key}:${x.by}`) : null });
  const runsDir = path.join(d, 'runs');
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
  for (const run of runs) {
    const runDir = path.join(runsDir, run);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(runDir, 'line-checks.json'), 'utf8')); } catch { continue; }
    for (const l of Array.isArray(rec?.sheet?.lines) ? rec.sheet.lines : []) {
      const mine = sheets.find((s) => s.line === l.n);
      if (!mine || l.claims === undefined) continue;
      let v;
      try { const rs = readRunSheets(runDir, mine.checks); const c = await closeSheet(mine.checks, l.claims, rs); v = { verdict: c.verdict, checks: Array.isArray(c.checks) ? c.checks.map((x) => `${x.id}:${x.ok}`) : null }; } catch (e) { v = { THROW: e.message }; }
      out({ k: 'try', flow: name, run, line: l.n, try: l.try, saved: l.passed, now: v });
    }
  }
}
