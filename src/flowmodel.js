// M4d amendment 6 item 6: the model a job was drafted with is the model it runs with. The pick - a provider (the name of a key)
// and a model id - is recorded in `model.json`, beside the draft and then beside the signed flow. It is NOT one of the signed files: which model
// runs, and at what price, is Settings' to say (a line that is no longer ticked is refused by name at run time), so the record only remembers the choice.
// One writer (`writeModelRecord`), one reader (`readModelRecord`); both go through the safe gateway.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileInside } from './flow.js';
import { isKeyName } from './provider.js';

export const MODEL_FILE = 'model.json';

/**
 * @param {string} dir a draft folder or a flow folder
 * M4d am25: `thinking: true` is the Chat "Thinking on" box as it was when the job was signed; the key is absent when the box was off.
 * @returns {{ slot: string, model: string, thinking?: true }|null} null when there is no usable record (missing, unreadable, or not a name and a model id)
 */
export function readModelRecord(dir) {
  const r = readFileInside(dir, MODEL_FILE);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.text);
    return isKeyName(j?.slot) && typeof j?.model === 'string' && j.model !== '' ? { slot: j.slot, model: j.model, ...(j.thinking === true ? { thinking: true } : {}) } : null;
  } catch { return null; }
}

/**
 * Write the record once (never over an existing one). @param {string} dir @param {{ slot: string, model: string, thinking?: boolean }} pick
 */
export function writeModelRecord(dir, { slot, model, thinking }) {
  writeOnce(join(dir, MODEL_FILE), { slot, model, ...(thinking === true ? { thinking: true } : {}) });
}

/** The one file write of this module: JSON, 0600, never over an existing file. */
function writeOnce(file, obj) {
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

/** M4d am25: the file in a run's folder that keeps the box as the run started with it (outside `job/`, which holds the three signed files only). */
export const RUN_THINKING_FILE = 'thinking.json';

/**
 * M4d am25: the ONE reader of the job's "Thinking on" box for a run. A run reads its OWN record (`<run>/thinking.json`, written once when the run
 * started) when it has one; otherwise the flow folder's `model.json`. No record, an unreadable one, or one without `thinking` is box OFF: a job
 * signed before am25 stored nothing, and it must not start thinking on every try.
 * @param {string} flowDir @param {string|null} runDir @returns {boolean}
 */
export function readJobThinking(flowDir, runDir) {
  return readRunThinking(runDir) ?? (readModelRecord(flowDir)?.thinking === true);
}

/**
 * M4d am26: the run's OWN record of the box (`<run>/thinking.json`) and nothing else: `true`/`false`, or `null` when the run has none (a run from before am25).
 * An unreadable record is box off, as `readJobThinking` has always read it. @param {string|null} runDir @returns {boolean|null}
 */
export function readRunThinking(runDir) {
  const own = typeof runDir === 'string' ? readFileInside(runDir, RUN_THINKING_FILE) : null;
  if (!own?.ok) return null;
  try { return JSON.parse(own.text)?.thinking === true; } catch { return false; }
}

/**
 * M4d am25: a run keeps the box as the job had it when the run started (write-once, so an Edit of the job never changes a run already going).
 * Written for every fresh run, ticked or not. @param {string} flowDir @param {string} runDir
 */
export function writeRunThinking(flowDir, runDir) {
  writeOnce(join(runDir, RUN_THINKING_FILE), { thinking: readModelRecord(flowDir)?.thinking === true });
}

/** M4d am33: the file in a run's folder that records the model the run STARTED on (write-once; every continue path keeps it). */
export const RUN_MODEL_FILE = 'run-model.json';

/**
 * M4d am33: the ONE reader of the model a run started on, or null (a run from before the record, or an unusable one: the caller then keeps today's pick).
 * @param {string|null} runDir @returns {{ slot: string, model: string }|null}
 */
export function readRunModel(runDir) {
  const r = typeof runDir === 'string' ? readFileInside(runDir, RUN_MODEL_FILE) : null;
  if (!r?.ok) return null;
  try {
    const j = JSON.parse(r.text);
    return isKeyName(j?.slot) && typeof j?.model === 'string' && j.model !== '' ? { slot: j.slot, model: j.model } : null;
  } catch { return null; }
}

/** M4d am33: the ONE writer, called once when a fresh run starts (`runFlow`); never over an existing record. @param {string} runDir @param {{ slot: string, model: string }} pick */
export function writeRunModel(runDir, { slot, model }) {
  writeOnce(join(runDir, RUN_MODEL_FILE), { slot, model });
}

/**
 * M8 item 5a: the file that keeps EXACTLY what the drafter was handed from earlier runs (the Audit box of item 6 reads it). Bareloop's
 * `learnings` spine record shape, `{phase, text, ids, chars}`. Write-once (never over an existing record); written only when something was
 * handed, so no file = nothing handed = no box. Borrowed-from: bareloop src/planrun.js@v0.46.0:3092 (emit('learnings', ...)).
 */
export const LEARNINGS_FILE = 'learnings.json';

/** @param {string} dir @param {{text: string, ids: string[]}} hints */
export function writeLearningsRecord(dir, { text, ids }) {
  writeOnce(join(dir, LEARNINGS_FILE), { phase: 'draft', text, ids, chars: text.length });
}
