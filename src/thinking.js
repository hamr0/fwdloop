// M4d amendment 7: bareagent decides whether a model's thinking can be changed - not our code, not a table of ours.
// ONE function wraps bareagent's `thinkingSupport(provider, model, { baseUrl })` (bare-agent >= 0.52, 'bare-agent/providers'): a pure lookup that returns
// `{ switchable: true | false | 'unverified', off, on, note }`. We return just `switchable`. Its first argument is bareagent's own provider KIND,
// not our row's API shape id, so a shape id is mapped to its kind here. A shape with no kind, or an answer that is not that object, is 'unverified'
// (the Chat "Thinking on" box then works and bareagent errors loudly at the call).
// The row's Base URL is the 3rd argument: bareagent picks the specific kind from the model id / Base URL host exactly as its request path does (0.52).
// A call whose model can't switch no longer throws: bareagent runs it and reports `thinkingStatus`; the sentences for that are `thinkingSay` below.
import * as providers from 'bare-agent/providers';

/** The sentence under a greyed "Thinking on" box (amendment 7 item 2). */
export const THINKING_FIXED_SAY = "can't change this for this model";

/** Our API shape id -> bareagent's provider kind. */
const KIND_OF_SHAPE = Object.freeze({ 'anthropic-api': 'anthropic', 'openai-api': 'openai', 'gemini-api': 'gemini' });

/**
 * @param {string} shape the row's API shape @param {string} model
 * @param {{ impl?: unknown, baseUrl?: string }} [opts] `impl` is a test seam: the function standing in for bareagent's export (default: the installed export); `baseUrl` is the row's Base URL
 * @returns {true|false|'unverified'}
 */
export function thinkingSupport(shape, model, { impl = /** @type {any} */ (providers).thinkingSupport, baseUrl } = {}) {
  const kind = /** @type {Record<string, string>} */ (KIND_OF_SHAPE)[shape];
  if (typeof impl !== 'function' || kind === undefined) return 'unverified';
  let answer;
  try { answer = impl(kind, model, baseUrl === undefined || baseUrl === '' ? undefined : { baseUrl }); } catch { return 'unverified'; }
  const s = answer !== null && typeof answer === 'object' ? answer.switchable : undefined;
  return s === true || s === false ? s : 'unverified';
}

/** bareagent's `thinkingStatus` values, worst first (its own order: ignored > unsupported > unknown > applied). */
const WORST_FIRST = Object.freeze(['ignored', 'unsupported', 'unknown', 'applied']);

/**
 * The worst of a draft's per-round statuses; `null` when no round carried one.
 * @param {Array<string|null|undefined>} statuses @returns {string|null}
 */
export function worstThinkingStatus(statuses) {
  return WORST_FIRST.find((s) => statuses.includes(s)) ?? null;
}

/** The note beside the Chat "Thinking on" box, before any draft, for a model bareagent has not checked (M4d am11 item 2). */
export const THINKING_UNVERIFIED_SAY = 'thinking off (not verified for this model)';

/**
 * The ONE place the thinking words live (M4d am11: bareloop's words). The ✗ line shown in the Chat list when thinking did not go as asked.
 * The words are fixed strings, never built from what was asked: they say what the model did (bareloop's code-owned words).
 * 'applied' (and no status) says nothing here (the list's own "thinking on ✓" / "thinking off ✓" covers it).
 * @param {string|null} status @returns {string|null}
 */
export function thinkingSay(status) {
  if (status === 'ignored') return 'thinking on (the model thought anyway)';
  if (status === 'unsupported') return "thinking on (this model can't change it)";
  if (status === 'unknown') return 'thinking off (not confirmed)';
  return null;
}

/**
 * M4d am26 items 1-2: the words after a try line in the Audit, from that try's audit-row `thinking` {asked, status} (am25). bareagent confirmed it
 * ('applied'): `thinking on` / `thinking off`. Any other status: `thinkingSay`'s words above, the same ones Chat uses. A row with no `thinking` (before am25,
 * or no model call) and a row bareagent reported nothing for (status null) have no words: nothing is guessed.
 * @param {{asked?: unknown, status?: unknown}|null|undefined} thinking @returns {string|null}
 */
export function thinkingTryWords(thinking) {
  if (thinking === null || typeof thinking !== 'object') return null;
  const status = typeof thinking.status === 'string' ? thinking.status : null;
  if (status === 'applied') return thinking.asked === 'on' || thinking.asked === 'off' ? `thinking ${thinking.asked}` : null;
  return thinkingSay(status);
}

/** M4d am26 item 3: the Job tab's one row, the run's rule from its own record (`boxOn` = the Chat "Thinking on" box as the run started). @param {boolean} boxOn */
export function thinkingRuleWords(boxOn) {
  return boxOn ? 'Thinking: on everywhere (ticked)' : 'Thinking: on retries (the default)';
}

/**
 * M4d am25 item 1/2: the ONE owner of what thinking a step's model call asks for. Code decides, never the model.
 * Box ticked (the job's Chat "Thinking on" box, kept with the job): every try 'on'. Box off: the 1st try 'off'; the 2nd and later tries 'on'.
 * A step redone after a human Redo is numbered from its redo count (the runner's `attemptOffset`), so it is always a 2nd-or-later try and thinks 'on'.
 * @param {{boxOn: boolean, attempt: number}} a the runner's 1-based attempt number for this step
 * @returns {'on'|'off'}
 */
export function stepThinkingMode({ boxOn, attempt }) {
  return boxOn === true || (Number.isInteger(attempt) && attempt >= 2) ? 'on' : 'off';
}
