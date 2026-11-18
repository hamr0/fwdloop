// F220 POC patch (not src/): M17 am9, a column tie asks which column. Built as a DERIVED COPY of fwd's real src/sheetlook.js (so it cannot drift from it) with exactly the replacements below; every one
// must match exactly once or the build throws. The copy is written into a scratch folder, its relative imports rewritten to absolute file URLs of src/. `src/` is never edited.
// borrowed-from: bareloop src/sheetfind.js@v0.60.0 (columnTieQuestion)
// borrowed-from: bareloop src/sheetlook.js@v0.60.0 (the tie ask: `columns`, `readings`; a tie on a line's own prose word stays dropped)
// borrowed-from: bareloop src/questionbox.js@v0.60.0 (offersOf's `columns`, refuseChoice's column rules, CHOICE_SAYS.pickColumn / notOffered)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);

const OLD_TIE = "    if (found.kind === 'tie') { dropped.push({ ...rec, reason: 'column-tie', other: found.columns.map((c) => `\"${c}\"`).join(', ') }); continue; }\n";
const NEW_TIE = [
  "    if (found.kind === 'tie' && at.rule === undefined) { dropped.push({ ...rec, reason: 'column-tie', other: found.columns.map((c) => `\"${c}\"`).join(', ') }); continue; }",
  "    if (found.kind === 'tie') {",
  "      ruleWords.add(`${at.line}\\u0000${w.word.toLowerCase()}`);",
  "      if (tiedRules.has(`${at.line}\\u0000${at.rule}`)) continue;",
  "      asks.push({ line: at.line, rule: at.rule ?? null, source: 'look', ask: 'reading', ruleText, question: columnTieQuestion(w.word, found.columns, at.line), word: w.word, columns: found.columns, readings: Object.fromEntries(found.columns.map((c) => [c, columnRuleWords(w.word, c)])) });",
  '      continue;',
  '    }',
  '',
].join('\n');
const OLD_IMPORT = "import { findColumn, columnQuestion } from './sheetfind.js';";
// the tie question's own tail (signed M17 am9 item 1): no `Answer "agree"` (fwd's columnTail says it), a closed question
const NEW_IMPORT = "import { findColumn, columnQuestion } from './sheetfind.js';\nexport const columnTieQuestion = (word, columns, line) => `I found ${columns.length} columns matching '${word}': ${columns.join(', ')}. Choose one. (your answer replaces that ~ rule on line ${line}).`;";

function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`patch: expected exactly one match of ${JSON.stringify(from.slice(0, 60))}`);
  return text.replace(from, () => to);
}

/** @param {string} outDir @param {{noTieAsk?: boolean}} [o] noTieAsk = leave the tie branch as fwd has it (the pre-break 2) @returns {string} the file URL of the patched copy */
export function buildPatchedLook(outDir, o = {}, name = 'sheetlook-tie.mjs') {
  let t = readFileSync(new URL('sheetlook.js', SRC), 'utf8');
  if (!o.noTieAsk) { t = once(t, OLD_TIE, NEW_TIE); t = once(t, OLD_IMPORT, NEW_IMPORT); }
  t = t.replace(/from '\.\/([^']+)'/g, (_m, f) => `from '${new URL(f, SRC).href}'`);
  const file = join(outDir, name);
  writeFileSync(file, t);
  return pathToFileURL(file).href;
}

// ── the door and the offers (bareloop's questionbox, fwd's words) ──
export const SAYS = Object.freeze({
  pickColumn: 'This question has a list to choose from: pick one of the columns, or Drop it. Nothing was saved.',
  notOffered: 'That choice is not offered for this question. Nothing was saved.',
});
/** which buttons a look question offers: a tie carries its columns, no Agree, no own words @param {any} q */
export function offersOf(q) {
  const look = q.source === 'look';
  const agree = look && q.ask === 'reading' && typeof q.reading === 'string';
  const drop = look && Number.isInteger(q.rule ?? q.ruleNo) && (q.ask === 'check' || q.ask === 'reading');
  const columns = look && q.ask === 'reading' && Array.isArray(q.columns) && q.columns.length > 0 ? q.columns.map(String) : undefined;
  return { agree, drop, ...(columns ? { columns } : {}) };
}
/** the door's refusal for a typed choice, or null. `strict:false` is the pre-break (accepts any column text) @param {{offers: any}} step @param {string} choice @param {string} [text] */
export function refuseChoice(step, choice, text, { strict = true } = {}) {
  if (Array.isArray(step.offers?.columns)) {
    if (choice === 'rule' || choice === 'agree') return SAYS.pickColumn;
    if (choice === 'column' && strict && !(typeof text === 'string' && step.offers.columns.includes(text))) return SAYS.pickColumn;
    return null;
  }
  if (choice === 'column') return SAYS.notOffered;
  return null;
}
/** what the answer does (ruleOfAnswer's column choice): the picked column's reading REPLACES the rule; the real `applyAnswers` swaps the word for the column in place @param {any} q */
export function ruleOfColumnAnswer(q, choice, text) {
  if (choice === 'drop') return { rule: null, left: true };
  return { rule: q.readings[text], left: false };
}
