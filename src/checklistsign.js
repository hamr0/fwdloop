// M16 (docs/wiki/the-module-ladder.md, "M16" item 2, "a check that reaches the plan is not on the list"): the sign-time and run-start proof that the checks of a plan's list lines are the list's.
// Equivalent of bareloop src/rubricstep.js@v0.56.0 (3383cce) `listMatchesClose`, read over fwdloop's close fields instead of a rubric-step stage: the checks of one line, in the order the check block
// builds them, are [close.cited (the fact part)], [close.itemShape (the shape part, M19 S5)], then each entry of close.picked / close.shape.picked, then close.numbersFrom (the numbers tie). A signed row points at one of them by `part: {line, part: <index>}`.
import { isRec } from './isrec.js';

/**
 * The checks of one step's close in the block's part order. M16 am4: with `withSheet` (a plan whose list has sheet rows) each `close.sheet` check is a part too, after the others.
 * @param {any} step @param {boolean} [withSheet] @returns {{what: string}[]}
 */
export function closePartsOf(step, withSheet = false) {
  const close = isRec(step) && isRec(step.close) ? step.close : {};
  /** @type {{what: string}[]} */
  const parts = [];
  if (isRec(close.cited)) parts.push({ what: 'the quote check (close.cited)' });
  if (isRec(close.itemShape)) parts.push({ what: 'the list-of-items check (close.itemShape)' });
  const picked = Array.isArray(close.picked) ? close.picked : isRec(close.shape) && Array.isArray(close.shape.picked) ? close.shape.picked : [];
  picked.forEach((/** @type {unknown} */ _c, /** @type {number} */ i) => parts.push({ what: `the picked check ${i + 1} (close.picked)` }));
  if (Array.isArray(close.numbersFrom) && close.numbersFrom.length > 0) parts.push({ what: 'the numbers tie (close.numbersFrom)' });
  if (withSheet && Array.isArray(close.sheet)) close.sheet.forEach((/** @type {any} */ c) => parts.push({ what: `the sheet check ${isRec(c) ? String(c.id) : '?'} (close.sheet)` }));
  return parts;
}

/**
 * Every red of a plan's `checkList` (a plan without one is not examined): a built row must point at a check the close really has, every check a list line's close has must have a built row
 * pointing at it, and a list line's close carries no other check of its own (a `close.shape` key besides `picked`). Each red names the line. Pure.
 * @param {any} declaration @returns {string[]}
 */
export function checkListReds(declaration) {
  if (!isRec(declaration) || declaration.checkList === undefined) return [];
  const list = declaration.checkList;
  if (!Array.isArray(list) || !list.every(isRec)) return ['declaration: "checkList" must be a list of rows'];
  const steps = Array.isArray(declaration.steps) ? declaration.steps.filter(isRec) : [];
  // M16 am4: a plan whose list has sheet rows is held to them for EVERY sheet check of its steps (a plan from before am4 has none: its sheet lines are not examined, as before)
  const sheetListed = list.some((r) => r.kind === 'sheet');
  const sheetLines = sheetListed ? steps.filter((st) => isRec(st.close) && Array.isArray(st.close.sheet) && st.close.sheet.length > 0 && Number.isInteger(st.fromLine)).map((st) => /** @type {number} */ (st.fromLine)) : [];
  const lines = [...new Set([...list.filter((r) => Number.isInteger(r.line)).map((r) => /** @type {number} */ (r.line)), ...sheetLines])].sort((a, b) => a - b);
  const stepsOn = (/** @type {number} */ n) => steps.filter((st) => st.fromLine === n);
  const partsOn = (/** @type {number} */ n) => stepsOn(n).flatMap((st) => closePartsOf(st, sheetListed));
  const built = list.filter((r) => r.state === 'built' && r.kind !== 'floor' && r.kind !== 'ticket');
  /** @type {string[]} */
  const reds = [];
  for (const r of built) {
    const ok = isRec(r.part) && r.part.line === r.line && Number.isInteger(r.part.part) && r.part.part >= 0 && r.part.part < partsOn(/** @type {number} */ (r.line)).length;
    if (!ok) reds.push(`declaration: checkList line ${r.line}: a row points at a check the close does not run (${String(r.key)}). Nothing was signed - draft again.`);
  }
  for (const n of lines) {
    partsOn(n).forEach((p, i) => {
      if (!built.some((r) => isRec(r.part) && r.part.line === n && r.part.part === i)) reds.push(`declaration: checkList line ${n}: ${p.what} is in the close but has no row on the list. Nothing was signed - draft again.`);
    });
    for (const st of stepsOn(n)) {
      const shape = isRec(st.close) && isRec(st.close.shape) ? st.close.shape : {};
      for (const k of Object.keys(shape)) if (k !== 'picked') reds.push(`declaration: checkList line ${n}: close.shape.${k} is a check that is not on the list. Nothing was signed - draft again.`);
    }
  }
  return reds;
}

/** the job lines that have a list: a plan from before M16 has no `checkList`, so none. Sheet rows (M16 am4, `kind: 'sheet'`) do not make a line a block line: a CSV job's other readers stay as they were. @param {any} declaration @returns {Set<number>} */
export function listLinesOf(declaration) {
  const list = isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList : [];
  return new Set(list.filter((r) => isRec(r) && Number.isInteger(r.line) && r.kind !== 'sheet').map((r) => /** @type {number} */ (r.line)));
}

/** M16 am4: every line the plan card draws a list on - the block's lines and the sheet lines @param {any} declaration @returns {Set<number>} */
export function cardLinesOf(declaration) {
  const list = isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList : [];
  return new Set(list.filter((r) => isRec(r) && Number.isInteger(r.line)).map((r) => /** @type {number} */ (r.line)));
}

/** the built rows of the list on one line, the floor aside @param {any} declaration @param {number} line */
const builtOn = (declaration, line) => (isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList : []).filter((r) => isRec(r) && r.line === line && r.state === 'built' && r.kind !== 'floor');

/**
 * Who made the check at part `idx` of a list line's close (`'you'` a `~` rule, `'agent'` a `!` row, `'default'` a `$` row), read from the row that points at it (`part`), else null.
 * ONE reader of the rows' `by` for the close's parts (the readout, the plan card and the Audit tag a check through it). Pure.
 * @param {any} declaration @param {number} line @param {number} idx @returns {'you'|'agent'|'default'|null}
 */
export function partByOf(declaration, line, idx) {
  const r = builtOn(declaration, line).find((x) => isRec(x.part) && x.part.part === idx);
  return r && (r.by === 'you' || r.by === 'agent' || r.by === 'default') ? r.by : null;
}

/** who made the fact named `name` of a list line's quote check (the row that built it), else null @param {any} declaration @param {number} line @param {string} name @returns {'you'|'agent'|'default'|null} */
export function factByOf(declaration, line, name) {
  const r = builtOn(declaration, line).find((x) => Array.isArray(x.facts) && x.facts.includes(name));
  return r && (r.by === 'you' || r.by === 'agent' || r.by === 'default') ? r.by : null;
}

/** who made the result count of a list line's quote check, else null @param {any} declaration @param {number} line @returns {'you'|'agent'|'default'|null} */
export function countByOf(declaration, line) {
  const r = builtOn(declaration, line).find((x) => x.kind === 'count');
  return r && (r.by === 'you' || r.by === 'agent' || r.by === 'default') ? r.by : null;
}
