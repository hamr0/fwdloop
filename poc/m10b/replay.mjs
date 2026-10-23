// POC F76 Part A ($0, no network): replay bareguard 0.26.0 sheet checks over the two real frozen CSVs.
// Honest claims are computed in plain JS, independently of bareguard. No cell text from Customer/Description is printed.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTable } from './csv.mjs';

const BG = process.env.BG_DIR ?? '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/328a4973-930c-40ea-bec1-36b24a44540b/scratchpad/bg026/node_modules/bareguard/src/index.js';
const { createRubric, checkStep, tableSha, rubricVocabulary } = await import(BG);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exp = loadTable(join(ROOT, 'flows/m10-walk-csv/runs/run-1/inputs/expenses.csv'));
const age = loadTable(join(ROOT, 'flows/aging-live-4/runs/run-1/inputs/aging.csv'));

const col = (t, name) => t.header.indexOf(name);
const ASOF = '2026-10-11';
const dayN = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

// --- honest claims, plain JS ---
const aIdx = col(exp, 'Amount');
const over = exp.rows.filter((r) => Number(r.cells[aIdx]) > 500);
const honest = {
  exRows: { rows: over.map((r) => r.rowNumber) },
  exCount: { value: over.length },
  exSum: { value: over.reduce((s, r) => s + Number(r.cells[aIdx]), 0) },
};
const dIdx = col(age, 'Due date');
const days = Object.fromEntries(age.rows.map((r) => [r.rowNumber, dayN(ASOF) - dayN(r.cells[dIdx])]));
const bandOf = (n) => (n <= 0 ? 'Current' : n <= 30 ? '1-30' : n <= 60 ? '31-60' : n <= 90 ? '61-90' : '90+');
const bands = Object.fromEntries(Object.entries(days).map(([k, n]) => [k, bandOf(n)]));
const agRows = { rows: age.rows.map((r) => r.rowNumber) };

// --- signed checks ---
const ISO = (c) => [{ column: c, format: 'YYYY-MM-DD' }];
const exChecks = [
  { id: 'ex-rows', rule: 'cells', table: 'expenses', claim: 'rows', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] },
  { id: 'ex-countIf', rule: 'cells', table: 'expenses', claim: 'count', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] },
  { id: 'ex-sumIf', rule: 'cells', table: 'expenses', claim: 'sum', op: 'sumIf', column: 'Amount', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] },
];
const agChecks = [
  { id: 'ag-days', rule: 'cells', table: 'aging', claim: 'days', op: 'daysSince', column: 'Due date', asOf: ASOF, dateFormats: ISO('Due date') },
  { id: 'ag-band', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: ASOF, dateFormats: ISO('Due date'),
    bands: [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }] },
  { id: 'ag-nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' },
  { id: 'ag-rows', rule: 'cells', table: 'aging', claim: 'allrows', op: 'rows', where: [{ column: 'Invoice #', cmp: 'notEmpty' }] },
];
const mk = (goal, name, table, checks) => createRubric({
  schema: 1, goal, inputs: [{ name, sha256: tableSha(table) }],
  checkpoints: { cp: { gating: true, checks } }, maxReds: 3,
});
const exR = mk('expenses over 500', 'expenses', exp, exChecks);
const agR = mk('aging buckets', 'aging', age, agChecks);

const run = (r, output, tables) => checkStep(r, 'cp', output, { tables });
const kinds = (res) => (res.gaps ?? []).map((g) => g.kind + (g.items?.length ? '[' + g.items.slice(0, 4).join(',') + ']' : '')).join(' ');
const fails = [];
const line = (name, h, w) => {
  const hs = h.verdict, ws = w.verdict;
  console.log(`${name.padEnd(12)} honest=${hs.padEnd(8)} wrong=${ws.padEnd(8)} gap=${kinds(w) || (w.fault ? 'fault:' + w.fault.kind : '-')}`);
  if (hs !== 'green') fails.push(`${name}: honest not green (${hs}; ${kinds(h)}${h.fault ? ' fault:' + h.fault.kind + ' ' + (h.fault.detail ?? '') : ''})`);
  if (ws !== 'red' || !(w.gaps?.length)) fails.push(`${name}: wrong claim not red-with-gap (${ws})`);
};

const exT = { expenses: exp }, agT = { aging: age };
// per-check: isolate each check by checking the whole rubric but reading per-check results
const perCheck = (res, id) => ({ verdict: res.checks?.[id]?.verdict ?? res.results?.find?.((c) => c.id === id)?.verdict, raw: res });

// Whole-rubric runs: honest output carries all claims; wrong outputs break exactly one claim each.
const exHonestOut = { rows: honest.exRows, count: honest.exCount, sum: honest.exSum };
const agHonestOut = { days: { days }, bands: { bands }, allrows: agRows };
const dropOne = (a) => a.slice(0, -1);
const exWrong = {
  'ex-rows': { ...exHonestOut, rows: { rows: dropOne(honest.exRows.rows) } },
  'ex-countIf': { ...exHonestOut, count: { value: 18 } },
  'ex-sumIf': { ...exHonestOut, sum: { value: honest.exSum.value + 1 } },
};
const firstDay = Object.keys(days)[0];
const agWrong = {
  'ag-days': { ...agHonestOut, days: { days: { ...days, [firstDay]: days[firstDay] + 1 } } },
  'ag-band': { ...agHonestOut, bands: { bands: { ...bands, [firstDay]: bands[firstDay] === 'Current' ? '1-30' : 'Current' } } },
  'ag-rows': { ...agHonestOut, allrows: { rows: dropOne(agRows.rows) } },
};
const exH = await run(exR, exHonestOut, exT);
const agH = await run(agR, agHonestOut, agT);
console.log(`expenses: ${exp.rows.length} data rows, ${over.length} over 500, sum ${honest.exSum.value.toFixed(2)}; aging: ${age.rows.length} rows, days ${JSON.stringify(days)}`);
console.log('honest whole-rubric verdict:', 'expenses=' + exH.verdict, 'aging=' + agH.verdict);
if (exH.verdict !== 'green') fails.push('expenses honest rubric not green: ' + kinds(exH));
if (agH.verdict !== 'green') fails.push('aging honest rubric not green: ' + kinds(agH));

const each = async (r, honestOut, wrongs, tables) => {
  for (const [id, wOut] of Object.entries(wrongs)) {
    const w = await run(r, wOut, tables);
    const h = await run(r, honestOut, tables);
    line(id, h, w);
    // the wrong claim must be named in the gaps (reason naming it)
    if (!JSON.stringify(w.gaps ?? []).includes(id)) fails.push(`${id}: gap does not name the check`);
  }
};
await each(exR, exHonestOut, exWrong, exT);
await each(agR, agHonestOut, agWrong, agT);

// noDuplicates: honest sheet green; a sheet with a repeated Invoice # is red (re-signed on the dup table, same job)
const dupT = structuredClone(age); const iI = col(age, 'Invoice #'); dupT.rows[1].cells[iI] = dupT.rows[0].cells[iI];
const dupR = mk('dup', 'aging', dupT, agChecks);
const dh = await run(agR, agHonestOut, agT);
const dw = await run(dupR, agHonestOut, { aging: dupT });
line('ag-nodup', dh, dw);
if (!JSON.stringify(dw.gaps ?? []).includes('ag-nodup')) fails.push('ag-nodup: gap does not name the check');

// the sheet changed by one cell after signing -> stopped
const chT = structuredClone(exp); chT.rows[0].cells[aIdx] = String(Number(chT.rows[0].cells[aIdx]) + 1);
const ch = await run(exR, exHonestOut, { expenses: chT });
console.log(`changed-cell  verdict=${ch.verdict} fault=${ch.fault?.kind} detail=${ch.fault?.detail}`);
if (ch.verdict !== 'stopped') fails.push('changed sheet not stopped: ' + ch.verdict);

// 18 instead of 17
const e18 = await run(exR, { ...exHonestOut, count: { value: 18 } }, exT);
console.log(`18-not-${over.length}      verdict=${e18.verdict} gap=${kinds(e18)}`);
if (e18.verdict !== 'red' || over.length !== 17) fails.push(`18-not-17: verdict ${e18.verdict}, honest count ${over.length}`);

console.log(fails.length ? 'FAILURES:\n- ' + fails.join('\n- ') : '(no failures)');
console.log('PART A: ' + (fails.length ? 'FAIL' : 'PASS'));
process.exit(fails.length ? 1 : 0);
