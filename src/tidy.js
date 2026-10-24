// M8b item 5: `fwdloop tidy --root <flows>` moves old run folders into the new shape, once. Per run folder it builds the new files from the old ones (`run.json` from
// run-model / thinking / inputs; `diary.jsonl` from calls / tools / checks; `line-checks.json` from cited-checks / sheet-checks), proves that the real readers give the
// same answers on the new files as the old files gave, and only then removes the old files. This module is the ONLY place in src/ or bin/ that names the old files: it
// reads them to move them, and nothing else reads them.
//   - a run whose process is alive (`runAliveWhy`: the panel's own rule, src/liveness.js) is skipped, and named;
//   - a run it cannot move is named with why and left exactly as it is (nothing new is kept for it);
//   - run it again: a moved run has no old file left, so a second tidy changes nothing; a run left half-moved by a crash is finished (a new file that is already there must
//     agree with the old file it was made from);
//   - the old files said nothing about the order BETWEEN the three diaries, so `diary.jsonl` interleaves them by each row's own `at` (each old file keeps its own order;
//     a tie goes calls, tools, checks; a row with no usable `at` follows the row before it);
//   - the new files keep the modified time of the old file they replace (the run's `inputs.json` time is how the Run card finds a flow's newest run).
// Throws away: a line of an old diary that was not valid JSON (the readers skipped it already); a run-model record the model reader would not accept (it read as no record).
import { lstatSync, renameSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { listFlowNames, listRunIds, readFileInside } from './flow.js';
import { readLines } from './books.js';
import { isKeyName } from './provider.js';
import { runLiveness, readResumeLock, booksFresh } from './liveness.js';
import { RUN_FILE, writeRunStart, readRunRecord, readRunThinking } from './runfile.js';
import { readRunModel } from './flowmodel.js';
import {
  DIARY_FILE, readCalls, readTools, readChecks,
} from './diary.js';
import { LINE_CHECKS_FILE, readLineSection, writeLineSection } from './line-checks.js';

/** the eight files this move retires, by what they were */
const OLD = Object.freeze({
  model: 'run-model.json', thinking: 'thinking.json', inputs: 'inputs.json', calls: 'calls.jsonl', tools: 'tools.jsonl', checks: 'checks.jsonl', cited: 'cited-checks.json', sheet: 'sheet-checks.json',
});

/** @typedef {{status: 'moved'|'tidy'|'skipped'|'failed', why?: string}} RunResult */

/**
 * Why this run must not be touched now, or null. The panel's rule for "[▶]" (`runLiveness`), the resume lock, and for a run with no pid row the 10-minute books rule.
 * @param {string} runDir @returns {string|null}
 */
export function runAliveWhy(runDir) {
  const live = runLiveness(runDir);
  if (live === 'running') return 'its process is alive';
  const lock = readResumeLock(runDir).state;
  if (lock === 'live') return 'a resume of it is running';
  if (lock === 'unknown') return 'cannot tell whether a resume of it is running';
  if (live === 'unknown' && booksFresh(runDir)) return 'cannot tell whether it is running, and its books changed in the last 10 minutes';
  return null;
}

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };

/** thrown inside `tidyRun` to leave a run as it is */
class CannotMove extends Error {}

/**
 * One old file: its text, or null when it is not there. A file the safe gateway refuses (a symlink, outside the folder) cannot be moved.
 * @param {string} runDir @param {string} name @returns {string|null}
 */
function oldText(runDir, name) {
  const r = readFileInside(runDir, name);
  if (r.ok) return r.text;
  if (r.missing) return null;
  throw new CannotMove(`${name}: ${r.red}`);
}

/** @param {string} name @param {string} text @returns {any} */
function parseOld(name, text) {
  try { return JSON.parse(text); } catch { throw new CannotMove(`${name} is not valid JSON`); }
}

/** An old line file's rows: every readable line, which must be a record. @param {string} runDir @param {string} name @returns {Record<string, any>[]|null} null = not there */
function oldRows(runDir, name) {
  if (oldText(runDir, name) === null) return null;
  const rows = readLines(runDir, name);
  if (!rows.every(isRec)) throw new CannotMove(`${name} has a line that is not a record`);
  return rows;
}

/** The modified time (ms) of a file, null when it is not there. @param {string} runDir @param {string} name */
function mtimeOf(runDir, name) {
  try { return lstatSync(join(runDir, name)).mtimeMs; } catch { return null; }
}

/** Give a new file the modified time of what it replaces. @param {string} runDir @param {string} file @param {(number|null)[]} times the old times; the newest is used */
function keepTime(runDir, file, times) {
  const known = times.filter((t) => t !== null);
  if (known.length === 0) return;
  const t = Math.max(...known) / 1000;
  utimesSync(join(runDir, file), t, t);
}

/**
 * The rows of the three diaries in one list, each carrying its `kind`. Each file keeps its own order; between files the row with the earliest `at` goes first.
 * @param {{kind: 'call'|'tool'|'checks', rows: Record<string, any>[]}[]} streams in tie order @returns {Record<string, any>[]}
 */
function interleave(streams) {
  const at = streams.map(() => 0);
  /** @type {Record<string, any>[]} */
  const out = [];
  let last = -Infinity;
  for (;;) {
    let pick = -1;
    let pickT = Infinity;
    streams.forEach((s, i) => {
      if (at[i] >= s.rows.length) return;
      const t = Date.parse(s.rows[at[i]].at);
      const key = Number.isFinite(t) ? t : last;
      if (pick === -1 || key < pickT) { pick = i; pickT = key; }
    });
    if (pick === -1) return out;
    const row = streams[pick].rows[at[pick]];
    at[pick] += 1;
    out.push({ kind: streams[pick].kind, ...row });
    if (Number.isFinite(pickT)) last = pickT;
  }
}

/**
 * Move one run folder. Returns what happened; throws nothing the caller must handle.
 * @param {string} runDir @param {(runDir: string) => string|null} isAlive @returns {RunResult}
 */
export function tidyRun(runDir, isAlive) {
  const alive = isAlive(runDir);
  if (alive !== null) return { status: 'skipped', why: alive };
  /** @type {string[]} the new files this pass made whole, removed again if the read-back does not agree */
  const made = [];
  /** @type {string[]} */
  const retire = [];
  try {
    // ---- read the old files: all of them, before anything is written
    const modelText = oldText(runDir, OLD.model);
    const thinkingText = oldText(runDir, OLD.thinking);
    const inputsText = oldText(runDir, OLD.inputs);
    const calls = oldRows(runDir, OLD.calls);
    const tools = oldRows(runDir, OLD.tools);
    const checks = oldRows(runDir, OLD.checks);
    const citedText = oldText(runDir, OLD.cited);
    const sheetText = oldText(runDir, OLD.sheet);
    for (const [name, present] of Object.entries(OLD)) if (oldText(runDir, present) !== null) retire.push(name);
    if (retire.length === 0) return { status: 'tidy' };

    // ---- what the new files must hold
    const model = (() => {
      if (modelText === null) return null;
      let j = null;
      try { j = JSON.parse(modelText); } catch { return null; }
      return isKeyName(j?.slot) && typeof j?.model === 'string' && j.model !== '' ? { slot: j.slot, model: j.model } : null; // as the model reader reads it: otherwise no record
    })();
    const thinking = (() => {
      if (thinkingText === null) return null;
      try { return JSON.parse(thinkingText)?.thinking === true; } catch { return false; } // as the box reader reads it: an unreadable record is box off
    })();
    const inputs = (() => {
      if (inputsText === null) return null;
      const j = parseOld(OLD.inputs, inputsText);
      if (!Array.isArray(j)) throw new CannotMove(`${OLD.inputs} is not a list`);
      return j;
    })();
    /** @param {string} name @param {string|null} text */
    const lines = (name, text) => {
      if (text === null) return null;
      const j = parseOld(name, text);
      if (!isRec(j) || !Array.isArray(j.lines)) throw new CannotMove(`${name} has no list of "lines"`);
      return j;
    };
    const cited = lines(OLD.cited, citedText);
    const sheet = lines(OLD.sheet, sheetText);

    // ---- run.json
    const hasRun = mtimeOf(runDir, RUN_FILE) !== null;
    if (hasRun) {
      const got = readRunRecord(runDir);
      if (!got.ok) throw new CannotMove(got.red);
      if (modelText !== null && model !== null && !same(got.rec.model, model)) throw new CannotMove(`${RUN_FILE} and ${OLD.model} disagree`);
      if (thinking !== null && got.rec.thinking !== thinking) throw new CannotMove(`${RUN_FILE} and ${OLD.thinking} disagree`);
      if (inputs !== null && !same(got.rec.inputs, inputs)) throw new CannotMove(`${RUN_FILE} and ${OLD.inputs} disagree`);
    } else if (model !== null || thinking !== null || inputs !== null) {
      writeRunStart(runDir, { model, thinking, inputs });
      made.push(RUN_FILE);
      keepTime(runDir, RUN_FILE, [mtimeOf(runDir, OLD.inputs), mtimeOf(runDir, OLD.thinking), mtimeOf(runDir, OLD.model)]);
    }

    // ---- diary.jsonl
    const kinds = /** @type {const} */ ([['call', calls, readCalls], ['tool', tools, readTools], ['checks', checks, readChecks]]);
    if (mtimeOf(runDir, DIARY_FILE) !== null) {
      for (const [kind, rows, read] of kinds) {
        if (rows !== null && !same(read(runDir), rows.map((r) => ({ kind, ...r })))) throw new CannotMove(`${DIARY_FILE} and the old ${kind} file disagree`);
      }
    } else if (calls !== null || tools !== null || checks !== null) {
      const merged = interleave(kinds.filter(([, rows]) => rows !== null).map(([kind, rows]) => ({ kind, rows: /** @type {Record<string, any>[]} */ (rows) })));
      const file = join(runDir, DIARY_FILE);
      writeFileSync(`${file}.tmp`, merged.map((r) => `${JSON.stringify(r)}\n`).join(''), { flag: 'wx' });
      renameSync(`${file}.tmp`, file);
      made.push(DIARY_FILE);
      keepTime(runDir, DIARY_FILE, [mtimeOf(runDir, OLD.calls), mtimeOf(runDir, OLD.tools), mtimeOf(runDir, OLD.checks)]);
    }

    // ---- line-checks.json
    /** @type {[ 'cited'|'sheet', any, string ][]} */
    const sections = [['cited', cited, OLD.cited], ['sheet', sheet, OLD.sheet]];
    const hadLineFile = mtimeOf(runDir, LINE_CHECKS_FILE) !== null;
    for (const [section, rec, name] of sections) {
      if (rec === null) continue;
      const now = readLineSection(runDir, section);
      if (now.ok) {
        if (!same(now.lines, rec.lines)) throw new CannotMove(`${LINE_CHECKS_FILE} and ${name} disagree`);
      } else if (!now.missing) {
        throw new CannotMove(now.red);
      } else {
        writeLineSection(runDir, section, () => rec.lines);
        if (!hadLineFile && !made.includes(LINE_CHECKS_FILE)) made.push(LINE_CHECKS_FILE);
      }
    }
    if (made.includes(LINE_CHECKS_FILE)) keepTime(runDir, LINE_CHECKS_FILE, [mtimeOf(runDir, OLD.cited), mtimeOf(runDir, OLD.sheet)]);

    // ---- read back through the real readers, before an old file is removed
    if (model !== null && !same(readRunModel(runDir), model)) throw new CannotMove(`read-back of the model differs`);
    if (thinking !== null && readRunThinking(runDir) !== thinking) throw new CannotMove('read-back of the thinking box differs');
    if (inputs !== null) {
      const got = readRunRecord(runDir);
      if (!got.ok || !same(got.rec.inputs, inputs)) throw new CannotMove('read-back of the inputs differs');
    }
    for (const [kind, rows, read] of kinds) {
      if (rows !== null && !same(read(runDir), rows.map((r) => ({ kind, ...r })))) throw new CannotMove(`read-back of the ${kind} rows differs`);
    }
    for (const [section, rec] of sections) {
      const got = readLineSection(runDir, section);
      if (rec !== null && !(got.ok && same(got.lines, rec.lines))) throw new CannotMove(`read-back of the ${section} checks differs`);
    }
  } catch (err) {
    for (const f of made) { try { unlinkSync(join(runDir, f)); } catch { /* already gone */ } }
    try { unlinkSync(join(runDir, `${DIARY_FILE}.tmp`)); } catch { /* none */ }
    try { unlinkSync(join(runDir, `${LINE_CHECKS_FILE}.tmp`)); } catch { /* none */ }
    return { status: 'failed', why: err instanceof CannotMove ? err.message : `unexpected: ${/** @type {any} */ (err)?.message ?? err}` };
  }
  for (const name of retire) unlinkSync(join(runDir, OLD[/** @type {keyof typeof OLD} */ (name)]));
  return { status: 'moved' };
}

/**
 * Tidy every run folder under `root` (every job's `runs/`).
 * @param {{root: string, isAlive?: (runDir: string) => string|null}} o
 * @returns {{runs: number, moved: string[], tidy: string[], skipped: {run: string, why: string}[], failed: {run: string, why: string}[]}}
 */
export function tidyRoot({ root, isAlive = runAliveWhy }) {
  /** @type {ReturnType<typeof tidyRoot>} */
  const out = { runs: 0, moved: [], tidy: [], skipped: [], failed: [] };
  for (const flow of listFlowNames(root)) {
    const flowDir = join(root, flow);
    for (const runId of listRunIds(flowDir)) {
      const run = `${flow}/${runId}`;
      out.runs += 1;
      const r = tidyRun(join(flowDir, 'runs', runId), isAlive);
      if (r.status === 'moved') out.moved.push(run);
      else if (r.status === 'tidy') out.tidy.push(run);
      else out[r.status].push({ run, why: /** @type {string} */ (r.why) });
    }
  }
  return out;
}
