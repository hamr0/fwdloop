// M4c-fix amendment 2 (h): the human's "Remove the old lock". The ONE remover of a resume lock, and it lives in the
// panel: only `POST /api/remove-lock` (src/panel/server.js) calls it. No runner, resume or agent path imports this
// file — the machine never removes a lock it cannot judge (test: m4c-fix-remove-lock.test.js greps every src file).
import { realpathSync, unlinkSync } from 'node:fs';
import { join, sep } from 'node:path';
import { appendAudit } from '../books.js';
import { readResumeLock } from '../liveness.js';

/**
 * Remove `<runDir>/resume.lock`, only if at THIS moment it has no recorded holder (`readResumeLock` -> `empty`;
 * a live, dead or unknowable holder is never touched), and only if the lock file really sits inside this run dir
 * (realpath of the run dir against realpath of `--root` at use time; a symlinked lock is unlinked as the link itself,
 * never followed).
 * Then one audit row through the one audit writer, shaped like the `ask-reopened` row (a pure note: cost 0, no model).
 * @param {{root: string, runDir: string, nowIso?: string}} a
 * @returns {{ok: true, at: string}|{ok: false, refused: 'no-lock'|'lock-has-holder'|'lock-outside-run', red: string}}
 */
export function removeOldLock({ root, runDir, nowIso = new Date().toISOString() }) {
  const lock = readResumeLock(runDir);
  if (lock.state === 'none') return { ok: false, refused: 'no-lock', red: 'there is no resume lock to remove' };
  if (lock.state !== 'empty') return { ok: false, refused: 'lock-has-holder', red: `the resume lock has a recorded holder (${lock.state}) — not removed` };
  let inside = false;
  try {
    const real = realpathSync(runDir);
    const realRoot = realpathSync(root);
    inside = (real + sep).startsWith(realRoot + sep) && real === realpathSync(join(lock.path, '..'));
  } catch { inside = false; }
  if (!inside) return { ok: false, refused: 'lock-outside-run', red: 'the resume lock is not inside this run — not removed' };
  // Amendment 3 (d): look once more right before the unlink. This shrinks the window, it cannot close it: a resume
  // can still take the lock between this read and the unlink — the written known limit of (d).
  if (readResumeLock(runDir).state !== 'empty') return { ok: false, refused: 'lock-has-holder', red: 'the resume lock has a recorded holder — not removed' };
  try { unlinkSync(lock.path); } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, refused: 'no-lock', red: 'there is no resume lock to remove' };
    throw err;
  }
  appendAudit(runDir, {
    step: 'ask', attempt: null, class: null, verdict: 'lock-removed',
    gap: `removed by human via panel at ${nowIso}`,
    usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: nowIso, tokens: null, tools: null, refused: [],
  });
  return { ok: true, at: nowIso };
}
