// M20 am5 item 1: what a typed schedule is and whether its file or folder is there, ONE place for the Run card's door (src/panel/authortrigger.js `inspect`) and the New job card
// (its card check and its sign). `shapeOf` moved verbatim out of src/panel/authortrigger.js; the file/folder check is `fileTriggerWhy` in src/trigger-files.js. Reads and writes no file.
import { isAbsolute } from 'node:path';
import { validateSchedule } from './trigger-clock.js';
import { WATCHABLE } from './ticket-shape.js';

/** @typedef {import('./trigger-line.js').Trigger} Trigger */

/**
 * The trigger a body asks for, checked as data: null (By hand) or exactly one of the five shapes, the role one of the job's inputs, a full
 * path. Returns the typed trigger or the sentence that says what to fix.
 * @param {unknown} t @param {string[]} roles
 * @returns {{ok: true, trigger: Trigger|null} | {ok: false, say: string}}
 */
export function shapeOf(t, roles) {
  if (t === null) return { ok: true, trigger: null };
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, say: 'Pick when it runs from the choices. A schedule is not typed as text. Nothing was changed.' };
  const o = /** @type {Record<string, unknown>} */ (t);
  if (o.kind === 'file-updated' || o.kind === 'new-file') {
    const where = o.kind === 'new-file' ? 'folder' : 'path';
    const extra = Object.keys(o).filter((k) => !['kind', 'role', where].includes(k));
    if (extra.length > 0) return { ok: false, say: `A "${o.kind}" trigger takes a kind, a role and a ${where}, not "${extra[0]}". Nothing was changed.` };
    if (typeof o.role !== 'string' || !roles.includes(o.role)) return { ok: false, say: `This job has no input named "${String(o.role)}" (it takes: ${roles.join(', ') || 'none'}). Pick one of those. Nothing was changed.` };
    const p = o[where];
    // eslint-disable-next-line no-control-regex
    if (typeof p !== 'string' || p === '' || !isAbsolute(p) || /[\x00-\x1f\x7f]/.test(p)) return { ok: false, say: `The ${where} must be a full path on one line, like /home/you/inbox. Nothing was changed.` };
    return { ok: true, trigger: /** @type {Trigger} */ (o.kind === 'new-file' ? { kind: 'new-file', role: o.role, folder: p } : { kind: 'file-updated', role: o.role, path: p }) };
  }
  if (o.kind === 'new-ticket') {
    // M12 piece 2: the person picks the input; the list address, the job's server and the look's tool are filled from the signed job (inspect), never typed here
    const extra = Object.keys(o).filter((k) => !['kind', 'role', 'watch'].includes(k));
    if (extra.length > 0) return { ok: false, say: `A "new-ticket" trigger takes a kind and a role, not "${extra[0]}". Nothing was changed.` };
    if (typeof o.role !== 'string' || !roles.includes(o.role)) return { ok: false, say: `This job has no input named "${String(o.role)}" (it takes: ${roles.join(', ') || 'none'}). Pick one of those. Nothing was changed.` };
    if (o.watch !== undefined && !(Array.isArray(o.watch) && o.watch.every((w) => WATCHABLE.includes(w)))) return { ok: false, say: `A ticket schedule can watch only ${WATCHABLE.join(' and ')}. Nothing was changed.` };
    return { ok: true, trigger: /** @type {Trigger} */ ({ kind: 'new-ticket', role: o.role, list: '', server: '', tool: '', ...(o.watch ? { watch: o.watch } : {}) }) };
  }
  try { return { ok: true, trigger: validateSchedule(t) }; } catch (e) { return { ok: false, say: `${/** @type {Error} */ (e).message}. Nothing was changed.` }; }
}
