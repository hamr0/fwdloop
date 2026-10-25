// borrowed-from: bareloop src/prompts.js@1bad2c8 (openAsker only; askRequired and the menu changes are not copied)
// The CLI's one line-asker. Every prompt in the launcher reads through this, so a closed stdin behaves the same everywhere.

import { createInterface } from 'node:readline';

/**
 * One readline over `stdin`, with a LINE QUEUE: lines that arrive before the next question (piped input, a paste, or input that
 * ends while the header is still waiting on the port probe) wait for it instead of being dropped, and a closed stdin answers ''
 * (the safe default) and never hangs.
 * @param {{ stdin?: any, stdout?: any }} [io]
 * @returns {{ ask: (q: string) => Promise<string>, close: () => void }}
 */
export function openAsker(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stdin = io.stdin ?? process.stdin;
  const tty = Boolean(stdin.isTTY);
  // a real terminal needs readline's output to echo the typed line; piped input echoes nothing
  const rl = createInterface({ input: stdin, ...(tty ? { output: stdout, terminal: true } : { terminal: false }) });
  /** @type {string[]} */
  const queue = [];
  /** @type {((s: string) => void)[]} */
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => { const w = waiting.shift(); if (w) w(line); else queue.push(line); });
  rl.once('close', () => { closed = true; while (waiting.length) /** @type {(s: string) => void} */ (waiting.shift())(''); });
  const ask = (/** @type {string} */ q) => {
    stdout.write(q);
    if (queue.length) return Promise.resolve(/** @type {string} */ (queue.shift()));
    if (closed) return Promise.resolve('');
    return new Promise((resolve) => { waiting.push(resolve); });
  };
  return { ask, close: () => rl.close() };
}
