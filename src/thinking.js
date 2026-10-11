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

/**
 * The one sentence the page shows when thinking did not go as asked (M4d am7: a model that can't or won't is said loudly, never silent).
 * 'applied' (and no status) says nothing. @param {'on'|'off'} asked @param {string|null} status @returns {string|null}
 */
export function thinkingSay(asked, status) {
  if (status === 'ignored') return `thinking: you asked ${asked}, the model ignored it`;
  if (status === 'unsupported') return "thinking: this model can't switch it; ran without";
  if (status === 'unknown') return 'thinking: not confirmed by the model';
  return null;
}
