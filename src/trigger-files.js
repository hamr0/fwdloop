// M9 piece 2 (docs/wiki/the-module-ladder.md, "M9" item 6, amendment 2 item 2): the file triggers.
// Poll-based, NOT fs.watch (it throws EMFILE on the dev machine and misses atomic renames; poc/m9 report).
// Proven first in poc/m9 (ported, not imported). This file only says WHAT to run ({path, sha, size});
// starting the run, pinning the input (frozen copy + sha256) and busy/monthly checks are the caller's.
//
// Modes:   'updated' — one file;   'new' — one folder, top level only, regular files only.
// Symlinks are refused, checked at use time (realpathSync on the folder, lstat on the file), never lexically.
// A file is taken only after its size AND mtime were unchanged for STABLE_POLLS consecutive polls.
// Seen ledger (append-only JSONL, write-once rows keyed by id, re-read from disk, so it survives restart). M9 am3: THE SCHEDULER is its only
// writer after `arm`; this file only says what the rows are and how to read the queue out of them:
//   { id, kind:'baseline'|'arrived'|'ran'|'dropped', sha, name, size, at }  (+ `path` on arrived, `why` and `of` (the arrived id it cancels) on dropped)
// 'baseline' = present when the trigger was set (am2 item 2): never runs. 'arrived' = a finished file with a never-seen sha was seen
// (`at` = the scheduler's clock; a 2nd arrival of a dropped sha gets id `arrived:<sha>:<n>`). 'ran' = written immediately BEFORE that file's run is started, so a crash loses a run and never doubles
// one. 'dropped' = it was deleted / changed before its turn. A sha with a `ran` row never arrives again, whatever its name or mtime; see `arrives` for baseline / queued / dropped.
// poll() writes nothing: it only reports finished files whose sha is new.
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { appendRow, ledgerText } from './jsonl-append.js';

/** @typedef {{id:string, kind:'baseline'|'arrived'|'ran'|'dropped', sha:string, name:string, size:number, at:number, path?:string, why?:string, of?:string}} SeenRow */
/** @typedef {{path:string, sha:string, size:number}} ToRun */
/** @typedef {{path:string, why:string}} Refused */

/** Consecutive polls with the same size and mtime before a file is taken. (Two matches in a row = taken on the third sighting.) */
export const STABLE_POLLS = 2;

/** Every row that parses; a line a crash tore mid-append is skipped (it counts as not written). `appendSeen` starts each append on a fresh line, so a torn line can never glue onto the next row. @param {string} file @returns {SeenRow[]} */
export function readSeen(file) {
  return ledgerText(file).split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** The ONE appender: write-once by id (a second row with the same id is not written). Starts on a fresh line when the file does not end in a newline (a torn last line). @param {string} file @param {SeenRow} row @returns {boolean} written */
function appendSeen(file, row) {
  if (readSeen(file).some((r) => r.id === row.id)) return false;
  mkdirSync(dirname(file), { recursive: true });
  appendRow(file, row);
  return true;
}

/** Rows of one sha, file order. @param {SeenRow[]} rows @param {string} sha */
const ofSha = (rows, sha) => rows.filter((r) => r.sha === sha);
/** An arrived row is still waiting: neither its sha ran nor a dropped row names it. @param {SeenRow[]} rows @param {SeenRow} a */
const waiting = (rows, a) => a.kind === 'arrived'
  && !rows.some((r) => (r.kind === 'ran' && r.sha === a.sha) || (r.kind === 'dropped' && ((/** @type {any} */ (r)).of ?? `arrived:${r.sha}`) === a.id));

/**
 * Does this finished version arrive? Item 6 + am2: only a sha that already RAN never arrives again; one already arrived and still queued does not
 * arrive twice; one that was dropped (never ran) may. A `baseline` blocks only while it is still the starting point: file-updated = until the file
 * has changed away (any later arrived/ran/dropped row of ANOTHER sha); new-file = for that sha for good (hamr 2026-10-13: content present at arm never runs, so a renamed or copied baseline file is not new).
 * @param {SeenRow[]} rows @param {{sha:string}} it @param {'new'|'updated'} mode
 */
function arrives(rows, it, mode) {
  const mine = ofSha(rows, it.sha);
  if (mine.some((r) => r.kind === 'ran' || waiting(rows, r))) return false;
  const bi = rows.findLastIndex((r) => r.kind === 'baseline' && r.sha === it.sha);
  if (bi < 0) return true;
  return mode === 'updated' && rows.slice(bi + 1).some((r) => r.kind !== 'baseline' && r.sha !== it.sha);
}

/** Arrived rows are never overwritten: the 2nd arrival of a sha (after a drop) gets its own id. @param {string} ledger @param {ToRun & {name?:string}} item @param {number} at the scheduler's clock, never the file's mtime */
export function recordArrived(ledger, item, at) {
  const rows = readSeen(ledger);
  if (rows.some((r) => r.sha === item.sha && (r.kind === 'ran' || waiting(rows, r)))) return false; // one writer decides: ran or already queued
  const n = rows.filter((r) => r.kind === 'arrived' && r.sha === item.sha).length;
  return appendSeen(ledger, { id: n ? `arrived:${item.sha}:${n}` : `arrived:${item.sha}`, kind: 'arrived', sha: item.sha, name: basename(item.path), size: item.size, path: item.path, at });
}
/** Call immediately before the run is started. @param {string} ledger @param {{sha:string, path:string, size:number}} item @param {number} at */
export const recordRan = (ledger, item, at) => appendSeen(ledger, { id: `ran:${item.sha}`, kind: 'ran', sha: item.sha, name: basename(item.path), size: item.size, at });
/** `of` = the arrived row it cancels (item.id when a queue row is passed). @param {string} ledger @param {{sha:string, path:string, size:number, id?:string}} item @param {'deleted'|'changed'|'schedule-changed'|'carried'} why @param {number} at */
export function recordDropped(ledger, item, why, at) {
  const of = item.id ?? `arrived:${item.sha}`;
  return appendSeen(ledger, { id: `dropped:${of}`, kind: 'dropped', sha: item.sha, name: basename(item.path), size: item.size, why, at, of });
}

/**
 * The queue: arrived and neither ran nor dropped, oldest arrival first. Identical arrival times: by name, then by sha (deterministic).
 * @param {SeenRow[]} rows @returns {(SeenRow & {path:string})[]}
 */
export function queueOf(rows) {
  const cmp = (/** @type {string} */ x, /** @type {string} */ y) => (x < y ? -1 : x > y ? 1 : 0);
  return /** @type {any} */ (rows.filter((r) => waiting(rows, r)))
    .sort((x, y) => x.at - y.at || cmp(x.name, y.name) || cmp(x.sha, y.sha));
}

/**
 * At a queued file's turn, look at it again, at use time: lstat (no symlink, a regular file), realpath of its folder, re-hash.
 * @param {{path:string, sha:string}} item
 * @returns {{state:'ok', path:string, sha:string, size:number} | {state:'deleted', say:string} | {state:'changed', sha:string}}
 */
export function recheck(item) {
  let parent;
  try { parent = realpathSync(dirname(item.path)); } catch { return { state: 'deleted', say: 'its folder is gone' }; }
  const p = join(parent, basename(item.path));
  let st;
  try { st = lstatSync(p); } catch { return { state: 'deleted', say: 'it was deleted' }; }
  if (st.isSymbolicLink() || !st.isFile()) return { state: 'deleted', say: 'it is no longer a regular file (a symlink is refused)' };
  let buf;
  try { buf = readFileSync(p); } catch { return { state: 'deleted', say: 'it was deleted' }; }
  const sha = sha256(buf);
  return sha === item.sha ? { state: 'ok', path: p, sha, size: buf.length } : { state: 'changed', sha };
}

/** @param {Buffer} buf */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * The target is usable NOW, or an Error naming why: a file that is not a symlink and not something else (a file that does not exist yet
 * is allowed: it may arrive), a folder that exists, resolved with realpathSync. The one rule `arm` and a door's set-time check share.
 * @param {'new'|'updated'} mode @param {string} target
 */
export function checkTarget(mode, target) {
  if (mode === 'updated') {
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`file to watch ${target} is a symlink; a symlink is refused`);
    if (existsSync(target) && !lstatSync(target).isFile()) throw new Error(`${target} is not a file`);
  } else {
    let real;
    try { real = realpathSync(target); } catch { throw new Error(`folder to watch ${target} does not exist`); }
    if (!lstatSync(real).isDirectory()) throw new Error(`${target} is not a folder`);
  }
}

/**
 * M9 am16: does a trigger on this target still watch this file? New: the file sits directly in the same (real) folder. Updated: it is the same (real) file. False when the target cannot be resolved.
 * @param {'new'|'updated'} mode @param {string} target @param {string} filePath a queued file's path as the watcher recorded it (a real path)
 */
export function watches(mode, target, filePath) {
  try {
    if (mode === 'new') return realpathSync(target) === dirname(filePath);
    return join(realpathSync(dirname(target)), basename(target)) === filePath;
  } catch { return false; }
}

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
    checkTarget(mode, target);
    for (const p of candidates().files) {
      const buf = readFileSync(p);
      const sha = sha256(buf);
      appendSeen(ledger, { id: `baseline:${sha}:${basename(p)}`, kind: 'baseline', sha, name: basename(p), size: buf.length, at: Date.now() }); // write-once: re-arming adds nothing
    }
  }

  /** @param {string} p @param {{key:string}} t @returns {ToRun|null|'changed'} null = this sha already ran */
  function take(p, t) {
    const buf = readFileSync(p);
    const st2 = lstatSync(p);
    if (`${st2.size}:${st2.mtimeMs}` !== t.key) return 'changed'; // changed while reading: retry next poll
    const sha = sha256(buf);
    if (!arrives(readSeen(ledger), { sha }, mode)) return null; // ran, still queued, or still the starting point
    return { path: p, sha, size: buf.length };
  }

  /**
   * One poll. Synchronous, so a caller drives it from setInterval and a test drives it by hand.
   * @returns {{arrived: ToRun[], refused: Refused[]}} finished files with a never-seen sha (the caller records them); refused paths are told once per trigger object
   */
  function poll() {
    const { files, refused } = candidates();
    const arrived = [];
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
        if (got) arrived.push(got);
      }
    }
    const told = refused.filter((r) => !toldRefused.has(r.path));
    for (const r of told) toldRefused.add(r.path);
    return { arrived, refused: told };
  }

  return { arm, poll };
}
