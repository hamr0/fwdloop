// F197 POC ($0): `node poc/f197-tablerow/run-2.mjs | tee poc/f197-tablerow/result-2.log`. Bars: docs/logs/FINDINGS.md "F197 PRE-REGISTERED". No provider, no key, no network.
// Current = src/sheetbuild.js at HEAD. Candidate = build-candidate-2.mjs (candidate 1 + table [agent] row covers no rule). Bar (e) in docs/logs/FINDINGS.md 'F197 bar (e) PRE-REGISTERED'.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { buildSheetLine as cur, toSuggestion } from '../../src/sheetbuild.js';
import { buildSheetLine as cand } from './build-candidate-2.mjs';
import { buildSheetChecks as buildCur } from '../../src/sheetbuild.js';
import { buildSheetChecks as buildC2 } from './build-candidate-2.mjs';
import { buildSheetChecks as buildC1 } from './build-candidate.mjs';
import { uncoveredRules, sheetLineBlocks } from '../../src/sheetblock.js';
import { loadPlans, loadExtra, isRec, readJ, ROOT } from './data.mjs';
import { rulesOfLine } from '../../src/sheetblock.js';
import { readRunSheets, closeSheet } from '../../src/sheetrun.js';

const say = (s) => console.log(s);
const plans = loadPlans(); const extra = loadExtra(plans); const all = [...plans, ...extra];
say(`plans: ${plans.length} + ${extra.length} widened flows = ${all.length}`);
const sheetSteps = (p) => (p.decl.steps ?? []).filter((s) => isRec(s?.close) && Array.isArray(s.close.sheet) && s.close.sheet.length > 0 && Number.isInteger(s.fromLine));
const lineOf = (p, n) => p.parsed.lines.find((l) => l.n === n);
const strip = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !['id', 'claim', 'covers', 'text', 'row'].includes(k)));
const CUR = new Map(); const CAN = new Map();
for (const p of all) for (const st of sheetSteps(p)) {
  const a = { line: lineOf(p, st.fromLine), tables: p.tables, suggestions: st.close.sheet };
  CUR.set(`${p.id}#${st.fromLine}`, await cur(a)); CAN.set(`${p.id}#${st.fromLine}`, await cand(a));
}
const key = (p, n) => `${p.id}#${n}`;
const rules = (p, st) => rulesOfLine(lineOf(p, st.fromLine));

// ---- (a) the live draft
say('\n== (a) d-00mwhz6eab-cfc7');
const pa = plans.filter((p) => p.id.includes('d-00mwhz6eab-cfc7'));
let aOK = false; let aCtlFail = false; let aFound = 0;
for (const p of pa) for (const st of sheetSteps(p)) {
  const c = CUR.get(key(p, st.fromLine)); const n = CAN.get(key(p, st.fromLine));
  const idx = rules(p, st).findIndex((r) => /every invoice appears exactly once/.test(r)); if (idx < 0) continue;
  aFound += 1; const r1 = idx + 1;
  const curRow = c.ruleRows.find((x) => x.check.id === 'l2r1' || x.covers.includes(r1));
  const curOn = !!curRow && curRow.check.rule === 'table' && curRow.check.op === 'rowCount';
  const canAgent = n.agentRows.find((x) => x.check.rule === 'table' && x.check.op === 'rowCount');
  const canRuleRowHolds = n.ruleRows.some((x) => x.covers.includes(r1));
  const state = n.rows[idx].state;
  say(`- ${p.id} L${st.fromLine} rule ${r1} "${rules(p, st)[idx]}": current rule-row check = ${curRow ? `${curRow.check.id} ${curRow.check.rule}/${curRow.check.op}` : 'none'}; candidate rule-row holder = ${canRuleRowHolds}, agent row = ${canAgent ? canAgent.check.id : 'none'}, rule state = ${state}`);
  aCtlFail = curOn; aOK = curOn && !!canAgent && !canRuleRowHolds;
}
say(`(a) lines found ${aFound}; control (current holds it on rule row): ${aCtlFail}`);

// ---- (c)
const sameSet = (x, y) => { const a = x.map((b) => JSON.stringify(strip(b.check))).sort(); const b = y.map((b2) => JSON.stringify(strip(b2.check))).sort(); return isDeepStrictEqual(a, b); };
function rowViol(res, nr) {
  const v = []; const holders = new Map(); const ids = new Map();
  for (const r of res.ruleRows) for (const n of r.covers) holders.set(n, (holders.get(n) ?? 0) + 1);
  for (const [n, k] of holders) if (k > 1) v.push(`rule ${n} held by ${k} rule-row checks`);
  for (const r of res.ruleRows) if (new Set(r.covers).size !== r.covers.length) v.push('dup covers');
  for (const r of [...res.ruleRows, ...res.agentRows]) ids.set(r.check.id, (ids.get(r.check.id) ?? 0) + 1);
  for (const [id, k] of ids) if (k > 1) v.push(`check ${id} in ${k} rows`);
  for (const b of res.checks) if (!ids.has(b.id)) v.push(`check ${b.id} in no row`);
  const cnt = new Map(); for (const r of res.rows) cnt.set(r.rule, (cnt.get(r.rule) ?? 0) + 1);
  for (let n = 1; n <= nr; n += 1) if ((cnt.get(n) ?? 0) !== 1) v.push(`rule ${n} listed ${cnt.get(n) ?? 0} times`);
  return v;
}
const mk = (id, covers) => ({ check: { id }, covers });
const ctlC = rowViol({ ruleRows: [mk('x', [1]), mk('y', [1])], agentRows: [], checks: [{ id: 'x' }, { id: 'y' }], rows: [{ rule: 1 }] }, 1).some((x) => /held by 2/.test(x))
  && rowViol({ ruleRows: [mk('x', [1])], agentRows: [], checks: [{ id: 'x' }, { id: 'z' }], rows: [{ rule: 1 }] }, 1).some((x) => /in no row/.test(x));
say(`\n== (c) checker self-test flags a double-held rule and a check in no row: ${ctlC}`);
let C = true; const whyC = []; let nPlaced = 0; let nChanged = 0; let nTableMoved = 0;
const D = []; const perPlan = new Map();
for (const p of all) for (const st of sheetSteps(p)) {
  const c = CUR.get(key(p, st.fromLine)); const n = CAN.get(key(p, st.fromLine)); const nr = rules(p, st).length;
  if (!sameSet(c.checks.map((x) => ({ check: x })), n.checks.map((x) => ({ check: x })))) { C = false; whyC.push(`${p.id} L${st.fromLine}: built set differs`); }
  const v = rowViol(n, nr); if (v.length) { C = false; whyC.push(`${p.id} L${st.fromLine}: ${v.join('; ')}`); }
  if (n.refused.length !== c.refused.length) { C = false; whyC.push(`${p.id} L${st.fromLine}: refused differ`); }
  nPlaced += c.checks.length;
  const movedHere = c.ruleRows.filter((r) => r.check.rule === 'table').length; nTableMoved += movedHere; if (movedHere) nChanged += 1;
  // (d): ~ rule whose only rule-row holder today is a table check
  c.rows.forEach((row, i) => {
    if (row.state !== 'built') return;
    const holder = c.ruleRows.find((r) => r.check.id === row.id); if (holder.check.rule !== 'table') return;
    D.push({ plan: p.id, line: st.fromLine, rule: row.rule, words: row.text, op: holder.check.op, col: holder.check.column ?? '', cand: n.rows[i].state, flow: p.signedFlow ? 'signed' : 'draft' });
    perPlan.set(p.id, (perPlan.get(p.id) ?? 0) + 1);
  });
}
say(`checks placed by the current builder: ${nPlaced}; table checks on a rule row today: ${nTableMoved} on ${nChanged} lines`);
const cC = !ctlC ? 'INCONCLUSIVE (checker self-test)' : nChanged === 0 ? 'INCONCLUSIVE (no table check on a rule row)' : C ? 'PASS' : 'FAIL';
if (whyC.length) say(`(c) violations: ${whyC.slice(0, 8).join(' | ')}`);

// ---- (b) run records
const claimsFor = (checks, suggestions, rec) => {
  const o = {}; const used = new Set();
  for (const c of checks) {
    if (c.claim === undefined) continue;
    const i = suggestions.findIndex((s, k) => !used.has(k) && isDeepStrictEqual(strip(toSuggestion(s).fields), strip(c)) );
    if (i >= 0) { used.add(i); const sc = suggestions[i].claim; if (sc in rec.claims) o[c.claim] = rec.claims[sc]; }
  }
  return o;
};
const verdict = async (checks, claims, rs) => (checks.length === 0 ? 'no-checks' : (await closeSheet(checks, claims, rs)).verdict);
async function records(pool) {
  const out = [];
  for (const p of pool) {
    const runsDir = path.join(p.dir, 'runs'); const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    for (const run of runs) {
      const runDir = path.join(runsDir, run); const lc = readJ(path.join(runDir, 'line-checks.json'));
      for (const rec of lc?.sheet?.lines ?? []) {
        const st = sheetSteps(p).find((x) => x.fromLine === rec.n); if (!st || !isRec(rec.claims)) continue;
        const rs = readRunSheets(runDir, st.close.sheet); if (!rs.ok) continue;
        out.push({ p, run, rec, st, rs });
      }
    }
  }
  return out;
}
say('\n== (b) every run record, both pools');
let bOK = true; let nRec = 0; let nRed = 0; let nTouched = 0; let nTouchedRed = 0; const whyB = [];
for (const [name, pool] of [['letter', plans.filter((p) => p.signedFlow)], ['widened', extra]]) {
  const rs = await records(pool); let red = 0; let diff = 0;
  for (const r of rs) {
    const c = CUR.get(key(r.p, r.rec.n)); const n = CAN.get(key(r.p, r.rec.n));
    const vc = await verdict(c.checks, claimsFor(c.checks, r.st.close.sheet, r.rec), r.rs);
    const vn = await verdict(n.checks, claimsFor(n.checks, r.st.close.sheet, r.rec), r.rs);
    if (vc === 'red') red += 1; if (vc !== vn) { diff += 1; bOK = false; whyB.push(`${r.p.id} ${r.run} L${r.rec.n} try ${r.rec.try}: ${vc} vs ${vn}`); }
    if (c.ruleRows.some((x) => x.check.rule === 'table')) { nTouched += 1; if (vc === 'red') nTouchedRed += 1; }
  }
  nRec += rs.length; nRed += red; say(`- ${name}: ${rs.length} records, current red ${red}, candidate verdict differs ${diff}`);
}
say(`(b) records ${nRec}; current red ${nRed}; records on lines where a table check sat on a rule row ${nTouched} (of them current red ${nTouchedRed}); differ ${whyB.length}${whyB.length ? ` - ${whyB.slice(0, 6).join(' | ')}` : ''}`);
const bV = nRec === 0 ? 'INCONCLUSIVE (no records)' : nTouched === 0 ? 'INCONCLUSIVE (no record on an affected line)' : nRed === 0 ? 'INCONCLUSIVE (no red in the pool: no red to lose)' : bOK ? 'PASS' : 'FAIL';

// ---- (d) report
say(`\n== (d) report: ~ rules whose only rule-row holder today is a table check (${D.length} rules on ${perPlan.size} plans)`);
for (const [pl, k] of perPlan) say(`  count ${k}  ${pl}`);
for (const d of D) say(`- [${d.flow}] ${d.plan} L${d.line} rule ${d.rule}: "${d.words}" | table check op ${d.op}${d.col ? ` column ${d.col}` : ''} | candidate shows the rule as: ${d.cand}`);


// ---- (e) the real card path: buildSheetChecks (builder) -> src/sheetblock.js uncoveredRules (the drafter's Not-checked lines, src/drafter.js `uncovered`)
say('\n== (e) Not-checked lines the real path (src/sheetblock.js uncoveredRules, as src/drafter.js calls it) gives');
const WANT = 'No check was picked for it, so you judge it at the Ask.';
const notCheckedOf = async (build, p) => {
  const lines = p.parsed.lines; const csvRoles = Object.keys(p.tables);
  const b = await build({ declaration: p.decl, lines, tables: p.tables });
  return { out: uncoveredRules(b.declaration, lines, csvRoles, b), blocks: sheetLineBlocks({ declaration: b.declaration, lines, csvRoles }) };
};
let eOK = true; let eCtlFail = false; const eWhy = [];
for (const d of D) {
  const p = all.find((x) => x.id === d.plan); const key1 = `line ${d.line}: "${d.words}"`;
  const c2 = await notCheckedOf(buildC2, p); const c1 = await notCheckedOf(buildC1, p); const cu = await notCheckedOf(buildCur, p);
  const mine = (r) => r.out.filter((t) => t.startsWith(key1));
  const t2 = mine(c2); const t1 = mine(c1);
  say(`- ${d.plan} L${d.line} rule ${d.rule}: candidate 2 card line: ${t2.length ? JSON.stringify(t2[0]) : '(not in Not checked)'} | candidate 1: ${t1.length ? JSON.stringify(t1[0]) : '(not in Not checked)'}`);
  const words = t2.length === 1 ? t2[0].split(' \u2014 ').slice(1).join(' \u2014 ') : null;
  if (words !== WANT) { eOK = false; eWhy.push(`${d.plan}: words ${JSON.stringify(words)}`); }
  if (t1.length === 1 && t1[0].endsWith(WANT)) { /* control would pass */ } else eCtlFail = true;
  // table check row: an [agent] row covering no rule
  const tbl = c2.blocks.flatMap((b) => b.checked).filter((x) => /rowCount|no duplicate|no empty|row count/.test(x.name));
  const tblOK = tbl.length > 0 && tbl.every((x) => x.by === 'agent' && x.covers.length === 0);
  say(`    table check rows on the line: ${tbl.map((x) => `${x.id} by ${x.by} covers ${x.covers.length}`).join(', ') || 'none'}`);
  if (!tblOK) { eOK = false; eWhy.push(`${d.plan}: table row not an agent row covering none`); }
  // no other rule of the plan changes: compare candidate 2's Not-checked list to the current builder's, minus this plan's table-held rules
  const heldKeys = new Set(D.filter((x) => x.plan === d.plan).map((x) => `line ${x.line}: "${x.words}"`));
  const extraNew = c2.out.filter((t) => !cu.out.includes(t) && ![...heldKeys].some((k) => t.startsWith(k)));
  const goneOld = cu.out.filter((t) => !c2.out.includes(t));
  if (extraNew.length || goneOld.length) { eOK = false; eWhy.push(`${d.plan}: other Not-checked lines changed: +${extraNew.length} -${goneOld.length}`); }
}
say(`(e) control: candidate 1 does not show the words ${WANT} on every one: ${eCtlFail}`);
if (eWhy.length) say(`(e) fails: ${eWhy.join(' | ')}`);

const diffStat = execFileSync('git', ['-C', ROOT, 'diff', '--stat', '--', 'src', 'test'], { encoding: 'utf8' }).trim();
say(`\ngit diff --stat src test: ${diffStat === '' ? 'empty' : diffStat}`);
const aV = !aCtlFail ? 'INCONCLUSIVE (control: current did not hold it on a rule row)' : aFound === 0 ? 'INCONCLUSIVE' : aOK ? 'PASS' : 'FAIL';
say('\n== BARS'); say(`BAR (a): ${aV}`); say(`BAR (b): ${bV}`); say(`BAR (c): ${cC}`); say('BAR (d): report only, no pass mark'); const eV = !eCtlFail ? 'INCONCLUSIVE (control: candidate 1 already shows the words)' : D.length === 0 ? 'INCONCLUSIVE' : eOK ? 'PASS' : 'FAIL'; say(`BAR (e): ${eV}`);
const vs = [aV, bV, cC, eV];
say(`OVERALL: ${vs.every((v) => v === 'PASS') ? 'PASS' : vs.some((v) => v.startsWith('FAIL')) ? 'FAIL' : 'INCONCLUSIVE'}`);
