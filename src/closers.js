// M2 piece 1 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope item 4): `closeByClass(step, artifact, ctx)` — the
// deterministic, $0 close, dispatched on the step's declared `close.class`.
//
// borrowed-from: fwdloop poc/m0/close.mjs@29caa83 (the closed formula
// grammar sum/count/min/max/sub/daysBetween; `parseNumeric`/`roundTo` —
// compare a stated figure to its source at the SOURCE's own decimal
// precision, never the stated figure's) and fwdloop poc/m0/shape.mjs@29caa83
// (`closeWordsAndSections`, F38 version — every failing check reported, not
// just the first). Rewritten against M2's own typed artifact contract below
// — src/ never imports from poc/ (CLAUDE.md: "borrow, never import").
//
// ---------------------------------------------------------------------------
// Artifact contracts (M2 scope item 4's own docblock requirement).
// ---------------------------------------------------------------------------
//
// GREEN step artifact: `{ fields: { <name>: { value, cite } } }`
//   - `value`: the number, ISO date (`YYYY-MM-DD`) string, or exact text the
//     step claims for this field.
//   - `cite`: a string in one of two forms:
//       "<artifactId>!<COL><ROW>"        a cell in a 'cells'/'csv'-kind
//                                         artifact already in `ctx.reads`
//                                         (e.g. "aging_cells!E2").
//       "<formula>(<arg>[,<arg>...])"    formula ∈ {sum,count,min,max,sub,
//                                         daysBetween}; each <arg> is a cell
//                                         cite OR "#<fieldName>" naming an
//                                         EARLIER field of this SAME
//                                         artifact (fields resolve in
//                                         declared order, never forward —
//                                         same flat shape M0's citation-id
//                                         inputs used; formulas never
//                                         nest inside one string).
//     `daysBetween(cite)` (one arg) computes days between that date and
//     `ctx.businessDate`; `daysBetween(cite,cite)` (two args) computes days
//     between the two — never a third form.
//   A malformed field or an artifact shaped wrong is `unparseable` (a
//   casualty, never a red — bareloop F17); an internal error while
//   resolving is `crash`.
//
// SOFTGREEN (compose) step artifact: `{ text: string, lines?: string[] }`
//   - `text` is the whole composed text; `maxWords`/`sections` (F38's
//     `closeWordsAndSections`) run over it directly.
//   - `linesPerInvoice`/`mustCarry` (new here, M0 had no equivalent —
//     M0's own `closeCompose` checked citations+brackets, which M2's
//     `green` class already covers; this piece's `mustCarry` check is
//     the text-shape half only) group `text`'s own non-empty lines into
//     blocks of `linesPerInvoice` lines and require every `mustCarry`
//     string to appear (case-insensitive substring) in each block.
//   - What this LEAVES OUT (named, not silently assumed): the optional
//     `lines` field is never cross-checked against `text` itself, and
//     `mustCarry` is a substring match on the block's own words, never a
//     citation-level check that the carried figure is the RIGHT figure —
//     that grounding is `green`'s job, on a different step, per the
//     signed scope ("close by declared class, one closer per class").
//
// hitl: no mechanical close is possible — `closeByClass` returns
// `{ verdict: 'hitl', red: null }` and the runner decides what that means
// (the signed ask slot, or — for a hitl-classed step with no ask binding,
// e.g. a plain "silence" default with no guardrail proposal — a pass-through
// once its happened check clears; see src/runner.js's own docblock for this
// reading, flagged there as an interpretation call, not a rule from the
// signed text).

/** @typedef {import('./types.js').CloseVerdict} CloseVerdict */

const FORMULAS = Object.freeze({
  sum: (vals) => vals.reduce((a, b) => a + b, 0),
  count: (vals) => vals.length,
  min: (vals) => Math.min(...vals),
  max: (vals) => Math.max(...vals),
  sub: (vals) => vals[0] - vals[1],
});

const CELL_RE = /^([a-zA-Z0-9_-]+)!([A-Za-z]+)(\d+)$/;
const FORMULA_RE = /^(sum|count|min|max|sub|daysBetween)\((.*)\)$/;
const FIELD_REF_RE = /^#([A-Za-z0-9_]+)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function colIndexOf(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Strip thousands separators / currency symbols; report the value and the source's own decimal precision. */
function parseNumeric(raw) {
  const cleaned = String(raw).replace(/[$,]/g, '').trim();
  const value = Number(cleaned);
  const dot = cleaned.indexOf('.');
  const decimals = dot === -1 ? 0 : cleaned.length - dot - 1;
  return { value, decimals };
}

function roundTo(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function getCellRaw(artifact, col, row) {
  const found = (artifact.rows ?? []).find((r) => r.rowNumber === row);
  if (!found) return null;
  return found.cells?.[col.toUpperCase()] ?? null;
}

/**
 * Resolve one `cite` string against `ctx.reads` (artifacts already read by
 * this step) and `fieldsSoFar` (fields of THIS artifact already resolved, in
 * declared order). Returns `{ ok:true, raw }` (a raw cell value still to be
 * type-compared) or `{ ok:true, computed }` (a formula's already-numeric
 * result) or `{ ok:false, red }`. Never throws on a malformed cite — that is
 * a red the caller renders, not an exception.
 */
function resolveCite(cite, ctx) {
  if (typeof cite !== 'string' || cite.length === 0) {
    return { ok: false, red: `cite must be a non-empty string, got ${JSON.stringify(cite)}` };
  }

  const cellMatch = CELL_RE.exec(cite);
  if (cellMatch) {
    const [, artifactId, col, rowStr] = cellMatch;
    const artifact = ctx.reads?.[artifactId];
    if (!artifact) return { ok: false, red: `cite "${cite}": unknown artifact "${artifactId}"` };
    if (artifact.kind !== 'cells' && artifact.kind !== 'csv') {
      return { ok: false, red: `cite "${cite}": artifact "${artifactId}" is not a cells/csv-kind read` };
    }
    if (colIndexOf(col) < 0) return { ok: false, red: `cite "${cite}": "${col}" is not a valid column` };
    const row = Number(rowStr);
    const raw = getCellRaw(artifact, col, row);
    if (raw === null) return { ok: false, red: `cite "${cite}": cell ${col}${row} does not exist in "${artifactId}"` };
    return { ok: true, raw };
  }

  const fieldMatch = FIELD_REF_RE.exec(cite);
  if (fieldMatch) {
    const name = fieldMatch[1];
    if (!Object.prototype.hasOwnProperty.call(ctx.fieldsSoFar ?? {}, name)) {
      return { ok: false, red: `cite "${cite}": field "${name}" is not resolved yet (fields resolve top to bottom, never forward)` };
    }
    return { ok: true, raw: ctx.fieldsSoFar[name].value };
  }

  const formulaMatch = FORMULA_RE.exec(cite);
  if (formulaMatch) {
    const [, op, argsRaw] = formulaMatch;
    const argCites = argsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

    if (op === 'daysBetween') {
      if (argCites.length < 1 || argCites.length > 2) {
        return { ok: false, red: `cite "${cite}": daysBetween takes 1 or 2 args, got ${argCites.length}` };
      }
      const resolved = [];
      for (const arg of argCites) {
        const r = resolveCite(arg, ctx);
        if (!r.ok) return r;
        resolved.push(r.raw);
      }
      const fromDate = resolved[0];
      const toDate = argCites.length === 2 ? resolved[1] : ctx.businessDate;
      if (!ISO_DATE_RE.test(String(fromDate)) || !ISO_DATE_RE.test(String(toDate))) {
        return { ok: false, red: `cite "${cite}": daysBetween needs ISO (YYYY-MM-DD) dates, got "${fromDate}"/"${toDate}"` };
      }
      const days = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
      return { ok: true, computed: days };
    }

    const fn = FORMULAS[op];
    if (!fn) return { ok: false, red: `cite "${cite}": unknown formula "${op}" (closed grammar: sum,count,min,max,sub,daysBetween)` };
    const vals = [];
    for (const arg of argCites) {
      const r = resolveCite(arg, ctx);
      if (!r.ok) return r;
      const num = r.computed !== undefined ? r.computed : parseNumeric(r.raw).value;
      if (Number.isNaN(num)) return { ok: false, red: `cite "${cite}": arg "${arg}" does not resolve to a number` };
      vals.push(num);
    }
    return { ok: true, computed: fn(vals) };
  }

  return { ok: false, red: `cite "${cite}" does not match the cell or formula grammar` };
}

function checkField(name, field, ctx) {
  if (!field || typeof field !== 'object' || field.value === undefined || typeof field.cite !== 'string') {
    return { verdict: 'red', red: `field "${name}" must be an object {value, cite:string}, got ${JSON.stringify(field)}` };
  }
  const resolved = resolveCite(field.cite, ctx);
  if (!resolved.ok) return { verdict: 'red', red: `field "${name}": ${resolved.red}` };

  if (resolved.computed !== undefined) {
    if (Number(field.value) !== resolved.computed) {
      return { verdict: 'red', red: `field "${name}" ${field.value} ≠ ${field.cite} = ${resolved.computed}` };
    }
    return { verdict: 'green' };
  }

  const raw = resolved.raw;
  if (ISO_DATE_RE.test(String(field.value))) {
    if (String(field.value) !== String(raw)) {
      return { verdict: 'red', red: `field "${name}" ${field.value} ≠ cite ${field.cite} = ${raw}` };
    }
    return { verdict: 'green' };
  }
  const { value: numVal, decimals } = parseNumeric(raw);
  if (Number.isNaN(numVal)) {
    if (String(field.value).trim() !== String(raw).trim()) {
      return { verdict: 'red', red: `field "${name}" ${field.value} ≠ cite ${field.cite} = ${raw}` };
    }
    return { verdict: 'green' };
  }
  if (roundTo(Number(field.value), decimals) !== roundTo(numVal, decimals)) {
    return { verdict: 'red', red: `field "${name}" ${field.value} ≠ cite ${field.cite} = ${numVal}` };
  }
  return { verdict: 'green' };
}

/**
 * `green` close: every field in `artifact.fields`, in declared order,
 * resolves and matches its cite. First red wins.
 *
 * @param {any} artifact
 * @param {{ reads: Record<string, any>, businessDate: string }} ctx
 * @returns {CloseVerdict}
 */
export function closeGreen(artifact, ctx) {
  try {
    if (!artifact || typeof artifact !== 'object' || !artifact.fields || typeof artifact.fields !== 'object') {
      return /** @type {CloseVerdict} */ ({ verdict: 'unparseable', red: 'green artifact must be an object shaped {fields: {...}}' });
    }
    const names = Object.keys(artifact.fields);
    if (names.length === 0) {
      return /** @type {CloseVerdict} */ ({ verdict: 'unparseable', red: 'green artifact has no fields' });
    }
    /** @type {Record<string, any>} */
    const fieldsSoFar = {};
    for (const name of names) {
      const result = checkField(name, artifact.fields[name], { reads: ctx.reads, fieldsSoFar, businessDate: ctx.businessDate });
      if (result.verdict === 'red') return /** @type {CloseVerdict} */ (result);
      fieldsSoFar[name] = artifact.fields[name];
    }
    return { verdict: 'green', red: null };
  } catch (err) {
    return { verdict: 'crash', red: `green close crashed: ${err.message}` };
  }
}

/**
 * The declared-shape word-cap + ordered-sections check, F38 version (every
 * failing check reported, not just the first). Identical rules to
 * poc/m0/shape.mjs's own `closeWordsAndSections`.
 *
 * @param {unknown} text
 * @param {{ maxWords: number, sections: string[] }} declared
 * @returns {CloseVerdict}
 */
export function closeWordsAndSections(text, { maxWords, sections }) {
  if (typeof text !== 'string') {
    return { verdict: 'unparseable', red: `expected string text, got ${text === null ? 'null' : typeof text}` };
  }

  const lines = text.split(/\r?\n/);
  const reds = /** @type {string[]} */ ([]);

  let wordCount = 0;
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '');
    const words = stripped.split(/\s+/).filter((w) => w.length > 0);
    wordCount += words.length;
  }
  if (Number.isFinite(maxWords) && wordCount > maxWords) {
    reds.push(`${wordCount} words, limit ${maxWords}`);
  }

  const headingLines = lines
    .map((line) => line.replace(/^#+\s*/, '').replace(/:\s*$/, '').trim().toLowerCase())
    .filter((l) => l.length > 0);

  let searchFrom = 0;
  for (const section of sections ?? []) {
    const want = section.trim().toLowerCase();
    const foundAt = headingLines.indexOf(want, searchFrom);
    if (foundAt === -1) {
      const anywhere = headingLines.indexOf(want);
      if (anywhere === -1) {
        reds.push(`no line is exactly the heading "${section}" (a heading is a line that is only that text, optionally after #)`);
      } else {
        reds.push(`section heading "${section}" is out of order`);
      }
    } else {
      searchFrom = foundAt + 1;
    }
  }

  if (reds.length > 0) return { verdict: 'red', red: reds.join('; '), reds };
  return { verdict: 'green', reds: [] };
}

/**
 * `linesPerInvoice`/`mustCarry`: group `text`'s own non-empty lines into
 * blocks of `linesPerInvoice` lines; every `mustCarry` string must appear
 * (case-insensitive substring) somewhere in each block. Returns an array of
 * red strings (empty when clean) — the caller folds these into its own
 * `reds` list alongside `closeWordsAndSections`'s.
 */
export function closeLinesAndCarry(text, { linesPerInvoice, mustCarry }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const reds = [];
  if (lines.length === 0) {
    reds.push('text has no non-empty lines to check against linesPerInvoice');
    return reds;
  }
  if (lines.length % linesPerInvoice !== 0) {
    reds.push(`text has ${lines.length} non-empty line(s), not a multiple of linesPerInvoice ${linesPerInvoice}`);
  }
  for (let i = 0; i < lines.length; i += linesPerInvoice) {
    const block = lines.slice(i, i + linesPerInvoice).join(' ');
    for (const must of mustCarry ?? []) {
      if (!block.toLowerCase().includes(String(must).toLowerCase())) {
        reds.push(`invoice block starting at line ${i + 1} is missing "${must}"`);
      }
    }
  }
  return reds;
}

/**
 * `softgreen` close: dispatches to `closeWordsAndSections` (when the shape
 * declares `maxWords`/`sections`) and/or `closeLinesAndCarry` (when it
 * declares `linesPerInvoice`/`mustCarry`) and reports every failing check
 * from both, one sentence each (F38's rule, never widened to first-red-only).
 *
 * @param {any} artifact
 * @param {{ maxWords?: number, sections?: string[], linesPerInvoice?: number, mustCarry?: string[] }} shape
 * @returns {CloseVerdict}
 */
export function closeSoftgreen(artifact, shape) {
  if (!artifact || typeof artifact !== 'object' || typeof artifact.text !== 'string') {
    return /** @type {CloseVerdict} */ ({ verdict: 'unparseable', red: `softgreen artifact must be an object shaped {text: string}, got ${JSON.stringify(artifact)}` });
  }
  try {
    const reds = /** @type {string[]} */ ([]);
    if (shape.maxWords !== undefined || shape.sections !== undefined) {
      const wc = closeWordsAndSections(artifact.text, { maxWords: shape.maxWords ?? Infinity, sections: shape.sections ?? [] });
      if (wc.verdict === 'unparseable') return /** @type {CloseVerdict} */ (wc);
      reds.push(...(wc.reds ?? []));
    }
    if (shape.linesPerInvoice !== undefined && shape.mustCarry !== undefined) {
      reds.push(...closeLinesAndCarry(artifact.text, { linesPerInvoice: shape.linesPerInvoice, mustCarry: shape.mustCarry }));
    }
    if (reds.length > 0) return { verdict: 'red', red: reds.join('; '), reds };
    return { verdict: 'green', red: null, reds: [] };
  } catch (err) {
    return { verdict: 'crash', red: `softgreen close crashed: ${err.message}` };
  }
}

/**
 * The one dispatcher — `close by declared class` (M2 scope item 4).
 *
 * @param {{ close?: { class?: string, shape?: Record<string, any> } }} step
 * @param {unknown} artifact
 * @param {{ reads: Record<string, any>, businessDate: string }} ctx
 * @returns {CloseVerdict}
 */
export function closeByClass(step, artifact, ctx) {
  const cls = step?.close?.class;
  if (cls === 'green') return closeGreen(artifact, ctx);
  if (cls === 'softgreen') return closeSoftgreen(artifact, step?.close?.shape ?? {});
  if (cls === 'hitl') return { verdict: 'hitl', red: null };
  return { verdict: 'crash', red: `closeByClass: unknown close class ${JSON.stringify(cls)}` };
}
