// M10 amendment 16: the ONE place a picked check is put in plain words (one fixed phrase per bareguard rule, written by code). The ask, the `~` line an agree writes,
// the plan card (src/checked.js), the softgreen close's check list (src/closers.js) and the Audit all read it; nothing else writes these words.
/** the rules of bareguard's list a person may pick here (text rules only: the ones a plain answer can be judged by) */
export const OFFERED = Object.freeze(['nonEmpty', 'maxWords', 'minWords', 'maxLines', 'listItems', 'sections', 'sectionOrder', 'sectionWords', 'mustCarry', 'blockLines']);
const listOf = (/** @type {string[]} */ xs) => xs.join(', ');
/**
 * The check in plain words, one fixed phrase per rule: the ask, the `~` line an agree writes, the plan card and the Audit all read this one function.
 * @param {{rule: string, value?: number, size?: number, wordsPerSection?: number, names?: string[], phrases?: string[]}} c @returns {string}
 */
export function plainWords(c) {
  switch (c.rule) {
    case 'nonEmpty': return 'the answer is not empty';
    case 'maxWords': return `at most ${c.value} words`;
    case 'minWords': return `at least ${c.value} words`;
    case 'maxLines': return `at most ${c.value} lines`;
    case 'listItems': return `exactly ${c.value} list items`;
    case 'sections': return `sections named ${listOf(c.names ?? [])}`;
    case 'sectionOrder': return `sections named ${listOf(c.names ?? [])}, in that order`;
    case 'sectionWords': return `sections named ${listOf(c.names ?? [])}, each about ${c.wordsPerSection} words`;
    case 'mustCarry': return `the answer carries ${listOf(c.phrases ?? [])}`;
    case 'blockLines': return `blocks of ${c.size} lines, each carrying ${listOf(c.phrases ?? [])}`;
    default: return `a ${c.rule} check`;
  }
}
