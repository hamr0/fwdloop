// M13 am11 rule 3 / am11a: before the action (the job's last line, a signed send) writes or sends, what goes out is compared by sha256 with what the person
// accepted at their last Ask IN THIS RUN. ONE function decides (`decideAction`), the words and the wait live here once.
// Throws away: nothing. Third outcomes: an accept with no recorded sha (null / '') reads as "nothing accepted"; an unreadable outgoing sha reads as unseen.
import { sha256Hex, serializeArtifact } from './ask.js';

export const ACTION_STOP_KIND = 'action-stop';
export const STOP_CHANGED = 'This changed since you accepted it.';
export const STOP_UNSEEN = 'You have not seen this yet.';
/** am11a 1: the card's Ask wait is 1h unless the person changes it; this is the default when nothing else is signed. */
export const DEFAULT_ACTION_WAIT_MS = 3_600_000;

/**
 * @param {{ acceptedSha: string|null|undefined, outgoing: Record<string, any> }} a `acceptedSha` = the sha256 recorded at the last Ask accepted this run; `outgoing` = the artifact about to go out
 * @returns {{ go: true, outgoingSha: string } | { go: false, question: string, outgoingSha: string }}
 */
export function decideAction({ acceptedSha, outgoing }) {
  const outgoingSha = sha256Hex(serializeArtifact(outgoing));
  if (typeof acceptedSha !== 'string' || acceptedSha === '') return { go: false, question: STOP_UNSEEN, outgoingSha };
  return acceptedSha === outgoingSha ? { go: true, outgoingSha } : { go: false, question: STOP_CHANGED, outgoingSha };
}

/**
 * The accept to compare against: the sha of the LAST Ask (by step order) before step `i` that was accepted in this run, or null when there is none.
 * @param {{ emits?: string }[]} steps @param {number} i @param {Map<string, string|null>} acceptedAskEmitsThisRun
 */
export function lastAcceptedSha(steps, i, acceptedAskEmitsThisRun) {
  for (let k = i - 1; k >= 0; k -= 1) {
    const e = steps[k].emits;
    if (typeof e === 'string' && acceptedAskEmitsThisRun.has(e)) return acceptedAskEmitsThisRun.get(e) ?? null;
  }
  return null;
}

/**
 * am11a 1/2: the wait of the stop. The LAST Ask's own wait when the job has an Ask before the action; else the card's Ask wait kept in the run's signed values (`arbiter.actionWaitMs`), else 1h.
 * @param {{ fromLine: number }[]} steps @param {number} i @param {Map<number, {ttlMs: number}>} askLines @param {number|undefined} actionWaitMs
 */
export function stopWaitMs(steps, i, askLines, actionWaitMs) {
  for (let k = i - 1; k >= 0; k -= 1) {
    const ask = askLines.get(steps[k].fromLine);
    if (ask) return ask.ttlMs;
  }
  return Number.isFinite(actionWaitMs) && /** @type {number} */ (actionWaitMs) > 0 ? /** @type {number} */ (actionWaitMs) : DEFAULT_ACTION_WAIT_MS;
}
