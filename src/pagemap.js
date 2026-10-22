// borrowed-from: bareloop src/pagemap.js@54fa5ca (MAP_SHAPES, MAP_SYSTEM, mapPrompt, parseMapAnswer, MAP_UNREADABLE)
// Not copied: runPageMap (bareloop's spend and transport plumbing; fwdloop meters through the drafter's own provider call, see src/pagelook.js),
// and the ask half (DROP_IT, askableFromLook, ...), which is the next piece.
import { lineRules } from './pagebits.js';
import { validReading } from './pagerules.js';
export const MAP_SHAPES = Object.freeze(['place', 'money', 'time', 'phrase']);

export const MAP_SYSTEM = 'You map a person\'s job to the exact words of ONE saved web page. You never grade and never invent words: every string you return must be copied from the page text, character for character.';

/**
 * What the AI is told, for ONE page input. Ported from the POC prompt: the job, the `~` rules, "a result is one item", the answer form
 * and the shape meanings.
 * @param {{jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], label: string, text: string}} o
 * @returns {string}
 */
export function mapPrompt({ jobLines, label, text }) {
  const job = jobLines.map((l) => `LINE ${l.n}: ${l.text}${lineRules(l).map((r, i) => `\n~ rule ${i + 1}: ${r}`).join('')}`).join('\n');
  return `THE JOB (each ~ rule applies to the line above it):\n${job}\n\n`
    + 'A "result" is one item the page lists (one flight, one stay, one row). For each job line and for each rule, say which fact(s) every result must carry, and give the PAGE\'S OWN WORDS for it.\n\n'
    + 'Return ONLY a JSON object, no prose, no code fence:\n'
    + '{"facts":[{"name":"<letters and spaces only>","from":"<line N | line N rule M>","shape":"place|money|time|phrase","words":["<page words>", ...],"currency":["<symbol>"],"unit":["<words after the amount>"],"reading":<optional, see below>}]}\n\n'
    + 'shape meanings:\n'
    + '- place: words = ways the page writes the place (a city, an airport name), copied from the page.\n'
    + '- money: words = the label(s) written right BEFORE the amount, copied from the page. currency / unit = how the page writes the currency ("$") and/or the words after the amount ("US dollars"); give every spelling the page uses, as lists.\n'
    + '- time: words = the label(s) written right BEFORE the time that is the one the rule is about, copied from the page.\n'
    + '- phrase: words = fixed words a result\'s text must contain, copied from the page.\n'
    + 'Several words in one list are alternatives for the same fact. Put the best one first.\n'
    + 'reading (optional, only on a time or money fact): when a ~ rule is a limit on that fact that the page cannot hold in words (for example "not a red-eye" is a limit on the departure time), give your own best reading of the rule as that limit: {"op":"between","lo":<bound>,"hi":<bound>} or {"op":"lt|lte|gt|gte","value":<bound>}. A time bound is a "HH:MM" string on a 24-hour clock; a money bound is a number. Leave reading out when a page word already carries the rule.\n\n'
    + `PAGE TEXT (the input "${label}"):\n${text}`;
}

/**
 * Read the AI's answer: ONE JSON object of the answer form, and nothing else. No repair (hamr's ruling): text that is not JSON, JSON of
 * another form, or a fact whose shape or lists are not of the form is a malformed answer.
 * @param {unknown} text @returns {{ok: true, mapping: import('./pagerules.js').PageMap}|{ok: false}}
 */
export function parseMapAnswer(text) {
  /** @type {any} */
  let m;
  try { m = JSON.parse(String(text ?? '').trim()); } catch { return { ok: false }; }
  const strs = (/** @type {unknown} */ v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (m === null || typeof m !== 'object' || Array.isArray(m) || !Array.isArray(m.facts)) return { ok: false };
  for (const f of m.facts) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return { ok: false };
    if (typeof f.name !== 'string' || !MAP_SHAPES.includes(f.shape) || !strs(f.words)) return { ok: false };
    if (f.from !== undefined && typeof f.from !== 'string') return { ok: false };
    for (const k of ['currency', 'unit']) if (f[k] !== undefined && !strs(f[k])) return { ok: false };
    // PRD v1.107 Part 5b: a `reading` is a limit of the signed-rule shape on a time or money fact; any other is a malformed answer (no repair)
    if (f.reading !== undefined && !validReading(f.shape, f.reading)) return { ok: false };
  }
  return { ok: true, mapping: m };
}

/** the plain-word stop when the answer was not readable twice (no Resume: a draft is not a run) */
export const MAP_UNREADABLE = 'The AI\'s answer about the page was not readable twice. Nothing was signed.';
