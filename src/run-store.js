// M7 piece 2 (docs/wiki/the-module-ladder.md, "M7 scope — SIGNED", item 2): memory
// lasts one run only. Each run gets its own fresh litectx store and nothing carries
// into the next run.
//
// One function decides where a run's store lives (`runStoreDir`); everything else
// asks it. The store is a sibling of the run folder, under `<runs>/.stores/<runId>/`,
// so it is OUTSIDE the run dir and therefore outside every `readScope` the gate hands
// a step (read reaches the run dir and its frozen inputs' dirs, nothing above). A
// granted `read` cannot open the store's sqlite file as raw bytes. `.stores` is not a
// valid run id (a run id must start with a letter or digit), so run listings skip it.
//
// The store is opened per call and closed in `finally`: no handle outlives a tool
// call, so a restarted process (resume) finds the same run's store on disk and a
// different run never shares one.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiteCtx } = require('litectx');

/** The folder holding THIS run's store. A different run dir is a different folder.
 *  @param {string} runDir */
export function runStoreDir(runDir) {
  const resolved = path.resolve(runDir);
  return path.join(path.dirname(resolved), '.stores', path.basename(resolved));
}

/** Open this run's store, run `fn(lc)`, close it. `root` is the run dir: litectx indexes
 *  only its own extensions (.md .js .py ...) there, never the run's json/jsonl records.
 *  @template T @param {string} runDir @param {(lc: any) => Promise<T>|T} fn @returns {Promise<T>} */
export async function withRunStore(runDir, fn) {
  const lc = new LiteCtx({ root: path.resolve(runDir), dbPath: path.join(runStoreDir(runDir), 'index.db') });
  try {
    return await fn(lc);
  } finally {
    lc.close();
  }
}

/** A run STARTS with an empty store, never an inherited one: a run id can be reused (the next id is max+1, so deleting the last run
 *  folder hands its id to the next run) and the store sits beside the run folder, not in it. Called by the one place a fresh run
 *  begins (`runFlow`); resume and continue keep the run's own store. @param {string} runDir */
export function resetRunStore(runDir) {
  rmSync(runStoreDir(runDir), { recursive: true, force: true });
}
