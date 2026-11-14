// F188 parity POC ($0): fwd's own sheet code vs bareguard #82 (feat/check-helpers @ cc2d173) on fwd's saved signed jobs. Counts only; no job or cell text is printed.
// BG82=<path to the extracted cc2d173 tree> node poc/f188-bg82/run3.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsv, sheetTable } from '../../src/csv.js';
import { wordsSaidOn } from '../../src/pagebits.js';
import { parseSignedText } from '../../src/signed-text.js';
import { sheetCheckColumns, sheetCheckReds, sheetCheckWordReds, bareguardChecks } from '../../src/sheetchecks.js';
import { tableChecksFailingOnInput, sheetRolesOf } from '../../src/sheetrun.js';
import { sheetChecksProp, WHERE_CMPS } from '../../src/sheetoffer.js';
import { sheetAnswerProps } from '../../src/sheetclaims.js';
import { tableSha as fwdTableSha } from 'bareguard';

const BG = process.env.BG82 ?? '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/3ce0f482-5c76-4fdf-a7f3-a80f5a98d7a7/scratchpad/bg82c';
const B = await import(pathToFileURL(path.join(BG, 'src/index.js')).href);
const { checkTables, runTableChecks, checkSchema, claimSchema, groundedValues, groundedLiterals, createRubric, tableSha, rubricVocabulary: V } = B;
const root = path.join(os.homedir(), '.config/fwdloop/flows');
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const logs = [];
const log = (s) => { logs.push(s); console.log(s); };
const sig = (a) => JSON.stringify([...a].sort());

// ---- a small JSON-schema subset validator (neither fwd nor bareguard depends on one): type, enum, required, properties, additionalProperties, items, anyOf, minLength, maxLength, minimum, minItems
function validate(s, v) {
  if (s.anyOf && !s.anyOf.some((x) => validate(x, v))) return false;
  if (s.enum && !s.enum.some((e) => e === v)) return false;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const ok = types.some((t) => (t === 'string' ? typeof v === 'string' : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : t === 'boolean' ? typeof v === 'boolean' : t === 'array' ? Array.isArray(v) : t === 'object' ? isRec(v) : false));
    if (!ok) return false;
  }
  if (typeof v === 'string') { if (s.minLength !== undefined && v.length < s.minLength) return false; if (s.maxLength !== undefined && v.length > s.maxLength) return false; }
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) return false;
  if (Array.isArray(v)) { if (s.minItems !== undefined && v.length < s.minItems) return false; if (s.items && !v.every((x) => validate(s.items, x))) return false; }
  if (isRec(v) && s.minProperties !== undefined && Object.keys(v).length < s.minProperties) return false;
  if (isRec(v) && (s.properties || s.required || s.additionalProperties !== undefined)) {
    for (const r of s.required ?? []) if (!(r in v)) return false;
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) { if (!validate(s.properties[k], x)) return false; } else if (s.additionalProperties === false) return false;
    }
  }
  return true;
}

// ---- #82 column set of one check from the vocabulary's columnAt (never a second list)
function columnAtSet(c) {
  const out = [];
  const fields = V.rules[c.rule]?.fields ?? {};
  for (const [k, f] of Object.entries(fields)) {
    if (!f.columnAt || c[k] === undefined) continue;
    const v = c[k];
    if (f.columnAt === 'self') { if (typeof v === 'string') out.push(v); }
    else if (f.columnAt === 'self.column') { if (isRec(v) && typeof v.column === 'string') out.push(v.column); }
    else if (f.columnAt === 'each.column') { if (Array.isArray(v)) for (const e of v) if (isRec(e) && typeof e.column === 'string') out.push(e.column); }
    else if (f.columnAt === 'each') { if (Array.isArray(v)) for (const e of v) if (typeof e === 'string') out.push(e); }
  }
  return out;
}

const S = { flows: 0, signed: 0, sheetJobs: 0, steps: 0, noLine: 0, checks: 0, cellsC: 0, tableC: 0, otherRule: 0,
  colPairs: 0, colAgree: 0, colDiff: [],
  redPairs: 0, redAgree: 0, redDiff: [], redBoth0: 0, redBothRed: 0, noTable: 0,
  tcPairs: 0, tcAgree: 0, tcDiff: [], tcFail: 0, tcStopped: 0,
  shaPairs: 0, shaAgree: 0, shaRun: 0, shaRunAgree: 0,
  schPairs: 0, fwdValid: 0, bgValid: 0, bgInvalid: [], bgNull: 0, bothValidDiffKeys: 0,
  clPairs: 0, clAgree: 0, clDiff: [], clNull: 0, clTypeDiff: 0, clKeys: 0, clReqDiff: 0, clEmptyRej: 0,
  wrPairs: 0, wrAgree: 0, wrDiff: [], wrBothOk: 0, wrBothRed: 0, cmpsOk: 0 };

S.cmpsOk = sig(V.rules.cells.fields.where.cmps) === sig(WHERE_CMPS) && V.rules.table.fields.where?.cmps ? 1 : 0;
const cmpOrder = JSON.stringify(V.rules.cells.fields.where.cmps) === JSON.stringify(WHERE_CMPS);

const seenSchemas = new Set();
for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  if (!fs.existsSync(path.join(d, 'declaration.json')) || !fs.existsSync(path.join(d, 'prose.txt'))) continue;
  S.flows++;
  if (!fs.existsSync(path.join(d, 'signature.json'))) continue;
  S.signed++;
  let decl; let parsed;
  try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); parsed = parseSignedText(fs.readFileSync(path.join(d, 'prose.txt'), 'utf8')); } catch { continue; }
  if (!parsed.ok) continue;
  // tables of this job: one set per run that froze every role
  const runsDir = path.join(d, 'runs');
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
  const tableSets = [];
  for (const r of runs) {
    try {
      const rj = JSON.parse(fs.readFileSync(path.join(runsDir, r, 'run.json'), 'utf8'));
      const tables = {}; const recorded = {};
      for (const e of rj.inputs ?? []) {
        const f = path.join(runsDir, r, 'inputs', path.basename(String(e.frozen)));
        if (!fs.existsSync(f) || !f.endsWith('.csv')) continue;
        tables[e.id] = sheetTable(parseCsv(fs.readFileSync(f, 'utf8')));
        recorded[e.id] = e.tableSha;
      }
      tableSets.push({ tables, recorded });
    } catch { /* a run with no run.json */ }
  }
  let jobHas = false;
  for (const st of Array.isArray(decl.steps) ? decl.steps : []) {
    const sheet = st?.close?.sheet;
    if (!(st?.close?.class === 'green' && Array.isArray(sheet))) continue;
    S.steps++; jobHas = true;
    const line = parsed.lines.find((l) => l.n === st.fromLine);
    if (!line) { S.noLine++; continue; }
    const jl = { n: line.n, text: line.text, ...(line.guardrail ? { rule: line.guardrail } : {}) };
    const text = wordsSaidOn(jl);
    const checks = sheet.filter(isRec);
    for (const c of checks) { S.checks++; if (c.rule === 'cells') S.cellsC++; else if (c.rule === 'table') S.tableC++; else S.otherRule++; }

    // grounded literals (no table needed): per check
    for (const c of checks) {
      S.wrPairs++;
      const fwdOk = sheetCheckWordReds([c], jl).length === 0;
      const g = groundedLiterals(c, text);
      if (fwdOk === g.ok) { S.wrAgree++; if (fwdOk) S.wrBothOk++; else S.wrBothRed++; } else S.wrDiff.push(`${name} line ${line.n} fwd ${fwdOk ? 'ok' : 'red'} #82 ${g.ok ? 'ok' : 'red'} paths ${g.missing.map((m) => m.path).join(',')}`);
    }
    // claim keys: per cells check
    for (const c of checks) {
      if (c.rule !== 'cells') continue;
      S.clPairs++;
      const cs = claimSchema(bareguardChecks([c])[0]); // fwd's covers is its own field; bareguardChecks strips it first, as at every other bareguard call
      const fp = sheetAnswerProps([c]);
      const fb = fp.properties[c.claim];
      if (cs === null || !fb) { S.clNull++; S.clDiff.push(`${name} line ${line.n} ${c.op}: claimSchema ${cs === null ? 'null' : 'ok'} fwd ${fb ? 'ok' : 'none'}`); continue; }
      const alts = cs.anyOf ? cs.anyOf.map((x) => sig([...(cs.required ?? []), ...(x.required ?? [])])) : [sig(cs.required ?? [])];
      const fr = sig(fb.required ?? []);
      const rowsAlt = c.op === 'rows' && c.keyColumn !== undefined && c.keyColumn !== null;
      const sameKeys = rowsAlt ? (alts.length === 2 && alts.includes(sig(['rows'])) && alts.includes(sig(['keys'])) && alts.includes(fr)) : (alts.length === 1 && alts[0] === fr);
      if (sameKeys) S.clKeys++; else S.clDiff.push(`${name} line ${line.n} ${c.op}: fwd required [${fb.required ?? []}] #82 alts ${JSON.stringify(alts)}`);
      if (!validate(cs, {})) S.clEmptyRej++;
    }
    // table-based
    for (const { tables, recorded } of tableSets) {
      const roles = sheetRolesOf([st]);
      if (roles.length === 0 || !roles.every((r) => tables[r])) { S.noTable++; continue; }
      const tbl = Object.fromEntries(roles.map((r) => [r, tables[r]]));
      // sha equivalence
      for (const r of roles) { S.shaPairs++; if (fwdTableSha(tbl[r]) === tableSha(tbl[r])) S.shaAgree++; if (recorded[r]) { S.shaRun++; if (tableSha(tbl[r]) === recorded[r]) S.shaRunAgree++; } }
      // columns
      for (const c of checks) {
        S.colPairs++;
        const a = sheetCheckColumns(c); const b = columnAtSet(c);
        if (sig(a) === sig(b)) S.colAgree++; else S.colDiff.push(`${name} line ${line.n} ${c.rule}/${c.op}: fwd ${a.length} #82 ${b.length}`);
      }
      // reds vs checkTables
      const inputs = roles.map((r) => ({ name: r, sha256: tableSha(tbl[r]) ?? '0'.repeat(64) }));
      const spec = { schema: 1, goal: `line ${line.n}`, inputs, checkpoints: { sheet: { gating: true, checks: bareguardChecks(checks) } }, maxReds: 3 };
      const fr = sheetCheckReds(checks, line.n, tbl);
      const pr = checkTables(spec, tbl);
      S.redPairs++;
      if ((fr.length === 0) === (pr.length === 0)) { S.redAgree++; if (fr.length === 0) S.redBoth0++; else S.redBothRed++; } else S.redDiff.push(`${name} line ${line.n}: fwd ${fr.length} reds, #82 ${pr.length} problems (${pr.map((p) => p.kind).join(',')})`);
      // table checks failing on input
      if (fr.length === 0 && pr.length === 0) {
        let rubric = null;
        try { rubric = createRubric(spec); } catch { S.tcDiff.push(`${name} line ${line.n}: #82 createRubric threw though checkTables ok`); }
        if (rubric) {
          const res = runTableChecks(rubric, 'sheet', tbl);
          for (const c of checks.filter((x) => x.rule === 'table')) {
            S.tcPairs++;
            const reds = await tableChecksFailingOnInput({ steps: [{ fromLine: st.fromLine, close: { class: 'green', sheet: [c] } }] }, tbl);
            const row = res.find((x) => x.id === c.id);
            const bgFail = !row || row.verdict !== 'green';
            if (row?.verdict === 'stopped') S.tcStopped++;
            if (bgFail) S.tcFail++;
            if ((reds.length > 0) === bgFail) S.tcAgree++; else S.tcDiff.push(`${name} line ${line.n} ${c.op}: fwd ${reds.length > 0 ? 'fails' : 'passes'} #82 ${row?.verdict ?? 'no row'}`);
          }
        }
      }
      // schemas: every saved check validates; one pair per (check, table-set)
      const fwdProp = sheetChecksProp(tbl);
      for (const c of checks) {
        if (typeof c.table !== 'string' || !tbl[c.table]) continue;
        S.schPairs++;
        const fv = fwdProp ? validate(fwdProp.items, c) : false;
        const cs = checkSchema({ rules: ['cells', 'table'], columns: tbl[c.table].header, tables: [c.table] });
        if (cs === null) { S.bgNull++; continue; }
        const bv = validate(cs, bareguardChecks([c])[0]);
        if (fv) S.fwdValid++;
        if (bv) S.bgValid++; else S.bgInvalid.push(`${name} line ${line.n} ${c.rule}/${c.op}`);
        if (fv && bv && sig(Object.keys(cs.properties).filter((k) => k !== 'covers')) !== sig(Object.keys(fwdProp.items.properties).filter((k) => k !== 'covers'))) S.bothValidDiffKeys++;
      }
    }
  }
  if (jobHas) S.sheetJobs++;
}

// ---- forced cases (synthetic data)
const F = [];
const ft = { header: ['Id', 'Amount'], rows: [{ rowNumber: 2, cells: ['a', '5'] }, { rowNumber: 3, cells: ['a', '7'] }] };
const sha = tableSha(ft);
const mk = (checks) => ({ schema: 1, goal: 'g', inputs: [{ name: 't', sha256: sha }], checkpoints: { s: { gating: true, checks } }, maxReds: 3 });
// 1: header that is not a column
{
  const c = { id: 'sum', rule: 'cells', table: 't', claim: 'ans', op: 'sum', column: 'Nope', };
  const p = checkTables(mk([c]), { t: ft });
  const fr = sheetCheckReds([c], 1, { t: ft });
  const hit = p.filter((x) => x.kind === 'not-a-column');
  const ok = hit.length === 1 && hit[0].field === 'column' && fr.length > 0;
  F.push(['header not a column', ok, `#82 problems ${p.length} (not-a-column ${hit.length}, field "${hit[0]?.field}"); fwd reds ${fr.length}`]);
}
// 2: table sha mismatch
{
  const c = { id: 'dup', rule: 'table', table: 't', op: 'noDuplicates', column: 'Id' };
  const changed = { header: ft.header, rows: [{ rowNumber: 2, cells: ['a', '5'] }, { rowNumber: 3, cells: ['a', '8'] }] };
  const p = checkTables(mk([c]), { t: changed });
  const res = runTableChecks(createRubric(mk([c])), 's', { t: changed });
  const f = res[0]?.fault;
  const names = Array.isArray(f?.inputs) ? f.inputs.map((x) => (typeof x === 'string' ? x : x?.name ?? x?.table)) : [];
  const ok = p.some((x) => x.kind === 'sha-mismatch' && x.table === 't') && res[0]?.verdict === 'stopped' && names.includes('t');
  F.push(['table sha mismatch', ok, `checkTables kinds [${p.map((x) => x.kind)}]; runTableChecks verdict ${res[0]?.verdict}, fault.inputs ${JSON.stringify(f?.inputs)}`]);
}
// 3: literal not in the words
{
  const c = { id: 'big', rule: 'cells', table: 't', claim: 'a', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 12345 }, { column: 'Amount', cmp: 'lt', value: 500 }] };
  const g = groundedLiterals(c, 'count rows over 99999 and under $500');
  const gv = groundedValues([{ kind: 'number', value: 12345 }, { kind: 'number', value: 500 }], 'count rows over 99999 and under $500');
  const fw = sheetCheckWordReds([c], { n: 1, text: 'count rows over 99999 and under $500' });
  const ok = !g.ok && g.missing.length === 1 && g.missing[0].path === 'where[0].value' && gv.missing.length === 1 && gv.missing[0].index === 0 && fw.length === 1;
  F.push(['literal not in the words', ok, `groundedLiterals missing ${g.missing.length} (${g.missing[0]?.path}); groundedValues missing ${gv.missing.length}; fwd reds ${fw.length}`]);
}
// 4: where entry with an unknown cmp
{
  const c = { id: 'bad', rule: 'cells', table: 't', claim: 'a', op: 'countIf', where: [{ column: 'Amount', cmp: 'zzz', value: 5 }] };
  const g = groundedLiterals(c, 'count rows over 5');
  const ok = !g.ok && g.missing.some((m) => m.kind === 'invalid');
  F.push(['where unknown cmp', ok, `groundedLiterals ok ${g.ok}, missing kinds [${g.missing.map((m) => m.kind)}]`]);
}
const forcedOk = F.every((f) => f[1]);

log(`bareguard under test: ${BG} (${JSON.parse(fs.readFileSync(path.join(BG, 'package.json'), 'utf8')).version}, cc2d173); fwd's own functions use its installed bareguard`);
log(`flows ${S.flows}; signed ${S.signed}; jobs with a close.sheet ${S.sheetJobs}; sheet steps ${S.steps} (job line missing ${S.noLine}); checks ${S.checks} (cells ${S.cellsC}, table ${S.tableC}, other ${S.otherRule}); step-table sets skipped (no frozen input) ${S.noTable}`);
log(`vocabulary where.cmps equals fwd WHERE_CMPS as a set ${S.cmpsOk === 1} (same order ${cmpOrder}); cmpKinds present ${isRec(V.rules.cells.fields.where.cmpKinds)}`);
log(`tableSha fwd-installed vs #82: ${S.shaAgree}/${S.shaPairs}; #82 vs sha recorded in run.json: ${S.shaRunAgree}/${S.shaRun}`);
log(`sheetCheckColumns vs columnAt: ${S.colAgree}/${S.colPairs} same column set`);
log(`sheetCheckReds vs checkTables: ${S.redAgree}/${S.redPairs} same ok/red (both ok ${S.redBoth0}, both red ${S.redBothRed})`);
log(`tableChecksFailingOnInput vs runTableChecks: ${S.tcAgree}/${S.tcPairs} table checks same pass/fail (failing ${S.tcFail}, of which stopped ${S.tcStopped})`);
log(`sheetChecksProp vs checkSchema (hand validator, no JSON-schema dependency in fwd or bareguard): checks ${S.schPairs}; valid against fwd's schema ${S.fwdValid}; valid against #82's schema (covers stripped) ${S.bgValid}; #82 returned null ${S.bgNull}; both valid but property sets differ ${S.bothValidDiffKeys}`);
log(`claimSchema required keys match fwd (rows with keyColumn: rows OR keys): ${S.clKeys}/${S.clPairs}; {} rejected ${S.clEmptyRej}/${S.clPairs}; null/none ${S.clNull}`);
log(`sheetCheckWordReds vs groundedLiterals: ${S.wrAgree}/${S.wrPairs} same ok/red (both ok ${S.wrBothOk}, both red ${S.wrBothRed})`);
for (const [k, arr] of [['columns', S.colDiff], ['reds', S.redDiff], ['tablechecks', S.tcDiff], ['claims', S.clDiff], ['words', S.wrDiff], ['schema-invalid', S.bgInvalid]]) for (const x of [...new Set(arr)]) log(`  DIFF ${k}: ${x}`);
for (const [n, ok, why] of F) log(`forced "${n}": ${ok ? 'caught' : 'NOT caught'} - ${why}`);
const pass = S.colAgree === S.colPairs && S.redAgree === S.redPairs && S.tcAgree === S.tcPairs && S.tcDiff.length === 0 && S.clKeys === S.clPairs && S.clEmptyRej === S.clPairs && S.wrAgree === S.wrPairs && S.bgValid === S.schPairs && S.fwdValid === S.schPairs && forcedOk && S.colPairs > 0;
log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(new URL('./result-3.log', import.meta.url), logs.join('\n') + '\n');
