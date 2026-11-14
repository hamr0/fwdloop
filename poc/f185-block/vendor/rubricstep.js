// borrowed-from: bareloop src/rubricstep.js@v0.56.0 (3383cce)
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRubric, checkStep, renderGaps, numbersInQuote } from 'bareguard';
import { dropRows, dropLine } from './pagedropwords.js';
import { OFFERED, plainWords } from './checkwords.js';
import { factPartOf, factShapeReds, factDecides, factClaims, factRows, plainFactItem, factBrief, writtenSpans } from './facts.js';

// PART 1a (docs/product/ITEM33-BUILD.md, "Addendum 2026-10-12"): the rubric job on LOCAL FILES — what one job line leaves
// behind and how it is told to the worker.
//
// One output per job line: `output/steps/<n>.json`, a JSON object
//
//     { "text": "<the answer for line n>",
//       "cites": { "<input label>": [ { "claim": "<one thing the text relies on>", "quote": "<words copied from that input>" } ] } }
//
// The `rubric-step` close kind (src/kinds.js) grades it with bareguard's rubric primitive; the worker's brief (the goal
// this module writes) and the composer's prompt (src/authorflow.js) both quote the SAME contract text from here, so the
// file the worker is told to write and the file the close reads cannot drift.

/** where the per-line step files live, inside the job's tree; `copyOut` delivers them with the rest of `output/` */
export const STEP_DIR = 'output/steps';
/** a step file's tree-relative path @param {number} n the job line number @returns {string} */
export const stepFileRel = (n) => `${STEP_DIR}/${n}.json`;
/** the largest step file the close reads: a bigger one is a stop, never silently truncated (bareguard's own source cap) */
export const STEP_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The one statement of the step-file shape, in plain words. The worker's goal and the composer's prompt both carry it.
 * @returns {string}
 */
export function stepFileContract() {
  return [
    `For each numbered job line N, write ONE file ${STEP_DIR}/N.json: a JSON object with exactly these keys.`,
    '  "text"  — your answer for that line, as a string.',
    '  "cites" — an object: for each input you drew on, its label as the key and a list of {"claim", "quote"} as the value.',
    '            "claim" is one thing your text relies on; "quote" is words copied EXACTLY from that input (spacing and',
    '            ** or __ marks do not matter). Every number in a claim must also appear in its quote.',
    '  In each claim, copy every number, time and price exactly as the input writes it (for example "9:27 AM", not "09:27"),',
    '  because the check matches the numbers in your claim against your quote.',
    'A job line the brief below marks as a FACTS line is different: its file holds {"results": [{"quote": "...", "values":',
    '{"<fact>": "<value>"}}]} — one result per thing found, one quote copied exactly from the text of that one result, the values written as the quote',
    'writes them; no "cites". It holds a "text" too only when the brief says it is also a TEXT line (the person asked for limits on the words, so',
    'the same file carries both "results" and "text"). A line the brief marks as a TEXT line keeps "text" (free words), and every number in it',
    'must be copied from a quote of an earlier facts line.',
    'Write nothing outside output/, and never edit the files under input/. The file must be complete, valid JSON: a file cut',
    'off before its closing brace counts as not written.',
  ].join('\n');
}

/**
 * R10 (fwd am28, rewritten here): what a facts+text line's worker is told about the person's picks, one plain line per pick, the values and what counts, never a verdict and never any other
 * check. Written by code from the signed pick parts; a list item is what bareguard's listItems counts (its own line starting with "1." or "- " and a space).
 * @param {any[]} picked countable parts (`{check, value, names, ...}`) @returns {string[]}
 */
export function toldPicks(picked) {
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map((x) => String(x)).join(', ') : '');
  return picked.map((p) => {
    switch (p.check) {
      case 'listItems': return `Your "text" must have exactly ${p.value} list items; a list item is its own line starting with "1." or "- " followed by a space and its text.`;
      case 'maxListItems': return `Your "text" must have at most ${p.value} list items; a list item is its own line starting with "1." or "- " followed by a space and its text.`;
      case 'minListItems': return `Your "text" must have at least ${p.value} list items; a list item is its own line starting with "1." or "- " followed by a space and its text.`;
      case 'nonEmpty': return 'Your "text" must not be empty.';
      case 'mustCarry': return `Your "text" must carry ${list(p.phrases)}.`;
      case 'blockLines': return `Your "text" must be in blocks of ${p.size} lines, each carrying ${list(p.phrases)}.`;
      default: return `Your "text" must have ${plainWords({ ...p, rule: p.check })}.`;
    }
  });
}

/**
 * What the worker is told about each line, from the close that will grade it (PART 1b item 7): a FACTS line gets its
 * facts and its count; a TEXT line that follows a facts line is told its numbers come from that line's quotes. Written by code from
 * the signed parts, never by a model. A line with no rubric-step stage gets nothing here.
 * @param {any} closeDecl @returns {{line: number, text: string}[]}
 */
export function lineBriefs(closeDecl) {
  const stages = isRec(closeDecl) && Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  /** @type {{line: number, text: string}[]} */
  const out = [];
  for (const st of stages) {
    if (!(isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && Array.isArray(st.params.parts) && Number.isInteger(st.params.step))) continue;
    const n = st.params.step;
    const fp = factPartOf(st.params);
    if (fp) {
      const c = isRec(fp.count) ? fp.count : null;
      const count = !c ? 'one result for every one you find' : c.min !== undefined && c.max !== undefined
        ? (c.min === c.max ? `exactly ${c.min} result${c.min === 1 ? '' : 's'}` : `${c.min} to ${c.max} results`)
        : c.min !== undefined ? `at least ${c.min} results` : `at most ${c.max} results`;
      // keep-both: the person's picks (countable parts) sit beside the fact on this line, so the same file also carries the "text" they limit
      const alsoText = st.params.parts.some((/** @type {any} */ q) => isRec(q) && q.class === 'countable');
      // R10 (fwd am28): the picks among them, as the signed close's own record names them, are told to the worker in plain words
      const record = Array.isArray(closeDecl.picks) ? closeDecl.picks : [];
      const picked = st.params.parts.filter((/** @type {any} */ q) => isRec(q) && q.class === 'countable' && OFFERED.includes(q.check) && record.some((/** @type {any} */ x) => isRec(x) && x.line === n && sameJson(x.part, q)));
      out.push({
        line: n,
        text: [
          alsoText
            ? `Job line ${n} is a FACTS line AND a TEXT line. Write ${stepFileRel(n)} as {"results": [{"quote": "...", "values": {...}}], "text": "..."} — the results are the facts below, the "text" is your answer to the line in your own words (its limits are in the line's ~ rules); no "cites".`
            : `Job line ${n} is a FACTS line. Write ${stepFileRel(n)} as {"results": [{"quote": "...", "values": {...}}]} and nothing else — no "text", no "cites".`,
          ...(alsoText && picked.length ? toldPicks(picked).map((t) => `  ${t}`) : []),
          `  One result per thing you find in the input "${fp.source}": ${count}.`,
          '  "quote": ONE quote per result, copied exactly from that result\'s own text in the input (at most 4000 characters) — never joined from two results.',
          '  "values": one entry per fact below, written exactly as the quote writes it (for example "9:27 AM", not "09:27"; "389", not "389.00").',
          ...fp.facts.map((/** @type {any} */ f) => `    - ${factBrief(f)}`),
        ].join('\n'),
      });
      continue;
    }
    const tie = st.params.parts.find((/** @type {any} */ x) => isRec(x) && x.class === 'countable' && x.check === 'numbersFromFacts');
    if (tie) {
      out.push({
        line: n,
        text: `Job line ${n} is a TEXT line. Write ${stepFileRel(n)} as {"text": "..."}. Your words are free, but every number in the text must be copied exactly as it is written in a quote you wrote for job line ${tie.from.join(', ')} — use no other number.`,
      });
    }
  }
  return out;
}

/**
 * The worker's goal for a rubric job on local files — written by code from the person's own numbered lines, never by a
 * model. It states everything the close will judge about the FORM of the answer (the file, the keys, the quotes); what
 * each line asks for stays in the person's own words, with its `~` rules beneath it.
 * @param {{jobLines: {n: number, text: string, rule: string}[], files: {label: string, rel: string}[], confirmedGoal?: string|null, closeDecl?: any}} o
 *   `confirmedGoal` — the one goal sentence the person confirmed in the confirm turn, kept as the plan line
 *   `closeDecl` — the drafted close: with it, each line is briefed by what its stage checks (a facts line or a text line, `lineBriefs`)
 * @returns {string}
 */
export function rubricGoal({ jobLines, files, confirmedGoal = null, closeDecl = null }) {
  const inputs = files.map((f) => `  - ${f.label}: ${f.rel}`).join('\n');
  const lines = jobLines.map((l) => `${l.n}. ${l.text}${l.rule ? `\n   rule: ${l.rule}` : ''}`).join('\n');
  return [
    RUBRIC_GOAL_HEAD,
    `The input files (label: file):\n${inputs}`,
    stepFileContract(),
    `The job, line by line:\n${lines}`,
    ...(closeDecl ? lineBriefs(closeDecl).map((b) => b.text) : []),
    ...(confirmedGoal ? [`${CONFIRMED_GOAL_PREFIX}${confirmedGoal}`] : []),
  ].join('\n\n');
}

/**
 * What a rubric job's goal text is: the worker brief `rubricGoal` builds. The Job tab's "AI's summary" is only the one
 * sentence the person confirmed, never this brief, so the first line and the confirmed-sentence prefix have ONE spelling.
 */
export const RUBRIC_GOAL_HEAD = 'Do the job below from the input files, then write one JSON file per numbered line.';
const CONFIRMED_GOAL_PREFIX = 'The plan the person confirmed: ';

/**
 * The sentence the person confirmed, out of a goal text: for a rubric brief the rest of the `CONFIRMED_GOAL_PREFIX` line,
 * or null when the brief has none; any other goal (a code job's) comes back unchanged.
 * @param {string} goal
 * @returns {string|null}
 */
export function confirmedGoalOf(goal) {
  if (!goal.startsWith(RUBRIC_GOAL_HEAD)) return goal;
  const line = goal.split('\n').find((l) => l.startsWith(CONFIRMED_GOAL_PREFIX));
  const sentence = line ? line.slice(CONFIRMED_GOAL_PREFIX.length).trim() : '';
  return sentence || null;
}

// ── the `rubric-step` stage: its parameters, and the rubric they build ───────────────────────────────────────────────
//
// A stage serves exactly ONE job line N and reads exactly one file, output/steps/N.json. Its parameters are
//
//     step   N
//     parts  [ { text, class, ... } ]   — the person's constraints on that line, each SORTED by the drafter
//
// A part's class is one of `countable` (a limit a machine counts, or a quote a claim must show), `judged` (needs the
// judge — stored, never run in this build), `guard` (a rule about web sources — needs a web input, none exist yet) or
// `none` (the drafter could not sort it). Only `countable` parts become checks; the others are REDS at drafting
// (src/authoring.js `checkRubricParts`) so no signed stage ever carries one.

/** the closed set of classes a part is sorted into; `none` = "I could not sort this one" (a red, in plain words, never a guess) */
export const PART_CLASSES = Object.freeze(['countable', 'fact', 'judged', 'guard', 'none']);
/**
 * The counted/quoted checks a `countable` part may name, with the fields each needs — read off bareguard's own rule table
 * (`rubricVocabulary`): the names are bareguard's, so a check this build cannot run is inexpressible, not rejected late.
 * (`max`/`min` need a numeric field the step file does not have, so they are not offered.)
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const COUNT_CHECKS = Object.freeze({
  maxWords: Object.freeze(['value']),
  minWords: Object.freeze(['value']),
  maxLines: Object.freeze(['value']),
  sections: Object.freeze(['names']),
  sectionWords: Object.freeze(['names', 'wordsPerSection']),
  // R10 (bareguard 0.31, fwdloop v0.29.0 OFFERED): the five text checks a person's pick may carry; the drafter never writes them
  nonEmpty: Object.freeze([]),
  listItems: Object.freeze(['value']),
  maxListItems: Object.freeze(['value']), // bareguard 0.35 (F315): an at-most / at-least bound on the list items, beside the exact listItems
  minListItems: Object.freeze(['value']),
  sectionOrder: Object.freeze(['names']),
  mustCarry: Object.freeze(['phrases']),
  blockLines: Object.freeze(['size', 'phrases']),
  cited: Object.freeze(['source']),
  // a COUNT of the claims listed under an input: the code counts the list (flattenStep), bareguard's own min/max compares it
  minClaims: Object.freeze(['value', 'source']),
  maxClaims: Object.freeze(['value', 'source']),
  // PART 1b: put on every prose step by CODE (`withFactBindings`) when an earlier line is a fact step — every number in the text
  // must be in a checked quote of those lines. The model never writes it; bareguard's `numbersInQuote` reads it (gradeStep).
  numbersFromFacts: Object.freeze(['from']),
});
/** every field a part may carry, whatever its class */
const PART_FIELDS = Object.freeze(['text', 'class', 'check', 'value', 'names', 'wordsPerSection', 'source', 'domains', 'phrases', 'size', 'covers', 'rules', 'from', 'record', 'facts', 'count', 'tested', 'sample']);

/** @typedef {{code: string, path: string, detail: string}} ShapeRed */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v @returns {string} JSON with every object's keys sorted, so two equal parts compare equal whatever order their keys were written in */
const sortedJson = (v) => JSON.stringify(v, (_k, x) => (isRec(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
/** @param {unknown} a @param {unknown} b */
const sameJson = (a, b) => sortedJson(a) === sortedJson(b);
/** @param {unknown} v @returns {v is string} */
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
/** @param {unknown} v @returns {v is string[]} */
const nameList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => nonEmpty(x) && x.length <= 1000);

/**
 * The SHAPE of a `rubric-step` stage's parameters — what a part may carry — and nothing about which class is allowed in
 * this build (that is `checkRubricParts`, which also sees the whole job). Pure, never throws.
 * @param {unknown} p the stage's `params`
 * @param {string} at the path prefix for reds, e.g. `stages[1].params`
 * @returns {ShapeRed[]}
 */
export function rubricStepShapeReds(p, at) {
  /** @type {ShapeRed[]} */
  const reds = [];
  const red = (/** @type {string} */ code, /** @type {string} */ path, /** @type {string} */ detail) => reds.push({ code, path, detail });
  if (!isRec(p)) { red('invalid-value', at, 'an object {step, parts}'); return reds; }
  if (!(Number.isInteger(p.step) && p.step >= 1)) red('invalid-value', `${at}.step`, 'the number of the job line this stage serves (an integer, 1 or more)');
  if (!Array.isArray(p.parts)) { red('invalid-value', `${at}.parts`, 'an array of {text, class, ...} — one entry per constraint the person put on this line (may be empty)'); return reds; }
  p.parts.forEach((/** @type {any} */ part, /** @type {number} */ i) => {
    const w = `${at}.parts[${i}]`;
    if (!isRec(part)) { red('invalid-value', w, '{text, class, ...}'); return; }
    for (const k of Object.keys(part)) {
      if (!PART_FIELDS.includes(k)) red('invalid-value', `${w}.${k}`, `"${k}" is not a field of a part — fields: ${PART_FIELDS.join(', ')}`);
    }
    if (!nonEmpty(part.text)) red('missing-field', `${w}.text`, 'the part, in the person\'s own words (a non-empty string)');
    if (!PART_CLASSES.includes(part.class)) { red('invalid-value', `${w}.class`, `one of ${PART_CLASSES.join(' | ')}`); return; }
    if (Object.hasOwn(part, 'covers') && !(Array.isArray(part.covers) && part.covers.length > 0 && new Set(part.covers).size === part.covers.length
      && part.covers.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1))) {
      red('invalid-value', `${w}.covers`, 'the numbers of the confirmed checks this part carries out (distinct integers, 1 or more)');
    }
    if (Object.hasOwn(part, 'rules') && !(Array.isArray(part.rules) && part.rules.length > 0 && new Set(part.rules).size === part.rules.length
      && part.rules.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1))) {
      red('invalid-value', `${w}.rules`, 'the numbers of the line\'s ~ rules this part carries out (distinct integers, 1 or more)');
    }
    if (part.class === 'fact') { factShapeReds(part, w, (c, path, d) => red(c, path, d)); return; }
    if (part.class === 'guard') {
      if (!nameList(part.domains)) red('invalid-value', `${w}.domains`, 'a non-empty array of web domains the rule is about');
      return;
    }
    if (part.class !== 'countable') return;
    if (!Object.hasOwn(COUNT_CHECKS, part.check)) { red('invalid-value', `${w}.check`, `one of ${Object.keys(COUNT_CHECKS).join(' | ')}`); return; }
    for (const f of COUNT_CHECKS[part.check]) {
      const ok = f === 'value' || f === 'wordsPerSection' || f === 'size' ? Number.isInteger(part[f]) && part[f] >= 1
        : f === 'names' || f === 'phrases' ? nameList(part[f])
          : f === 'from' ? Array.isArray(part.from) && part.from.length > 0 && new Set(part.from).size === part.from.length && part.from.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1)
            : nonEmpty(part.source) && part.source.length <= 128;
      if (!ok) {
        red('invalid-value', `${w}.${f}`, f === 'names' ? 'a non-empty array of section names'
          : f === 'phrases' ? 'a non-empty array of words or phrases'
          : f === 'source' ? 'the label of the input a quote must come from'
            : f === 'from' ? 'the numbers of the earlier fact lines whose checked quotes the text\'s numbers come from (distinct integers, 1 or more)'
              : 'an integer, 1 or more');
      }
    }
  });
  return reds;
}

/** the labels of the inputs a step's `cited` parts name (each once, in order) @param {any} params @returns {string[]} */
export function citedLabels(params) {
  const parts = Array.isArray(params?.parts) ? params.parts : [];
  return [...new Set(parts.filter((/** @type {any} */ x) => isRec(x) && ((x.class === 'countable' && x.check === 'cited') || x.class === 'fact')).map((/** @type {any} */ x) => String(x.source)))];
}

/**
 * The rubric spec for ONE step, built from its parameters and the sha256 of each input it cites (taken from the source
 * manifest at run start — a rubric is rebuilt per run because the inputs belong to the run, not to the signed job).
 * `happened` is bareguard's own foundational check; the `text` floor below it stops a step file whose only key is junk
 * from passing a rubric that has no countable part.
 * @param {{step: number, parts: any[]}} params
 * @param {Record<string, string>} inputShas label -> sha256 hex, for every label the step cites
 * @returns {Record<string, any>} a spec for bareguard's `createRubric`
 */
export function buildStepSpec(params, inputShas) {
  /** @type {Record<string, any>[]} */
  // a fact step has no text to floor, unless the person's picks put text checks on its line (keep-both): then "text" must be there, or an upper bound alone (maxWords) would pass an empty file
  const checks = factPartOf(params) && !params.parts.some((x) => x.class === 'countable') ? [] : [{ id: 'text-present', rule: 'nonEmpty', field: 'text' }];
  params.parts.forEach((part, i) => {
    if (part.class === 'fact') {
      // ONE bareguard `cited` check per fact part: the quote is in the frozen input, every value is in the quote and meets its rule
      checks.push({ id: `p${i + 1}-facts`, rule: 'cited', claims: `cites:${part.source}`, source: part.source, decides: factDecides(part) });
      if (part.count?.min !== undefined) checks.push({ id: `p${i + 1}-count-min`, rule: 'min', field: `claims:${part.source}`, value: part.count.min });
      if (part.count?.max !== undefined) checks.push({ id: `p${i + 1}-count-max`, rule: 'max', field: `claims:${part.source}`, value: part.count.max });
      return;
    }
    if (part.class !== 'countable') return;
    const id = `p${i + 1}-${part.check}`;
    switch (part.check) {
      case 'maxWords': case 'minWords': case 'maxLines': checks.push({ id, rule: part.check, field: 'text', value: part.value }); break;
      case 'sections': checks.push({ id, rule: 'sections', field: 'text', names: [...part.names] }); break;
      case 'sectionWords': checks.push({ id, rule: 'sectionWords', field: 'text', names: [...part.names], wordsPerSection: part.wordsPerSection }); break;
      case 'nonEmpty': checks.push({ id, rule: 'nonEmpty', field: 'text' }); break;
      case 'listItems': case 'maxListItems': case 'minListItems': checks.push({ id, rule: part.check, field: 'text', value: part.value }); break;
      case 'sectionOrder': checks.push({ id, rule: 'sectionOrder', field: 'text', names: [...part.names] }); break;
      case 'mustCarry': checks.push({ id, rule: 'mustCarry', field: 'text', phrases: [...part.phrases] }); break;
      case 'blockLines': checks.push({ id, rule: 'blockLines', field: 'text', size: part.size, phrases: [...part.phrases] }); break;
      case 'cited': checks.push({ id, rule: 'cited', claims: `cites:${part.source}`, source: part.source }); break;
      case 'minClaims': checks.push({ id, rule: 'min', field: `claims:${part.source}`, value: part.value }); break;
      case 'maxClaims': checks.push({ id, rule: 'max', field: `claims:${part.source}`, value: part.value }); break;
      case 'numbersFromFacts': break; // read in gradeStep from the earlier lines' step files (bareguard's numbersInQuote), not a rubric rule
      default: throw new Error(`rubric-step: no check named "${part.check}"`);
    }
  });
  return {
    schema: 1,
    goal: `job line ${params.step}`,
    inputs: Object.entries(inputShas).map(([name, sha256]) => ({ name, sha256 })),
    checkpoints: { [String(params.step)]: { gating: false, checks } },
  };
}

/** the sha256 of text, hex @param {string|Buffer} b @returns {string} */
export const sha256Of = (b) => createHash('sha256').update(b).digest('hex');

/**
 * The files one named check READS, tree-relative: a `rubric-step` stage's own step file (`output/steps/N.json`). Any other kind reads
 * none that a try's output can be told by, so `[]`. From the signed declaration, never guessed.
 * @param {any} closeDecl @param {string|null|undefined} checkName
 * @returns {string[]}
 */
export function judgedFilesOf(closeDecl, checkName) {
  const stages = Array.isArray(closeDecl?.stages) ? closeDecl.stages : [];
  const st = stages.find((/** @type {any} */ x) => x && x.name === checkName && x.kind === 'rubric-step');
  return st && Number.isInteger(st.params?.step) ? [stepFileRel(st.params.step)] : [];
}

/**
 * PRD v1.106 Part 5: what each file a try's `check-passes` checks read looked like WHEN it was judged: `{path, bytes, sha256}`. The step
 * file is overwritten by the next try, so the spine's `output-judged` record is the only trace; the content itself is never written (hard
 * line). A missing, non-regular or over-size file is skipped — nothing was judged there.
 * @param {any} closeDecl @param {string} workdir @param {Array<{type?: string, name?: string}>} exits a step's declared exits
 * @returns {Promise<Array<{path: string, bytes: number, sha256: string}>>}
 */
export async function outputJudgedRecords(closeDecl, workdir, exits) {
  /** @type {Array<{path: string, bytes: number, sha256: string}>} */
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(exits) ? exits : []) {
    if (!e || e.type !== 'check-passes') continue;
    for (const rel of judgedFilesOf(closeDecl, e.name)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      try {
        const abs = join(workdir, rel);
        const ls = await lstat(abs);
        if (!ls.isFile() || ls.size > STEP_MAX_BYTES) continue;
        const buf = await readFile(abs);
        out.push({ path: rel, bytes: buf.length, sha256: sha256Of(buf) });
      } catch { /* not there: nothing was judged */ }
    }
  }
  return out;
}

/**
 * The step file's bytes as the close reads them: the parsed JSON object, or WHY there is none. A file cut off mid-write
 * parses to nothing (reason `not-json`); text cut off INSIDE an otherwise valid JSON object cannot be told from a short
 * answer — that limit is documented, not hidden.
 * @param {string|null} bytes the file's text, or null when it does not exist
 * @returns {{obj: Record<string, any>, why: null}|{obj: null, why: 'missing'|'not-json'|'not-object'}}
 */
export function parseStepFile(bytes) {
  if (bytes === null) return { obj: null, why: 'missing' };
  let v;
  try { v = JSON.parse(bytes); } catch { return { obj: null, why: 'not-json' }; }
  if (!isRec(v)) return { obj: null, why: 'not-object' };
  return { obj: v, why: null };
}

/**
 * The step file as bareguard's rubric reads it: a flat object. `text` stays `text`; each label in `cites` becomes the field
 * `cites:<label>` (the name a `cited` check reads its claims from). Nothing else in the file is read.
 * @param {Record<string, any>} obj
 * @param {string[]} [countLabels] labels whose claim COUNT a minClaims/maxClaims part reads
 * @param {any} [factPart] the step's `fact` part: its `results` become claims (text built by code) under `cites:<source>`
 * @param {(Record<number, string>|undefined)[]} [asWritten] per result, the value spans a page-form fact's claim text is written with (see factClaims)
 * @returns {Record<string, any>}
 */
export function flattenStep(obj, countLabels = [], factPart = null, asWritten = []) {
  /** @type {Record<string, any>} */
  const fields = {};
  // the number of claims listed under each label a claim-count check names (0 when the label is absent): counted HERE, by
  // code, from the file's own list — the worker never writes a number the check trusts
  for (const label of countLabels) {
    const list = isRec(obj.cites) && Object.hasOwn(obj.cites, label) ? obj.cites[label] : null;
    fields[`claims:${label}`] = Array.isArray(list) ? list.length : 0;
  }
  if (factPart) {
    const claims = factClaims(factPart, obj.results, asWritten);
    fields[`claims:${factPart.source}`] = claims.length;
    fields[`cites:${factPart.source}`] = claims;
  }
  // a missing or non-string `text` is read as empty, so the one red a worker sees is "text is missing or empty"
  fields.text = typeof obj.text === 'string' ? obj.text : '';
  if (isRec(obj.cites) && !factPart) for (const [label, list] of Object.entries(obj.cites)) fields[`cites:${label}`] = list;
  return fields;
}

/**
 * One bareguard gap as a sentence the worker can act on. The numbers and names are bareguard's own measurements and the
 * person's signed limits, never anything this module infers; a gap this table does not know falls back to bareguard's own
 * rendering, so nothing is ever dropped.
 * @param {number} step @param {string} why why there was no object, when there was none
 * @param {any} g a bareguard gap
 * @param {any} [params] the stage's parameters (a fact step words its gaps by fact)
 * @returns {string}
 */
export function plainStepGap(step, why, g, params = null) {
  const file = stepFileRel(step);
  const at = `line ${step}`;
  const fact = params ? factPartOf(params) : null;
  if (fact && g.check === 'cited') {
    if (g.kind === 'missing' || g.kind === 'no-claims') return `${at}: ${file} has no results — add one result per thing you found: {"quote": ..., "values": {...}}`;
    if (g.kind === 'unsupported') return (g.items ?? []).map((/** @type {string} */ it) => `${at}: ${plainFactItem(it, fact)}`).join('\n');
    if (g.kind === 'too-many') return `${at}: the results hold too many different quotes to check (${g.measured} against a limit of ${g.limit})`;
    return `${at}: the results cannot be checked (${g.kind})`;
  }
  if (fact && (g.check === 'min' || g.check === 'max') && String(g.field ?? '').startsWith('claims:')) {
    return g.check === 'min' ? `${at}: ${g.measured ?? 0} result(s) are listed, at least ${g.limit} are required` : `${at}: ${g.measured} results are listed, at most ${g.limit} are allowed`;
  }
  if (g.check === 'happened' || g.id === 'happened') {
    const reason = why === 'missing' ? 'does not exist' : why === 'not-json' ? 'is not valid JSON (was it cut off?)' : why === 'not-object' ? 'is not a JSON object' : 'is empty';
    return `${at}: ${file} ${reason}`;
  }
  if (g.check === 'nonEmpty') return `${at}: "text" is missing or empty in ${file}`;
  if (g.check === 'maxWords') return `${at}: "text" has ${g.measured} words, at most ${g.limit} are allowed`;
  if (g.check === 'minWords') return `${at}: "text" has ${g.measured} words, at least ${g.limit} are required`;
  if (g.check === 'maxLines') return `${at}: "text" has ${g.measured} lines, at most ${g.limit} are allowed`;
  if (g.check === 'sections') return `${at}: "text" is missing section(s): ${(g.items ?? []).join(', ')}`;
  if (g.check === 'maxListItems') return `${at}: "text" has ${g.measured} list items, at most ${g.limit} are allowed`;
  if (g.check === 'minListItems') return `${at}: "text" has ${g.measured} list items, at least ${g.limit} are required`;
  if (g.check === 'listItems') return `${at}: "text" has ${g.measured} list items, exactly ${g.limit} are required`;
  if (g.check === 'sectionOrder') return `${at}: "text" does not hold its sections in the asked order (${(g.items ?? []).map((/** @type {string} */ x) => x.replace(/^[^:]*:/, '')).join(', ')} out of place)`;
  if (g.check === 'mustCarry') return `${at}: "text" does not carry: ${(g.items ?? []).join(', ')}`;
  if (g.check === 'blockLines') return `${at}: "text" is not in blocks of ${g.limit} lines each carrying the asked words (${(g.items ?? []).join(', ')})`;
  if ((g.check === 'min' || g.check === 'max') && String(g.field ?? '').startsWith('claims:')) {
    const label = String(g.field).slice('claims:'.length);
    return g.check === 'min'
      ? `${at}: only ${g.measured ?? 0} claim(s) are listed under "${label}" in "cites", at least ${g.limit} are required`
      : `${at}: ${g.measured} claims are listed under "${label}" in "cites", at most ${g.limit} are allowed`;
  }
  if (g.check === 'cited') {
    const label = String(g.field ?? '').replace(/^cites:/, '');
    if (g.kind === 'missing') return `${at}: "cites" has nothing under "${label}" — list each claim with a quote copied from that input`;
    if (g.kind === 'no-claims') return `${at}: "cites.${label}" is empty — list each claim with a quote copied from that input`;
    if (g.kind === 'unsupported') return `${at}: ${g.measured} of ${g.limit} quotes under "${label}" are not found word for word in that input, or carry a number the quote lacks: ${(g.items ?? []).join(', ')}`;
    return `${at}: "cites.${label}" cannot be checked (${g.kind})`;
  }
  return `${at}: ${renderGaps([g])}`;
}

/**
 * Grade ONE step: build the rubric, run it over the step file's fields, and say what happened in the close's own terms.
 * Pure of the filesystem (the runner in src/kinds.js reads the files). `stopped` = the instrument failed (never a red).
 * @param {{params: {step: number, parts: any[]}, bytes: string|null, outputBytes: string|null, inputs: Record<string, string>,
 *   factQuotes?: Record<number, string[]>, factMissing?: number[]}} o
 *   `factQuotes` maps an earlier fact line's number to the quotes its (already checked) step file holds — what a prose step's numbers are tied to
 *   `factMissing` lists the earlier fact lines whose step file is not there (yet): a normal red, never an instrument fault
 *   `inputs` maps each cited label to its frozen TEXT; its sha256 is taken here from that text, and bareguard compares it to
 *   the manifest's recorded sha via `inputShas`.
 * @param {Record<string, string>} inputShas the manifest's recorded sha256 per cited label
 * @returns {Promise<{verdict: 'green'|'red'|'stopped', gapLines: string[], fault: string|null, detail: Record<string, any>,
 *   evidence?: any[], evidenceTotal?: number}>} `evidence`/`evidenceTotal` are bareguard's `full.evidence` (what each `cited` check read), carried out
 *   for the report-only `rubric-evidence` spine record; no verdict, gap or count above is derived from them
 */
export async function gradeStep({ params, bytes, outputBytes, inputs, factQuotes = {}, factMissing = [] }, inputShas) {
  let rubric;
  try { rubric = createRubric(buildStepSpec(params, inputShas)); } catch (e) {
    return { verdict: 'stopped', gapLines: [], fault: `the rubric for job line ${params.step} could not be built: ${/** @type {Error} */ (e).message}`, detail: {} };
  }
  const parsed = parseStepFile(bytes);
  const countLabels = [...new Set(params.parts.filter((/** @type {any} */ x) => x.class === 'countable' && (x.check === 'minClaims' || x.check === 'maxClaims')).map((/** @type {any} */ x) => String(x.source)))];
  const factPart = factPartOf(params);
  const check = (/** @type {(Record<number, string>|undefined)[]} */ asWritten = []) => checkStep(rubric, String(params.step), parsed.obj === null ? null : flattenStep(parsed.obj, countLabels, factPart, asWritten), {
    inputs, ...(outputBytes === null ? {} : { outputBytes }),
  });
  let r = await check();
  // a fact that signs a page form (`lang` / `decimal`) has a canonical value but its claim text must spell it as the quote does: bareguard's own
  // evidence of where it read the value in each quote gives the spelling, and the same file is checked once more with the text written so. Both
  // passes are the one bareguard reader; the verdict, gap and counts below come from the last.
  if (factPart && Array.isArray(factPart.facts) && factPart.facts.some((/** @type {any} */ f) => isRec(f) && (f.lang !== undefined || f.decimal !== undefined))) {
    const written = writtenSpans(factPart, r.full.evidence);
    if (written.some(Boolean)) r = await check(written);
  }
  // PART 1b: a prose step's numbers are tied to the checked facts of earlier lines (bareguard's `numbersInQuote`: token match on the
  // numbers, not a canonical compare — a documented limit). Words are free; a number that no checked quote holds is a red.
  /** @type {string[]} */
  const extra = [];
  let extraCount = 0;
  const tie = params.parts.find((/** @type {any} */ x) => isRec(x) && x.class === 'countable' && x.check === 'numbersFromFacts');
  if (tie) {
    for (const n of factMissing) {
      extraCount += 1;
      extra.push(`line ${n}'s answer is not there yet (${stepFileRel(n)}), so the numbers in line ${params.step}'s text cannot be tied to it`);
    }
  }
  if (tie && parsed.obj !== null && typeof parsed.obj.text === 'string') {
    const quotes = tie.from.flatMap((/** @type {number} */ n) => factQuotes[n] ?? []);
    const t = numbersInQuote(parsed.obj.text, quotes.join('\n'));
    if (!t.ok) {
      extraCount = t.missing.length || 1;
      extra.push(`line ${params.step}: "text" has number(s) ${t.missing.join(', ')} that no checked quote of line ${tie.from.join(', ')} holds — use only numbers from those quotes, written as they write them`);
    }
  }
  // the stage's ONE trend number for the fix-loop governor (F192 e, mirrored): failing CLAIMS under a `cited` check (bareguard's
  // own `measured` count of unsupported quotes), plus 1 for every other failing check — lower is better, compared to the
  // best so far through the same `closeGrade` {stage, value} path numeric stages use
  const redCount = extraCount + r.full.gaps.reduce((/** @type {number} */ n, /** @type {any} */ g) => n + (g.check === 'cited' && g.kind === 'unsupported' && typeof g.measured === 'number' ? g.measured : 1), 0);
  const detail = { step: params.step, rubricSha: r.rubricSha, outputSha: r.outputSha, why: parsed.why, gaps: r.full.gaps.length, ...(r.verdict === 'red' || extra.length > 0 ? { redCount } : {}) };
  if (r.verdict === 'stopped') return { verdict: 'stopped', gapLines: [], fault: r.fault ? `${r.fault.kind}: ${r.fault.detail}` : 'the rubric stopped', detail };
  const seen = {
    ...(Array.isArray(r.full.evidence) && r.full.evidence.length > 0 ? { evidence: r.full.evidence } : {}),
    ...(typeof r.full.evidenceTotal === 'number' ? { evidenceTotal: r.full.evidenceTotal } : {}),
  };
  if (r.verdict === 'green' && extra.length === 0) return { verdict: 'green', gapLines: [], fault: null, detail, ...seen };
  return { verdict: 'red', gapLines: [...extra, ...r.gaps.flatMap((g) => plainStepGap(params.step, parsed.why ?? 'empty', g, params).split('\n'))], fault: null, detail, ...seen };
}

// ── R11: the sorting rules, applied at DRAFTING ──────────────────────────────────────────────────────────────────────

/**
 * The labels of a job's numbered inputs, or null when it carries none (a caller that has no inputs in hand skips the label rule).
 * @param {unknown} inputs @returns {string[]|null}
 */
export function inputLabelsOf(inputs) {
  if (!Array.isArray(inputs)) return null;
  const labels = inputs.map((i) => (isRec(i) ? i.label : null)).filter((l) => typeof l === 'string');
  return labels.length > 0 ? labels : null;
}

/** @param {string} text @returns {string} a person's own words, one line, bounded for a message */
const sayText = (text) => {
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 80)}…` : one;
};

/**
 * The word range a part allows, as `[min, max]` (null = no bound on that side), read off its check. `sectionWords` allows
 * each of its sections 80-120% of its asked words (bareguard's own band), so the whole text must hold at least
 * `names x ceil(0.8 x asked)` words — and at most `names x floor(1.2 x asked)` for the sections alone.
 * @param {any} part @returns {{min: number|null, max: number|null, say: string}|null}
 */
function wordRange(part) {
  if (part.check === 'maxWords') return { min: null, max: part.value, say: `at most ${part.value} words` };
  if (part.check === 'minWords') return { min: part.value, max: null, say: `at least ${part.value} words` };
  if (part.check === 'sectionWords') {
    const lo = Math.ceil(part.wordsPerSection * 0.8);
    const hi = Math.floor(part.wordsPerSection * 1.2);
    return { min: part.names.length * lo, max: null, say: `${part.names.length} section(s) of ${lo}-${hi} words each, so at least ${part.names.length * lo} words` };
  }
  return null;
}

/**
 * bareguard refuses a money unit list whose entries are equal once `**`, `__` and extra spaces are removed, naming the path
 * `...checks[K].decides[N].unit`. K indexes buildStepSpec's checks (id `p<part>-facts`), N the fact within that part.
 * @param {{step: number, parts: any[]}} p @param {unknown} path @returns {{name: string, a: string, b: string}|null} the fact and the two twin units, or null when the path is not that
 */
function dupUnitWords(p, path) {
  const m = typeof path === 'string' ? /\.checks\[(\d+)\]\.decides\[(\d+)\]\.unit$/.exec(path) : null;
  if (!m) return null;
  const id = buildStepSpec(p, {}).checkpoints[String(p.step)].checks[Number(m[1])]?.id;
  const pm = typeof id === 'string' ? /^p(\d+)-facts$/.exec(id) : null;
  const fact = pm ? p.parts[Number(pm[1]) - 1]?.facts?.[Number(m[2])] : null;
  if (!fact || !Array.isArray(fact.unit)) return null;
  const key = (/** @type {string} */ u) => u.split('**').join('').split('__').join('').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < fact.unit.length; i += 1) {
    const j = fact.unit.findIndex((/** @type {string} */ u, /** @type {number} */ k) => k > i && key(u) === key(fact.unit[i]));
    if (j > i) return { name: String(fact.name), a: fact.unit[i], b: fact.unit[j] };
  }
  return null;
}

/** The legal example the `rubric-fact-twice` red carries as its drafter-only `hint` (the person's text is the plain sentence): one fact part holding two facts, the rule it carries listed in "rules", no "count" (a picked count is a pick). */
const factTwiceExample = (/** @type {unknown} */ source) => ({
  class: 'fact', source: typeof source === 'string' ? source : 'Changelog', text: 'the release heading and a section word', rules: [1],
  facts: [{ name: 'release heading', shape: 'phrase', phrase: '## [0.54.1] - 2026-11-04' }, { name: 'section word', shape: 'phrase', phrase: '### Fixed' }],
});

/**
 * R11 — the drafting-time rules for the `rubric-step` stages of a declaration, each a red in the person's plain words that
 * names the job line and ends "Nothing spent." where nothing was. Pure; never throws. Judged parts are RED in this build
 * (the judge arrives in the next one): the sorting is still asked for, so a part that needs the judge is named as such
 * instead of being approximated by a count.
 *   - a stage serves exactly the one job line it names (`step` = its only `fromLine`), and no line has two stages;
 *   - a part with no class (`none`) cannot be counted or checked against a quote;
 *   - a `judged` part needs the judge; a `guard` part is about web sources and the job has no web input;
 *   - two countable parts of ONE line that no text can satisfy together (a minimum above a maximum) are a contradiction,
 *     naming both parts and both numbers;
 *   - a `cited` part names a label the person's inputs do not have.
 * @param {any[]} stages the declaration's stages
 * @param {{inputLabels?: string[]|null, picks?: {line: number, part: any}[]|null, red: (code: string, path: string, detail: string, extra?: object) => void}} o
 *   `inputLabels` absent = the label rule is not run (a caller with no inputs in hand);
 *   `picks` = the record of the person's picks (`declaration.picks`, `{line, part}` each): the only countable parts a fact line may carry
 */
export function checkRubricParts(stages, { inputLabels = null, red, picks = null }) {
  /** @type {Map<number, string>} */
  const owner = new Map();
  /** the stage index of each fact line (PART 1b: a prose step ties its numbers to fact lines that are checked BEFORE it) @type {Map<number, number>} */
  const factAt = new Map();
  stages.forEach((st, i) => {
    if (isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && Number.isInteger(st.params.step) && factPartOf(st.params)) factAt.set(st.params.step, i);
  });
  stages.forEach((st, i) => {
    if (!isRec(st) || st.kind !== 'rubric-step' || !isRec(st.params)) return;
    const at = `stages[${i}]`;
    const p = st.params;
    const step = p.step;
    const label = nonEmpty(st.name) ? st.name : at;
    const line = Number.isInteger(step) ? step : '?';
    if (Array.isArray(st.fromLine) && !(st.fromLine.length === 1 && st.fromLine[0] === step)) {
      red('rubric-step-line', `${at}.fromLine`, `line ${line}: stage "${label}" reads the file for job line ${line} but says it serves line(s) ${st.fromLine.join(', ')}. One rubric-step stage serves exactly its own line.`, { stage: label });
    }
    if (Number.isInteger(step)) {
      const twin = owner.get(step);
      if (twin !== undefined) red('rubric-step-twice', `${at}.params.step`, `line ${line}: stages "${twin}" and "${label}" both read the file for job line ${line}. Give each job line one stage.`, { stage: label, twin });
      else owner.set(step, label);
    }
    if (!Array.isArray(p.parts)) return;
    /** @type {{part: any, range: {min: number|null, max: number|null, say: string}}[]} */
    const ranges = [];
    const factLine = p.parts.some((/** @type {any} */ x) => isRec(x) && x.class === 'fact');
    if (!factLine) {
      const wantFrom = [...factAt].filter(([, idx]) => idx < i).map(([n]) => n);
      const tied = p.parts.find((/** @type {any} */ x) => isRec(x) && x.class === 'countable' && x.check === 'numbersFromFacts');
      if (wantFrom.length > 0 && !(tied && Array.isArray(tied.from) && wantFrom.every((n) => tied.from.includes(n)))) {
        red('rubric-numbers-unbound', `${at}.params.parts`, `line ${line}: this text step comes after the fact line(s) ${wantFrom.join(', ')}, so every number in its text must be tied to their checked quotes. Nothing spent.`, { line: step, stage: label });
      }
    }
    p.parts.forEach((/** @type {any} */ part, /** @type {number} */ j) => {
      if (!isRec(part)) return;
      const w = `${at}.params.parts[${j}]`;
      const said = sayText(part.text ?? '');
      if (part.class === 'none') {
        red('rubric-part-unsortable', w, `line ${line}: '${said}' can't be counted or checked against a quote. Say it as a count (words, sections, rows) or as something a quote must show.` + (factLine ? ' This line lists facts: a limit you can say as a time, number, date or money fact goes INSIDE its fact part (add the fact, list the rule\'s number in that part\'s "rules"); anything else goes in "refused", never a part of its own.' : ''), { line: step, stage: label });
      } else if (part.class === 'judged') {
        red('rubric-part-judged', w, `line ${line}: this rule needs the judge, which arrives in the next build. Nothing spent.` + (factLine ? ' This line lists facts: a limit you can say as a time, number, date or money fact goes INSIDE its fact part (add the fact, list the rule\'s number in that part\'s "rules"); anything else goes in "refused", never a part of its own.' : ''), { line: step, stage: label });
      } else if (part.class === 'guard') {
        red('rubric-part-guard', w, `line ${line}: '${said}' is about web sources, and this job has no web input. Nothing spent.`, { line: step, stage: label });
      } else if (part.class === 'fact') {
        if (Array.isArray(inputLabels) && !inputLabels.includes(part.source)) {
          red('rubric-part-source', `${w}.source`, `line ${line}: '${said}' asks for quotes from "${sayText(part.source ?? '')}", but the job's inputs are ${inputLabels.map((l) => `"${l}"`).join(', ')}.`, { line: step, stage: label });
        }
        if (p.parts.filter((/** @type {any} */ x) => isRec(x) && x.class === 'fact').length > 1) {
          red('rubric-fact-twice', w, `line ${line}: '${said}' is a second fact list on the same line. One line has one list of facts; put them all in one. Nothing spent.`, { line: step, stage: label, hint: `Example of ONE part holding two facts: ${JSON.stringify(factTwiceExample(part.source))}` });
        }
      } else if (part.class === 'countable') {
        if (part.check === 'numbersFromFacts') {
          const bad = Array.isArray(part.from) ? part.from.filter((/** @type {number} */ n) => !(factAt.has(n) && /** @type {number} */ (factAt.get(n)) < i)) : [];
          if (factLine || bad.length > 0) {
            red('rubric-numbers-source', `${w}.from`, `line ${line}: the numbers in the text are tied to line(s) ${bad.length ? bad.join(', ') : part.from}, which are not fact lines checked before this one. Nothing spent.`, { line: step, stage: label });
          }
          return;
        }
        // keep-both: a fact line may carry a countable part only when it IS one of the person's recorded picks (an offered check, its `rules`, the same line, the same words)
        const isPick = factLine && Array.isArray(picks) && picks.some((x) => isRec(x) && x.line === step && sameJson(x.part, part)) && OFFERED.includes(part.check) && Array.isArray(part.rules);
        if (factLine && !isPick) {
          red('rubric-fact-text', w, `line ${line}: '${said}' counts or quotes free text, but this line lists facts and has no text. Say it as a fact (a shape and a rule) or remove it. Nothing spent.`, { line: step, stage: label });
          return;
        }
        if (part.check === 'cited' && Array.isArray(inputLabels) && !inputLabels.includes(part.source)) {
          red('rubric-part-source', `${w}.source`, `line ${line}: '${said}' asks for a quote from "${sayText(part.source ?? '')}", but the job's inputs are ${inputLabels.map((l) => `"${l}"`).join(', ')}.`, { line: step, stage: label });
        }
        const range = wordRange(part);
        if (range) ranges.push({ part, range });
      }
    });
    if (factLine && rubricStepShapeReds(p, at).length === 0) {
      // bareguard is the judge of whether a fact list is SIGNABLE (anchors, units, bounds): ask it at drafting, at $0, so a list
      // it would refuse at run time is a red the drafter can fix now
      try { createRubric(buildStepSpec(/** @type {{step: number, parts: any[]}} */ (p), Object.fromEntries(citedLabels(p).map((l) => [l, '0'.repeat(64)])))); } catch (e) {
        const twins = dupUnitWords(/** @type {{step: number, parts: any[]}} */ (p), /** @type {{path?: unknown}} */ (e).path);
        red('rubric-fact-invalid', `${at}.params.parts`, twins ? `line ${line}: the fact '${twins.name}' lists the same unit twice ('${twins.a}' and '${twins.b}' are the same once marks and spaces are removed). Keep one. Nothing spent.` : `line ${line}: the facts cannot be signed: ${/** @type {Error} */ (e).message}`, { line: step, stage: label });
      }
    }
    for (let a = 0; a < ranges.length; a += 1) {
      for (let b = a + 1; b < ranges.length; b += 1) {
        const [x, y] = [ranges[a], ranges[b]];
        const lo = Math.max(x.range.min ?? -Infinity, y.range.min ?? -Infinity);
        const hi = Math.min(x.range.max ?? Infinity, y.range.max ?? Infinity);
        if (lo > hi) {
          red('rubric-contradiction', `${at}.params.parts`, `line ${line}: '${sayText(x.part.text)}' (${x.range.say}) and '${sayText(y.part.text)}' (${y.range.say}) cannot both be met — no text has between ${lo} and ${hi} words. Change one of them. Nothing spent.`, { line: step, stage: label });
        }
      }
    }
  });
}

/** the ~ rules of one job line, one string each (`rules` when the line has the array, else the joined `rule` split on "; ") @param {any} l @returns {string[]} */
export function lineRules(l) {
  if (isRec(l) && Array.isArray(l.rules)) return l.rules.filter((/** @type {unknown} */ r) => typeof r === 'string' && r);
  return isRec(l) && typeof l.rule === 'string' && l.rule ? l.rule.split('; ').filter(Boolean) : [];
}

/** @param {string} t @returns {string} a time token as compared: no spaces, lower case, no leading zero on the hour */
const timeKey = (t) => t.replace(/\s+/g, '').toLowerCase().replace(/^0(?=\d:)/, '');

/**
 * The person's words read by KIND, so a digit inside a time, a date or an amount belongs to that token only (F242).
 * @param {string} text @returns {{bare: Set<number>, amount: Set<number>, time: Set<string>, date: Set<string>}}
 */
const tokensSaid = (text) => {
  const out = { bare: new Set(), amount: new Set(), time: new Set(), date: new Set() };
  const re = /(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)|(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})|([$\u20ac\u00a3]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)|(\d[\d,]*(?:\.\d+)?)/gi;
  for (const m of text.matchAll(re)) {
    if (m[1]) out.time.add(timeKey(m[1]));
    else if (m[2]) out.date.add(m[2]);
    else if (m[3]) out.amount.add(Number(m[3].match(/\d[\d,]*(?:\.\d+)?/)?.[0].replace(/,/g, '')));
    else out.bare.add(Number(m[4].replace(/,/g, '')));
  }
  return out;
};

/**
 * Is this rule bound in the words the person wrote? The ONE test for "a number the AI made" (`rubric-fact-unmarked`, the L3 settle, and
 * the early ask of PRD v1.107 Part 5b all read it; never a second spelling). By kind: a number is said only as a bare number or an
 * amount's number; a time only as a time token (hour leading zero ignored); a date only as a date token. Never a piece of a token.
 * @param {unknown} b @param {string} said @returns {boolean}
 */
export const boundInWords = (b, said) => {
  const t = tokensSaid(said);
  if (typeof b === 'number') return t.bare.has(b) || t.amount.has(b);
  if (typeof b !== 'string') return false;
  return /^\s*\d{1,2}:\d{2}/.test(b) ? t.time.has(timeKey(b)) : t.date.has(b.trim());
};

/** @param {any} jl one job line @returns {string} the words the person wrote on it: the line and its `~` rules */
export const wordsSaidOn = (jl) => `${jl.text ?? ''} ${lineRules(jl).join(' ')}`;

/**
 * PART 1b, RF16 + RF17 — the rules that need the person's own job lines. Only a close built for REQUIRED FACTS is held to them (a
 * close with a fact part, or any part that says which `~` rules it carries out): an older Part 1a close is left as it was signed.
 *   - every `~` rule of every job line is carried out by a part (its number in the part's `rules`), or is listed in `refused` with
 *     its `rule` number, or its whole line is refused: a rule that is none of those was silently dropped, and that is a red;
 *   - a number the AI made out of the person's words (a bound the person did not write) must be marked `aiProposal`, and a time
 *     limit the AI proposes must be a range (`between`), never one-sided — "not a red-eye" must not let a 10 PM flight through.
 * @param {any[]} stages @param {{jobLines?: any[]|null, refused?: any, red: (code: string, path: string, detail: string, extra?: object) => void}} o
 */
export function checkRubricRules(stages, { jobLines = null, refused = null, red }) {
  const rubric = stages.map((st, i) => ({ st, i })).filter(({ st }) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && Array.isArray(st.params.parts));
  const anyTag = rubric.some(({ st }) => st.params.parts.some((/** @type {any} */ x) => isRec(x) && (x.class === 'fact' || Object.hasOwn(x, 'rules'))));
  if (!anyTag || !Array.isArray(jobLines)) return;
  const refusedList = Array.isArray(refused) ? refused.filter(isRec) : [];
  for (const l of jobLines) {
    if (!isRec(l) || !Number.isInteger(l.n)) continue;
    const rules = lineRules(l);
    const wholeLine = refusedList.some((r) => r.line === l.n && !Object.hasOwn(r, 'rule'));
    const carried = new Set(rubric.filter(({ st }) => st.params.step === l.n).flatMap(({ st }) => st.params.parts.flatMap((/** @type {any} */ x) => (isRec(x) && Array.isArray(x.rules) ? x.rules : []))));
    rules.forEach((text, k) => {
      const n = k + 1;
      if (wholeLine || carried.has(n) || refusedList.some((r) => r.line === l.n && r.rule === n)) return;
      red('rubric-rule-dropped', `jobLines[${l.n - 1}].rules[${k}]`, `line ${l.n}: your rule "${sayText(text)}" is neither checked nor listed under Not checked. Make it a check (list ${n} in the part's "rules") or list it in "refused" as {"line": ${l.n}, "rule": ${n}, "reason": "..."}. Nothing spent.`, { line: l.n, rule: n });
    });
  }
  for (const { st, i } of rubric) {
    const fp = factPartOf(st.params);
    if (!fp || !Array.isArray(fp.facts)) continue;
    const jl = jobLines.find((l) => isRec(l) && l.n === st.params.step);
    const said = jl ? wordsSaidOn(jl) : null;
    fp.facts.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
      if (!isRec(f) || !isRec(f.rule)) return;
      const w = `stages[${i}].params.parts[${st.params.parts.indexOf(fp)}].facts[${j}]`;
      const bounds = f.rule.op === 'between' ? [f.rule.lo, f.rule.hi] : [f.rule.value];
      if (said !== null && !f.aiProposal && bounds.some((b) => !boundInWords(b, said))) {
        red('rubric-fact-unmarked', w, `line ${st.params.step}: the limit on fact "${f.name}" (${bounds.join(' to ')}) is not in the words the person wrote, so it is the AI's own number. Set "aiProposal": true on that fact so the card says "AI's proposal — check it". Nothing spent.`, { line: st.params.step });
      }
      if (f.aiProposal && f.shape === 'time' && f.rule.op !== 'between') {
        red('rubric-fact-onesided', w, `line ${st.params.step}: fact "${f.name}" is a time limit the AI made up, and a one-sided limit lets the other end through (a 10 PM flight passes "not a red-eye"). Use a range: "op": "between" with "lo" and "hi". Nothing spent.`, { line: st.params.step });
      }
    });
  }
}

/** a clock time as a person writes it: 7:00, 07:00, 7:00 AM, 11 PM is not matched (no minutes) */
const CLOCK = '\\d{1,2}:\\d{2}(?:\\s?[AaPp][Mm])?';
const TIME_RANGE_RE = new RegExp(`\\b(?:between|from)\\s+(${CLOCK})\\s+(?:and|to|-)\\s+(${CLOCK})`, 'i');
export const NEGATING_RE = /\b(?:not|no|never|outside|except|before|after|without)\b/i;

// The limit reader (hamr ruling A, 2026-11-12): when the look tied a money or time fact to a `~` rule but gave no limit, CODE reads the limit
// from the person's own rule words. ONE amount or ONE range only; every other text is a plain reason (Not checked), never a wrong check.
// The direction words are the FACT_OPS words of src/facts.js (lt under, lte at most, gt over, gte at least) plus their plain synonyms.
const AMOUNT = '(?:[$\\u20ac\\u00a3]\\s?(\\d[\\d,]*(?:\\.\\d+)?)|(\\d[\\d,]*(?:\\.\\d+)?)\\s?(?:US\\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\\b)';
const AMOUNT_ALL_RE = new RegExp(AMOUNT, 'gi');
const MONEY_BETWEEN_RE = new RegExp(`\\bbetween\\s+${AMOUNT}\\s+(?:and|to|-)\\s+${AMOUNT}`, 'i');
const MONEY_DIRECTION_RE = new RegExp(`\\b(under|below|less than|fewer than|at most|up to|no more than|over|above|more than|at least|no less than|no fewer than)\\s+${AMOUNT}`, 'i');
const MONEY_OR_LESS_RE = new RegExp(`${AMOUNT}\\s+or\\s+(less|fewer|under|below|lower|more|over|above|higher)\\b`, 'i');
const DIRECTION_OP = /** @type {Record<string, 'lt'|'lte'|'gt'|'gte'>} */ ({ under: 'lt', below: 'lt', 'less than': 'lt', 'fewer than': 'lt', 'at most': 'lte', 'up to': 'lte', 'no more than': 'lte', over: 'gt', above: 'gt', 'more than': 'gt', 'at least': 'gte', 'no less than': 'gte', 'no fewer than': 'gte' });
const CURRENCY_STEM = /** @type {Record<string, string>} */ ({ $: 'dollar', '€': 'euro', '£': 'pound', usd: 'dollar', eur: 'euro', gbp: 'pound' });
const num = (/** @type {string|undefined} */ a, /** @type {string|undefined} */ b) => Number(String(a ?? b).replace(/,/g, ''));
const hhmm = (/** @type {string} */ t) => (/[AaPp][Mm]/.test(t) ? null : t.replace(/\s+/g, '').replace(/^(\d):/, '0$1:'));

/** does the amount token's currency (sign or word) fit the look fact's currency and unit lists? A fact with neither list fits anything. */
function currencyFits(/** @type {string} */ tok, /** @type {any} */ fact) {
  const cur = (Array.isArray(fact?.currency) ? fact.currency : fact?.currency ? [fact.currency] : []).map(String);
  const unit = (Array.isArray(fact?.unit) ? fact.unit : fact?.unit ? [fact.unit] : []).map((/** @type {unknown} */ u) => String(u).toLowerCase());
  if (!cur.length && !unit.length) return true;
  const sym = /^[$€£]/.test(tok) ? tok.charAt(0) : null;
  const last = String(tok.trim().split(/\s+/).at(-1)).toLowerCase();
  const stem = sym ? CURRENCY_STEM[sym] : (CURRENCY_STEM[last] ?? last.replace(/s$/, ''));
  return (sym !== null && cur.includes(sym)) || unit.some((/** @type {string} */ u) => u.includes(String(stem)));
}

/**
 * Does this rule text hold more than one amount (money) or more than one time range (time)? The ONE guard code's own limit read and an AI
 * reading edit both use: "under $450 or over $900" is two limits, and one reading of it would be a wrong check.
 * @param {string} shape @param {string} text @returns {boolean}
 */
export function holdsManyBounds(shape, text) {
  const t = String(text ?? '');
  if (shape === 'time') return [...t.matchAll(new RegExp(TIME_RANGE_RE.source, 'gi'))].length > 1 || (t.match(/\d{1,2}:\d{2}/g) ?? []).length > 2;
  if (shape === 'money') { const amts = [...t.matchAll(AMOUNT_ALL_RE)]; return amts.length > 1 && !(MONEY_BETWEEN_RE.test(t) && amts.length === 2); }
  return false;
}

/**
 * The limit the person's own words give a fact of this shape: `{reading}` or `{why}` (a plain reason; the rule then stays Not checked).
 * @param {string} shape money or time @param {string} text the `~` rule's words @param {any} [fact] the look fact (its currency and unit lists must fit)
 * @returns {{reading: {op: 'lt'|'lte'|'gt'|'gte', value: number} | {op: 'between', lo: number|string, hi: number|string}} | {why: string}}
 */
export function readLimit(shape, text, fact = {}) {
  const t = String(text ?? '');
  if (shape === 'time') {
    if (NEGATING_RE.test(t)) return { why: 'a one-sided or negated time (before, after, not) is not a range code can read' };
    if (/\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b/i.test(t)) return { why: 'a 12-hour time (am or pm) is not read, write it like 06:00' };
    if (holdsManyBounds('time', t)) return { why: 'more than one time range in the rule' };
    const m = TIME_RANGE_RE.exec(t);
    if (!m) return { why: 'no range between two times in the rule' };
    const lo = hhmm(String(m[1])), hi = hhmm(String(m[2]));
    if (!lo || !hi) return { why: 'a 12-hour time (am or pm) is not read, write it like 06:00' };
    if (lo >= hi) return { why: 'a range whose end is not after its start is not read' };
    return { reading: { op: 'between', lo, hi } };
  }
  if (shape === 'money') {
    if (/\b(?:not|never|outside|except|without)\b/i.test(t)) return { why: 'a negated limit (not, except, without) is not read' };
    const amts = [...t.matchAll(AMOUNT_ALL_RE)];
    if (!amts.length) return { why: 'no amount with a currency sign or word in the rule' };
    for (const a of amts) if (!currencyFits(a[0], fact)) return { why: 'the amount is in another currency than the page fact' };
    if (holdsManyBounds('money', t)) return { why: 'more than one amount in the rule' };
    const b = MONEY_BETWEEN_RE.exec(t);
    if (b) { const lo = num(b[1], b[2]), hi = num(b[3], b[4]); return lo < hi ? { reading: { op: 'between', lo, hi } } : { why: 'a range whose end is not above its start is not read' }; }
    const d = MONEY_DIRECTION_RE.exec(t);
    if (d) return { reading: { op: /** @type {'lt'|'lte'|'gt'|'gte'} */ (DIRECTION_OP[String(d[1]).toLowerCase()]), value: num(d[2], d[3]) } };
    const o = MONEY_OR_LESS_RE.exec(t);
    if (o) return { reading: { op: /^(less|fewer|under|below|lower)$/i.test(String(o[3])) ? 'lte' : 'gte', value: num(o[1], o[2]) } };
    return { why: 'the rule gives an amount but no direction (under, over, at most, at least, between)' };
  }
  return { why: 'code reads a limit only for money or time' };
}

/** the words a list row of kind `$cited` / `$numbers` carries no text for */
const DEFAULT_ROW_WORDS = Object.freeze({ cited: 'every claim quotes its input', numbers: 'every number matches a quote' });

/**
 * A check-list row named in the person's plain words: `phrase "### Fixed"`. The words are the draft log's; with none, the text after the key's kind prefix (`L1.phrase.### fixed`).
 * Never empty. Pure.
 * @param {unknown} kind @param {string} key @param {string[]|null|undefined} words
 * @returns {string}
 */
export function listRowName(kind, key, words) {
  const k = typeof kind === 'string' && kind ? kind : 'check';
  if (k === 'cited' || k === 'numbers') return DEFAULT_ROW_WORDS[k];
  const tail = key.replace(/^L\d+\.(?:[^.]*\.)?/, '').trim();
  const w = Array.isArray(words) && words.length ? words : [tail || key];
  return `${k} ${w.map((x) => `"${x}"`).join(', ')}`;
}

/**
 * The ~ rules the drafter listed under Not checked (`refused` entries that name a `rule`), each as one line in the person's own
 * words: `line N: "<the rule as written>" — <the drafter's reason>` (PART 1b, RF6 / RF16).
 * @param {any} closeDecl @param {any[]|null|undefined} jobLines @param {{key: string, words: string[]}[]|null} [ledger] the draft log's final list rows (`readDraftLedger`) @returns {string[]}
 */
export function ruleNotChecked(closeDecl, jobLines, ledger = null) {
  return ruleNotCheckedItems(closeDecl, jobLines, ledger).map((i) => i.text);
}

/** the same lines as {@link ruleNotChecked}, each with who it belongs to (`by`: the row's kind, F-c) @param {any} closeDecl @param {any[]|null|undefined} jobLines @param {{key: string, words: string[]}[]|null} [ledger] @returns {{text: string, by?: 'you'|'agent'|'default'}[]} */
export function ruleNotCheckedItems(closeDecl, jobLines, ledger = null) {
  return refusedOf(closeDecl).filter((r) => Number.isInteger(r.rule) || r.fromList).map((r) => {
    const text = Number.isInteger(r.rule) ? lineRules((jobLines ?? []).find((/** @type {any} */ l) => isRec(l) && l.n === r.line))[/** @type {number} */ (r.rule) - 1] : (r.label ?? null);
    const by = r.by ? { by: r.by } : {};
    // a list row that is not a fact or a rule is named by its words, as the Job tab names it (one owner: listRowName)
    if (!text && r.fromList && r.key) return { text: `line ${r.line}: ${listRowName(r.kind, r.key, ledger?.find((x) => x.key === r.key)?.words)} — ${r.reason}`, ...by };
    return { text: `line ${r.line}: ${text ? `"${text}"` : `rule ${r.rule ?? r.kind}`} — ${r.reason}`, ...by };
  });
}

/**
 * The refusals of a signed close, as ONE reader: when the close carries the one check list (`closeDecl.list`) its not-checked rows are the refusals (a `~` rule's row names the rule, a fact row its
 * fact name); the old `closeDecl.refused` entries a list has no row for (a line-level refusal, a rule the list never saw) are kept, so nothing the older close said is lost. A close with no list
 * reads `refused` alone. Pure.
 * @param {any} closeDecl
 * @returns {{line: number, rule?: number, kind?: string, key?: string, by?: 'you'|'agent'|'default', label?: string, reason: string, fromList: boolean}[]}
 */
export function refusedOf(closeDecl) {
  const old = (isRec(closeDecl) && Array.isArray(closeDecl.refused) ? closeDecl.refused : []).filter((/** @type {any} */ r) => isRec(r) && Number.isInteger(r.line) && typeof r.reason === 'string');
  const list = isRec(closeDecl) && Array.isArray(closeDecl.list) ? closeDecl.list : null;
  if (list === null) return old.map((/** @type {any} */ r) => ({ line: r.line, ...(Number.isInteger(r.rule) ? { rule: r.rule } : {}), reason: r.reason, fromList: false }));
  const rows = list.filter((/** @type {any} */ r) => isRec(r) && r.state === 'not-checked' && Number.isInteger(r.line) && typeof r.reason === 'string' && r.kind !== 'floor').map((/** @type {any} */ r) => ({
    line: r.line, ...(Number.isInteger(r.rule) ? { rule: r.rule } : {}), kind: String(r.kind), key: String(r.key), ...(['you', 'agent', 'default'].includes(r.by) ? { by: r.by } : {}), ...(r.kind === 'fact' ? { label: String(r.key).split('.').slice(2).join('.') } : {}), reason: r.reason, fromList: true,
  }));
  const seen = (/** @type {any} */ r) => rows.some((x) => x.line === r.line && x.rule === (Number.isInteger(r.rule) ? r.rule : undefined) && Number.isInteger(r.rule));
  return [...rows, ...old.filter((/** @type {any} */ r) => !seen(r)).map((/** @type {any} */ r) => ({ line: r.line, ...(Number.isInteger(r.rule) ? { rule: r.rule } : {}), reason: r.reason, fromList: false }))];
}

/**
 * The Not-checked lines code owns for the rubric-step stages of a close: a prose step's CONTENT is judged by the person at
 * Accept, and the card says so (PART 1b, RF5). One line per prose step (a stage with no fact part).
 * @param {any} closeDecl @returns {string[]}
 */
export function proseNotChecked(closeDecl) {
  return proseNotCheckedItems(closeDecl).map((i) => i.text);
}

/** the same items as {@link proseNotChecked} with the job line each belongs to (the stage's own `step`) @param {any} closeDecl @returns {{line: number, text: string}[]} */
export function proseNotCheckedItems(closeDecl) {
  const stages = isRec(closeDecl) && Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  return stages.filter((/** @type {any} */ st) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && Array.isArray(st.params.parts) && !factPartOf(st.params))
    .map((/** @type {any} */ st) => ({ line: st.params.step, text: `line ${st.params.step}: what the text says — you judge it at Accept` }));
}

// ── the sign-vs-run invariant: the checks the person is SHOWN are the checks the signed close RUNS ───────────────────

/**
 * One countable part as a plain sentence, written by code from the part's signed fields (never from the model's words), so the
 * plan card and the close are one thing seen twice.
 * @param {any} part @returns {string}
 */
export function partSentence(part) {
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map((x) => String(x)).join(', ') : '');
  const n = (/** @type {unknown} */ v, /** @type {string} */ unit) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  switch (part.check) {
    case 'maxWords': return `the text is at most ${n(part.value, 'word')}`;
    case 'minWords': return `the text is at least ${n(part.value, 'word')}`;
    case 'maxLines': return `the text is at most ${n(part.value, 'line')}`;
    case 'sections': return `the text has the section(s): ${list(part.names)}`;
    case 'sectionWords': return `each section (${list(part.names)}) is about ${part.wordsPerSection} words`;
    case 'nonEmpty': return 'the text is not empty';
    case 'listItems': return `the text has exactly ${n(part.value, 'list item')}`;
    case 'maxListItems': return `the text has at most ${n(part.value, 'list item')}`;
    case 'minListItems': return `the text has at least ${n(part.value, 'list item')}`;
    case 'sectionOrder': return `the text has the section(s) ${list(part.names)}, in that order`;
    case 'mustCarry': return `the text carries ${list(part.phrases)}`;
    case 'blockLines': return `the text is in blocks of ${n(part.size, 'line')}, each carrying ${list(part.phrases)}`;
    case 'cited': return `every claim is backed by a quote copied from "${part.source}"`;
    case 'minClaims': return `at least ${part.value} claim(s) are listed under "${part.source}"`;
    case 'maxClaims': return `at most ${part.value} claim(s) are listed under "${part.source}"`;
    case 'numbersFromFacts': return `every number in the text is in a quote checked on line ${list(part.from)}`;
    default: return String(part.text ?? part.check);
  }
}

/** the words of the default cited check code adds to a text line of a one-input job (the one list's `$` row); the card reads a part with exactly these words as `[default]` @param {string} label @returns {string} */
export const defaultCitedText = (label) => `every claim is backed by a quote copied from "${label}"`;

/**
 * The checks a signed close actually runs, per job line, in plain code-written sentences: one per countable part of every
 * rubric-step stage. This is the ONE reader both the plan card and the sign-time invariant use.
 * Each row says who added the check (`by`): `you` = one of the person's picks, as the signed close's own record (`closeDecl.picks`) names it; `agent` = the drafter's;
 * `default` = code's own (the one list's `$` rows: the cited part written by `defaultCitedText`, and the numbers tie of a text step).
 * @param {any} closeDecl
 * @returns {{line: number, text: string, by: 'agent'|'you'|'default', key?: string}[]}
 */
export function checksOfClose(closeDecl) {
  const stages = isRec(closeDecl) && Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  const record = isRec(closeDecl) && Array.isArray(closeDecl.picks) ? closeDecl.picks : [];
  const list = isRec(closeDecl) && Array.isArray(closeDecl.list) ? closeDecl.list.filter((/** @type {any} */ r) => isRec(r) && r.state === 'built') : [];
  /** the tag of a fact by its row's kind (hamr 2026-11-13, F-c): a fact a `~` rule built is [you], a `!` row's [agent]; `facts` on the signed row names what it built. No such row (an older close): the old reading */
  const factBy = (/** @type {number} */ line, /** @type {string} */ name) => {
    const rows = list.filter((/** @type {any} */ r) => r.line === line && Array.isArray(r.facts) && r.facts.includes(name));
    const r = rows.find((/** @type {any} */ x) => x.by === 'you') ?? rows[0];
    return r ? { by: /** @type {'agent'|'you'|'default'} */ (r.by), key: String(r.key) } : null;
  };
  const countBy = (/** @type {number} */ line, /** @type {number} */ pi) => {
    const r = list.find((/** @type {any} */ x) => x.line === line && x.kind === 'count' && isRec(x.part) && x.part.part === pi);
    return r ? { by: /** @type {'agent'|'you'|'default'} */ (r.by), key: String(r.key) } : null;
  };
  return stages.flatMap((/** @type {any} */ st) => (isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && Array.isArray(st.params.parts)
    ? st.params.parts.flatMap((/** @type {any} */ p, /** @type {number} */ pi) => {
      if (!isRec(p) || (p.class !== 'countable' && p.class !== 'fact')) return [];
      /** @type {'agent'|'you'|'default'} */
      const by = p.check === 'numbersFromFacts' || (p.check === 'cited' && p.text === defaultCitedText(p.source)) ? 'default' : record.some((/** @type {any} */ x) => isRec(x) && x.line === st.params.step && sameJson(x.part, p)) ? 'you' : 'agent';
      // a fact part is one plan row per fact (and one for its count): the person signs the rows, the close runs the same list
      if (p.class !== 'fact') return [{ line: st.params.step, text: partSentence(p), by }];
      const facts = Array.isArray(p.facts) ? p.facts : [];
      return factRows(p).map((/** @type {string} */ text, /** @type {number} */ i) => {
        const own = i < facts.length ? factBy(st.params.step, facts[i]?.name) : countBy(st.params.step, pi);
        return { line: st.params.step, text, by: own?.by ?? by, ...(own ? { key: own.key } : {}) };
      });
    })
    : []));
}

/**
 * The names of the facts a signed close checks (every fact part of every rubric-step stage). Pure.
 * @param {any} closeDecl @returns {string[]}
 */
export function signedFactNames(closeDecl) {
  const stages = isRec(closeDecl) && Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  return stages.flatMap((/** @type {any} */ st) => (isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && Array.isArray(st.params.parts)
    ? st.params.parts.filter((/** @type {any} */ p) => isRec(p) && p.class === 'fact' && Array.isArray(p.facts)).flatMap((/** @type {any} */ p) => p.facts.filter((/** @type {any} */ f) => isRec(f) && typeof f.name === 'string').map((/** @type {any} */ f) => f.name))
    : []));
}

/**
 * The plan card after drafting, read from the signed close ALONE (one source, the same the Job tab reads): its checks are `checksOfClose`; its Not checked is the close's own notes, the prose
 * steps' "you judge it at Accept" lines and the refusals (`ruleNotChecked`, which reads the list's not-checked rows when the close carries the list). Nothing the confirm turn said is merged
 * in: a rubric confirm turn plans the goal only, so a check can never be shown and then silently dropped (run mv5bk400).
 * @param {{closeDecl: any, jobLines?: any[]|null, ledger?: {key: string, words: string[]}[]|null}} o `jobLines` the person's numbered lines, so a ~ rule reads in the person's own words; `ledger` the draft log's final list rows, so a phrase row is named by its words
 * @returns {{checkItems: {text: string, fromLine: number[], by: 'agent'|'you'|'default', key?: string}[], notChecked: string[], notCheckedBy: Record<string, 'you'|'agent'|'default'>}}
 */
export function cardOfClose({ closeDecl, jobLines = null, ledger = null }) {
  const notes = isRec(closeDecl) && Array.isArray(closeDecl.notes) ? closeDecl.notes.filter((/** @type {any} */ n) => typeof n === 'string' && n) : [];
  const items = ruleNotCheckedItems(closeDecl, jobLines, ledger);
  /** @type {Record<string, 'you'|'agent'|'default'>} */
  const notCheckedBy = {};
  for (const i of items) if (i.by) notCheckedBy[i.text] = i.by;
  return {
    checkItems: checksOfClose(closeDecl).map((c) => ({ text: c.text, fromLine: [c.line], by: c.by, ...(c.key ? { key: c.key } : {}) })),
    notChecked: [...new Set([...notes, ...proseNotChecked(closeDecl), ...items.map((i) => i.text)])],
    notCheckedBy,
  };
}

/**
 * The sign-time check of a close that carries the one check list: every BUILT row (the mechanical floor aside) points at a part that is really in the close, and every real check part
 * (countable or fact) has at least one built row pointing at it, so a check cannot be in the close with no row and a row cannot claim a check the close does not run. A close with no list is
 * not examined here. Pure.
 * @param {any} closeDecl @returns {{ok: true}|{ok: false, error: string}}
 */
export function listMatchesClose(closeDecl) {
  const list = isRec(closeDecl) && Array.isArray(closeDecl.list) ? closeDecl.list : null;
  if (list === null) return { ok: true };
  const stages = Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  const partsOn = (/** @type {number} */ n) => stages.filter((/** @type {any} */ st) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && st.params.step === n && Array.isArray(st.params.parts)).flatMap((/** @type {any} */ st) => st.params.parts);
  const built = list.filter((/** @type {any} */ r) => isRec(r) && r.state === 'built' && r.kind !== 'floor');
  const bad = built.filter((/** @type {any} */ r) => !(isRec(r.part) && r.part.line === r.line && Number.isInteger(r.part.part) && isRec(partsOn(r.line)[r.part.part])));
  const lines = [...new Set(stages.filter((/** @type {any} */ st) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params)).map((/** @type {any} */ st) => st.params.step))];
  const bare = lines.flatMap((/** @type {number} */ n) => partsOn(n).map((/** @type {any} */ p, /** @type {number} */ i) => ({ n, i, p })))
    .filter(({ p }) => isRec(p) && (p.class === 'countable' || p.class === 'fact'))
    // a part has its row when a built row points at it, or when the part lists (in its `rules`) the number of a built `~` row of its line (a row points at ONE part, a rule may be carried by several)
    .filter(({ n, i, p }) => !built.some((/** @type {any} */ r) => (isRec(r.part) && r.part.line === n && r.part.part === i)
      || (r.kind === 'rule' && r.line === n && Array.isArray(p.rules) && p.rules.includes(r.rule))));
  if (bad.length === 0 && bare.length === 0) return { ok: true };
  const parts = [];
  if (bad.length) parts.push(`a row points at a check the close does not run: ${bad.map((/** @type {any} */ r) => r.key).join('; ')}`);
  if (bare.length) parts.push(`a check in the close has no row: line ${bare.map(({ n, i }) => `${n} part ${i + 1}`).join('; ')}`);
  return { ok: false, error: `The list of checks does not match the signed close (${parts.join(' | ')}). Nothing was signed — draft again.` };
}

/**
 * The sign-time invariant: the checks the person was shown (`shown`, from the plan card) are exactly the checks the signed
 * close runs (`checksOfClose`), per line. Pure.
 * @param {{text: string, fromLine: number[]|null}[]} shown @param {any} closeDecl
 * @returns {{ok: true}|{ok: false, error: string}}
 */
export function planMatchesClose(shown, closeDecl) {
  const key = (/** @type {number|null|undefined} */ line, /** @type {string} */ text) => `line ${line ?? '?'}: ${text}`;
  const ran = checksOfClose(closeDecl).map((c) => key(c.line, c.text));
  const saw = shown.map((c) => key(Array.isArray(c.fromLine) ? c.fromLine[0] : null, c.text));
  const onlyShown = saw.filter((k) => !ran.includes(k));
  const onlyRan = ran.filter((k) => !saw.includes(k));
  if (onlyShown.length === 0 && onlyRan.length === 0 && saw.length === ran.length) return { ok: true };
  const parts = [];
  if (onlyShown.length) parts.push(`shown to you but not in the signed close: ${onlyShown.join('; ')}`);
  if (onlyRan.length) parts.push(`in the signed close but not shown to you: ${onlyRan.join('; ')}`);
  return { ok: false, error: `The checks you were shown do not match the checks the signed close would run (${parts.join(' | ')}). Nothing was signed — draft again.` };
}

/**
 * The frozen TEXT of the named inputs, read the way the runner reads them: the source door's record (`source.json`, one level
 * above the tree) names each input's file and sha256, and a file whose bytes no longer match is not returned. Used at DRAFTING
 * (the drafter reads the input, the early tests run on it) and at run start (the backstop). Never throws.
 * @param {string} workdir the frozen tree @param {string[]} labels
 * @returns {Promise<{ok: true, texts: Record<string, string>}|{ok: false, why: string}>}
 */
export async function readFrozenInputs(workdir, labels) {
  /** @type {any} */
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dirname(workdir), 'source.json'), 'utf8')); } catch (e) {
    return { ok: false, why: `the source record could not be read: ${/** @type {Error} */ (e).message}` };
  }
  const recorded = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  /** @type {Record<string, string>} */
  const texts = {};
  for (const label of labels) {
    const row = recorded.find((/** @type {any} */ r) => r && r.label === label);
    if (!row || typeof row.rel !== 'string' || typeof row.sha256 !== 'string') return { ok: false, why: `the source record has no input labelled "${label}"` };
    let buf;
    try { buf = await readFile(join(workdir, row.rel)); } catch (e) { return { ok: false, why: `input "${label}" could not be read: ${/** @type {Error} */ (e).message}` }; }
    if (sha256Of(buf) !== row.sha256) return { ok: false, why: `input "${label}" no longer matches the bytes frozen at the source door` };
    texts[label] = buf.toString('utf8');
  }
  return { ok: true, texts };
}
