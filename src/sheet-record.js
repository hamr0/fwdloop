// M10b piece 2 / M8b item 3: the writer of the `sheet` section of `<run>/line-checks.json` (the file's one writer is `writeLineSection`, src/line-checks.js), the record of what each sheet check said in this run, for the separate checker that re-runs a run's
// signed checks against its saved sheet (M10b "Done when"). Append-only: one entry per (job line, try), written the moment that try's check has run, never replaced.
// Shape: { lines: [ { n, try, passed, tables: [{name, tableSha}], checks: [the signed check objects], claims: <the step's answer>, results: [{id, text, ok, result}], red } ] }.
// `tables[].tableSha` is the one recorded at the run's start (run.json), the one the check used. Throws away: nothing the check saw; no cell text is kept here.
import { readLineSection, writeLineSection } from './line-checks.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {string} runDir @param {{n: number, try: number, checks: any[], closed: {verdict: string, red?: string|null, sheetRecord?: any}}} o
 * @returns {void}
 */
export function writeSheetLine(runDir, { n, try: attempt, checks, closed }) {
  const rec = closed.sheetRecord;
  if (!rec) return;
  writeLineSection(runDir, 'sheet', (had) => {
    if (had.some((l) => isRec(l) && l.n === n && l.try === attempt)) return null;
    return [...had, {
      n, try: attempt, passed: closed.verdict === 'green',
      tables: rec.inputs.map((/** @type {any} */ i) => ({ name: i.name, tableSha: i.sha256 })),
      checks: JSON.parse(JSON.stringify(checks)),
      claims: rec.claims,
      results: rec.checks,
      red: closed.verdict === 'green' ? null : (closed.red ?? null),
    }];
  });
}

/**
 * The reader of the record, for the Result tab and the separate checker: `{lines: [...]}`, or null when the file is missing or is not that shape (the page then
 * shows no verdicts, never a half-read record). Read through the safe gateway.
 * @param {string} runDir @returns {{lines: any[]}|null}
 */
export function readSheetChecks(runDir) {
  const got = readLineSection(runDir, 'sheet');
  return got.ok ? { lines: got.lines } : null;
}
