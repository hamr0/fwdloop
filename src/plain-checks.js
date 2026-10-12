// M4d amendment 15: the plain words for a plan-check refusal. ONE copy of them: the Chat list (src/draft-steps.js), the Audit Draft rows
// (src/panel/data.js) and the page (the server hands it the same rules in index.html, see src/panel/server.js) all read this file.
// Moved here from the page's `plainPlanCheck` (M4e am41 item 7), sentences unchanged.
//
// `say` is the plain sentence(s) the page's revise lines show. `reason` is `say` without its fix. `fix` is the one short sentence that tells the human what to
// change (the job line, the guardrail, the inputs, the destination) or to Draft again when it is the AI's own form error; every rule has one (am15 item 3).
// The first two rules' `say` already ends with their fix, as the page has always shown them.

/** @type {ReadonlyArray<{re: RegExp, say: string|null, fix: string}>} `say` null = the checker's own sentence, as it is without its "declaration: " prefix */
export const PLAN_CHECK_RULES = Object.freeze([
  { re: /which is not in the job line's words/, say: "A section name in the plan's check is not in your job line. Change the job line to use the section words you want.", fix: 'Change the job line to use the section words you want.' },
  { re: /the job line says .*; the check says/, say: "The sections in the plan's check come in a different order than your job line. Change the job line to change the order.", fix: 'Change the job line to change the order.' },
  { re: /the guardrail says \d+ sections; the check has/, say: "The number of sections in your guardrail is not the number in the plan's check.", fix: 'Make the guardrail and the job line say the same number of sections, then Draft again.' },
  { re: /section name is a short phrase|which is the job line or most of it/, say: "A section name in the plan's check is too long; it must be a short phrase from your job line.", fix: 'Use a short phrase from your job line for each section, then Draft again.' },
  { re: /one section name may not contain another/, say: 'One section name in the plan\'s check contains another, which cannot be checked.', fix: 'Rename the sections in your job line so none contains another, then Draft again.' },
  { re: /wordsPerSection/, say: "The words for each section in your guardrail and in the plan's check do not match.", fix: 'Give each section one clear number of words in your guardrail, then Draft again.' },
  { re: /work as a pair/, say: "The plan's check has one part of a pair without the other, so it cannot be checked.", fix: 'Draft again; if it repeats, simplify the guardrail on that line.' },
  { re: /is blank|characters; the most one entry|ends in ":"/, say: "A name in the plan's check is empty, too long or ends in a colon, so it cannot be matched.", fix: 'Shorten the section names in your job line, then Draft again.' },
  { re: /cannot be built into a check/, say: "The plan's check cannot be built from what the AI wrote.", fix: 'Draft again; if it repeats, simplify the guardrail on that line.' },
  { re: /is not its signed line/, say: 'A step does not use your job line word for word as its goal.', fix: 'Draft again.' },
  { re: /not in the catalogue|not wired|which is not signed|checkpoint/, say: 'A step uses a tool that is not available for this job.', fix: 'Draft again; if it repeats, say in the job line what that step should do.' },
  { re: /reads artifact|is a duplicate|\.reads must|\.emits must/, say: 'The steps do not pass their results to each other in a workable order.', fix: 'Draft again.' },
  { re: /ask at line \d+|signed ask at line|ask slot/, say: 'The ask on one of your lines is not set up as a plain stop where you decide.', fix: 'Check the line that starts with Ask in your job, then Draft again.' },
  { re: /send at line \d+|signed send at line|send slot/, say: 'The send step is not set up to follow your accept and write only to your destination.', fix: 'Check the Destination on the card, then Draft again.' },
  { re: /hitl after the last signed ask/, say: 'A step after your last ask would leave without your seeing it, so it is refused.', fix: 'Move the lines you want to check before your last Ask line, then Draft again.' },
  { re: /is a pause .* unsigned line/, say: 'A step pauses at a line you did not sign as an ask.', fix: 'Mark the line you want to stop at with Ask, then Draft again.' },
  { re: /neither served by any step/, say: 'A line of your job is not covered by any step.', fix: 'Make every line of your job say one thing to do, then Draft again.' },
  { re: /picks|inputFacts|invented name/, say: 'The plan names a field that is not in your input.', fix: 'Check the names in your Inputs and job line, then Draft again.' },
  { re: /guardrailClasses|unjudgeable|refused/, say: "The AI's notes on which lines it can check are not in a form the checker accepts.", fix: 'Draft again.' },
  { re: /^line \d+'s (guardrail|check)|can't write files/, say: null, fix: 'Change the guardrail on that line the way the sentence says, then Draft again.' },
  { re: /must be an? |is required|must name|does not name/, say: 'The plan the AI wrote is not in the shape the checker needs.', fix: 'Draft again.' },
]);

export const GENERIC_SAY = 'One of the checks on the plan failed.';
export const GENERIC_FIX = 'Draft again.';

/** The rules as the page takes them: JSON, the regex as its source text. */
export const pageRules = () => PLAN_CHECK_RULES.map((r) => ({ re: r.re.source, say: r.say }));

/**
 * @param {unknown} raw one raw refusal text
 * @returns {{ say: string, reason: string, fix: string, raw: string }}
 */
export function plainPlanCheck(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const rule = PLAN_CHECK_RULES.find((r) => r.re.test(text));
  const say = rule === undefined ? GENERIC_SAY : (rule.say === null ? text.replace(/^declaration: /, '') : rule.say);
  const fix = rule === undefined ? GENERIC_FIX : rule.fix;
  const reason = (say.endsWith(fix) ? say.slice(0, -fix.length) : say).trim().replace(/\.$/, '');
  return { say, reason, fix, raw: text };
}
