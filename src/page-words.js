// M20 am8a item 1: the words the page asks instead of spelling them itself, built from the modules that own the facts (the panel injects the constant like the schedule choices: src/schedule-choices.js).
// The page is a classic script and cannot import; its client-made states (phase "revising" set by the page itself) have no server data to carry a flag, so it asks this list.
import { TAG } from './checkwords.js';
import { REASON_DECISIONS } from './ask.js';
import { REVISE_PHASES, NOT_GREEN_PHASES } from './panel/author.js';

/** @returns {{tags: Record<string,string>, reasonDecisions: string[], reviseRunning: string[], notGreen: string[]}} tags: origin -> tag word; reasonDecisions: the decisions that need a reason; reviseRunning: phases where a revise or redraft runs; notGreen: phases where the draft ended red or stopped */
export const pageWords = () => ({ tags: { ...TAG }, reasonDecisions: [...REASON_DECISIONS], reviseRunning: [...REVISE_PHASES], notGreen: [...NOT_GREEN_PHASES] });
