// F204 prompts, verbatim. The user text lists the job the way the drafter's own listing does (src/checklist.js ledgerUserText: `n. text`, `   gN: rule`).
import { parseJobBox } from '../../src/panel/authorcard.js';

export const RECOGNISE_TOOL = 'record_action';
export const SUGGEST_TOOL = 'suggest_action';

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
        line: { type: ['integer', 'null'], description: "Number of the last step that writes or sends everything that came before it, or null if there is none." },
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

/** the job as the model sees it, plus the step numbers code checks against */
export function jobView(job, destination) {
  const { steps } = parseJobBox(job);
  const out = ['The job:'];
  for (const s of steps) {
    out.push(`${s.n}. ${s.text}`);
    s.guardrails.forEach((g, i) => out.push(`   g${i + 1}: ${g}`));
  }
  out.push('', `Destination: folder ${destination}`);
  return { text: out.join('\n'), count: steps.length, askLines: steps.filter((s) => s.ask).map((s) => s.n) };
}
