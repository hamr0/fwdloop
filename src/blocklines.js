// M16 am1 (docs/wiki/the-module-ladder.md, "M16"): the lines the check block is given. STEP lines only: an ask line, a send line and a sheet line get no row.
// Kinds come from fwd's own code: parseSignedText (asks, sends), csvRolesOf + sheetLineBlocks (sheet lines). No classifier of its own.
import { parseSignedText } from './signed-text.js';
import { csvRolesOf, sheetLineBlocks, rulesOfLine } from './sheetblock.js';
import { CheckBlock } from './checkblock.js';

/**
 * @param {string} prose the job's signed text (or the draft's prose)
 * @param {any} [declaration] the declaration, once there is one. Before it exists nothing in fwd says which line reads a sheet (sheetLineBlocks reads the steps' `reads` / `close.sheet`),
 *   so a sheet line is then given as a step line; the caller passes the declaration whenever it has one.
 * @returns {{ok: true, jobLines: {n: number, text: string, rules: string[]}[], skipped: {ask: number[], send: number[], sheet: number[]}}|{ok: false, reds: string[]}}
 */
export function blockJobLines(prose, declaration) {
  const p = parseSignedText(prose);
  if (!p.ok) return { ok: false, reds: p.reds };
  const ask = p.arbiter.asks.map((a) => a.line);
  const send = p.arbiter.sends.map((s) => s.line);
  const lines = p.lines.map((l) => ({ n: l.n, guardrail: l.guardrail }));
  const sheet = declaration ? sheetLineBlocks({ declaration, lines, csvRoles: csvRolesOf(p.arbiter) }).map((b) => b.line) : [];
  const jobLines = p.lines.filter((l) => !ask.includes(l.n) && !send.includes(l.n) && !sheet.includes(l.n)).map((l) => ({ n: l.n, text: l.text, rules: rulesOfLine(l) }));
  return { ok: true, jobLines, skipped: { ask, send, sheet } };
}

/** a block over step lines only, with no `$` cited default (M16 am1). `texts`: label -> frozen text. */
export function newJobBlock({ texts, jobLines, asks = true }) {
  const block = new CheckBlock({ texts, labels: Object.keys(texts), asks, split: true, cited: false });
  block.fromJob(jobLines);
  return block;
}
