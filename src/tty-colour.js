// borrowed-from: bareloop src/tty-colour.js@v0.47.1 (704d598)
// Adaptation: none.
// ONE place for terminal colour (the launcher's header, menu and messages). Colours wrap words and never change them: with colour off
// every helper returns its text untouched, so plain-text readers (tests, pipes, logs) see the same words.

const wrap = (/** @type {string} */ code) => (/** @type {string} */ s) => `\x1b[${code}m${s}\x1b[0m`;
const id = (/** @type {string} */ s) => s;

/**
 * @typedef {object} Paint
 * @property {boolean} on
 * @property {(s: string) => string} grey @property {(s: string) => string} green @property {(s: string) => string} yellow
 * @property {(s: string) => string} red @property {(s: string) => string} cyan @property {(s: string) => string} boldCyan
 */

/**
 * Colour is on only for a terminal: the stream says it is a TTY, `NO_COLOR` is empty/unset, and `TERM` is not `dumb`.
 * @param {{isTTY?: boolean}|undefined} stream the output stream (process.stdout)
 * @param {Record<string, string|undefined>} [env]
 * @returns {Paint}
 */
export function makePaint(stream, env = process.env) {
  const on = Boolean(stream && stream.isTTY) && !(env.NO_COLOR ?? '') && env.TERM !== 'dumb';
  if (!on) return { on, grey: id, green: id, yellow: id, red: id, cyan: id, boldCyan: id };
  return { on, grey: wrap('90'), green: wrap('32'), yellow: wrap('33'), red: wrap('31'), cyan: wrap('36'), boldCyan: wrap('1;36') };
}

/** the no-colour paint, the default when a caller passes none */
export const PLAIN = makePaint(undefined, {});
