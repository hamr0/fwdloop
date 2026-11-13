// borrowed-from: bareloop src/blockasks.js@v0.56.0 (3383cce)
// The questions of the check block, as the answer gate reads them (`answerQuestions`, src/questionbox.js): ONE spelling of the question words, written by code from a row that
// code could not settle (reading | cant-check | check). The block's `open` list is the source; the person's CHOICE (agree | drop | rule) goes back through `block.applyAnswer`.
import { readingQuestion, cantCheckQuestion } from './pageask.js';
import { plainWords, HOW_TO_ANSWER, CANT_CHECK_WORDS } from './checkpick.js';

/** @typedef {{key: string, rowKey: string, line: number, rule: number, source: 'look', ask: 'reading'|'cant-check'|'no-check'|'check', ruleText: string, question: string, counted: boolean, reading?: string, check?: Record<string, any>, pairRule?: number}} BlockAsk */

/**
 * The questions the block has open, in the order the person meets them: the look's readings, then the look's can't-checks, then the pick path's asks (a proposal or a can't-check about a rule the pick path owns) in rule order (a proposal is not counted toward the 3-ask cap).
 * A can't-check about a rule the PICK path owns (`scoped`: src/checkpick.js scopedRules, every `~` rule of a file job) is the pick path's own ask, `no-check`, in fwd's words (a "Line N, guardrail ...: I can't check this" ask
 * whose answer the panel records as a pick, so Revise carries it: am17/am18/am21); any other can't-check is the look's own ask about a page.
 * @param {import('./checkblock.js').CheckBlock} block @param {{line: number, rule: number}[]} [scoped] @returns {BlockAsk[]}
 */
export function questionsOfBlock(block, scoped = []) {
  const rank = { reading: 0, 'cant-check': 1, 'no-check': 2, check: 2 };
  return block.open.map((/** @type {any} */ q) => {
    const row = block.rows.find((r) => r.key === q.rowKey);
    const rule = Number(row?.rule);
    const base = { key: q.key, rowKey: q.rowKey, line: q.line, rule, source: /** @type {'look'} */ ('look'), ruleText: String(q.ruleText), ...(row?.pairWith !== undefined ? { pairRule: row.pairWith } : {}) };
    if (q.ask === 'reading') return { ...base, ask: /** @type {'reading'} */ ('reading'), counted: true, reading: String(q.proposal), question: readingQuestion(q.line, String(q.ruleText), String(q.proposal)) };
    if (q.ask === 'check') {
      const words = plainWords(q.proposal);
      return { ...base, ask: /** @type {'check'} */ ('check'), counted: false, reading: words, check: q.proposal, question: `Line ${q.line}, guardrail "${q.ruleText}": I propose ${words}. ${HOW_TO_ANSWER(q.line, true)}` };
    }
    if (scoped.some((x) => x.line === q.line && x.rule === rule)) return { ...base, ask: /** @type {'no-check'} */ ('no-check'), counted: true, question: `Line ${q.line}, guardrail "${q.ruleText}": ${CANT_CHECK_WORDS} ${HOW_TO_ANSWER(q.line, false)}` };
    return { ...base, ask: /** @type {'cant-check'} */ ('cant-check'), counted: true, question: cantCheckQuestion(q.line, String(q.ruleText)) };
  }).sort((a, b) => rank[a.ask] - rank[b.ask]);
}

/**
 * The person's choices back into the block, one by one (the choice decides, never the words). A choice the block refuses is returned with its plain reason; the question stays open.
 * @param {import('./checkblock.js').CheckBlock} block @param {{key: string, choice: string, text?: string}[]} choices @returns {{key: string, why: string}[]}
 */
export function applyChoices(block, choices) {
  /** @type {{key: string, why: string}[]} */
  const refused = [];
  for (const c of choices) {
    const r = block.applyAnswer(c.key, c.choice, c.text);
    if (!r.ok) refused.push({ key: c.key, why: r.why });
  }
  block.reconcile();
  return refused;
}
