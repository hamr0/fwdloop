// borrowed-from: bareloop src/attemptdiff.js@v0.46.0 (8b3d815)
// Adaptations: redactSecrets imported from ./redact.js (fwdloop's one secret inventory) in place of bareloop's ./validate.js; the temp index dir prefix is fwdloop-adiff-. Nothing else changed.
// attempt-diff — what each worker TRY changed, as a spine record (ITEM33 addendum
// 2026-10-22). The spine and the gate audit keep only file names and byte sizes of
// edits; a learnings card could say WHICH files a passing try touched but never WHAT
// changed. This module is the ONE owner of that capture. It is a record, never a
// verdict: every failure is caught and returned as a field, nothing here throws.
//
// How: a git TREE snapshot at try start and at try end, each through a TEMPORARY
// index (GIT_INDEX_FILE + `git add -A` + `git write-tree`), then `git diff <t0> <t1>`.
// The work branch, HEAD, the real index and the stash list are never touched; the
// temp index is removed. Only unreferenced loose objects are left in the object store.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { redactSecrets } from './redact.js';

const exec = promisify(execFile);

/** per-file and per-event byte caps for the recorded diff text */
export const ATTEMPT_DIFF_FILE_MAX = 4096;
export const ATTEMPT_DIFF_EVENT_MAX = 16384;

/**
 * Cut `text` to at most `max` bytes at a LINE boundary (never mid-line).
 * @param {string} text @param {number} max
 * @returns {{text: string, truncated: boolean, cutLines: number}}
 */
export function cutAtLine(text, max) {
  if (Buffer.byteLength(text) <= max) return { text, truncated: false, cutLines: 0 };
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let used = 0;
  let kept = 0;
  for (const l of lines) {
    const b = Buffer.byteLength(l);
    if (used + b > max) break;
    used += b;
    kept++;
  }
  return { text: lines.slice(0, kept).join(''), truncated: true, cutLines: lines.length - kept };
}

/** @param {string} abs @param {string[]} prefixes */
const inFence = (abs, prefixes) => prefixes.some((p) => abs === p || abs.startsWith(p.endsWith('/') ? p : `${p}/`));

// the arbiter's books and installed packages never enter a snapshot, even inside a wide fence
const NOT_WORK = [':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/.git/**', ':(exclude).smoke', ':(exclude).litectx', ':(exclude)gate-audit.jsonl'];

/**
 * Snapshot the FENCE of the working tree to a git tree id via a throwaway index. Only the
 * fence's existing prefixes are added, and with `-f`: a rubric job's `output/` must be seen
 * even when the source folder's own .gitignore lists it (the hidden-git seed ignores that
 * file's meaning; so does this).
 * @param {string} workdir @param {string[]} fence @returns {Promise<string>}
 */
async function snapshotTree(workdir, fence) {
  const tmp = await mkdtemp(join(tmpdir(), 'fwdloop-adiff-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
    const specs = fence.filter((p) => existsSync(p)).map((p) => `:(literal)${relative(workdir, p) || '.'}`);
    if (specs.length > 0) await exec('git', ['add', '-A', '-f', '--', ...specs, ...NOT_WORK], { cwd: workdir, env, maxBuffer: 1 << 26 });
    const { stdout } = await exec('git', ['write-tree'], { cwd: workdir, env });
    return stdout.trim();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Begin recording one worker try. Call BEFORE the worker's turn; call `finish()` after
 * (in a `finally`). Never throws.
 * @param {{workdir: string, fence: string[], redact?: (s: string) => string}} o
 *   `fence` = the ABSOLUTE write-scope prefixes the gate enforces for this try.
 * @returns {Promise<{finish: () => Promise<null | {files: {path: string, diff: string, truncated: boolean, cutLines: number}[], binary: string[], truncated: boolean, gitError?: string}>}>}
 *   `finish()` resolves null when the try changed nothing in scope.
 */
export async function startAttemptDiff({ workdir, fence, redact = redactSecrets }) {
  /** @type {string|null} */
  let t0 = null;
  /** @type {string|null} */
  let startError = null;
  try { t0 = await snapshotTree(workdir, fence); } catch (e) { startError = String(/** @type {any} */ (e)?.message ?? e); }
  return {
    async finish() {
      try {
        if (t0 === null) throw new Error(`start snapshot failed: ${startError}`);
        const t1 = await snapshotTree(workdir, fence);
        if (t1 === t0) return null;
        const g = (/** @type {string[]} */ a) => exec('git', ['-c', 'core.quotepath=false', ...a], { cwd: workdir, maxBuffer: 1 << 26 });
        const { stdout: names } = await g(['diff', '--name-only', '-z', '--relative', /** @type {string} */ (t0), t1]);
        const paths = names.split('\0').filter(Boolean).filter((p) => inFence(resolve(workdir, p), fence));
        /** @type {{path: string, diff: string, truncated: boolean, cutLines: number}[]} */
        const files = [];
        /** @type {string[]} */
        const binary = [];
        let left = ATTEMPT_DIFF_EVENT_MAX;
        let anyCut = false;
        for (const p of paths) {
          const { stdout } = await g(['diff', '-U1', '--no-color', '--no-ext-diff', '--relative', /** @type {string} */ (t0), t1, '--', `:(literal)${p}`]);
          const path = redact(p);
          if (/^Binary files .* differ$/m.test(stdout) || /^GIT binary patch$/m.test(stdout)) { binary.push(path); continue; }
          const cut = cutAtLine(redact(stdout), Math.min(ATTEMPT_DIFF_FILE_MAX, left));
          left -= Buffer.byteLength(cut.text);
          if (cut.truncated) anyCut = true;
          files.push({ path, diff: cut.text, truncated: cut.truncated, cutLines: cut.cutLines });
        }
        if (files.length === 0 && binary.length === 0) return null;
        return { files, binary, truncated: anyCut };
      } catch (e) {
        return { files: [], binary: [], truncated: false, gitError: redact(String(/** @type {any} */ (e)?.message ?? e)).slice(0, 500) };
      }
    },
  };
}
