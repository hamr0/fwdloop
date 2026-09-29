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

/**
 * @param {Array<{kind?:string, role:string, path:string}>} sources arbiter.sources
 * @returns {{ok:boolean, inputFacts:Record<string,string[]>, info:string[], reds:string[]}}
 */
export function readInputFacts(sources) {
  /** @type {Record<string,string[]>} */
  const inputFacts = {};
  const info = [];
  const reds = [];
  for (const s of sources ?? []) {
    if (s.kind !== 'file') continue;
    if (String(s.path).toLowerCase().endsWith('.docx')) {
      const r = readDocxText(s.path);
      if (!r.ok) { reds.push(`input "${s.role}": ${r.red}`); continue; }
      const h = readDocxHeadings(s.path);
      if (!h.ok) { reds.push(`input "${s.role}": ${h.red}`); continue; }
      const words = r.text.trim() === '' ? 0 : r.text.trim().split(/\s+/).length;
      inputFacts[s.role] = h.headings;
      info.push(`- ${s.role}: a .docx file, ${r.paragraphs} paragraphs, ~${words} words, headings: ${h.headings.join(', ') || '(none)'} (read it with "readDocx")`);
    } else {
      let raw;
      try { raw = readFileSync(s.path, 'utf8'); } catch (e) { reds.push(`input "${s.role}": cannot read file: ${e.message}`); continue; }
      if (raw.trim() === '') { reds.push(`input "${s.role}": "${s.path}" is empty`); continue; }
      const headings = raw.split(/\r?\n/).filter((l) => /^#{1,6}\s+\S/.test(l)).map((l) => l.replace(/^#{1,6}\s*/, '').trim());
      inputFacts[s.role] = headings;
      info.push(`- ${s.role}: a text/markdown file, ~${raw.trim().split(/\s+/).length} words, headings: ${headings.join(', ') || '(none)'} (read it with "read")`);
    }
  }
  return { ok: reds.length === 0, inputFacts, info, reds };
}
