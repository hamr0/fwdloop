// The "declared shape" softgreen check for a text artifact against a
// word-cap + ordered-sections declaration (M0b Job #2, ladder ~108-119).
//
// hamr's ruling (docs/wiki/the-module-ladder.md ~147-149, F25): "no code
// checks a step's declared close.shape" — `close.mjs`'s `closeShape` checks
// that OUTPUT OBJECT FIELDS are present, never a text artifact's own words
// or headings. This is a different, non-colliding check: it reads the
// artifact's TEXT and verifies a word cap plus that a declared list of
// section headings appears, in order, as their own lines. $0, no model
// calls, every step that declares this shape (PRD §5 tier 1: shape).
//
// What this check IGNORES (declares what it throws away, per project rule):
//   - formatting inside a section (markdown emphasis, lists, tables, links)
//   - content quality / correctness of what a section says (that is a
//     separate hitl close, never this one — F25's whole point)
//   - blank lines, indentation, trailing whitespace
//   - any heading text that appears mid-sentence rather than as its own line
//   - extra headings not in the declared list (not flagged; only declared
//     headings are checked for presence/order)
//
// Reading chosen where the task brief was silent: a "word" is a
// whitespace-separated token AFTER stripping leading markdown heading
// markers (`#`+) from each line, so heading marker characters never count
// toward the cap; a heading LINE itself still contributes its remaining
// words to the count (Job #2's brief caps the whole summary, not prose
// alone). A heading match strips leading `#`s and trailing `:`/whitespace,
// then compares case-insensitively to the declared heading text.

/**
 * @param {unknown} text - candidate artifact text
 * @param {{ maxWords: number, sections: string[] }} declared
 * @returns {{verdict:'green', reds:[]}|{verdict:'red', red:string, reds:string[]}|{verdict:'unparseable', red:string}}
 */
export function closeWordsAndSections(text, { maxWords, sections }) {
  if (typeof text !== 'string') {
    return { verdict: 'unparseable', red: `expected string text, got ${text === null ? 'null' : typeof text}` };
  }

  const lines = text.split(/\r?\n/);
  const reds = [];

  // Word count: strip a line's leading heading markers before splitting on
  // whitespace, so "# Story of experience" costs 3 words, not 4.
  let wordCount = 0;
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '');
    const words = stripped.split(/\s+/).filter((w) => w.length > 0);
    wordCount += words.length;
  }
  if (wordCount > maxWords) {
    reds.push(`${wordCount} words, limit ${maxWords}`);
  }

  // Section order: each declared heading must appear as a line that IS that
  // heading (case-insensitive; optional leading #s; optional trailing ':'),
  // in the declared order. A heading occurring mid-sentence does not count
  // — only a line that, once trimmed of markers, equals the heading text.
  // F38: every failing section is reported (not just the first), so a step
  // that is both over the word cap and missing a heading hears both.
  const headingLines = lines
    .map((line) => line.replace(/^#+\s*/, '').replace(/:\s*$/, '').trim().toLowerCase())
    .filter((l) => l.length > 0);

  let searchFrom = 0;
  for (const section of sections) {
    const want = section.trim().toLowerCase();
    const foundAt = headingLines.indexOf(want, searchFrom);
    if (foundAt === -1) {
      // Distinguish "missing entirely" from "present but out of order":
      // if it appears anywhere earlier than searchFrom, it's an order
      // violation; otherwise it's simply missing.
      const anywhere = headingLines.indexOf(want);
      if (anywhere === -1) {
        // F38: names the FORM of a heading, not just the text, so a
        // paraphrased/bolded/numbered line is told what shape is wanted.
        reds.push(`no line is exactly the heading "${section}" (a heading is a line that is only that text, optionally after #)`);
      } else {
        reds.push(`section heading "${section}" is out of order`);
      }
      // Don't advance searchFrom on a failing section — the next declared
      // heading is still checked against the same pointer.
    } else {
      searchFrom = foundAt + 1;
    }
  }

  if (reds.length > 0) {
    return { verdict: 'red', red: reds.join('; '), reds };
  }

  return { verdict: 'green', reds: [] };
}
