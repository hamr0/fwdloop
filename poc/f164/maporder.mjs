// F164 (POC, NOT the product): for every saved flights draft, the AI map's destination words in order, and line 2's class. $0, read-only.
import fs from 'node:fs'; import path from 'node:path';
const roots = process.argv.slice(2); const rows = [];
(function walk(d, n) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  if (es.some((e) => e.name === 'page-look.json') && es.some((e) => e.name === 'declaration.json')) {
    try {
      const l = JSON.parse(fs.readFileSync(path.join(d, 'page-look.json'), 'utf8')); const j = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8'));
      const f = l.pages?.[0]?.mapping?.facts || []; const dest = f.find((x) => x.shape === 'place' && /dest/i.test(x.name));
      if (!dest) return;
      const st = (j.steps || []).find((s) => s.fromLine === 2);
      rows.push([fs.statSync(d).mtime.toISOString().slice(0, 16), (st?.close?.class || '?') + (st?.close?.cited ? '+cited' : ''), JSON.stringify(dest.words.map((w) => w.slice(0, 14))), d.slice(-40)].join(' | '));
    } catch { /* skipped */ }
    return;
  }
  if (n < 6) for (const e of es) if (e.isDirectory() && e.name !== 'pages' && e.name !== 'runs') walk(path.join(d, e.name), n + 1);
})(roots[0], 0);
console.log(rows.sort().join('\n'));
