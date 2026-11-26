// M20 F269 Q3: static import-cycle walk of src/ and bin/. Read-only, prints the cycles (strongly connected sets).
// usage: node poc/m20-f269/cycles.harness.mjs
// Edges: `import ... from './x'`, `export ... from './x'`, bare `import './x'` (static); `import('./x')` counted apart (dynamic).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const repo = resolve(new URL('../..', import.meta.url).pathname);
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); } else if (/\.(m?js|cjs)$/.test(n) || (d.endsWith('/bin') && !n.includes('.'))) files.push(p);
  }
};
walk(join(repo, 'src')); walk(join(repo, 'bin'));
const rel = (p) => p.slice(repo.length + 1);
const resolveSpec = (from, spec) => {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};
const stat = new Map(); const dyn = new Map(); const unresolved = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const s = new Set(); const d = new Set();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]/g)) s.add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g)) s.add(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) d.add(m[1]);
  const conv = (set) => [...set].map((sp) => { const r = resolveSpec(f, sp); if (!r) unresolved.push(`${rel(f)} -> ${sp}`); return r; }).filter(Boolean);
  stat.set(f, conv(s)); dyn.set(f, conv(d));
}
const scc = (graph) => {
  let i = 0; const idx = new Map(); const low = new Map(); const on = new Set(); const st = []; const out = [];
  const go = (v) => {
    idx.set(v, i); low.set(v, i); i += 1; st.push(v); on.add(v);
    for (const w of graph.get(v) || []) {
      if (!idx.has(w)) { go(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1 || (graph.get(v) || []).includes(v)) out.push(c.map(rel).sort()); }
  };
  for (const v of graph.keys()) if (!idx.has(v)) go(v);
  return out;
};
const all = new Map([...stat].map(([f, e]) => [f, [...e, ...(dyn.get(f) || [])]]));
const edges = [...stat.values()].reduce((n, e) => n + e.length, 0);
console.log(`files=${files.length} staticEdges=${edges} dynamicEdges=${[...dyn.values()].reduce((n, e) => n + e.length, 0)} unresolved=${unresolved.length}`);
for (const u of unresolved) console.log(`  unresolved: ${u}`);
const a = scc(stat); const b = scc(all);
console.log(`static cycles (strongly connected sets): ${a.length}`);
for (const c of a) console.log(`  ${c.join(' <-> ')}`);
console.log(`static+dynamic cycles: ${b.length}`);
for (const c of b) console.log(`  ${c.join(' <-> ')}`);
