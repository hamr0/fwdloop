// M1 piece — signature.js: the hash pinning `prose.txt` + `declaration.json`
// (docs/wiki/the-module-ladder.md, "M1 — scope, exit, negative — SIGNED",
// scope item 4: "A hash that flips on any edit"; flow directory item 7).
//
// The M2 runner will refuse a run whose files do not hash to the signature,
// naming the file. In M1 the check exists and is tested; nothing runs yet.
// This module never reads the clock, never touches disk — the caller (a
// human-signing step, later) passes signedAt and the file contents.

import { createHash } from 'node:crypto';

/** @typedef {import('./types.js').CanonicalBytesResult} CanonicalBytesResult */
/** @typedef {import('./types.js').SignFlowResult} SignFlowResult */
/** @typedef {import('./types.js').VerifyFlowResult} VerifyFlowResult */

/** The signature.json fields the mutation suite is required to cover —
 *  kept in sync with signFlow/verifyFlow below. */
export const SIGNATURE_FIELDS = Object.freeze([
  'version',
  'algorithm',
  'files.prose.txt',
  'files.declaration.json',
  'flow',
  'signedBy',
  'signedAt',
]);

const KNOWN_FILES = Object.freeze(['prose.txt', 'declaration.json']);
const HEX64_RE = /^[0-9a-f]{64}$/;
// Strict-enough ISO-8601: date, "T", time, optional fractional seconds, and
// either "Z" or a numeric UTC offset. Fixed literal, no nested quantifiers.
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The canonical bytes hashed for one of the two signed files. Never throws.
 *
 * `prose.txt`: the exact file bytes with CRLF normalised to LF and nothing
 * else changed — no trimming, no Unicode normalisation. The human signs the
 * text as written; a Windows checkout (CRLF line endings) must not flip the
 * hash, but anything the human actually wrote — a trailing space, a changed
 * character — must.
 *
 * `declaration.json`: parsed then re-serialised with object keys sorted
 * recursively, no whitespace, arrays left in their original order. So
 * key order and indentation (cosmetic) can never flip the hash, while any
 * value or structural change (including reordering an array — order is
 * meaning for `steps`) always does. Unparseable JSON is a red, never a
 * throw.
 *
 * @param {'prose.txt'|'declaration.json'} kind
 * @param {unknown} content
 * @returns {CanonicalBytesResult}
 */
export function canonicalBytes(kind, content) {
  if (typeof content !== 'string') {
    return { ok: false, red: `${kind}: content must be a string` };
  }
  if (kind === 'prose.txt') {
    const normalised = content.replace(/\r\n/g, '\n');
    return { ok: true, bytes: Buffer.from(normalised, 'utf8') };
  }
  if (kind === 'declaration.json') {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, red: 'declaration.json: is not valid JSON' };
    }
    const canonical = JSON.stringify(sortKeysDeep(parsed));
    return { ok: true, bytes: Buffer.from(canonical, 'utf8') };
  }
  return { ok: false, red: `${kind}: unknown canonical file kind` };
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

function hashHex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Sign a flow: hash `proseText` and `declarationText` (canonically) and pin
 * who signed and when. Pure — never reads the clock, never touches disk.
 *
 * @param {{proseText: unknown, declarationText: unknown, signedBy: unknown, signedAt: unknown}} input
 * @returns {SignFlowResult}
 */
export function signFlow({ proseText, declarationText, signedBy, signedAt }) {
  const reds = [];

  if (typeof signedBy !== 'string' || signedBy.trim().length === 0) {
    reds.push('signature: field "signedBy" is required and must be a non-empty string');
  }
  if (typeof signedAt !== 'string' || !ISO8601_RE.test(signedAt)) {
    reds.push('signature: field "signedAt" is required and must be an ISO-8601 string');
  }

  const prose = canonicalBytes('prose.txt', proseText);
  if (!prose.ok) reds.push(`signature: ${prose.red}`);
  const declaration = canonicalBytes('declaration.json', declarationText);
  if (!declaration.ok) reds.push(`signature: ${declaration.red}`);

  if (reds.length > 0 || !prose.ok || !declaration.ok) return deepFreeze({ ok: false, reds });

  const proseHash = hashHex(prose.bytes);
  const declarationHash = hashHex(declaration.bytes);
  const flowHash = hashHex(Buffer.from(proseHash + declarationHash, 'utf8'));

  return deepFreeze({
    ok: true,
    signature: {
      version: 1,
      algorithm: 'sha256',
      files: { 'prose.txt': proseHash, 'declaration.json': declarationHash },
      flow: flowHash,
      signedBy,
      signedAt,
    },
  });
}

/**
 * Verify a flow against its signature. Collects every red found — never
 * throws, never stops at the first problem.
 *
 * @param {{proseText: unknown, declarationText: unknown, signature: unknown}} input
 * @returns {VerifyFlowResult}
 */
export function verifyFlow({ proseText, declarationText, signature }) {
  const reds = [];

  if (typeof signature !== 'object' || signature === null || Array.isArray(signature)) {
    return deepFreeze({ ok: false, reds: ['signature: signature must be an object'] });
  }
  /** @type {any} */
  const sig = signature;

  if (sig.version !== 1) {
    reds.push(`signature: field "version" is unknown (expected 1, got ${JSON.stringify(sig.version)})`);
  }
  if (sig.algorithm !== 'sha256') {
    reds.push(`signature: field "algorithm" is unknown (expected "sha256", got ${JSON.stringify(sig.algorithm)})`);
  }

  const files = sig.files;
  let filesOk = true;
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    reds.push('signature: field "files" must be an object with "prose.txt" and "declaration.json"');
    filesOk = false;
  } else {
    for (const name of KNOWN_FILES) {
      if (!(name in files)) {
        reds.push(`signature: field "files.${name}" is missing`);
        filesOk = false;
      } else if (typeof files[name] !== 'string' || !HEX64_RE.test(files[name])) {
        reds.push(`signature: field "files.${name}" is not a valid sha256 hex digest`);
        filesOk = false;
      }
    }
    const extra = Object.keys(files).filter((k) => !KNOWN_FILES.includes(k));
    if (extra.length > 0) {
      reds.push(`signature: field "files" has unexpected entries: ${extra.join(', ')}`);
      filesOk = false;
    }
  }

  if (typeof sig.flow !== 'string' || !HEX64_RE.test(sig.flow)) {
    reds.push('signature: field "flow" is not a valid sha256 hex digest');
  } else if (filesOk) {
    const expectedFlow = hashHex(Buffer.from(files['prose.txt'] + files['declaration.json'], 'utf8'));
    if (expectedFlow !== sig.flow) {
      reds.push('signature: field "flow" does not match the two file hashes (signature may have been hand-edited)');
    }
  }

  if (typeof sig.signedBy !== 'string' || sig.signedBy.trim().length === 0) {
    reds.push('signature: field "signedBy" is required and must be a non-empty string');
  }
  if (typeof sig.signedAt !== 'string' || !ISO8601_RE.test(sig.signedAt)) {
    reds.push('signature: field "signedAt" is required and must be an ISO-8601 string');
  }

  if (filesOk) {
    const prose = canonicalBytes('prose.txt', proseText);
    if (!prose.ok) {
      reds.push(`signature: ${prose.red}`);
    } else {
      const found = hashHex(prose.bytes);
      if (found !== files['prose.txt']) {
        reds.push(
          `signature: prose.txt does not match its signed hash (signed ${files['prose.txt'].slice(0, 12)}…, found ${found.slice(0, 12)}…)`,
        );
      }
    }

    const declaration = canonicalBytes('declaration.json', declarationText);
    if (!declaration.ok) {
      reds.push(`signature: ${declaration.red}`);
    } else {
      const found = hashHex(declaration.bytes);
      if (found !== files['declaration.json']) {
        reds.push(
          `signature: declaration.json does not match its signed hash (signed ${files['declaration.json'].slice(0, 12)}…, found ${found.slice(0, 12)}…)`,
        );
      }
    }
  }

  if (reds.length > 0) return deepFreeze({ ok: false, reds });
  return deepFreeze({ ok: true });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
