// borrowed-from: bareloop src/csv.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/csv.js@v0.35.0 (M10b item 2: RFC 4180 quoting). A tiny CSV parser (dependency hierarchy: stdlib/vanilla first). The cell-letter addresses
// (colLetter / colIndex / parseCellRef) were fwdloop's own citation grammar and are retired here (docs/product/ITEM33-BUILD.md "Addendum 2026-11-17", S1): a row is read
// by header name (`byName`) or exactly as the file has it (`raw`).

/**
 * Split CSV text into records (RFC 4180): a cell may be quoted ("1,200.50" is one cell, "" inside quotes is one quote, a comma or a line break inside quotes
 * stays in the cell); LF and CRLF both end a record. Each record carries `line`, the 1-based line of the text it starts on, so a line break inside a quoted
 * cell still counts. A leading byte-order mark is dropped. A blank line (nothing, not even quotes) is no record, but its line is counted. A quote inside an unquoted cell is just a character.
 * @param {string} text @returns {{line: number, fields: string[]}[]}
 */
function records(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // Excel "CSV UTF-8" starts with a byte-order mark; it is not part of the first cell (the one place it is dropped)
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
 * `rows[i]` is `{ rowNumber, byName: { Customer: '...' }, raw: ['...', '...'] }` (`raw` is the row's cells exactly as the file has them: no padding, nothing cut)
 * where `rowNumber` is the real sheet line the row starts on (header is row 1; a blank line is skipped but still counted, so it never shifts the rows below).
 */
export function parseCsv(text) {
  const recs = records(text);
  if (recs.length === 0) return { header: [], rows: [] };
  const header = recs[0].fields;
  const rows = [];
  for (let i = 1; i < recs.length; i += 1) {
    const fields = recs[i].fields;
    /** @type {Record<string, string>} */
    const byName = {};
    header.forEach((name, col) => { byName[name] = fields[col] ?? ''; });
    rows.push({ rowNumber: recs[i].line, byName, raw: [...fields] });
  }
  return { header, rows };
}

/**
 * A parsed sheet as bareguard's table shape: `{ header: string[], rows: [{ rowNumber, cells: string[] }] }`. Each row's cells are the row exactly as the file
 * has it (`raw`): a short or a long row is NOT padded or cut here, so bareguard itself stops it (`tableSha` gives null for a ragged row, and the table is
 * refused). The header strings are exactly as the file has them. The one writer of this shape (M10b item 2).
 * @param {{header: string[], rows: {rowNumber: number, raw: string[]}[]}} sheet from `parseCsv`
 * @returns {{header: string[], rows: {rowNumber: number, cells: string[]}[]}}
 */
export function sheetTable(sheet) {
  return {
    header: [...sheet.header],
    rows: sheet.rows.map((r) => ({ rowNumber: r.rowNumber, cells: [...r.raw] })),
  };
}
