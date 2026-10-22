// borrowed-from: bareloop src/panel/server.js@2959217 (proofOf, moneyAsRead, resultCell - the row a Result tab shows, read off bareguard's evidence)
// M10 piece 4: the ONE writer of `<run>/cited-checks.json`, the record the Result tab's reader (`readCitedChecks`, src/panel/result.js) takes. One line per
// job line, written the moment that line's cited check has run, from the check's own answer: nothing here decides a verdict.
//
// Shape (the reader's, copied from bareloop): { lines: [ { n, source, passed, facts: [{name, kind: 'phrase'|'value', sentence}],
//   rows: [{n, quote, cells: [one text per fact], proof?: {text, marks}}] | null, notChecked: string[] } ] }.
// Extra keys the reader ignores and the separate checker (scripts/check-cited-run.mjs) reads: per line `check` {sha256 of the frozen text, the signed facts,
// the count} and per row `values`.
// Throws away: bareguard's evidence beyond the marks of the claim's own spans; nothing: a red line keeps its judged rows (am9); only a stopped check has none.
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { readFileInside } from './flow.js';
import { moneyAs } from './pageask.js';
import { factSentence, countSentence, CITED_ID } from './citedcheck.js';

/** the record's name in the run's own folder; the Result tab's reader takes it from here */
export const CITED_CHECKS_FILE = 'cited-checks.json';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * What a result's check read, from bareguard's `full.evidence` entry for the claim, for the proof fold. `null` = no evidence, or an entry that is not about
 * this quote: the page then shows the plain quote. `text` is bareguard's normalized quote; `marks` are `[start, end]` UTF-16 offsets into it, sorted,
 * overlaps merged. Every span the check read EXCEPT a bind-only membership token that is not this claim's (`canon` present, `matched` absent).
 * @param {any} ev @param {unknown} quote @returns {{text: string, marks: number[][]}|null}
 */
function proofOf(ev, quote) {
  if (!ev || typeof ev.text !== 'string' || !Array.isArray(ev.spans) || typeof quote !== 'string') return null;
  if (quote.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim() !== ev.text) return null;
  const spans = ev.spans
    .filter((/** @type {any} */ sp) => sp && Number.isInteger(sp.start) && Number.isInteger(sp.end) && sp.start >= 0 && sp.end > sp.start && sp.end <= ev.text.length
      && !(sp.canon !== undefined && sp.matched !== true))
    .map((/** @type {any} */ sp) => [sp.start, sp.end])
    .sort((/** @type {number[]} */ x, /** @type {number[]} */ y) => x[0] - y[0] || x[1] - y[1]);
  /** @type {number[][]} */
  const marks = [];
  for (const sp of spans) {
    const last = marks[marks.length - 1];
    if (last && sp[0] < last[1]) last[1] = Math.max(last[1], sp[1]);
    else marks.push([sp[0], sp[1]]);
  }
  return { text: ev.text, marks };
}

/**
 * A money fact's amount as the page wrote it ("144 US dollars"): the quote's text from the first to the last of the value's own currency / unit / value spans
 * in bareguard's evidence for this claim. `null` = nothing located, or more than a short run (the caller keeps the fact's own spelling).
 * @param {any} ev @param {number} j the fact's index (bareguard's decide index) @returns {string|null}
 */
function moneyAsRead(ev, j) {
  const own = ev.spans.filter((/** @type {any} */ sp) => sp && sp.decide === j && ['value', 'currency', 'unit'].includes(sp.role)
    && Number.isInteger(sp.start) && Number.isInteger(sp.end) && sp.start >= 0 && sp.end > sp.start && sp.end <= ev.text.length
    && !(sp.canon !== undefined && sp.matched !== true));
  if (own.length === 0) return null;
  const t = ev.text.slice(Math.min(...own.map((/** @type {any} */ sp) => sp.start)), Math.max(...own.map((/** @type {any} */ sp) => sp.end))).trim();
  return t !== '' && t.length <= 40 ? t : null;
}

/** a result value as the step wrote it, for a table cell */
function cellText(/** @type {unknown} */ v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * One job line's record from the check's own answer.
 * @param {{n: number, part: any, results: unknown, check: Awaited<ReturnType<typeof import('./citedcheck.js').checkCited>>, confirmed?: string[]}} o
 *   `confirmed` = names of facts whose limit the person agreed to (the Result tab's "(you confirmed)")
 * @returns {Record<string, any>}
 */
export function citedLineOf({
  n, part, results, check, confirmed = [],
}) {
  const passed = check.verdict === 'green';
  const list = Array.isArray(results) ? results : [];
  /** @type {any[]|null} */
  let rows = null;
  // M10 am9 item 1: a red line keeps the results the check judged (bareloop's readJudged); `passed` stays false, so the page never ticks it. A stopped check
  // judged nothing: no rows.
  if (passed || check.verdict === 'red') {
    rows = list.map((/** @type {any} */ r, /** @type {number} */ k) => {
      const values = isRec(r) && isRec(r.values) ? r.values : {};
      const quote = isRec(r) && typeof r.quote === 'string' ? r.quote : '';
      const ev = check.evidence.find((/** @type {any} */ e) => e && e.check === CITED_ID && e.claim === k) ?? null;
      const proof = proofOf(ev, quote);
      return {
        n: k + 1,
        quote,
        ...(proof ? { proof } : {}),
        cells: part.facts.map((/** @type {any} */ f, /** @type {number} */ j) => {
          if (f.shape === 'phrase') return String(f.phrase);
          const v = cellText(values[f.name]);
          if (f.shape === 'money') return (proof ? moneyAsRead(ev, j) : null) ?? (/^\d[\d.,]*$/.test(v.trim()) ? moneyAs(f, v.trim(), true) : v);
          return v;
        }),
        values: Object.fromEntries(part.facts.filter((/** @type {any} */ f) => f.shape !== 'phrase').map((/** @type {any} */ f) => [f.name, cellText(values[f.name])])),
      };
    });
  }
  const countRow = countSentence(part);
  return {
    n,
    source: part.source,
    passed,
    facts: part.facts.map((/** @type {any} */ f) => ({
      name: f.name, kind: f.shape === 'phrase' ? 'phrase' : 'value', sentence: factSentence(f, part.source), ...(confirmed.includes(f.name) ? { confirmed: true } : {}),
    })),
    rows,
    notChecked: check.verdict === 'stopped' && check.fault ? [check.fault] : [],
    check: {
      sha256: check.sha256, facts: part.facts.map((/** @type {any} */ f) => ({ ...f })), ...(part.count === undefined ? {} : { count: { ...part.count } }), ...(countRow ? { countSentence: countRow } : {}),
    },
  };
}

/**
 * Write one job line into the run's record: the line with the same `n` is replaced (a later try of the same step wins), the others stay, lines are kept in
 * order. An unreadable existing record is started again (this function is its only writer). Atomic: a reader sees the old file or the new one.
 * @param {string} runDir @param {Record<string, any>} line @returns {void}
 */
export function writeCitedLine(runDir, line) {
  const file = join(runDir, CITED_CHECKS_FILE);
  /** @type {Record<string, any>[]} */
  let lines = [];
  const had = readFileInside(runDir, CITED_CHECKS_FILE);
  if (had.ok) {
    try {
      const rec = JSON.parse(had.text);
      if (rec && Array.isArray(rec.lines)) lines = rec.lines.filter((/** @type {any} */ l) => isRec(l) && l.n !== line.n);
    } catch { lines = []; }
  }
  lines.push(line);
  lines.sort((a, b) => a.n - b.n);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ lines }, null, 2)}\n`);
  renameSync(tmp, file);
}
