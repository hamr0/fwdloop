// borrowed-from: bareloop src/worktree.js@v0.61.0 (fc56e1f3)
// The ONE spelling of "a run's tree is a git worktree inside the person's own repo"
// (`<repo>/.bareloop/wt/<id>`, detached at the repo's HEAD). Two doors make that tree: the bundle runner
// (`src/bundlerun.js`) and the panel's drafting session (`src/panel/authorsession.js`, through the source
// door's `worktree` option). Neither carries its own copy of the `git worktree add` call.
//
// Plain git, no dependency. Every helper takes the repo ROOT (the directory whose `.git` is the real
// repository), never a subfolder.

import { execFileSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** the line that hides bareloop's own folder from the person's `git status` (anchored at the repo root) */
export const EXCLUDE_LINE = '/.bareloop/';

/** the line that hides installed packages at any depth */
export const NODE_MODULES_LINE = 'node_modules/';

/** the person's git hooks never run for anything bareloop does in their repo: one spelling, used by `addWorktree` and `commitWork` */
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null/bareloop-no-hooks'];

/** where a run's worktree lives in the person's repo @param {string} repo @param {string} id */
export function worktreePath(repo, id) {
  return join(repo, '.bareloop', 'wt', id);
}

/**
 * `git worktree add --detach <dir> HEAD` in `repo` (none of the person's hooks run), creating `dir`'s parent first. Throws
 * `Error('git worktree add failed: …')` — a caller decides whether that is a stop or a refusal.
 * @param {string} repo @param {string} dir
 */
export function addWorktree(repo, dir) {
  mkdirSync(dirname(dir), { recursive: true });
  try {
    execFileSync('git', [...NO_HOOKS, '-C', repo, 'worktree', 'add', '--detach', dir, 'HEAD'], { encoding: 'utf8' });
  } catch (e) {
    throw new Error(`git worktree add failed: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * How many paths `git status --porcelain` lists in `repo` (tracked edits AND untracked files); 0 for a clean
 * tree. A repo git cannot read counts as 0 — this feeds a notice, never a refusal.
 * @param {string} repo @returns {number}
 */
export function uncommittedCount(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter((l) => l.trim() !== '').length;
  } catch { return 0; }
}

/** the short sha of `repo`'s HEAD, or null @param {string} repo @returns {string|null} */
export function shortHead(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

/**
 * Hide `.bareloop/` and `node_modules/` (packages installed in a worktree must not read as worker writes) from the person's own `git status` through the repo's PRIVATE exclude file
 * (`<common-git-dir>/info/exclude`), never their tracked `.gitignore`. The common dir, not `.git`: in a linked
 * worktree `.git` is a file and the shared `info/exclude` lives in the main repository's git dir. Idempotent —
 * each line is checked separately and never written twice.
 * @param {string} repo
 * @returns {boolean} true when the line was added now
 */
export function hideBareloopDir(repo) {
  return addExcludeLines(repo, [EXCLUDE_LINE, NODE_MODULES_LINE]);
}

/** the folder inside a repo job's worktree that holds a frozen ticket (MCP + tickets piece 1a): one spelling */
export const TICKET_INPUT_DIR = '.bareloop-input';

/** the line that hides it (anchored at the top of each worktree) */
export const TICKET_INPUT_EXCLUDE_LINE = `/${TICKET_INPUT_DIR}/`;

/**
 * Hide the frozen-ticket folder (`.bareloop-input/`) from `git status` and from `git add -A` in `dir` (a worktree) through the PRIVATE exclude:
 * the COMMON git dir's `info/exclude`, which every linked worktree of that repo reads (a linked worktree has no `info/exclude` of its own). Never the tracked
 * `.gitignore`. Idempotent.
 * @param {string} dir a worktree (or repo) root @returns {boolean} true when the line was added now
 */
export function hideTicketInput(dir) {
  return addExcludeLines(dir, [TICKET_INPUT_EXCLUDE_LINE]);
}

/** @param {string} repo @param {string[]} lines @returns {boolean} true when any line was added now */
function addExcludeLines(repo, lines) {
  const common = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const exclude = join(resolve(repo, common), 'info', 'exclude');
  mkdirSync(dirname(exclude), { recursive: true });
  const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  const have = new Set(text.split('\n').map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (missing.length === 0) return false;
  const add = `${missing.join('\n')}\n`;
  if (text === '') writeFileSync(exclude, add);
  else appendFileSync(exclude, `${text.endsWith('\n') ? '' : '\n'}${add}`);
  return true;
}

/**
 * Remove a run's worktree folder from `repo` (`git worktree remove --force`: the folder may hold untracked
 * scratch — a `.litectx/` index, the gate-audit file — and what matters is on the branch by now). Never throws.
 * @param {string} repo @param {string} dir
 * @returns {boolean} true when the folder is gone afterwards
 */
export function removeWorktree(repo, dir) {
  try {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* fall through: report what is on disk */ }
  return !existsSync(dir);
}

/** the private ref a PR job's fetched head lives under (piece 12): bareloop's own namespace, so no branch, tag or the person's refs are touched and the object survives gc during the run @param {number} n */
export function prRefName(n) {
  return `refs/bareloop/pr-${n}`;
}

/**
 * Delete a PR job's private ref from `repo` (`git update-ref -d`). A leftover ref is harmless (one pointer into the object store) but is not left behind. Never throws.
 * @param {string} repo @param {number} n
 * @returns {boolean} true when the ref is gone afterwards (a ref that never existed counts)
 */
export function removePrRef(repo, n) {
  const ref = prRefName(n);
  try {
    execFileSync('git', [...NO_HOOKS, '-C', repo, 'update-ref', '-d', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch { /* fall through: report what is there */ }
  try {
    return execFileSync('git', ['-C', repo, 'for-each-ref', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === '';
  } catch { return false; }
}

/** a commit bareloop makes in the person's repo is authored by bareloop (never their global config), signs nothing, runs none of their hooks */
const COMMIT_CONFIG = [
  '-c', 'user.name=bareloop', '-c', 'user.email=bareloop@localhost', '-c', 'commit.gpgsign=false',
  ...NO_HOOKS,
];

/** what never goes into the work commit: the arbiter's own books and installed packages */
const NOT_WORK_PATHS = ['.smoke', '.litectx', 'gate-audit.jsonl'];
const NOT_WORK_GLOB = ':(exclude,glob)**/node_modules/**';

/**
 * The run's final commit, on whatever branch the worktree stands on: everything the run changed except the
 * arbiter's books and `node_modules`. Nothing changed = no commit (a green with nothing to commit is still a green).
 * Throws on a git failure — the caller must not remove a worktree whose work is not safely on the branch.
 * @param {string} dir the worktree
 * @param {string} message
 * @returns {{committed: boolean, sha: string}}
 */
export function commitWork(dir, message) {
  const run = (/** @type {string[]} */ args) => execFileSync('git', ['-C', dir, ...COMMIT_CONFIG, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // `git add` exits 1 when an exclude names a path that exists AND is gitignored (it prints "paths are ignored").
  // An ignored path is never staged without -f, so its exclude is redundant: only exclude what git would otherwise add.
  // check-ignore: 0 = ignored, 1 = not ignored, anything else = a real failure (execFileSync throws on 128).
  const ignored = (/** @type {string} */ p) => { try { run(['check-ignore', '-q', '--', p]); return true; } catch (e) { if (/** @type {any} */ (e)?.status === 1) return false; throw e; } };
  const excludes = NOT_WORK_PATHS.filter((p) => !ignored(p)).map((p) => `:(exclude)${p}`);
  run(['add', '-A', '--', '.', ...excludes, NOT_WORK_GLOB]);
  const staged = run(['diff', '--cached', '--name-only']).trim();
  if (staged !== '') run(['commit', '-q', '-m', message]);
  return { committed: staged !== '', sha: run(['rev-parse', '--short', 'HEAD']).trim() };
}
