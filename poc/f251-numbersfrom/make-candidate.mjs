// F251 candidate maker. NOT the product. $0. Copies src/ to .claude/scratch/f251-numbersfrom/candidate[-nodrop]/src and patches the COPY: one place (the check block) decides that a line with no `~` guardrail of the person's own
// holds no fact, pick or shape part; NO_GUARDRAIL_WORDS moves to checkblock.js. `--nodrop` also removes blockassemble's own `guarded()` drop (is it dead after the move?). The real src/ is never written.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODROP = process.argv.includes('--nodrop');
const TRIALSKIP = !process.argv.includes('--no-trialskip');
const out = path.join(root, '.claude/scratch/f251-numbersfrom', NODROP ? 'candidate-nodrop' : 'candidate');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
cpSync(path.join(root, 'package.json'), path.join(out, 'package.json'));
symlinkSync(path.join(root, 'node_modules'), path.join(out, 'node_modules'));
const patch = (file, pairs) => {
  const f = path.join(out, 'src', file);
  let t = readFileSync(f, 'utf8');
  for (const [was, now] of pairs) { if (t.split(was).length !== 2) throw new Error(`${file}: not found exactly once: ${was.slice(0, 70)}`); t = t.replace(was, () => now); }
  writeFileSync(f, t);
};
patch('checkblock.js', [
  ["/** the plain reasons code gives, in one place (the card, the Job tab and the Audit read them from the row) */",
   "// fwd (F251): what a row says when its check cannot ride a line that has no guardrail of its own (the class of a line comes from its guardrail); one writer, here (blockassemble.js re-exports it)\nexport const NO_GUARDRAIL_WORDS = 'This line has no guardrail of yours, so a check on it cannot be signed; you judge it at Accept.';\n\n/** the plain reasons code gives, in one place (the card, the Job tab and the Audit read them from the row) */"],
  ["  buildLine(/** @type {{n: number, text: string}} */ l, /** @type {any[]} */ lineParts, /** @type {string[][]} */ lineRows, /** @type {Set<number>} */ factLines) {\n",
   "  buildLine(/** @type {{n: number, text: string}} */ l, /** @type {any[]} */ lineParts, /** @type {string[][]} */ lineRows, /** @type {Set<number>} */ factLines, /** @type {boolean} */ offer = false) {\n    // fwd (F251): a line with no ~ guardrail of the person's own holds no signable check; one decider, here\n    const unguarded = this.ruleRows(l.n).length === 0 && !this.isSheetLine(l.n);\n    let foundFact = false;\n"],
  ["lineRows.push([...factRows.map((f) => f.r.key), ...(countRow ? [countRow.key] : [])]); factLines.add(l.n);",
   "lineRows.push([...factRows.map((f) => f.r.key), ...(countRow ? [countRow.key] : [])]); foundFact = true;"],
  ["    for (const { p, key } of pickParts) { lineParts.push(p); lineRows.push([key]); }\n    this.buildDefaults(l, lineParts, lineRows, factLines);\n",
   `    for (const { p, key } of pickParts) { lineParts.push(p); lineRows.push([key]); }
    // fwd (F251): the one decider. A line with no ~ guardrail keeps no fact, pick or shape part: its built rows are Not checked in the words the Accept reads, and it is never a fact line (so no numbers tie points at it)
    if (unguarded${TRIALSKIP ? ' && !offer' : ''}) {
      for (const k of lineRows.flat()) { const row = this.rows.find((x) => x.key === k); if (row) { row.state = 'not-checked'; row.reason = NO_GUARDRAIL_WORDS; row.part = null; } }
      lineParts.length = 0; lineRows.length = 0;
    } else if (foundFact) factLines.add(l.n);
    this.buildDefaults(l, lineParts, lineRows, factLines);
`],
  ["    if (this.split) for (const r of this.rows) r.hidden = this.isBang(r) && r.state === 'not-checked' && !r.lookWhy;",
   "    if (this.split) for (const r of this.rows) r.hidden = this.isBang(r) && r.state === 'not-checked' && !r.lookWhy && r.reason !== NO_GUARDRAIL_WORDS;"],
  ["    this.buildLine(l, parts, rows, new Set());\n    const ok = r.state === 'built';",
   "    this.buildLine(l, parts, rows, new Set(), true);\n    const ok = r.state === 'built';"],
]);
if (NODROP) {
  patch('blockassemble.js', [
    ["/** what a row says when its check cannot ride a line that has no guardrail of its own (the class of a line comes from its guardrail) */\nexport const NO_GUARDRAIL_WORDS = 'This line has no guardrail of yours, so a check on it cannot be signed; you judge it at Accept.';\n", "export { NO_GUARDRAIL_WORDS } from './checkblock.js';\nimport { NO_GUARDRAIL_WORDS } from './checkblock.js';\n"],
    ["    const signable = guarded(n);\n", "    const signable = true;\n"],
  ]);
} else {
  patch('blockassemble.js', [
    ["/** what a row says when its check cannot ride a line that has no guardrail of its own (the class of a line comes from its guardrail) */\nexport const NO_GUARDRAIL_WORDS = 'This line has no guardrail of yours, so a check on it cannot be signed; you judge it at Accept.';\n", "export { NO_GUARDRAIL_WORDS } from './checkblock.js';\nimport { NO_GUARDRAIL_WORDS } from './checkblock.js';\n"],
  ]);
}
console.log('wrote', out, NODROP ? '(nodrop)' : '', TRIALSKIP ? '' : '(no trialskip)');
