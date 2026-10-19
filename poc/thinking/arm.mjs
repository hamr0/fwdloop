// POC (throwaway, never shipped): the ONE place the three thinking arms are defined.
//   today : send no thinkingMode at all (what src/model-step.js does now)
//   on    : 'on' on every step call
//   retry : attempt 1 -> 'off'; attempt 2+ -> 'on'. A step redone after a human Redo at an ask is attempt >= 2
//           by the runner's own numbering (attempt = attemptOffset + n, attemptOffset = redone count), so 'on'.
export const ARMS = Object.freeze(['today', 'on', 'retry']);

/**
 * @param {string} arm @param {number|undefined} attempt the runner's attempt number (1-based)
 * @returns {'on'|'off'|undefined} undefined = send no thinkingMode key at all
 */
export function thinkingModeFor(arm, attempt) {
  if (arm === 'today') return undefined;
  if (arm === 'on') return 'on';
  if (arm === 'retry') return (Number.isInteger(attempt) && attempt >= 2) ? 'on' : 'off';
  throw new Error(`unknown arm "${arm}" (expected ${ARMS.join(' | ')})`);
}
