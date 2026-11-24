// F258 ($0): M19 am15a on real saved drafts. usage: node run.mjs <srcRoot> <label> [eligible.json]
// <srcRoot> = a prototype root made by make-proto.sh (p15a or p257). Read only on the drafts: each plan dir is copied to .claude/scratch/f258/work first.
// label p15a decides the eligible set and writes eligible-p15a.json; label p257 reads it (same drafts, same row keys).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [srcRootArg, label, eligArg] = process.argv.slice(2);
const srcRoot = path.resolve(srcRootArg);
const repo = path.resolve(import.meta.dirname, '../..');
const here = import.meta.dirname;
const imp = (f) => import(path.join(srcRoot, 'src', f));
const { rebuildBlock, __assembleAgain } = await imp('planrebuild.js');
const { validateDeclaration } = await imp('declaration.js');
const { loadCatalogue } = await imp('catalogue.js');
const { WIRED_VERBS } = await imp('primitives.js');
const { docRolesOf } = await imp('drafter.js');
const cat = loadCatalogue();
const work = path.join(repo, '.claude/scratch/f258/work', label);
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const pre = eligArg ? JSON.parse(fs.readFileSync(eligArg, 'utf8')) : null;

const found = new Set();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!process.env.FIXTURE_DIR && (e.name === 'f257' || e.name === 'f258')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'declaration.json' && p.includes('/.drafts/')) found.add(fs.realpathSync(p)); } };
if (process.env.FIXTURE_DIR) walk(path.resolve(process.env.FIXTURE_DIR));
else for (const d of [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(repo, '.claude/scratch')]) if (fs.existsSync(d)) walk(d);
const unlock = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(p, 0o755); unlock(p); } else fs.chmodSync(p, 0o644); } };
const ctxOf = (b) => {
  const inPlan = new Set(b.block.rows.filter((r) => r.state === 'built').flatMap((r) => (r.factNames ?? []).map((nm) => `${r.line}:${nm}`)));
  const planFacts = b.look.facts.filter((f) => !b.lineSet.has(f.line) || inPlan.has(`${f.line}:${f.name}`));
  const pageSources = (b.parsed.arbiter.sources ?? []).some((s) => s.kind === 'page');
  return { arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true, pageWords: { texts: b.texts, look: pageSources ? { facts: planFacts, dropped: b.look.dropped } : null, docs: docRolesOf(b.parsed.arbiter.sources) } };
};
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const KINDS = ['fact', 'phrase', 'count'];
const out = { label, srcRoot, drafts: 0, withCheckList: 0, rebuilt: 0, ineligible: {}, eligibleDrafts: 0, eligibleRows: 0,
  bar1: { rowsBuilt: 0, rowsNotBuilt: 0, draftsClassOk: 0, badClass: [], noGC: [], assembleRed: [], validateRed: [], indepRed: [] },
  bar2: { tried: 0, ok: 0, fail: [] },
  bar3: { control: 0, controlRed: [], a: 0, b: 0, aFail: [], bFail: [], cForgedPasses: 0, cForgedRed: 0 },
  info: { derivedHeldRows: 0, derivedStates: {}, draftsWithDerivedBuiltAnyKind: 0 }, notes: [] };
const eligOut = {};
let idx = 0; const t0 = Date.now();
for (const f of found) {
  out.drafts++;
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  if (!Array.isArray(d.checkList)) continue;
  out.withCheckList++;
  const src = path.dirname(f);
  const planDir = path.join(work, `p${idx++}`);
  fs.cpSync(src, planDir, { recursive: true }); fs.chmodSync(planDir, 0o755); unlock(planDir);
  try {
    const open = () => rebuildBlock({ planDir, asks: true });
    const b = open();
    if (!b.ok) { bump(out.ineligible, `rebuild: ${b.say}`.slice(0, 80)); continue; }
    out.rebuilt++;
    const asks = new Set(b.parsed.arbiter.asks.map((a) => a.line));
    const sends = new Set((b.parsed.arbiter.sends ?? []).map((s) => s.line));
    const noTilde = new Set(b.lines.filter((l) => !l.guardrail && !asks.has(l.n) && !sends.has(l.n) && b.lineSet.has(l.n) && !b.block.isSheetLine(l.n)).map((l) => l.n));
    const isCand = (r) => r.by === 'agent' && KINDS.includes(r.kind) && r.derived && noTilde.has(r.line);
    const cands = b.block.rows.filter(isCand);
    for (const r of cands) { out.info.derivedStates[r.state + (r.held ? '+held' : '')] = (out.info.derivedStates[r.state + (r.held ? '+held' : '')] ?? 0) + 1; }
    const id = f;
    // the eligible set: p15a decides (built); p257 reads p15a's keys
    const keys = pre ? (pre[id] ?? []) : cands.filter((r) => r.state === 'built').map((r) => r.key);
    if (!keys.length) { bump(out.ineligible, cands.length ? 'a derived row is on a no-~ line but code did not build it' : 'no derived ! row on a no-~ line'); continue; }
    const rows = keys.map((k) => b.block.rows.find((r) => r.key === k)).filter(Boolean);
    if (!rows.length) { bump(out.ineligible, 'key missing on this arm'); continue; }
    out.eligibleDrafts++; out.eligibleRows += rows.length; eligOut[id] = keys;
    const lines = [...new Set(rows.map((r) => r.line))];
    const stepOf = (decl, n) => decl.steps.find((s) => s.fromLine === n);
    // bar 1
    for (const r of rows) { if (r.state === 'built') out.bar1.rowsBuilt++; else out.bar1.rowsNotBuilt++; }
    const asm = __assembleAgain(b);
    const tag = path.basename(path.dirname(src));
    if (!asm.ok) { out.bar1.assembleRed.push(`${tag}: ${asm.say}`.slice(0, 200)); continue; }
    let allCls = true;
    for (const n of lines) {
      const cls = stepOf(asm.declaration, n)?.close?.class;
      if (!cls || cls === 'hitl') { allCls = false; out.bar1.badClass.push(`${tag} line ${n}: ${cls}`); }
      else if (asm.declaration.guardrailClasses?.[String(n)] !== cls) { allCls = false; out.bar1.noGC.push(`${tag} line ${n}`); }
    }
    const v = validateDeclaration(asm.declaration, ctxOf(b));
    if (!v.ok) out.bar1.validateRed.push(`${tag}: ${String(v.reds[0]).slice(0, 120)}`);
    // independent: write the files, re-read, re-validate
    const newDir = path.join(work, `p${idx - 1}-asm`);
    fs.cpSync(planDir, newDir, { recursive: true }); fs.chmodSync(newDir, 0o755); unlock(newDir);
    fs.writeFileSync(path.join(newDir, 'declaration.json'), `${JSON.stringify(asm.declaration, null, 2)}\n`);
    const b2 = rebuildBlock({ planDir: newDir, asks: true });
    if (!b2.ok) out.bar1.indepRed.push(`${tag}: rebuild ${b2.say}`.slice(0, 120));
    else { const v2 = validateDeclaration(JSON.parse(fs.readFileSync(path.join(newDir, 'declaration.json'), 'utf8')), ctxOf(b2)); if (!v2.ok) out.bar1.indepRed.push(`${tag}: ${String(v2.reds[0]).slice(0, 120)}`); }
    if (allCls && v.ok) out.bar1.draftsClassOk++;
    // bar 2: Drop every eligible row of the first line; the step returns to hitl
    const n0 = lines[0];
    const bd = open();
    out.bar2.tried++;
    let dropOk = true; const why = [];
    for (const r of bd.block.rows.filter((r) => keys.includes(r.key) && r.line === n0)) { const res = bd.block.rowChoice(r.key, 'drop'); if (!res.ok) { dropOk = false; why.push(`drop refused: ${res.why}`); } }
    const ad = __assembleAgain(bd);
    if (!ad.ok) { dropOk = false; why.push(`assemble: ${ad.say}`.slice(0, 120)); }
    else {
      const s2 = stepOf(ad.declaration, n0);
      if (s2?.close?.class !== 'hitl') { dropOk = false; why.push(`class ${s2?.close?.class}`); }
      if (ad.declaration.guardrailClasses?.[String(n0)] !== undefined) { dropOk = false; why.push('guardrailClasses key stays'); }
      const left = keys.filter((k) => rows.find((r) => r.key === k)?.line === n0).map((k) => ad.declaration.checkList.find((x) => x.key === k)).filter((x) => x?.state !== 'dropped');
      if (left.length) { dropOk = false; why.push(`row state ${left[0]?.state}`); }
      // bar 3, on the after-Drop declaration (no code-built row behind the line): the drafter's class alone
      const ctx = ctxOf(bd);
      const ctl = validateDeclaration(ad.declaration, ctx);
      if (!ctl.ok) out.bar3.controlRed.push(`${tag}: ${String(ctl.reds[0]).slice(0, 100)}`);
      else {
        out.bar3.control++;
        const mod = (gc, forge) => { const x = structuredClone(ad.declaration); const st = stepOf(x, n0); st.close = { ...(st.close ?? {}), class: 'softgreen' }; if (gc) x.guardrailClasses = { ...(x.guardrailClasses ?? {}), [String(n0)]: 'softgreen' }; if (forge) x.checkList = [...(x.checkList ?? []), { key: 'forged', line: n0, by: 'agent', state: 'built', kind: 'fact' }]; return x; };
        const va = validateDeclaration(mod(false, false), ctx); const vb = validateDeclaration(mod(true, false), ctx); const vc = validateDeclaration(mod(true, true), ctx);
        if (!va.ok && va.reds.some((x) => /close\.class "softgreen" does not match "hitl"/.test(String(x)))) out.bar3.a++; else out.bar3.aFail.push(tag);
        if (!vb.ok) out.bar3.b++; else out.bar3.bFail.push(tag);
        if (vc.ok) out.bar3.cForgedPasses++; else out.bar3.cForgedRed++;
      }
    }
    if (dropOk) out.bar2.ok++; else out.bar2.fail.push(`${tag}: ${why.join('; ')}`);
  } catch (e) { bump(out.ineligible, `THREW ${String(e?.message).slice(0, 80)}`); }
  fs.rmSync(planDir, { recursive: true, force: true }); fs.rmSync(path.join(work, `p${idx - 1}-asm`), { recursive: true, force: true });
}
out.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.join(here, `results-${label}.json`), JSON.stringify(out, null, 1));
if (!pre) fs.writeFileSync(path.join(here, `eligible-${label}.json`), JSON.stringify(eligOut, null, 1));
console.log(JSON.stringify(out, null, 1));
