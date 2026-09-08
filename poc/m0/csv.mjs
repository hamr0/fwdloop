// Tiny CSV parser for M0. The fixture (fixtures/ar-aging.csv) has no quoted fields,
// so this stays a plain split — <40 lines per the task brief. Never a general CSV
// library: PRD dependency hierarchy says stdlib/vanilla first, and this fixture
// doesn't need one.

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

/**
 * Parse CSV text with no quoted fields into { header, rows }.
 * `rows[i]` is `{ rowNumber, cells: { A: '...', B: '...' }, byName: { Customer: '...' } }`
 * where `rowNumber` is the 1-based sheet row (header is row 1, first data row is row 2).
 */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const fields = lines[i].split(',');
    const cells = {};
    const byName = {};
    header.forEach((name, col) => {
      const letter = colLetter(col);
      const val = fields[col] ?? '';
      cells[letter] = val;
      byName[name] = val;
    });
    rows.push({ rowNumber: i + 1, cells, byName });
  }
  return { header, rows };
}
