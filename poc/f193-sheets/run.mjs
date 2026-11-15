// F193 POC ($0): `node poc/f193-sheets/run.mjs` -> per-plan counts and per-bar lines on stdout (tee into result-1.log). Reads ~/.config/fwdloop/flows and the practice-walk copy READ-ONLY.
// Bars are read in docs/logs/FINDINGS.md "F193 PRE-REGISTERED", not here. No provider, no key, no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SheetBlock } from './sheetblock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const S = (f) => import(path.join(ROOT, 'src', f));
const { parseSignedText } = await S('signed-text.js');
const { sheetRowsOf } = await S('sheetrows.js');
const { sheetLineBlocks, csvRolesOf, rulesOfLine, uncoveredRules } = await S('sheetblock.js');
const { isColumnChoiceRule } = await S('sheetoffer.js');
const { columnRuleWords } = await S('sheetlook.js');
const { appendAnswersToJob } = await S('panel/authorcard.js');
const { sheetCheckReds } = await S('sheetchecks.js');
const { readRunSheets, tableChecksFailingOnInput } = await S('sheetrun.js');

const say = (s) => console.log(s);
const FLOWS = path.join(os.homedir(), '.config/fwdloop/flows');
const PW = path.join(ROOT, '.claude/scratch/m16/practice-walk/home/.config/fwdloop/flows');
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const sheetCount = (d) => (Array.isArray(d?.steps) ? d.steps : []).reduce((n, s) => n + (Array.isArray(s?.close?.sheet) ? s.close.sheet.length : 0), 0);

// ---- the plans
const plans = [];
const seen = new Set();
const add = (origin, dir, signedFlow) => {
  const prose = fs.existsSync(path.join(dir, 'prose.txt')) ? fs.readFileSync(path.join(dir, 'prose.txt'), 'utf8') : null;
  const decl = readJ(path.join(dir, 'declaration.json'));
  if (prose === null || decl === null || sheetCount(decl) === 0) return;
  const key = sha(prose + JSON.stringify(decl));
  if (seen.has(key)) return;
  seen.add(key);
  const parsed = parseSignedText(prose);
  if (!parsed.ok) return;
  plans.push({ id: `${origin}`, dir, signedFlow, prose, decl, parsed, look: readJ(path.join(dir, 'page-look.json')), saved: readJ(path.join(dir, 'not-checked.json'))?.notChecked ?? null });
};
for (const name of fs.readdirSync(FLOWS).sort()) {
  if (/^(m10-walk-csv|m10b-aging|aging-live|walk-m16-csv)/.test(name) && fs.existsSync(path.join(FLOWS, name, 'signature.json'))) add(`flow:${name}`, path.join(FLOWS, name), name);
}
if (fs.existsSync(path.join(PW, 'pw-csv'))) add('flow:pw-csv(practice-walk)', path.join(PW, 'pw-csv'), null);
const drafts = path.join(FLOWS, '.drafts');
for (const d of fs.readdirSync(drafts).sort()) for (const sub of fs.readdirSync(path.join(drafts, d)).filter((x) => x === 'draft' || x.startsWith('draft-')).sort()) add(`draft:${d}/${sub}`, path.join(drafts, d, sub), null);
say(`plans with at least one close.sheet check, identical prose+declaration counted once: ${plans.length} (${plans.filter((p) => p.id.startsWith('flow')).length} signed flows, ${plans.filter((p) => p.id.startsWith('draft')).length} saved drafts)`);

// ---- per plan
const tilde = (n) => n;
let A = true; let B = true; let Cc = true;
const whyA = []; const whyB = []; const whyC = [];
const ctl = { rulesWithTwo: 0, plansWithTwo: 0, agentRows: 0, plansWithAgent: 0, none: 0, plansNoneBeside: 0, c5NoRule: 0, plansC5: 0, twice: 0 };
const tot = { checks: 0, kept: 0, sugg: 0, suggNoRule: 0, suggClaimed: 0, notChecked: 0, columnRules: 0, rules: 0, unreadable: 0 };
const keptByPlan = new Map();
for (const p of plans) {
  const { lines, arbiter } = p.parsed;
  const csvRoles = csvRolesOf(arbiter);
  const steps = (p.decl.steps ?? []).filter((s) => isRec(s?.close) && Array.isArray(s.close.sheet) && s.close.sheet.length > 0 && Number.isInteger(s.fromLine));
  const lineOf = (n) => lines.find((l) => l.n === n);
  const b = new SheetBlock();
  const keptAll = []; const suggAll = [];
  for (const st of steps) {
    const l = lineOf(st.fromLine);
    if (!l) continue;
    b.fromJob([{ n: l.n, text: l.text, rules: rulesOfLine(l) }]);
    const r = b.addSheetChecks(l.n, st.close.sheet);
    keptAll.push(...r.kept.map((id) => ({ line: l.n, id }))); suggAll.push(...r.suggested.map((s) => ({ line: l.n, ...s })));
  }
  b.reconcile();
  // (a) independent re-check from the plan's own `covers`
  let tc = 0; let perRuleMax = 0; const claimedBy = new Map();
  for (const st of steps) {
    const l = lineOf(st.fromLine); const rules = rulesOfLine(l);
    const valid = (c) => [...new Set(Array.isArray(c.covers) ? c.covers : [])].filter((n) => Number.isInteger(n) && n >= 1 && n <= rules.length && !isColumnChoiceRule(rules[n - 1]));
    const holder = new Map(); // rule -> kept check count, from the OUTPUT
    for (const c of st.close.sheet) {
      tc += 1;
      const isKept = keptAll.some((k) => k.line === st.fromLine && k.id === c.id);
      const isSug = suggAll.some((s) => s.line === st.fromLine && s.id === c.id);
      if (isKept === isSug) { A = false; whyA.push(`${p.id}: check ${c.id} is ${isKept ? 'both' : 'neither'} kept and Suggested`); }
      if (isKept) for (const n of valid(c)) holder.set(n, (holder.get(n) ?? 0) + 1);
      if (isSug) {
        const v = valid(c);
        const s = suggAll.find((x) => x.line === st.fromLine && x.id === c.id);
        if (v.length === 0) tot.suggNoRule += 1; else tot.suggClaimed += 1;
        void s;
      }
      if (!isKept && !isSug) continue;
      if (isKept && valid(c).length === 0) { A = false; whyA.push(`${p.id}: kept check ${c.id} covers no rule`); }
      if (!isKept && valid(c).length > 0) {
        // Suggested with a valid cover: every rule it covers must be held by an earlier kept check
        const earlier = st.close.sheet.slice(0, st.close.sheet.indexOf(c)).filter((e) => keptAll.some((k) => k.line === st.fromLine && k.id === e.id));
        if (!valid(c).some((n) => earlier.some((e) => valid(e).includes(n)))) { A = false; whyA.push(`${p.id}: check ${c.id} Suggested though none of its rules is held`); }
      }
    }
    for (const [, n] of holder) perRuleMax = Math.max(perRuleMax, n);
    void claimedBy;
  }
  if (perRuleMax > 1) { A = false; whyA.push(`${p.id}: a rule is held by ${perRuleMax} kept checks`); }
  if (keptAll.length + suggAll.length !== tc) { A = false; whyA.push(`${p.id}: kept ${keptAll.length} + Suggested ${suggAll.length} != ${tc} checks`); }
  tot.checks += tc; tot.kept += keptAll.length; tot.sugg += suggAll.length;
  // (b) the one list
  const nc = b.notCheckedList();
  const seenR = new Set(); let dup = 0;
  for (const x of nc) { const k = `${x.line}.${x.rule}`; if (seenR.has(k)) dup += 1; seenR.add(k); }
  const rulesOfPlan = steps.flatMap((st) => rulesOfLine(lineOf(st.fromLine)).map((t, i) => ({ line: st.fromLine, rule: i + 1, text: t })));
  const noRuleWords = nc.filter((x) => !rulesOfPlan.some((r) => r.line === x.line && r.rule === x.rule && r.text === x.text));
  const none = nc.filter((x) => /^none$/i.test(x.text) || /not checked: none/i.test(x.reason));
  const expect = rulesOfPlan.filter((r) => !isColumnChoiceRule(r.text) && !b.ruleRows(r.line).find((x) => x.rule === r.rule)?.sheet).map((r) => `${r.line}.${r.rule}`).sort();
  const got = nc.map((x) => `${x.line}.${x.rule}`).sort();
  if (dup || noRuleWords.length || none.length || JSON.stringify(expect) !== JSON.stringify(got)) { B = false; whyB.push(`${p.id}: dup ${dup}, no-rule entries ${noRuleWords.length}, none ${none.length}, expected ${expect} got ${got}`); }
  tot.notChecked += nc.length; tot.columnRules += rulesOfPlan.filter((r) => isColumnChoiceRule(r.text)).length; tot.rules += rulesOfPlan.length;
  // control: today's code on the same plan
  const today = sheetRowsOf({ declaration: p.decl, lines, csvRoles });
  const cover = new Map();
  for (const st of steps) { const rules = rulesOfLine(lineOf(st.fromLine)); for (const c of st.close.sheet) for (const n of new Set(c.covers ?? [])) if (Number.isInteger(n) && n >= 1 && n <= rules.length) cover.set(`${st.fromLine}.${n}`, (cover.get(`${st.fromLine}.${n}`) ?? 0) + 1); }
  const two = [...cover].filter(([k, n]) => n >= 2 && !isColumnChoiceRule(rulesOfLine(lineOf(Number(k.split('.')[0])))[Number(k.split('.')[1]) - 1])).length;
  const agentRows = today.card.filter((r) => r.by === 'agent').length;
  const blocks = sheetLineBlocks({ declaration: p.decl, lines, csvRoles });
  const noneLines = blocks.filter((x) => x.notChecked === 'none').length;
  const savedNC = p.saved ?? [];
  const uncovered = uncoveredRules(p.decl, lines, csvRoles);
  const noneBeside = noneLines > 0 && (savedNC.length > 0 || blocks.some((x) => x.notChecked !== 'none'));
  const c5 = savedNC.filter((s) => s.includes('there is no column') && !rulesOfPlan.some((r) => s.includes(`"${r.text}"`)));
  const twiceToday = rulesOfPlan.filter((r) => savedNC.filter((s) => s.includes(`"${r.text}"`)).length >= 2).length;
  ctl.rulesWithTwo += two; if (two) ctl.plansWithTwo += 1; ctl.agentRows += agentRows; if (agentRows) ctl.plansWithAgent += 1; ctl.none += noneLines; if (noneBeside) ctl.plansNoneBeside += 1; ctl.c5NoRule += c5.length; if (c5.length) ctl.plansC5 += 1; ctl.twice += twiceToday;
  say(`- ${p.id}: checks ${tc} kept ${keptAll.length} suggested ${suggAll.length} | rules ${rulesOfPlan.length} (column ${rulesOfPlan.filter((r) => isColumnChoiceRule(r.text)).length}) not-checked ${nc.length} dup ${dup} | TODAY rules-with-2-checks ${two}, [agent] rows ${agentRows}, "Not checked: none" lines ${noneLines}${noneBeside ? ' (beside a list)' : ''}, no-rule notes ${c5.length}, rule named twice ${twiceToday}, uncovered lines ${uncovered.length}, saved NC items ${savedNC.length}`);
  keptByPlan.set(p.id, { kept: keptAll, steps, p });
}
say(`TOTALS new: checks ${tot.checks} kept ${tot.kept} suggested ${tot.sugg} (covers none ${tot.suggNoRule}, rule already held ${tot.suggClaimed}); rules ${tot.rules} (column rules ${tot.columnRules}); Not-checked rows ${tot.notChecked}`);
say(`TOTALS today (control): rules covered by 2+ checks ${ctl.rulesWithTwo} in ${ctl.plansWithTwo} plans; [agent] rows ${ctl.agentRows} in ${ctl.plansWithAgent} plans; "Not checked: none" lines ${ctl.none}, beside a list in ${ctl.plansNoneBeside} plans; no-rule C5 notes ${ctl.c5NoRule} in ${ctl.plansC5} plans; rules named 2+ times in saved lists ${ctl.twice}`);
const ctlA = ctl.plansWithTwo > 0 || ctl.plansWithAgent > 0;
const ctlB = ctl.plansNoneBeside > 0 || ctl.c5NoRule > 0 || ctl.twice > 0;

// ---- (c) the column answer
say('\n== (c) column answers (sheet asks of the saved plans, page-look.json sheets[].asks)');
let askTot = 0; let askRule = 0; let askNull = 0; let ctlAdds = 0; let ctlSkips = 0;
for (const p of plans) {
  const asks = (p.look?.sheets ?? []).flatMap((s) => (Array.isArray(s.asks) ? s.asks : []));
  if (!asks.length) continue;
  const { lines } = p.parsed;
  const jobBox = lines.flatMap((l) => [l.text, ...rulesOfLine(l).map((r) => `~ ${r}`)]).join('\n');
  for (const a of asks) {
    askTot += 1;
    if (a.rule === null || a.rule === undefined) { askNull += 1; say(`- ${p.id}: ask on L${a.line} has no rule (word "${a.word}"): reported, not scored`); continue; }
    askRule += 1;
    const l = lines.find((x) => x.n === a.line);
    const rules = l ? rulesOfLine(l) : [];
    const b = new SheetBlock();
    b.fromJob([{ n: a.line, text: l?.text ?? '', rules }]);
    const before = b.ruleRows(a.line).map((r) => r.text);
    const r = b.answerColumn(a.line, a.rule, a.column, a.word);
    b.reconcile();
    const after = b.ruleRows(a.line).map((x) => x.text);
    const view = b.jobLinesView([{ n: a.line, text: l?.text ?? '' }])[0].rules;
    const okc = r.ok && before.length === after.length && JSON.stringify(before) === JSON.stringify(after) && view.length === rules.length && b.ruleRows(a.line).find((x) => x.rule === a.rule)?.column?.column === a.column;
    const grown = appendAnswersToJob(jobBox, [{ line: a.line, answer: columnRuleWords(a.word, a.column) }]);
    if (grown.added > 0) ctlAdds += 1; else ctlSkips += 1;
    say(`- ${p.id}: ask L${a.line}.${a.rule} word "${a.word}" -> column "${a.column}": NEW ok ${okc} (~ ${before.length} -> ${view.length}, words unchanged, row column set); TODAY appendAnswersToJob adds ${grown.added} ~ line`);
    if (!okc) { Cc = false; whyC.push(`${p.id} L${a.line}.${a.rule}`); }
  }
}
say(`asks in scored plans: ${askTot} (tied to a rule ${askRule}, no rule ${askNull}); control: today's writer adds a line for ${ctlAdds}, skips ${ctlSkips} (the rule words already on the line)`);
const cVerdict = askRule === 0 ? 'INCONCLUSIVE' : Cc ? 'PASS, flagged: answerColumn leaves the row words alone by construction; the bar proves no line is added and says nothing about where the column lives for a Revise or a run (see the report)' : 'FAIL';

// ---- (d) run-time
say('\n== (d) run-time sheet results: kept set vs full signed set, F190 functions on each signed flow run folder (frozen inputs)');

/** the kept checks of a plan outside the main pool (same SheetBlock, same rule) */
function keptOfPlan(p) {
  const { lines } = p.parsed;
  const steps = (p.decl.steps ?? []).filter((s) => isRec(s?.close) && Array.isArray(s.close.sheet) && s.close.sheet.length > 0 && Number.isInteger(s.fromLine));
  const kept = [];
  for (const st of steps) {
    const l = lines.find((x) => x.n === st.fromLine); if (!l) continue;
    const b = new SheetBlock(); b.fromJob([{ n: l.n, text: l.text, rules: rulesOfLine(l) }]);
    kept.push(...b.addSheetChecks(l.n, st.close.sheet).kept.map((id) => ({ line: l.n, id })));
  }
  return { kept, steps, p };
}
let dReds = 0; const dNeg = []; let dChecks = 0; let dDiff = 0; let dRuns = 0; let dFlows = 0; let dropped = 0; let flowsDropping = 0;
const redIds = (reds, ids) => ids.filter((id) => reds.some((r) => r.includes(`'${id}'`) || r.includes(`"${id}"`) || r.includes(`${id}:`) || r.includes(` ${id} `)));
async function dPool(pool) {
for (const p of pool) {
  const k = keptByPlan.get(p.id) ?? keptOfPlan(p);
  const runsDir = path.join(p.dir, 'runs');
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
  let droppedHere = 0; let any = false;
  for (const st of k.steps) {
    const line = p.parsed.lines.find((l) => l.n === st.fromLine);
    const full = st.close.sheet.filter(isRec);
    const keepIds = new Set(k.kept.filter((x) => x.line === st.fromLine).map((x) => x.id));
    const keep = full.filter((c) => keepIds.has(c.id));
    droppedHere += full.length - keep.length;
    for (const run of runs) {
      const runDir = path.join(runsDir, run);
      if (!fs.existsSync(path.join(runDir, 'run.json'))) continue;
      const rsF = readRunSheets(runDir, full); const rsK = readRunSheets(runDir, keep);
      if (!rsF.ok || !rsK.ok) continue;
      any = true; dRuns += 1;
      const decl1 = (sheet) => ({ steps: [{ fromLine: st.fromLine, close: { class: 'green', sheet } }] });
      const redsF = sheetCheckReds(full, line.n, rsF.tables); const redsK = sheetCheckReds(keep, line.n, rsK.tables);
      const tblF = await tableChecksFailingOnInput(decl1(full), rsF.tables); const tblK = await tableChecksFailingOnInput(decl1(keep), rsK.tables);
      // each red belongs to the check that gives it ALONE (F190's way: every check judged by itself); the kept set must give exactly the full set's reds of the kept checks, in plan order
      const single = new Map();
      for (const c of full) single.set(String(c.id), { sc: sheetCheckReds([c], line.n, rsF.tables), tb: await tableChecksFailingOnInput(decl1([c]), rsF.tables) });
      const expect = (all, kind, ids) => all.filter((r) => ids.some((id) => single.get(id)[kind].includes(r)));
      const keepIds2 = keep.map((c) => String(c.id));
      const expSc = expect(redsF, 'sc', keepIds2); const expTb = expect(tblF, 'tb', keepIds2);
      const unattributed = [...redsF.filter((r) => ![...single.values()].some((v) => v.sc.includes(r))), ...tblF.filter((r) => ![...single.values()].some((v) => v.tb.includes(r)))];
      dReds += redsF.length + tblF.length;
      dChecks += keep.length;
      if (redsF.length || tblF.length) say(`  (a red exists) ${p.id} ${run} L${st.fromLine}: full set sheetCheckReds ${redsF.length}, table checks failing on input ${tblF.length} (${[...single].filter(([, v]) => v.sc.length || v.tb.length).map(([id]) => id).join(', ')}); unattributed ${unattributed.length}`);
      if (JSON.stringify(redsK) !== JSON.stringify(expSc) || JSON.stringify(tblK) !== JSON.stringify(expTb) || unattributed.length) { dDiff += 1; say(`  DIFF ${p.id} ${run} L${st.fromLine}: kept-set reds (${redsK.length}, ${tblK.length}) vs the full set's reds of the kept checks (${expSc.length}, ${expTb.length}), unattributed ${unattributed.length}`); }
      // negative control: take a red check out of the kept set; the comparison against the full set's expectation must now differ (so it can fail)
      for (const id of keepIds2.filter((x) => single.get(x).sc.length || single.get(x).tb.length)) {
        const keep2 = keep.filter((c) => String(c.id) !== id);
        const rs2 = readRunSheets(runDir, keep2);
        if (rs2.ok) { const t2 = await tableChecksFailingOnInput(decl1(keep2), rs2.tables); const r2 = sheetCheckReds(keep2, line.n, rs2.tables); dNeg.push({ id, differs: JSON.stringify(r2) !== JSON.stringify(expSc) || JSON.stringify(t2) !== JSON.stringify(expTb) }); }
      }
    }
  }
  if (any) dFlows += 1;
  dropped += droppedHere; if (droppedHere > 0) flowsDropping += 1;
}
}
await dPool(plans.filter((x) => x.signedFlow));
const mainCounts = { reds: dReds, checks: dChecks, diff: dDiff, runs: dRuns };
say(`(d) letter pool (the named signed flows): reds ${mainCounts.reds}, kept checks compared ${mainCounts.checks}, differences ${mainCounts.diff}, runs ${mainCounts.runs}`);
// report-only widening: every OTHER signed flow with a sheet check (so the comparison meets a red, F190 found one in walk-m10am32-1)
const extra = [];
for (const name of fs.readdirSync(FLOWS).sort()) {
  const dir = path.join(FLOWS, name);
  if (!fs.existsSync(path.join(dir, 'signature.json')) || plans.some((x) => x.signedFlow === name)) continue;
  const prose = fs.existsSync(path.join(dir, 'prose.txt')) ? fs.readFileSync(path.join(dir, 'prose.txt'), 'utf8') : null; const decl = readJ(path.join(dir, 'declaration.json'));
  if (prose === null || decl === null || sheetCount(decl) === 0) continue;
  const parsed = parseSignedText(prose); if (!parsed.ok) continue;
  extra.push({ id: `flow-extra:${name}`, dir, signedFlow: name, prose, decl, parsed });
}
await dPool(extra);
say(`(d) widened by ${extra.length} other signed flows with a sheet check (report-only): reds ${dReds}, kept checks compared ${dChecks}, differences ${dDiff}, runs ${dRuns}`);
say(`all pools: reds seen ${dReds}; negative control (a red check taken out of the kept set) ${JSON.stringify(dNeg)}; signed flows with a frozen run input ${dFlows}; runs ${dRuns}; kept checks compared ${dChecks}; differences ${dDiff}; signed flows that would move a check to Suggested if re-drafted ${flowsDropping} (${dropped} checks)`);
const adapterSrc = fs.readFileSync(path.join(HERE, 'sheetblock.mjs'), 'utf8');
const hitlWords = adapterSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').toLowerCase().split('hitl').length - 1;
const importLines = adapterSrc.split('\n').filter((l) => l.startsWith('import '));
const badImports = importLines.filter((l) => /declaration|guardrailClass|classes?\.js/i.test(l));
const diffStat = execFileSync('git', ['-C', ROOT, 'diff', '--stat', '--', 'src', 'test'], { encoding: 'utf8' }).trim();
say(`adapter: 'hitl' in code lines ${hitlWords}; imports ${JSON.stringify(importLines.map((l) => l.match(/from '([^']+)'/)[1]))}; declaration/class imports ${badImports.length}; git diff --stat src test: ${diffStat === '' ? 'empty' : diffStat}`);
const dOk = mainCounts.diff === 0 && mainCounts.checks > 0 && dDiff === 0 && hitlWords === 0 && badImports.length === 0 && diffStat === '';
const dVerdict = dChecks === 0 || mainCounts.reds === 0 ? (mainCounts.diff > 0 ? 'FAIL' : `PASS on the letter, flagged: the named signed flows hold 0 reds (green against green); the widened pool (walk-m10am32-1) holds ${dReds} red and its negative control ${dNeg.length && dNeg.every((x) => x.differs) ? 'differs, so the comparison can fail' : 'did not differ'}`) : dOk ? 'PASS' : 'FAIL';

// ---- verdicts
const aVerdict = !ctlA ? (A ? 'INCONCLUSIVE (control: today shows no rule with 2 checks and no [agent] row, so (a) cannot fail on this data)' : 'FAIL') : A ? 'PASS' : 'FAIL';
const bVerdict = !ctlB ? (B ? 'INCONCLUSIVE (control: today shows no none-beside-list, no-rule note or twice-named rule)' : 'FAIL') : B ? 'PASS' : 'FAIL';
say('\n== BARS');
say(`BAR (a): ${aVerdict}${whyA.length ? ` - ${whyA.slice(0, 5).join(' | ')}` : ''}`);
say(`BAR (b): ${bVerdict}${whyB.length ? ` - ${whyB.slice(0, 5).join(' | ')}` : ''}`);
say(`BAR (c): ${cVerdict}${whyC.length ? ` - ${whyC.join(' | ')}` : ''}`);
say(`BAR (d): ${dVerdict}`);
const all = [aVerdict, bVerdict, cVerdict, dVerdict];
say(`OVERALL: ${all.every((v) => v.startsWith('PASS')) ? 'PASS' : all.some((v) => v.startsWith('FAIL')) ? 'FAIL' : 'INCONCLUSIVE'}`);
void tilde;
