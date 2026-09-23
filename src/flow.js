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
  existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { parseSignedText } from './signed-text.js';
import { signFlow, verifyFlow } from './signature.js';
import { validateDeclaration } from './declaration.js';

/** @typedef {import('./types.js').WriteFlowResult} WriteFlowResult */
/** @typedef {import('./types.js').ReadFlowResult} ReadFlowResult */
/** @typedef {import('./types.js').CheckFlowNameResult} CheckFlowNameResult */

/** The three files a signed flow directory carries. Every place in this
 *  module that names a flow file uses this — never a literal string. */
export const FLOW_FILES = Object.freeze(['prose.txt', 'declaration.json', 'signature.json']);

const RUNS_DIR = 'runs';

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
 * @param {{root: unknown, name: unknown, proseText: unknown, declaration: unknown, signedBy: unknown, signedAt: unknown, catalogue: unknown}} input
 * @returns {WriteFlowResult}
 */
export function writeFlow({
  root, name, proseText, declaration, signedBy, signedAt, catalogue,
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
        for (const p of written) rmSync(p, { force: true });
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
    }
  }

  if (reds.length > 0) return { ok: false, reds };

  // Verify against the bytes on disk, not a re-serialised object.
  const verified = verifyFlow({
    proseText, declarationText, signature: signatureJson,
  });
  if (!verified.ok) return { ok: false, reds: verified.reds };

  const signed = parseSignedText(proseText);
  if (!signed.ok) return { ok: false, reds: signed.reds };

  const validated = validateDeclaration(declarationJson, {
    arbiter: signed.arbiter, lines: signed.lines, catalogue,
  });
  if (!validated.ok) return { ok: false, reds: validated.reds };

  return {
    ok: true,
    dir,
    lines: signed.lines,
    arbiter: signed.arbiter,
    declaration: declarationJson,
    signature: signatureJson,
    classes: validated.classes,
  };
}
