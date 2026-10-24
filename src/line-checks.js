// M8b item 3: `line-checks.json`, the run's check record - one file in the run's folder, two sections: `cited` (what each cited check said, per job line: written by
// `writeCitedLine`, src/cited-record.js) and `sheet` (what each sheet check said, per job line and try: written by `writeSheetLine`, src/sheet-record.js). Each section
// is `{ lines: [...] }`. THIS file is the one writer of the file (`writeLineSection`) and the one reader of it (`readLineSection`): each section's writer says only what
// its lines are. The write is a temporary file, then a rename, so a reader sees the old file or the new one; the other section is carried over untouched.
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { readFileInside } from './flow.js';

/** the record's name in the run's own folder */
export const LINE_CHECKS_FILE = 'line-checks.json';

/** @typedef {'cited'|'sheet'} LineSection */

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The whole file as parsed, or why not. @param {string} runDir @returns {{ok: true, rec: Record<string, any>}|{ok: false, missing: boolean, red: string}} */
function readWhole(runDir) {
  const r = readFileInside(runDir, LINE_CHECKS_FILE);
  if (!r.ok) return { ok: false, missing: r.missing === true, red: r.red };
  try {
    const rec = JSON.parse(r.text);
    return isRec(rec) ? { ok: true, rec } : { ok: false, missing: false, red: 'not a JSON object' };
  } catch { return { ok: false, missing: false, red: 'not valid JSON' }; }
}

/**
 * One section of the record: `{ok: true, lines}`, or `{ok: false, missing: true}` when the file or the section is not there, or `{ok: false, missing: false, red}` when
 * the file (or the section) is not what it should be. Read through the safe gateway.
 * @param {string} runDir @param {LineSection} section
 * @returns {{ok: true, lines: any[]}|{ok: false, missing: true}|{ok: false, missing: false, red: string}}
 */
export function readLineSection(runDir, section) {
  const whole = readWhole(runDir);
  if (!whole.ok) return whole.missing ? { ok: false, missing: true } : { ok: false, missing: false, red: `${LINE_CHECKS_FILE}: ${whole.red}` };
  if (!Object.hasOwn(whole.rec, section)) return { ok: false, missing: true };
  const s = whole.rec[section];
  return isRec(s) && Array.isArray(s.lines) ? { ok: true, lines: s.lines } : { ok: false, missing: false, red: `${LINE_CHECKS_FILE}: "${section}" has no list of "lines"` };
}

/**
 * Change one section's lines and write the file: `change` gets the section's lines now (none when the section or the file is missing or unreadable: the record is started
 * again, this function is its only writer) and returns the lines to keep, or null to write nothing. The other section is carried over as it is. Atomic.
 * @param {string} runDir @param {LineSection} section @param {(lines: any[]) => any[]|null} change @returns {void}
 */
export function writeLineSection(runDir, section, change) {
  const whole = readWhole(runDir);
  const rec = whole.ok ? whole.rec : {};
  const had = isRec(rec[section]) && Array.isArray(rec[section].lines) ? rec[section].lines : [];
  const lines = change(had);
  if (lines === null) return;
  const file = join(runDir, LINE_CHECKS_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...rec, [section]: { lines } }, null, 2)}\n`);
  renameSync(tmp, file);
}
