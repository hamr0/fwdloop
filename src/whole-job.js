// M13 am9 / M15 am3: the file holds the whole job. ONE writer of the whole-job text (`wholeJobText`), ONE finder of the Ask that shows it (`wholeJobAskIndex`).
// The last Ask before the added `write it out` shows every step's result in job order, built by code from each step's saved output (never picked by the AI). Since M15 am3 that text is the BODY of the
// run's one markdown report (`renderReportBody`, src/report.js: `## <n>. <line>`, the ~ rules, what code checked, the AI's answer under its heading; an Ask before it is one line
// `Line <n>: you accepted this at the Ask.`); the last Ask itself and the send line are not sections. The accepted artifact is `{text}`; the send adds the title and the Passed line and writes it.
// Throws away: what `renderReportBody` throws away. Third outcomes: a work step with no readable saved output refuses, naming the step; a frozen sheet the report needs that cannot be read refuses, naming it.
import { renderReportBody } from './report.js';
import { readRunSheets } from './sheetrun.js';
import { readSheetChecks } from './sheet-record.js';
import { lineRules } from './pagebits.js';

/**
 * The Ask the action reads: the Ask right before the one signed send (M13 am11: the action ships the step before it). -1 = none.
 * @param {{ steps: { fromLine: number, goal: string, emits?: string, reads?: string[] }[], askLines: Map<number, any>, sendLines: Map<number, any> }} p
 * @returns {number}
 */
function askBeforeSend({ steps, askLines, sendLines }) {
  if (sendLines.size !== 1) return -1;
  const send = [...sendLines.values()][0];
  const sendStep = steps.find((s) => s.fromLine === send.line);
  const askIds = (sendStep?.reads ?? []).filter((id) => steps.some((s) => s.emits === id && askLines.has(s.fromLine)));
  if (askIds.length !== 1) return -1;
  const idx = steps.findIndex((s) => s.emits === askIds[0]);
  return steps[idx + 1] === sendStep ? idx : -1;
}

/** The emits of every work step (not an Ask) before step `idx`, in job order. */
function workBefore(steps, idx, askLines) {
  return steps.slice(0, idx).filter((s) => !askLines.has(s.fromLine) && typeof s.emits === 'string').map((s) => /** @type {string} */ (s.emits));
}

/**
 * The index of the Ask that shows the whole job: the Ask right before the action, when the plan has it read EVERY work step before it (what `readEveryStep` writes into a plan
 * drafted from M13 am9 on). A plan signed with that Ask reading one step (a job signed before am9) finds -1 and keeps today's behaviour exactly: a stored plan is never reinterpreted.
 * @param {{ steps: { fromLine: number, goal: string, emits?: string, reads?: string[] }[], askLines: Map<number, any>, sendLines: Map<number, any> }} p
 * @returns {number} -1 = none
 */
export function wholeJobAskIndex({ steps, askLines, sendLines }) {
  const idx = askBeforeSend({ steps, askLines, sendLines });
  if (idx < 1) return idx === 0 ? -1 : idx;
  const work = workBefore(steps, idx, askLines);
  const reads = steps[idx].reads ?? [];
  return work.length > 0 && reads.length === work.length && work.every((e) => reads.includes(e)) ? idx : -1;
}

/** the `~` rules of a signed job line, one string each: the parsed line carries them joined by "; " in `guardrail` (several `~` lines under one step are one guardrail), as the Result tab reads it @param {any} jl @returns {string[]} */
export const lineRulesOf = (jl) => (jl && typeof jl.guardrail === 'string' && jl.guardrail !== '' ? jl.guardrail.split('; ').filter(Boolean) : lineRules(jl));

/**
 * Is the prose of this step checked by code (M15 am3 item 2: `### The answer` instead of the not-checked heading)? Only when code really checked the step's own text (a green close with a words-per-section
 * or picked check on it) AND the signed list holds no Not checked `~` rule on the line. A non-empty / `happened` check alone is no prose check, nor is a sheet or quote check (they check cells and quotes).
 * @param {any} step @param {any[]|null|undefined} [checkList] the plan's signed list (`declaration.checkList`)
 * @returns {boolean}
 */
export function proseCheckedOf(step, checkList) {
  const rows = (Array.isArray(checkList) ? checkList : []).filter((r) => r && typeof r === 'object' && r.line === step?.fromLine);
  if (rows.some((r) => r.kind === 'rule' && r.state === 'not-checked')) return false;
  const c = step?.close;
  if (c?.class !== 'green') return false;
  const shape = c.shape && typeof c.shape === 'object' ? c.shape : {};
  return shape.wordsPerSection !== undefined || (Array.isArray(shape.picked) && shape.picked.length > 0) || (Array.isArray(c.picked) && c.picked.length > 0);
}

/** the signed shape part of a step (its close's `itemShape`, M19 S5), or null: the report writes the shape section for a line that holds one (M19 amendment C) @param {any} step */
const shapeOfStep = (step) => (step?.close?.itemShape && typeof step.close.itemShape === 'object' && Array.isArray(step.close.itemShape.fields) ? step.close.itemShape : null);

/**
 * What the report needs besides the steps: the signed lines' own words (the `~` rules), the run's frozen sheets and which sheet checks passed. Read once from the run folder.
 * @param {{ runDir: string, steps: any[], jobLines: any[]|null|undefined, checkList?: any[]|null }} p
 * @returns {{ ok: true, jobLines: any[], checkList: any[]|null, tables: Record<string, any>, okIdsOf: (n: number) => Set<string>|null } | { ok: false, red: string }}
 */
export function reportContextOf({ runDir, steps, jobLines, checkList }) {
  const checks = steps.flatMap((s) => (Array.isArray(s?.close?.sheet) ? s.close.sheet : []));
  /** @type {Record<string, any>} */
  let tables = {};
  if (checks.length > 0) {
    const sheet = readRunSheets(runDir, checks);
    if (!sheet.ok) return { ok: false, red: `ask: the report cannot read the saved sheet — ${sheet.red}` };
    tables = sheet.tables;
  }
  const record = checks.length > 0 ? readSheetChecks(runDir) : null;
  const okIdsOf = (/** @type {number} */ n) => {
    // the newest try of the line that passed: the ids of its checks that passed
    const tries = (record?.lines ?? []).filter((l) => l && l.n === n && l.passed === true && Array.isArray(l.results));
    const last = tries.reduce((m, l) => (m === null || l.try >= m.try ? l : m), /** @type {any} */ (null));
    return last ? new Set(last.results.filter((/** @type {any} */ r) => r && r.ok === true).map((/** @type {any} */ r) => r.id)) : null;
  };
  return { ok: true, jobLines: Array.isArray(jobLines) ? jobLines : [], checkList: Array.isArray(checkList) ? checkList : null, tables, okIdsOf };
}

/**
 * @param {{ steps: { fromLine: number, goal: string, emits?: string, close?: any }[], askLines: Map<number, any>, lastAskIndex: number,
 *   readResult: (id: string) => ({ ok: true, value: any } | { ok: false, missing: true } | { ok: false, missing: false, red: string }),
 *   context: ReturnType<typeof reportContextOf>, redPrefix?: string }} p `redPrefix` is `ask: ` (an Ask job's words, unchanged); M15 am4 gives a job with no Ask `send: `
 * @returns {{ ok: true, value: { text: string } } | { ok: false, red: string }}
 */
export function wholeJobText({ steps, askLines, lastAskIndex, readResult, context, redPrefix = 'ask: ' }) {
  if (!context.ok) return { ok: false, red: context.red };
  /** @type {Parameters<typeof renderReportBody>[0]} */
  const lines = [];
  for (let i = 0; i < lastAskIndex; i += 1) {
    const s = steps[i];
    if (askLines.has(s.fromLine)) {
      lines.push({ n: s.fromLine, kind: 'ask' });
      continue;
    }
    const r = readResult(/** @type {string} */ (s.emits));
    if (!r.ok) {
      return {
        ok: false,
        red: r.missing
          ? `${redPrefix}the saved output "${s.emits}" of step "${s.goal}" is missing — refusing to show the whole job`
          : `${redPrefix}the saved output "${s.emits}" of step "${s.goal}" — ${r.red}`,
      };
    }
    const jl = context.jobLines.find((/** @type {any} */ l) => l && l.n === s.fromLine);
    lines.push({
      n: s.fromLine, kind: 'work', text: s.goal, rules: lineRulesOf(jl), artifact: r.value,
      checks: Array.isArray(s.close?.sheet) ? s.close.sheet : [], okIds: context.okIdsOf(s.fromLine), proseChecked: proseCheckedOf(s, context.checkList),
      shape: shapeOfStep(s),
    });
  }
  return { ok: true, value: { text: renderReportBody(lines, context.tables) } };
}

/**
 * M15 am3 item 6: the body the send writes. A plan whose last Ask shows the whole job (`wholeIdx` >= 0) was accepted AS that text: the body is `{text}` exactly, never rebuilt. A plan signed before
 * M13 am9 (or a job with no Ask) sends the one step right before the send: its section is written from the accepted artifact, the line being that step's own (or, past an Ask, the step the Ask read).
 * M15 am4: a job with no signed Ask (`askLines.size === 0`, no whole-job Ask) writes every work line before the send, in line order: the whole-job text over the steps before the send, the step right before it
 * read from `content` (what the person accepted), the earlier ones from the run's saved outputs (`readResult`). A missing or unreadable earlier output refuses by name, in `send: ` words (never `ask: `).
 * @param {{ content: any, wholeIdx: number, steps: any[], sendIndex: number, askLines: Map<number, any>, context: ReturnType<typeof reportContextOf>,
 *   readResult?: (id: string) => ({ ok: true, value: any } | { ok: false, missing: true } | { ok: false, missing: false, red: string }) }} p
 * @returns {{ ok: true, body: string } | { ok: false, red: string }}
 */
export function sendBodyOf({ content, wholeIdx, steps, sendIndex, askLines, context, readResult }) {
  if (wholeIdx >= 0) {
    return typeof content?.text === 'string' && Object.keys(content).length === 1
      ? { ok: true, body: content.text }
      : { ok: false, red: 'send: the accepted answer is not the whole-job text — refusing to write a report from it' };
  }
  if (!context.ok) return { ok: false, red: context.red };
  const before = steps[sendIndex - 1];
  if (askLines.size === 0) {
    if (!readResult) return { ok: false, red: 'send: no reader for the run\'s saved outputs was given — refusing to write a report' };
    const whole = wholeJobText({
      steps, askLines, lastAskIndex: sendIndex, context, redPrefix: 'send: ',
      readResult: (id) => (before && id === before.emits ? { ok: true, value: content } : readResult(id)),
    });
    return whole.ok ? { ok: true, body: whole.value.text } : whole;
  }
  const made = before && askLines.has(before.fromLine) ? steps.find((x) => x.emits === (before.reads ?? [])[0]) ?? before : before;
  const jl = context.jobLines.find((/** @type {any} */ l) => l && l.n === made?.fromLine);
  return {
    ok: true,
    body: renderReportBody([{
      n: made?.fromLine, kind: 'work', text: made?.goal, rules: lineRulesOf(jl), artifact: content,
      checks: Array.isArray(made?.close?.sheet) ? made.close.sheet : [], okIds: context.okIdsOf(made?.fromLine), proseChecked: proseCheckedOf(made, context.checkList),
      shape: shapeOfStep(made),
    }], context.tables),
  };
}

/**
 * M13 am9 item 4: the plan shows the last Ask as reading every step. Code sets the Ask's `reads` to every work step's emits before it (the nearest one first, so a
 * redo still re-runs the step just before the Ask; the rest in job order). Only for the Ask right before the action; any other plan comes back as it was.
 * @template {{ fromLine: number, goal: string, emits?: string, reads?: string[], primitives?: string[] }} S
 * @param {S[]} steps @param {{ asks?: { line: number }[], sends?: { line: number }[] }} arbiter
 * @returns {S[]}
 */
export function readEveryStep(steps, arbiter) {
  if (!Array.isArray(steps) || !steps.every((s) => s && typeof s === 'object')) return steps;
  const askLines = new Map((arbiter?.asks ?? []).map((a) => [a.line, a]));
  const sendLines = new Map((arbiter?.sends ?? []).map((x) => [x.line, x]));
  const idx = askBeforeSend({ steps, askLines, sendLines });
  if (idx < 1) return steps;
  const work = workBefore(steps, idx, askLines);
  if (work.length === 0) return steps;
  const reads = [work[work.length - 1], ...work.slice(0, -1)];
  return steps.map((s, i) => (i === idx ? { ...s, reads } : s));
}
