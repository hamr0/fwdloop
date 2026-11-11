// M13 am9: the file holds the whole job. ONE writer of the whole-job text (`wholeJobText`), ONE finder of the Ask that shows it (`wholeJobAskIndex`).
// The last Ask before the added `write it out` shows every step's result in job order, built by code from each step's saved output (never picked by the AI):
// a work step is one section `## Line <n>: <line words>` + `renderSentMd(<its saved output>)` (the M15 form, unchanged); an Ask before it is one line
// `Line <n>: you accepted this at the Ask.`; the last Ask itself and the send line are not sections. The accepted artifact is `{text}`, so the send ships it unchanged.
// Throws away: nothing of a step's saved output beyond what `renderSentMd` already drops. Third outcomes: a work step with no readable saved output refuses, naming the step.
import { renderSentMd } from './send.js';
import { addedLinesOf } from './added-end.js';

/**
 * The index of the Ask that shows the whole job: the Ask the added send reads, only when the plan has the am8 added `write it out`. A job signed before am8
 * (its send line is the person's own words) finds -1 and keeps today's behaviour exactly.
 * @param {{ steps: { fromLine: number, goal: string, emits?: string, reads?: string[] }[], askLines: Map<number, any>, sendLines: Map<number, any> }} p
 * @returns {number} -1 = none
 */
export function wholeJobAskIndex({ steps, askLines, sendLines }) {
  if (sendLines.size !== 1) return -1;
  const send = [...sendLines.values()][0];
  const lines = steps.map((s) => ({ n: s.fromLine, text: s.goal }));
  if (!addedLinesOf(lines, { sends: [...sendLines.values()], asks: [...askLines.values()] }).has(send.line)) return -1;
  const sendStep = steps.find((s) => s.fromLine === send.line);
  const askIds = (sendStep?.reads ?? []).filter((id) => steps.some((s) => s.emits === id && askLines.has(s.fromLine)));
  if (askIds.length !== 1) return -1;
  return steps.findIndex((s) => s.emits === askIds[0]);
}

/**
 * @param {{ steps: { fromLine: number, goal: string, emits?: string }[], askLines: Map<number, any>, lastAskIndex: number,
 *   readResult: (id: string) => ({ ok: true, value: any } | { ok: false, missing: true } | { ok: false, missing: false, red: string }) }} p
 * @returns {{ ok: true, value: { text: string } } | { ok: false, red: string }}
 */
export function wholeJobText({ steps, askLines, lastAskIndex, readResult }) {
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < lastAskIndex; i += 1) {
    const s = steps[i];
    if (askLines.has(s.fromLine)) {
      parts.push(`Line ${s.fromLine}: you accepted this at the Ask.`);
      continue;
    }
    const r = readResult(/** @type {string} */ (s.emits));
    if (!r.ok) {
      return {
        ok: false,
        red: r.missing
          ? `ask: the saved output "${s.emits}" of step "${s.goal}" is missing — refusing to show the whole job`
          : `ask: the saved output "${s.emits}" of step "${s.goal}" — ${r.red}`,
      };
    }
    parts.push(`## Line ${s.fromLine}: ${s.goal}\n${renderSentMd(r.value)}`);
  }
  return { ok: true, value: { text: parts.join('\n\n') } };
}

/**
 * M13 am9 item 4: the plan shows the last Ask as reading every step. Code sets the Ask's `reads` to every work step's emits before it (the nearest one first, so a
 * redo still re-runs the step just before the Ask; the rest in job order). Only a plan with the am8 added end; any other plan comes back as it was.
 * @template {{ fromLine: number, goal: string, emits?: string, reads?: string[], primitives?: string[] }} S
 * @param {S[]} steps @param {{ asks?: { line: number }[], sends?: { line: number }[] }} arbiter
 * @returns {S[]}
 */
export function readEveryStep(steps, arbiter) {
  if (!Array.isArray(steps) || !steps.every((s) => s && typeof s === 'object')) return steps;
  const askLines = new Map((arbiter?.asks ?? []).map((a) => [a.line, a]));
  const sendLines = new Map((arbiter?.sends ?? []).map((x) => [x.line, x]));
  const idx = wholeJobAskIndex({ steps, askLines, sendLines });
  if (idx < 1) return steps;
  const work = steps.slice(0, idx).filter((s) => !askLines.has(s.fromLine) && typeof s.emits === 'string').map((s) => /** @type {string} */ (s.emits));
  if (work.length === 0) return steps;
  const reads = [work[work.length - 1], ...work.slice(0, -1)];
  return steps.map((s, i) => (i === idx ? { ...s, reads } : s));
}
