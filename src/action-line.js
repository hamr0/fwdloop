// M13 am11 rules 1 and 2: the job's last line is the action. ONE module for the two AI questions (prompts verbatim from poc/f204-action-ai/prompts.mjs, F204),
// the checks code makes on each answer, and the one function that takes the tentative send out of a prose file.
// The AI answers one question ("is there a last step that writes or sends everything that came before it?"); code checks the answer is the LAST line and not an Ask.
// The AI suggests one line when there is none; code keeps one plain line or nothing. The AI never writes a destination: the send target is typed data in the signed arbiter.
// Throws away: whatever else the answer carried (only `action.line` / `text` are read). Third outcomes: a line that is not the last, an Ask, a non-integer, text with a
// newline or empty -> "no action" / "no suggestion" (never a guess).

export const RECOGNISE_TOOL = 'record_action';
export const SUGGEST_TOOL = 'suggest_action';
export const MAX_SUGGESTION_CHARS = 300;

export const RECOGNISE_SYSTEM = `A person wrote a numbered list of steps for a job. The finished result goes to the Destination named below the list.

Is there a last step that writes or sends everything that came before it? Answer with that step's number, or null if there is none.

A step that only reads, makes, lists, checks or asks something is not one. The step does not have to name the Destination: the Destination is only where the result goes.

Answer by calling the tool ${RECOGNISE_TOOL} exactly once, with the field "action" holding one required field: line (the step's number, or null).`;

export const SUGGEST_SYSTEM = `A person wrote a numbered list of steps for a job. The finished result goes to the Destination named below the list. The list has no last step that writes or sends everything that came before it.

Your one task: suggest ONE last step that writes or sends everything that came before it to the Destination.

Rules:
- Write the step as one short plain sentence, in the person's voice, like their other steps. It must say that the result is written or sent to the Destination.
- Do not repeat or change any existing step. Do not write a step that asks the person a question.

Answer by calling the tool ${SUGGEST_TOOL} exactly once. The one required field is text (the new step).`;

export const RECOGNISE_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'object',
      properties: {
        line: { type: ['integer', 'null'], description: 'Number of the last step that writes or sends everything that came before it, or null if there is none.' },
      },
      required: ['line'],
      additionalProperties: false,
    },
  },
  required: ['action'],
  additionalProperties: false,
};

export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'The one new last step, one short plain sentence.' },
  },
  required: ['text'],
  additionalProperties: false,
};

/**
 * The job as the model sees it (F204's listing): `n. text`, `   gN: rule` per `; ` part, then the Destination.
 * @param {{n: number, text: string, guardrail?: string}[]} lines `parseSignedText`'s lines @param {Set<number>} askLines @param {string} destination
 */
export function jobListing(lines, askLines, destination) {
  const out = ['The job:'];
  for (const l of lines) {
    out.push(`${l.n}. ${askLines.has(l.n) ? `Ask: ${l.text}` : l.text}`);
    const rules = typeof l.guardrail === 'string' && l.guardrail !== '' ? l.guardrail.split('; ') : [];
    rules.forEach((g, i) => out.push(`   g${i + 1}: ${g}`));
  }
  out.push('', `Destination: folder ${destination}`);
  return out.join('\n');
}

/**
 * Code's check of the recognise answer: the action is the LAST line (and not an Ask) or there is none.
 * @param {any} args the tool call's arguments @param {number} lastLine @param {boolean} lastIsAsk
 * @returns {boolean} true = the last line is the action
 */
export function recognisedIsLast(args, lastLine, lastIsAsk) {
  const line = args && typeof args === 'object' ? args.action?.line : undefined;
  return Number.isInteger(line) && line === lastLine && !lastIsAsk;
}

/**
 * Code's check of the suggestion: one plain line, not empty, not long, no control characters. Anything else is no suggestion.
 * @param {any} args @returns {string|null}
 */
export function cleanSuggestion(args) {
  const t = args && typeof args === 'object' && typeof args.text === 'string' ? args.text.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (t === '' || t.length > MAX_SUGGESTION_CHARS || /[\x00-\x1F\x7F]/.test(t)) return null;
  return t;
}

/** The asked question's words (signed, M13 am11 rule 2). @param {string} line */
export const suggestionQuestion = (line) => `Your job has no last step that writes it out. I suggest: "${line}". `;

/**
 * The prose file without its (tentative) send line: the one writer of "this job has no write". Only the arbiter's `send at line <n> to ...` line is removed.
 * @param {string} proseText
 */
export function withoutSend(proseText) {
  return proseText.split('\n').filter((l) => !/^guardrail: send at line \d+ to /.test(l)).join('\n');
}
