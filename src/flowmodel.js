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
 * @returns {{ slot: string, model: string }|null} null when there is no usable record (missing, unreadable, or not a name and a model id)
 */
export function readModelRecord(dir) {
  const r = readFileInside(dir, MODEL_FILE);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.text);
    return isKeyName(j?.slot) && typeof j?.model === 'string' && j.model !== '' ? { slot: j.slot, model: j.model } : null;
  } catch { return null; }
}

/**
 * Write the record once (never over an existing one). @param {string} dir @param {{ slot: string, model: string }} pick
 */
export function writeModelRecord(dir, { slot, model }) {
  writeFileSync(join(dir, MODEL_FILE), `${JSON.stringify({ slot, model }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
