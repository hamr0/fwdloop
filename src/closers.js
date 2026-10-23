// M2 piece 1 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope item 4): `closeByClass(step, artifact, ctx)` — the
// deterministic, $0 close, dispatched on the step's declared `close.class`.
//
// borrowed-from: fwdloop poc/m0/shape.mjs@29caa83
// (`closeWordsAndSections`, F38 version — every failing check reported, not
// just the first). Rewritten against M2's own typed artifact contract below
// — src/ never imports from poc/ (CLAUDE.md: "borrow, never import").
// (The M0 cell-cite grammar - sum/count/min/max/sub/daysBetween over `<input>!C3` cites - retired in M10b piece 5, item 8.)
//
// ---------------------------------------------------------------------------
// Artifact contracts (M2 scope item 4's own docblock requirement).
// ---------------------------------------------------------------------------
//
// GREEN step artifact: one of two forms, each with its own closer.
//   - a page or document quote: `{ results: [...] }` (`closeCited`, bareguard's `cited` check);
//   - a sheet: one typed claim box per `cells` check (`closeSheet`, src/sheetrun.js, bareguard's `cells` / `table` checks).
//   A green step with neither `close.cited` nor `close.sheet` is the retired cell cite: `closeByClass` answers `crash`, and a job signed that way is refused
//   at start (src/canrun.js `findUnbuildableCheckStep`) before it can get here.
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
import { checkCited } from './citedcheck.js';
import { closeSheet } from './sheetrun.js';

/** @typedef {import('./types.js').CloseVerdict} CloseVerdict */

/** An input with cells (M4d amendment 8): a file whose name ends `.csv`. The one decider for "this input can be cited". */
export function isCellsPath(p) {
  return typeof p === 'string' && p.toLowerCase().endsWith('.csv');
}

/**
 * M10 piece 4 (item 2, "green grows"): the green close of a step that cites quotes instead of cells. `part` is the step's fact part (`close.cited`, set by
 * code from the page look's kept facts, never by the model); `source` is the run's OWN frozen copy of the page or doc (`readRunSource`); the artifact is
 * `{ results: [{ quote, values: { <fact name>: "<value as the quote writes it>" } }] }`. bareguard's `cited` check proves each quote is word for word in
 * the frozen text, each value is in its quote and passes its rule, and the number of results is as signed. No model grades.
 * Third outcomes, each named, never green: no readable source or an artifact that is not an object (`unparseable`, a casualty), a part bareguard cannot sign
 * (`crash`). `cited` carries what the runner writes to the run's cited-check record: the part and the check's own answer.
 *
 * @param {any} part
 * @param {any} artifact
 * @param {{ok: true, text: string, sha256: string}|{ok: false, red: string}|null|undefined} source
 * @returns {Promise<CloseVerdict>}
 */
export async function closeCited(part, artifact, source) {
  try {
    if (!source || source.ok !== true) {
      const red = source && source.ok === false ? source.red : `input "${part?.source}": the run gave the check no saved copy to read`;
      return /** @type {CloseVerdict} */ ({ verdict: 'unparseable', red: `cited close: ${red}`, cited: { part, check: { verdict: 'stopped', gapLines: [], fault: red, sha256: '', claims: [], evidence: [] } } });
    }
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      return /** @type {CloseVerdict} */ ({ verdict: 'unparseable', red: 'cited artifact must be an object shaped {results: [{quote, values}]}' });
    }
    const check = await checkCited({ part, text: source.text, results: artifact.results });
    const cited = { part, check, results: artifact.results };
    if (check.verdict === 'green') return /** @type {CloseVerdict} */ ({ verdict: 'green', red: null, cited });
    if (check.verdict === 'red') return /** @type {CloseVerdict} */ ({ verdict: 'red', red: check.gapLines.join('\n'), cited });
    return /** @type {CloseVerdict} */ ({ verdict: 'crash', red: `cited close stopped: ${check.fault}`, cited });
  } catch (err) {
    return /** @type {CloseVerdict} */ ({ verdict: 'crash', red: `cited close crashed: ${err.message}` });
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
  /** @type {Record<string, any>[]} */
  const checks = [{ id: 'keys', rule: 'allowedKeys', keys: ['text'] }];
  if (shape.maxWords !== undefined) checks.push({ id: 'words', rule: 'maxWords', field: 'text', value: shape.maxWords });
  if (shape.sections !== undefined) checks.push({ id: 'sections', rule: 'sectionOrder', field: 'text', names: shape.sections });
  if (shape.wordsPerSection !== undefined) checks.push({ id: 'perSection', rule: 'sectionWords', field: 'text', names: shape.sections, wordsPerSection: shape.wordsPerSection });
  if (shape.linesPerInvoice !== undefined || shape.mustCarry !== undefined) {
    checks.push({ id: 'lines', rule: 'blockLines', field: 'text', size: shape.linesPerInvoice, phrases: shape.mustCarry });
  }
  return { schema: 1, goal: 'softgreen', checkpoints: { close: { gating: true, checks } } };
}

/** Throws bareguard's `invalid rubric: ...` for a shape it cannot build. @param {Record<string, any>} shape @returns {ReturnType<typeof createRubric>} */
export function buildSoftgreenRubric(shape) {
  return createRubric(softgreenSpec(shape));
}

const partAfter = (item) => item.slice(item.indexOf(':') + 1);

/**
 * The ONE render function (amendment 18 item 4A): bareguard's typed gaps in, fwdloop's plain-English sentences out, byte for byte
 * what the hand-written checks said before the switch (test/m4e-am18-parity.test.js proves it on 142 inputs); past bareguard's own
 * offender-list bound the "N more" tail is ours (amendment 19 2), derived from each gap's `itemsTotal` and list length, never a number.
 * What it throws away: bareguard bounds every offender list; past that the sentence says how many more there were.
 * A gap it has no sentence for is still a red, worded generically, never dropped.
 *
 * @param {any[]} gaps
 * @param {{ linesPerInvoice?: number, mustCarry?: string[] }} shape
 * @returns {{ red: string, reds: string[] }}
 */
export function renderSoftgreenGaps(gaps, shape) {
  const extra = gaps.find((g) => g.check === 'allowedKeys');
  if (extra) {
    // The answer sits in the wrong place: nothing else is judged until it is in "text".
    const keys = extra.keys ?? [];
    const moreKeys = (extra.itemsTotal ?? keys.length) - keys.length;
    return {
      red: `softgreen artifact has key(s) ${keys.map((k) => `"${k}"`).join(', ')}${moreKeys > 0 ? ` and ${moreKeys} more` : ''} besides "text"; the check reads "text" only, so put the whole answer in "text"`,
      reds: [`extra key(s): ${keys.join(', ')}${moreKeys > 0 ? ` and ${moreKeys} more` : ''}`],
    };
  }
  const reds = [];
  let moreSections = 0;
  const sectionWordGaps = gaps.filter((g) => g.check === 'sectionWords');
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
      moreSections = Math.max(moreSections, (g.itemsTotal ?? 0) - sectionWordGaps.length);
    } else if (g.check === 'blockLines') {
      if (kinds.includes('zero-lines')) reds.push('text has no non-empty lines to check against linesPerInvoice');
      if (kinds.includes('not-multiple')) reds.push(`text has ${g.measured} non-empty line(s), not a multiple of linesPerInvoice ${g.limit}`);
      for (const it of g.items ?? []) {
        const block = Number(/^block (\d+):/.exec(it)?.[1]);
        reds.push(`invoice block starting at line ${(block - 1) * (shape.linesPerInvoice ?? 1) + 1} is missing "${partAfter(it)}"`);
      }
      // bareguard lists (block, word) misses and bounds the list; the tail counts the missing words it left out (amendment 20)
      const moreWords = (g.itemsTotal ?? 0) - (g.items?.length ?? 0);
      if (moreWords > 0) reds.push(`${moreWords} more missing word(s)`);
    } else {
      reds.push(`the ${g.check} check failed (${g.kind ?? 'no detail'})`);
    }
  }
  if (moreSections > 0) reds.push(`${moreSections} more section(s) are outside the range`);
  return { red: reds.join('; '), reds };
}

/** The words each softgreen check is listed under (M4d am29 item 2), by its rubric id; the numbers and names come from the signed shape. @param {Record<string, any>} c a check of `softgreenSpec` */
function softgreenCheckText(c) {
  if (c.id === 'keys') return 'the answer has only a "text" field';
  if (c.id === 'words') return `at most ${c.value} words`;
  if (c.id === 'sections') return `the sections are there, in order: ${c.names.join(', ')}`;
  if (c.id === 'perSection') return `each section is about ${c.wordsPerSection} words`;
  return `${c.size ?? 'its'} lines per block, each carrying: ${(c.phrases ?? []).join(', ')}`;
}

/**
 * How many words bareguard counts in `text`, asked of bareguard itself (a `minWords` check no text can meet, whose gap carries the measured count) so the
 * number listed beside a passing `maxWords` check is the one the check used. `null` when it cannot be read.
 * @param {string} text @returns {Promise<number|null>}
 */
async function countWordsWithBareguard(text) {
  try {
    const rubric = createRubric({ schema: 1, goal: 'count', checkpoints: { count: { gating: true, checks: [{ id: 'n', rule: 'minWords', field: 'text', value: 100_000_000 }] } } });
    const res = await checkStep(rubric, 'count', { text });
    const measured = res.gaps?.[0]?.measured;
    return typeof measured === 'number' ? measured : null;
  } catch { return null; }
}

/**
 * M4d am29 item 2: every check the softgreen close ran, in the order of `softgreenSpec`, each `{ id, text, ok, result }`. `result` is the word count beside the
 * words check (met or not), the plain-English reason beside any other check that failed, and `null` beside a check that passed with nothing to measure.
 * @param {Record<string, any>} shape @param {any[]} gaps bareguard's gaps (empty when green) @param {string} text
 */
async function softgreenCheckResults(shape, gaps, text) {
  const out = [];
  for (const c of softgreenSpec(shape).checkpoints.close.checks) {
    const mine = gaps.filter((g) => g.id === c.id);
    let result = null;
    if (c.id === 'words') {
      const n = mine[0]?.measured ?? await countWordsWithBareguard(text);
      result = typeof n === 'number' ? `${n} words` : null;
    } else if (mine.length > 0) {
      result = renderSoftgreenGaps(mine, shape).reds.join('; ');
    }
    out.push({
      id: c.id, text: softgreenCheckText(c), ok: mine.length === 0, result,
    });
  }
  return out;
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
      // bareguard's StepResult carries the first fault whenever the verdict is 'stopped' (rubric.js: "the first fault, when stopped").
      const fault = /** @type {NonNullable<typeof res.fault>} */ (res.fault);
      return { verdict: 'crash', red: `softgreen close crashed: the ${fault.id} check stopped (${fault.kind}${fault.detail ? `: ${fault.detail}` : ''})` };
    }
    const checks = await softgreenCheckResults(shape, res.verdict === 'red' ? res.gaps : [], text);
    if (res.verdict === 'red') return { verdict: 'red', ...renderSoftgreenGaps(res.gaps, shape), checks };
    return { verdict: 'green', red: null, reds: [], checks };
  } catch (err) {
    return { verdict: 'crash', red: `softgreen close crashed: ${err.message}` };
  }
}

/**
 * The one dispatcher — `close by declared class` (M2 scope item 4).
 *
 * @param {{ close?: { class?: string, shape?: Record<string, any>, cited?: any, columns?: {source: string, column: string}[], sheet?: any[] } }} step
 * @param {unknown} artifact
 * @param {{ reads: Record<string, any>, businessDate: string, source?: {ok: true, text: string, sha256: string}|{ok: false, red: string}|null, sheet?: any }} ctx
 *   `source` (M10 piece 4) = the run's own frozen copy a cited step reads, from `readRunSource`; only a step whose close carries `cited` reads it
 *   `sheet` (M10b piece 2) = the run's own tables and recorded `tableSha`s a step with `close.sheet` is checked on, from `readRunSheets`
 * @returns {Promise<CloseVerdict>}
 */
export async function closeByClass(step, artifact, ctx) {
  const cls = step?.close?.class;
  if (cls === 'green' && step?.close?.cited) return await closeCited(step.close.cited, artifact, ctx.source);
  if (cls === 'green' && Array.isArray(step?.close?.sheet)) return await closeSheet(step.close.sheet, artifact, ctx.sheet);
  if (cls === 'green') return { verdict: 'crash', red: 'closeByClass: a green step with no close.sheet or close.cited is the retired cell cite' };
  if (cls === 'softgreen') return await closeSoftgreen(artifact, step?.close?.shape ?? {});
  if (cls === 'hitl') return { verdict: 'hitl', red: null };
  return { verdict: 'crash', red: `closeByClass: unknown close class ${JSON.stringify(cls)}` };
}
