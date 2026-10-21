// M6a — input facts, read mechanically at $0 (no model scout).
//
// One entry per signed FILE source: `inputFacts[role]` is what the
// declaration carries (the file's headings — markdown `#` lines, or a .docx's
// Title/Heading1..n paragraphs), `info` is the drafter's prompt text. A source
// that cannot be read, or is empty, is a named red — never a silent [].
//
// Throws away: everything but heading text (body, order beyond headings,
// heading level, inline formatting). A .docx with no styled headings gives [].
// Ported from poc/m6a/schema.mjs readInputFacts@867c25b; the docx side now
// lists headings (the POC had [] for docx).

import { readFileSync } from 'node:fs';
import { readDocxText, readDocxHeadings } from './docx.js';
import { isCellsPath } from './closers.js';
import { parseCsv } from './csv.js';

/**
 * @param {Array<{kind?:string, role:string, path:string}>} sources arbiter.sources
 * @param {{pages?: Record<string, {text: string}>}} [o] `pages` (M10 item 1): the drafting copy of each web page input, role -> its frozen text, fetched by the caller. A page
 *   source with no copy here is a named red (never skipped); it adds no heading facts (a page has none), only its line for the drafter and the Chat card.
 * `list` (M4d am10) is one `{role, detail}` per readable input for the Chat card's list (a CSV: its columns; text: its headings); never hashed.
 * `sheets` (M10 piece 5): role -> the text of each CSV input, for the sheet-word look (the same read, not a second one).
 * @returns {{ok:boolean, inputFacts:Record<string,string[]>, info:string[], list:Array<{role:string, detail:string}>, reds:string[], sheets:Record<string,string>}}
 */
export function readInputFacts(sources, { pages = {} } = {}) {
  /** @type {Record<string,string[]>} */
  const inputFacts = {};
  /** @type {Record<string,string>} */
  const sheets = {};
  const info = [];
  const list = [];
  const headingsDetail = (n) => `${n} heading${n === 1 ? '' : 's'}`;
  const reds = [];
  for (const s of sources ?? []) {
    if (s.kind === 'page') {
      const page = pages[s.role];
      if (!page) { reds.push(`input "${s.role}": the web page was not fetched`); continue; }
      list.push({ role: s.role, detail: `a web page, ${page.text.length} characters` });
      info.push(`- ${s.role}: a web page (${s.path}), saved at drafting, ${page.text.length} characters`);
      continue;
    }
    if (s.kind !== 'file') continue;
    if (String(s.path).toLowerCase().endsWith('.docx')) {
      const r = readDocxText(s.path);
      if (!r.ok) { reds.push(`input "${s.role}": ${r.red}`); continue; }
      const h = readDocxHeadings(s.path);
      if (!h.ok) { reds.push(`input "${s.role}": ${h.red}`); continue; }
      const words = r.text.trim() === '' ? 0 : r.text.trim().split(/\s+/).length;
      inputFacts[s.role] = h.headings;
      list.push({ role: s.role, detail: headingsDetail(h.headings.length) });
      info.push(`- ${s.role}: a .docx file, ${r.paragraphs} paragraphs, ~${words} words, headings: ${h.headings.join(', ') || '(none)'} (read it with "readDocx")`);
    } else {
      let raw;
      try { raw = readFileSync(s.path, 'utf8'); } catch (e) { reds.push(`input "${s.role}": cannot read file: ${e.message}`); continue; }
      if (raw.trim() === '') { reds.push(`input "${s.role}": "${s.path}" is empty`); continue; }
      const headings = raw.split(/\r?\n/).filter((l) => /^#{1,6}\s+\S/.test(l)).map((l) => l.replace(/^#{1,6}\s*/, '').trim());
      inputFacts[s.role] = headings;
      if (isCellsPath(s.path)) sheets[s.role] = raw;
      list.push({ role: s.role, detail: isCellsPath(s.path) ? `${parseCsv(raw).header.length} columns` : headingsDetail(headings.length) });
      info.push(isCellsPath(s.path)
        ? `- ${s.role}: a CSV file with cells (a step reads it by listing "${s.role}" in its reads; or with "read")`
        : `- ${s.role}: a text/markdown file, ~${raw.trim().split(/\s+/).length} words, headings: ${headings.join(', ') || '(none)'} (read it with "read")`);
    }
  }
  return { ok: reds.length === 0, inputFacts, info, list, reds, sheets };
}
