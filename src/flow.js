// M1 piece 5 (docs/wiki/the-module-ladder.md, "M1 — scope, exit, negative —
// SIGNED", item 7 and item 4): the on-disk flow directory —
//
//   flows/<flow-name>/
//     prose.txt          the signed text: numbered lines + guardrails + arbiter block
//     declaration.json   the drafter's half, validated
//     signature.json     sha256 of both, signed-by, signed-at
//     runs/<run-id>/     (M2's — M1 only creates the empty runs/ directory)
//
// "The M2 runner will refuse a run whose files do not hash to the signature,
// naming the file. In M1 the check exists and is tested; nothing runs yet."
//
// This module is the ONLY reader and the ONLY writer of a flow directory
// (project rule: one writer per piece of state). It composes the pieces
// already built — parseSignedText (piece 1), signFlow/verifyFlow (piece 2),
// validateDeclaration (piece 3), the catalogue as data (piece 4) — it does
// not reimplement any of their checks.
//
// Never throws on bad input or a filesystem error: every failure path is
// caught and returned as a red naming the file or path involved.

import {
  accessSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { parseSignedText } from './signed-text.js';
import { signFlow, verifyFlow } from './signature.js';
import { validateDeclaration } from './declaration.js';
import { describeChange } from './signed-diff.js';

/** @typedef {import('./types.js').WriteFlowResult} WriteFlowResult */
/** @typedef {import('./types.js').ReadFlowResult} ReadFlowResult */
/** @typedef {import('./types.js').CheckFlowNameResult} CheckFlowNameResult */

/** The three files a signed flow directory carries. Every place in this
 *  module that names a flow file uses this — never a literal string. */
export const FLOW_FILES = Object.freeze(['prose.txt', 'declaration.json', 'signature.json']);
/** The one folder under the flows root where the panel keeps each run start's own files (M4e piece 2b). A dot-name, so never a flow. */
export const PANEL_STARTS_DIR = '.starts';

const RUNS_DIR = 'runs';
/** Amendment 43: the write-once copy of the two signed files, made at sign by `writeFlow` (the ONE writer). Outside FLOW_FILES: it never enters the signature or `readFlow`'s success path. */
const SIGNED_COPY_DIR = 'signed';
const CHANGED_PREFIX = 'changed since signing: ';

/** The plain "what changed" sentences inside a readFlow refusal (am43), joined for a sentence a human reads; '' when there are none. @param {string[]} reds */
export function changeSentence(reds) {
  const xs = reds.filter((r) => typeof r === 'string' && r.startsWith(CHANGED_PREFIX)).map((r) => r.slice(CHANGED_PREFIX.length));
  return xs.length > 0 ? ` What changed: ${xs.join('; ')}.` : '';
}

/**
 * Check a flow name against the allowed shape: 1..64 characters, lowercase
 * a-z, 0-9, `-`, `_`, starting with a letter or digit. Walked character by
 * character — never a regex — so a name that would escape the flows
 * directory (`..`, a `/` or `\` segment, a leading dot, an absolute path)
 * or is simply empty is refused by the same loop that refuses a bad
 * character, not a separate ad-hoc check.
 *
 * @param {unknown} name
 * @returns {CheckFlowNameResult}
 */
export function checkFlowName(name) {
  if (typeof name !== 'string') {
    return { ok: false, red: 'flow: name must be a string' };
  }
  if (name.length === 0) {
    return { ok: false, red: 'flow: name must not be empty' };
  }
  if (name.length > 64) {
    return { ok: false, red: `flow: name is ${name.length} characters, must be 1..64` };
  }
  for (let i = 0; i < name.length; i += 1) {
    const ch = name[i];
    const isDigit = ch >= '0' && ch <= '9';
    const isLower = ch >= 'a' && ch <= 'z';
    const isDashUnderscore = ch === '-' || ch === '_';
    if (i === 0) {
      if (!isDigit && !isLower) {
        return { ok: false, red: `flow: name must start with a letter or digit, got "${ch}"` };
      }
      continue;
    }
    if (!isDigit && !isLower && !isDashUnderscore) {
      return { ok: false, red: `flow: name character ${i} ("${ch}") is not one of a-z, 0-9, "-", "_"` };
    }
  }
  return { ok: true };
}

/**
 * Check a runId against the allowed shape: 1..128 characters, letters
 * (upper or lower), digits, `.`, `_`, `-`, starting with a letter or digit.
 * Walked character by character — never a regex — same reasoning as
 * `checkFlowName`: a runId that would escape the flow's runs directory
 * (`..`, a `/` or `\` segment, a NUL byte, an absolute path) is refused by
 * the same loop that refuses a bad character, not a separate ad-hoc check.
 *
 * One writer: every caller that turns an externally-supplied runId into a
 * path (`bin/fwdloop`'s `run`/`resume`, `runFlow`, `resumeRun`) goes through
 * this function (via `resolveRunDir`, below) — a runId is never trusted
 * enough to be joined onto a path any other way. Fixes the path escape a
 * branch review found: `--run-id ../../../../tmp/pwned`.
 *
 * @param {unknown} runId
 * @returns {{ok:true}|{ok:false,red:string}}
 */
export function checkRunId(runId) {
  if (typeof runId !== 'string') {
    return { ok: false, red: 'run: runId must be a string' };
  }
  if (runId.length === 0) {
    return { ok: false, red: 'run: runId must not be empty' };
  }
  if (runId.length > 128) {
    return { ok: false, red: `run: runId is ${runId.length} characters, must be 1..128` };
  }
  for (let i = 0; i < runId.length; i += 1) {
    const ch = runId[i];
    const isDigit = ch >= '0' && ch <= '9';
    const isUpper = ch >= 'A' && ch <= 'Z';
    const isLower = ch >= 'a' && ch <= 'z';
    const isDotDashUnderscore = ch === '.' || ch === '-' || ch === '_';
    if (i === 0) {
      if (!isDigit && !isUpper && !isLower) {
        return { ok: false, red: `run: runId "${runId}" must start with a letter or digit, got "${ch}"` };
      }
      continue;
    }
    if (!isDigit && !isUpper && !isLower && !isDotDashUnderscore) {
      return { ok: false, red: `run: runId "${runId}" character ${i} ("${ch}") is not one of A-Z, a-z, 0-9, ".", "-", "_"` };
    }
  }
  if (runId.includes('..')) {
    return { ok: false, red: `run: runId "${runId}" must not contain ".."` };
  }
  return { ok: true };
}

/**
 * Turn a checked runId into its run directory under `flowDir/runs/`, then
 * confirm the built path actually resolves INSIDE that runs directory —
 * belt and braces alongside `checkRunId`'s character allow-list (mirrors
 * `src/runner.js`'s own `checkSendDestination` shape: lexical containment,
 * checked after the path is built, never trusted from the allow-list
 * alone).
 *
 * Lexical containment (`path.resolve` plus a prefix compare) only catches a
 * bad runId string — it does not catch a runId that *passes* the allow-list
 * but names a symlink pointing outside `flowDir/runs/` (F36 fixed `runs/`
 * itself being a symlink; this is the same class one level down, for an
 * entry inside it). So once the lexical check passes, anything that
 * actually EXISTS on disk is re-checked with `realpathSync`: `runs/` itself
 * must realpath inside `flowDir` (mirrors F36's `readFlow` check), and — if
 * the run dir exists — it must realpath inside the real `runs/` dir. A
 * not-yet-existing run dir (a new run being created) has nothing to
 * realpath yet, so only the lexical result is returned for it; the check
 * holds at use time (here, on every call), not only at some earlier
 * preflight.
 *
 * @param {string} flowDir
 * @param {unknown} runId
 * @returns {{ok:true, runDir:string}|{ok:false, red:string}}
 */
export function resolveRunDir(flowDir, runId) {
  const check = checkRunId(runId);
  if (!check.ok) return check;
  const runsDir = path.join(flowDir, RUNS_DIR);
  const runDir = path.join(runsDir, /** @type {string} */ (runId));
  const resolvedRunsDir = path.resolve(runsDir);
  const resolvedRunDir = path.resolve(runDir);
  if (resolvedRunDir !== resolvedRunsDir && !resolvedRunDir.startsWith(resolvedRunsDir + path.sep)) {
    return { ok: false, red: `run: runId "${runId}" resolves outside the runs directory — refused` };
  }

  if (existsSync(runsDir)) {
    let realRunsDir;
    let realFlowDir;
    try {
      realRunsDir = realpathSync(runsDir);
      realFlowDir = realpathSync(flowDir);
    } catch (err) {
      return { ok: false, red: `run: could not resolve "${runsDir}" — ${err.message}` };
    }
    if (realRunsDir !== realFlowDir && !realRunsDir.startsWith(realFlowDir + path.sep)) {
      return { ok: false, red: `run: "${RUNS_DIR}" is a symlink that resolves outside the flow directory (${realRunsDir}) — refused` };
    }

    if (existsSync(runDir)) {
      let realRunDir;
      try {
        realRunDir = realpathSync(runDir);
      } catch (err) {
        return { ok: false, red: `run: could not resolve "${runDir}" — ${err.message}` };
      }
      if (realRunDir !== realRunsDir && !realRunDir.startsWith(realRunsDir + path.sep)) {
        return { ok: false, red: `run: runId "${runId}" is a symlink that resolves outside the runs directory (${realRunDir}) — refused` };
      }
    }
  }

  return { ok: true, runDir: resolvedRunDir };
}

/**
 * Every flow name that has a real, readable directory under `root` — M4a
 * piece 2 (docs/wiki/the-module-ladder.md M4a scope item 2: "every flow
 * under --root"). A directory entry that fails `checkFlowName` (should not
 * happen for anything `writeFlow` itself created, but a hand-placed or
 * legacy directory is possible) is skipped rather than crashing the whole
 * listing — this is a best-effort enumeration, not a validator; a caller
 * that wants to know a flow is well-formed calls `readFlow` on it.
 * `[]` when `root` doesn't exist or has no entries — never a thrown error.
 * Sorted so a caller gets a stable, deterministic order.
 * @param {string} root
 * @returns {string[]}
 */
export function listFlowNames(root) {
  if (typeof root !== 'string' || root.length === 0 || !existsSync(root)) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && checkFlowName(e.name).ok)
    .map((e) => e.name)
    .sort();
}

/**
 * Every runId with a real, readable directory under a flow's own `runs/`
 * (M4a scope item 2: "every run"). Same best-effort posture as {@link
 * listFlowNames} — a malformed entry is skipped, never thrown on.
 * @param {string} flowDir
 * @returns {string[]}
 */
export function listRunIds(flowDir) {
  const runsDir = path.join(flowDir, RUNS_DIR);
  if (!existsSync(runsDir)) return [];
  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && checkRunId(e.name).ok)
    .map((e) => e.name)
    .sort();
}

/**
 * M4e amendment 3 item 2: the ONE place a run gets its default name. `run-<n>`, counting up per flow (the run lives in its flow's
 * folder, so the name only has to be unique there). `nextRunId` only LOOKS (max existing `run-<n>` + 1; the page's prefill);
 * `claimRunId` CLAIMS: it creates the run folder exclusively (mkdir with no `recursive` on the final component, so a second
 * starter gets EEXIST, never the same folder) and bumps n on EEXIST, a bounded number of times. Runs already made keep their ids.
 * @param {string} flowDir
 * @returns {string}
 */
export function nextRunId(flowDir) {
  let max = 0;
  for (const id of listRunIds(flowDir)) {
    const m = /^run-([0-9]+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `run-${max + 1}`;
}

const CLAIM_TRIES = 50;

/**
 * @param {string} flowDir
 * @returns {{ok:true, runId:string, runDir:string}|{ok:false, red:string}}
 */
export function claimRunId(flowDir) {
  const runsDir = path.join(flowDir, RUNS_DIR);
  let n = Number(nextRunId(flowDir).slice(4));
  for (let i = 0; i < CLAIM_TRIES; i += 1, n += 1) {
    const runId = `run-${n}`;
    const r = resolveRunDir(flowDir, runId);
    if (!r.ok) return r;
    try {
      mkdirSync(runsDir, { recursive: true });
      mkdirSync(r.runDir); // NOT recursive: the exclusive create IS the claim
      return { ok: true, runId, runDir: r.runDir };
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== 'EEXIST') return { ok: false, red: `run: could not claim a run name — ${/** @type {Error} */ (err).message}` };
    }
  }
  return { ok: false, red: `run: could not claim a run name after ${CLAIM_TRIES} tries` };
}

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

function readTextFile(filePath, label, reds) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    reds.push(`flow: ${label} is missing`);
    return null;
  }
  if (stat.isSymbolicLink()) {
    reds.push(`flow: ${label} is a symlink, refused`);
    return null;
  }
  if (!stat.isFile()) {
    reds.push(`flow: ${label} is not a regular file`);
    return null;
  }
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    reds.push(`flow: ${label} could not be read — ${err.message}`);
    return null;
  }
  if (text.length === 0) {
    reds.push(`flow: ${label} is empty`);
    return null;
  }
  return text;
}

/**
 * Write a signed flow to `<root>/<name>/`. Refuses (writing nothing) if the
 * flow name is invalid, if `proseText`/`declaration` don't parse/validate,
 * if `signFlow` refuses, or if any of the three files already exists.
 * Otherwise writes `prose.txt`, `declaration.json`, then `signature.json`
 * last (each via a temp file + rename in the same directory), creates an
 * empty `runs/`, and proves the result by reading it back with `readFlow`.
 *
 * M6: with `replaces: {flowHash}` it instead REPLACES the signed job already under that name (see `replaceSigned`), and only if that job is
 * still the one with that signature hash. `onReplaceStep` is a test seam: called after each move of the swap; a throw there is a failure.
 *
 * @param {{root: unknown, name: unknown, proseText: unknown, declaration: unknown, signedBy: unknown, signedAt: unknown, catalogue: unknown, replaces?: {flowHash: string}, onReplaceStep?: (step: string) => void}} input
 * @returns {WriteFlowResult}
 */
export function writeFlow({
  root, name, proseText, declaration, signedBy, signedAt, catalogue, replaces, onReplaceStep,
}) {
  const nameCheck = checkFlowName(name);
  if (!nameCheck.ok) return { ok: false, reds: [nameCheck.red] };
  const safeName = /** @type {string} */ (name);

  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, reds: ['flow: "root" must be a non-empty string'] };
  }

  const signed = parseSignedText(proseText);
  if (!signed.ok) return { ok: false, reds: signed.reds };

  const validated = validateDeclaration(declaration, {
    arbiter: signed.arbiter, lines: signed.lines, catalogue,
  });
  if (!validated.ok) return { ok: false, reds: validated.reds };

  let declarationText;
  try {
    declarationText = `${JSON.stringify(declaration, null, 2)}\n`;
  } catch (err) {
    return { ok: false, reds: [`flow: declaration could not be serialised — ${err.message}`] };
  }

  const signResult = signFlow({
    proseText, declarationText, signedBy, signedAt,
  });
  if (!signResult.ok) return { ok: false, reds: signResult.reds };

  const dir = path.join(root, safeName);

  if (replaces !== undefined) {
    return replaceSigned({
      root, name: safeName, dir, proseText: /** @type {string} */ (proseText), declarationText, signature: signResult.signature, replaces, catalogue, onReplaceStep,
    });
  }

  // Refuse if any of the three files already exists — M1 never overwrites a
  // signed flow (versions are M4).
  for (const fileName of FLOW_FILES) {
    const filePath = path.join(dir, fileName);
    let exists;
    try {
      exists = existsSync(filePath);
    } catch (err) {
      return { ok: false, reds: [`flow: could not check "${filePath}" — ${err.message}`] };
    }
    if (exists) {
      return { ok: false, reds: [`flow: "${fileName}" already exists at ${filePath}`] };
    }
  }

  if (existsSync(path.join(dir, SIGNED_COPY_DIR))) {
    return { ok: false, reds: [`flow: "${SIGNED_COPY_DIR}" already exists at ${path.join(dir, SIGNED_COPY_DIR)}`] };
  }

  // Track what THIS call creates so a failure partway through can be rolled
  // back — a directory must never be left with a signature but a missing
  // file.
  const createdDir = !existsSync(dir);
  const written = [];

  const rollback = () => {
    try {
      if (createdDir) {
        rmSync(dir, { recursive: true, force: true });
      } else {
        for (const p of written) rmSync(p, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup; the red already reports the real failure
    }
  };

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { ok: false, reds: [`flow: could not create directory ${dir} — ${err.message}`] };
  }

  const writeOne = (fileName, contents) => {
    const finalPath = path.join(dir, fileName);
    const tmpPath = path.join(dir, `.${fileName}.tmp-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(tmpPath, contents, 'utf8');
      renameSync(tmpPath, finalPath);
    } catch (err) {
      try { rmSync(tmpPath, { force: true }); } catch { /* best-effort */ }
      throw new Error(`could not write ${finalPath} — ${err.message}`);
    }
    written.push(finalPath);
  };

  try {
    writeOne('prose.txt', proseText);
    writeOne('declaration.json', declarationText);
    // am43: the copy of what is being signed, write-once (`wx` refuses an existing file), before the signature that makes it a signed flow.
    const copyDir = path.join(dir, SIGNED_COPY_DIR);
    mkdirSync(copyDir);
    written.push(copyDir);
    writeFileSync(path.join(copyDir, 'prose.txt'), /** @type {string} */ (proseText), { encoding: 'utf8', flag: 'wx' });
    writeFileSync(path.join(copyDir, 'declaration.json'), declarationText, { encoding: 'utf8', flag: 'wx' });
    writeOne('signature.json', `${JSON.stringify(signResult.signature, null, 2)}\n`);

    const runsDir = path.join(dir, RUNS_DIR);
    mkdirSync(runsDir, { recursive: true });
  } catch (err) {
    rollback();
    return { ok: false, reds: [`flow: ${err.message}`] };
  }

  // The mechanical "it happened" check: the artifact exists, is non-empty,
  // and verifies — read our own write back through the one reader.
  const proof = readFlow({ root, name, catalogue });
  if (!proof.ok) {
    rollback();
    return { ok: false, reds: proof.reds };
  }

  return {
    ok: true, dir, signature: signResult.signature,
  };
}

/**
 * The signature hash (`signature.json` `flow`) of the signed job in `flowDir`, or null when there is no readable one. It does NOT verify the
 * files (that is `readFlow`): it only says which signing this folder is at, for M6's "was this job signed again since you opened it".
 * @param {string} flowDir @returns {string|null}
 */
export function signedHashOf(flowDir) {
  const f = readFileInside(flowDir, 'signature.json');
  if (!f.ok) return null;
  try { const h = JSON.parse(f.text)?.flow; return typeof h === 'string' && h !== '' ? h : null; } catch { return null; }
}

/** M6: the names `replaceSigned` swaps, signature last (the file that makes the folder a signed flow). `setup.jsonl` is only moved away: the caller writes the new one. */
const SWAP_NAMES = ['prose.txt', 'declaration.json', SIGNED_COPY_DIR, 'setup.jsonl', 'signature.json'];

/**
 * M6 ("Signing replaces the job"): replace the signed job in `<root>/<name>/`, ALL OR NOTHING, keeping the name, `runs/` and the flow's books.
 * Refuses (touching nothing) unless the folder holds a signed job whose `signature.json` `flow` hash is `replaces.flowHash` (a draft opened from an
 * older version of the job, or a job signed again meanwhile, is refused by name). The new files are staged inside the folder first; the swap then moves
 * each old file into a backup folder and its new one into place (signature last); ANY failure, or a proof read that does not verify, moves everything
 * back. On success the backup is deleted — no old version is kept anywhere (hamr's ruling). Only a hard kill inside the swap leaves the backup
 * (`.replace-old-*`) holding the old files; nothing recovers it automatically.
 * @param {{root: string, name: string, dir: string, proseText: string, declarationText: string, signature: any, replaces: {flowHash: string}, catalogue: unknown, onReplaceStep?: (step: string) => void}} a
 * @returns {WriteFlowResult}
 */
function replaceSigned({
  root, name, dir, proseText, declarationText, signature, replaces, catalogue, onReplaceStep,
}) {
  const red = (/** @type {string} */ r) => ({ ok: /** @type {false} */ (false), reds: [r] });
  let dirStat;
  try { dirStat = lstatSync(dir); } catch { return red(`flow: nothing signed to replace — "${name}" has no folder here`); }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return red(`flow: "${dir}" is not a plain folder, refused`);
  const current = signedHashOf(dir);
  if (current === null) return red(`flow: nothing signed to replace — "${name}" has no readable signature.json`);
  if (typeof replaces?.flowHash !== 'string' || current !== replaces.flowHash) {
    return red(`flow: "${name}" was signed again since you opened it for editing, so this edit is out of date. Nothing was changed. Open the job again and redo the edit.`);
  }

  const stamp = `${process.pid}-${Date.now()}`;
  const stage = path.join(dir, `.replace-new-${stamp}`);
  const backup = path.join(dir, `.replace-old-${stamp}`);
  const moved = [];   // names whose OLD file is now in backup
  const placed = [];  // names whose NEW file is now in dir
  const cleanup = () => {
    for (const p of [stage, backup]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ } }
  };
  const putBack = () => {
    for (const n of [...placed].reverse()) rmSync(path.join(dir, n), { recursive: true, force: true });
    for (const n of [...moved].reverse()) renameSync(path.join(backup, n), path.join(dir, n));
  };
  const fail = (/** @type {string} */ why) => {
    try { putBack(); } catch (err) {
      // the old files could not all be put back: say where they are rather than pretend (the backup is NOT cleaned up)
      return red(`flow: ${why}; the old job could not be fully put back (${err.message}) — its files are in ${backup}`);
    }
    cleanup();
    return red(`flow: ${why}`);
  };

  try {
    mkdirSync(stage);
    mkdirSync(backup);
    mkdirSync(path.join(stage, SIGNED_COPY_DIR));
    writeFileSync(path.join(stage, 'prose.txt'), proseText, 'utf8');
    writeFileSync(path.join(stage, 'declaration.json'), declarationText, 'utf8');
    writeFileSync(path.join(stage, SIGNED_COPY_DIR, 'prose.txt'), proseText, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(path.join(stage, SIGNED_COPY_DIR, 'declaration.json'), declarationText, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(path.join(stage, 'signature.json'), `${JSON.stringify(signature, null, 2)}\n`, 'utf8');
  } catch (err) {
    cleanup();
    return red(`flow: could not stage the new files — ${err.message}. Nothing was changed.`);
  }

  try {
    for (const n of SWAP_NAMES) {
      if (existsSync(path.join(dir, n))) { renameSync(path.join(dir, n), path.join(backup, n)); moved.push(n); }
      if (existsSync(path.join(stage, n))) { renameSync(path.join(stage, n), path.join(dir, n)); placed.push(n); }
      onReplaceStep?.(n);
    }
  } catch (err) {
    return fail(`could not replace the job — ${err.message}`);
  }

  // the mechanical "it happened" check, as at sign: read the replaced job back through the one reader
  const proof = readFlow({ root, name, catalogue });
  if (!proof.ok) return fail(`the replaced job does not verify (${proof.reds.join('; ')})`);
  cleanup();
  return { ok: true, dir, signature };
}

/**
 * Read and verify a signed flow from `<root>/<name>/`. Verifies the bytes on
 * disk against the signature FIRST — before anything in the flow is
 * trusted — then parses the signed text, then validates the declaration.
 * Never throws; every failure is a red naming the file or path.
 *
 * @param {{root: unknown, name: unknown, catalogue: unknown}} input
 * @returns {ReadFlowResult}
 */
export function readFlow({ root, name, catalogue }) {
  const nameCheck = checkFlowName(name);
  if (!nameCheck.ok) return { ok: false, reds: [nameCheck.red] };
  const safeName = /** @type {string} */ (name);

  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, reds: ['flow: "root" must be a non-empty string'] };
  }

  const dir = path.join(root, safeName);

  let dirStat;
  try {
    dirStat = lstatSync(dir);
  } catch {
    return { ok: false, reds: [`flow: directory "${dir}" is missing`] };
  }
  if (dirStat.isSymbolicLink()) {
    return { ok: false, reds: [`flow: directory "${dir}" is a symlink, refused`] };
  }
  if (!dirStat.isDirectory()) {
    return { ok: false, reds: [`flow: "${dir}" is not a directory`] };
  }

  const reds = [];
  const proseText = readTextFile(path.join(dir, 'prose.txt'), 'prose.txt', reds);
  const declarationText = readTextFile(path.join(dir, 'declaration.json'), 'declaration.json', reds);
  const signatureText = readTextFile(path.join(dir, 'signature.json'), 'signature.json', reds);

  let declarationJson;
  if (declarationText !== null) {
    try {
      declarationJson = JSON.parse(declarationText);
    } catch {
      reds.push('flow: declaration.json is not valid JSON');
    }
  }

  let signatureJson;
  if (signatureText !== null) {
    try {
      signatureJson = JSON.parse(signatureText);
    } catch {
      reds.push('flow: signature.json is not valid JSON');
    }
  }

  // runs/ (M1 only creates the empty directory; reading inside it is M2's
  // job — this only checks it exists, isn't a symlink, and is a directory).
  const runsPath = path.join(dir, RUNS_DIR);
  let runsStat;
  try {
    runsStat = lstatSync(runsPath);
  } catch {
    reds.push(`flow: directory "${dir}/${RUNS_DIR}" is missing`);
  }
  if (runsStat) {
    if (runsStat.isSymbolicLink()) {
      reds.push(`flow: directory "${dir}/${RUNS_DIR}" is a symlink, refused`);
    } else if (!runsStat.isDirectory()) {
      reds.push(`flow: "${dir}/${RUNS_DIR}" is not a directory`);
    } else {
      try {
        accessSync(runsPath, fsConstants.R_OK | fsConstants.X_OK);
      } catch (err) {
        reds.push(`flow: directory "${dir}/${RUNS_DIR}" is not readable (${err.code})`);
      }
    }
  }

  if (reds.length > 0) return { ok: false, reds };

  // Verify against the bytes on disk, not a re-serialised object.
  const verified = verifyFlow({
    proseText, declarationText, signature: signatureJson,
  });
  if (!verified.ok) return { ok: false, reds: [...verified.reds, ...explainEdit(dir, signatureJson, /** @type {string} */ (proseText), /** @type {string} */ (declarationText))] };

  return interpretSigned({
    proseText: /** @type {string} */ (proseText), declarationJson, signatureJson, catalogue, dir,
  });
}

/**
 * The part of a read that follows a passed signature check, shared by `readFlow` and `readRunJobCopy`: parse the signed text, validate the declaration.
 * @param {{proseText: string, declarationJson: any, signatureJson: any, catalogue: unknown, dir: string}} a
 * @returns {ReadFlowResult}
 */
function interpretSigned({
  proseText, declarationJson, signatureJson, catalogue, dir,
}) {
  const signed = parseSignedText(proseText);
  if (!signed.ok) return { ok: false, reds: signed.reds };

  const validated = validateDeclaration(declarationJson, {
    arbiter: signed.arbiter, lines: signed.lines, catalogue,
  });
  if (!validated.ok) return { ok: false, reds: validated.reds };

  return {
    ok: /** @type {true} */ (true),
    dir,
    lines: signed.lines,
    arbiter: signed.arbiter,
    declaration: declarationJson,
    signature: signatureJson,
    classes: validated.classes,
  };
}

/** M6: the folder inside a run that holds the copy of the job it ran. */
const RUN_JOB_DIR = 'job';

/**
 * M6 ("Each run saves a copy of the job it ran when it starts"): the ONE writer of `<runDir>/job/`. Reads the flow's three files, proves them against
 * the flow's own signature first (a flow that does not verify is never copied), then writes them write-once (`wx`). `{ok:false, red}` writes nothing
 * it did not finish (a half-written copy is removed). Never throws.
 * @param {string} flowDir @param {string} runDir
 * @returns {{ok: true} | {ok: false, red: string}}
 */
export function writeRunJobCopy(flowDir, runDir) {
  const texts = {};
  for (const f of FLOW_FILES) {
    const r = readFileInside(flowDir, f);
    if (!r.ok) return { ok: false, red: `job copy: could not read ${f} (${r.missing ? 'missing' : r.red})` };
    texts[f] = r.text;
  }
  let signature;
  try { signature = JSON.parse(texts['signature.json']); } catch { return { ok: false, red: 'job copy: signature.json is not valid JSON' }; }
  const verified = verifyFlow({ proseText: texts['prose.txt'], declarationText: texts['declaration.json'], signature });
  if (!verified.ok) return { ok: false, red: `job copy: the flow does not match its signature (${verified.reds[0]})` };
  const dir = path.join(runDir, RUN_JOB_DIR);
  try {
    mkdirSync(dir);
    for (const f of FLOW_FILES) writeFileSync(path.join(dir, f), texts[f], { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    try { if (err.code !== 'EEXIST') rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    return { ok: false, red: err.code === 'EEXIST' ? 'job copy: this run already has its copy — never overwritten' : `job copy: could not write (${err.code ?? err.message})` };
  }
  return { ok: true };
}

/**
 * M6: the job a run ran, from its own copy. `{present:false}` = the run has none (it started before M6). `{present:true, ok:true, ...}` = the same
 * shape as a good `readFlow` (lines, arbiter, declaration, signature, classes), after the copy was verified against the copied signature.
 * `{present:true, ok:false, reds}` = a copy that was edited or is incomplete: refused, never shown as the job.
 * @param {string} runDir @param {unknown} catalogue
 * @returns {{present: false} | ({present: true} & ReadFlowResult)}
 */
export function readRunJobCopy(runDir, catalogue) {
  const dir = path.join(runDir, RUN_JOB_DIR);
  if (!existsSync(dir)) return { present: false };
  const reds = [];
  const proseText = readTextFile(path.join(dir, 'prose.txt'), 'prose.txt', reds);
  const declarationText = readTextFile(path.join(dir, 'declaration.json'), 'declaration.json', reds);
  const signatureText = readTextFile(path.join(dir, 'signature.json'), 'signature.json', reds);
  let declarationJson;
  let signatureJson;
  try { if (declarationText !== null) declarationJson = JSON.parse(declarationText); } catch { reds.push('flow: declaration.json is not valid JSON'); }
  try { if (signatureText !== null) signatureJson = JSON.parse(signatureText); } catch { reds.push('flow: signature.json is not valid JSON'); }
  if (reds.length > 0) return { present: true, ok: false, reds };
  const verified = verifyFlow({ proseText, declarationText, signature: signatureJson });
  if (!verified.ok) return { present: true, ok: false, reds: [...verified.reds] };
  return {
    present: /** @type {true} */ (true),
    ...interpretSigned({
      proseText: /** @type {string} */ (proseText), declarationJson, signatureJson, catalogue, dir,
    }),
  };
}

/**
 * Amendment 43: after a failed verify, name what changed by comparing with the copy `writeFlow` kept at sign. The copy is trusted ONLY if it
 * verifies against signature.json itself; otherwise it is never compared. Returns extra reds (plain sentences); never throws.
 * @param {string} dir @param {any} signature @param {string} proseText @param {string} declarationText
 * @returns {string[]}
 */
function explainEdit(dir, signature, proseText, declarationText) {
  const oldProse = readFileInside(dir, `${SIGNED_COPY_DIR}/prose.txt`);
  const oldDecl = readFileInside(dir, `${SIGNED_COPY_DIR}/declaration.json`);
  if (!oldProse.ok && oldProse.missing && !oldDecl.ok && oldDecl.missing) {
    return [CHANGED_PREFIX + '(signed before amendment 43: no copy to compare)'];
  }
  if (!oldProse.ok || !oldDecl.ok) return [CHANGED_PREFIX + "the saved copy of the signed files is incomplete, so it can't be trusted to compare"];
  if (!verifyFlow({ proseText: oldProse.text, declarationText: oldDecl.text, signature }).ok) {
    return [CHANGED_PREFIX + "the saved copy of the signed files does not match the signature, so it can't be trusted to compare"];
  }
  const changes = describeChange({ oldProse: oldProse.text, newProse: proseText, oldDecl: oldDecl.text, newDecl: declarationText });
  if (changes.length === 0) return [CHANGED_PREFIX + 'the files match the saved copy; signature.json itself was changed'];
  return changes.map((c) => `${CHANGED_PREFIX}${c}`);
}
