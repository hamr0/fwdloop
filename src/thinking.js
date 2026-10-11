// M4d amendment 7: bareagent decides whether a model's thinking can be changed - not our code, not a table of ours.
// ONE function wraps bareagent's `thinkingSupport(provider, model)` (bare-agent >= 0.51, 'bare-agent/providers'): a pure lookup that returns
// `{ switchable: true | false | 'unverified', off, on, note }`. We return just `switchable`. Its first argument is bareagent's own provider KIND,
// not our row's API shape id, so a shape id is mapped to its kind here. A shape with no kind, or an answer that is not that object, is 'unverified'
// (the Chat "Thinking on" box then works and bareagent errors loudly at the call).
// Known gap, reported upstream: the shape that speaks the common chat protocol is asked as the plain kind. bareagent itself picks a more specific kind from
// the model id / Base URL when it builds the request (an internal helper, not exported), so this lookup may say 'unverified' where the request path knows more.
import * as providers from 'bare-agent/providers';

/** The sentence under a greyed "Thinking on" box (amendment 7 item 2). */
export const THINKING_FIXED_SAY = "can't change this for this model";

/** Our API shape id -> bareagent's provider kind. */
const KIND_OF_SHAPE = Object.freeze({ 'anthropic-api': 'anthropic', 'openai-api': 'openai', 'gemini-api': 'gemini' });

/**
 * @param {string} shape the row's API shape @param {string} model
 * @param {{ impl?: unknown }} [opts] `impl` is a test seam: the function standing in for bareagent's export (default: the installed export)
 * @returns {true|false|'unverified'}
 */
export function thinkingSupport(shape, model, { impl = /** @type {any} */ (providers).thinkingSupport } = {}) {
  const kind = /** @type {Record<string, string>} */ (KIND_OF_SHAPE)[shape];
  if (typeof impl !== 'function' || kind === undefined) return 'unverified';
  let answer;
  try { answer = impl(kind, model); } catch { return 'unverified'; }
  const s = answer !== null && typeof answer === 'object' ? answer.switchable : undefined;
  return s === true || s === false ? s : 'unverified';
}
