// M4d am29 item 2: what one try saves about its checks. The runner runs the checks (done, happened, the close); this module only words them
// and records the output they judged. Numbers are identities, not run order: #1 the output exists, #2 the model said done, #3 and up the close's
// checks. A check that did not run (the done check halts before the others) is not listed. A hitl close has no mechanical check, so it adds none.
import { createHash } from 'node:crypto';
import { serializeArtifact } from './ask.js';
import { labelled } from './checkwords.js';
import { sheetRowKey } from './sheetrows.js';
import { listLinesOf, partByOf } from './checklistsign.js';
import { rowResultsOf } from './rowresults.js';
import { stepRowsOf } from './checkrows.js';
import { itemCountOf } from './shaperows.js';
import { rulesOfLine } from './sheetblock.js';

export const EVERY_STEP = 'every step';
/** the words of the two checks every step has (#1 and #2 below): the Audit's "Always checked" rows, the plan card's and the Job tab's "Always checked" fold */
export const EVERY_STEP_TEXTS = Object.freeze(["the output exists and isn't empty", 'the model said done: true']);

/** The size words of a byte count: `412 B`, `7.9 KB`, `1.2 MB`. @param {number} n */
export function sizeWords(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Where a guardrail check comes from: the job line it belongs to (guardrail n belongs to job line n). @param {{fromLine?: unknown}} step */
export const lineSource = (step) => (Number.isInteger(step?.fromLine) ? `line ${step.fromLine} ~` : 'the step\'s guardrail');

/** #2, the model's own `done`. @param {{verdict: 'done'|'not-done'}} doneCheck @param {unknown} artifact */
export function doneRecord(doneCheck, artifact) {
  const said = /** @type {any} */ (artifact)?.done;
  return {
    n: 2, text: 'the model said done: true', ok: doneCheck.verdict === 'done', result: doneCheck.verdict === 'done' ? null : (typeof said === 'boolean' ? 'it said done: false' : 'no true/false done'), source: EVERY_STEP,
  };
}

/** #1, the happened check: the output exists and is not empty. @param {{verdict: string, red?: string}} happened @param {unknown} artifact */
export function happenedRecord(happened, artifact) {
  const ok = happened.verdict !== 'red';
  return {
    n: 1, text: 'the output exists and isn\'t empty', ok, result: ok ? sizeWords(Buffer.byteLength(serializeArtifact(artifact), 'utf8')) : String(happened.red ?? '').replace(/^.*? produced /, ''), source: EVERY_STEP,
  };
}

/** The output a try judged: the file it is saved as when the step closes, with the size and sha256 of those exact bytes. Never its content. @param {{emits?: string}} step @param {unknown} artifact */
export function outputRecord(step, artifact) {
  const bytes = serializeArtifact(artifact);
  return { file: `artifacts/${step?.emits ?? 'step'}.json`, bytes: Buffer.byteLength(bytes, 'utf8'), sha256: createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex') };
}

/**
 * #3 and up: the close's own checks. A softgreen close carries each of its checks; a green close is one check over all its cited fields; a close that
 * judged nothing (`unparseable`, `crash`) is one check that could not run, with that third outcome as its result.
 * @param {any} step @param {any} artifact @param {{verdict: string, red?: string|null, checks?: Array<{text:string, ok:boolean, result:string|null}>}} closed @param {any[]} [checkList] the signed list (M16): a line on it tags its checks
 * @param {any[]} [jobLines] the signed job lines (M19 am11: the words of a list line's field rows read the person's rule)
 */
export function closeRecords(step, artifact, closed, checkList = undefined, jobLines = undefined) {
  // M16 item 5: a check of a list line carries `by`, the row's own (`you` / `agent` / `default`); the Audit draws the tag from it. Any other line keeps the words it has.
  const decl = Array.isArray(checkList) ? { checkList } : undefined;
  const listed = decl !== undefined && listLinesOf(decl).has(step?.fromLine);
  const hasCited = step?.close?.class === 'green' && !!step?.close?.cited;
  const by = (/** @type {number} */ idx, /** @type {'you'|'agent'|'default'} */ fallback) => (listed ? { by: partByOf(decl, step.fromLine, idx) ?? fallback, part: idx } : {});
  const rows = factRecords(step, artifact, closed, listed ? (/** @type {number} */ idx) => partByOf(decl, step.fromLine, idx) : undefined, checkList, jobLines).map((r) => (listed && hasCited && r.n === 3 ? { ...r, text: String(r.text).replace(/ \[agent\]$/, ''), ...by(0, 'agent') } : r));
  // the list's part order is the close's: the fact part, the item-fields part (M19 am10), then each pick, then the tie
  const lead = (hasCited ? 1 : 0) + (step?.close?.itemShape ? 1 : 0);
  // M10 am22 (1): the picks on a fact line are rows after the fact rows, each judged on the answer's text
  const picks = Array.isArray(/** @type {any} */ (closed).pickChecks) ? /** @type {any} */ (closed).pickChecks : [];
  const pickRows = picks.map((/** @type {any} */ c, /** @type {number} */ i) => ({ n: rows.length + 3 + i, text: listed ? c.text : labelled(c.text, 'picked'), ok: c.ok, result: c.result, source: lineSource(step), ...by(lead + i, 'you') }));
  // M16 R7: the numbers tie of a text line is one more row
  const tie = /** @type {any} */ (closed).numbersCheck;
  const picked = Array.isArray(step?.close?.picked) ? step.close.picked.length : Array.isArray(step?.close?.shape?.picked) ? step.close.shape.picked.length : 0;
  return [...rows, ...pickRows, ...(tie ? [{ n: rows.length + pickRows.length + 3, text: tie.text, ok: tie.ok, result: tie.result, source: lineSource(step), ...by(lead + picked, 'default') }] : [])];
}

/** @param {any} step @param {any} artifact @param {any} closed @param {((idx: number) => string|null)} [partBy] set for a list line (M16): its softgreen picks carry the row's `by` instead of a label @param {any[]} [checkList] the signed list: a sheet row on it gives its check's `by` @param {any[]} [jobLines] */
function factRecords(step, artifact, closed, partBy = undefined, checkList = undefined, jobLines = undefined) {
  const source = lineSource(step);
  if (closed.verdict === 'unparseable' || closed.verdict === 'crash') {
    return [{
      n: 3, text: 'the close could run', ok: false, result: closed.verdict, source,
    }];
  }
  if (step?.close?.class === 'green' && Array.isArray(step?.close?.sheet) && Array.isArray(closed.checks)) {
    // M10b piece 2: each signed sheet check is its own row, worded by `sheetCheckSentence`, judged by bareguard
    // hamr 2026-11-14: a plan whose list has the sheet's rows draws each check with the `by` of its row (`~` = you, `!` = agent); an older plan keeps `[agent]`
    return closed.checks.map((c, i) => {
      const row = Array.isArray(checkList) ? checkList.find((/** @type {any} */ r) => r?.kind === 'sheet' && r.key === sheetRowKey(step.fromLine, String(c.id))) : undefined;
      if (row && (row.by === 'you' || row.by === 'agent')) return { n: 3 + i, text: c.text, ok: c.ok, result: c.result, source, by: row.by, part: row.part.part };
      return { n: 3 + i, text: labelled(c.text, 'agent'), ok: c.ok, result: c.result, source };
    });
  }
  if (step?.close?.class === 'green' && step?.close?.cited) {
    const n = Array.isArray(artifact?.results) ? artifact.results.length : 0;
    return [{
      n: 3, text: labelled('every result is quoted from the saved copy and passes its rules', 'agent'), ok: Array.isArray(/** @type {any} */ (closed).pickChecks) && closed.cited?.check ? closed.cited.check.verdict === 'green' : closed.verdict === 'green', result: `${n} result${n === 1 ? '' : 's'}`, source,
    }];
  }
  if (step?.close?.class === 'green' && step?.close?.itemShape && !step.close.cited && partBy !== undefined) return itemShapeRecords(step, closed, checkList, jobLines, source);
  if (step?.close?.class === 'green') {
    const n = Object.keys(artifact?.fields ?? {}).length;
    return [{
      n: 3, text: 'every cited field matches its source', ok: closed.verdict === 'green', result: `${n} field${n === 1 ? '' : 's'}`, source,
    }];
  }
  // M10 am22 (4): a softgreen check is the person's when it is one of their picks, the drafter's otherwise; the one-key row is code's own and carries no label
  return (closed.checks ?? []).map((c, i) => {
    const id = String(/** @type {any} */ (c).id);
    const pk = /^pick(\d+)$/.exec(id);
    if (partBy !== undefined) return { n: 3 + i, text: c.text, ok: c.ok, result: c.result, source, ...(pk ? { by: partBy(Number(pk[1]) - 1) ?? 'agent', part: Number(pk[1]) - 1 } : {}) };
    return { n: 3 + i, text: id === 'keys' ? c.text : labelled(c.text, pk ? 'picked' : 'agent'), ok: c.ok, result: c.result, source };
  });
}

/**
 * M19 am11 item 4: a list line that quotes nothing: one record per row of its shape part (each item field, the rule that sets the item count), each with the result of its OWN row (src/rowresults.js `rowResultsOf`, from bareguard's own gaps),
 * its row's `key`, `by` and `part`. A red no row owns is a record of its own, in the closer's words. Never "every cited field matches its source".
 * @param {any} step @param {any} closed @param {any[]|undefined} checkList @param {any[]|undefined} jobLines @param {string} source
 */
function itemShapeRecords(step, closed, checkList, jobLines, source) {
  const line = step.fromLine;
  const list = Array.isArray(checkList) ? checkList : [];
  const rows = stepRowsOf({ declaration: { checkList: list, steps: [step] }, st: step, lines: Array.isArray(jobLines) ? jobLines : [] }).rows.filter((/** @type {any} */ r) => r.idx === 0 && /:shape:/.test(String(r.part)));
  const ofLine = list.filter((/** @type {any} */ r) => r?.line === line);
  const rules = ofLine.filter((/** @type {any} */ r) => r.kind === 'rule' && r.state === 'built' && r.part?.part === 0).map((/** @type {any} */ r) => r.rule);
  const said = rulesOfLine((Array.isArray(jobLines) ? jobLines : []).find((/** @type {any} */ l) => l?.n === line));
  const ruleCounts = Object.fromEntries(rules.map((/** @type {number} */ k) => [k, itemCountOf(String(said[k - 1] ?? ''))]).filter(([, c]) => c !== null));
  const graded = { verdict: closed.verdict, rawGaps: Array.isArray(closed.shapeGaps) ? closed.shapeGaps : [], ruleCounts };
  const res = rowResultsOf(ofLine, { step: line, parts: [{ ...step.close.itemShape, class: 'shape', rules }] }, graded);
  const got = new Map(res.rows.map((/** @type {any} */ r) => [r.key, r]));
  /** @type {any[]} */
  const out = rows.map((/** @type {any} */ r, /** @type {number} */ i) => {
    const g = got.get(r.key);
    return { n: 3 + i, text: r.text, ok: g?.result === 'passed', result: g === undefined ? 'no result' : g.result === 'passed' ? null : g.result === 'failed' ? g.why : g.result, source, by: r.by, part: r.idx, key: r.key };
  });
  for (const u of res.unclaimed) out.push({ n: 3 + out.length, text: u, ok: false, result: null, source, unclaimed: true });
  return out;
}
