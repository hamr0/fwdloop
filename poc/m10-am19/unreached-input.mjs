// F147 (pre-registered in docs/logs/FINDINGS.md): M10 am19, $0, no src/ change, no provider, no key, no `pass`.
// The am19 rule as POC code only: every Inputs line's name must be granted to at least one MODEL step (not an ask step, not the send step),
// through its tool or in its `reads`; else the plan fails with `Input "<role>" is read by no step.`
// Run: node poc/m10-am19/unreached-input.mjs   (reads ~/.config/fwdloop/flows read-only; exit 1 if any bar is not as registered)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCatalogue } from '../../src/catalogue.js';
import { validateDeclaration } from '../../src/declaration.js';
import { WIRED_VERBS } from '../../src/primitives.js';
import { parseSignedText } from '../../src/signed-text.js';

const FLOWS = path.join(os.homedir(), '.config', 'fwdloop', 'flows');
const cat = loadCatalogue();
if (!cat.ok) throw new Error(cat.reds.join('; '));

// How a frozen input reaches a step at run time (read from src/primitives.js rolePrimitiveFor + sandboxedReadTool/GrepTool, src/runner.js freezeInputs/readsMap):
//   md/txt file, and every page/ticket (frozen as <role>.txt): the `read` or `grep` tool by role, or the role in `reads` (runner hands the frozen text);
//   docx: the `readDocx` tool by role (`read` refuses it by name); csv: the `addressCells` tool by role, or the role in `reads` (`read` refuses a csv by name).
const ownerVerbs = (s) => {
  if (s.kind === 'page') return ['read', 'grep'];
  const ext = path.extname(String(s.path)).toLowerCase();
  if (ext === '.md' || ext === '.txt') return ['read', 'grep'];
  if (ext === '.docx') return ['readDocx'];
  if (ext === '.csv') return ['addressCells'];
  return [];
};

/** exact test: the reds of the plan (declaration + parsed signed text), one per unreached input */
export function unreachedInputs(declaration, arbiter, { literal = false } = {}) {
  const askLines = (arbiter.asks ?? []).map((a) => a.line);
  const sendLines = (arbiter.sends ?? []).map((s) => s.line);
  const model = (declaration.steps ?? []).filter((st) => !askLines.includes(st.fromLine) && !sendLines.includes(st.fromLine));
  const reds = [];
  for (const s of arbiter.sources ?? []) {
    const verbs = literal ? ['read'] : ownerVerbs(s);
    const hit = model.some((st) => (st.reads ?? []).includes(s.role) || (st.primitives ?? []).some((v) => verbs.includes(v)));
    if (!hit) reds.push(`Input "${s.role}" is read by no step.`);
  }
  return reds;
}

function load(name) {
  const d = path.join(FLOWS, name, 'signed');
  const signed = parseSignedText(readFileSync(path.join(d, 'prose.txt'), 'utf8'));
  const declaration = JSON.parse(readFileSync(path.join(d, 'declaration.json'), 'utf8'));
  return { signed, declaration };
}
const baseline = ({ signed, declaration }) => validateDeclaration(declaration, {
  arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
});

const results = [];
const bar = (id, pass, text) => { results.push(pass); console.log(`(${id}) ${pass ? 'PASS' : 'FAIL'}: ${text}`); };

// (a) walk-7 red naming notes; (b) walk-6 green
const w7 = load('m14-walk-7'); const w6 = load('m14-walk-6');
const r7 = unreachedInputs(w7.declaration, w7.signed.arbiter); const r6 = unreachedInputs(w6.declaration, w6.signed.arbiter);
bar('a', r7.length === 1 && r7[0] === 'Input "notes" is read by no step.', `walk-7 -> ${JSON.stringify(r7)}`);
bar('b', r6.length === 0, `walk-6 -> ${JSON.stringify(r6)}`);

// (c) rescan every signed job
const names = readdirSync(FLOWS).filter((n) => !n.startsWith('.') && existsSync(path.join(FLOWS, n, 'signed', 'prose.txt')));
const good = []; const preRefused = [];
// the 33 of the am16 rescan = signed jobs - the 4 cite-form jobs (refused by the baseline below) - m14-walk-1 (F135) and m14-walk-3-2 (F137), refused by their own earlier checks
const EARLIER = ['m14-walk-1', 'm14-walk-3-2'];
for (const n of names) { const v = baseline(load(n)); (v.ok && !EARLIER.includes(n) ? good : preRefused).push(n); }
console.log(`signed jobs ${names.length}; good set ${good.length}; out of it before am19: ${preRefused.join(', ')}`);
const refused = []; const literalRefused = [];
for (const n of good) {
  const { signed, declaration } = load(n);
  const r = unreachedInputs(declaration, signed.arbiter); if (r.length) refused.push([n, r]);
  const l = unreachedInputs(declaration, signed.arbiter, { literal: true }); if (l.length) literalRefused.push([n, l]);
}
for (const [n, r] of refused) console.log(`  refused (exact): ${n}: ${r.join(' ')}`);
for (const [n, r] of literalRefused) console.log(`  refused (literal "read tool or reads" only): ${n}: ${r.join(' ')}`);
// the same rule over the jobs the baseline already refused, for the record
for (const n of preRefused) { const { signed, declaration } = load(n); const r = unreachedInputs(declaration, signed.arbiter); console.log(`  (record) pre-refused ${n}: am19 ${r.length ? r.join(' ') : 'green'}`); }
bar('c', refused.length === 0, `${good.length} baseline-good signed jobs, ${refused.length} refused by the exact test, ${literalRefused.length} by the literal test`);

// (e) must-fail: (a) goes green when the check is broken, red again when restored
const broken = (d, a) => { void d; void a; return []; }; // the check broken: never reds
const redNow = unreachedInputs(w7.declaration, w7.signed.arbiter).length === 1;
const greenBroken = broken(w7.declaration, w7.signed.arbiter).length === 0;
const redRestored = unreachedInputs(w7.declaration, w7.signed.arbiter).length === 1;
bar('e', redNow && greenBroken && redRestored, `walk-7: red -> check broken: green -> restored: red`);
// and a plan edited so a step is granted read goes green (the check judges the plan, not the name)
const fixed = structuredClone(w7.declaration); fixed.steps[0].primitives = ['read'];
bar('e2', unreachedInputs(fixed, w7.signed.arbiter).length === 0, 'walk-7 with step 1 granted read -> green');

process.exit(results.every(Boolean) ? 0 : 1);
