// M10 amendment 16 (docs/wiki/the-module-ladder.md "M10 amendment 16"): shape guardrails are settled the way item 3-4 settle a source's words.
// One AI call suggests, per guardrail, ONE check from bareguard's own list (`rubricVocabulary`) or none; CODE keeps a suggestion only if its rule is on
// the list, every number is one the guardrail names and every word is a word of the guardrail; the person picks (src/drafter.js asks, src/panel/author.js
// takes the answer); the plan carries only the checks picked. The drafter writes no check of its own.
// The prompt, the per-rule answer form and the keep-or-drop are the ones F144c proved (docs/logs/FINDINGS.md F144c).
// Throws away: a suggestion's `id`, `field`, `strict`, `text` (code sets them, or they never decide); every guardrail that code scopes out; what the model says in words.
import { rubricVocabulary } from 'bareguard';
import { lineRules } from './pagebits.js';
import { isCellsPath } from './closers.js';
import { plainWords, OFFERED } from './checkwords.js';

export { plainWords, OFFERED };
import { guardrailWordNumbers, guardrailStandaloneNumbers, guardrailWordsPerSection, guardrailSectionCount, isCountGuardrail } from './declaration.js';

/** the one tool the suggestion call is forced to use */
export const SUGGEST_TOOL = 'suggest_checks';
const VOCAB = /** @type {Record<string, {description: string, fields: Record<string, {type: string, required?: boolean}>}>} */ (rubricVocabulary.rules);
/** fields code sets, or that never decide: never offered, never kept */
const IGNORED = new Set(['id', 'field', 'text', 'strict']);
const NUM_FIELDS = ['value', 'size', 'wordsPerSection'];
const WORD_FIELDS = ['names', 'phrases'];

// ---- scope, decided by CODE before the call ------------------------------------------------------------------------------------------------
/** @param {any[]|undefined} sources the job's signed inputs @returns {boolean} a CSV file or a web page routes its guardrails to another signed part (M10 items 1-3, M12) */
export const hasRoutingInput = (sources) => (sources ?? []).some((s) => (s.kind === 'file' && isCellsPath(s.path)) || s.kind === 'page');
/**
 * A guardrail goes to this call unless the job signs an input that routes its guardrails elsewhere AND the guardrail is not a count code can check (M10 am23: words, items, sections)
 * (the one thing the shape reader still takes in such a job). A page job whose guardrail is a count therefore counts as in (F144b caveat).
 * @param {any[]|undefined} sources @param {string} g @returns {'in'|'out'}
 */
export const codeScope = (sources, g) => (hasRoutingInput(sources) && !isCountGuardrail(g) ? 'out' : 'in');

/**
 * Every guardrail rule on a step line (not a signed ask or send line) that this call settles, in line order. `rule` is the rule's number on its line (the one
 * number `leftRules`, `ruleNo` and the answers use); a repeated text on a line is one rule here, asked once.
 * @param {{n: number, guardrail?: string}[]} lines `parseSignedText`'s lines @param {{asks?: {line: number}[], sends?: {line: number}[], sources?: any[]}} arbiter
 * @returns {{line: number, rule: number, text: string}[]}
 */
export function scopedRules(lines, arbiter) {
  const skip = new Set([...(arbiter?.asks ?? []), ...(arbiter?.sends ?? [])].map((x) => x.line));
  /** @type {{line: number, rule: number, text: string}[]} */
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    if (skip.has(l.n)) continue;
    const seen = new Set();
    lineRules({ rule: l.guardrail }).forEach((text, i) => {
      const key = text.trim().toLowerCase();
      if (seen.has(key) || codeScope(arbiter?.sources, text) !== 'in') return;
      seen.add(key);
      out.push({ line: l.n, rule: i + 1, text });
    });
  }
  return out;
}

/**
 * The rules the suggestion call offers for a draft: `scopedRules` less the ones a kept page or sheet fact already serves (the look tied it: line + rule number).
 * @param {{n: number, guardrail?: string}[]} lines @param {any} arbiter @param {{line: number, forRule?: number}[]} facts `look.facts` + the sheets' facts
 */
export const offerRules = (lines, arbiter, facts) => scopedRules(lines, arbiter).filter((r) => isCountGuardrail(r.text) || !facts.some((f) => f.line === r.line && f.forRule === r.rule));

// ---- code's keep-or-drop (am16 (2)) --------------------------------------------------------------------------------------------------------
const norm = (/** @type {unknown} */ t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const tokens = (/** @type {unknown} */ t) => new Set(norm(t).match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * Keep a suggestion only if its rule is on bareguard's list, it carries only that rule's own fields, every number in it is a number the guardrail names and
 * every word in it is a word of the guardrail. Anything else is dropped, with the reason. `none` is a drop with the reason `none`.
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
      if (!Number.isInteger(v) || v < 1) return { kept: false, why: `${k} ${JSON.stringify(v)} is not a whole number >= 1` };
      const named = rule === 'maxWords' || rule === 'minWords' ? guardrailWordNumbers(guardrail)
        : k === 'wordsPerSection' ? [guardrailWordsPerSection(guardrail)].filter((x) => x !== null)
          : guardrailStandaloneNumbers(guardrail);
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

// ---- the call: prompt, answer form -------------------------------------------------------------------------------------------------------
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
 * @param {{n: number, text: string}[]} lines @param {{line: number, rule: number, text: string}[]} scoped @returns {string}
 */
export function suggestUserText(lines, scoped) {
  const out = ['The job:'];
  for (const l of lines) {
    out.push(`${l.n}. ${l.text}`);
    for (const s of scoped) if (s.line === l.n) out.push(`   g${s.rule}: ${s.text}`);
  }
  return out.join('\n');
}

const JSON_TYPE = { integer: { type: 'integer', minimum: 1 }, 'string-list': { type: 'array', minItems: 1, items: { type: 'string' } } };
/** @param {string} rule @returns {object} one variant of the answer form: exactly that rule's own fields, nothing else */
function variant(rule) {
  /** @type {Record<string, any>} */
  const properties = { line: { type: 'integer', description: 'the job line number' }, guardrail: { type: 'integer', description: 'the guardrail number under that line (g1 = 1)' }, rule: { const: rule } };
  const required = ['line', 'guardrail', 'rule'];
  if (rule !== 'none') {
    for (const [k, f] of Object.entries(VOCAB[rule].fields)) {
      if (IGNORED.has(k)) continue;
      properties[k] = /** @type {Record<string, any>} */ (JSON_TYPE)[f.type];
      if (f.required) required.push(k);
    }
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
/** the forced tool's parameter schema: one `anyOf` variant per offered rule, plus `none` */
export const SUGGEST_SCHEMA = Object.freeze({
  type: 'object',
  properties: { checks: { type: 'array', description: 'One entry per guardrail.', items: { anyOf: [...OFFERED, 'none'].map(variant) } } },
  required: ['checks'],
  additionalProperties: false,
});

/**
 * What the call's answer comes to, one row per scoped guardrail: the check kept (or null) and why it was dropped. A guardrail the answer never mentions is
 * dropped as `no entry`; an entry for a guardrail that was not sent is ignored.
 * @param {{line: number, rule: number, text: string}[]} scoped @param {any} args the tool call's arguments
 * @returns {{line: number, rule: number, text: string, check: Record<string, any>|null, why: string|null}[]}
 */
export function rowsFromAnswer(scoped, args) {
  const entries = Array.isArray(args?.checks) ? args.checks : [];
  return scoped.map((s) => {
    const e = entries.find((/** @type {any} */ x) => x?.line === s.line && x?.guardrail === s.rule);
    const res = e === undefined ? /** @type {ReturnType<typeof keepOrDrop>} */ ({ kept: false, why: 'no entry' }) : keepOrDrop(s.text, e);
    return { ...s, check: res.kept ? res.check : null, why: res.kept ? null : res.why };
  });
}

// ---- the asks (words are item 4's) -----------------------------------------------------------------------------------------------------
/** the can't-check ask, as the signed words say it */
export const CANT_CHECK_WORDS = "I can't check this. Your own words, or Not checked?";
/** how every answer is told, once (am2 item 2's words) */
const HOW_TO_ANSWER = (/** @type {number} */ line, /** @type {boolean} */ agree) => `${agree ? 'Answer "agree" to use it, or type your own words' : 'Type your own words'} (your answer is added as a new ~ rule on line ${line}), or answer "drop it" to leave it Not checked.`;

/**
 * The asks for the rows: `Line n, guardrail "<…>": I propose <check in plain words>.` for a kept check, `Line n, guardrail "<…>": I can't check this. Your own words, or
 * Not checked?` when nothing was kept. A proposal is not counted toward am1's cap; a can't-check ask is (am16 (5)).
 * @param {ReturnType<typeof rowsFromAnswer>} rows
 * @returns {{pairRule?: number, line: number, rule: number, source: 'look', ask: 'check'|'no-check', ruleText: string, question: string, reading?: string, check?: Record<string, any>, counted: boolean}[]}
 */
export function checkAsks(rows) {
  return rows.map((r) => {
    const pair = typeof (/** @type {any} */ (r).pairRule) === 'number' ? { pairRule: /** @type {any} */ (r).pairRule } : {}; // M10 am21: the asked line is an edited added line
    if (r.check === null) {
      return { ...pair, line: r.line, rule: r.rule, source: 'look', ask: 'no-check', ruleText: r.text, counted: true, question: `Line ${r.line}, guardrail "${r.text}": ${CANT_CHECK_WORDS} ${HOW_TO_ANSWER(r.line, false)}` };
    }
    const words = plainWords(/** @type {any} */ (r.check));
    return { ...pair, line: r.line, rule: r.rule, source: 'look', ask: 'check', ruleText: r.text, counted: false, reading: words, check: r.check, question: `Line ${r.line}, guardrail "${r.text}": I propose ${words}. ${HOW_TO_ANSWER(r.line, true)}` };
  });
}

// ---- the plan uses only the checks you picked (am16 (4)) -------------------------------------------------------------------------------------
/**
 * @typedef {{line: number, rule: number, check: Record<string, any>|null, added?: string, own?: boolean}} Pick
 *   `check` = the check the person agreed to (null for their own words); `added` = the `~` rule the answer wrote on the line; `own` = their own words
 */
/**
 * Settle every scoped rule against the person's answers: a rule with a picked check is checked; the `~` line an agree wrote is covered by that pick; every other
 * rule is Not checked, with the reason (`person-left` = they chose it, `own-words` = they gave their own words, `no-pick` = nothing was picked).
 * @param {ReturnType<typeof scopedRules>} rules @param {Pick[]} picks @param {{line: number, rule: number}[]} left
 * @returns {{checks: Map<number, Record<string, any>[]>, notes: {line: number, rule: number, text: string, reason: 'person-left'|'own-words'|'no-pick'}[]}}
 */
export function settleRules(rules, picks, left) {
  /** @type {Map<number, Record<string, any>[]>} */
  const checks = new Map();
  /** @type {{line: number, rule: number, text: string, reason: 'person-left'|'own-words'|'no-pick'}[]} */
  const notes = [];
  const sameText = (/** @type {string|undefined} */ a, /** @type {string} */ b) => typeof a === 'string' && norm(a) === norm(b);
  for (const r of rules) {
    const own = picks.find((p) => p.line === r.line && p.rule === r.rule);
    if (own?.check) { checks.set(r.line, [...(checks.get(r.line) ?? []), own.check]); continue; }
    if (picks.some((p) => p.check && p.line === r.line && sameText(p.added, r.text))) continue;
    if (left.some((l) => l.line === r.line && l.rule === r.rule)) notes.push({ ...r, reason: 'person-left' });
    else if (own?.own || picks.some((p) => !p.check && p.own && p.line === r.line && sameText(p.added, r.text))) notes.push({ ...r, reason: 'own-words' });
    else notes.push({ ...r, reason: 'no-pick' });
  }
  return { checks, notes };
}

/**
 * Overwrite the drafter's check on every step of a line this call settles (a green step, which another signed part settles, is left alone): a line with picked checks
 * is softgreen and carries exactly those checks; a line with none is hitl. Whatever `close.shape` the drafter wrote is gone. Pure: returns a new declaration.
 * @param {any} declaration @param {ReturnType<typeof scopedRules>} rules @param {ReturnType<typeof settleRules>} settled
 * @param {(note: {line: number, reason: 'person-left'|'own-words'|'no-pick'}) => string} sentence the one table's words for a reason
 */
export function applyPicks(declaration, rules, settled, sentence) {
  if (!declaration || !Array.isArray(declaration.steps)) return declaration;
  const lineSet = new Set(rules.map((r) => r.line));
  const green = (/** @type {number} */ n) => declaration.steps.some((/** @type {any} */ st) => st?.fromLine === n && st?.close?.class === 'green');
  const mine = (/** @type {number} */ n) => lineSet.has(n) && !green(n);
  const steps = declaration.steps.map((/** @type {any} */ st) => {
    // M10 am22 (1): a fact line keeps its fact close and adds the person's picks to it (`close.picked`); the line stays green
    if (st && typeof st === 'object' && lineSet.has(st.fromLine) && green(st.fromLine)) {
      const { picked: _own, ...close } = st.close ?? {};
      const kept = settled.checks.get(st.fromLine) ?? [];
      return { ...st, close: kept.length && st.close?.class === 'green' ? { ...close, picked: kept } : close };
    }
    if (!st || typeof st !== 'object' || !mine(st.fromLine)) return st;
    const picked = settled.checks.get(st.fromLine) ?? [];
    return { ...st, close: picked.length ? { class: 'softgreen', shape: { picked } } : { class: 'hitl' } };
  });
  const out = { ...declaration, steps };
  // M10 am22 (3): the record of the fact lines that carry the person's picks, written here and nowhere else; whatever the drafter sent for it is gone
  const pickedLines = [...new Set(steps.filter((/** @type {any} */ st) => Array.isArray(st?.close?.picked) && st.close.class === 'green').map((/** @type {any} */ st) => st.fromLine))].sort((a, b) => a - b);
  if (pickedLines.length) out.pickedLines = pickedLines; else delete out.pickedLines;
  const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isRec(declaration.guardrailClasses)) {
    out.guardrailClasses = { ...declaration.guardrailClasses };
    const un = isRec(declaration.unjudgeable) ? { ...declaration.unjudgeable } : {};
    for (const n of lineSet) {
      if (!mine(n) || !declaration.steps.some((/** @type {any} */ st) => st?.fromLine === n)) continue;
      const has = (settled.checks.get(n) ?? []).length > 0;
      out.guardrailClasses[String(n)] = has ? 'softgreen' : 'hitl';
      if (has) delete un[String(n)];
      else un[String(n)] = [...new Set(settled.notes.filter((x) => x.line === n).map(sentence))].join(' ') || 'No check was picked for it, so you judge it at the Ask.';
    }
    if (isRec(declaration.unjudgeable) || Object.keys(un).length) out.unjudgeable = un;
  }
  return out;
}
