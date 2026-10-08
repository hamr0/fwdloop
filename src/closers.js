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
// SOFTGREEN (compose) step artifact: `{ text: string }`
//   - `text` is the whole composed text; `maxWords`/`sections`/`wordsPerSection` run over it directly. Since M4e amendment 18 these
//     soft checks run on bareguard's rubric (`softgreenSpec`), reported in our own words (`renderSoftgreenGaps`).
//   - `linesPerInvoice`/`mustCarry` (new here, M0 had no equivalent —
//     M0's own `closeCompose` checked citations+brackets, which M2's
//     `green` class already covers; this piece's `mustCarry` check is
//     the text-shape half only) group `text`'s own non-empty lines into
//     blocks of `linesPerInvoice` lines and require every `mustCarry`
//     string to appear (case-insensitive substring) in each block.
//   - Any key besides `text` (done/blocker are stripped before the close)
//     is refused red by name: the check reads `text` only, so an answer
//     placed elsewhere must never pass or hide.
//   - What this LEAVES OUT (named, not silently assumed): `mustCarry` is a substring match on the block's own words, never a
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

import { createRubric, checkStep } from 'bareguard';

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
 * M4e amendment 18: the soft checks run on bareguard 0.21.0. `softgreenSpec(shape)` is the ONE place a declared shape
 * becomes a rubric spec (signing and the run both build through `buildSoftgreenRubric`, so a shape that signs is a shape
 * that builds). The checks are in this fixed order, which is the order their sentences read in:
 * allowedKeys, maxWords, sectionOrder, sectionWords, blockLines.
 * A key that is declared at all gets its check built, so a half-declared shape (wordsPerSection with no sections, one of
 * linesPerInvoice/mustCarry) cannot build and is a crash at run time, never silently skipped.
 *
 * @param {Record<string, any>} shape
 */
export function softgreenSpec(shape) {
  const checks = [{ id: 'keys', rule: 'allowedKeys', keys: ['text'] }];
  if (shape.maxWords !== undefined) checks.push({ id: 'words', rule: 'maxWords', field: 'text', value: shape.maxWords });
  if (shape.sections !== undefined) checks.push({ id: 'sections', rule: 'sectionOrder', field: 'text', names: shape.sections });
  if (shape.wordsPerSection !== undefined) checks.push({ id: 'perSection', rule: 'sectionWords', field: 'text', names: shape.sections, wordsPerSection: shape.wordsPerSection });
  if (shape.linesPerInvoice !== undefined || shape.mustCarry !== undefined) {
    checks.push({ id: 'lines', rule: 'blockLines', field: 'text', size: shape.linesPerInvoice, phrases: shape.mustCarry });
  }
  return { schema: 1, goal: 'softgreen', checkpoints: { close: { gating: true, checks } } };
}

/** Throws bareguard's `invalid rubric: ...` for a shape it cannot build. @param {Record<string, any>} shape */
export function buildSoftgreenRubric(shape) {
  return createRubric(softgreenSpec(shape));
}

const partAfter = (item) => item.slice(item.indexOf(':') + 1);

/**
 * The ONE render function (amendment 18 item 4A): bareguard's typed gaps in, fwdloop's plain-English sentences out, byte for byte
 * what the hand-written checks said before the switch (test/m4e-am18-parity.test.js proves it on 142 inputs).
 * What it throws away: bareguard bounds every offender list at 20 (MAX_ITEMS); past that the sentence says how many more there were.
 * A gap it has no sentence for is still a red, worded generically, never dropped.
 *
 * @param {any[]} gaps
 * @param {{ linesPerInvoice?: number }} shape
 * @returns {{ red: string, reds: string[] }}
 */
function renderSoftgreenGaps(gaps, shape) {
  const extra = gaps.find((g) => g.check === 'allowedKeys');
  if (extra) {
    // The answer sits in the wrong place: nothing else is judged until it is in "text".
    const keys = extra.keys ?? [];
    return {
      red: `softgreen artifact has key(s) ${keys.map((k) => `"${k}"`).join(', ')} besides "text"; the check reads "text" only, so put the whole answer in "text"`,
      reds: [`extra key(s): ${keys.join(', ')}`],
    };
  }
  const reds = [];
  let moreSections = 0;
  for (const g of gaps) {
    const kinds = String(g.kind ?? '').split(',');
    if (g.check === 'maxWords') {
      reds.push(`${g.measured} words, limit ${g.limit}`);
    } else if (g.check === 'sectionOrder' && Array.isArray(g.items)) {
      for (const it of g.items) {
        const name = partAfter(it);
        reds.push(it.startsWith('missing:')
          ? `no line is exactly the heading "${name}" (a heading is a line that is only that text, optionally after #)`
          : `section heading "${name}" is out of order`);
      }
      if (g.itemsTotal) reds.push(`${g.itemsTotal - g.items.length} more section(s) are missing or out of order`);
    } else if (g.check === 'sectionWords') {
      reds.push(`${g.section}: ${g.words} words, about ${g.asked} asked (${g.lo}-${g.hi})`);
      moreSections = Math.max(moreSections, (g.itemsTotal ?? 0) - 20);
    } else if (g.check === 'blockLines') {
      if (kinds.includes('zero-lines')) reds.push('text has no non-empty lines to check against linesPerInvoice');
      if (kinds.includes('not-multiple')) reds.push(`text has ${g.measured} non-empty line(s), not a multiple of linesPerInvoice ${g.limit}`);
      for (const it of g.items ?? []) {
        const block = Number(/^block (\d+):/.exec(it)?.[1]);
        reds.push(`invoice block starting at line ${(block - 1) * (shape.linesPerInvoice ?? 1) + 1} is missing "${partAfter(it)}"`);
      }
      if (g.itemsTotal) reds.push(`${g.itemsTotal - (g.items?.length ?? 0)} more block(s) are missing a required word`);
    } else {
      reds.push(`the ${g.check} check failed (${g.kind ?? 'no detail'})`);
    }
  }
  if (moreSections > 0) reds.push(`${moreSections} more section(s) are outside the range`);
  return { red: reds.join('; '), reds };
}

/** What the artifact looks like in a message, without ever throwing on a hostile object. */
function describeArtifact(artifact) {
  try { return JSON.stringify(artifact); } catch { return '[an object that cannot be read]'; }
}

/**
 * `softgreen` close: the declared shape (`maxWords`, `sections`, `wordsPerSection`, `linesPerInvoice` + `mustCarry`, and the
 * one-key rule) is checked by bareguard's rubric (amendment 18 item 1) and every failing check is reported, one sentence each
 * (F38's rule, never widened to first-red-only). Our front door stays: an answer that is not `{text: string}` is `unparseable`
 * before bareguard sees it. A shape that cannot be built, or a check that stopped, is `crash`: never green.
 * Async because bareguard's `checkStep` is.
 *
 * @param {any} artifact
 * @param {{ maxWords?: number, sections?: string[], wordsPerSection?: number, linesPerInvoice?: number, mustCarry?: string[] }} shape
 * @returns {Promise<CloseVerdict>}
 */
export async function closeSoftgreen(artifact, shape) {
  let text;
  try {
    text = artifact && typeof artifact === 'object' ? artifact.text : undefined;
  } catch {
    text = undefined;
  }
  if (typeof text !== 'string') {
    return /** @type {CloseVerdict} */ ({ verdict: 'unparseable', red: `softgreen artifact must be an object shaped {text: string}, got ${describeArtifact(artifact)}` });
  }
  try {
    const rubric = buildSoftgreenRubric(shape);
    const res = await checkStep(rubric, 'close', artifact);
    if (res.verdict === 'stopped') {
      return { verdict: 'crash', red: `softgreen close crashed: the ${res.fault.id} check stopped (${res.fault.kind}${res.fault.detail ? `: ${res.fault.detail}` : ''})` };
    }
    if (res.verdict === 'red') return { verdict: 'red', ...renderSoftgreenGaps(res.gaps, shape) };
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
 * @returns {Promise<CloseVerdict>}
 */
export async function closeByClass(step, artifact, ctx) {
  const cls = step?.close?.class;
  if (cls === 'green') return closeGreen(artifact, ctx);
  if (cls === 'softgreen') return await closeSoftgreen(artifact, step?.close?.shape ?? {});
  if (cls === 'hitl') return { verdict: 'hitl', red: null };
  return { verdict: 'crash', red: `closeByClass: unknown close class ${JSON.stringify(cls)}` };
}
