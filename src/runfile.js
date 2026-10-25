// M8b item 1: `run.json`, the run's start record - one file in the run's folder with three sections: `model` (the model the run started on, M4d am33),
// `thinking` (the job's "Thinking on" box as it was at the start, M4d am25) and `inputs` (the manifest `freezeInputs` made, M3/M10). Written once, by
// `writeRunStart` and nothing else; every reader of those three goes through this file's readers (`readRunModel` is in src/flowmodel.js, which owns the provider's
// key-name check). Kept free of the provider on purpose: the learnings note code reads `inputs` and must reach no provider module.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileInside } from './flow.js';

/** the file's name in the run's folder */
export const RUN_FILE = 'run.json';

/**
 * The record as parsed, or why not. `missing` = no file; `unreadable` = the gateway refused it (a symlink, outside the folder); `invalid` = not a JSON object.
 * @param {string|null} runDir @returns {{ok: true, rec: Record<string, any>}|{ok: false, code: 'missing'|'unreadable'|'invalid', red: string}}
 */
export function readRunRecord(runDir) {
  if (typeof runDir !== 'string') return { ok: false, code: 'missing', red: `no ${RUN_FILE}` };
  const r = readFileInside(runDir, RUN_FILE);
  if (!r.ok) return r.missing ? { ok: false, code: 'missing', red: `no ${RUN_FILE}` } : { ok: false, code: 'unreadable', red: `${RUN_FILE}: ${r.red}` };
  try {
    const j = JSON.parse(r.text);
    return j !== null && typeof j === 'object' && !Array.isArray(j) ? { ok: true, rec: j } : { ok: false, code: 'invalid', red: `${RUN_FILE} is not a JSON object` };
  } catch (err) { return { ok: false, code: 'invalid', red: `${RUN_FILE} is not valid JSON — ${/** @type {any} */ (err).message}` }; }
}

/**
 * M4d am26: the run's OWN record of the box (`thinking` in `<run>/run.json`) and nothing else: `true`/`false`, or `null` when the run has none (a run from before am25).
 * An unreadable record is box off, as `readJobThinking` has always read it. @param {string|null} runDir @returns {boolean|null}
 */
export function readRunThinking(runDir) {
  const got = readRunRecord(runDir);
  if (!got.ok) return got.code === 'invalid' ? false : null;
  return Object.hasOwn(got.rec, 'thinking') ? got.rec.thinking === true : null;
}

/**
 * M8b: the ONE reader of what a run froze at its start (`inputs` in `<run>/run.json`: the manifest `freezeInputs` made). `missing` = the run froze none (no record, or no
 * `inputs` section: a refusal at freeze leaves none); `unreadable` = the gateway refused the file; `invalid` = the section is not a list.
 * @param {string|null} runDir
 * @returns {{ok: true, entries: any[]}|{ok: false, code: 'missing'|'unreadable'|'invalid', red: string}}
 */
export function readRunInputs(runDir) {
  const got = readRunRecord(runDir);
  if (!got.ok) return got;
  if (!Object.hasOwn(got.rec, 'inputs')) return { ok: false, code: 'missing', red: `${RUN_FILE} has no inputs` };
  return Array.isArray(got.rec.inputs) ? { ok: true, entries: got.rec.inputs } : { ok: false, code: 'invalid', red: `${RUN_FILE}: inputs is not a list` };
}

/**
 * M8b item 1: the ONE writer of `run.json`, called once when a fresh run has frozen its inputs (`runFlow`); never over an existing record. `model` is the pick
 * the run started on (M4d am33; null = the section is left out), `thinking` the job's "Thinking on" box as it was at the start (M4d am25: written for every fresh
 * run, ticked or not), `inputs` the manifest `freezeInputs` returned. A section given as null is left out;
 * a fresh run always has `thinking` and `inputs`.
 * @param {string} runDir @param {{ model: { slot: string, model: string }|null, thinking: boolean|null, inputs: any[]|null }} start
 */
export function writeRunStart(runDir, { model, thinking, inputs }) {
  writeFileSync(join(runDir, RUN_FILE), `${JSON.stringify({
    ...(model ? { model: { slot: model.slot, model: model.model } } : {}), ...(thinking === null ? {} : { thinking }), ...(inputs === null ? {} : { inputs }),
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
