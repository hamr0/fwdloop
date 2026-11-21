// borrowed-from: bareloop src/sheetclaims.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/sheetclaims.js@v0.35.0 (M10b piece 2; docs/product/ITEM33-BUILD.md "Addendum 2026-11-17", S3). What a step that reads a sheet is told and what it answers in.
// A step answers each `cells` check's CLAIM in bareguard's typed box ({value}, {rows}, {days}, {bands}, ...) inside the `claims` key of its step file, never a cite or a formula. The box the step is TOLD is
// bareguard's own worked example for the op (`rubricVocabulary.rules.cells.ops.<op>.example`); never hand-copied here. The step is told the box, not the check: no op, no condition, no bound, no column
// ever reaches it (tests/sheet-run.test.js, the request-construction test).
// What bareloop adds to fwd's file (hamr's rulings 2026-11-17, F338/F339/F343):
//   (i)   a claim name is never a box type (`rows`, `value`, `days`, `bands`) nor a step-file key (`text`): `sheetShapeReds` is the stage-shape red;
//   (ii)  `sheetNumberedView`: the row-numbered text view of the frozen sheet the worker reads for row numbers (written at run start by src/sheetrun.js; never graded);
//   (iii) code does the math: for `sumIf` and `countIf` the worker names ROWS (a `rows` box), and `gradedChecks` turns the check into bareguard's own `rows` check of the same condition, so the named rows
//         are the thing graded; `sheetTotalLines` computes the sum and the count from the frozen table and the rows named, and src/sheetrun.js `writeSheetTotals` delivers that line.
// Throws away: a check with no claim (a `table` check judges the sheet itself) adds no box; two checks with the same claim name share one box; the worker's own sum or count is never read.
import { rubricVocabulary } from 'bareguard';
import { bareguardChecks, SHEET_RULES, MAX_SHEET_CHECKS, sheetNoClaimReds } from './sheetchecks.js';

const V = /** @type {any} */ (rubricVocabulary);
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (/** @type {unknown} */ v) => typeof v === 'string' && v.trim() !== '';
const sortedJson = (/** @type {unknown} */ v) => JSON.stringify(v, (_k, x) => (isRec(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** the ops whose number the worker does NOT write: it names the rows, and code computes the figure (hamr 2026-11-17, (iii)) */
export const ROW_MATH_OPS = Object.freeze(['sumIf', 'countIf']);

/** the keys of every answer box bareguard documents (read off each op's worked example): a claim name is never one of these (hamr 2026-11-17, (i)) */
export const BOX_TYPES = Object.freeze([...new Set(Object.values(V.rules.cells.ops).flatMap((/** @type {any} */ op) => {
  const box = op?.example?.output?.[op?.example?.check?.claim];
  return isRec(box) ? Object.keys(box) : [];
}))]);

/** the keys of a step file a claim name may not take, or its field would overwrite them */
export const RESERVED_CLAIMS = Object.freeze(['text', 'cites', 'claims', 'results']);

/** the part of a rubric-step's params that holds the sheet checks, or null @param {any} params @returns {any|null} */
export function sheetPartOf(params) {
  const parts = Array.isArray(params?.parts) ? params.parts : [];
  return parts.find((/** @type {any} */ x) => isRec(x) && x.class === 'sheet') ?? null;
}

/** the sheet checks of a step (as signed), `[]` when it has no sheet part @param {any} params @returns {any[]} */
export function sheetChecksOf(params) {
  const p = sheetPartOf(params);
  return p && Array.isArray(p.checks) ? p.checks.filter(isRec) : [];
}

/** the input labels (sheet roles) a step's checks read, once each, in order @param {any} params @returns {string[]} */
export function sheetRolesOfParams(params) {
  return [...new Set(sheetChecksOf(params).map((c) => c.table).filter((t) => typeof t === 'string'))];
}

/**
 * The sheet inputs any rubric-step stage of a close declaration reads, once each, in order.
 * @param {any} closeDecl @returns {string[]}
 */
export function sheetRolesOf(closeDecl) {
  const roles = [];
  for (const st of Array.isArray(closeDecl?.stages) ? closeDecl.stages : []) {
    if (!isRec(st) || st.kind !== 'rubric-step') continue;
    for (const r of sheetRolesOfParams(st.params)) if (!roles.includes(r)) roles.push(r);
  }
  return roles;
}

/** the condition a check reads rows by, as one string: two checks with the same one select the same rows @param {any} c @returns {string} */
const conditionKey = (c) => sortedJson([c.table, c.where ?? null, c.range ?? null, c.dateFormats ?? null]);

/**
 * The sheet part of a step, from the checks `buildSheetChecks` made (S2): a sum and a count of ONE condition share the rows box (hamr 2026-11-17: "the same box serves a sum and a count of one condition"),
 * so their `claim` becomes the claim of the rows check of that condition (or of the first of them). Every id, op and field stays exactly as built: the part keeps the checks as data, as the person was shown them.
 * @param {{text: string, checks: any[], rules?: number[], covers?: number[]}} o @returns {Record<string, any>}
 */
export function buildSheetPart({ text, checks, ...rest }) {
  /** @type {Map<string, string>} the claim that owns each condition: a rows check first, else the first sum/count */
  const owner = new Map();
  for (const c of checks) if (isRec(c) && c.rule === 'cells' && c.op === 'rows' && typeof c.claim === 'string' && !owner.has(conditionKey(c))) owner.set(conditionKey(c), c.claim);
  for (const c of checks) if (isRec(c) && c.rule === 'cells' && ROW_MATH_OPS.includes(c.op) && typeof c.claim === 'string' && !owner.has(conditionKey(c))) owner.set(conditionKey(c), c.claim);
  const out = checks.map((c) => (isRec(c) && c.rule === 'cells' && ROW_MATH_OPS.includes(c.op) && owner.has(conditionKey(c)) ? { ...c, claim: owner.get(conditionKey(c)) } : { ...c }));
  return { text, class: 'sheet', checks: out, ...rest };
}

/** bareguard's own `rows` check of the same condition as a sumIf/countIf check @param {any} c @returns {Record<string, any>} */
function rowsCheckOf(c) {
  return { id: c.id, rule: 'cells', table: c.table, claim: c.claim, op: 'rows', where: c.where, ...(c.range === undefined ? {} : { range: c.range }), ...(c.dateFormats === undefined ? {} : { dateFormats: c.dateFormats }) };
}

/**
 * The checks bareguard GRADES for a list of signed sheet checks: each is cleaned of bareloop's own `covers` / `row`, and a `sumIf` / `countIf` becomes bareguard's `rows` check of its condition (hamr 2026-11-17 (iii):
 * the worker names rows, so the rows are what is checked and the sum and count are computed by code from them). A derived check equal to a `rows` check already in the list (same claim, same condition) is not added twice.
 * Every other check is graded as signed. @param {any[]} checks @returns {any[]}
 */
export function gradedChecks(checks) {
  const clean = bareguardChecks(checks.filter(isRec));
  const seen = new Set(clean.filter((c) => c.rule === 'cells' && c.op === 'rows').map((c) => `${c.claim}\u0000${conditionKey(c)}`));
  /** @type {any[]} */
  const out = [];
  for (const c of clean) {
    if (c.rule === 'cells' && ROW_MATH_OPS.includes(c.op)) {
      const d = rowsCheckOf(c);
      const key = `${d.claim}\u0000${conditionKey(d)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    } else out.push(c);
  }
  return out;
}

/**
 * The claim box of every graded `cells` check: `[{claim, example}]`, one per claim name, in order. `example` is the op's worked-example answer (the box's shape with example values).
 * A check bareguard has no example for, and a `table` check, add nothing.
 * @param {any[]} checks a step's sheet checks as signed @returns {Array<{claim: string, example: Record<string, any>}>}
 */
export function sheetClaims(checks) {
  /** @type {Map<string, {claim: string, example: Record<string, any>}>} */
  const out = new Map();
  const ops = V.rules?.cells?.ops ?? {};
  for (const c of gradedChecks(Array.isArray(checks) ? checks : [])) {
    if (c.rule !== 'cells' || typeof c.claim !== 'string' || typeof c.op !== 'string') continue;
    const ex = ops[c.op]?.example;
    const shape = isRec(ex) && isRec(ex.output) && isRec(ex.check) ? ex.output[ex.check.claim] : undefined;
    if (!isRec(shape)) continue;
    const have = out.get(c.claim);
    if (have) Object.assign(have.example, shape); else out.set(c.claim, { claim: c.claim, example: { ...shape } });
  }
  return [...out.values()];
}

/**
 * What the step is told about its answer: the name and the shape of each box, with the worked example's values. Never the check. `math` says a sum or count check is on the step, so the brief adds the one
 * sentence that the worker names rows and code adds up (said only when it is true).
 * @param {any[]} checks @returns {{answer: string, fields: Record<string, Record<string, any>>, math: boolean}}
 */
export function sheetBrief(checks) {
  return {
    answer: 'Answer with one field for each name in "fields", in the shape shown for it. Give the values themselves, worked out from the input - never a cell reference and never a formula. The values shown only illustrate the shape; use the real ones from the input and the job line.',
    fields: Object.fromEntries(sheetClaims(checks).map(({ claim, example }) => [claim, example])),
    math: (Array.isArray(checks) ? checks : []).some((c) => isRec(c) && ROW_MATH_OPS.includes(c.op)),
  };
}

// ── the stage shape ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The SHAPE of a `sheet` part, pushed as reds in the form `rubricStepShapeReds` uses (the same helper builds, at drafting, nothing the person never saw: `buildSheetChecks` already refused what bareguard refuses).
 * What it checks: a list of 1..MAX_SHEET_CHECKS objects; each a bareguard rule of the sheet set, with a distinct id, a table (the input label), only fields bareguard's vocabulary knows for that rule (plus bareloop's
 * `id`, `rule`, `covers`, `row`); a `cells` check names a claim, and the claim is no box type and no step-file key (hamr (i)); a stage whose checks are all table checks has nothing to answer.
 * @param {any} part @param {number} step the job line @param {string} w the path of the part @param {(code: string, path: string, detail: string) => void} red
 */
export function sheetShapeReds(part, step, w, red) {
  const cs = part.checks;
  if (!Array.isArray(cs) || cs.length === 0 || cs.length > MAX_SHEET_CHECKS) { red('invalid-value', `${w}.checks`, `a list of 1 to ${MAX_SHEET_CHECKS} sheet checks (bareguard cells or table checks)`); return; }
  const ids = new Set();
  cs.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    const cw = `${w}.checks[${i}]`;
    if (!isRec(c)) { red('invalid-value', cw, 'a bareguard cells or table check object'); return; }
    if (!SHEET_RULES.includes(c.rule)) { red('invalid-value', `${cw}.rule`, `one of ${SHEET_RULES.join(' | ')}`); return; }
    if (!nonEmpty(c.id) || c.id.length > 128) red('invalid-value', `${cw}.id`, 'the check\'s name (a non-empty string)');
    else if (ids.has(c.id)) red('invalid-value', `${cw}.id`, `"${c.id}" names two checks; give each check its own id`);
    else ids.add(c.id);
    if (!nonEmpty(c.table)) red('missing-field', `${cw}.table`, 'the label of the input (the sheet) the check reads');
    const allowed = new Set([...Object.keys(V.rules[c.rule]?.fields ?? {}), 'id', 'rule', 'covers', 'row']);
    for (const k of Object.keys(c)) if (!allowed.has(k)) red('invalid-value', `${cw}.${k}`, `"${k}" is not a field of a ${c.rule} check`);
    if (Object.hasOwn(c, 'covers') && !(Array.isArray(c.covers) && c.covers.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1))) red('invalid-value', `${cw}.covers`, 'the numbers of the ~ rules the check carries out (integers, 1 or more)');
    if (Object.hasOwn(c, 'row') && c.row !== 'agent') red('invalid-value', `${cw}.row`, '"agent" (the tag of a check code made its own row) or absent');
    if (c.rule === 'cells') {
      if (!nonEmpty(c.claim)) red('missing-field', `${cw}.claim`, 'the name of the answer box this check reads (a non-empty string)');
      else if (BOX_TYPES.includes(c.claim) || RESERVED_CLAIMS.includes(c.claim)) {
        red('invalid-value', `${cw}.claim`, `the claim name "${c.claim}" is the name of an answer box or of a step-file key, so the worker would confuse the box with its name; use another name (for example "ageDays", not "days")`);
      }
    }
  });
  for (const s of sheetNoClaimReds(cs.filter(isRec), step)) red('invalid-value', `${w}.checks`, s);
}

// ── the numbered view (ii) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Where the numbered view of a frozen sheet sits: beside it, the sheet's file name without its extension plus `.rows.txt` (`input/expenses.csv` -> `input/expenses.rows.txt`).
 * @param {string} rel the sheet's tree-relative path @returns {string}
 */
export function sheetViewRel(rel) {
  return `${rel.replace(/\.[^./]+$/, '')}.rows.txt`;
}

/**
 * The row-numbered text view of a sheet: one line per CSV line, `row N: <the line exactly as in the CSV>`, header = row 1 (hamr 2026-11-17, (ii)). N is the real line of the file (a blank line is no row but still counts,
 * so no row below it is renumbered); `rowStarts` are the lines a record starts on (the header and each row's `rowNumber`), so a line break INSIDE a quoted cell is shown as a continuation, never as a row of its own.
 * No check text and no claim name is ever in it. A leading byte-order mark and a CR before a line break are not shown.
 * @param {string} text the frozen CSV @param {Iterable<number>} rowStarts the line each record (header included) starts on @returns {string}
 */
export function sheetNumberedView(text, rowStarts) {
  const starts = new Set(rowStarts);
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const out = [];
  let prev = 0;
  body.split('\n').forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const n = i + 1;
    if (starts.has(n)) { out.push(`row ${n}: ${line}`); prev = n; } else if (line !== '' && prev > 0) out.push(`(continues row ${prev}): ${line}`);
  });
  return out.length > 0 ? `${out.join('\n')}\n` : '';
}

// ── (iii) code does the math ─────────────────────────────────────────────────────────────────────────────────────────

/** @param {number} n @param {number} d @returns {string} n with `d` decimals and thousands marks */
/** A strict plain number: optional sign, digits (commas only as thousands groups of three), optional decimals. `12,50`, `1e3`, `0x10` are not numbers (F356). */
const PLAIN_CELL_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const fmt = (n, d) => Number(n.toFixed(d)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * The plain line(s) the report carries for each sumIf / countIf check: `Total of rows 3, 5, 9: 1,234.50 (computed by code from the rows named)` and `Count of rows 3, 5, 9: 3 (computed by code from the rows named)`.
 * Computed from the FROZEN table and the rows the worker named (`claims.<claim>.rows`), never from a number the worker wrote. A named row that is no row of the sheet adds nothing (the rows check is the red for it);
 * a blank cell is skipped (as bareguard's sum skips it); a cell that is not a number makes the total "not computed", naming the row number and the column, never a guess. A check whose box holds no list of integers writes no line.
 * @param {any[]} checks the step's sheet checks as signed @param {any} claims the step file's `claims` @param {Record<string, {header: string[], rows: {rowNumber: number, cells: string[]}[]}>} tables by input label
 * @returns {string[]}
 */
export function sheetTotalLines(checks, claims, tables) {
  /** @type {string[]} */
  const out = [];
  for (const c of checks) {
    if (!isRec(c) || c.rule !== 'cells' || !ROW_MATH_OPS.includes(c.op)) continue;
    const box = isRec(claims) && isRec(claims[c.claim]) ? claims[c.claim].rows : undefined;
    const table = tables[c.table];
    if (!table || !Array.isArray(box) || !box.every((/** @type {unknown} */ x) => Number.isInteger(x))) continue;
    const named = [...new Set(/** @type {number[]} */ (box))].sort((a, b) => a - b);
    const byRow = new Map(table.rows.map((r) => [r.rowNumber, r]));
    const rows = named.filter((n) => byRow.has(n));
    const list = rows.length > 0 ? `rows ${rows.join(', ')}` : 'no rows';
    if (c.op === 'countIf') { out.push(`Count of ${list}: ${rows.length} (computed by code from the rows named)`); continue; }
    const col = table.header.indexOf(c.column);
    let sum = 0;
    let decimals = 0;
    let bad = null;
    for (const n of rows) {
      const cell = String(byRow.get(n)?.cells[col] ?? '').trim();
      if (cell === '') continue;
      if (!PLAIN_CELL_NUMBER.test(cell)) { bad = n; break; }
      const v = Number(cell.replaceAll(',', ''));
      sum += v;
      decimals = Math.max(decimals, (cell.split('.')[1] ?? '').length);
    }
    out.push(bad === null
      ? `Total of ${list}: ${fmt(sum, Math.min(decimals, 6))} (computed by code from the rows named)`
      : `Total of ${list}: not computed (row ${bad} has no number in the column "${c.column}")`);
  }
  return out;
}
