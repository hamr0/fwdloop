// borrowed-from: fwdloop poc/m0/csv.mjs@76a3607 (the first reader; M10b item 2 rewrote it to RFC 4180 quoting). Tiny CSV
// parser (dependency hierarchy: stdlib/vanilla first). The addressable
// -cells contract (`parseCellRef`/`colLetter`) is fwdloop's own citation
// grammar (F13, ruled 2026-09-09 — not a baresuite primitive), so it lives
// with the reader that produces those addresses.

/** Column letter for a 0-based column index: 0 -> 'A', 1 -> 'B', ... */
export function colLetter(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Column index (0-based) for a column letter: 'A' -> 0, 'B' -> 1, ... */
export function colIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parse a cell ref like "E2" into { col: 'E', row: 2 }. */
export function parseCellRef(cell) {
  const m = /^([A-Z]+)(\d+)$/.exec(cell);
  if (!m) throw new Error(`bad cell ref "${cell}"`);
  return { col: m[1], row: Number(m[2]) };
}

/**
 * Split CSV text into records (RFC 4180): a cell may be quoted ("1,200.50" is one cell, "" inside quotes is one quote, a comma or a line break inside quotes
 * stays in the cell); LF and CRLF both end a record. Each record carries `line`, the 1-based line of the text it starts on, so a line break inside a quoted
 * cell still counts. A blank line (nothing, not even quotes) is no record, but its line is counted. A quote inside an unquoted cell is just a character.
 * @param {string} text @returns {{line: number, fields: string[]}[]}
 */
function records(text) {
  /** @type {{line: number, fields: string[]}[]} */
  const out = [];
  let line = 1;
  let startLine = 1;
  /** @type {string[]} */ let fields = [];
  let cell = '';
  let inQuotes = false;
  let quoted = false; // the current record used a quote: an empty cell then is a real cell, not a blank line
  const endCell = () => { fields.push(cell); cell = ''; };
  const endRecord = () => {
    endCell();
    if (!(fields.length === 1 && fields[0] === '' && !quoted)) out.push({ line: startLine, fields });
    fields = [];
    quoted = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') { inQuotes = true; quoted = true; }
    else if (ch === ',') endCell();
    else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      if (ch === '\r') i += 1;
      endRecord();
      line += 1;
      startLine = line;
    } else cell += ch;
  }
  if (cell !== '' || fields.length > 0 || quoted) endRecord();
  return out;
}

/**
 * Parse CSV text into { header, rows } (RFC 4180 quoting, see `records`).
 * `rows[i]` is `{ rowNumber, cells: { A: '...', B: '...' }, byName: { Customer: '...' } }`
 * where `rowNumber` is the real sheet line the row starts on (header is row 1; a blank line is skipped but still counted, so it never shifts the rows below).
 */
export function parseCsv(text) {
  const recs = records(text);
  if (recs.length === 0) return { header: [], rows: [] };
  const header = recs[0].fields;
  const rows = [];
  for (let i = 1; i < recs.length; i += 1) {
    const fields = recs[i].fields;
    const cells = {};
    const byName = {};
    header.forEach((name, col) => {
      const letter = colLetter(col);
      const val = fields[col] ?? '';
      cells[letter] = val;
      byName[name] = val;
    });
    rows.push({ rowNumber: recs[i].line, cells, byName });
  }
  return { header, rows };
}

/**
 * A parsed sheet as bareguard's table shape: `{ header: string[], rows: [{ rowNumber, cells: string[] }] }`. Cells are in header order (a short row is
 * padded with '', a cell past the header is left out), header strings exactly as the file has them. The one writer of this shape (M10b item 2).
 * @param {{header: string[], rows: {rowNumber: number, cells: Record<string, string>}[]}} sheet from `parseCsv`
 * @returns {{header: string[], rows: {rowNumber: number, cells: string[]}[]}}
 */
export function sheetTable(sheet) {
  return {
    header: [...sheet.header],
    rows: sheet.rows.map((r) => ({ rowNumber: r.rowNumber, cells: sheet.header.map((_, col) => r.cells[colLetter(col)]) })),
  };
}
