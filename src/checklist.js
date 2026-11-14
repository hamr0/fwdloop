// borrowed-from: bareloop src/checklist.js@v0.56.0 (3383cce) (the row vocabulary, weekOnly/weekTokens with the three month patterns written as literals, ledgerRecord and the list call's text and schema; the paid call runLedgerSuggest is NOT taken: it runs over bareloop's askStructured and makeCostBook (src/authorflow.js, which need src/text.js), and fwd meters its own calls)
// THE ROW VOCABULARY of a rubric job's one check list, and the call that suggests extra `!` checks. The list itself is the CheckBlock (src/checkblock.js): every check the job can have is a row there.
//   `~` rows  the person's own rules (by: you; a settled pick builds the rule's check)
//   `!` rows  checks the agent suggests once, only from what it sees in the inputs (by: agent): the look's kept facts that carry no `~` rule, plus the call's own
//             proposals (count, phrase). Code proves a word-bearing `!` row against the input text, else drops it with a reason. A `~` always wins over a `!` on the same thing.
//   `$` rows  default checks code adds itself (by: default): every claim quotes the input (a text line with one input), the numbers tie (a text line after a fact line);
//             the mechanical floor (file exists, text not empty) is shown as a `$` row but is never counted as a check.
// Nothing here decides a verdict; the list says what the drafter may build, and code builds the rest.
import { lineRules } from './pagebits.js';

/** at most this many `!` checks come from the call */
export const MAX_BANG = 3;
/** the reason a check on a version or a date goes under Not checked: it is true only for the input as it is today */
export const WEEK_ONLY_WORDS = 'It names a version or a date from the input, true only for the input as it is today, so you judge it at Accept.';
/** the label of the list call, as the drafting book and the draft log see it */
export const LEDGER_LABEL = 'ledger-suggest';
export const LEDGER_TOOL = 'suggest_extra_checks';
/** how much of each input the call is shown */
const SHOWN_CHARS = 8000;
/** the reason the empty list is logged with */
export const EMPTY_LIST_WORDS = 'empty list: nothing to check';

/**
 * A check that needs exact words from the input is true only while the input stays as it is when those words hold a VERSION-like token (1.2 or 1.2.3, not after a currency sign or before
 * a percent) or a DATE-like token (2026-11-04, 04/11/2026, "Nov 4, 2026", "4 November 2026", "November 2026"). Code refuses it; a `~` rule is the person's own and is never refused by this.
 * @param {unknown} t @returns {boolean}
 */
export function weekOnly(t) {
  return weekTokens(t).length > 0;
}

/**
 * The version-like and date-like tokens a text holds (the very tokens {@link weekOnly} reads), each once. Pure.
 * @param {unknown} t @returns {string[]}
 */
export function weekTokens(t) {
  const s = String(t ?? '');
  const res = [/(?<![\d.$€£])\d+\.\d+(?:\.\d+)*(?![\d.]*%)/g, /\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?\b/gi, /\b\d{1,2}(?:st|nd|rd|th)? (?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?: \d{4})?\b/gi, /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? \d{4}\b/gi];
  return [...new Set(res.flatMap((re) => [...s.matchAll(re)].map((m) => m[0])))];
}

/**
 * @typedef {{key: string, line: number, kind: 'rule'|'fact'|'cited'|'count'|'phrase'|'numbers'|'floor', from: 'rule'|'pick'|'look'|'agent'|'default', by: 'you'|'agent'|'default',
 *   words: string[], text?: string, rule?: number, part?: {line: number, part: number}, source?: string, name?: string, min?: number, max?: number, pick?: string, after?: number[],
 *   state: 'listed'|'built'|'not-checked'|'dropped', reason: string|null, forRule?: number, reading?: import('./pagerules.js').Reading}} Row
 */

/** an empty list (no row that stands but the floor) is said so, never left as no record at all @param {Row[]} rows @returns {boolean} */
export const isEmptyList = (rows) => !rows.some((r) => r.kind !== 'floor' && r.state !== 'dropped');

/** the record the draft log keeps, one object per row (key, line, rowKind, from, by, words, state, reason), plus ONE explicit record when nothing stands @param {Row[]} rows */
export const ledgerRecord = (rows) => [
  ...rows.map((r) => ({ key: r.key, line: r.line, rowKind: r.kind, from: r.from, by: r.by, words: r.kind === 'rule' ? [r.text ?? ''] : r.words, state: r.state, reason: r.reason })),
  ...(isEmptyList(rows) ? [{ key: 'empty', line: 0, rowKind: 'empty', from: 'default', by: 'default', words: [], state: 'empty', reason: EMPTY_LIST_WORDS }] : []),
];

// ---- the one paid call ---------------------------------------------------------------------------------------------------------------------
/** the list call's own system text (model-facing; used only by the list call of a rubric job with input text) */
export const LEDGER_SYSTEM = `You look at the inputs of a job and name checks the inputs themselves support, beyond the guardrails the person wrote.
Call ${LEDGER_TOOL} once with up to ${MAX_BANG} entries, or with an empty list.
- kind "count": how many results the input shows or the job asks for (min and/or max, whole numbers).
- kind "phrase": fixed words copied verbatim from an input (phrase, and source = that input's label).
Use only what you can see in the inputs. Do not repeat a guardrail the person wrote. If the inputs support none, send an empty list.`;

export const LEDGER_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    extra: {
      type: 'array', maxItems: MAX_BANG,
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer', minimum: 1, description: 'the job line number' },
          kind: { enum: ['count', 'phrase'] },
          source: { type: 'string', description: 'the label of the input' },
          phrase: { type: 'string', description: 'phrase only: words copied verbatim from the input' },
          min: { type: 'integer', minimum: 1 },
          max: { type: 'integer', minimum: 1 },
        },
        required: ['line', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['extra'],
  additionalProperties: false,
});

/** @param {{n: number, text: string, rules?: string[], rule?: string}[]} jobLines @param {Record<string, string>} texts @returns {string} */
export function ledgerUserText(jobLines, texts) {
  const out = ['The job:'];
  for (const l of jobLines) {
    out.push(`${l.n}. ${l.text}`);
    lineRules(l).forEach((r, i) => out.push(`   g${i + 1}: ${r}`));
  }
  for (const [label, t] of Object.entries(texts)) out.push('', `Input "${label}":`, String(t).slice(0, SHOWN_CHARS));
  return out.join('\n');
}
