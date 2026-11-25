// F257 ($0): M19 am15 on real saved drafts, through the panel's own row-edit route. usage: node run.mjs <srcRoot> <label>
// <srcRoot> = a root holding src/ (the repo = old code; .claude/scratch/f257/proto = prototype). Read only on the drafts: each plan dir is copied to .claude/scratch/f257/work first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [srcRootArg, label] = process.argv.slice(2);
const srcRoot = path.resolve(srcRootArg);
const repo = path.resolve(import.meta.dirname, '../..');
const imp = (f) => import(path.join(srcRoot, 'src', f));
const { rebuildBlock, rowEditPlan } = await imp('planrebuild.js');
const { validateDeclaration } = await imp('declaration.js');
const { loadCatalogue } = await imp('catalogue.js');
const { WIRED_VERBS } = await imp('primitives.js');
const { docRolesOf } = await imp('drafter.js');
const { buildShapes } = await imp('shapebuild.js');
const { SHAPE_KINDS } = await imp('shapemenu.js');
const { PAGES_DIR } = await imp('authoring.js');
const cat = loadCatalogue();
const work = path.join(repo, '.claude/scratch/f257/work', label);
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });

const found = new Set();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'f257') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'declaration.json' && p.includes('/.drafts/')) found.add(fs.realpathSync(p)); } };
for (const d of [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(repo, '.claude/scratch')]) if (fs.existsSync(d)) walk(d);

const ctxOf = (b) => {
  const inPlan = new Set(b.block.rows.filter((r) => r.state === 'built').flatMap((r) => (r.factNames ?? []).map((nm) => `${r.line}:${nm}`)));
  const planFacts = b.look.facts.filter((f) => !b.lineSet.has(f.line) || inPlan.has(`${f.line}:${f.name}`));
  const pageSources = (b.parsed.arbiter.sources ?? []).some((s) => s.kind === 'page');
  return { arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true, pageWords: { texts: b.texts, look: pageSources ? { facts: planFacts, dropped: b.look.dropped } : null, docs: docRolesOf(b.parsed.arbiter.sources) } };
};
const CLASS_RED = /does not match|does not name a signed line with a guardrail/;
const out = { label, srcRoot, drafts: 0, withCheckList: 0, rebuilt: 0, notRebuilt: 0, reproduces: 0, eligible: 0, ineligible: {}, bar1: { attempts: 0, ok: 0, classRule: 0, other: {}, draftsOk: 0, draftsAllOk: 0, shapeOfOk: { badClass: 0, noRow: 0, noGC: 0, indepRed: 0 } }, bar2: { control: 0, controlRed: 0, a: 0, b: 0, aFail: [], bFail: [] }, bar3: { tried: 0, ok: 0, fail: [] }, bar4: { drafts: 0, reproducible: 0, refusedOwn: 0, other: [], builtAfterAdd: 0, addTried: 0 }, bar5: { draftsChecked: 0, shapeRowsOnNoTilde: 0, armB: { drafts: 0, builderBuilt: 0, rowsAppeared: 0 }, armBforced: { drafts: 0, rowsAppeared: 0 } }, notes: [] };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const t0 = Date.now();
let idx = 0;
for (const f of found) {
  out.drafts++;
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  if (!Array.isArray(d.checkList)) continue;
  out.withCheckList++;
  const src = path.dirname(f);
  const planDir = path.join(work, `p${idx++}`);
  fs.cpSync(src, planDir, { recursive: true });
  const unlock = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(p, 0o755); unlock(p); } else fs.chmodSync(p, 0o644); } };
  fs.chmodSync(planDir, 0o755); unlock(planDir);
  try {
    const b = rebuildBlock({ planDir, asks: true });
    if (!b.ok) { out.notRebuilt++; bump(out.ineligible, `rebuild: ${b.say}`.slice(0, 80)); continue; }
    out.rebuilt++;
    const probe = rowEditPlan({ planDir, op: 'add', key: 'no-such-row' });
    const reproduces = probe.ok === false && probe.refused === 'bad-row';
    if (reproduces) out.reproduces++;
    const asks = new Set(b.parsed.arbiter.asks.map((a) => a.line));
    const sends = new Set((b.parsed.arbiter.sends ?? []).map((s) => s.line));
    const noTilde = new Set(b.lines.filter((l) => !l.guardrail && !asks.has(l.n) && !sends.has(l.n)).map((l) => l.n));
    // bar 5 arm A + bar 4 (rows)
    if (noTilde.size) out.bar5.draftsChecked++;
    out.bar5.shapeRowsOnNoTilde += b.block.rows.filter((r) => r.kind === 'shape' && noTilde.has(r.line)).length;
    // bar 5 arm B: the real shape builder is handed a no-~ line; does the block make a row there?
    const sheetOrTied = (n) => b.block.isSheetLine(n) || !b.lineSet.has(n);
    const nl = [...noTilde].find((n) => !sheetOrTied(n) && b.block.lines.some((l) => l.n === n));
    if (nl !== undefined) {
      out.bar5.armB.drafts++;
      const kind = Object.hasOwn(SHAPE_KINDS, 'text') ? 'text' : Object.keys(SHAPE_KINDS)[0];
      const jl = b.block.lines.find((l) => l.n === nl);
      const built = buildShapes({ lines: [jl], labels: b.block.labels, suggestions: [{ line: nl, extraFields: [{ name: 'title', kind, required: true }] }] });
      if (built.built[nl]) {
        out.bar5.armB.builderBuilt++;
        b.block.setShape(built); b.block.reconcile();
        if (b.block.rows.some((r) => r.kind === 'shape' && r.line === nl)) out.bar5.armB.rowsAppeared++;
      }
    }
    // arm B': the builder refuses a no-~ line (it needs a field of the person's own rule), so hand the block a shape built BY HAND for that line: the block's own gate (isShapeLine) is what is tested
    if (nl !== undefined) {
      out.bar5.armBforced.drafts++;
      const kind = Object.hasOwn(SHAPE_KINDS, 'text') ? 'text' : Object.keys(SHAPE_KINDS)[0];
      b.block.setShape({ built: { [nl]: { line: nl, ok: true, fields: [{ name: 'title', kind, required: true, bounds: {}, rule: null, by: 'agent', held: false }], itemCount: null, rows: [], refused: [], reservedChecked: true } }, notChecked: {}, refused: [] });
      if (b.block.rows.some((r) => r.kind === 'shape' && r.line === nl)) out.bar5.armBforced.rowsAppeared++;
    }
    // bar 4
    const b4 = rebuildBlock({ planDir, asks: true });
    const dollar = b4.block.rows.filter((r) => r.by === 'default' && r.kind === 'numbers' && r.state === 'built' && noTilde.has(r.line));
    if (dollar.length) {
      out.bar4.drafts++;
      if (reproduces) {
        out.bar4.reproducible++;
        const r = rowEditPlan({ planDir, op: 'drop', key: dollar[0].key });
        if (!r.ok && r.refused === 'bad-row' && /code's own and stays/.test(r.say)) out.bar4.refusedOwn++; else out.bar4.other.push(`${path.basename(path.dirname(src))}: ${r.ok ? 'dropped' : r.say}`.slice(0, 160));
      }
    }
    // eligibility: a suggested `!` row on a no-~ line
    const sug = b4.block.rows.filter((r) => r.state === 'suggested' && r.by === 'agent' && ['fact', 'phrase', 'count'].includes(r.kind) && noTilde.has(r.line));
    if (!sug.length) { bump(out.ineligible, reproduces ? 'no suggested ! row on a no-~ line' : 'no suggested row and does not reproduce'); continue; }
    if (!reproduces) { bump(out.ineligible, `does not reproduce its saved plan: ${probe.say}`.slice(0, 80)); continue; }
    out.eligible++;
    const id = path.basename(path.dirname(src));
    // bar 2 (no Add): the drafter's class on a no-~ line stays red
    const L = sug[0].line;
    const ctx = ctxOf(b);
    const ctl = validateDeclaration(b.declaration, ctx);
    if (!ctl.ok) { out.bar2.controlRed++; out.notes.push(`${id}: saved declaration is red already: ${String(ctl.reds[0]).slice(0, 100)}`); }
    else {
      out.bar2.control++;
      const mod = (withKey) => { const x = structuredClone(b.declaration); const st = x.steps.find((s) => s.fromLine === L); st.close = { ...(st.close ?? {}), class: 'softgreen' }; if (withKey) x.guardrailClasses = { ...(x.guardrailClasses ?? {}), [String(L)]: 'softgreen' }; return x; };
      const va = validateDeclaration(mod(false), ctx); const vb = validateDeclaration(mod(true), ctx);
      if (!va.ok && va.reds.some((r) => /close\.class "softgreen" does not match "hitl"/.test(String(r)))) out.bar2.a++; else out.bar2.aFail.push(id);
      if (!vb.ok) out.bar2.b++; else out.bar2.bFail.push(id);
    }
    // bar 1: Add each suggested row; the first ok one also goes to bars 3 and 4
    let firstOk = null; let allOk = true;
    for (const r of sug) {
      out.bar1.attempts++;
      const res = rowEditPlan({ planDir, op: 'add', key: r.key });
      if (!res.ok) { allOk = false; if (CLASS_RED.test(res.say)) out.bar1.classRule++; bump(out.bar1.other, res.say.replace(/\d+/g, 'N').slice(0, 140)); continue; }
      out.bar1.ok++;
      if (!firstOk) firstOk = { r, res };
    }
    if (allOk) out.bar1.draftsAllOk++;
    if (!firstOk) continue;
    out.bar1.draftsOk++;
    const { r, res } = firstOk;
    const nd = JSON.parse(res.files['declaration.json']);
    const step = nd.steps.find((s) => s.fromLine === r.line);
    const cls = step?.close?.class;
    if (!cls || cls === 'hitl') out.bar1.shapeOfOk.badClass++;
    if (!nd.checkList.some((x) => x.line === r.line && x.by === 'agent' && x.state === 'built')) out.bar1.shapeOfOk.noRow++;
    if (nd.guardrailClasses?.[String(r.line)] !== cls) out.bar1.shapeOfOk.noGC++;
    // the new plan folder (the files the Add returned), then the independent validate and bar 3's Drop on it
    const newDir = path.join(work, `p${idx - 1}-added`);
    fs.cpSync(planDir, newDir, { recursive: true });
    fs.chmodSync(newDir, 0o755); unlock(newDir);
    const put = (rel, text) => { fs.rmSync(path.join(newDir, rel), { force: true }); fs.mkdirSync(path.dirname(path.join(newDir, rel)), { recursive: true }); fs.writeFileSync(path.join(newDir, rel), text); };
    for (const [rel, text] of Object.entries(res.files)) put(rel, text);
    for (const [rel, text] of Object.entries(res.pages)) put(rel, text);
    const b2 = rebuildBlock({ planDir: newDir, asks: true });
    if (!b2.ok) out.bar1.shapeOfOk.indepRed++;
    else if (!validateDeclaration(JSON.parse(fs.readFileSync(path.join(newDir, 'declaration.json'), 'utf8')), ctxOf(b2)).ok) out.bar1.shapeOfOk.indepRed++;
    out.bar3.tried++;
    const dr = rowEditPlan({ planDir: newDir, op: 'drop', key: r.key });
    if (!dr.ok) { out.bar3.fail.push(`${id}: ${dr.say}`.slice(0, 160)); continue; }
    const d2 = JSON.parse(dr.files['declaration.json']);
    const s2 = d2.steps.find((s) => s.fromLine === r.line);
    const row2 = d2.checkList.find((x) => x.key === r.key);
    if (s2?.close?.class === 'hitl' && d2.guardrailClasses?.[String(r.line)] === undefined && row2?.state === 'dropped') out.bar3.ok++; else out.bar3.fail.push(`${id}: class ${s2?.close?.class} gc ${d2.guardrailClasses?.[String(r.line)]} row ${row2?.state}`);
    // bar 4 after an Add: a $ numbers row on a no-~ line stays built and still has no Drop
    const b3 = rebuildBlock({ planDir: newDir, asks: true });
    const dl = b3.ok ? b3.block.rows.filter((x) => x.by === 'default' && x.kind === 'numbers' && x.state === 'built' && noTilde.has(x.line)) : [];
    if (dl.length) { out.bar4.addTried++; const q = rowEditPlan({ planDir: newDir, op: 'drop', key: dl[0].key }); if (!q.ok && /code's own and stays/.test(q.say)) out.bar4.builtAfterAdd++; }
  } catch (e) { bump(out.ineligible, `THREW ${String(e?.message).slice(0, 80)}`); }
  fs.rmSync(planDir, { recursive: true, force: true }); fs.rmSync(path.join(work, `p${idx - 1}-added`), { recursive: true, force: true });
}
out.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.join(repo, `poc/f257-am15/results-${label}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
