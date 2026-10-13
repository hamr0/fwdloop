// M9 piece 2 (docs/wiki/the-module-ladder.md, "M9" item 6, amendment 2 item 2): the file triggers.
// Poll-based, NOT fs.watch (it throws EMFILE on the dev machine and misses atomic renames; poc/m9 report).
// Proven first in poc/m9 (ported, not imported). This file only says WHAT to run ({path, sha, size});
// starting the run, pinning the input (frozen copy + sha256) and busy/monthly checks are the caller's.
//
// Modes:   'updated' — one file;   'new' — one folder, top level only, regular files only.
// Symlinks are refused, checked at use time (realpathSync on the folder, lstat on the file), never lexically.
// A file is taken only after its size AND mtime were unchanged for STABLE_POLLS consecutive polls.
// Seen ledger (append-only JSONL, write-once rows keyed `sha:<sha256>`, re-read from disk, so it survives restart):
//   { id, kind:'baseline'|'ran', sha, name, size, at }
// 'baseline' = present when the trigger was set (am2 item 2): never runs. 'ran' = handed out; the row is written
// BEFORE poll() returns it, so a crash loses a run and never doubles one. A sha in the ledger never runs again,
// whatever its name, whatever its mtime.
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

/** @typedef {{id:string, kind:'baseline'|'ran', sha:string, name:string, size:number, at:number}} SeenRow */
/** @typedef {{path:string, sha:string, size:number}} ToRun */
/** @typedef {{path:string, why:string}} Refused */

/** Consecutive polls with the same size and mtime before a file is taken. (Two matches in a row = taken on the third sighting.) */
export const STABLE_POLLS = 2;

/** @param {string} file @returns {SeenRow[]} */
export function readSeen(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** @param {string} file @param {SeenRow} row */
function appendSeen(file, row) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

/** @param {Buffer} buf */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * @param {{mode:'new'|'updated', target:string, ledger:string}} opts target = folder (new) or file (updated)
 */
export function createFileTrigger({ mode, target, ledger }) {
  if (mode !== 'new' && mode !== 'updated') throw new Error(`file trigger mode "${mode}" is not one of new, updated`);
  /** @type {Map<string, {key:string, same:number, takenKey:string|null}>} */
  const track = new Map();
  const toldRefused = new Set();

  /**
   * The regular-file candidates right now, re-resolved at use time.
   * @returns {{files:string[], refused:Refused[]}}
   */
  function candidates() {
    /** @type {Refused[]} */ const refused = [];
    if (mode === 'updated') {
      let parent;
      try { parent = realpathSync(dirname(target)); } catch { return { files: [], refused }; }
      const p = join(parent, basename(target));
      let st;
      try { st = lstatSync(p); } catch { return { files: [], refused }; }
      if (st.isSymbolicLink()) return { files: [], refused: [{ path: p, why: 'a symlink is refused' }] };
      if (!st.isFile()) return { files: [], refused: [{ path: p, why: 'not a regular file' }] };
      return { files: [p], refused };
    }
    let real;
    try { real = realpathSync(target); } catch { return { files: [], refused }; }
    const files = [];
    for (const name of readdirSync(real)) {
      const p = join(real, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) refused.push({ path: p, why: 'a symlink is refused' });
      else if (st.isFile()) files.push(p);
    }
    return { files, refused };
  }

  /** Validate the target now and record what is already there as the baseline: it never runs. */
  function arm() {
    if (mode === 'updated') {
      if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`file to watch ${target} is a symlink; a symlink is refused`);
      if (existsSync(target) && !lstatSync(target).isFile()) throw new Error(`${target} is not a file`);
    } else {
      let real;
      try { real = realpathSync(target); } catch { throw new Error(`folder to watch ${target} does not exist`); }
      if (!lstatSync(real).isDirectory()) throw new Error(`${target} is not a folder`);
    }
    const seen = new Set(readSeen(ledger).map((r) => r.sha));
    for (const p of candidates().files) {
      const buf = readFileSync(p);
      const sha = sha256(buf);
      if (seen.has(sha)) continue;
      seen.add(sha);
      appendSeen(ledger, { id: `sha:${sha}`, kind: 'baseline', sha, name: basename(p), size: buf.length, at: Date.now() });
    }
  }

  /** @param {string} p @param {{key:string}} t @returns {ToRun|null|'changed'} null = this sha already ran */
  function take(p, t) {
    const buf = readFileSync(p);
    const st2 = lstatSync(p);
    if (`${st2.size}:${st2.mtimeMs}` !== t.key) return 'changed'; // changed while reading: retry next poll
    const sha = sha256(buf);
    if (readSeen(ledger).some((r) => r.sha === sha)) return null; // this version already ran (or was baseline)
    appendSeen(ledger, { id: `sha:${sha}`, kind: 'ran', sha, name: basename(p), size: buf.length, at: Date.now() });
    return { path: p, sha, size: buf.length };
  }

  /**
   * One poll. Synchronous, so a caller drives it from setInterval and a test drives it by hand.
   * @returns {{run: ToRun[], refused: Refused[]}} refused paths are told once per trigger object
   */
  function poll() {
    const { files, refused } = candidates();
    const run = [];
    const present = new Set(files);
    for (const p of [...track.keys()]) if (!present.has(p)) track.delete(p);
    for (const p of files) {
      let st;
      try { st = lstatSync(p); } catch { continue; }
      const key = `${st.size}:${st.mtimeMs}`;
      let t = track.get(p);
      if (!t) { t = { key, same: 0, takenKey: null }; track.set(p, t); } else if (t.key !== key) { t.key = key; t.same = 0; } else t.same++;
      if (t.same >= STABLE_POLLS && t.takenKey !== key) {
        let got;
        try { got = take(p, t); } catch { continue; } // vanished while reading
        if (got === 'changed') continue;
        t.takenKey = key;
        if (got) run.push(got);
      }
    }
    const told = refused.filter((r) => !toldRefused.has(r.path));
    for (const r of told) toldRefused.add(r.path);
    return { run, refused: told };
  }

  return { arm, poll };
}
