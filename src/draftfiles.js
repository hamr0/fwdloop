// M20 am3b item 2: what a plan folder's own files say, apart from the sign: its verdict, its questions with their answers, and the key scrub. Moved out of
// src/authoring.js so src/setup.js (which records them) and src/authoring.js (which calls writeSetup) no longer import each other.
import { readFileInside, readDraftLog } from './flow.js';

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

