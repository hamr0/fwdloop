// M19 amendment 13: a job needs at least one `~` rule of the person's. The ONE writer of the refusal words; the ONE count is the drafter's own reader
// (parseSignedText) with the block's own splitter (rulesOfLine). `!` and `$` rows are never in the prose, so only typed `~` lines count.
import { parseSignedText } from './signed-text.js';
import { rulesOfLine } from './sheetblock.js';

export const MIN_RULE_REFUSAL = 'Add at least one rule (~) for this job — for example what the result must include, or what must stay true.';

/**
 * @param {string} prose the job prose `fwdloop draft` reads
 * @returns {string|null} the refusal words, or null when the prose carries at least one `~` rule. Prose the reader cannot parse is not this gate's to refuse (the drafter's own red wins).
 */
export function minRuleRefusal(prose) {
  const p = parseSignedText(prose);
  if (!p.ok) return null;
  return p.lines.reduce((n, l) => n + rulesOfLine(l).length, 0) === 0 ? MIN_RULE_REFUSAL : null;
}
