// borrowed-from: bareloop src/checkpick.js@v0.56.0 (3383cce)
// borrowed-from: fwdloop src/checkpick.js@v0.29.0 (scope, keepOrDrop, SUGGEST_SYSTEM/SUGGEST_SCHEMA, checkAsks, settleRules) and src/declaration.js@v0.29.0 (the guardrail* readers)
// R10 = fwdloop M10 amendment 16 ("shape guardrails are settled the way item 3-4 settle a source's words"). ONE AI call suggests, per `~` rule of a rubric job, ONE check
// from bareguard's own list (`rubricVocabulary`) or none; CODE keeps a suggestion only if its rule is on the list, it carries only that rule's own fields, every number
// is one the rule names and every word is a word of the rule; the person picks (agree / own words / drop it); the plan carries only the checks picked. The drafter writes
// no check of its own. The prompt, the per-rule answer form and the keep-or-drop are the ones fwd's F144c proved.
// Throws away: a suggestion's `id`, `field`, `strict`, `text` (code sets them, or they never decide); every rule that code scopes out; what the model says in words.
// bareloop differences from fwd (ruled 2026-11-09): rubric jobs only; the call runs over bareloop's own `askStructured` ladder (cost booked and the answer logged like every
// drafting call); a pick lands as a `countable` part of the line's rubric-step stage (src/rubricstep.js), carrying the `~` rule numbers it settles.
import { rubricVocabulary } from 'bareguard';
import { plainWords, OFFERED } from './checkwords.js';
import { KEPT_WORDS } from './pickrecord.js';
import { lineRules } from './rubricstep.js';

export { plainWords, OFFERED };

/** the one tool the suggestion call uses */
export const SUGGEST_TOOL = 'suggest_checks';
const VOCAB = /** @type {Record<string, {description: string, fields: Record<string, {type: string, required?: boolean}>}>} */ (rubricVocabulary.rules);
/** fields code sets, or that never decide: never offered, never kept */
const IGNORED = new Set(['id', 'field', 'text', 'strict']);
const NUM_FIELDS = ['value', 'size', 'wordsPerSection'];
const WORD_FIELDS = ['names', 'phrases'];

// ---- the guardrail readers (fwd src/declaration.js@v0.29.0) ------------------------------------------------------------------------------
const readNumber = (/** @type {string} */ t) => Number(t.replace(/,/g, ''));
/** every whole-output word number in a guardrail ("under 600 words" -> [600]); a "<n> words each" / "per section" size is never listed here @param {unknown} g @returns {number[]} */
export function guardrailWordNumbers(g) {
  if (typeof g !== 'string') return [];
  return [...g.matchAll(/(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s*words?\b(?!\s*(?:each|per\s+section)\b)/gi)].map((m) => readNumber(m[1]));
}
/** every standalone number in a guardrail's own text (digits not joined to letters) @param {unknown} g @returns {number[]} */
export function guardrailStandaloneNumbers(g) {
  if (typeof g !== 'string') return [];
  return [...g.matchAll(/(?<![A-Za-z0-9_.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g)].map((m) => Number(m[1].replace(/,/g, '')));
}
/** the "<n> words each" / "<n> words per section" size, or null @param {unknown} g @returns {number|null} */
export function guardrailWordsPerSection(g) {
  const m = typeof g === 'string' ? /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?:\s*words?|ish(?:\s+words?)?)\s+(?:each|per\s+section)\b/i.exec(g) : null;
  return m ? readNumber(m[1]) : null;
}
const NUMBER_WORDS = /** @type {Record<string, number>} */ ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });
/** the first "<N> sections" in a guardrail (digits, or one..ten), or null @param {unknown} g @returns {number|null} */
export function guardrailSectionCount(g) {
  const m = typeof g === 'string' ? /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?sections?\b/i.exec(g) : null;
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
}
/** the first "<N> bullets / list items / items / lines / points" in a guardrail (digits, or one..ten), or null @param {unknown} g @returns {number|null} */
export function guardrailItemCount(g) {
  const m = typeof g === 'string' ? /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(?:bullets?|bullet\s+points?|list\s+items?|items?|lines?|points?)\b/i.exec(g) : null;
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
}
/** a list-bound word the guardrail uses: the count it names, or the one it stands for ("more than 3" = at least 4, "fewer than 3" = at most 2) */
const MORE_THAN = /(?<!\b(?:no|not)\s)\bmore\s+than\s+(\d+)\b/i;
const FEWER_THAN = /(?<!\b(?:no|not)\s)\b(?:(?:fewer|less)\s+than|under|below)\s+(\d+)\b/i;
/** the direction of a list-items rule's wording: 'max', 'min' or null (exact / not said) @param {string} t @returns {'max'|'min'|null} */
function listDirection(t) {
  if (/\b(at\s+most|up\s+to|no\s+more\s+than|not\s+more\s+than|max(?:imum)?(?:\s+of)?)\b/i.test(t) || FEWER_THAN.test(t)) return 'max';
  if (/\b(at\s+least|min(?:imum)?(?:\s+of)?|no\s+fewer\s+than|not\s+fewer\s+than)\b/i.test(t) || MORE_THAN.test(t)) return 'min';
  return null;
}
/** the numbers a rule may carry: the standalone numbers of the guardrail, plus N+1 for "more than N" (min) and N-1 for "fewer than N" (max) @param {string} rule @param {string} g @returns {number[]} */
function listBoundNumbers(rule, g) {
  const named = guardrailStandaloneNumbers(g);
  if (rule === 'minListItems') { const m = MORE_THAN.exec(g); if (m) named.push(Number(m[1]) + 1); }
  if (rule === 'maxListItems') { const m = FEWER_THAN.exec(g); if (m) named.push(Number(m[1]) - 1); }
  return named;
}
/** @param {unknown} g @returns {boolean} the rule is a COUNT bareguard checks (words, list items or lines, sections): code reads it, whatever the page look said about it */
export const isCountable = (g) => guardrailWordNumbers(g).length > 0 || guardrailItemCount(g) !== null || guardrailSectionCount(g) !== null;

// ---- scope, decided by CODE before the call ----------------------------------------------------------------------------------------------
/** @param {unknown} v @returns {boolean} the input is a web page (a URL), which routes its rules to the page words (facts) */
export const isUrlInput = (v) => /^https?:\/\//i.test(String(v ?? '').trim());
/** @param {{value?: string}[]|null|undefined} inputs @returns {boolean} the job signs an input that routes its rules to another signed part */
export const hasRoutingInput = (inputs) => (inputs ?? []).some((i) => isUrlInput(i?.value));
/**
 * A rule goes to this call unless the job signs an input that routes its rules elsewhere (a web page) AND the rule names no whole-output word number (the one thing the
 * shape reader still takes in such a job). fwd's F144b `codeScope`.
 * @param {{value?: string}[]|null|undefined} inputs @param {string} g @returns {'in'|'out'}
 */
export const codeScope = (inputs, g) => (hasRoutingInput(inputs) && guardrailWordNumbers(g).length === 0 ? 'out' : 'in');

/** @typedef {{line: number, rule: number, text: string}} Rule */
/**
 * Every `~` rule of a rubric job that this call settles, in line order. `rule` is the rule's number on its line (the number a part's `rules` and the answers use). A rule a
 * kept page word already carries (the look tied it by line and rule number) or that the look already put under Not checked is left to that, EXCEPT a countable rule (`isCountable`: a word, list-item/line or section count), which always comes here: the look's fact stays beside the pick (keep-both). A repeated text on a line is
 * one rule here, asked once.
 * @param {{n: number, rule?: string, rules?: string[]}[]} jobLines @param {{inputs?: {value?: string}[]|null, look?: any}} [o]
 * @returns {Rule[]}
 */
export function scopedRules(jobLines, { inputs = null, look = null } = {}) {
  const facts = Array.isArray(look?.facts) ? look.facts : [];
  const dropped = Array.isArray(look?.dropped) ? look.dropped : [];
  /** @type {Rule[]} */
  const out = [];
  for (const l of Array.isArray(jobLines) ? jobLines : []) {
    const seen = new Set();
    lineRules(l).forEach((text, i) => {
      const key = text.trim().toLowerCase();
      const n = i + 1;
      if (seen.has(key) || codeScope(inputs, text) !== 'in') return;
      // a countable rule always reaches the pick offer: what the look tied or dropped on it stays (keep-both), but never hides the count from the person
      if (!isCountable(text)) {
        if (facts.some((/** @type {any} */ f) => f?.line === l.n && f?.forRule === n)) return;
        if (dropped.some((/** @type {any} */ d) => d?.line === l.n && d?.rule === n)) return;
      }
      seen.add(key);
      out.push({ line: l.n, rule: n, text });
    });
  }
  return out;
}

// ---- code's keep-or-drop (am16 (2)) ------------------------------------------------------------------------------------------------------
const norm = (/** @type {unknown} */ t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
/** a ~ rule's words compared case, spacing and trailing punctuation blind: the one spelling "is this the same rule?" is asked by */
export const sameRuleWords = (/** @type {unknown} */ a, /** @type {unknown} */ b) => norm(a).replace(/[.,;:!?\s]+$/, '') === norm(b).replace(/[.,;:!?\s]+$/, '');
const tokens = (/** @type {unknown} */ t) => new Set(norm(t).match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * Keep a suggestion only if its rule is on bareguard's list, it carries only that rule's own fields, every number in it is a number the guardrail names and every word in it
 * is a word of the guardrail. Anything else is dropped, with the reason. `none` is a drop with the reason `none`.
 * @param {string} guardrail @param {any} sug the model's entry for this guardrail
 * @returns {{kept: true, check: Record<string, any>}|{kept: false, why: string}}
 */
export function keepOrDrop(guardrail, sug) {
  if (sug == null || typeof sug !== 'object') return { kept: false, why: 'unreadable suggestion' };
  const { rule } = sug;
  if (rule === 'none' || rule === undefined || rule === null) return { kept: false, why: 'none' };
  if (typeof rule !== 'string' || !Object.hasOwn(VOCAB, rule)) return { kept: false, why: `rule "${rule}" is not on bareguard's list` };
  if (!OFFERED.includes(rule)) return { kept: false, why: `rule "${rule}" is on bareguard's list but is not offered here` };
  const own = Object.keys(VOCAB[rule].fields).filter((k) => !IGNORED.has(k));
  for (const k of own) if (VOCAB[rule].fields[k].required && sug[k] == null) return { kept: false, why: `${rule} needs ${k}` };
  const allowed = new Set([...own, 'rule', 'line', 'guardrail']);
  for (const k of Object.keys(sug)) if (sug[k] != null && !allowed.has(k)) return { kept: false, why: `${rule} does not take ${k}` };
  /** @type {Record<string, any>} */
  const check = { rule };
  for (const k of own) {
    const v = sug[k];
    if (v == null) continue;
    if (NUM_FIELDS.includes(k)) {
      const floor = rule === 'maxListItems' ? 0 : 1; // maxListItems 0 = no bullets (bareguard 0.35); every other count starts at 1
      if (!Number.isInteger(v) || v < floor) return { kept: false, why: `${k} ${JSON.stringify(v)} is not a whole number >= ${floor}` };
      const named = rule === 'maxWords' || rule === 'minWords' ? guardrailWordNumbers(guardrail)
        : k === 'wordsPerSection' ? [guardrailWordsPerSection(guardrail)].filter((x) => x !== null)
          : listBoundNumbers(rule, guardrail);
      if (!named.includes(v)) return { kept: false, why: `${k} ${v} is not a number the guardrail names (${named.join(', ') || 'it names none'})` };
      check[k] = v;
    } else if (WORD_FIELDS.includes(k)) {
      if (!Array.isArray(v) || v.length === 0 || v.some((s) => typeof s !== 'string' || s.trim() === '')) return { kept: false, why: `${k} is not a list of words` };
      const gTok = tokens(guardrail);
      const gNorm = norm(guardrail);
      for (const s of v) {
        if (!gNorm.includes(norm(s))) return { kept: false, why: `${k} "${s}" is not in the guardrail's words` };
        for (const t of tokens(s)) if (!gTok.has(t)) return { kept: false, why: `${k} word "${t}" is not a word of the guardrail` };
      }
      check[k] = v;
    }
  }
  if (rule === 'sections' || rule === 'sectionOrder' || rule === 'sectionWords') {
    const want = guardrailSectionCount(guardrail);
    if (want !== null && check.names.length !== want) return { kept: false, why: `the guardrail says ${want} sections; the check has ${check.names.length}` };
  }
  return { kept: true, check };
}

// ---- the call: prompt, answer form (fwd F144c, per-rule anyOf) ---------------------------------------------------------------------------
const vocabBlock = OFFERED.map((r) => `- ${VOCAB[r].description}`).join('\n');
export const SUGGEST_SYSTEM = `You help a person turn the guardrails written under the lines of a job into mechanical checks.
You are given the job's lines. Under a line, its guardrails are numbered g1, g2, ... You are also given the checks the checker can run.

For EACH guardrail, call ${SUGGEST_TOOL} with one entry: the one check from the list that checks exactly what that guardrail says, or the rule "none".

Rules:
- Use only a rule from the list below, with only the fields that rule takes. Do not set id, field, strict or text: code sets them.
- Use only numbers the guardrail itself states, and only words the guardrail itself contains. Never add a section name, phrase or number the guardrail does not state.
- Suggest \`sections\` or \`sectionWords\` only when the guardrail itself names the sections.
- A guardrail like 'all under N words' or 'under N words' is about the whole answer: use maxWords N.
- If no check on the list checks exactly what the guardrail says (it is about content, sources, prices, columns, or a count the list cannot check exactly), answer "none". A check that is weaker than, or different from, the guardrail is worse than "none".
- Answer for every guardrail once, using the line number and the guardrail number shown.

Checks the checker can run (rule({ fields })):
${vocabBlock}`;

/**
 * The user message: the job's lines, and under a line only the guardrails this call settles, numbered by their rule number on the line.
 * @param {{n: number, text: string}[]} lines @param {Rule[]} scoped @returns {string}
 */
export function suggestUserText(lines, scoped) {
  const out = ['The job:'];
  for (const l of lines) {
    out.push(`${l.n}. ${l.text}`);
    for (const s of scoped) if (s.line === l.n) out.push(`   g${s.rule}: ${s.text}`);
  }
  return out.join('\n');
}

const JSON_TYPE = /** @type {Record<string, any>} */ ({ integer: { type: 'integer', minimum: 1 }, 'string-list': { type: 'array', minItems: 1, items: { type: 'string' } } });
/** @param {string} rule @returns {object} one variant of the answer form: exactly that rule's own fields, nothing else */
function variant(rule) {
  /** @type {Record<string, any>} */
  const properties = { line: { type: 'integer', description: 'the job line number' }, guardrail: { type: 'integer', description: 'the guardrail number under that line (g1 = 1)' }, rule: { const: rule } };
  const required = ['line', 'guardrail', 'rule'];
  if (rule !== 'none') {
    for (const [k, f] of Object.entries(VOCAB[rule].fields)) {
      if (IGNORED.has(k)) continue;
      properties[k] = JSON_TYPE[f.type];
      if (f.required) required.push(k);
    }
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
/** the tool's parameter schema: one `anyOf` variant per offered rule, plus `none` */
export const SUGGEST_SCHEMA = Object.freeze({
  type: 'object',
  properties: { checks: { type: 'array', description: 'One entry per guardrail.', items: { anyOf: [...OFFERED, 'none'].map(variant) } } },
  required: ['checks'],
  additionalProperties: false,
});

/** the instruction a retry carries (the structured ladder's own words, naming this tool) */
export const SUGGEST_INSTRUCTION = `Your reply did not deliver exactly one ${SUGGEST_TOOL} call. Call ${SUGGEST_TOOL} exactly once, with one entry per guardrail as its arguments. Do not write the answer as text.`;

/** @param {{calls: any[]}} box the tool the suggestion call is made through; it records and acknowledges, and takes no action */
export const suggestTool = (box) => ({
  name: SUGGEST_TOOL,
  description: 'Deliver your suggestion for every guardrail. Call this exactly once, with one entry per guardrail.',
  parameters: SUGGEST_SCHEMA,
  execute: async (/** @type {any} */ args) => { box.calls.push(args); return 'suggestions received'; },
});
/** the channel `askStructured` (src/authorflow.js) runs the call over */
export const suggestChannel = () => ({
  name: SUGGEST_TOOL,
  instruction: SUGGEST_INSTRUCTION,
  textPath: 'checks',
  tool: (/** @type {{calls: any[]}} */ box) => suggestTool(box),
});

/**
 * The check CODE proposes for a count rule when the call yields none (R10, ours; fwd has no such fallback): a bullets / list-items / points count -> listItems N (exact; "at most / up to / no more than / fewer than / under / below" -> maxListItems, "at least / minimum / no fewer than / more than" -> minListItems, F315), a lines count ->
 * maxLines N, ONE word number -> minWords N when the rule says "at least / minimum / more than", else maxWords N. A section count names no sections, so none is built; a rule naming two different counts ("3 bullets under 80 words") is not built either; a rule with
 * several word numbers or a range ("between 100 and 200 words") is not guessed. The result passes `keepOrDrop`, so every number is one the rule names.
 * @param {string} text @returns {Record<string, any>|null}
 */
export function countCheck(text) {
  const items = guardrailItemCount(text);
  const words = guardrailWordNumbers(text);
  /** @type {Record<string, any>|null} */
  let built = null;
  if (items !== null && (words.length > 0 || guardrailSectionCount(text) !== null)) return null; // two different counts in one rule: first-match readers would guess, so nothing is built
  if (items !== null && /\blines?\b/i.test(text) && !/\b(bullets?|items?|points?)\b/i.test(text)) built = { rule: 'maxLines', value: items };
  else if (items !== null) {
    const dir = listDirection(text);
    if (dir === 'min') built = { rule: 'minListItems', value: MORE_THAN.test(text) ? items + 1 : items };
    else if (dir === 'max') built = { rule: 'maxListItems', value: FEWER_THAN.test(text) ? items - 1 : items };
    else built = { rule: 'listItems', value: items };
  }
  else if (words.length === 1 && !/\bbetween\b|\d\s*(?:-|–|to)\s*\d/i.test(text)) built = { rule: /\b(at least|min(?:imum)?|more than|over|no fewer than)\b/i.test(text) ? 'minWords' : 'maxWords', value: words[0] };
  if (built === null) return null;
  const res = keepOrDrop(text, built);
  return res.kept ? res.check : null;
}

/**
 * What the call's answer comes to, one row per scoped rule: the check kept (or null) and why it was dropped. A rule the answer never mentions is dropped as `no entry`; an
 * entry for a rule that was not sent is ignored.
 * @param {Rule[]} scoped @param {any} args the tool call's arguments
 * @returns {(Rule & {check: Record<string, any>|null, why: string|null})[]}
 */
export function rowsFromAnswer(scoped, args) {
  const entries = Array.isArray(args?.checks) ? args.checks : [];
  return scoped.map((s) => {
    const e = entries.find((/** @type {any} */ x) => x?.line === s.line && x?.guardrail === s.rule);
    const res = e === undefined ? /** @type {ReturnType<typeof keepOrDrop>} */ ({ kept: false, why: 'no entry' }) : keepOrDrop(s.text, e);
    if (res.kept) return { ...s, check: res.check, why: null };
    // R10 (hamr 2026-11-09): a count rule is never "I can't check this"; with no kept pick from the call, CODE proposes the check its own readers name
    const own = countCheck(s.text);
    return { ...s, check: own, why: own ? null : res.why };
  });
}

// ---- the asks (words are item 4's) -------------------------------------------------------------------------------------------------------
/** the can't-check ask, as the signed words say it */
export const CANT_CHECK_WORDS = "I can't check this. Your own words, or Not checked?";
/** how every answer is told, once (fwd am2 item 2's words) */
export const HOW_TO_ANSWER = (/** @type {number} */ line, /** @type {boolean} */ agree) => `${agree ? 'Answer "agree" to use it, or type your own words' : 'Type your own words'} (your answer is added as a new ~ rule on line ${line}), or answer "drop it" to leave it Not checked.`;

/** a part of a rubric-step stage, from a pick: the check's own fields, the rule's words, and the `~` rule numbers it carries out @param {Record<string, any>} check @param {string} text @param {number[]} rules */
export function partOfPick(check, text, rules) {
  const { rule, ...fields } = check;
  return { text, class: 'countable', check: rule, ...fields, rules };
}
