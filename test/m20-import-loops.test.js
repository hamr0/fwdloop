// M20 am3b item 2 (item 14): a static import loop in src/ or bin/ is a fact that two files cannot be understood or tested alone. This walks every static
// `import ... from './x'`, `export ... from './x'` and bare `import './x'` (the walk of poc/m20-f269/cycles.harness.mjs) and fails on any loop not on LISTED, each with its reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** a loop = its files, src- or bin-relative, sorted, joined with " <-> "; the reason is why it may stay */
const LISTED = {
  'src/checkblock.js <-> src/citedwords.js <-> src/closers.js <-> src/declaration.js <-> src/factwords.js <-> src/pagedropwords.js <-> src/sheetblock.js <-> src/sheetrows.js <-> src/sheetrun.js <-> src/ticketrows.js':
    'mapped and broken in its own step',
};

function files() {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); } else if (/\.(m?js|cjs)$/.test(n) || (path.basename(d) === 'bin' && !n.includes('.'))) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'bin'));
  return out;
}
const rel = (p) => p.slice(ROOT.length + 1);
const resolveSpec = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};

/** every strongly connected set of more than one file (or a file that imports itself), as sorted relative names @returns {{graph: Map<string, string[]>, loops: string[][], unresolved: string[]}} */
export function importLoops() {
  const graph = new Map();
  const unresolved = [];
  for (const f of files()) {
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs = new Set();
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of text.matchAll(/(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g)) specs.add(m[1]);
    graph.set(f, [...specs].map((sp) => { const r = resolveSpec(f, sp); if (!r) unresolved.push(`${rel(f)} -> ${sp}`); return r; }).filter(Boolean));
  }
  let i = 0;
  const idx = new Map(); const low = new Map(); const on = new Set(); const st = []; const loops = [];
  const go = (v) => {
    idx.set(v, i); low.set(v, i); i += 1; st.push(v); on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) { go(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const c = []; let w;
      do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v);
      if (c.length > 1 || (graph.get(v) ?? []).includes(v)) loops.push(c.map(rel).sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) go(v);
  return { graph, loops, unresolved };
}

test('item 14: every static import resolves, and every import loop in src and bin is on the list with its reason', () => {
  const { loops, unresolved } = importLoops();
  assert.deepEqual(unresolved, [], 'a relative import that names no file');
  const seen = loops.map((l) => l.join(' <-> ')).sort();
  assert.deepEqual(seen.filter((l) => !Object.hasOwn(LISTED, l)), [], 'a loop that is not on the list: break it, or list it with its reason');
  assert.deepEqual(Object.keys(LISTED).filter((l) => !seen.includes(l)), [], 'a listed loop that is gone or changed: take it off the list (or list its new shape)');
  for (const [l, why] of Object.entries(LISTED)) assert.ok(typeof why === 'string' && why.length > 0, `loop ${l.slice(0, 40)}... needs a reason`);
});
