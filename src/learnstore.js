// borrowed-from: bareloop src/learnstore.js@v0.46.0 (8b3d815)
// Adaptations: M8 item 3: the ledger home is fwdloop's configHome() (src/config.js) in place of bareloop's keysHome, so the file is <configHome>/learn/ledger.json (mode 600, as bareloop); with no explicit home under a test process and no FWDLOOP_CONFIG_HOME, ledgerPath throws, so a test can never reach the real ~/.config/fwdloop; hintsForRun is NOT copied (it hands hints to the drafter, M8 item 5a, not built yet); stageQuestionsByName is not copied either (see learnAtRunEnd); imports trimmed to match. Nothing else changed. Known gap, kept on purpose (M8 item 7): foldRunIntoLedger and releaseRun read, change and replace the file, so two runs ending together can lose a note.
// The thin reader/writer around src/learn.js (cross-run learnings, ITEM33-BUILD.md rev 2). All file IO lives here and
// the pure rules live in learn.js; nothing in either file can reach a model.
//
// ONE ledger per user: `<config home>/learn/ledger.json` (~/.config/fwdloop/learn/ledger.json in production; tests inject a
// scratch home and never create the real directory). It lives outside every person's repo, is written atomically
// (temp file + rename) and mode 600, and every string in it passes the one secret inventory before it is written.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { configHome, configDoorHome, readConfig } from './config.js';
import { emptyLedger, redactDeep, countLedger, holdPending, releasePending, recordHealth } from './learn.js';

/**
 * `<configHome>/learn/ledger.json`. Under a test process (NODE_ENV=test or node --test) the home is the explicit one or
 * FWDLOOP_CONFIG_HOME; with neither it THROWS rather than fall back to the real ~/.config/fwdloop.
 * @param {string} [home] test seam; production never passes it
 * @returns {string}
 */
export function ledgerPath(home) {
  if (home === undefined) {
    const door = configDoorHome();
    if (door.skip) throw new Error('learnings ledger: a test process has no config home (set FWDLOOP_CONFIG_HOME or pass one)');
    home = door.home;
  }
  return join(configHome(home), 'learn', 'ledger.json');
}

/**
 * Read the ledger. A missing file is an empty ledger; an unreadable or wrong-shaped one is reported as `problem` (and the
 * writer then refuses to replace it: an append-only record is never silently reset).
 * @param {string} [home]
 * @returns {{ledger: import('./learn.js').Ledger, exists: boolean, problem: string|null}}
 */
export function readLedger(home) {
  const file = ledgerPath(home);
  if (!existsSync(file)) return { ledger: emptyLedger(), exists: false, problem: null };
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    if (!d || typeof d !== 'object' || d.version !== 1 || !Array.isArray(d.rows) || !Array.isArray(d.pending)) {
      return { ledger: emptyLedger(), exists: true, problem: `${file} is not a version-1 learnings ledger — fix or remove it` };
    }
    return { ledger: { ...emptyLedger(), ...d }, exists: true, problem: null };
  } catch (/** @type {any} */ e) {
    return { ledger: emptyLedger(), exists: true, problem: `${file} is not readable JSON (${e?.code ?? 'parse error'}) — fix or remove it` };
  }
}

/**
 * Write the ledger atomically (temp + rename, mode 600), every string masked through the one secret inventory.
 * @param {import('./learn.js').Ledger} ledger @param {string} [home]
 * @returns {string} the file written
 */
export function writeLedger(ledger, home) {
  const file = ledgerPath(home);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(redactDeep(ledger), null, 1)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}

/**
 * Fold ONE finished run into the ledger on disk: a deterministic job's cards COUNT now; a rubric job's cards are HELD
 * until a human Accept (they are written to `pending`, never counted, never readable). The run's health line is recorded
 * either way. Never throws on a bad ledger file: it reports `problem` and writes nothing.
 * @param {{home?: string, runid: string, build: import('./learn.js').CardBuild, workflow: string, place: string|null, specHash: string|null, trust: 'deterministic'|'rubric', at: string, now?: Date}} o
 * @returns {{wrote: boolean, counted: number, held: number, problem: string|null}}
 */
export function foldRunIntoLedger({ home, runid, build, workflow, place, specHash, trust, at, now = new Date() }) {
  const cur = readLedger(home);
  if (cur.problem) return { wrote: false, counted: 0, held: 0, problem: cur.problem };
  let L = cur.ledger;
  let counted = 0;
  let held = 0;
  if (trust === 'rubric') {
    L = holdPending(L, { runid, cards: build.cards, workflow, place, specHash, at }, now);
    held = build.cards.length;
  } else {
    const before = L.rows.reduce((n, r) => n + r.runIds.filter((x) => x === runid).length, 0);
    L = countLedger(L, { runid, cards: build.cards, workflow, place, specHash, trust, now });
    counted = L.rows.reduce((n, r) => n + r.runIds.filter((x) => x === runid).length, 0) - before;
  }
  L = recordHealth(L, runid, build, at, now);
  writeLedger(L, home);
  return { wrote: true, counted, held, problem: null };
}

/**
 * The human Accept at the review door: release the run's held rubric cards so they count (only forward, only here).
 * @param {{home?: string, runid: string, now?: Date}} o
 * @returns {{released: number, problem: string|null}}
 */
export function releaseRun({ home, runid, now = new Date() }) {
  const cur = readLedger(home);
  if (cur.problem) return { released: 0, problem: cur.problem };
  const r = releasePending(cur.ledger, runid, now);
  if (r.ledger !== cur.ledger) writeLedger(r.ledger, home);
  return { released: r.released, problem: null };
}

/**
 * M8 am1: the ONE setting, `learningHints` in config.json. Ships OFF (absent = off). OFF still writes the tally ($0); the drafter
 * is simply handed nothing. Copied from bareloop learnstore.js@v0.46.0:104 (borrowed-from header above). Difference: bareloop's
 * `readConfig` returns a problem, fwdloop's THROWS ConfigError on an unreadable / non-JSON / invalid file. The safe reading is kept:
 * a bad or unreadable config reads as OFF (never ON). Under a test process with no explicit home and no FWDLOOP_CONFIG_HOME it
 * reads nothing (OFF), so a test can never reach the real ~/.config/fwdloop.
 * @param {string} [home]
 * @returns {boolean}
 */
export function learningHintsOn(home) {
  let h = home;
  if (h === undefined) {
    const door = configDoorHome();
    if (door.skip) return false;
    h = door.home;
  }
  try {
    return readConfig({ home: h }).learningHints === true;
  } catch {
    return false;
  }
}
