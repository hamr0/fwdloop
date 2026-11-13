// M16 item 2 (docs/wiki/the-module-ladder.md, "M16"): "the AI sends only edits to that list; code proves each one and builds every check. The AI never writes a check."
// The declaration of a draft with the list on keeps the AI's steps, reads, primitives and asks, and takes the CHECKS of every line the block was given from the block's built parts:
//   a fact part        -> close.cited = {source, facts, count}, class green; the source is added to the step's reads by code
//   a countable part   -> a picked check (M10 am22 (1)-(3)): close.shape.picked on a softgreen step, close.picked on a fact (or sheet) step with the line in pickedLines
//   the numbers tie    -> close.numbersFrom (M16 am3 (2), R7)
//   no part            -> hitl, and `unjudgeable` carries the rows' Not-checked reasons
// Whatever the AI wrote for these checks (close.cited, close.shape, close.picked, close.class) is dropped. The block's signed rows become the declaration's `checkList`, which the sign and the
// run-start gate prove (src/checklistsign.js). A fwd line keeps ONE close per line, whose class must equal the class its guardrail earns (signed, M4d): so a line with no guardrail of the
// person's own can carry only the numbers tie; any other check the list built there cannot be signed on it and its rows are signed Not checked, with that reason.

/** what a row says when its check cannot ride a line that has no guardrail of its own (the class of a line comes from its guardrail) */
export const NO_GUARDRAIL_WORDS = 'This line has no guardrail of yours, so a check on it cannot be signed; you judge it at the Ask.';

import { factsOfLook } from './citedcheck.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** a countable part as the picked check the softgreen close runs: its own fields, the rule named `rule` (the inverse of the block's partOfPick) @param {Record<string, any>} part */
export function pickedOf(part) {
  const { text: _t, class: _c, check, rules: _r, source: _s, from: _f, oldIndex: _o, ...fields } = part;
  return { rule: check, ...fields };
}

/**
 * @param {{declaration: Record<string, any>, block: import('./checkblock.js').CheckBlock, lines: {n: number, guardrail?: string|null}[], lineSet: Set<number>}} o
 *   `lineSet` = the lines the block was given; `lines` = the signed lines (a guardrail decides the class)
 * @returns {{declaration: Record<string, any>, notChecked: string[], built: Set<number>}} `built` = the lines that got a check from the block (a red naming one of them is a fault of the build)
 */
export function assembleFromBlock({ declaration, block, lines, lineSet }) {
  if (!isRec(declaration) || !Array.isArray(declaration.steps)) return { declaration, notChecked: [], built: new Set() };
  const c = block.reconcile();
  // fwd's signed R2c (M10 am7 item 2; bareloop v0.56.0 has no such rule, M16 am3 (1): fwd's rule stays): a place the page-read grew to phrases is checked with EVERY phrase, one phrase fact each,
  // not with the one word the block built it from
  const placeFactsOf = (/** @type {any} */ part, /** @type {number} */ n) => {
    const places = /** @type {any[]} */ (block.lookFacts).filter((k) => k.line === n && Array.isArray(k.phrases) && (k.source === undefined || k.source === part.source));
    return part.facts.flatMap((/** @type {any} */ f) => { const k = f.shape === 'phrase' ? places.find((x) => String(x.name) === f.name) : undefined; return k ? factsOfLook(k) : [f]; });
  };
  const partsOf = (/** @type {number} */ n) => c.map.filter((m) => m.line === n).map((m) => ({ ...c.parts[m.part], oldIndex: c.map.filter((x) => x.line === n).findIndex((x) => x.part === m.part) }));
  const guarded = (/** @type {number} */ n) => typeof lines.find((l) => l.n === n)?.guardrail === 'string' && String(lines.find((l) => l.n === n)?.guardrail).trim() !== '';
  /** @type {Set<number>} */ const built = new Set();
  /** @type {Map<number, Map<number, number|null>>} old part index -> new close-part index (null = the part is not in the close), per line */
  const remap = new Map();
  /** @type {Set<number>} */ const notSignable = new Set();
  /** @type {Set<number>} */ const pickedLines = new Set(Array.isArray(declaration.pickedLines) ? declaration.pickedLines : []);
  const guardrailClasses = isRec(declaration.guardrailClasses) ? { ...declaration.guardrailClasses } : {};
  const unjudgeable = isRec(declaration.unjudgeable) ? { ...declaration.unjudgeable } : {};
  const rowsOn = (/** @type {number} */ n) => block.rows.filter((r) => r.line === n && r.kind !== 'floor' && !r.hidden && r.state === 'not-checked');
  const steps = declaration.steps.map((/** @type {any} */ st) => {
    const n = st?.fromLine;
    if (!isRec(st) || !Number.isInteger(n) || !lineSet.has(n)) return st;
    const parts = partsOf(n);
    const signable = guarded(n);
    const fact = signable ? parts.find((p) => p.class === 'fact') : undefined;
    const picks = signable ? parts.filter((p) => p.class === 'countable' && p.check !== 'cited' && p.check !== 'numbersFromFacts') : [];
    const tie = parts.find((p) => p.class === 'countable' && p.check === 'numbersFromFacts');
    const old = isRec(st.close) ? st.close : {};
    const sheet = Array.isArray(old.sheet) ? old.sheet : null;
    // the part order the close lists them in (src/checklistsign.js closePartsOf): the fact part, each pick, the tie
    const keptOrder = [...(fact ? [fact] : []), ...picks, ...(tie ? [tie] : [])];
    const map = remap.get(n) ?? new Map();
    for (const p of parts) map.set(p.oldIndex, keptOrder.includes(p) ? keptOrder.indexOf(p) : null);
    remap.set(n, map);
    if (!signable && parts.some((p) => p !== tie)) notSignable.add(n);
    /** @type {Record<string, any>} */
    const close = { ...(sheet ? { sheet } : {}), ...(Array.isArray(old.columns) ? { columns: old.columns } : {}) };
    if (fact) {
      close.class = 'green';
      close.cited = { source: fact.source, facts: placeFactsOf(fact, n), ...(isRec(fact.count) ? { count: fact.count } : {}) };
    } else close.class = sheet ? 'green' : picks.length ? 'softgreen' : 'hitl';
    if (picks.length) {
      const checks = picks.map(pickedOf);
      if (close.class === 'green') { close.picked = checks; pickedLines.add(n); } else close.shape = { picked: checks };
    }
    if (tie) close.numbersFrom = [...tie.from];
    if (fact || picks.length || tie) built.add(n);
    const reads = Array.isArray(st.reads) && fact && !st.reads.includes(fact.source) ? [...st.reads, fact.source] : st.reads;
    return { ...st, reads, close };
  });
  // the class of a line with a guardrail is the class its close ended in; a hitl one says why in the rows' own Not-checked reasons
  for (const n of lineSet) {
    const mine = steps.find((/** @type {any} */ st) => isRec(st) && st.fromLine === n);
    if (!mine || !guarded(n)) continue;
    guardrailClasses[String(n)] = mine.close.class;
    if (mine.close.class === 'hitl') unjudgeable[String(n)] = [...new Set(rowsOn(n).map((r) => String(r.reason ?? '')).filter(Boolean))].join(' ') || 'No check was picked for it, so you judge it at the Ask.';
    else delete unjudgeable[String(n)];
  }
  const served = new Set(steps.filter((/** @type {any} */ st) => isRec(st)).map((/** @type {any} */ st) => st.fromLine));
  /** the signed list: the block's signed fields per row, the parts renumbered to the close's order, a row whose check cannot ride its line signed Not checked @type {any[]} */
  const checkList = block.signedRows().filter((r) => served.has(r.line)).map((/** @type {any} */ r) => {
    const m = remap.get(r.line);
    const idx = isRec(r.part) && m ? m.get(r.part.part) : undefined;
    if (r.state === 'built' && r.kind !== 'floor' && (idx === null || idx === undefined)) {
      const { part: _p, ...rest } = r;
      return { ...rest, state: 'not-checked', reason: notSignable.has(r.line) ? NO_GUARDRAIL_WORDS : String(r.reason ?? 'not checked') };
    }
    return isRec(r.part) && typeof idx === 'number' ? { ...r, part: { line: r.part.line, part: idx } } : r;
  });
  const notChecked = checkList.filter((r) => r.state === 'not-checked' && r.kind !== 'floor').map((r) => {
    const row = block.rows.find((x) => x.key === r.key);
    if (row?.hidden) return null;
    return `line ${r.line}: ${r.kind === 'rule' && row?.text ? `"${row.text}"` : `${r.kind} ${r.key}`} - ${r.reason}`;
  }).filter((x) => x !== null);
  /** @type {Record<string, any>} */
  const out = { ...declaration, steps, guardrailClasses, ...(Object.keys(unjudgeable).length || isRec(declaration.unjudgeable) ? { unjudgeable } : {}), checkList };
  if (pickedLines.size) out.pickedLines = [...pickedLines].sort((a, b) => a - b); else delete out.pickedLines;
  return { declaration: out, notChecked: /** @type {string[]} */ (notChecked), built };
}
