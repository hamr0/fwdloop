// borrowed-from: bareloop src/ticketfilter.js@v0.56.0 (3383cce)
// MCP + tickets piece 2 (R5): the ONE reader of "is this a legal ticketFilter", and the ONE place its legal example and drafter words live.
// Both doors read it: the signed spec (`validateJob`, src/job.js) and the drafter's proposal (`authorClose`, src/authorflow.js). The drafter is told this rule
// and shown a legal example in the same words the red carries (a validator rule the drafter is not told about fails every draft).

/** a legal filter, as the drafter is shown it: used in the prompt AND in every red's detail */
export const TICKET_FILTER_EXAMPLE = '{"priority": ["P1"], "labels": ["bug"]}';

/**
 * @param {unknown} f the filter @param {{hasMcp?: boolean}} [o] `hasMcp: false` adds the "belongs to a job with an MCP" red
 * @returns {Array<{code: string, path: string, detail: string}>} no entry = legal
 */
export function ticketFilterReds(f, { hasMcp = true } = {}) {
  /** @type {Array<{code: string, path: string, detail: string}>} */
  const reds = [];
  const red = (/** @type {string} */ code, /** @type {string} */ path, /** @type {string} */ detail) => reds.push({ code, path, detail });
  const isObj = f !== null && typeof f === 'object' && !Array.isArray(f);
  if (!isObj || Object.keys(/** @type {object} */ (f)).length === 0) {
    red('invalid-value', 'ticketFilter', `an object with "priority" and/or "labels", for example ${TICKET_FILTER_EXAMPLE}`);
    return reds;
  }
  const o = /** @type {Record<string, any>} */ (f);
  if (!hasMcp) red('invalid-value', 'ticketFilter', 'filters tickets read through the job\'s "mcp" tools, but the job lists no "mcp" server');
  for (const key of Object.keys(o)) if (key !== 'priority' && key !== 'labels') red('unknown-field', `ticketFilter.${key}`, `declared keys only: priority|labels, for example ${TICKET_FILTER_EXAMPLE}`);
  /** @type {Array<['priority'|'labels', (v: string) => boolean]>} */
  const lists = [['priority', (v) => /^P[0-3]$/.test(v)], ['labels', (v) => v.trim() !== '' && v.length <= 100]];
  for (const [key, ok] of lists) {
    if (!Object.hasOwn(o, key)) continue;
    if (!Array.isArray(o[key]) || o[key].length === 0) { red('invalid-value', `ticketFilter.${key}`, `a non-empty list, for example ${TICKET_FILTER_EXAMPLE}`); continue; }
    const seen = new Set();
    for (const v of o[key]) {
      if (typeof v !== 'string' || !ok(v)) red('invalid-value', `ticketFilter.${key}`, `names ${JSON.stringify(v)}, which is not ${key === 'priority' ? 'a priority from P0 to P3' : 'a label name (1 to 100 characters)'}; for example ${TICKET_FILTER_EXAMPLE}`);
      else if (seen.has(v.toLowerCase())) red('invalid-value', `ticketFilter.${key}`, `names "${v}" twice`);
      else seen.add(v.toLowerCase());
    }
  }
  return reds;
}

/** the schema's description of the `ticketFilter` property (src/authorflow.js): REQUIRED when a job line names a priority or a label, never "optional" (F285, run-e1 shape) */
export const TICKET_FILTER_SCHEMA_WORDS = 'REQUIRED when a job line names a priority or a label (leave it out only when none does). The person signs it; code decides at run start. Listing the line under "refused" does not filter anything: only this key does';

/**
 * The facts a person-facing turn must not ask about (R5 finding F285): the confirm turn asked "which ticket, and is it P1?" in 5 of 10 live drafts. ONE owner of these words;
 * the confirm prompt and the drafting prompt both carry them, for a Tickets job only.
 * @returns {string}
 */
export function ticketPerRunFacts() {
  return 'THIS JOB READS A TICKET. The ticket is picked per run (typed on the run card, later the newest new ticket) and is never known when the job is drafted, so NEVER ask the person which ticket it is, or what its priority or labels are. '
    + 'A job line that names a priority or a label (for example "only priority P1 tickets") is decided by code at run start from the ticket\'s own labels, through the job\'s ticketFilter: it is not a question for the person and not something you can check, so do not turn it into a question.';
}

/** R9 (F122, fwd e89196e): the frozen ticket is read like any input, and reading is a grant; the DRAFTING turn is told (the person-facing confirm turn is not: it speaks of no tools). */
export const TICKET_READ_FACT = 'A step that reads the ticket input still lists "read" in its tools: the ticket is already frozen at run start, but reading it is a grant, so a step without "read" cannot see it.';

/**
 * What the drafter is told when the job reads tickets (appended to the authoring prompt only then; a plain job's prompt is untouched).
 * Adapted from fwd's `ticketFactsLines` (v0.29.0): the same MUST, the same "never invent a label".
 * @returns {string}
 */
export function ticketFilterBlock() {
  return `${ticketPerRunFacts()} ${TICKET_READ_FACT}\n\nTHE TICKET FILTER — this job reads one ticket per run. Code, not you, decides at run start whether a ticket runs or is skipped, from the ticket's labels and state; a closed ticket always skips.
When a job line (or its ~ rule) names a priority or a label (for example "only priority P1 tickets", "only tickets with priority P1 count", "only issues labelled bug"), you MUST add a top-level "ticketFilter" beside "stages": ${TICKET_FILTER_EXAMPLE}. "priority" is a list of values from P0 to P3, "labels" is a list of label names; each key is optional, and at least one is required. Never invent a label: use only the names the job lines give. Leave "ticketFilter" out entirely when no job line names a priority or a label.
The filter decides whether a run starts, not whether the work is good, so it is not a check. The job line that names the priority or label has no stage: list it under "refused" with the reason "decided by the ticket filter before the run starts" AND add the ticketFilter: the refused entry alone does not filter anything, only the ticketFilter does. A person reads and signs the filter; you never set the job's server or tools.`;
}

/**
 * The filter in code-owned plain words (the plan card, the Job tab): never model prose. Null when there is nothing to say.
 * @param {any} f the (legal) filter @returns {string|null}
 */
export function ticketFilterWords(f) {
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return null;
  const parts = [];
  if (Array.isArray(f.priority) && f.priority.length) parts.push(`priority ${f.priority.join(' or ')}`);
  if (Array.isArray(f.labels) && f.labels.length) parts.push(`label ${f.labels.join(' or ')}`);
  return parts.length ? `only tickets with ${parts.join(' and ')} run; a closed ticket is skipped` : null;
}
