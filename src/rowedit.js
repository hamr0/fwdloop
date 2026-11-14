// borrowed-from: bareloop src/rowedit.js@v0.56.0 (3383cce)
// THE DRAFTER'S ROW-EDIT TURN of a rubric job (the check block, docs/product/ITEM33-BUILD.md "CHECK BLOCK BUILD SPEC" section 4 and hamr's rulings of 2026-11-12).
// The AI never writes a part, a check or a declaration: it sends EDITS to the list of checks code keeps in the CheckBlock (src/checkblock.js). Code reads the inputs, proves every
// word, builds every check and decides what can be checked; every edit is judged on its own. The confirm turn owns the goal (ruling 5), so the reply has none. A Tickets job's reply
// may also carry the optional `ticketFilter` (ruling 2, R5), checked by its own reader. No text here restates the list of checks (the block's invariant 5): the only list-shaped input is
// the look's report, an input the drafter already had, and the person's own job lines.
import { lineRules } from './pagebits.js';
import { renderLookReport } from './inputlook.js';
import { OFFERED } from './checkwords.js';
import { rubricVocabulary } from 'bareguard';

// borrowed-from: bareloop src/ticketfilter.js@v0.56.0 (3383cce) (TICKET_FILTER_SCHEMA_WORDS only: the one sentence; fwd's own ticketFilter schema, src/ticket-draft.js, words it another way)
export const TICKET_FILTER_SCHEMA_WORDS = 'REQUIRED when a job line names a priority or a label (leave it out only when none does). The person signs it; code decides at run start. Listing the line under "refused" does not filter anything: only this key does';

/** the tool a row-edit reply is delivered through */
export const ROW_EDIT_TOOL = 'submit_edits';
/** what an acknowledged reply returns (the loop ends the call the moment the tool fires) */
export const ROW_EDIT_ACK = 'edits received';

const IGNORED_FIELDS = new Set(['id', 'field', 'text', 'strict']);
const GLOSS = /** @type {Record<string, string>} */ ({ nonEmpty: 'the output is not empty', maxWords: 'at most value words in all', minWords: 'at least value words in all', maxLines: 'at most value lines', listItems: 'exactly value list items (bullets)', maxListItems: 'at most value list items', minListItems: 'at least value list items', sections: 'the output has sections with these names', sectionOrder: 'the sections come in this order', sectionWords: 'each named section has at most wordsPerSection words', mustCarry: 'the output carries these phrases', blockLines: 'blocks of size lines carry these phrases' });
/** the checks a `pick` edit may name: the checker's own list (the same bareguard vocabulary src/checkpick.js reads) */
const pickMenu = () => OFFERED.map((r) => {
  const fields = Object.entries(/** @type {any} */ (rubricVocabulary).rules[r].fields).filter(([k]) => !IGNORED_FIELDS.has(k)).map(([k, v]) => `${k}${/** @type {any} */ (v).required ? '' : '?'}`);
  return `- ${r}${fields.length ? ` { ${fields.join(', ')} }` : ''}: ${GLOSS[r] ?? ''}`;
}).join('\n');

/** the drafter's system text for the row-edit turn (a prompt register: src/promptregisters.js) */
export const ROW_EDIT_SYSTEM = `You help turn the lines of a job into checks, by sending EDITS to a list of checks that code keeps. You never write a check, a stage, a part or a declaration: code reads the inputs, proves every word, builds every check and decides what can be checked. Each edit you send is judged on its own: a refused edit is dropped and says why, and it never costs your other edits.

HOW TO ANSWER
Deliver ONE reply with an "edits" list (the ${ROW_EDIT_TOOL} tool, or one JSON object {"edits": [ ... ]} and nothing else when no tool is offered). An empty "edits" list is a good answer when you have nothing sure to send.

THE FOUR EDITS (each has "op"; the op is exactly one of: add, reading, pick, not-checkable. A count is an add with "kind":"count"; "count" is never an op)
1. add - a check the inputs support that the person did not write and the look did not give:
   {"op":"add","kind":"fact","line":N,"name":"price label","shape":"money","words":["words copied exactly from the input"],"unit":["US dollars"],"currency":["$"],"source":"<input label>"}
   {"op":"add","kind":"phrase","line":N,"name":"letters and spaces only","words":["fixed words copied exactly from the input"],"source":"<input label>"}
   {"op":"add","kind":"count","line":N,"min":3,"max":3}   (how many results the job line itself asks for; whole numbers of 1 or more; only when the line states it)
   "shape" is one of phrase, money, number, date, time. A name uses letters, spaces, "-" or "_" only (no digits). "words" are copied exactly from the input, never typed from memory; words the input does not hold are refused. At most 3 adds in one reply: the later ones are refused.
2. reading - the limit a ~ rule means, for a ~ rule the look tied to a fact ("carries ~ rule N") without giving the limit:
   {"op":"reading","line":N,"rules":[n],"fact":"<that look fact's name>","reading":{"op":"lt","value":450}}   (reading op is lt, lte, gt or gte)
   {"op":"reading","line":N,"rules":[n],"fact":"<that look fact's name>","reading":{"op":"between","lo":"05:00","hi":"21:00"}}
   A money limit is a number. A time limit is a 24-hour "HH:MM" string. A limit the person WROTE ("under $450") is a rule that can be checked: give its reading with its number. A number YOU make out of their words ("not a red-eye" becomes a departure time between 06:00 and 21:00) is your proposal for the person to check, and a time limit that you propose is a RANGE (between), never one-sided. A rule that holds more than one amount or range gets no reading.
3. pick - for a ~ rule that counts words, bullets, lines or sections: the one check that says exactly what that rule says:
   {"op":"pick","line":N,"rules":[n],"check":{"rule":"<one of the checks below>", ...that check's own fields}}
   Use only numbers the ~ rule itself states and only words it contains. The checks (field? = optional):
${pickMenu()}
4. not-checkable - a ~ rule no check on the inputs can carry ("the cheapest", "the best", "the newest one"):
   {"op":"not-checkable","line":N,"rule":n,"reason":"plain words, the person's own"}

RULES
- Names, labels and units are the input's own words, copied exactly as the input writes them. When the input does not use the person's word, use the words the input uses; never invent a word the input holds nowhere, and never add a code (like SFO) that the person did not write and the input does not hold.
- The look (below) is what a read of the inputs already found and code already checks: do not send it again as an add. Use it to name the fact a reading belongs to.
- Send only what you are sure of. A fact or ~ rule you cannot name from the look and the input is not guessed at.
- "line" is the job line's number; "rule" and "rules" are the ~ rule numbers shown under that line (1 = the first).`;

/** the fixed sentence that follows the refusals in a revise turn (the turn carries each refusal's own reason and nothing else) */
export const ROW_EDIT_REVISE = 'Send corrected edits only (an empty "edits" list is a good answer).';

/** how much of each input the turn is shown (the bound src/checklist.js used) */
const SHOWN_CHARS = 8000;

/**
 * The ONE user message: the person's job lines (their `~` rules numbered), the look, the inputs (bounded).
 * @param {{jobLines: any[], look: any, texts: Record<string, string>}} o
 * @returns {string}
 */
export function rowEditUserText({ jobLines, look, texts }) {
  const out = ["THE JOB (the person's own words)"];
  for (const l of jobLines) {
    out.push(`${l.n}. ${l.text}`);
    lineRules(l).forEach((r, i) => out.push(`   ~ rule ${i + 1}: ${r}`));
  }
  const report = look && typeof look === 'object' ? renderLookReport(look).replace(/^WHAT THE LOOK AT THE INPUTS FOUND[^\n]*/, 'WHAT THE LOOK AT THE INPUTS FOUND - code checks each of these itself; you do not write them') : '';
  if (report) out.push('', report);
  for (const [label, t] of Object.entries(texts)) out.push('', `INPUT "${label}" (first ${SHOWN_CHARS} characters):`, String(t).slice(0, SHOWN_CHARS));
  return out.join('\n');
}

/** @param {boolean} ticket @returns {Record<string, any>} the tool's schema: the edits list (each edit judged by code, so an item is any object), and for a Tickets job the optional ticketFilter */
const rowEditSchema = (ticket) => ({
  type: 'object',
  properties: {
    edits: { type: 'array', items: { type: 'object', properties: { op: { enum: ['add', 'reading', 'pick', 'not-checkable'] } }, required: ['op'] }, description: 'row edits; each is judged on its own' },
    ...(ticket ? {
      ticketFilter: {
        type: 'object',
        properties: {
          priority: { type: 'array', items: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, description: 'priorities a ticket must have; only when a job line names them' },
          labels: { type: 'array', items: { type: 'string' }, description: 'label names, one of which a ticket must carry; only when a job line names them' },
        },
        additionalProperties: false,
        description: TICKET_FILTER_SCHEMA_WORDS,
      },
    } : {}),
  },
  required: ['edits'],
  additionalProperties: false,
});

/** @param {boolean} ticket the channel `askStructured` reads (src/authorflow.js) */
export const rowEditChannel = (ticket = false) => ({
  name: ROW_EDIT_TOOL,
  instruction: `Your reply did not deliver exactly one ${ROW_EDIT_TOOL} call. Call ${ROW_EDIT_TOOL} exactly once, with the edits list as its arguments. Do not write the answer as text.`,
  textPath: 'edits',
  tool: (/** @type {{calls: any[]}} */ box) => ({
    name: ROW_EDIT_TOOL,
    description: 'Deliver your row edits (or an empty list). Call this exactly once.',
    parameters: rowEditSchema(ticket),
    execute: async (/** @type {any} */ args) => { box.calls.push(args); return ROW_EDIT_ACK; },
  }),
});

/**
 * The edits a reply holds, as a list (a reply whose `edits` is not a list holds none; each edit is still judged by the block).
 * @param {any} artifact @returns {any[]}
 */
export const editsOf = (artifact) => (artifact && typeof artifact === 'object' && Array.isArray(artifact.edits) ? artifact.edits : []);
