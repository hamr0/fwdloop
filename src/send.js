// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): the live `sendStep(target, filename, content)` `src/runner.js`'s
// `runFlow` expects. `checkSendDestination` — the containment check
// (lexical AND realpath, write-time re-check) — is owned by `src/runner.js`
// (piece 1 already wrote it); this module imports it rather than growing a
// second writer of the same rule.
//
// borrowed-from: fwdloop poc/m0/runner.mjs@76a3607 (`sendViaPrimitive`: a
// real `shell_write` call, never a bespoke `writeFileSync` standing in for
// it, and the "happened" re-read of the bytes ACTUALLY on disk — never the
// in-memory content handed in — so a write that silently truncates to 0
// bytes reds here, not upstream).

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createShellTools } from 'bare-agent/tools';

import { checkSendDestination } from './runner.js';
import { serializeArtifact, sha256Hex } from './ask.js';

const { tools: SHELL_TOOLS } = createShellTools();
const FOUND_WRITE_TOOL = SHELL_TOOLS.find((t) => t.name === 'shell_write');
if (!FOUND_WRITE_TOOL) throw new Error('send: bare-agent/tools does not export a "shell_write" tool');
const WRITE_TOOL = FOUND_WRITE_TOOL;

const SCALAR = ['string', 'number', 'boolean'];

/** one value as leaf lines `{parts, text}`: parts are the names on the way in; text is a string as it is, a number or boolean written out; a list of plain values joined by ", "; null as empty */
/** @param {string[]} parts @param {any} v @returns {{parts: string[], text: string}[]} */
function leaves(parts, v) {
  if (v === null || v === undefined) return [{ parts, text: '' }];
  if (SCALAR.includes(typeof v)) return [{ parts, text: `${v}` }];
  if (Array.isArray(v) && v.every((x) => x === null || SCALAR.includes(typeof x))) return [{ parts, text: v.join(', ') }];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves([...parts, `${i + 1}`], x));
  return Object.entries(v).flatMap(([k, x]) => leaves([...parts, k], x));
}

/** @param {string} name split only at a lowercase-to-capital boundary, `_` and `-`, so `ID` stays one word */
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\-\s]+/).filter(Boolean);

/** M15 am2 (1): the names as plain words; a last name of `value` or `rows` is left out; the first letter capital, the later words lowercase */
/** @param {string[]} parts */
function friendlyName(parts) {
  const p = parts.length > 1 && (parts[parts.length - 1] === 'value' || parts[parts.length - 1] === 'rows') ? parts.slice(0, -1) : parts;
  const w = p.flatMap(words).map((x) => x.toLowerCase());
  if (!w.length) return parts.join('.');
  return w[0][0].toUpperCase() + w[0].slice(1) + (w.length > 1 ? ` ${w.slice(1).join(' ')}` : '');
}

/** the lines of one block (the flat part, or one result); two lines with the same words both keep today's `a.b` form */
/** @param {{parts: string[], text: string}[]} ls */
function blockLines(ls) {
  const f = ls.map((l) => friendlyName(l.parts));
  /** @type {Record<string, number>} */
  const n = {};
  for (const x of f) n[x] = (n[x] || 0) + 1;
  return ls.map((l, i) => `${n[f[i]] > 1 ? l.parts.join('.') : f[i]}: ${l.text}`);
}

/** a list of results: every item an object holding a `values` object (flights' `results`, with a `quote` written as its last line) */
/** @param {any} v */
const isResultList = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && !Array.isArray(r) && r.values && typeof r.values === 'object' && !Array.isArray(r.values));

/**
 * M15 items 3 and am1, am2: the accepted answer as the plain-text file the send writes. `{text}` alone is the text exactly; any other flat object is one
 * `Name words: value` line per field; a list of results is one `## Result k` block per result with one line per value, in the order the answer holds
 * them, then `from the page: "<quote>"`. Never JSON braces, never check marks. What it throws away: a result's keys other than `quote` and `values`.
 * @param {Record<string, any>} content @returns {string}
 */
export function renderSentMd(content) {
  const keys = Object.keys(content);
  if (keys.length === 1 && keys[0] === 'text' && typeof content.text === 'string') return content.text;
  /** @type {string[]} */
  const parts = [];
  /** @type {{parts: string[], text: string}[]} */
  let flat = [];
  const flush = () => { if (flat.length) parts.push(blockLines(flat).join('\n')); flat = []; };
  for (const [k, v] of Object.entries(content)) {
    if (isResultList(v)) {
      flush();
      v.forEach((r, i) => {
        const lines = blockLines(Object.entries(r.values).flatMap(([n, x]) => leaves([n], x)));
        if (typeof r.quote === 'string') lines.push(`from the page: "${r.quote}"`);
        parts.push([`## Result ${i + 1}`, ...lines].join('\n'));
      });
    } else flat.push(...leaves([k], v));
  }
  flush();
  return parts.join('\n\n');
}

/**
 * @param {string} target - a signed arbiter target, e.g. `file:poc/m0/out`.
 * @param {string} filename
 * @param {unknown} content - the accepted artifact; hash-checked as its JSON, written as plain text (`renderSentMd`).
 * @param {string|null} [acceptedSha256] - the sha256 the human's accept recorded
 *   (`answerAsk`, M4b piece 3). Required: none recorded (an answer written by an
 *   older version, or no accept in this process) refuses by name.
 * @param {{root?: string, runDir?: string}} [ctx] the flow root and this run's folder, for the destination refusals
 * @returns {Promise<{ok:true, path:string, bytes:number, sha256:string} | {ok:false, red:string}>}
 */
export async function sendViaPrimitive(target, filename, content, acceptedSha256, ctx = {}) {
  const destination = checkSendDestination(target, ctx);
  if (!destination.ok) return { ok: false, red: destination.red };

  // F48 round 4 (redesign) defense in depth: `src/runner.js`'s send slot
  // now halts BEFORE calling this function on a missing/refused read, so
  // `content` should never arrive `undefined` here — but this function must
  // never again paper over that with `?? null` the way it used to (that is
  // exactly what turned a swapped/deleted accepted artifact into a
  // recorded-green 4-byte `null` shipped to the signed destination). A
  // legitimate on-disk artifact is always a non-null object: every step's
  // model output is validated to carry a boolean `done` before it is ever
  // written (src/runner.js's checkDoneBlocker), and `done`/`blocker` are
  // stripped afterward (stripDoneBlocker) — the stripped artifact that
  // actually reaches disk (and this function) is always the remaining
  // object, never `null` and never a bare non-object value.
  if (content === undefined) {
    return { ok: false, red: 'send: no content to send (artifact missing or its read was refused) — refused' };
  }
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, red: `send: content is not an artifact object (got ${JSON.stringify(content)}) — refused` };
  }

  // M4b scope item 4 (F48 finding C): at use time, AFTER the destination
  // re-checks above, hash the exact string about to be written and compare it
  // to the hash the human's accept recorded. No hash recorded, or a mismatch
  // (the accepted artifact changed after accept) refuses by name, before
  // anything is written to the destination.
  const serialised = serializeArtifact(content);
  if (typeof acceptedSha256 !== 'string' || acceptedSha256.length === 0) {
    return { ok: false, red: 'send: no accepted-artifact hash was recorded for this accept — refused (nothing shipped)' };
  }
  const actualSha256 = sha256Hex(serialised);
  if (actualSha256 !== acceptedSha256) {
    return { ok: false, red: `send: the artifact changed after it was accepted (accepted sha256 ${acceptedSha256}, about to send ${actualSha256}) — refused (nothing shipped)` };
  }

  const path = join(destination.dir, filename);
  // M4e amendment 1: never overwrite. `shell_write` has no exclusive-create mode, so this is an
  // existence check immediately before the write (lstat: a dangling symlink at the name counts as
  // present). A file created in the instants between this check and the write is still overwritten.
  let present = true;
  try { lstatSync(path); } catch (err) { if (err.code === 'ENOENT') present = false; }
  if (present) return { ok: false, red: `send: "${path}" already exists — never overwritten (nothing shipped)` };
  await WRITE_TOOL.execute({ path, content: renderSentMd(/** @type {Record<string, unknown>} */ (content)) });

  const bytes = readFileSync(path);
  if (bytes.byteLength === 0) {
    return { ok: false, red: `send: "${path}" wrote 0 bytes` };
  }
  return { ok: true, path, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
