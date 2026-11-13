// borrowed-from: bareloop src/triggerledger.js@v0.56.0 (3383cce)
// T Part 1 (docs/product/PANEL-BUILD.md, "T: triggers build spec", C.1 and E.2): the ONE reader and the ONE
// appender of a job's trigger ledger, `<home>/triggers/<job>/ledger.jsonl`. Append-only JSONL, one file for
// every row kind, every row carrying `sig` (the signature hash it was written under).
// Rewritten from fwdloop's trigger-clock.js readRows/appendOnce, with two fixes landed together (T17): a line
// that does not parse (a torn append) is SKIPPED and counted, and an append starts on a fresh line when the
// file does not end in a newline, so a torn line can never glue onto the next row. One half without the other
// is worse than neither: skip-only loses the next good row into the torn line, fresh-line-only throws on read.
import {
  appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** @typedef {{id?: string, kind: string, sig?: string, at?: number, [k: string]: unknown}} LedgerRow */

/**
 * Every row that parses, oldest first, and how many lines did not. A missing file is no rows.
 * @param {string} file
 * @returns {{rows: LedgerRow[], skipped: number}}
 */
export function readLedger(file) {
  if (!existsSync(file)) return { rows: [], skipped: 0 };
  const rows = [];
  let skipped = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { skipped++; continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { skipped++; continue; }
    rows.push(row);
  }
  return { rows, skipped };
}

/** @param {string} file @returns {boolean} the file is non-empty and its last byte is not a newline (a torn tail). */
function endsTorn(file) {
  if (!existsSync(file)) return false;
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } finally { closeSync(fd); }
}

/**
 * Append one row (dir 0700, file 0600). A torn tail gets a newline first. `once` refuses a row whose `id` is
 * already on disk (write-once ids), by throwing.
 * @param {string} file
 * @param {LedgerRow} row
 * @param {{once?: boolean}} [opts]
 */
export function appendRow(file, row, opts = {}) {
  if (opts.once) {
    if (row.id === undefined) throw new Error('a write-once ledger row needs an id');
    if (withoutReleased(readLedger(file).rows).some((r) => r.id === row.id)) throw new Error(`ledger row ${row.id} already written`);
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lead = endsTorn(file) ? '\n' : '';
  appendFileSync(file, `${lead}${JSON.stringify(row)}\n`, { mode: 0o600 });
}

/**
 * Walk the rows in order: a `released` row (`of` = an id) cancels the latest earlier live row with that id, and
 * is itself dropped. A released `fire` or `ran` is not consumed, so its slot or file is retryable (Part 4) and
 * the same id may be written again.
 * @param {LedgerRow[]} rows
 * @returns {LedgerRow[]}
 */
export function withoutReleased(rows) {
  /** @type {LedgerRow[]} */
  const live = [];
  for (const r of rows) {
    if (r.kind !== 'released') { live.push(r); continue; }
    for (let i = live.length - 1; i >= 0; i--) if (live[i].id === r.of) { live.splice(i, 1); break; }
  }
  return live;
}
