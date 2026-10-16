// The ONE fresh-line rule for every append-only JSONL file (books, trigger ledgers, triggers.jsonl): a crash can tear the last line mid-append, and the
// next row must not glue onto those bytes (the glued line would fail to parse, be skipped, and the row would be lost). Readers skip an unparseable line;
// this is its other half, and the two only work together.
import {
  appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync,
} from 'node:fs';

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
