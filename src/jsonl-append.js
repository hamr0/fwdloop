// The ONE fresh-line rule for every append-only JSONL file (books, trigger ledgers, triggers.jsonl): a crash can tear the last line mid-append, and the
// next row must not glue onto those bytes (the glued line would fail to parse, be skipped, and the row would be lost). Readers skip an unparseable line;
// this is its other half, and the two only work together.
import {
  appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** The ledger's text, '' when there is no file yet. @param {string} file */
export function ledgerText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** True when the file exists, is not empty and does not end in a newline (a torn last line). Reads one byte, however big the file. @param {string} file */
function endsTorn(file) {
  let fd;
  try { fd = openSync(file, 'r'); } catch { return false; } // no file yet: nothing to tear
  try {
    const { size } = fstatSync(fd);
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally { closeSync(fd); }
}

/** Append one JSON row as its own line; a torn last line gets its newline first. The parent folder must exist. @param {string} file @param {unknown} row @param {{mode?: number}} [options] e.g. `{ mode: 0o600 }` */
export function appendRow(file, row, options) {
  appendFileSync(file, `${endsTorn(file) ? '\n' : ''}${JSON.stringify(row)}\n`, options);
}

/** M20 am3 item 12: the ONE tolerant JSONL parse: every line of the text that parses, in order; a blank, torn or unparseable line is skipped. @param {string} text @returns {any[]} */
export function parseJsonl(text) {
  return text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/**
 * The ONE reader of a trigger ledger (the files ledger and the schedule ledger): every row on disk that parses, oldest first; a missing file is no rows;
 * a line a crash tore mid-append is skipped (it counts as not written; `appendTriggerLedger` starts each append on a fresh line, so it never glues onto the next row).
 * @param {string} file @param {string} [sig] M9 am20: only the rows of that schedule signing (the one schedule ledger carries every signing's rows); absent = every row
 * @returns {any[]}
 */
export function readTriggerLedger(file, sig) {
  const rows = parseJsonl(ledgerText(file));
  return sig === undefined ? rows : rows.filter((r) => r.sig === sig);
}

/**
 * The ONE appender of a trigger ledger: write-once by id within a signing (a second row with the same id is not written). `sig` is stamped on the row.
 * @param {string} file @param {{id: string, [k: string]: any}} row @param {string} [sig] @param {{throwIfWritten?: boolean}} [o] `throwIfWritten`: a row already on disk is an error, not `false`
 * @returns {boolean} written
 */
export function appendTriggerLedger(file, row, sig, { throwIfWritten = false } = {}) {
  if (readTriggerLedger(file, sig).some((r) => r.id === row.id)) {
    if (throwIfWritten) throw new Error(`ledger row ${row.id} already written`);
    return false;
  }
  mkdirSync(dirname(file), { recursive: true });
  appendRow(file, sig === undefined ? row : { ...row, sig });
  return true;
}
