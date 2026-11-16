// F203 prompts, verbatim. The user text lists the job the way the drafter's own listing does (src/checklist.js ledgerUserText: `n. text`, `   gN: rule`).
import { parseJobBox } from '../../src/panel/authorcard.js';

export const RECOGNISE_TOOL = 'record_action';
export const SUGGEST_TOOL = 'suggest_action';

export const RECOGNISE_SYSTEM = `A person wrote a numbered list of steps for a job. The job's finished result must end up in the Destination named below the list.

Your one task: find the step, if there is one, that delivers the finished result to the Destination. A delivering step puts the result into the Destination (it stores, sends or files it there). A step that only reads, makes, lists, checks or asks something is not a delivering step.

Answer by calling the tool ${RECOGNISE_TOOL} exactly once, with the field "action" holding two fields. Both are required.
- line: the number of the delivering step, or null if no step delivers the result.
- reads: the number of the earlier step that makes the result being delivered (a step that makes the result, never a step that asks the person to look). Use null when line is null.`;

export const SUGGEST_SYSTEM = `A person wrote a numbered list of steps for a job. The job's finished result must end up in the Destination named below the list. The list has no step that delivers the result there.

Your one task: suggest ONE new last step that delivers the finished result to the Destination.

Rules:
- Write the step as one short plain sentence, in the person's voice, like their other steps. It must say that the result goes to the Destination.
- Do not repeat or change any existing step. Do not write a step that asks the person a question.
- reads is the number of the existing step that makes the finished result: the last step that makes a result, never a step that asks the person to look.

Answer by calling the tool ${SUGGEST_TOOL} exactly once. Both fields are required: text (the new step) and reads (a step number).`;

export const RECOGNISE_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'object',
      properties: {
        line: { type: ['integer', 'null'], description: 'Number of the step that delivers the result to the Destination, or null if none does.' },
        reads: { type: ['integer', 'null'], description: 'Number of the earlier step that makes the result being delivered; null when line is null.' },
      },
      required: ['line', 'reads'],
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
    reads: { type: 'integer', description: 'Number of the existing step that makes the finished result to deliver.' },
  },
  required: ['text', 'reads'],
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
