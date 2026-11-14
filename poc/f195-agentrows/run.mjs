// F195 POC ($0): `node poc/f195-agentrows/run.mjs | tee poc/f195-agentrows/result-1.log`. Bars: docs/logs/FINDINGS.md "F195 PRE-REGISTERED". No provider, no key, no network.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSheetLine as buildNew } from './build.mjs';
import { buildSheetLine as buildOld } from '../f194-codebuilt/build.mjs';
import { loadPlans, loadExtra, isRec, readJ, ROOT } from './data.mjs';
import { rulesOfLine } from '../../src/sheetblock.js';
import { readRunSheets, closeSheet } from '../../src/sheetrun.js';
import { parseCsv, sheetTable } from '../../src/csv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const say = (s) => console.log(s);
const plans = loadPlans(); const extra = loadExtra(plans); const all = [...plans, ...extra];
say(`plans: ${plans.length} (${plans.filter((p) => p.id.startsWith('flow')).length} signed flows, ${plans.filter((p) => p.id.startsWith('draft')).length} drafts) + ${extra.length} widened flows`);
const sheetSteps = (p) => (p.decl.steps ?? []).filter((s) => isRec(s?.close) && Array.isArray(s.close.sheet) && s.close.sheet.length > 0 && Number.isInteger(s.fromLine));
const lineOf = (p, n) => p.parsed.lines.find((l) => l.n === n);
const strip = (c, keys) => Object.fromEntries(Object.entries(c).filter(([k]) => !keys.includes(k)));
const same = (src, check) => isDeepStrictEqual(strip(src, ['id', 'claim', 'covers', 'text']), strip(check, ['id', 'claim', 'text']));

const N = new Map(); const O = new Map();
for (const p of all) {
  const mn = new Map(); const mo = new Map();
  for (const st of sheetSteps(p)) {
    const a = { line: lineOf(p, st.fromLine), tables: p.tables, suggestions: st.close.sheet };
    mn.set(st.fromLine, await buildNew(a)); mo.set(st.fromLine, await buildOld(a));
  }
  N.set(p.id, mn); O.set(p.id, mo);
}

// ---- row checker (bar c) : a violation list
function rowViolations(res, nRules) {
  const v = []; const holders = new Map(); const seenIds = new Map();
  for (const r of res.ruleRows) for (const n of r.covers) holders.set(n, [...(holders.get(n) ?? []), r.check.id]);
  for (const [n, ids] of holders) if (ids.length > 1) v.push(`rule ${n} held by ${ids.length} rule-row checks`);
  for (const r of [...res.ruleRows, ...res.agentRows]) seenIds.set(r.check.id, (seenIds.get(r.check.id) ?? 0) + 1);
  for (const [id, c] of seenIds) if (c > 1) v.push(`check ${id} in ${c} rows`);
  for (const b of res.built) if (!seenIds.has(b.check.id)) v.push(`check ${b.check.id} in no row`);
  const cnt = new Map(); for (const r of res.rows) cnt.set(r.rule, (cnt.get(r.rule) ?? 0) + 1);
  for (let n = 1; n <= nRules; n += 1) if ((cnt.get(n) ?? 0) !== 1) v.push(`rule ${n} listed ${cnt.get(n) ?? 0} times`);
  return v;
}
const mk = (id, covers) => ({ check: { id }, covers, src: {} });
const brokenA = { ruleRows: [mk('x', [1]), mk('y', [1])], agentRows: [], built: [mk('x', [1]), mk('y', [1])], rows: [{ rule: 1 }] };
const brokenB = { ruleRows: [mk('x', [1])], agentRows: [], built: [mk('x', [1]), mk('z', [])], rows: [{ rule: 1 }] };
const brokenC = { ruleRows: [mk('x', [1])], agentRows: [mk('x', [])], built: [mk('x', [1])], rows: [{ rule: 1 }] };
const ctlC = rowViolations(brokenA, 1).some((x) => /held by 2/.test(x)) && rowViolations(brokenB, 1).some((x) => /in no row/.test(x)) && rowViolations(brokenC, 1).some((x) => /in 2 rows/.test(x));
say(`(c) row checker self-test: ${ctlC ? 'flags a rule held by two rule-row checks, a check in no row, a check in two rows' : 'NOT all planted faults flagged'}`);

// ---- per-plan counts: (c), (d)
let C = true; const whyC = []; let D = true; const whyD = [];
const T = { saved: 0, ruleRows: 0, agentRows: 0, agentNoRule: 0, refused: 0, multi: 0, agentOnlyRules: 0, rules: 0, oldHidden: 0, oldBuilt: 0, plansWithOldHidden: 0 };
for (const p of all) {
  let pr = 0; let pa = 0; let pref = 0; let psaved = 0; let oldHidden = 0;
  for (const st of sheetSteps(p)) {
    const res = N.get(p.id).get(st.fromLine); const old = O.get(p.id).get(st.fromLine);
    const line = lineOf(p, st.fromLine); const nr = rulesOfLine(line).length;
    const v = rowViolations(res, nr); if (v.length) { C = false; whyC.push(`${p.id} L${st.fromLine}: ${v.join('; ')}`); }
    if (res.ruleRows.length + res.agentRows.length + res.refused.length !== st.close.sheet.length) { D = false; whyD.push(`${p.id} L${st.fromLine}`); }
    for (const b of res.built) if ('covers' in b.check || 'text' in b.check) { C = false; whyC.push(`${p.id}: check carries covers/text`); }
    pr += res.ruleRows.length; pa += res.agentRows.length; pref += res.refused.length; psaved += st.close.sheet.length;
    T.agentNoRule += res.agentRows.filter((a) => a.covers.length === 0).length; T.multi += res.built.filter((b) => b.covers.length > 1).length;
    T.agentOnlyRules += res.rows.filter((r) => r.state === 'agent-row').length; T.rules += nr;
    oldHidden += old.surplus.length; T.oldBuilt += old.built.length;
  }
  T.saved += psaved; T.ruleRows += pr; T.agentRows += pa; T.refused += pref; T.oldHidden += oldHidden; if (oldHidden) T.plansWithOldHidden += 1;
}
say(`TOTALS over ${all.length} plans: saved suggestions ${T.saved} = rule-row ${T.ruleRows} + agent rows ${T.agentRows} + refused ${T.refused}; agent rows covering no rule ${T.agentNoRule}; multi-rule checks ${T.multi}; rules covered only by an agent row ${T.agentOnlyRules} of ${T.rules}`);
say(`F194 builder on the same data (control): built ${T.oldBuilt}, hidden as SURPLUS ${T.oldHidden} on ${T.plansWithOldHidden} plans`);

// forced cases (c)
const roleOf = (p) => Object.keys(p.tables)[0];
const pE = plans.find((p) => p.id === 'flow:walk-m16-csv'); const eT = pE.tables; const rE = roleOf(pE); const hE = eT[rE].header;
const amt = hE.find((h) => /amount/i.test(h)); const line2 = { n: 2, text: 'Flag the rows with a price over 500', rules: ['rows over 500', 'every row has a date'] };
const cellsA = { id: 'a', rule: 'cells', table: rE, claim: 'a', op: 'rows', where: [{ column: amt, cmp: 'gt', value: 500 }], covers: [1] };
const cellsB = { ...cellsA, id: 'b', claim: 'b', op: 'countIf' };
const tab = { id: 't', rule: 'table', table: rE, op: 'noEmpty', column: amt, covers: [1] };
const fc = [
  ['table first, cells second', [tab, cellsA], (r) => r.ruleRows.length === 1 && r.ruleRows[0].check.rule === 'cells' && r.agentRows.length === 1 && r.agentRows[0].check.rule === 'table'],
  ['cells first, table second', [cellsA, tab], (r) => r.ruleRows.length === 1 && r.ruleRows[0].check.rule === 'cells' && r.agentRows.length === 1 && r.agentRows[0].check.rule === 'table'],
  ['two cells on one rule', [cellsA, cellsB], (r) => r.ruleRows.length === 1 && r.ruleRows[0].src.id === 'a' && r.agentRows.length === 1 && r.agentRows[0].src.id === 'b'],
  ['a built check that covers no rule', [{ ...cellsA, covers: [] }], (r) => r.ruleRows.length === 0 && r.agentRows.length === 1 && r.rows.every((x) => x.state === 'not-checked')],
];
let fcOK = true;
for (const [name, src, ok] of fc) { const r = await buildNew({ line: line2, tables: eT, suggestions: src }); const o = ok(r); if (!o) fcOK = false; say(`- forced ${o ? 'ok ' : 'BAD'} ${name}: rule rows [${r.ruleRows.map((x) => x.check.rule).join(',')}] agent rows [${r.agentRows.map((x) => x.check.rule).join(',')}] violations ${rowViolations(r, 2).length}`); if (rowViolations(r, 2).length) fcOK = false; }

// ---- run-time machinery
const verdict = async (checks, claims, rs) => (checks.length === 0 ? 'no-checks' : (await closeSheet(checks, claims, rs)).verdict);
const claimsFor = (rows, rec) => { const o = {}; for (const b of rows) if (b.check.claim !== undefined && b.src.claim in rec.claims) o[b.check.claim] = rec.claims[b.src.claim]; return o; };
function perturb(box) {
  if (!isRec(box)) return null;
  const o = structuredClone(box);
  if (typeof o.value === 'number') { o.value += 1; return o; }
  if (typeof o.value === 'boolean') { o.value = !o.value; return o; }
  for (const k of ['rows', 'keys', 'values']) if (Array.isArray(o[k])) { if (o[k].length) o[k].pop(); else o[k].push(9999); return o; }
  for (const k of ['days', 'bands']) if (isRec(o[k])) { const ks = Object.keys(o[k]); if (!ks.length) return null; o[k][ks[0]] = k === 'days' ? Number(o[k][ks[0]]) + 1 : 'ZZZ'; return o; }
  if (Array.isArray(o.totals) && o.totals.length) { o.totals[0].total = Number(o.totals[0].total) + 1; return o; }
  return null;
}
/** every record of a pool: signed set vs the new set vs the F194 set, per check and per line */
async function records(pool) {
  const out = [];
  for (const p of pool) {
    const runsDir = path.join(p.dir, 'runs'); const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    for (const run of runs) {
      const runDir = path.join(runsDir, run); const lc = readJ(path.join(runDir, 'line-checks.json'));
      for (const rec of lc?.sheet?.lines ?? []) {
        const st = sheetSteps(p).find((x) => x.fromLine === rec.n); if (!st || !isRec(rec.claims)) continue;
        const rsF = readRunSheets(runDir, st.close.sheet); if (!rsF.ok) continue;
        const rn = N.get(p.id).get(rec.n); const ro = O.get(p.id).get(rec.n);
        const vF = await verdict(st.close.sheet, rec.claims, rsF);
        const vN = await verdict(rn.built.map((b) => b.check), claimsFor(rn.built, rec), rsF);
        const vO = await verdict(ro.built.map((b) => b.check), claimsFor(ro.built, rec), rsF);
        const redSigned = []; for (const c of st.close.sheet) if ((await verdict([c], rec.claims, rsF)) === 'red') redSigned.push(c);
        out.push({ p, run, rec, st, rsF, rn, ro, vF, vN, vO, redSigned });
      }
    }
  }
  return out;
}
const recL = await records(plans.filter((p) => p.signedFlow)); const recX = await records(extra);

// ---- (a) m10b-expenses runs 1 and 2, try 1
say('\n== (a) m10b-expenses run-1 and run-2, try 1');
const expRecs = [...recL, ...recX].filter((r) => r.p.id === 'flow-extra:m10b-expenses' && /^run-[12]$/.test(r.run) && r.rec.try === 1);
let aOK = expRecs.length > 0; let aCtl = false;
for (const r of expRecs) {
  const onAsAgent = r.redSigned.map((c) => r.rn.agentRows.some((a) => same(c, a.check)));
  const ok = r.vF === 'red' && r.vN === 'red' && r.redSigned.length > 0 && onAsAgent.every(Boolean);
  if (!ok) aOK = false; if (r.vO !== r.vF) aCtl = true;
  say(`- ${r.p.id} ${r.run} L${r.rec.n} try ${r.rec.try}: full ${r.vF}, F195 built ${r.vN}, F194 built ${r.vO}; red signed checks ${r.redSigned.map((c) => c.id).join(',')} on as agent row: ${onAsAgent.join(',')}`);
}
say(`(a) records ${expRecs.length}; control (F194's builder differs from the full set on at least one): ${aCtl}`);

// ---- (b) the table-only lines
say('\n== (b) the F194 table-only lines');
const tOnly = [];
for (const p of all) for (const st of sheetSteps(p)) { const o = O.get(p.id).get(st.fromLine); if (o.built.length > 0 && o.built.every((b) => b.check.rule === 'table') && st.close.sheet.some((c) => c.rule === 'cells')) tOnly.push({ p, st }); }
let bOK = tOnly.length > 0; let bCtl = true;
const named = ['d-00mvkskwc8-ae80', 'd-00mwci7xl7-d44d', 'walk-m10am29-2'];
for (const { p, st } of tOnly) {
  const n = N.get(p.id).get(st.fromLine);
  const rowCells = n.ruleRows.some((r) => r.check.rule === 'cells');
  if (!rowCells) bOK = false; if (!O.get(p.id).get(st.fromLine).built.every((b) => b.check.rule === 'table')) bCtl = false;
  say(`- ${p.id} L${st.fromLine}: F194 rule rows all table; F195 rule rows [${n.ruleRows.map((r) => r.check.rule).join(',')}], agent rows [${n.agentRows.map((r) => r.check.rule).join(',')}]`);
}
for (const nm of named) if (!tOnly.some((x) => x.p.id.includes(nm))) { bOK = false; say(`  MISSING named line ${nm}`); }
const wRecs = recX.filter((r) => r.p.id.includes('walk-m10am29-2'));
for (const r of wRecs) { const ok = r.vN === r.vF; if (!ok) bOK = false; say(`- walk-m10am29-2 ${r.run} L${r.rec.n} try ${r.rec.try}: signed ${r.vF}, F195 built ${r.vN}, F194 built ${r.vO}`); }
if (wRecs.length === 0) bOK = false;
say(`(b) table-only lines ${tOnly.length}; walk-m10am29-2 records ${wRecs.length}; control (F194 rule rows are table-only on all): ${bCtl}`);

// ---- (e) F194 bar (a) on the letter pool, with the new set
say('\n== (e) F194 bar (a) on the 8 named signed flows with the F195 set');
const E = { recs: 0, checks: 0, a1: 0, a2: 0, a3: 0, a4: 0, a4Red: 0, a4Diff: 0, a4Skip: 0 }; const diffs = [];
for (const r of recL) {
  E.recs += 1; if (r.vF !== r.vN) { E.a3 += 1; diffs.push(`${r.p.id} ${r.run} L${r.rec.n}: ${r.vF} vs ${r.vN}`); }
  const cl = claimsFor(r.rn.built, r.rec);
  for (const b of r.rn.built) {
    E.checks += 1; if (!same(b.src, b.check)) E.a1 += 1;
    const a = await verdict([b.src], r.rec.claims, r.rsF); const c = await verdict([b.check], cl, r.rsF); if (a !== c) E.a2 += 1;
    if (b.src.rule === 'cells') {
      const pb = perturb(r.rec.claims[b.src.claim]); if (pb === null) { E.a4Skip += 1; continue; }
      E.a4 += 1; const aa = await verdict([b.src], { ...r.rec.claims, [b.src.claim]: pb }, r.rsF); const cc = await verdict([b.check], { ...cl, [b.check.claim]: pb }, r.rsF);
      if (aa === 'red') E.a4Red += 1; if (aa !== cc) E.a4Diff += 1;
    }
  }
}
say(`letter pool: ${JSON.stringify(E)}${diffs.length ? ` DIFFS ${diffs.slice(0, 8).join(' | ')}` : ''}`);
const redX = recX.filter((r) => r.vF === 'red'); const xDiff = recX.filter((r) => r.vF !== r.vN);
say(`widened pool (report): ${recX.length} records, full red ${redX.length}; F195 verdict differs from the full set ${xDiff.length}${xDiff.length ? ` (${xDiff.map((r) => `${r.p.id} ${r.run} try ${r.rec.try}: ${r.vF} vs ${r.vN}`).join('; ')})` : ''}; F194 differs ${recX.filter((r) => r.vF !== r.vO).length}`);
const redL = recL.filter((r) => r.vF === 'red').length;
const eCtl = (redL + redX.length) > 0 && E.a4Red > 0;
say(`(e) controls: reds in the pools ${redL + redX.length}; perturbations red on a signed check ${E.a4Red} of ${E.a4}`);

// ---- adapter facts
const src = fs.readFileSync(path.join(HERE, 'build.mjs'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').toLowerCase();
const hitl = src.split('hitl').length - 1;
const diffStat = execFileSync('git', ['-C', ROOT, 'diff', '--stat', '--', 'src', 'test'], { encoding: 'utf8' }).trim();
say(`\nbuilder 'hitl' in code lines ${hitl}; git diff --stat src test: ${diffStat === '' ? 'empty' : diffStat}`);

// ---- verdicts
const clean = hitl === 0; // the src/test diff is a precondition printed above, not part of a bar (the other session's uncommitted edits are not this POC's)
const aV = !aCtl ? 'INCONCLUSIVE (control did not differ)' : aOK && clean ? 'PASS' : 'FAIL';
const bV = !bCtl ? 'INCONCLUSIVE (control)' : bOK && clean ? 'PASS' : 'FAIL';
const cV = !ctlC ? 'INCONCLUSIVE (checker self-test)' : C && fcOK ? 'PASS' : 'FAIL';
const dCtl = T.oldHidden > 0; const dV = !dCtl ? 'INCONCLUSIVE (control)' : D && T.saved === T.ruleRows + T.agentRows + T.refused ? 'PASS' : 'FAIL';
const eV = !eCtl ? 'INCONCLUSIVE (control)' : E.recs > 0 && E.a1 === 0 && E.a2 === 0 && E.a3 === 0 && E.a4Diff === 0 ? 'PASS' : 'FAIL';
say('\n== BARS');
say(`BAR (a): ${aV}`); say(`BAR (b): ${bV}`); say(`BAR (c): ${cV}${whyC.length ? ` - ${whyC.slice(0, 5).join(' | ')}` : ''}`); say(`BAR (d): ${dV}${whyD.length ? ` - ${whyD.slice(0, 5).join(' | ')}` : ''}`); say(`BAR (e): ${eV}`);
const vs = [aV, bV, cV, dV, eV];
say(`OVERALL: ${vs.every((v) => v === 'PASS') ? 'PASS' : vs.some((v) => v.startsWith('FAIL')) ? 'FAIL' : 'INCONCLUSIVE'}`);
void parseCsv; void sheetTable;
