// M4d amendment 15: the plain words for a plan-check refusal. ONE copy of them: the Chat list (src/draft-steps.js), the Audit Draft rows
// (src/panel/data.js) and the page (the server hands it the same rules in index.html, see src/panel/server.js) all read this file.
// Moved here from the page's `plainPlanCheck` (M4e am41 item 7), sentences unchanged.
//
// `say` is the whole plain sentence(s). `reason` is its first sentence; `fix` is what follows it, when the sentence says what to do
// (only the two rules whose sentence has a second part). A rule with no second part has NO fix wording: nothing is invented for it.

/** @type {ReadonlyArray<{re: RegExp, say: string|null}>} `say` null = the checker's own sentence, as it is without its "declaration: " prefix */
export const PLAN_CHECK_RULES = Object.freeze([
  { re: /which is not in the job line's words/, say: "A section name in the plan's check is not in your job line. Change the job line to use the section words you want." },
  { re: /the job line says .*; the check says/, say: "The sections in the plan's check come in a different order than your job line. Change the job line to change the order." },
  { re: /the guardrail says \d+ sections; the check has/, say: "The number of sections in your guardrail is not the number in the plan's check." },
  { re: /section name is a short phrase|which is the job line or most of it/, say: "A section name in the plan's check is too long; it must be a short phrase from your job line." },
  { re: /one section name may not contain another/, say: 'One section name in the plan\'s check contains another, which cannot be checked.' },
  { re: /wordsPerSection/, say: "The words for each section in your guardrail and in the plan's check do not match." },
  { re: /work as a pair/, say: "The plan's check has one part of a pair without the other, so it cannot be checked." },
  { re: /is blank|characters; the most one entry|ends in ":"/, say: "A name in the plan's check is empty, too long or ends in a colon, so it cannot be matched." },
  { re: /cannot be built into a check/, say: "The plan's check cannot be built from what the AI wrote." },
  { re: /is not its signed line/, say: 'A step does not use your job line word for word as its goal.' },
  { re: /not in the catalogue|not wired|which is not signed|checkpoint/, say: 'A step uses a tool that is not available for this job.' },
  { re: /reads artifact|is a duplicate|\.reads must|\.emits must/, say: 'The steps do not pass their results to each other in a workable order.' },
  { re: /ask at line \d+|signed ask at line|ask slot/, say: 'The ask on one of your lines is not set up as a plain stop where you decide.' },
  { re: /send at line \d+|signed send at line|send slot/, say: 'The send step is not set up to follow your accept and write only to your destination.' },
  { re: /hitl after the last signed ask/, say: 'A step after your last ask would leave without your seeing it, so it is refused.' },
  { re: /is a pause .* unsigned line/, say: 'A step pauses at a line you did not sign as an ask.' },
  { re: /neither served by any step/, say: 'A line of your job is not covered by any step.' },
  { re: /picks|inputFacts|invented name/, say: 'The plan names a field that is not in your input.' },
  { re: /guardrailClasses|unjudgeable|refused/, say: "The AI's notes on which lines it can check are not in a form the checker accepts." },
  { re: /^line \d+'s (guardrail|check)|can't write files/, say: null },
  { re: /must be an? |is required|must name|does not name/, say: 'The plan the AI wrote is not in the shape the checker needs.' },
]);

export const GENERIC_SAY = 'One of the checks on the plan failed.';

/** The rules as the page takes them: JSON, the regex as its source text. */
export const pageRules = () => PLAN_CHECK_RULES.map((r) => ({ re: r.re.source, say: r.say }));

/**
 * @param {unknown} raw one raw refusal text
 * @returns {{ say: string, reason: string, fix: string|null, raw: string }}
 */
export function plainPlanCheck(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const rule = PLAN_CHECK_RULES.find((r) => r.re.test(text));
  const say = rule === undefined ? GENERIC_SAY : (rule.say === null ? text.replace(/^declaration: /, '') : rule.say);
  const cut = rule?.say == null ? -1 : say.indexOf('. ');
  return cut === -1
    ? { say, reason: say.replace(/\.$/, ''), fix: null, raw: text }
    : { say, reason: say.slice(0, cut), fix: say.slice(cut + 2), raw: text };
}
