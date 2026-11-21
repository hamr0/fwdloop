// F249 candidate maker. NOT the product. $0. Copies src/ to .claude/scratch/f249/cand/src and patches the COPY: a `~` rule that counts list items, on a line with item fields (a shape line), becomes the shape
// part's item count (minItems / maxItems), not a countable pick over `text`. The real src/ is never written. Every replacement must match exactly once. `--off` leaves the count pick in place (F: the must-fail candidate).
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OFF = process.argv.includes('--off');
const out = path.join(root, '.claude/scratch/f249', OFF ? 'cand-off' : 'cand');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
cpSync(path.join(root, 'package.json'), path.join(out, 'package.json'));
const patch = (file, pairs) => {
  const f = path.join(out, 'src', file);
  let t = readFileSync(f, 'utf8');
  for (const [was, now] of pairs) { if (t.split(was).length !== 2) throw new Error(`${file}: not found exactly once: ${was.slice(0, 70)}`); t = t.replace(was, () => now); }
  writeFileSync(f, t);
};
const ON = OFF ? 'false' : 'true';
patch('checkblock.js', [
  // 1. after the rules are matched: a count-of-items rule on a shape line takes the shape count (the post-pass, so the order of the rules does not matter)
  ["      else if (r.kind === 'sheet') r.can = { ok: true, how: 'sheet' };\n    }\n",
   `      else if (r.kind === 'sheet') r.can = { ok: true, how: 'sheet' };
    }
    if (${ON}) {
      for (const r of this.rows) {
        if (r.kind !== 'rule' || r.left || r.can?.how === 'shape' || this.repo !== null || this.isSheetLine(r.line) || NEGATING_RE.test(String(r.text)) || !this.isShapeLine(r.line)) continue;
        const c = itemCountOf(r.text);
        if (c === null) continue;
        r.can = this.shapeDrops.rules.has(\`\${r.line}:\${r.rule}\`) ? { ok: false, why: REASON.dropped } : { ok: true, how: 'shape', count: c };
      }
    }
`],
  // 2. the shape part takes the rules' counts (intersected) beside the per-input count
  ["    const part = buildShapePart({ text: `the items of line ${l.n}`, fields: fields.map((f) => ({ name: f.name, spec: fieldSpec(f), rule: f.rule, by: f.by })), itemCount: b.itemCount });",
   `    const cr = shapeRows.filter((r) => r.can?.count);
    const ruleCount = cr.length ? { min: cr.map((r) => r.can.count.min).filter((x) => Number.isInteger(x)).reduce((a, x) => Math.max(a, x), -1), max: cr.map((r) => r.can.count.max).filter((x) => Number.isInteger(x)).reduce((a, x) => Math.min(a, x), Infinity) } : null;
    const part = buildShapePart({ text: \`the items of line \${l.n}\`, fields: fields.map((f) => ({ name: f.name, spec: fieldSpec(f), rule: f.rule, by: f.by })), itemCount: ruleCount ? { ...(ruleCount.min >= 0 ? { min: ruleCount.min } : {}), ...(Number.isFinite(ruleCount.max) ? { max: ruleCount.max } : {}) } : b.itemCount, countRules: cr.map((r) => Number(r.rule)) });`],
  ["import { isCountable, keepOrDrop, countCheck, obviousCheck, partOfPick, plainWords } from './blockpick.js';",
   `import { isCountable, keepOrDrop, countCheck, obviousCheck, partOfPick, plainWords } from './blockpick.js';
/** F249: the item count a \`~\` rule's own words ARE ("exactly 4 list items" -> 4..4, "at least 3" -> min 3, "at most 5" -> max 5), or null. "at most 0" is no count (bareguard maxItems is at least 1) @param {string} text @returns {{min?: number, max?: number}|null} */
function itemCountOf(text) {
  const c = /** @type {any} */ (countCheck(text));
  if (!c) return null;
  if (c.rule === 'listItems') return { min: c.value, max: c.value };
  if (c.rule === 'minListItems') return { min: c.value };
  if (c.rule === 'maxListItems' && c.value >= 1) return { max: c.value };
  return null;
}`],
]);
patch('shaperows.js', [
  ["export function buildShapePart({ text, fields, itemCount = null }) {\n  const rules = [...new Set(fields.filter((f) => Number.isInteger(f.rule)).map((f) => /** @type {number} */ (f.rule)))].sort((a, b) => a - b);",
   "export function buildShapePart({ text, fields, itemCount = null, countRules = [] }) {\n  const rules = [...new Set([...fields.filter((f) => Number.isInteger(f.rule)).map((f) => /** @type {number} */ (f.rule)), ...countRules])].sort((a, b) => a - b);"],
  ["    ...(itemCount ? { minItems: itemCount.n, maxItems: itemCount.n } : {}),",
   "    ...(itemCount && Number.isInteger(/** @type {any} */ (itemCount).n) ? { minItems: /** @type {any} */ (itemCount).n, maxItems: /** @type {any} */ (itemCount).n } : {}),\n    ...(itemCount && !Number.isInteger(/** @type {any} */ (itemCount).n) ? { ...(Number.isInteger(/** @type {any} */ (itemCount).min) ? { minItems: /** @type {any} */ (itemCount).min } : {}), ...(Number.isInteger(/** @type {any} */ (itemCount).max) ? { maxItems: /** @type {any} */ (itemCount).max } : {}) } : {}),"],
  ["/** why the truth of a shape line's items is not checked",
   "/** F249: the words of a rule's item count: exactly / at least / at most N items @param {{minItems?: number, maxItems?: number}} part @returns {string|null} */\nexport function shapeCountWords(part) {\n  const lo = Number.isInteger(part.minItems) ? part.minItems : null; const hi = Number.isInteger(part.maxItems) ? part.maxItems : null;\n  const s = (/** @type {number} */ n) => `${n} item${n === 1 ? '' : 's'}`;\n  if (lo !== null && hi !== null && lo === hi) return `the answer lists exactly ${s(lo)}`;\n  if (lo !== null && hi !== null) return `the answer lists ${lo} to ${s(hi)}`;\n  if (lo !== null) return `the answer lists at least ${s(lo)}`;\n  if (hi !== null) return `the answer lists at most ${s(hi)}`;\n  return null;\n}\n\n/** why the truth of a shape line's items is not checked"],
]);
patch('checkrows.js', [
  ["import { shapeRowsOf } from './shaperows.js';", "import { shapeRowsOf, shapeCountWords } from './shaperows.js';"],
  ["      out.push({ line, key: x.key, by: signed?.by ?? x.by, state: 'built', kind: kindOfCheck({ key: x.key, shape: true }), text: x.text, reason: null, idx, part: `L${line}:shape:${/** @type {any} */ (x).name ?? '$'}` });\n    }\n",
   `      out.push({ line, key: x.key, by: signed?.by ?? x.by, state: 'built', kind: kindOfCheck({ key: x.key, shape: true }), text: x.text, reason: null, idx, part: \`L\${line}:shape:\${/** @type {any} */ (x).name ?? '$'}\` });
    }
    // F249: a \`~\` rule whose count is the part's item count: its own \`[you]\` row, pointing at the shape part (the rule's count, in code's words)
    for (const r of list.filter((x) => isRec(x) && x.line === line && x.kind === 'rule' && x.by === 'you' && x.state === 'built' && isRec(x.part) && x.part.part === idx && !out.some((o) => o.key === x.key))) {
      const w = shapeCountWords(close.itemShape);
      if (w !== null) out.push({ line, key: r.key, by: 'you', state: 'built', kind: kindOfCheck({ key: r.key, shape: true }), text: w, reason: null, idx, part: \`L\${line}:shape:$\` });
    }
`],
]);
console.log(`candidate at ${out}${OFF ? ' (count pick left in place: the must-fail arm)' : ''}`);
