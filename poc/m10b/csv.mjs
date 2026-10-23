// POC helper (F76): a small correct CSV parser -> bareguard typed table. Not product code.
import { readFileSync } from 'node:fs';

export function parseCsv(text) {
  const recs = []; let rec = [], cell = '', q = false, i = 0;
  const endRec = () => { rec.push(cell); cell = ''; if (!(rec.length === 1 && rec[0] === '')) recs.push(rec); else recs.push(null); rec = []; };
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { q = true; i++; continue; }
    if (c === ',') { rec.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRec(); i++; continue; }
    cell += c; i++;
  }
  if (cell !== '' || rec.length) endRec();
  return recs; // null = blank line (kept so numbering stays the real line number)
}

// rowNumber = the sheet line number; header is row 1.
export function loadTable(path) {
  const recs = parseCsv(readFileSync(path, 'utf8'));
  const header = recs[0];
  const rows = [];
  recs.slice(1).forEach((r, k) => {
    if (r === null) return;
    if (r.length !== header.length) throw new Error(`${path}: row ${k + 2} has ${r.length} cells, header has ${header.length}`);
    rows.push({ rowNumber: k + 2, cells: r });
  });
  return { header, rows };
}
