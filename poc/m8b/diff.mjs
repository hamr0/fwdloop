// F84: `node poc/m8b/diff.mjs <before.json> <after.json>` - every path where two snapshots (poc/m8b/snapshot.mjs) differ, exit 1 if any.
import { readFileSync } from 'node:fs';
const [, , a, b] = process.argv;
const A = JSON.parse(readFileSync(a, 'utf8'));
const B = JSON.parse(readFileSync(b, 'utf8'));
const out = [];
function walk(x, y, p) {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}/${k}`);
    return;
  }
  out.push(`${p}\n    before: ${JSON.stringify(x)?.slice(0, 200)}\n    after:  ${JSON.stringify(y)?.slice(0, 200)}`);
}
walk(A, B, '');
process.stdout.write(`${out.length} differing path(s)\n${out.slice(0, 60).join('\n')}\n`);
process.exit(out.length ? 1 : 0);
