// M20 am3b item 2 (loop map): the ONE gateway every book reader routes through, moved verbatim out of src/flow.js so the readers it serves (placerule, runfile, sheetrun) need not import the flow file.
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * F48 round 3 (docs/logs/FINDINGS.md): the ONE mechanism every book reader
 * in src/ and bin/ routes through to read a file that lives inside a run
 * dir or flow dir — closing the symlink-escape class at the source instead
 * of patching each reader a second time. `resolveInside(baseDir, relPath)`
 * requires the target to both (a) not itself be a symlink and (b) realpath
 * to somewhere inside `realpath(baseDir)` — the second check alone also
 * catches a symlinked ANCESTOR directory partway down `relPath` (e.g.
 * `asks/` itself replaced by a symlink to an outside directory), the same
 * shape `readFlow`'s own `runs/` check and `resolveRunDir` already apply one
 * level up. A path that does not exist yet is reported as `missing: true`
 * (never a red) so every existing caller keeps its own "not written yet"
 * behaviour unchanged.
 *
 * @param {string} baseDir
 * @param {string} relPath
 * @returns {{ok:true, full:string}|{ok:false, missing:true}|{ok:false, missing:false, red:string}}
 */
export function resolveInside(baseDir, relPath) {
  const full = path.join(baseDir, relPath);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return { ok: false, missing: true };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, missing: false, red: `"${relPath}" is a symlink, refused` };
  }
  let realBase;
  let realFull;
  try {
    realBase = realpathSync(baseDir);
    realFull = realpathSync(full);
  } catch (err) {
    return { ok: false, missing: false, red: `could not resolve "${relPath}" — ${err.message}` };
  }
  if (realFull !== realBase && !realFull.startsWith(realBase + path.sep)) {
    return { ok: false, missing: false, red: `"${relPath}" resolves outside its directory — refused` };
  }
  return { ok: true, full };
}

/**
 * `resolveInside` plus the actual read — every raw-text book reader's one
 * gateway. Same result shape as `resolveInside`, plus `{ok:true, text}`.
 * @param {string} baseDir
 * @param {string} relPath
 * @returns {{ok:true, text:string}|{ok:false, missing:true}|{ok:false, missing:false, red:string}}
 */
export function readFileInside(baseDir, relPath) {
  const resolved = resolveInside(baseDir, relPath);
  if (!resolved.ok) return resolved;
  try {
    return { ok: true, text: readFileSync(resolved.full, 'utf8') };
  } catch (err) {
    return { ok: false, missing: false, red: `could not read "${relPath}" — ${err.message}` };
  }
}


/**
 * `readdirSync` guarded the same way: refuses (returns `[]`) when `relDir`
 * itself is a symlink or resolves outside `baseDir`, and skips (never
 * follows) any individual entry that is itself a symlink — a directory
 * listing must never hand a caller a name that, joined back onto `relDir`,
 * would escape `baseDir`. `[]` when `relDir` doesn't exist.
 * @param {string} baseDir
 * @param {string} relDir
 * @returns {string[]}
 */
export function readdirInside(baseDir, relDir) {
  const resolved = resolveInside(baseDir, relDir);
  if (!resolved.ok) return [];
  let entries;
  try {
    entries = readdirSync(resolved.full, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => !e.isSymbolicLink()).map((e) => e.name);
}
