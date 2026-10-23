// M10b piece 2: the ONE writer of `<run>/sheet-checks.json`, the record of what each sheet check said in this run, for the separate checker that re-runs a run's
// signed checks against its saved sheet (M10b "Done when"). Append-only: one entry per (job line, try), written the moment that try's check has run, never replaced.
// Shape: { lines: [ { n, try, passed, tables: [{name, tableSha}], checks: [the signed check objects], claims: <the step's answer>, results: [{id, text, ok, result}], red } ] }.
// `tables[].tableSha` is the one recorded at the run's start (inputs.json), the one the check used. Throws away: nothing the check saw; no cell text is kept here.
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { readFileInside } from './flow.js';

/** the record's name in the run's own folder */
export const SHEET_CHECKS_FILE = 'sheet-checks.json';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {string} runDir @param {{n: number, try: number, checks: any[], closed: {verdict: string, red?: string|null, sheetRecord?: any}}} o
 * @returns {void}
 */
export function writeSheetLine(runDir, { n, try: attempt, checks, closed }) {
  const rec = closed.sheetRecord;
  if (!rec) return;
  /** @type {any[]} */
  let lines = [];
  const had = readFileInside(runDir, SHEET_CHECKS_FILE);
  if (had.ok) {
    try {
      const parsed = JSON.parse(had.text);
      if (isRec(parsed) && Array.isArray(parsed.lines)) lines = parsed.lines;
    } catch { lines = []; }
  }
  if (lines.some((l) => isRec(l) && l.n === n && l.try === attempt)) return;
  lines.push({
    n, try: attempt, passed: closed.verdict === 'green',
    tables: rec.inputs.map((/** @type {any} */ i) => ({ name: i.name, tableSha: i.sha256 })),
    checks: JSON.parse(JSON.stringify(checks)),
    claims: rec.claims,
    results: rec.checks,
    red: closed.verdict === 'green' ? null : (closed.red ?? null),
  });
  const file = join(runDir, SHEET_CHECKS_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ lines }, null, 2)}\n`);
  renameSync(tmp, file);
}

/**
 * The reader of the record, for the Result tab and the separate checker: `{lines: [...]}`, or null when the file is missing or is not that shape (the page then
 * shows no verdicts, never a half-read record). Read through the safe gateway.
 * @param {string} runDir @returns {{lines: any[]}|null}
 */
export function readSheetChecks(runDir) {
  const got = readFileInside(runDir, SHEET_CHECKS_FILE);
  if (!got.ok) return null;
  try {
    const parsed = JSON.parse(got.text);
    return isRec(parsed) && Array.isArray(parsed.lines) ? { lines: parsed.lines } : null;
  } catch { return null; }
}
