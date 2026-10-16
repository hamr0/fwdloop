// borrowed-from: bareloop src/job.js@HEAD (workflowKey: the identity of a workflow is the spec WITHOUT the fields a reuse may change).
// M6 am5/am6: the JOB's identity. A job is its steps in order: each step's text (an ask carries its question), whether it is an ask, and its
// guardrail. Run fields (cap, destination, input paths, ask waits, trigger, model) are not in it, so changing one never makes a new workflow.
// What this throws away: the ask wait, spacing/blank lines/case of the `Ask` mark, and everything outside the job lines. NOT a signature.
// TWO producers, ONE canonical form: the signed flow (parseSignedText's lines + arbiter) and the card's job box (parseJobBox).
import { createHash } from 'node:crypto';

import { joinGuardrails, parseJobBox } from './panel/authorcard.js';

/** @param {{ask: boolean, text: string, guardrail: string}[]} steps */
function keyOf(steps) {
  return createHash('sha256').update(`job-key-v1\n${JSON.stringify(steps)}`).digest('hex');
}

/** The key of the job as the card's job box types it. @param {string} job */
export function jobKeyOfCard(job) {
  const { steps } = parseJobBox(String(job));
  return keyOf(steps.map((s) => ({ ask: s.ask !== null, text: s.ask ? s.ask.question.trim() : s.text.trim(), guardrail: joinGuardrails(s.guardrails) })));
}

/** The key of a signed job. @param {{ lines: {n: number, text: string, guardrail: string}[], arbiter: any }} signed `parseSignedText`'s ok result */
export function jobKeyOfSigned({ lines, arbiter }) {
  const asks = new Set((arbiter.asks ?? []).map((a) => a.line));
  return keyOf(lines.map((l) => ({ ask: asks.has(l.n), text: String(l.text).trim(), guardrail: String(l.guardrail ?? '').trim() })));
}
