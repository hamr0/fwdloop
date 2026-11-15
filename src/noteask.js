// borrowed-from: bareloop src/noteask.js@v0.57.0 (c18df406) (NOTE_SYSTEM, the question's wording, decideNote's reading of the typed answer; the call itself is fwd's forced tool turn, src/drafter.js forcedTurn, not bareloop's text reply)
// The note question (M17 am1 1(e)). A facts-only line ("find these on the page") may also ask for written words ("and write a one-sentence note"). Code cannot read that from the line, so the AI is
// asked ONCE per draft, only when a line is facts-only: yes or no per line, typed. CODE decides what it means (src/checkblock.js buildNote: a `$` note row and a countable nonEmpty part, so the step
// is told to write `text`). The AI sees the numbered line text only, never a `~` rule. A call with no usable answer leaves each asked line facts-only with a Not checked row, never a guess.
// What this throws away: everything but yes/no per asked line (a line it was not asked about, any other field).

/** the label of the forced turn, as the draft's log and the replay in src/planrebuild.js see it */
export const NOTE_KIND = 'note-ask';
export const NOTE_TOOL = 'answer_note_question';

export const NOTE_SYSTEM = 'You read the numbered lines of a job. You answer only about what each line says; you never invent words.';

export const NOTE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { line: { type: 'integer', minimum: 1, description: 'the job line number' }, writtenWords: { enum: ['yes', 'no'] } },
        required: ['line', 'writtenWords'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
});

/** What the AI is told: the numbered job lines (text only) and the one question. @param {{n: number, text: string}[]} lines @returns {string} */
export function notePrompt(lines) {
  return `THE JOB:\n${lines.map((l) => `LINE ${l.n}: ${l.text}`).join('\n')}\n\n`
    + 'For EACH line answer ONE question: does the line also ask for written words (a note, a sentence, a paragraph, a summary) beyond the facts found on the page (items, numbers, dates, quoted words)? '
    + 'A line that only asks to list, find or give items with their fields is "no". '
    + `Call ${NOTE_TOOL} once with one entry per line: {"line": <line number>, "writtenWords": "yes" or "no"}. `
    + 'Example: for "LINE 1: List the 3 newest posts with title and date" and "LINE 2: Write a two-sentence recap of the newest post" the entries are line 1 "no" and line 2 "yes".';
}

/**
 * Code reads the typed answer: every asked line answered exactly yes or no, else null (no repair). An answer for a line not asked is unreadable too.
 * @param {any} args the tool's arguments @param {{n: number}[]} lines @returns {Map<number, 'yes'|'no'>|null}
 */
export function decideNote(args, lines) {
  if (args === null || typeof args !== 'object' || !Array.isArray(args.lines)) return null;
  /** @type {Map<number, 'yes'|'no'>} */
  const out = new Map();
  for (const e of args.lines) {
    if (e === null || typeof e !== 'object' || !Number.isInteger(e.line) || (e.writtenWords !== 'yes' && e.writtenWords !== 'no') || !lines.some((l) => l.n === e.line)) return null;
    out.set(e.line, e.writtenWords);
  }
  return lines.every((l) => out.has(l.n)) ? out : null;
}

/**
 * The answers per asked line as the block reads them: the typed answer, or `failed` for every asked line when there is none. ONE function, shared by the draft and the replay.
 * @param {number[]} asked the facts-only lines asked @param {any} args the tool's arguments, or null @param {{n: number}[]} lines
 * @returns {{line: number, answer: 'yes'|'no'|'failed'}[]}
 */
export function noteAnswers(asked, args, lines) {
  const d = args === null ? null : decideNote(args, lines.filter((l) => asked.includes(l.n)));
  return asked.map((n) => ({ line: n, answer: d?.get(n) ?? 'failed' }));
}
