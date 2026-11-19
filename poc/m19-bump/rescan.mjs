// F226 ($0, read only, no AI): usage  node rescan.mjs <repoDir> <flowsRoot>  -> one JSON line per signed flow.
// Per flow: readFlow verdict; per step close: the bareguard rubric each signed check builds (shape/cited/sheet; ok or the refusal text, plus the rubric's sha when it has one),
// and, for each shape close, closeSoftgreen's verdict on three fixed probe texts (so a red/green of bareguard's evaluation shows).
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [repo, root] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(repo, p)).href);
const { readFlow } = await imp('src/flow.js');
const { loadCatalogue } = await imp('src/catalogue.js');
const { softgreenSpec, closeSoftgreen } = await imp('src/closers.js');
const { buildCitedSpec } = await imp('src/citedcheck.js');
const { bareguardChecks } = await imp('src/sheetchecks.js');
const { createRubric } = await import(pathToFileURL(join(repo, 'node_modules/bareguard/src/index.js')).href);
const cat = loadCatalogue();
const probes = ['', '# Summary\nA short text.', 'Current 1-30 31-60 61-90 90+ '.repeat(200)];
const build = (fn) => { try { const r = fn(); return { ok: true, sha: r?.rubricSha ?? r?.sha ?? null }; } catch (e) { return { ok: false, err: String(e?.message ?? e).slice(0, 200) }; } };
for (const name of readdirSync(root).sort()) {
  const out = { flow: name };
  try {
    const read = readFlow({ root, name, catalogue: cat.primitives });
    if (!read.ok) { out.read = 'red'; out.reds = read.reds; console.log(JSON.stringify(out)); continue; }
    out.read = 'ok';
    out.steps = [];
    for (const s of read.declaration.steps ?? []) {
      const c = s.close ?? {};
      const o = { line: s.fromLine, class: c.class };
      if (c.shape) {
        o.shape = build(() => createRubric(softgreenSpec(c.shape)));
        o.probes = [];
        for (const p of probes) { try { const v = await closeSoftgreen({ text: p }, c.shape); o.probes.push(JSON.stringify(v).slice(0, 300)); } catch (e) { o.probes.push('throw ' + String(e?.message ?? e).slice(0, 100)); } }
      }
      if (c.cited) o.cited = build(() => createRubric(buildCitedSpec(c.cited, 'a'.repeat(64))));
      if (c.sheet) o.sheet = build(() => createRubric({ schema: 1, goal: 'sheet', inputs: [...new Set(c.sheet.map((k) => k.table).filter(Boolean))].map((n) => ({ name: n, sha256: 'a'.repeat(64) })), checkpoints: { sheet: { gating: true, checks: bareguardChecks(c.sheet) } }, maxReds: 3 }));
      out.steps.push(o);
    }
  } catch (e) { out.read = 'error'; out.err = String(e?.message ?? e).slice(0, 160); }
  console.log(JSON.stringify(out));
}
