// M16 item 2 (docs/wiki/the-module-ladder.md, "M16"): "the AI sends only edits to that list; code proves each one and builds every check. The AI never writes a check."
// The declaration of a draft with the list on keeps the AI's steps, reads, primitives and asks, and takes the CHECKS of every line the block was given from the block's built parts:
//   a fact part        -> close.cited = {source, facts, count, asSeen}, class green; the source is added to the step's reads by code
//   a countable part   -> a picked check (M10 am22 (1)-(3)): close.shape.picked on a softgreen step, close.picked on a fact (or sheet) step with the line in pickedLines
//   the numbers tie    -> close.numbersFrom (M16 am3 (2), R7)
//   no part            -> hitl; the rows' Not-checked reasons are the list's own (no `unjudgeable` record, M17 am4)
// Whatever the AI wrote for these checks (close.cited, close.shape, close.picked, close.class) is dropped. The block's signed rows become the declaration's `checkList`, which the sign and the
// run-start gate prove (src/checklistsign.js). A fwd line keeps ONE close per line, whose class must equal the class its guardrail earns (signed, M4d): so a line with no guardrail of the
// person's own can carry only the numbers tie; any other check the list built there cannot be signed on it and its rows are signed Not checked, with that reason.

/** M17 am5 item 2 (D3): the reason a `~` rule on a signed Ask line is Not checked, the signed words */
export const ASK_LINE_REASON = 'you judge it at the Ask';

/**
 * M19 amendment 1 (signed 2026-11-20): a line that is a list of items and nothing else (no quote) signs class `green` with `itemShape` and no `cited`; the person's own rules on its text still ride beside it. `null` (tests only) signs no
 * list-of-items check and the rows are Not checked (REASON.noRule). A facts+shape line keeps its class (green, `cited` plus `itemShape`, amendment E) whatever this says.
 * @type {'green'|null}
 */
export const SHAPE_ONLY_CLASS = 'green';

/** what a row says when its check cannot ride a line that has no guardrail of its own (the class of a line comes from its guardrail) */
export const NO_GUARDRAIL_WORDS = 'This line has no guardrail of yours, so a check on it cannot be signed; you judge it at Accept.';

import { REASON } from './checkblock.js';
import { KEPT_WORDS } from './pickrecord.js';
import { lineRules } from './pagebits.js';
import { isListedNotChecked, notCheckedItem, ruleTextOf } from './checkrows.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** a countable part as the picked check the softgreen close runs: its own fields, the rule named `rule` (the inverse of the block's partOfPick) @param {Record<string, any>} part */
export function pickedOf(part) {
  const { text: _t, class: _c, check, rules: _r, source: _s, from: _f, oldIndex: _o, ...fields } = part;
  return { rule: check, ...fields };
}

/**
 * @param {{declaration: Record<string, any>, block: import('./checkblock.js').CheckBlock, lines: {n: number, guardrail?: string|null}[], lineSet: Set<number>, askLines?: Set<number>, sheetRoles?: string[], shapeOnlyClass?: 'green'|null}} o
 *   `lineSet` = the lines of the list (the block's step lines that are not sheet lines); `lines` = the signed lines (a guardrail decides the class); `askLines` = the signed Ask lines: each `~` rule on one is a Not-checked line here, never skipped (M17 am5 item 2);
 *   `sheetRoles` = the CSV inputs: the block's sheet part of a sheet line is the `close.sheet` of the line's first green step that reads one (M19 S3: the checks the block holds, drops and all)
 * @returns {{declaration: Record<string, any>, notChecked: string[], notCheckedBy: Record<string, 'you'|'agent'|'default'>, built: Set<number>}} `built` = the lines that got a check from the block (a red naming one of them is a fault of the build)
 */
export function assembleFromBlock({ declaration, block, lines, lineSet, askLines = new Set(), sheetRoles = [], shapeOnlyClass = SHAPE_ONLY_CLASS }) {
  if (!isRec(declaration) || !Array.isArray(declaration.steps)) return { declaration, notChecked: [], notCheckedBy: {}, built: new Set() };
  const c = block.reconcile();
  const partsOf = (/** @type {number} */ n) => c.map.filter((m) => m.line === n).map((m) => ({ ...c.parts[m.part], oldIndex: c.map.filter((x) => x.line === n).findIndex((x) => x.part === m.part) }));
  const guarded = (/** @type {number} */ n) => typeof lines.find((l) => l.n === n)?.guardrail === 'string' && String(lines.find((l) => l.n === n)?.guardrail).trim() !== '';
  /** @type {Set<number>} */ const built = new Set();
  /** @type {Map<number, Map<number, number|null>>} old part index -> new close-part index (null = the part is not in the close), per line */
  const remap = new Map();
  /** @type {Set<number>} */ const notSignable = new Set();
  /** M19 S5 (O1): the lines whose shape part has no class to ride (a list of items and no quote, none ruled): their rows are signed Not checked @type {Set<number>} */ const noShapeClass = new Set();
  /** @type {Set<number>} */ const pickedLines = new Set(Array.isArray(declaration.pickedLines) ? declaration.pickedLines : []);
  const guardrailClasses = isRec(declaration.guardrailClasses) ? { ...declaration.guardrailClasses } : {};
  /** the sheet part the block built for a sheet line, or null (no check is left on it) @param {number} n */
  const sheetPartOn = (n) => { const m = c.map.find((x) => x.line === n); const p = m ? c.parts[m.part] : null; return p && p.class === 'sheet' ? p : null; };
  /** @type {Set<number>} the sheet lines that already gave their checks to a step: the first green step that reads a sheet takes them */
  const given = new Set();
  const steps = declaration.steps.map((/** @type {any} */ st) => {
    const n = st?.fromLine;
    // M19 S3: a sheet line's checks are the block's (rows, drops), written into `close.sheet` of the line's first green step that reads a sheet; every other step of the line keeps the AI's own close
    if (isRec(st) && Number.isInteger(n) && block.isSheetLine(n) && !lineSet.has(n)) {
      const part = sheetPartOn(n);
      const { sheet: _ai, ...close } = isRec(st.close) ? st.close : /** @type {Record<string, any>} */ ({});
      if (!part || !isRec(st.close) || st.close.class !== 'green' || !Array.isArray(st.reads) || !st.reads.some((/** @type {string} */ r) => sheetRoles.includes(r)) || given.has(n)) return isRec(st.close) ? { ...st, close } : st;
      given.add(n);
      return { ...st, close: { ...close, sheet: part.checks.map((/** @type {any} */ x) => ({ ...x })) } };
    }
    if (!isRec(st) || !Number.isInteger(n) || !lineSet.has(n)) return st;
    const parts = partsOf(n);
    const signable = guarded(n);
    const fact = signable ? parts.find((p) => p.class === 'fact') : undefined;
    // M19 S5: the shape part rides the fact part (facts+shape, class green); a line with no fact part takes it only when a class is ruled for it (`shapeOnlyClass`)
    const picks = signable ? parts.filter((p) => p.class === 'countable' && p.check !== 'cited' && p.check !== 'numbersFromFacts') : [];
    const shape = signable ? parts.find((p) => p.class === 'shape' && (fact !== undefined || shapeOnlyClass === 'green')) : undefined;
    const tie = parts.find((p) => p.class === 'countable' && p.check === 'numbersFromFacts');
    const old = isRec(st.close) ? st.close : {};
    const sheet = Array.isArray(old.sheet) ? old.sheet : null;
    // the part order the close lists them in (src/checklistsign.js closePartsOf): the fact part, the shape part, each pick, the tie
    const keptOrder = [...(fact ? [fact] : []), ...(shape ? [shape] : []), ...picks, ...(tie ? [tie] : [])];
    const map = remap.get(n) ?? new Map();
    for (const p of parts) map.set(p.oldIndex, keptOrder.includes(p) ? keptOrder.indexOf(p) : null);
    remap.set(n, map);
    if (!signable && parts.some((p) => p !== tie)) notSignable.add(n);
    if (signable && !shape && parts.some((p) => p.class === 'shape')) noShapeClass.add(n);
    /** @type {Record<string, any>} */
    const close = { ...(sheet ? { sheet } : {}), ...(Array.isArray(old.columns) ? { columns: old.columns } : {}) };
    if (fact) {
      close.class = 'green';
      close.cited = { source: fact.source, facts: fact.facts, ...(isRec(fact.count) ? { count: fact.count } : {}), ...(isRec(fact.asSeen) ? { asSeen: fact.asSeen } : {}) };
    } else close.class = sheet ? 'green' : shape ? /** @type {'green'} */ (shapeOnlyClass) : picks.length ? 'softgreen' : 'hitl';
    // the list-of-items check is its own close key, never `close.shape` (amendment E): the signed fields and the item count of the part
    if (shape) close.itemShape = { fields: shape.fields, ...(Number.isInteger(shape.minItems) ? { minItems: shape.minItems } : {}), ...(Number.isInteger(shape.maxItems) ? { maxItems: shape.maxItems } : {}) };
    if (picks.length) {
      const checks = picks.map(pickedOf);
      if (close.class === 'green') { close.picked = checks; pickedLines.add(n); } else close.shape = { picked: checks };
    }
    if (tie) close.numbersFrom = [...tie.from];
    if (fact || shape || picks.length || tie) built.add(n);
    const reads = Array.isArray(st.reads) && fact && !st.reads.includes(fact.source) ? [...st.reads, fact.source] : st.reads;
    return { ...st, reads, close };
  });
  // the class of a line with a guardrail is the class its close ended in; a hitl one says why in the rows' own Not-checked reasons
  for (const n of lineSet) {
    const mine = steps.find((/** @type {any} */ st) => isRec(st) && st.fromLine === n);
    // the classes of a list line are code's: a line with no guardrail of the person's has no class entry, whatever the AI sent
    if (!guarded(n)) { delete guardrailClasses[String(n)]; continue; }
    if (!mine) continue;
    guardrailClasses[String(n)] = mine.close.class;
  }
  const served = new Set(steps.filter((/** @type {any} */ st) => isRec(st)).map((/** @type {any} */ st) => st.fromLine));
  /** the signed list: the block's signed fields per row, the parts renumbered to the close's order, a row whose check cannot ride its line signed Not checked @type {any[]} */
  // M19 S3: the rows of a sheet line are the block's own (state, Drop); the signed list and the Not-checked lines of a sheet line stay fwd's (src/sheetrows.js reads the close.sheet written above, src/sheetblock.js the reasons)
  const checkList = block.signedRows().filter((/** @type {any} */ r) => !block.isSheetLine(r.line)).map((/** @type {any} */ r) => {
    const m = remap.get(r.line);
    const idx = isRec(r.part) && m ? m.get(r.part.part) : undefined;
    if (r.state === 'built' && r.kind !== 'floor' && (idx === null || idx === undefined)) {
      const { part: _p, ...rest } = r;
      return { ...rest, state: 'not-checked', reason: notSignable.has(r.line) ? NO_GUARDRAIL_WORDS : noShapeClass.has(r.line) ? (r.kind === 'rule' ? REASON.noPick : REASON.noRule) : String(r.reason ?? 'not checked') };
    }
    return isRec(r.part) && typeof idx === 'number' ? { ...r, part: { line: r.part.line, part: idx } } : r;
  });
  /** @type {Record<string, 'you'|'agent'|'default'>} the tag of each Not-checked line, by the row it tells (M16 item 5: one tag per row) */
  const notCheckedBy = {};
  // M19 am8 item 2, am9 items 1 to 4: the items are the reader's (src/checkrows.js `notCheckedItem`, the one writer): a `~` rule `line <n>: "<rule text>" \u2014 <reason>`, any other row its name (`<kind> "<words>"`)
  const notChecked = checkList.filter((r) => isListedNotChecked(checkList, r)).map((r) => {
    const own = block.rows.find((x) => x.key === r.key);
    if (own?.hidden) return null;
    // the reason is the signed row's own `reason` (src/checkblock.js REASON, the one table); M10 am17 (6): `kept` words
    const line = notCheckedItem(r, ruleTextOf(lines, r) ?? own?.text, own ? (own.name ? [own.name] : own.words) : undefined, own?.keptFromLast === true);
    if (r.by === 'you' || r.by === 'agent' || r.by === 'default') notCheckedBy[line] = r.by;
    return line;
  }).filter((x) => x !== null);
  for (const l of lines) {
    if (!askLines.has(l.n) || typeof l.guardrail !== 'string') continue;
    for (const rule of lineRules({ rule: l.guardrail })) {
      const line = `not checked · "${rule}" — ${ASK_LINE_REASON}`;
      if (!notChecked.includes(line)) notChecked.push(line);
      notCheckedBy[line] = 'you';
    }
  }
  /** @type {Record<string, any>} */
  const listed = checkList.filter((r) => served.has(r.line)); // a line no step serves is refused as a line; its rows are not signed
  /** @type {Record<string, any>} */
  const out = { ...declaration, steps, guardrailClasses, checkList: listed };
  if (pickedLines.size) out.pickedLines = [...pickedLines].sort((a, b) => a - b); else delete out.pickedLines;
  return { declaration: out, notChecked: /** @type {string[]} */ (notChecked), notCheckedBy, built };
}

/**
 * M17 am5 / P5: a green sheet step the builder (src/sheetbuild.js) reported as holding no built check has nothing to check it: its close becomes `hitl` (the class is decided here, never in the sheet files),
 * the class on its line follows, and its rules are the Not-checked lines the builder gave. A plan signed before M17 is never passed through here.
 * @param {Record<string, any>} declaration @param {{line: number, lost: string[]}[]} unbuilt
 * @returns {{declaration: Record<string, any>, lines: number[], lost: string[]}}
 */
export function closeUnbuiltSheetSteps(declaration, unbuilt) {
  if (!isRec(declaration) || !Array.isArray(declaration.steps) || unbuilt.length === 0) return { declaration, lines: [], lost: [] };
  const lines = unbuilt.map((u) => u.line);
  const steps = declaration.steps.map((/** @type {any} */ st) => (isRec(st) && lines.includes(st.fromLine) && isRec(st.close) && st.close.class === 'green' ? { ...st, close: { class: 'hitl' } } : st));
  /** @type {Record<string, any>} */
  const out = { ...declaration, steps };
  if (isRec(declaration.guardrailClasses)) {
    out.guardrailClasses = { ...declaration.guardrailClasses };
    for (const n of lines) out.guardrailClasses[String(n)] = 'hitl';
  }
  return { declaration: out, lines, lost: unbuilt.flatMap((u) => u.lost) };
}
