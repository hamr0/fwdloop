// M4d amendment 7: bareagent decides whether a model's thinking can be changed - not our code, not a table of ours.
// ONE function wraps bareagent's `thinkingSupport(provider, model)`: true | false | 'unverified'. Until the installed bareagent
// exports it, every model is 'unverified' (the Chat "Thinking on" box then works). Feature-detected on the export itself, never on a version.
// The first argument is the row's API shape id ('openai-api' ...), the one thing a row knows about its provider kind without building a client.
import * as providers from 'bare-agent/providers';

/** The sentence under a greyed "Thinking on" box (amendment 7 item 2). */
export const THINKING_FIXED_SAY = "can't change this for this model";

/**
 * @param {string} shape the row's API shape @param {string} model
 * @param {{ impl?: unknown }} [opts] `impl` is a test seam: the function standing in for bareagent's export (default: the installed export, if any)
 * @returns {true|false|'unverified'}
 */
export function thinkingSupport(shape, model, { impl = /** @type {any} */ (providers).thinkingSupport } = {}) {
  if (typeof impl !== 'function') return 'unverified';
  let answer;
  try { answer = impl(shape, model); } catch { return 'unverified'; }
  return answer === true || answer === false ? answer : 'unverified';
}
