// F194 POC ($0): `node poc/f194-codebuilt/run.mjs | tee poc/f194-codebuilt/result-1.log`. Bars are in docs/logs/FINDINGS.md "F194 PRE-REGISTERED". No provider, no key, no network.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groundedLiterals, tableSha } from 'bareguard';
import { buildSheetLine, toSuggestion } from './build.mjs';
import { loadPlans, loadExtra, isRec, readJ, ROOT } from './data.mjs';
import { rulesOfLine } from '../../src/sheetblock.js';
import { isColumnChoiceRule } from '../../src/sheetoffer.js';
import { sheetCheckColumns, bareguardChecks } from '../../src/sheetchecks.js';
import { readRunSheets, closeSheet } from '../../src/sheetrun.js';
import { wordsSaidOn } from '../../src/pagebits.js';
import { parseCsv, sheetTable } from '../../src/csv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const say = (s) => console.log(s);
const plans = loadPlans();
const extra = loadExtra(plans);
say(`plans with at least one close.sheet check, identical prose+declaration counted once: ${plans.length} (${plans.filter((p) => p.id.startsWith('flow')).length} signed flows, ${plans.filter((p) => p.id.startsWith('draft')).length} saved drafts); unreadable CSV: ${plans.filter((p) => p.unreadable.length).length}`);

const sheetSteps = (p) => (p.decl.steps ?? []).filter((s) => isRec(s?.close) && Array.isArray(s.close.sheet) && s.close.sheet.length > 0 && Number.isInteger(s.fromLine));
const lineOf = (p, n) => p.parsed.lines.find((l) => l.n === n);

// ---- build every sheet line of every plan
const built = new Map(); // plan id -> Map(line -> result)
for (const p of [...plans, ...extra]) {
  const m = new Map();
  for (const st of sheetSteps(p)) m.set(st.fromLine, await buildSheetLine({ line: lineOf(p, st.fromLine), tables: p.tables, suggestions: st.close.sheet }));
  built.set(p.id, m);
}

// ---- (b) partition checker and (d) counts
const HELPERS = ['vocabulary', 'tables', 'schema', 'columnAt', 'checkTables', 'groundedLiterals', 'claimSchema', 'runTableChecks'];
/** @returns {string[]} violations: every (line, rule) exactly once with a state and, for Not checked, a reason from the closed list */
function partitionViolations(rows, nRules) {
  const v = [];
  const seen = new Map();
  for (const r of rows) seen.set(r.rule, (seen.get(r.rule) ?? 0) + 1);
  for (let n = 1; n <= nRules; n += 1) { const c = seen.get(n) ?? 0; if (c !== 1) v.push(`rule ${n} listed ${c} times`); }
  for (const r of rows) {
    if (!['built', 'column', 'not-checked'].includes(r.state)) v.push(`rule ${r.rule} has state ${r.state}`);
    if (r.state === 'not-checked' && !(typeof r.reason === 'string' && (r.reason === 'no suggestion' || HELPERS.some((h) => r.reason.startsWith(`suggestion refused: ${h}: `))) && r.reason.length > 0)) v.push(`rule ${r.rule} Not checked with reason "${String(r.reason)}"`);
    if (/^none$/i.test(String(r.text)) || /not checked: none/i.test(String(r.reason))) v.push(`rule ${r.rule} is a none line`);
  }
  return v;
}
let B = true; const whyB = [];
const tot = { checks: 0, built: 0, surplus: 0, surplusNone: 0, surplusHeld: 0, refused: 0, rules: 0, builtRules: 0, columnRules: 0, notChecked: 0 };
const refusedBy = {}; const noLiteral = { built: 0, none: 0, band: 0, ruleLevelUngrounded: 0 };
let c1Bad = 0; let c3Bad = 0; const colUse = { plans: 0, used: 0 };
for (const p of plans) {
  let pc = { checks: 0, built: 0, surplus: 0, refused: 0, nc: 0, rules: 0 }; const why = [];
  for (const st of sheetSteps(p)) {
    const line = lineOf(p, st.fromLine); const res = built.get(p.id).get(st.fromLine);
    const nRules = rulesOfLine(line).length;
    const viol = partitionViolations(res.rows, nRules);
    if (viol.length) { B = false; whyB.push(`${p.id} L${st.fromLine}: ${viol.join('; ')}`); }
    const nSug = st.close.sheet.length;
    if (res.built.length + res.surplus.length + res.refused.length !== nSug) { B = false; whyB.push(`${p.id} L${st.fromLine}: built+surplus+refused != ${nSug}`); }
    pc.checks += nSug; pc.built += res.built.length; pc.surplus += res.surplus.length; pc.refused += res.refused.length;
    pc.nc += res.rows.filter((r) => r.state === 'not-checked').length; pc.rules += nRules;
    tot.surplusNone += res.surplus.filter((s) => s.why.startsWith('it covers none')).length; tot.surplusHeld += res.surplus.filter((s) => s.why.startsWith('a rule it covers')).length;
    tot.builtRules += res.rows.filter((r) => r.state === 'built').length; tot.columnRules += res.rows.filter((r) => r.state === 'column').length;
    for (const r of res.refused) { refusedBy[r.helper] = (refusedBy[r.helper] ?? 0) + 1; why.push(`${r.src.id}:${r.helper}`); }
    const words = wordsSaidOn(line);
    for (const b of res.built) {
      const bg = bareguardChecks([b.check])[0];
      if (groundedLiterals(bg, words).missing.length > 0) c1Bad += 1;
      const ruleWords = b.covers.map((n) => rulesOfLine(line)[n - 1]).join(' ');
      if (groundedLiterals(bg, ruleWords).missing.length > 0) noLiteral.ruleLevelUngrounded += 1;
      const hasLit = (b.check.where ?? []).length > 0 || typeof b.check.asOf === 'string' || Array.isArray(b.check.bands) || b.check.n !== undefined;
      noLiteral.built += 1; if (!hasLit) noLiteral.none += 1; if (Array.isArray(b.check.bands)) noLiteral.band += 1;
      // (c3) authorship: id and claim are the code's own, keys are bareguard schema fields, no text, no covers
      const c = b.check; const okId = c.id === `l${line.n}r${b.covers.join('_')}` && (c.rule !== 'cells' || c.claim === c.id) && !('text' in c) && !('covers' in c);
      if (!okId) c3Bad += 1;
    }
    const colRules = rulesOfLine(line).filter(isColumnChoiceRule);
    for (const cr of colRules) { colUse.plans += 1; const colName = cr.slice("use the column '".length, cr.indexOf("' for '")); if (res.built.some((b) => sheetCheckColumns(b.check).includes(colName))) colUse.used += 1; }
  }
  tot.checks += pc.checks; tot.built += pc.built; tot.surplus += pc.surplus; tot.refused += pc.refused; tot.rules += pc.rules; tot.notChecked += pc.nc;
  say(`- ${p.id}: checks ${pc.checks} built ${pc.built} surplus ${pc.surplus} refused ${pc.refused}${why.length ? ` (${why.join(', ')})` : ''} | rules ${pc.rules} not-checked ${pc.nc}`);
}
say(`TOTALS: checks ${tot.checks} built ${tot.built} surplus ${tot.surplus} (covers none ${tot.surplusNone}, rule held ${tot.surplusHeld}) refused ${tot.refused} ${JSON.stringify(refusedBy)}; rules ${tot.rules}: built ${tot.builtRules}, column ${tot.columnRules}, Not checked ${tot.notChecked}`);
say(`vs F193: kept 30 / suggested 20 / Not-checked rows 8 on the same 24 plans (F193's kept count was without the build-time refusals)`);

// partition checker self-test (control)
const broken = [{ rule: 1, text: 'a', state: 'built', reason: null, id: 'x' }, { rule: 1, text: 'a', state: 'built', reason: null, id: 'y' }, { rule: 3, text: 'c', state: 'not-checked', reason: '', id: null }];
const bViol = partitionViolations(broken, 3);
const bCtl = bViol.some((x) => /rule 2 listed 0/.test(x)) && bViol.some((x) => /rule 1 listed 2/.test(x)) && bViol.some((x) => /rule 3 Not checked with reason/.test(x));
say(`(b) checker self-test on a broken list: ${bViol.length} violations flagged (${bCtl ? 'all three planted faults flagged' : 'NOT all flagged'})`);

// ---- (c2) forced cases on a real sheet and a real line
const loadT = (f) => sheetTable(parseCsv(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const expPlan = plans.find((p) => p.id === 'flow:walk-m16-csv'); const agePlan = plans.find((p) => p.id === 'flow:m10b-aging-5');
const expT = expPlan.tables; const ageT = agePlan.tables;
const expLine = { n: 2, text: 'Flag the rows with a price over 500', rules: ['rows over 500', 'every row has a date'] };
const ageLine = { n: 2, text: 'Work out days past due as of 2026-10-11', rules: ['every invoice appears exactly once', 'days past due = days since the due date as of 2026-10-11', "use the column 'Due date' for 'due date'"] };
const roleE = Object.keys(expT)[0]; const roleA = Object.keys(ageT)[0];
const hdrA = ageT[roleA].header; const hdrE = expT[roleE].header;
const dateCol = hdrA.find((h) => /due/i.test(h)); const dupCol = hdrA.find((h) => /customer/i.test(h)); const numCol = hdrE.find((h) => /amount/i.test(h));
const ok500 = { id: 'ai-picked-id', rule: 'cells', table: roleE, claim: 'myClaim', op: 'rows', where: [{ column: numCol, cmp: 'gt', value: 500 }], covers: [1], text: 'free prose from the AI' };
const forced = [
  { name: 'number not in the words', line: expLine, t: expT, src: [{ ...ok500, where: [{ column: numCol, cmp: 'gt', value: 999 }] }], expect: (r) => r.refused[0]?.helper === 'groundedLiterals' && r.rows[0].state === 'not-checked' },
  { name: 'date not in the words', line: ageLine, t: ageT, src: [{ id: 'd', rule: 'cells', table: roleA, claim: 'd', op: 'daysSince', column: dateCol, asOf: '2031-01-01', dateFormats: [{ column: dateCol, format: 'YYYY-MM-DD' }], covers: [2] }], expect: (r) => r.refused[0]?.helper === 'groundedLiterals' },
  { name: 'column that is no header', line: expLine, t: expT, src: [{ ...ok500, where: [{ column: 'Nope', cmp: 'gt', value: 500 }] }], expect: (r) => r.refused[0]?.helper === 'columnAt' },
  { name: 'table check that fails on the sheet', line: ageLine, t: ageT, src: [{ id: 'u', rule: 'table', table: roleA, op: 'noDuplicates', column: dupCol, covers: [1] }], expect: (r) => r.refused[0]?.helper === 'runTableChecks' },
  { name: 'op outside the vocabulary', line: expLine, t: expT, src: [{ ...ok500, op: 'regexMatch' }], expect: (r) => r.refused[0]?.helper === 'vocabulary' },
  { name: 'covers a rule the line does not have', line: expLine, t: expT, src: [{ ...ok500, covers: [9] }], expect: (r) => r.surplus[0]?.why === 'it covers none of your rules' && r.rows[0].state === 'not-checked' && r.rows[0].reason === 'no suggestion' },
  { name: 'covers a column rule', line: ageLine, t: ageT, src: [{ id: 'n', rule: 'table', table: roleA, op: 'noEmpty', column: dateCol, covers: [3] }], expect: (r) => r.surplus[0]?.why === 'it covers none of your rules' && r.rows[2].state === 'column' },
  { name: 'second suggestion on a held rule', line: expLine, t: expT, src: [ok500, { ...ok500, id: 'second', op: 'countIf' }], expect: (r) => r.built.length === 1 && r.surplus[0]?.why === 'a rule it covers already has a check' },
  { name: 'AI id, claim and text are replaced or dropped', line: expLine, t: expT, src: [ok500], expect: (r) => r.built.length === 1 && r.built[0].check.id === 'l2r1' && r.built[0].check.claim === 'l2r1' && !('text' in r.built[0].check) && !('covers' in r.built[0].check) },
];
let cOK = true; const forcedLines = [];
for (const f of forced) {
  const r = await buildSheetLine({ line: f.line, tables: f.t, suggestions: f.src });
  const ok = f.expect(r); if (!ok) cOK = false;
  forcedLines.push(`${ok ? 'ok ' : 'BAD'} ${f.name}: built ${r.built.length}, surplus ${r.surplus.length} (${r.surplus.map((s) => s.why).join('|')}), refused ${r.refused.length} (${r.refused.map((x) => `${x.helper}: ${x.why}`).join('|')})`);
}
// naive control: the AI check kept as it is (no refusals) is built in forced cases 1-5, so the assertion "not built" can fail
const naiveBuilt = forced.slice(0, 5).map((f) => ({ name: f.name, kept: f.src.length > 0 }));
const cCtl = naiveBuilt.every((x) => x.kept) && forced.slice(0, 5).every((f) => f.src[0].covers.length > 0);
say('\n== (c2) forced cases'); for (const l of forcedLines) say(`- ${l}`);
say(`(c) naive control (keep the AI check as it is): forced cases 1-5 would all be built = ${cCtl}; (c1) built checks with an ungrounded literal (line words): ${c1Bad}; (c3) built checks whose id/claim/keys are not code's: ${c3Bad}`);

// ---- (a) run-time
say('\n== (a) run-time: built set vs the signed set, frozen inputs, saved claims (line-checks.json), bareguard checkStep through closeSheet');
const strip = (c, keys) => Object.fromEntries(Object.entries(c).filter(([k]) => !keys.includes(k)));
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
const verdict = async (checks, claims, rs) => (checks.length === 0 ? 'no-checks' : (await closeSheet(checks, claims, rs)).verdict);
async function runPool(pool, label) {
  const s = { recs: 0, checks: 0, a1Bad: 0, a2Diff: 0, a3Diff: 0, a3Refused: 0, a4: 0, a4Red: 0, a4Diff: 0, a4Skip: 0, redFull: 0, shaOk: 0, shaBad: 0, noRecs: 0 };
  const lines = []; const diffs = [];
  for (const p of pool) {
    const runsDir = path.join(p.dir, 'runs'); const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    for (const run of runs) {
      const runDir = path.join(runsDir, run); const lc = readJ(path.join(runDir, 'line-checks.json'));
      for (const rec of lc?.sheet?.lines ?? []) {
        const st = sheetSteps(p).find((x) => x.fromLine === rec.n); const res = built.get(p.id).get(rec.n);
        if (!st || !isRec(rec.claims)) { s.noRecs += 1; continue; }
        const full = st.close.sheet; const keep = res.built.map((b) => b.check);
        const rsF = readRunSheets(runDir, full); if (!rsF.ok) { s.noRecs += 1; continue; }
        s.recs += 1;
        for (const i of rsF.inputs) { if (tableSha(rsF.tables[i.name]) === i.sha256) s.shaOk += 1; else s.shaBad += 1; }
        // re-key the saved claims to the code-set claim names (each built check came from one signed check)
        const claimsNew = {};
        for (const b of res.built) { if (b.check.claim !== undefined && isRec(rec.claims) && b.src.claim in rec.claims) claimsNew[b.check.claim] = rec.claims[b.src.claim]; }
        const vF = await verdict(full, rec.claims, rsF); const vB = await verdict(keep, claimsNew, rsF);
        if (vF === 'red') s.redFull += 1;
        if (vF !== vB) { if (vF === 'red' && res.refused.some((r) => r.helper === 'runTableChecks')) s.a3Refused += 1; else { s.a3Diff += 1; diffs.push(`${p.id} ${run} L${rec.n} try ${rec.try}: full ${vF} vs built ${vB}`); } }
        for (const b of res.built) {
          s.checks += 1;
          if (!isDeepStrictEqual(strip(b.src, ['id', 'claim', 'covers', 'text']), strip(b.check, ['id', 'claim', 'text']))) s.a1Bad += 1;
          const a = await verdict([b.src], rec.claims, rsF); const c = await verdict([b.check], claimsNew, rsF);
          if (a !== c) { s.a2Diff += 1; diffs.push(`${p.id} ${run} L${rec.n}: check ${b.src.id} signed ${a} vs built ${c}`); }
          if (b.src.rule === 'cells') {
            const pb = perturb(rec.claims[b.src.claim]);
            if (pb === null) { s.a4Skip += 1; continue; }
            s.a4 += 1;
            const aa = await verdict([b.src], { ...rec.claims, [b.src.claim]: pb }, rsF); const cc = await verdict([b.check], { ...claimsNew, [b.check.claim]: pb }, rsF);
            if (aa === 'red') s.a4Red += 1;
            if (aa !== cc) { s.a4Diff += 1; diffs.push(`${p.id} ${run} L${rec.n}: perturbed ${b.src.id} signed ${aa} vs built ${cc}`); }
          }
        }
      }
    }
    lines.push(p.id);
  }
  say(`${label}: ${JSON.stringify(s)}`);
  for (const d of diffs.slice(0, 12)) say(`  DIFF ${d}`);
  return s;
}
const letterPool = plans.filter((p) => p.signedFlow);
const sL = await runPool(letterPool, '(a) letter pool (the named signed flows)');
const sX = await runPool(extra, '(a) widened pool, report only (8 other signed flows)');
say(`(a) controls: real red in the widened pool (full signed set red) ${sX.redFull}; built set differs from it and the cause is the build-time refusal of a failing table check (am5 catch) ${sX.a3Refused}; perturbations that went red on a signed check (letter pool) ${sL.a4Red} of ${sL.a4}`);


// ---- reported only: the 2 coordinator rulings of 2026-11-14 (not bars; the pre-registration is not refitted)
say('\n== reported only: lines whose built set has no cells check (src/sheetchecks.js sheetNoClaimReds would refuse the step: nothing to answer)');
let tableOnly = 0; let tableOnlyLines = [];
for (const p of plans) for (const st of sheetSteps(p)) { const r = built.get(p.id).get(st.fromLine); if (r.built.length > 0 && r.built.every((b) => b.check.rule === 'table')) { tableOnly += 1; tableOnlyLines.push(`${p.id} L${st.fromLine}${st.close.sheet.some((c) => c.rule === 'cells') ? ' (a signed cells check went SURPLUS/refused)' : ''}`); } }
for (const p of extra) for (const st of sheetSteps(p)) { const r = built.get(p.id).get(st.fromLine); if (r.built.length > 0 && r.built.every((b) => b.check.rule === 'table')) { tableOnly += 1; tableOnlyLines.push(`${p.id} L${st.fromLine}${st.close.sheet.some((c) => c.rule === 'cells') ? ' (a signed cells check went SURPLUS/refused)' : ''}`); } }
say(`table-only built lines over the 24 plans + 8 widened flows: ${tableOnly}${tableOnlyLines.length ? ` - ${tableOnlyLines.join('; ')}` : ''}`);

say('\n== ruling 1 (column answer UPDATES the rule words in place; no `use the column` line): what it would do to the saved plans');
let r1 = { colRules: 0, hasTarget: 0, noTarget: 0, lastRule: 0, sameBuild: 0, diffBuild: 0 };
const { countPhrase } = await import('../../src/pagebits.js');
for (const p of plans) for (const st of sheetSteps(p)) {
  const line = lineOf(p, st.fromLine); const rules = rulesOfLine(line);
  rules.forEach(async () => {});
  const idx = rules.findIndex(isColumnChoiceRule); if (idx < 0) continue;
  r1.colRules += 1;
  const cr = rules[idx]; const X = cr.slice("use the column '".length, cr.indexOf("' for '")); const Y = cr.slice(cr.indexOf("' for '") + 7, -1);
  const targets = rules.map((_, i) => i).filter((i) => i !== idx && countPhrase(rules[i], Y) > 0);
  if (targets.length === 0) { r1.noTarget += 1; say(`- ${p.id} L${st.fromLine}: no other rule carries "${Y}" (answer for "${X}"): nothing to update in place (ruling 2 territory)`); continue; }
  r1.hasTarget += 1;
  if (idx === rules.length - 1) r1.lastRule += 1;
  const nr = rules.filter((_, i) => i !== idx).map((t, i0) => (targets.includes(i0 >= idx ? i0 + 1 : i0) ? ((k) => (k < 0 ? t : t.slice(0, k) + X + t.slice(k + Y.length)))(t.toLowerCase().indexOf(Y.toLowerCase())) : t));
  const line2 = { ...line, rules: nr, guardrail: undefined };
  const covers2 = (c) => ({ ...c, covers: (c.covers ?? []).filter((n) => n !== idx + 1).map((n) => (n > idx + 1 ? n - 1 : n)) });
  const res2 = await buildSheetLine({ line: line2, tables: p.tables, suggestions: st.close.sheet.map(covers2) });
  const res1 = built.get(p.id).get(st.fromLine);
  const same = res1.built.length === res2.built.length && res1.built.every((b, i) => isDeepStrictEqual(strip(b.check, ['id', 'claim']), strip(res2.built[i].check, ['id', 'claim'])));
  if (same) r1.sameBuild += 1; else r1.diffBuild += 1;
  say(`- ${p.id} L${st.fromLine}: "${Y}" -> "${X}" rewrites rule(s) ${targets.map((i) => i + 1).join(',')}; column rule was ${idx === rules.length - 1 ? 'last (no renumbering)' : 'NOT last (covers renumbered)'}; build after the update: ${same ? 'same checks' : `DIFFERENT (built ${res1.built.length} -> ${res2.built.length}; Not checked ${res1.rows.filter((r) => r.state === 'not-checked').length} -> ${res2.rows.filter((r) => r.state === 'not-checked').length})`}`);
}
say(`ruling 1 totals: use-the-column rules ${r1.colRules}: another rule carries the word ${r1.hasTarget} (column rule last ${r1.lastRule}); none does ${r1.noTarget}; rebuild after the in-place update gives the same checks ${r1.sameBuild}, different ${r1.diffBuild}`);

say('\n== ruling 2 (a column word that is not a `~` rule becomes a `!` agent row, Drop/Add; not a `$`, not a rule-less ask)');
let r2 = { asks: 0, ruleLess: 0, tied: 0 };
for (const p of plans) {
  const look = readJ(path.join(p.dir, 'page-look.json'));
  for (const a of (look?.sheets ?? []).flatMap((x) => (Array.isArray(x.asks) ? x.asks : []))) {
    r2.asks += 1; if (a.rule === null || a.rule === undefined) { r2.ruleLess += 1; say(`- ${p.id}: word "${a.word}" on L${a.line} has no rule -> would be a \`!\` row [agent] naming column "${a.column}"; code builds no check from a column alone (no op, no claim), so it stays a Suggested row`); } else r2.tied += 1;
  }
}
say(`ruling 2 totals: saved sheet asks ${r2.asks}: no rule ${r2.ruleLess} (these become \`!\` rows), tied to a rule ${r2.tied} (ruling 1)`);

// ---- adapter facts
const src = fs.readFileSync(path.join(HERE, 'build.mjs'), 'utf8');
const hitl = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').toLowerCase().split('hitl').length - 1;
const classImp = src.split('\n').filter((l) => l.startsWith('import ') && /declaration|guardrailClass|classes?\.js|close\.class/i.test(l)).length;
const diffStat = execFileSync('git', ['-C', ROOT, 'diff', '--stat', '--', 'src', 'test'], { encoding: 'utf8' }).trim();
say(`\nbuilder: 'hitl' in code lines ${hitl}; class/declaration imports ${classImp}; git diff --stat src test: ${diffStat === '' ? 'empty' : diffStat}`);
say(`reported only: built checks ${noLiteral.built}: with no literal at all (tie to the rule is the AI tag, shown on the card) ${noLiteral.none}; carrying band bounds (not read by groundedLiterals) ${noLiteral.band}; a literal not in the covered rules' own words (stricter, rule-level) ${noLiteral.ruleLevelUngrounded}`);
say(`reported only: use-the-column rules ${colUse.plans}: column used by a built check of the line ${colUse.used}; run-pool $ default tableSha(frozen) = recorded: ${sL.shaOk} ok, ${sL.shaBad} not (letter pool)`);

// ---- verdicts
const aCtl = sX.a3Refused > 0 && sL.a4Red > 0;
const aOK = sL.recs > 0 && sL.a1Bad === 0 && sL.a2Diff === 0 && sL.a3Diff === 0 && sL.a4Diff === 0 && hitl === 0 && classImp === 0 && diffStat === '';
const aV = !aCtl ? 'INCONCLUSIVE (a control did not differ)' : aOK ? 'PASS' : 'FAIL';
const bV = !bCtl ? 'INCONCLUSIVE (the checker did not flag the planted faults)' : B ? 'PASS' : 'FAIL';
const cV = !cCtl ? 'INCONCLUSIVE (naive control)' : cOK && c1Bad === 0 && c3Bad === 0 ? 'PASS' : 'FAIL';
const dV = tot.built + tot.surplus + tot.refused === tot.checks && B ? 'PASS (a report bar: the counts above are the finding)' : 'FAIL';
say('\n== BARS');
say(`BAR (a): ${aV}`); say(`BAR (b): ${bV}${whyB.length ? ` - ${whyB.slice(0, 5).join(' | ')}` : ''}`); say(`BAR (c): ${cV}`); say(`BAR (d): ${dV}`);
const all = [aV, bV, cV, dV];
say(`OVERALL: ${all.every((v) => v.startsWith('PASS')) ? 'PASS' : all.some((v) => v.startsWith('FAIL')) ? 'FAIL' : 'INCONCLUSIVE'}`);
void toSuggestion; void loadT;
