// M4d amendment 6 item 6: the model a job was drafted with is the model it runs with. The pick - a provider (the name of a key)
// and a model id - is recorded in `model.json`, beside the draft and then beside the signed flow. It is NOT one of the signed files: which model
// runs, and at what price, is Settings' to say (a line that is no longer ticked is refused by name at run time), so the record only remembers the choice.
// One writer (`writeModelRecord`), one reader (`readModelRecord`); both go through the safe gateway.
import { writeFileSync, renameSync } from 'node:fs';
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
 * `learnings` spine record shape, `{phase, text, ids, chars}`. Write-once (never over an existing record); written with something handed, or by `writeLearningsError` with an empty `text`
 * (a failed ask: nothing handed, why in `error`); a reader treats empty text as no record, so no file or empty text = nothing handed = no box. Borrowed-from: bareloop src/planrun.js@v0.46.0:3092 (emit('learnings', ...)).
 */
export const LEARNINGS_FILE = 'learnings.json';

/** @param {string} dir @param {{text: string, ids: string[]}} hints */
export function writeLearningsRecord(dir, { text, ids }) {
  writeOnce(join(dir, LEARNINGS_FILE), { phase: 'draft', text, ids, chars: text.length });
}

/**
 * The drafter's failed ask for the block (or failed record write) rides the same record: nothing handed (`text: ''`, no ids), and `error` (first line, secrets redacted).
 * `readLearningsRecord` reads an empty text as no record, so the Audit box stays hidden and `copyLearningsRecord` copies nothing.
 * @param {string} dir @param {string} error
 */
export function writeLearningsError(dir, error) {
  writeOnce(join(dir, LEARNINGS_FILE), { phase: 'draft', text: '', ids: [], chars: 0, error });
}

/**
 * M8 item 6: the Audit box reads the record in the RUN's folder. It reaches the run the way `model.json` does: a draft's record is copied (write-once) into the folder it is signed
 * into (`copyLearningsRecord`: the flow folder at a new job's sign, the new run's folder at a red run's redraft), and the first run that starts from a flow folder TAKES it
 * (`takeLearningsRecord`: a rename, so it moves once and a second run of the same job never shows it). A run that reused its plan has no draft, so it has none.
 * @param {string} fromDir a draft folder @param {string} toDir a flow folder or a run folder @returns {boolean} true when a record was copied
 */
export function copyLearningsRecord(fromDir, toDir) {
  const rec = readLearningsRecord(fromDir);
  if (rec === null) return false;
  writeOnce(join(toDir, LEARNINGS_FILE), rec); // `writeOnce`, the same write-once JSON writer and shape as `writeLearningsRecord`: a record that reads is copied, one that does not is not
  return true;
}

/** @param {string} flowDir @param {string} runDir @returns {boolean} true when the flow's record moved into the run (it is no longer in the flow folder) */
export function takeLearningsRecord(flowDir, runDir) {
  if (!readFileInside(flowDir, LEARNINGS_FILE).ok || readFileInside(runDir, LEARNINGS_FILE).ok) return false;
  renameSync(join(flowDir, LEARNINGS_FILE), join(runDir, LEARNINGS_FILE));
  return true;
}

/**
 * The ONE reader of a run's record. null = no record, or one that is not `{phase, text, ids, chars}` (the box is then hidden, never guessed).
 * @param {string} runDir @returns {{phase: string, text: string, ids: string[], chars: number}|null}
 */
export function readLearningsRecord(runDir) {
  const r = readFileInside(runDir, LEARNINGS_FILE);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.text);
    return j && typeof j.text === 'string' && j.text !== '' && Array.isArray(j.ids) && j.ids.every((/** @type {any} */ x) => typeof x === 'string')
      ? { phase: String(j.phase ?? 'draft'), text: j.text, ids: j.ids, chars: Number.isInteger(j.chars) ? j.chars : j.text.length } : null;
  } catch { return null; }
}
