// M20 am3b item 2: what a plan folder's own files say, apart from the sign: its verdict, its questions with their answers, and the key scrub. Moved out of
// src/authoring.js so src/setup.js (which records them) and src/authoring.js (which calls writeSetup) no longer import each other.
import { readDraftLog, readJsonFile } from './flow.js';
import { readFileInside } from './inside.js';
import { isRec } from './isrec.js';
import { parseSignedText } from './signed-text.js';

export const SPEC_HASH_FILE = 'spec.hash';
/** Written when the end sweep finds a key in the draft dir; sign refuses a dir that has it. */
export const LEAK_MARKER_FILE = 'scrub-leak.red';
/**
 * M20 am3 item 12: the ONE reader of one plan folder's verdict, from its files (`spec.hash`, `scrub-leak.red`, `log.json`). Green = a
 * non-empty spec.hash; red = a leak marker or a log that says not ok (`reds` = the log's own reds, then the marker's text); none otherwise.
 * `hashFile` and `leak` are the raw reads, so sign can name a missing or refused file in its own words. Callers scrub `reds` themselves.
 * @param {string} dir the folder that holds the plan folder @param {string} [rel] `draft`, `draft-<n>` or `.` (the plan folder itself)
 * @returns {{verdict: 'green'|'red'|'none', hash: string|null, hashFile: ReturnType<typeof readFileInside>, leak: ReturnType<typeof readFileInside>, log: any, reds: string[]}}
 */
export function draftVerdict(dir, rel = '.') {
  const hashFile = readFileInside(dir, `${rel}/${SPEC_HASH_FILE}`);
  const hash = hashFile.ok && hashFile.text.trim() !== '' ? hashFile.text.trim() : null;
  const leak = readFileInside(dir, `${rel}/${LEAK_MARKER_FILE}`);
  const log = readDraftLog(dir, rel);
  const reds = [...(Array.isArray(log?.reds) ? log.reds.map(String) : []), ...(leak.ok ? [leak.text.trim()] : [])];
  return { verdict: hash ? 'green' : (leak.ok || (log && log.ok === false)) ? 'red' : 'none', hash, hashFile, leak, log, reds };
}

export const QUESTIONS_FILE = 'questions.json';
export const ANSWER_FILE = (k) => `answer-${k}.json`;

/**
 * The questions a plan folder raised and the answers on disk, READ from its files — the ONE reader (the panel's phase reader, the sign
 * checks and the page all use it). `questions` = [{ k, line, question, answer|null }], `open` = those with no answer. A blank or unreadable
 * answer file counts as no answer. No questions file = `{ questions: [], open: [] }`.
 * @param {string} planDir
 * A question the page look raised (M10 piece 3) also carries `source: 'look'`, `ask` ('reading' | 'cant-check'), `ruleNo`, `ruleText` and `proposal`; an answer file carries `at`.
 * @returns {{ questions: {k:number, line:number, question:string, answer:string|null, at?:string, rule?:string|null, choice?:'agree'|'drop'|'rule'|'column', source?:string, ask?:string, ruleNo?:number, ruleText?:string, proposal?:string|null, check?:Record<string, any>, pairRule?:number, columns?:string[], readings?:Record<string,string>}[], open: {k:number, line:number, question:string, answer:null}[] }}
 */
export function readQuestions(planDir) {
  const none = { questions: [], open: [] };
  const f = readFileInside(planDir, QUESTIONS_FILE);
  if (!f.ok) return none;
  let list;
  try { list = JSON.parse(f.text)?.questions; } catch { return none; }
  if (!Array.isArray(list)) return none;
  const questions = list.map((q, i) => {
    const k = i + 1;
    const a = readFileInside(planDir, ANSWER_FILE(k));
    let answer = null;
    let at;
    /** @type {string|null|undefined} the `~` rule the answer added (null = it left the rule Not checked), as the answer file recorded it */
    let rule;
    /** @type {'agree'|'drop'|'rule'|'column'|undefined} M10 am29: which one the answer used (`agree`, `drop` or `rule`), when the file records it */
    let choice;
    if (a.ok) {
      try {
        const j = JSON.parse(a.text);
        const t = j?.answer;
        if (typeof t === 'string' && t.trim() !== '') { answer = t; if (typeof j.at === 'string') at = j.at; if (j.rule === null || typeof j.rule === 'string') rule = j.rule; if (j.choice === 'agree' || j.choice === 'drop' || j.choice === 'rule' || j.choice === 'column') choice = j.choice; }
      } catch { /* unreadable = unanswered */ }
    }
    return {
      k, line: q.line, question: String(q.question), answer, ...(at === undefined ? {} : { at }), ...(rule === undefined ? {} : { rule }), ...(choice === undefined ? {} : { choice }),
      ...(q.source === 'look' ? { source: 'look', ask: q.ask, ruleNo: q.ruleNo, ruleText: q.ruleText, proposal: typeof q.proposal === 'string' ? q.proposal : null, ...(q.check && typeof q.check === 'object' ? { check: q.check } : {}), ...(Number.isInteger(q.pairRule) ? { pairRule: q.pairRule } : {}), ...(Array.isArray(q.columns) && q.columns.length > 0 && q.readings && typeof q.readings === 'object' ? { columns: q.columns.map(String), readings: q.readings } : {}) } : {}),
    };
  });
  return { questions, open: /** @type {any} */ (questions.filter((q) => q.answer === null)) };
}

/** Literal (never RegExp) key scrub; a secret under 8 chars is skipped so it can't blank ordinary text. */
export function scrub(text, secrets) {
  let out = text;
  for (const s of secrets) if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('[redacted-key]');
  return out;
}


/** the drafter's own "Not checked" reading, kept in a plan folder (information only; never in the readout, so never in the hash) */
export const NOT_CHECKED_FILE = 'not-checked.json';
/**
 * M20 am3 item 10: the ONE reader of a plan folder's `not-checked.json`. `notChecked` is the file's own list as it is (any type; the callers keep what they
 * accept of it: `notCheckedBlock`/`notCheckedView` filter strings, the rebuild keeps strings), `by` the tag of each line when the file holds an object, else null.
 * A missing, refused, unparseable or non-object file reads as `{notChecked: undefined, by: null}` (a plan from before amendment 25 has none).
 * @param {string} dir the folder that holds the plan folder @param {string} [rel] `draft`, `draft-<n>` or `.` (the plan folder itself)
 * @returns {{notChecked: any, by: Record<string, any>|null}}
 */
export function readNotCheckedFile(dir, rel = '.') {
  const f = readJsonFile(dir, `${rel}/${NOT_CHECKED_FILE}`);
  return { notChecked: f?.notChecked, by: isRec(f?.by) ? f.by : null };
}

/**
 * M20 am3e item 17: a draft session folder's card files, spelled and read here only. `card.json` is the first card (n 0 or none), `card-<n>.json` the card of
 * revise or redraft n. `readCard` is the tolerant read: the card object, or null (missing, refused, not JSON, not an object). A site that only asks "is there a
 * readable file" (src/draftspend.js, the money count) is not this question and keeps its own check.
 * @param {number} [n] @returns {string}
 */
export const cardFileName = (n = 0) => (n > 0 ? `card-${n}.json` : 'card.json');
/** @param {string} dir the session folder @param {number} [n] @returns {Record<string, any>|null} */
export const readCard = (dir, n = 0) => readJsonFile(dir, cardFileName(n));

/**
 * M20 am3e item 18: `redraft-<n>.json`, the marker that plan n is a redraft after the person's answers or a Drop/Add edit, not a revise. Its name and its one read:
 * the marker object as written (`fromPlan`, `answers`, `left`), or null (missing, refused, not JSON, not an object). `rowEdit` is typed: an object, or the key is
 * left out (none): a `rowEdit` that is not an object reads as none everywhere.
 * @param {number} n @returns {string}
 */
export const redraftFileName = (n) => `redraft-${n}.json`;
/** @param {string} dir the session folder @param {number} n @returns {Record<string, any>|null} */
export function readRedraftMarker(dir, n) {
  const m = readJsonFile(dir, redraftFileName(n));
  if (m === null || !Object.hasOwn(m, 'rowEdit') || isRec(m.rowEdit)) return m;
  const { rowEdit: _dropped, ...rest } = m;
  return rest;
}

/**
 * M20 am3e item 20: a draft plan folder's job text and steps, the ONE reader. `proseText` is prose.txt as it is (null when missing or refused), `parsed` the signed-text
 * parse of it (`parseSignedText`'s result, ok or not; null when there is no prose), `declaration` declaration.json as an object (null when missing, refused, not JSON or not
 * an object). Each caller keeps its own sentence for what it does when one is null. (A flow folder with a signature is `readFlow`'s; a plan that falls back to
 * declaration.rejected.json is src/panel/author.js `stepListOf`'s own question.)
 * @param {string} dir the folder that holds the plan folder @param {string} [rel] `draft`, `draft-<n>` or `.` (the plan folder itself)
 * @returns {{proseText: string|null, parsed: ReturnType<typeof parseSignedText>|null, declaration: any}}
 */
export function readPlanTexts(dir, rel = '.') {
  const prose = readFileInside(dir, `${rel}/prose.txt`);
  return { proseText: prose.ok ? prose.text : null, parsed: prose.ok ? parseSignedText(prose.text) : null, declaration: readJsonFile(dir, `${rel}/declaration.json`) };
}
