// F184 POC 4 ($0, no key, no network): does the validator catch a key a misplaced brace pushed up a level? Never ships.
// borrowed-from: poc/f183-brace/repair.mjs (repair rule, raw collection, validate)
// Reads the saved raw answers read-only from the flows folder; writes nothing there.
// usage: node poc/f184-misplaced/variants.mjs [flowsRoot]
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


// scan a valid JSON object text; return every object whose parent is an object and which has >= 2 keys
function scan(text) {
  const stack = []; const out = []; let inStr = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) { if (c === '\\') i += 1; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; if (stack.length) { const top = stack[stack.length - 1]; if (top.t === '{' && top.expectKey) { let j = i + 1; while (text[j] !== '"') { if (text[j] === '\\') j += 1; j += 1; } top.keys.push({ start: i, name: JSON.parse(text.slice(i, j + 1)) }); top.expectKey = false; } } continue; }
    if (c === '{' || c === '[') { stack.push({ t: c, open: i, keys: [], expectKey: c === '{', commas: [], parentKey: null }); const n = stack.length; if (n > 1) { const par = stack[n - 2]; stack[n - 1].parent = par.t; stack[n - 1].path = par.t === '{' ? [...(par.path ?? []), par.keys[par.keys.length - 1].name] : [...(par.path ?? []), '[]']; } else stack[0].path = []; stack[stack.length - 1].parent ??= null; continue; }
    if (c === ',') { const top = stack[stack.length - 1]; if (top.t === '{') { top.commas.push(i); top.expectKey = true; } continue; }
    if (c === '}' || c === ']') { const o = stack.pop(); if (c === '}' && o.parent === '{' && o.keys.length >= 2) out.push({ close: i, comma: o.commas[o.commas.length - 1], path: o.path.join('.'), lastKey: o.keys[o.keys.length - 1].name }); }
  }
  return out;
}
function moveClose(text, o) { return `${text.slice(0, o.comma)}}${text.slice(o.comma, o.close)}${text.slice(o.close + 1)}}`; }

let fails = 0;
const say = (ok, line) => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`); };
const redsOf = (v) => v.reds;
let total = 0; let caught = 0; let noop = 0; let uncaught = 0; let acceptedWithoutValidator = 0; let notRepairable = 0;
const catchReds = new Map(); const uncaughtList = [];
let braceN = 0; let origOk = 0; let origRed = 0;
for (const r of raws) {
  if (!r.outcome.includes('non-whitespace')) continue;
  braceN += 1;
  const rep = repair(r.raw);
  const t = r.raw.replace(/\s+$/, '');
  let cut = t; for (let k = 0; k < rep.dropped; k += 1) cut = cut.slice(0, -1);
  cut = cut.replace(/\s+$/, '');
  const orig = JSON.parse(cut);
  const ov = validate(orig, r);
  if (ov.ok) origOk += 1; else origRed += ov.reds.length ? 1 : 0;
  const origReds = new Set(redsOf(ov));
  const all = scan(cut);
  const pick = all.length <= 30 ? all : Array.from({ length: 30 }, (_, i) => all[Math.floor((i * all.length) / 30)]);
  console.log(`${r.id}: original validator ok=${ov.ok} reds=${origReds.size}; movable objects ${all.length}, variants ${pick.length}`);
  for (const o of pick) {
    const vt = moveClose(cut, o);
    const vr = repair(vt);
    if (!vr.ok) { notRepairable += 1; say(false, `  variant ${o.path}.${o.lastKey}: does not parse after the repair rule`); continue; }
    total += 1;
    const same = JSON.stringify(vr.value) === JSON.stringify(orig);
    if (same) { noop += 1; continue; }
    const vv = validate(vr.value, r);
    const fresh = redsOf(vv).filter((x) => !origReds.has(x));
    if (fresh.length) {
      caught += 1; acceptedWithoutValidator += 1; // repair alone parsed it: skipping the validator accepts it
      const key = fresh[0].replace(/steps\[\d+\]/g, "steps[n]").slice(0, 150);
      catchReds.set(key, (catchReds.get(key) ?? 0) + 1);
    } else { uncaught += 1; uncaughtList.push(`${r.id}: ${o.path || '(root)'}.${o.lastKey} escaped to ${o.path ? `${o.path}'s parent` : 'root'}`); }
  }
}
say(braceN === 11, `extra-brace raws: ${braceN}`);
say(origOk === 9 && origRed === 2, `originals reproduce POC 3: ${origOk} ok, ${origRed} with a red`);
say(notRepairable === 0, `every variant parses after the repair rule (not repairable: ${notRepairable})`);
console.log(`variants ${total}; caught ${caught}; no-op ${noop}; uncaught-and-different ${uncaught}`);
for (const u of uncaughtList) console.log(`  UNCAUGHT ${u}`);
say(uncaught === 0, 'every variant is caught or a no-op');
console.log('validator reds that catch a moved key:');
for (const [k, n] of [...catchReds].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${k}`);
say(acceptedWithoutValidator > 0, `CAN FAIL: ${acceptedWithoutValidator} caught variants would be accepted by repair alone (validator skipped)`);
console.log(fails ? `VERDICT: FAIL (${fails})` : 'VERDICT: PASS');
process.exit(fails ? 1 : 0);
