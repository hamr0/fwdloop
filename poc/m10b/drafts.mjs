// POC F76 Part B: does deepseek-flash, given bareguard 0.26.0's rubricVocabulary, draft the right sheet checks? NOT the product.
// borrowed-from: poc/am28-word-limit/draft.mjs (forced tool call, per-round metering via Loop onLlmResult, prices from Settings via makeProvider).
//   node poc/m10b/drafts.mjs --dry            $0: build and print both prompts (cell text of Customer/Description redacted) + tool schema; no network, no key
//   node poc/m10b/drafts.mjs --tag <tag>      PAID (6 calls): needs DEEPSEEK_API_KEY in the env (the provider row name in Settings; first line of the pass entry only)
// Results: poc/m10b/results/<tag>.json. A tag that already has results is refused; a result file is never overwritten.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Loop, HaltError } from 'bare-agent';
import { loadTable } from './csv.mjs';
import { makeProvider, sumMeterings, checkKeyPreflight } from '../../src/provider.js';

const BG = process.env.BG_DIR ?? '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/328a4973-930c-40ea-bec1-36b24a44540b/scratchpad/bg026/node_modules/bareguard/src/index.js';
const { createRubric, tableSha, rubricVocabulary: V } = await import(pathToFileURL(BG).href);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLOT = 'DEEPSEEK_API_KEY';
const MODEL = 'deepseek-flash';
const TOOL = 'emit_checks';
const DRAFTS_PER_JOB = 3;
const MAX_TOKENS = 16000; // = DRAFT_MAX_TOKENS in src/drafter.js
const PROVIDER_OPTIONS = { timeoutMs: 300_000, deadlineMs: 240_000 }; // = LIVE_PROVIDER_OPTIONS in src/model-step.js
const BUDGET_USD = 0.20; // POC stop: M10b cap is $0.50, expected ~$0.02

const JOBS = [
  { name: 'expenses', prose: 'flows/m10-walk-csv-3/signed/prose.txt', csv: 'flows/m10-walk-csv/runs/run-1/inputs/expenses.csv', table: 'expenses', pii: ['Description'] },
  { name: 'aging', prose: 'flows/aging-live-4/signed/prose.txt', csv: 'flows/aging-live-4/runs/run-1/inputs/aging.csv', table: 'aging', pii: ['Customer'] },
];

// ---- prompt (vocabulary-generated, never hand-copied) ----
function opsText() {
  const out = [];
  for (const rule of ['cells', 'table']) {
    out.push(`## rule "${rule}"`);
    out.push(`fields: ${Object.entries(V.rules[rule].fields).map(([k, f]) => `${k} (${f.type}${f.required ? ', required' : ''}): ${f.description ?? ''}`).join('\n  ')}`);
    for (const [op, o] of Object.entries(V.rules[rule].ops)) {
      out.push(`### op "${op}": ${o.summary}`);
      out.push(`requires: ${(o.requires ?? []).join(', ') || '-'}; allows: ${(o.allows ?? []).join(', ') || '-'}${o.claim ? `; claim: ${o.claim}` : ''}`);
      out.push(`worked example check: ${JSON.stringify(o.example.check)}`);
    }
  }
  out.push(`example tables the worked examples run against: ${JSON.stringify(V.cells.exampleTables.t)}`);
  out.push(`date formats: ${V.cells.dateFormats.join(' | ')}`);
  return out.join('\n');
}
const SYSTEM = `You write the SIGNED CHECKS a person will sign for one spreadsheet job. A check is a typed object; a later step supplies only values (a claim) and bareguard recomputes and compares. You choose the rule, op, columns, conditions, dates and bands. You never write a formula or a regex.
Rules: write only checks the job's guardrails need. A column name must be copied exactly as the sheet's header row spells it. Every check names the table given below. A "cells" check also names \`claim\`: the name of the output field that will hold the claim object (any short word). Every check has a unique \`id\`. Use only the ops listed below with the fields each op allows. Call ${TOOL} once with the list.

${opsText()}`;

const TYPE = { name: { type: 'string' }, string: { type: 'string' }, explanation: { type: 'string' }, date: { type: 'string' }, integer: { type: 'integer' }, number: { type: 'number' }, boolean: { type: 'boolean' } };
const CMPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between', 'before', 'after', 'dateBetween', 'dateOn', 'equals', 'empty', 'notEmpty'];
function fieldSchema(f) {
  const d = f.description ? { description: f.description } : {};
  if (f.type === 'enum') return { type: 'string', enum: f.enum, ...d };
  if (f.type === 'range') return { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } }, ...d };
  if (f.type === 'cell') return { type: 'object', properties: { column: { type: 'string' }, row: { type: 'integer' } }, ...d };
  if (f.type === 'condition-list') return { type: 'array', items: { type: 'object', properties: { column: { type: 'string' }, cmp: { type: 'string', enum: CMPS }, value: {}, lo: {}, hi: {} }, required: ['column', 'cmp'] }, ...d };
  if (f.type === 'date-format-list') return { type: 'array', items: { type: 'object', properties: { column: { type: 'string' }, format: { type: 'string', enum: V.cells.dateFormats } }, required: ['column', 'format'] }, ...d };
  if (f.type === 'band-list') return { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, gt: { type: 'number' }, gte: { type: 'number' }, lt: { type: 'number' }, lte: { type: 'number' } }, required: ['name'] }, ...d };
  if (f.type === 'operand') return { ...d };
  return { ...(TYPE[f.type] ?? {}), ...d };
}
function buildSchema() {
  const props = { id: { type: 'string', description: 'unique, short' }, rule: { type: 'string', enum: ['cells', 'table'] } };
  for (const r of ['cells', 'table']) for (const [k, f] of Object.entries(V.rules[r].fields)) {
    if (k === 'op') continue;
    props[k] ??= fieldSchema(f);
  }
  props.op = { type: 'string', enum: [...Object.keys(V.rules.cells.ops), ...Object.keys(V.rules.table.ops)], description: 'cells ops go with rule "cells"; table ops with rule "table"' };
  return { type: 'object', properties: { checks: { type: 'array', items: { type: 'object', properties: props, required: ['id', 'rule', 'table', 'op'] } } }, required: ['checks'] };
}
const redactRow = (job, header, cells) => cells.map((c, i) => (job.pii.includes(header[i]) ? '<redacted>' : c));
function userText(job, { redact }) {
  const prose = readFileSync(join(ROOT, job.prose), 'utf8');
  const t = loadTable(join(ROOT, job.csv));
  const sample = t.rows.slice(0, 3).map((r) => `row ${r.rowNumber}: ${JSON.stringify(redact ? redactRow(job, t.header, r.cells) : r.cells)}`).join('\n');
  return `The signed job:\n${prose}\nThe table is named "${job.table}" (the file named in the job's source guardrail). Its header row is row 1; rows are numbered as in the sheet.\nHeader: ${JSON.stringify(t.header)}\nThe first 3 data rows:\n${sample}\n\nWrite the checks this job's guardrails need. Call ${TOOL} now.`;
}

// ---- grading (F76 criteria 1-3) ----
const dayBand = (n) => (n <= 0 ? 'Current' : n <= 30 ? '1-30' : n <= 60 ? '31-60' : n <= 90 ? '61-90' : '90+');
const holds = (b, n) => (b.gt === undefined || n > b.gt) && (b.gte === undefined || n >= b.gte) && (b.lt === undefined || n < b.lt) && (b.lte === undefined || n <= b.lte);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function columnsOf(c) {
  const cols = [];
  for (const k of ['column', 'keyColumn', 'groupColumn', 'result']) if (typeof c[k] === 'string') cols.push(c[k]);
  for (const k of ['a', 'b']) if (typeof c[k] === 'string') cols.push(c[k]);
  for (const k of ['from', 'to', 'cell']) if (c[k]?.column) cols.push(c[k].column);
  for (const w of Array.isArray(c.where) ? c.where : []) if (w?.column) cols.push(w.column);
  for (const d of Array.isArray(c.dateFormats) ? c.dateFormats : []) if (d?.column) cols.push(d.column);
  return cols;
}
function bandsRight(bands) {
  if (!Array.isArray(bands) || bands.length !== 5) return 'not exactly 5 bands';
  const want = ['Current', '1-30', '31-60', '61-90', '90+'];
  if (!same(bands.map((b) => b?.name).sort(), [...want].sort())) return `band names ${JSON.stringify(bands.map((b) => b?.name))}`;
  for (let n = -400; n <= 600; n += 1) {
    const hit = bands.filter((b) => holds(b, n)).map((b) => b.name);
    if (!same(hit, [dayBand(n)])) return `${n} days falls in ${JSON.stringify(hit)}, expected ${dayBand(n)}`;
  }
  return null;
}
export function grade(job, args, tableObj, header) {
  const why = { c1: null, c2: null, c3: null };
  const checks = args?.checks;
  if (!Array.isArray(checks) || checks.length === 0) return { c1: false, c2: false, c3: false, why: { c1: 'no checks list', c2: 'no checks list', c3: 'no checks list' } };
  // 1: createRubric accepts every check (all together; if refused, each alone, to say which)
  const mk = (list) => createRubric({ schema: 1, goal: job.name, inputs: [{ name: job.table, sha256: tableSha(tableObj) }], checkpoints: { cp: { gating: true, checks: list } }, maxReds: 3 });
  try { mk(checks); } catch (e) {
    const bad = checks.map((c, i) => { try { mk([c]); return null; } catch (e2) { return `check ${i} (${c?.id}): ${e2.message}`; } }).filter(Boolean);
    why.c1 = bad.length ? bad.join(' | ') : `together: ${e.message}`;
  }
  // 2: every column named is a real header, exactly
  const unknown = [...new Set(checks.flatMap((c) => columnsOf(c ?? {})).filter((x) => !header.includes(x)))];
  if (unknown.length) why.c2 = `not a header: ${JSON.stringify(unknown)}`;
  // 3: the checks the guardrail needs
  const miss = [];
  const cells = checks.filter((c) => c?.rule === 'cells'); const tbl = checks.filter((c) => c?.rule === 'table');
  if (job.name === 'expenses') {
    const ok = cells.some((c) => c.op === 'rows' && c.table === job.table && Array.isArray(c.where) && c.where.length === 1 && c.where[0].column === 'Amount' && c.where[0].cmp === 'gt' && Number(c.where[0].value) === 500);
    if (!ok) miss.push('no cells rows with the single condition Amount gt 500');
  } else {
    const b = cells.find((c) => c.op === 'band' && c.column === 'Due date' && c.asOf === '2026-10-11' && !bandsRight(c.bands));
    if (!b) {
      const cand = cells.filter((c) => c.op === 'band');
      miss.push(!cand.length ? 'no band check' : cand.map((c) => `band: column=${c.column} asOf=${c.asOf} ${bandsRight(c.bands) ?? 'bands ok'}`).join(' | '));
    }
    if (!tbl.some((c) => c.op === 'noDuplicates' && c.column === 'Invoice #')) miss.push('no table noDuplicates on Invoice #');
  }
  if (miss.length) why.c3 = miss.join('; ');
  return { c1: why.c1 === null, c2: why.c2 === null, c3: why.c3 === null, why };
}

// ---- run ----
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const tagAt = args.indexOf('--tag');
const tag = tagAt >= 0 ? args[tagAt + 1] : null;
const schema = buildSchema();

if (dry) {
  console.log(`DRY (no network, $0). Tool ${TOOL}, model ${MODEL}, thinking off, forced tool call, maxTokens ${MAX_TOKENS}, ${DRAFTS_PER_JOB} drafts per job.`);
  console.log(`system prompt: ${SYSTEM.length} chars (same for both jobs)\n----- SYSTEM -----\n${SYSTEM}\n`);
  for (const job of JOBS) {
    const u = userText(job, { redact: true });
    const real = userText(job, { redact: false });
    console.log(`----- USER (${job.name}; ${job.pii.join('/')} cell text redacted here only) -----\n${u}\n`);
    console.log(`prompt size ${job.name}: system ${SYSTEM.length} + user ${real.length} = ${SYSTEM.length + real.length} chars\n`);
  }
  console.log(`----- TOOL SCHEMA (${TOOL}) -----\n${JSON.stringify(schema, null, 1)}`);
  // $0 self-test of the grader against hand-written good and bad drafts
  const t = loadTable(join(ROOT, JOBS[1].csv));
  const good = { checks: [
    { id: 'b', rule: 'cells', table: 'aging', claim: 'b', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: [{ column: 'Due date', format: 'YYYY-MM-DD' }], bands: [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }] },
    { id: 'd', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' }] };
  const bad = structuredClone(good); bad.checks[0].bands[4] = { name: '90+', gt: 91 }; bad.checks[1].column = 'Invoice';
  console.log('\ngrader self-test (aging): good =', JSON.stringify(grade(JOBS[1], good, t, t.header)), '\n  bad  =', JSON.stringify(grade(JOBS[1], bad, t, t.header)));
  process.exit(0);
}

if (!tag || !/^[A-Za-z0-9._-]+$/.test(tag)) { console.error('usage: node poc/m10b/drafts.mjs --tag <tag> | --dry'); process.exit(2); }
const outPath = join(ROOT, 'poc/m10b/results', `${tag}.json`);
if (existsSync(outPath)) { console.error(`refused: results for tag "${tag}" already exist (${outPath}); use a new tag`); process.exit(2); }
const pre = checkKeyPreflight(SLOT);
if (!pre.ok) { console.error(`refused at $0, nothing written: ${pre.message}`); process.exit(2); }
let made;
try { made = makeProvider(SLOT, { model: MODEL, ...PROVIDER_OPTIONS }); } catch (e) { console.error(`refused at $0, nothing written: ${e.message}`); process.exit(2); }
const { provider, rates, modelId, prices } = made;
mkdirSync(dirname(outPath), { recursive: true });
const result = { tag, model: modelId, prices: prices?.perM ?? null, startedAt: new Date().toISOString(), jobs: {}, totalCostUsd: 0, costComplete: true, part: null };
const save = () => writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);
writeFileSync(outPath, `${JSON.stringify({ ...result, status: 'running' })}\n`, { flag: 'wx' }); // claims the tag; a second run is refused above

let stopAll = false;
for (const job of JOBS) {
  const t = loadTable(join(ROOT, job.csv));
  const user = userText(job, { redact: false });
  result.jobs[job.name] = { promptChars: SYSTEM.length + user.length, promptSha256: createHash('sha256').update(SYSTEM + user).digest('hex'), drafts: [] };
  for (let i = 1; i <= DRAFTS_PER_JOB && !stopAll; i += 1) {
    let captured; const events = []; let stop = null; let res; let unmetered = false;
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
    const tool = { name: TOOL, description: 'Emit the list of signed checks for this job.', parameters: schema, execute: async (a) => { captured = a; throw new HaltError('captured', { rule: 'captured' }); } };
    try {
      res = await loop.run([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], [tool], { maxTokens: MAX_TOKENS, thinkingMode: 'off', toolChoice: { name: TOOL } });
    } catch (e) { stop = `provider-error: ${e.message}`; if (events.length === 0) unmetered = true; }
    const m = sumMeterings(events);
    const malformed = provider?.lastMalformedToolCall ?? null;
    const stopReason = res?.stopReason ?? null;
    if (!captured && !stop) stop = stopReason === 'max_tokens' || stopReason === 'length' ? 'truncated (length stop, not "no tool call")' : malformed ? `malformed tool-call arguments: ${malformed.error}` : 'no tool call';
    const g = captured ? grade(job, captured, t, t.header) : { c1: false, c2: false, c3: false, why: { c1: stop, c2: stop, c3: stop } };
    const cost = unmetered ? null : m.costUsd;
    if (cost === null) result.costComplete = false; else result.totalCostUsd += cost;
    result.jobs[job.name].drafts.push({ n: i, pass: g.c1 && g.c2 && g.c3, c1: g.c1, c2: g.c2, c3: g.c3, why: g.why, stop, stopReason, costUsd: cost, rounds: m.rounds, tokens: m.tokens, modelReturned: m.model, args: captured ?? null, rawMalformed: malformed?.raw ?? null });
    save();
    console.log(`${job.name} #${i}: ${g.c1 && g.c2 && g.c3 ? 'PASS' : 'fail'} c1=${g.c1} c2=${g.c2} c3=${g.c3} cost=${cost === null ? 'unknown' : `$${cost.toFixed(5)}`}${stop ? ` stop=${stop}` : ''}`);
    if (result.totalCostUsd > BUDGET_USD) { console.error(`stopping: spent more than the POC budget $${BUDGET_USD}`); stopAll = true; }
  }
}
const passes = (n) => result.jobs[n].drafts.filter((d) => d.pass).length;
const ok = !stopAll && JOBS.every((j) => passes(j.name) >= 2 && result.jobs[j.name].drafts.length === DRAFTS_PER_JOB);
result.part = ok ? 'PASS' : 'FAIL'; result.finishedAt = new Date().toISOString();
save();
for (const j of JOBS) console.log(`${j.name}: ${passes(j.name)}/${result.jobs[j.name].drafts.length} drafts pass (need 2 of ${DRAFTS_PER_JOB})`);
console.log(`total cost: ${result.costComplete ? '' : 'at least '}$${result.totalCostUsd.toFixed(5)}`);
console.log(`PART B: ${result.part}`);
