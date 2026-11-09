// F164 scan (POC, NOT the product): every saved draft whose job mentions Madrid, line 2 close class, by date. $0, read-only.
import fs from 'node:fs'; import path from 'node:path';
const roots = process.argv.slice(2);
const rows = [];
function walk(d, depth) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  if (es.some((e) => e.name === 'declaration.json') && es.some((e) => e.name === 'prose.txt')) {
    try {
      const prose = fs.readFileSync(path.join(d, 'prose.txt'), 'utf8');
      if (!/Madrid/i.test(prose)) return;
      const j = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8'));
      const st = (j.steps || []).find((s) => /Madrid/i.test(s.goal || '') ) || (j.steps || [])[1];
      const lg = fs.existsSync(path.join(d, 'log.json')) ? JSON.parse(fs.readFileSync(path.join(d, 'log.json'), 'utf8')) : {};
      const lk = fs.existsSync(path.join(d, 'page-look.json')) ? JSON.parse(fs.readFileSync(path.join(d, 'page-look.json'), 'utf8')) : null;
      const price = lk?.pages?.[0]?.mapping?.facts?.find((f) => f.shape === 'money');
      const gr = prose.split('\n').filter((l) => /guardrail:|^\s*~/.test(l) && !/cap \$|send at|source /.test(l)).join(' ').trim();
      rows.push({ when: fs.statSync(d).mtime.toISOString().slice(0, 16), dir: d.replace(process.env.HOME, '~').slice(-60), cls: st?.close?.class, cited: !!st?.close?.cited, picked: !!st?.close?.picked, model: (lg.modelId || '').slice(-18), rounds: lg.rounds, unit: JSON.stringify(price?.unit), gr: gr.slice(0, 70) });
    } catch (e) { /* unreadable draft: skipped */ }
    return;
  }
  if (depth > 5) return;
  for (const e of es) if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'pages' && e.name !== 'runs') walk(path.join(d, e.name), depth + 1);
}
for (const r of roots) walk(r, 0);
rows.sort((a, b) => a.when.localeCompare(b.when));
for (const r of rows) console.log([r.when, r.cls + (r.cited ? '+cited' : '') + (r.picked ? '+picked' : ''), r.model, 'r' + r.rounds, 'unit' + r.unit, r.gr, r.dir].join(' | '));
