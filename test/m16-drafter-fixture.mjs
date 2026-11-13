// Test helpers for the M16 drafter tests (S1-S4): a provider that answers by the name of the forced tool, and the m14-walk-5 / flights fixtures. Test-only.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { MODEL } from './drafter-fixture.mjs';

export const rd = (/** @type {string} */ f) => readFileSync(new URL(`./fixtures/m16-block/${f}`, import.meta.url), 'utf8');
const usage = { inputTokens: 900, outputTokens: 100 };
/** a reply that calls one tool */
export const callOf = (/** @type {string} */ name, /** @type {any} */ args) => ({ text: '', toolCalls: [{ id: 't1', name, arguments: args }], usage, stopReason: 'tool_calls', model: MODEL });
export const textOf = (/** @type {string} */ text = 'sure') => ({ text, toolCalls: [], usage, stopReason: 'stop', model: MODEL });
export const malformedOf = (/** @type {string} */ name, /** @type {string} */ rawArguments) => ({ text: '', toolCalls: [], usage, stopReason: 'tool_use', model: MODEL, malformedToolCall: { name, rawArguments, error: 'Unexpected non-whitespace character after JSON at position 9' } });

/**
 * A provider that answers by the name of the forced tool (`map` = a call with no tool). `handlers[name]` is a reply, a list of replies (the last repeats) or `(n, messages) => reply`.
 * @param {Record<string, any>} handlers
 */
export function router(handlers) {
  /** @type {{name: string, messages: any[], options: any}[]} */
  const calls = [];
  return {
    lastMalformedToolCall: /** @type {any} */ (null),
    calls,
    names: () => calls.map((c) => c.name),
    async generate(/** @type {any[]} */ messages, /** @type {any[]} */ tools, /** @type {any} */ options) {
      const name = tools[0]?.name ?? 'map';
      calls.push({ name, messages: JSON.parse(JSON.stringify(messages)), options });
      const n = calls.filter((c) => c.name === name).length;
      const h = handlers[name] ?? textOf();
      const r = typeof h === 'function' ? h(n, messages) : Array.isArray(h) ? h[Math.min(n - 1, h.length - 1)] : h;
      this.lastMalformedToolCall = r.malformedToolCall ?? null;
      return r;
    },
  };
}


/** the m14-walk-5 job with its notes input pointed at a tmp file (cleaned up after the test) */
export function walkProse(/** @type {import('node:test').TestContext} */ t, /** @type {(s: string) => string} */ edit = (s) => s) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16d-'));
  mkdirSync(path.join(home, 'out'));
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, rd('m14-walk-5/notes.md'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return edit(rd('m14-walk-5/prose.txt')).replace('file:/home/user/walk/m14-garden-notes.md', `file:${notes}`).replace('file:/home/user/fwdloop-out', `file:${path.join(home, 'out')}`);
}
