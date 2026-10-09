// M4e amendment 25 POC — side-by-side compare of two results files. $0: reads results-<tag>.json only, no calls, no key.
//   node poc/am24-questions/compare.mjs <tagA> <tagB>
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function load(tag, dir) {
  const p = join(dir, `results-${tag}.json`);
  if (!existsSync(p)) throw new Error(`compare: no results for tag "${tag}" (${p})`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

const avg = (rs, kind) => {
  const k = rs.filter((r) => r.kind === kind);
  return k.length ? (k.reduce((s, r) => s + r.questions.length, 0) / k.length).toFixed(2) : 'n/a';
};
const state = (r) => (r.stop ? `STOP ${r.stop}` : r.declarationValid ? 'valid' : 'RED');
const qs = (r) => (r.questions.length ? r.questions.map((q) => `L${q.line}: ${q.question}`).join(' | ') : '-');

export function compare(tagA, tagB, dir = __dirname) {
  const A = load(tagA, dir);
  const B = load(tagB, dir);
  const armOf = (x) => x.summary.arm ?? 'try3';
  const out = [];
  out.push(`A = ${tagA} (arm ${armOf(A)})    B = ${tagB} (arm ${armOf(B)})`, '');
  const ids = [...new Set([...A.records.map((r) => r.id), ...B.records.map((r) => r.id)])];
  const by = (x, id) => x.records.find((r) => r.id === id);
  for (const id of ids) {
    const a = by(A, id);
    const b = by(B, id);
    out.push(`${id}${(a ?? b).kind ? ` (${(a ?? b).kind})` : ''}`);
    for (const [name, r] of [['A', a], ['B', b]]) {
      out.push(r ? `  ${name}: ${state(r)}, tries ${r.triesRun ?? '-'}, questions: ${qs(r)}` : `  ${name}: not run`);
    }
  }
  out.push('');
  for (const [name, tag, X] of [['A', tagA, A], ['B', tagB, B]]) {
    const v = X.summary.verdict;
    out.push(`${name} ${tag} (${armOf(X)})`);
    out.push(`  total cost: ${typeof X.summary.costUsd === 'number' ? `$${X.summary.costUsd}` : X.summary.costUsd}`);
    out.push(`  avg questions on clear jobs: ${avg(X.records, 'clear')}, on vague jobs: ${avg(X.records, 'vague')}`);
    for (const [k, c] of Object.entries(v)) {
      if (c && typeof c === 'object' && 'ok' in c) out.push(`  ${k}: ${c.got ?? c.broken}${c.of !== undefined ? `/${c.of}` : ''} ${c.ok ? 'ok' : 'FAIL'}`);
    }
    out.push(`  BAR: ${v.pass ? 'PASS' : 'FAIL'}`);
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , a, b] = process.argv;
  if (!a || !b) { process.stderr.write('usage: node poc/am24-questions/compare.mjs <tagA> <tagB>\n'); process.exit(1); }
  try { process.stdout.write(`${compare(a, b)}\n`); } catch (err) { process.stderr.write(`${err.message}\n`); process.exit(1); }
}
