// M13 am8: the end of a job is added by code, never typed. ONE writer of the added lines (`addEnd`), ONE reader that finds them again in a plan (`addedLinesOf`).
// Given the card's parsed job steps and its Destination: no Destination -> nothing added; the last line not an Ask -> `ask <wait>: check the result with me`
// then `write it out`; the last line an Ask -> only `write it out`. The send is always the added `write it out`. The wait is the card's Ask wait (the
// caller's `jobFileLines` writes it out, as it does for any ask line with no wait of its own).
// Throws away: nothing. Third outcomes: an empty job adds nothing (the card refuses an empty job before this runs).

export const ADDED_ASK_QUESTION = 'check the result with me';
export const ADDED_WRITE = 'write it out';

/**
 * @param {{ n: number, text: string, ask: null | { wait: string|null, question: string }, guardrails: string[] }[]} steps `parseJobBox` steps
 * @param {string} destination the card's Destination ('' = none)
 * @returns {{ steps: typeof steps, added: number[] }} the steps with the end added, and the numbers of the added lines
 */
export function addEnd(steps, destination) {
  if (destination === '' || steps.length === 0) return { steps, added: [] };
  const out = [...steps];
  /** @type {number[]} */
  const added = [];
  if (out[out.length - 1].ask === null) {
    const n = out.length + 1;
    out.push({ n, text: `ask: ${ADDED_ASK_QUESTION}`, ask: { wait: null, question: ADDED_ASK_QUESTION }, guardrails: [] });
    added.push(n);
  }
  const n = out.length + 1;
  out.push({ n, text: ADDED_WRITE, ask: null, guardrails: [] });
  added.push(n);
  return { steps: out, added };
}

/**
 * The added lines of a plan, found again from its signed lines and arbiter: the send line when it reads `write it out`, and the Ask just before it
 * when that reads `check the result with me`. A job signed before M13 am8 (its send line is the person's own words) finds none.
 * @param {{ n: number, text: string }[]} lines @param {{ sends?: { line: number }[], asks?: { line: number }[] }} arbiter
 * @returns {Set<number>}
 */
export function addedLinesOf(lines, arbiter) {
  const found = new Set();
  const send = (arbiter?.sends ?? [])[0];
  if (!send) return found;
  const textOf = (/** @type {number} */ n) => lines.find((l) => l.n === n)?.text;
  if (textOf(send.line) !== ADDED_WRITE) return found;
  found.add(send.line);
  if (textOf(send.line - 1) === ADDED_ASK_QUESTION && (arbiter.asks ?? []).some((a) => a.line === send.line - 1)) found.add(send.line - 1);
  return found;
}

/**
 * The lines a person typed, found again from a signed job: the signed lines without the send line (the last line when it is the send; today's `write it out`, or
 * the person's own words in a job signed before am8) and without an added Ask before it. ONE reader for the Edit card (`cardFromSigned`) and the job identity (`jobKeyOfSigned`).
 * @template {{ n: number, text: string }} L
 * @param {L[]} lines @param {{ sends?: { line: number }[], asks?: { line: number }[] }} arbiter
 * @returns {L[]}
 */
export function typedLinesOf(lines, arbiter) {
  const sends = arbiter?.sends ?? [];
  const lastSend = sends.length === 1 && sends[0].line === lines.length ? sends[0].line : null;
  const added = addedLinesOf(lines, arbiter);
  return lines.filter((l) => l.n !== lastSend && !added.has(l.n));
}
