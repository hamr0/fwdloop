// F183 POC 3 ($0, no key, no network): a repair rule for the extra-closing-brace JSON shape. Never ships.
// Reads the saved raw answers read-only from the flows folder; writes nothing there.
// usage: node poc/f183-brace/repair.mjs [flowsRoot]
import fs from 'node:fs';
import path from 'node:path';
import { parseSignedText } from '../../src/signed-text.js';
import { validateDeclaration } from '../../src/declaration.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { WIRED_VERBS } from '../../src/primitives.js';
import { readEveryStep } from '../../src/whole-job.js';
import { goalForLine } from '../../src/drafter.js';

const root = process.argv[2] ?? path.join(process.env.HOME, '.config/fwdloop/flows');

// THE RULE: JSON.parse fails AND the text is a complete JSON object followed only by "}" (whitespace allowed).
function repair(text) {
  try { return { ok: true, value: JSON.parse(text), repaired: false }; } catch { /* fall through */ }
  const m = /^([\s\S]*?\})((?:\s*\})+)\s*$/.exec(text);
  // try every split where all that follows is braces/whitespace: drop 1..n trailing braces, parse
  const t = text.replace(/\s+$/, '');
  if (!m || !t.endsWith('}')) return { ok: false };
  let cut = t;
  for (;;) {
    cut = cut.slice(0, -1).replace(/\s+$/, '');
    if (!cut.endsWith('}')) return { ok: false };
    try {
      const v = JSON.parse(cut);
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v, repaired: true, dropped: t.length - cut.length };
      return { ok: false };
    } catch { /* drop one more brace */ }
  }
}
// LOOSENED rule (must be able to fail the negatives): drop any trailing junk, cutting back to any "}" that parses.
function loose(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch { /* fall through */ }
  for (let i = text.length - 1; i > 0; i -= 1) {
    if (text[i] !== '}') continue;
    try { return { ok: true, value: JSON.parse(text.slice(0, i + 1)) }; } catch { /* keep cutting */ }
  }
  return { ok: false };
}

// ---- collect the saved raws (read only)
const logs = [];
const draftsDir = path.join(root, '.drafts');
for (const d of fs.readdirSync(draftsDir)) for (const s of fs.readdirSync(path.join(draftsDir, d))) {
  const f = path.join(draftsDir, d, s, 'log.json');
  if (s.startsWith('draft') && fs.existsSync(f)) logs.push({ f, dir: path.join(draftsDir, d, s), parent: path.join(draftsDir, d) });
}
for (const fl of fs.readdirSync(root)) {
  if (fl.startsWith('.')) continue;
  const runs = path.join(root, fl, 'runs');
  if (!fs.existsSync(runs)) continue;
  for (const r of fs.readdirSync(runs)) { const f = path.join(runs, r, 'log.json'); if (fs.existsSync(f)) logs.push({ f, dir: path.dirname(f), parent: null }); }
}
const raws = [];
for (const L of logs) {
  const text = fs.readFileSync(L.f, 'utf8');
  if (!text.includes('not valid JSON')) continue;
  const j = JSON.parse(text);
  (j.log ?? []).forEach((e, i) => {
    if (typeof e.rawArguments === 'string' && String(e.outcome).includes('not valid JSON')) raws.push({ ...L, id: `${path.basename(L.parent ?? L.dir)}/${path.basename(L.dir)}#${i}`, raw: e.rawArguments, outcome: e.outcome });
  });
}

const cat = loadCatalogue();
function validate(obj, L) {
  const proseF = [path.join(L.dir, 'prose.txt'), L.parent && path.join(L.parent, 'prose.txt')].filter((p) => p && fs.existsSync(p))[0];
  if (!proseF) return { reds: ['(no prose.txt for this draft: validator not run)'], ran: false };
  const parsed = parseSignedText(fs.readFileSync(proseF, 'utf8'));
  if (!parsed.ok) return { reds: parsed.reds, ran: false };
  const { lines, arbiter } = parsed;
  const factsF = path.join(L.dir, 'input-facts.json');
  const { questions: _q, notChecked: _n, ...rest } = obj;
  const decl = { ...rest, inputFacts: fs.existsSync(factsF) ? JSON.parse(fs.readFileSync(factsF, 'utf8')) : {}, flowType: 'plain' };
  if (Array.isArray(decl.steps)) decl.steps = decl.steps.map((st) => (st && typeof st === 'object' ? { ...st, goal: goalForLine(st.fromLine, lines) } : st));
  if (Array.isArray(decl.steps)) decl.steps = readEveryStep(decl.steps, arbiter);
  const v = validateDeclaration(decl, { arbiter, lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true });
  return { reds: [...(v.reds ?? [])], ran: true, ok: v.ok };
}

let fails = 0;
const say = (ok, line) => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`); };

console.log(`raws with rawArguments: ${raws.length}`);
let braceN = 0;
for (const r of raws) {
  const isBrace = r.outcome.includes('non-whitespace');
  const rep = repair(r.raw);
  if (isBrace) {
    braceN += 1;
    const p = +/position (\d+)/.exec(r.outcome)[1];
    const cutObj = JSON.parse(r.raw.slice(0, p));
    const same = rep.ok && JSON.stringify(rep.value) === JSON.stringify(cutObj);
    const val = rep.ok ? validate(rep.value, r) : { reds: ['(not repaired)'], ran: false };
    const structural = val.reds.filter((x) => /structure|not valid JSON|must be an object|missing|unknown key|must be/i.test(x));
    say(rep.ok && rep.dropped >= 1 && same, `[brace] ${r.id}: repaired=${rep.ok} dropped=${rep.dropped} byte-identical-to-cut=${same}`);
    console.log(`        validator ran=${val.ran} ok=${val.ok} reds=${val.reds.length}${val.reds.length ? `; structural-looking=${structural.length}` : ''}`);
    for (const x of val.reds) console.log(`          red: ${x.slice(0, 160)}`);
  } else {
    say(!rep.ok, `[non-matching] ${r.id}: refused=${!rep.ok} (${r.outcome.slice(0, 70)}...)`);
  }
}
say(braceN > 0, `extra-brace raws found: ${braceN}`);

// ---- synthetic negatives (must stay refused) and positives
const obj = '{"a":1,"b":{"c":[1,2]}}';
const neg = {
  'trailing ]': `${obj}]`, 'trailing text': `${obj} thanks`, 'trailing }x': `${obj}}x`,
  'truncated object': '{"a":1,"b":{"c":[1,2]}', 'two objects {..}{..}': `${obj}${obj}`, 'array root + brace': '[1,2]}',
};
let looseAccepted = 0;
for (const [name, t] of Object.entries(neg)) {
  say(!repair(t).ok, `[negative] ${name}: refused by the rule`);
  if (loose(t).ok) looseAccepted += 1;
}
const pos = { 'one extra }': `${obj}}`, 'two extra }}': `${obj}}}`, 'extra } with whitespace': `${obj} }\n` };
for (const [name, t] of Object.entries(pos)) say(repair(t).ok && JSON.stringify(repair(t).value) === JSON.stringify(JSON.parse(obj)), `[positive] ${name}: repaired to the object`);

// ---- the POC can fail: the loosened rule accepts negatives the real rule refuses
console.log(`LOOSENED rule (any trailing junk) accepts ${looseAccepted} of ${Object.keys(neg).length} negatives: ${Object.entries(neg).filter(([, t]) => loose(t).ok).map(([n]) => n).join(', ')}`);
say(looseAccepted >= 1, 'the negatives can go red: the loosened rule accepts at least one');
console.log(fails ? `VERDICT: FAIL (${fails})` : 'VERDICT: PASS');
process.exit(fails ? 1 : 0);
