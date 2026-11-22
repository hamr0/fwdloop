// borrowed-from: bareloop src/source.js@v0.61.0 (fc56e1f3)
// The source front door (PRD item 33/M2, `docs/product/ITEM33-BUILD.md`) — a
// plain folder, a plain file, or one URL the machine can reach, frozen into a
// hidden git tree BEFORE any token spends, so the run and the close judge the
// SAME bytes (hamr's ruling, PRD item 33, 2026-09-10). H1's fix: the person
// never sees the git repo — it is scratch plumbing this module owns, not a
// `--patient` a job author writes by hand.
//
// Three functions, three moments in a job's life:
//   - `prepareSource` — BUILD the frozen tree, once, at prep time ($0, no
//     provider). This is where H1 (a plain folder needs no repo) and H7 (PDF
//     and Word input have no reader here — logged, not built) actually live.
//   - `proveDestination` — PROVE the drop-off point is writable, at $0,
//     before any token spends (a job that cannot land its output should
//     never buy a worker turn first).
//   - `copyOut` — COPY the run's own output to that drop-off point, once,
//     on a minted green (never a red, never a stop — this module makes no
//     verdict and changes none).
//
// Every failure here is a NAMED refusal, never a throw and never a silent
// fallback: `{stop: null, ...}` on success, `{stop: <message>, code: <name>}`
// on refusal — the same discriminated shape `seedAtHead`/`seedListing`
// (src/kinds.js) already use for a $0 precheck a runner has to print and act
// on rather than catch.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile, lstat, stat, chmod, access, copyFile, cp, open, rm, realpath, readlink, symlink, constants as fsConstants } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep, basename, isAbsolute } from 'node:path';
import { git } from './kinds.js';
import { addWorktree, hideBareloopDir } from './worktree.js';
import { MAX_BUFFER } from './kinds.js';
import { PROVIDER_TIMEOUT_MS } from './clock.js';
import { scanSecrets, SECRET_PATTERNS, SECRET_PATTERN_NAMES } from './validate.js';
import { fetchPageText, isWebUrl } from './pagefetch.js';
import { parseTicketList } from './ticketshape.js';
import { readTicket } from './ticket.js';
import { proveTicketLine } from './ticketrepo.js';

/** @typedef {{stop: string, code: string}} SourceRefusal a named, non-throwing stop */

/** the seed commit's identity — NEVER the operator's, NEVER global config
 * (CI has no gitconfig, and this repo never touches one either way): the
 * hidden tree is bareloop's own scratch plumbing, so its one commit is
 * authored by bareloop, not by whoever happens to run it. `commit.gpgsign`
 * is pinned off for the same reason a global config is never read: a
 * machine with `commit.gpgsign=true` in ITS OWN global config would
 * otherwise make this $0 step fail on a signing key that has nothing to do
 * with the job. */
const GIT_IDENTITY = ['-c', 'user.name=bareloop', '-c', 'user.email=bareloop@localhost', '-c', 'commit.gpgsign=false'];

/** a live-proven defect (found reviewing M2b fix 7): a copied `.git/hooks`
 * carries the SOURCE repo's own scripts, and `git commit` runs them —
 * `pre-commit`/`commit-msg`/`post-commit` are arbitrary code, and copying a
 * repo source would otherwise execute whatever the original author put
 * there, inside bareloop's own process, before a single token spends. The
 * hooks directory is stripped after the `.git` copy (below) AND every git
 * call this door makes pins `core.hooksPath` to a path that is never
 * created, so a `core.hooksPath` set in the copied `.git/config` to point
 * somewhere else on disk cannot resurrect the hole either. Belt and braces,
 * not redundant: either alone leaves a way back in. */
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null/bareloop-no-hooks'];

/** content-types this door accepts for a URL source (hamr: "start with
 * already supported files") — `text/*` covers `text/csv` already; it is kept
 * spelled out because the PRD ruling names it explicitly and a reader
 * checking this list against that ruling should find it there verbatim. */
const TEXT_CONTENT_TYPES = [/^text\//, /^application\/json/, /^application\/xml/];

/** an environment file, refused by NAME whatever it contains (hamr's ruling,
 * PRD item 33/M2b fix 2). The content scan (`scanFilesForSecrets`) catches a
 * key it KNOWS the shape of; this catches the file people keep keys in even
 * when the shape is one nobody inventoried yet — the two are belt and braces,
 * not duplicates. */
const ENV_FILE = /^\.env($|\.)/;

/** how many same-day deliveries one destination name can take before the door
 * gives up (`profile-2026-09-12.md`, `-2`, … `-99`). A cap, never a silent
 * overwrite: past it, `destination-exists`. */
const MAX_SAME_DAY = 99;

/** @param {string} code @param {string} stop @returns {SourceRefusal} */
const refuse = (code, stop) => ({ stop, code });

/**
 * F177 / hamr's ruling (2026-09-14, option A): a `kind: 'repo'` copy's own
 * `node_modules/` stays hidden from `changedSet` (src/kinds.js) even when the
 * SOURCE repo's tracked `.gitignore` does not mention it — the person
 * installs packages into the copy themselves (`missingDependencies`,
 * `source-deps-missing`), and an unignored `node_modules` then reads as 247
 * files of "the worker's own writes" (live-verified against a real copy of
 * pulselog). The fix writes into the copy's PRIVATE exclude file
 * (`.git/info/exclude`, resolved via `--git-path` rather than assumed —
 * worktree layouts keep it in the common dir, not the per-worktree one) —
 * never the tracked `.gitignore` — so the source repo's own files, including
 * its `.gitignore` bytes, are never touched. Idempotent: an existing
 * `node_modules/` line is left alone rather than duplicated.
 *
 * Plain folder/file/URL sources never call this — they have no `.git` of
 * their own to carry a private exclude, and (M2b fix 6, above) their
 * `.gitignore` is deliberately powerless over what the seed holds at all.
 * @param {string} treeDir
 * @returns {Promise<SourceRefusal|null>}
 */
async function hideNodeModulesInCopy(treeDir) {
  const gp = await git(treeDir, ['rev-parse', '--git-path', 'info/exclude']);
  if (!gp.ok) return refuse('source-git-failed', `git rev-parse --git-path info/exclude failed in ${treeDir}: ${gp.err}`);
  const excludeRel = gp.out.trim().split('\n')[0].trim();
  if (!excludeRel) return refuse('source-git-failed', `git rev-parse --git-path info/exclude returned nothing in ${treeDir}`);
  const excludePath = join(treeDir, excludeRel);
  await mkdir(dirname(excludePath), { recursive: true });
  let existing = '';
  try { existing = await readFile(excludePath, 'utf8'); } catch { /* no exclude file yet — created fresh below */ }
  const hasLine = existing.split('\n').some((l) => l.trim() === 'node_modules/');
  if (!hasLine) {
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(excludePath, `${existing}${sep}node_modules/\n`);
  }
  return null;
}

/**
 * Walk from `startDir` upward — inclusive — to the NEAREST ancestor whose own
 * directory carries a `.git` entry, whether that entry is a real repo
 * directory or a linked-worktree/submodule FILE (the caller decides what a
 * file means for it). `null` when no ancestor up to the filesystem root has
 * one. ONE helper for "find the repo boundary walking up", shared by
 * {@link looksLikeRepoSource} and `prepareSource`'s own authoritative routing
 * below (PRD item 33 M3 ruling 2 addendum, 2026-09-13: a Source that is a
 * SUBFOLDER inside a git repo is a repo job, not a plain-folder one — the
 * boundary is the nearest ancestor's `.git`, never only a `.git` sitting
 * directly inside Source itself) and reused by `src/detectlang.js`'s own
 * upward walk (`walkChain`), which only needs the boundary directory, not
 * which kind of `.git` it is — never three copies of this rule.
 * @param {string} startDir an absolute directory to start the walk FROM
 * @returns {{dir: string, isFile: boolean}|null}
 */
export function nearestGitAncestor(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    const dotGit = join(dir, '.git');
    if (existsSync(dotGit)) {
      let isFile = false;
      try { isFile = !lstatSync(dotGit).isDirectory(); } catch { /* raced away between exists and lstat — treated as a directory below, the pre-existing walk's own behaviour */ }
      return { dir, isFile };
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
}

/**
 * A CHEAP peek (a stat, never a read) at whether `source` is going to turn
 * out to be a REPO source — the ONE rule for that question, shared by
 * `prepareSource` (which routes the destination check below before the real
 * walk further down decides authoritatively) and `scripts/run-interview.mjs`
 * (PRD item 33 M3 ruling 2), which has to know BEFORE Source is even frozen
 * whether Destination fills the write fence or a delivery directory. Never a
 * second, hand-typed copy of this test: a URL is never a repo; a local path
 * is a repo source only when it is a DIRECTORY, and the NEAREST ancestor
 * (Source itself, or an ancestor above it — ruling 2's 2026-09-13 addendum)
 * carries a `.git` DIRECTORY. A nearest `.git` that is a FILE (a linked
 * worktree or a submodule) is NOT repo-like here — the real walk below
 * refuses `source-is-linked-worktree` for that case, and this peek must
 * agree closely enough to route the destination question correctly rather
 * than offer the write-fence wording for a source that is about to be
 * refused. An unreadable path is reported properly by the real walk; this
 * peek only has to agree with that walk closely enough to route correctly,
 * never to replace it.
 * @param {string} source
 * @returns {boolean}
 */
export function looksLikeRepoSource(source) {
  if (/^https?:\/\//i.test(source)) return false;
  try {
    const abs = resolve(source);
    const st = lstatSync(abs);
    if (!st.isDirectory()) return false;
    const found = nearestGitAncestor(abs);
    return found !== null && !found.isFile;
  } catch { return false; }
}

/**
 * The files of a repo's COMMITTED tree (`git ls-tree -r HEAD`: what a job's worktree holds), or null when git cannot read it.
 * @param {string} root the repo's (or worktree's) top folder @returns {string[]|null}
 */
export function repoTrackedFiles(root) {
  try { return execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', '-z', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean); } catch { return null; }
}

/**
 * R7b (F287): the first piece of a repo Destination (comma or line separated) that the repo's COMMITTED tree does not have, or null when every piece exists.
 * A piece is a folder (`src`, `src/`), a file, or a glob whose folder part exists (`src/**\/*.js`); `.` is the repo root. A tree that cannot be read is null:
 * the copy step refuses that repo with its own words, this check never invents a refusal from a failure.
 * @param {string} root the repo's top folder @param {string} destination @returns {string|null}
 */
export function destinationMissingInRepo(root, destination) {
  const files = repoTrackedFiles(root);
  if (files === null) return null;
  const hasDir = (/** @type {string} */ dir) => files.some((f) => f.startsWith(`${dir}/`));
  for (const raw of destination.split(/[,\n]/)) {
    const piece = raw.trim();
    if (piece === '') continue;
    const t = piece.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (t === '' || t === '.') continue;
    const wild = t.search(/[*?[{]/);
    if (wild !== -1) {
      const dir = t.slice(0, wild).includes('/') ? t.slice(0, t.slice(0, wild).lastIndexOf('/')) : '';
      if (dir === '' || hasDir(dir)) continue;
      return piece;
    }
    if (!files.includes(t) && !hasDir(t)) return piece;
  }
  return null;
}

/** @param {Buffer} buf @returns {boolean} */
function hasNulByte(buf) {
  // "first 8 KB" (PRD/M2 text) — a NUL anywhere further in a huge log-shaped
  // file is not this door's problem; the point is a cheap, bounded sniff, not
  // a full-file binary detector.
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Sniff a file's first 8KB for a NUL byte WITHOUT reading the whole file — a
 * folder source may legally carry a file right up against `MAX_BUFFER`, and
 * reading it twice (once to sniff, once to freeze) doubles the cost of the
 * cheapest check here for nothing.
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function sniffNul(path) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    return hasNulByte(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** @param {Buffer} buf @returns {string} */
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Scan every frozen file's CONTENT for a known secret shape, using the SAME
 * inventory `scanSecrets` reads (`SECRET_PATTERNS`, src/validate.js) — never
 * a second, hand-typed pattern list. This is the fix for the live-proven
 * defect: the front door scanned only the URL string, so a plain folder or
 * file carrying a real API key (an `.env`, a checked-in credential) was
 * frozen into the tree and committed to the hidden git seed untouched.
 *
 * Names the file(s) and the PATTERN NAME(S) only — computed by testing each
 * pattern in isolation (never by reading `scanSecrets`' own matched text),
 * so the actual secret substring never has to exist in a variable that could
 * leak into a refusal, a manifest, stdout, or a log. Whole-file content is
 * decoded and tested, never a sampled prefix (the NUL sniff samples 8KB; a
 * secret check must not — a key can sit anywhere in a large file).
 * @param {string} text one file's decoded content
 * @returns {string[]} the names of every pattern that hit, empty when none did
 */
function secretPatternNames(text) {
  return SECRET_PATTERN_NAMES.filter((_, i) => SECRET_PATTERNS[i].test(text));
}

/**
 * Walk a plain folder recursively, refusing on the first symlink, nested
 * repo, environment file, oversize file, or binary file it finds. Returns
 * every REGULAR file, relative to `root`. This is the PLAIN-FOLDER path only
 * — a repo source is enumerated by `listRepoFiles` instead (D1 rework,
 * `docs/product/ITEM33-BUILD.md`), which reads git's own tracked-file list
 * rather than walking the filesystem, so nothing gitignored or untracked
 * (npm's `node_modules/.bin/*` symlinks included) is ever a candidate here.
 *
 * A symlink is named and never followed (PRD ruling) — walking into it would
 * silently widen the frozen copy to whatever the link points at, which nobody
 * signed. A `.git` anywhere below the root is a NESTED repo (M2b fix 6): its
 * objects are a second history nobody declared, and `git add` would either
 * swallow it as a gitlink or drop its files entirely, so the seed would not
 * hold what the manifest says it holds.
 * @param {string} root
 * @returns {Promise<{stop: null, files: string[]}|SourceRefusal>}
 */
async function walkFolder(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const notText = [];
  /** @type {string[]} */
  const oversize = [];
  /** @param {string} dir @param {string} rel */
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) return refuse('source-symlink', `${relPath} is a symlink — named, never followed (a followed link would silently widen the frozen copy to whatever it points at)`);
      if (e.name === '.git') {
        return refuse('source-nested-repo', `${relPath} is a nested git repo — refused, because the seed commit cannot hold a second history honestly (the files under it would be swallowed as a gitlink or dropped outright, and the manifest would then claim bytes the seed does not carry)`);
      }
      if (ENV_FILE.test(e.name)) {
        return refuse('source-env-file', `${relPath} is an environment file — refused by NAME, whatever it contains (hard line: secrets never enter the tree)`);
      }
      if (e.isDirectory()) {
        const sub = await walk(join(dir, e.name), relPath);
        if (sub) return sub;
      } else if (e.isFile()) {
        const st = await stat(join(dir, e.name));
        if (st.size > MAX_BUFFER) { oversize.push(`${relPath} (${st.size}B)`); continue; }
        if (await sniffNul(join(dir, e.name))) { notText.push(relPath); continue; }
        files.push(relPath);
      }
      // neither file, dir, nor symlink (a socket, a fifo) — silently skipped;
      // nothing this door reads or writes can be one
    }
    return null;
  }
  const walkStop = await walk(root, '');
  if (walkStop) return walkStop;
  if (oversize.length) {
    return refuse('source-file-oversize', `${oversize.length} file(s) are over the ${MAX_BUFFER}B per-file ceiling — a source door freezes what a run can actually read, never a file it would only ever see a truncated prefix of: ${oversize.join(', ')}`);
  }
  if (notText.length) {
    return refuse('source-not-text', `${notText.length} file(s) carry a NUL byte in their first 8KB — text only for now (hole H7: PDF/Word input needs a reader this door does not have): ${notText.join(', ')}`);
  }
  return { stop: null, files };
}

/**
 * Enumerate a REPO source's files the D1 way (hamr's ruling, verbatim:
 * "copy only what git tracks"): `git ls-files --stage` in the source, never a
 * filesystem walk — closes F164 (npm's `node_modules/.bin/*` symlinks are
 * never candidates at all, because they are never tracked) and F165 (nothing
 * gitignored or untracked can reach this list, so nothing gitignored can
 * reach the tree or the seed no matter what `git add` flag runs later).
 *
 * Each tracked path's WORKING-TREE content is what gets frozen (so
 * uncommitted edits to a tracked file come along) — this function only
 * enumerates and classifies; the caller reads bytes.
 *
 * A gitlink entry (mode `160000`, a real submodule) is refused
 * `source-nested-repo` — it names a second history the seed cannot hold
 * honestly, the same reason a nested `.git` is refused for a plain folder.
 * A symlink entry (mode `120000`) is refused `source-symlink` ONLY when it
 * resolves outside `root` — one that stays inside is legal tracked content
 * and is copied verbatim as a link (never dereferenced).
 * @param {string} root the repo's working directory (its `.git` is handled
 *   separately by the caller, which copies it verbatim)
 * @returns {Promise<{stop: null, files: {rel: string, abs?: string, symlinkTarget?: string}[]}|SourceRefusal>}
 */
async function listRepoFiles(root) {
  const ls = await git(root, ['ls-files', '-z', '--stage']);
  if (!ls.ok) return refuse('source-git-failed', `git ls-files failed in ${root}: ${ls.err}`);
  const entries = ls.out.split('\0').filter(Boolean);
  /** @type {{rel: string, abs?: string, symlinkTarget?: string}[]} */
  const files = [];
  const rootReal = await realpath(root);
  for (const entry of entries) {
    // "<mode> <sha> <stage>\t<path>" — the mode tells a gitlink (submodule)
    // and a symlink apart from an ordinary tracked file without ever reading
    // bytes for it.
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const mode = entry.slice(0, tab).split(' ')[0];
    const rel = entry.slice(tab + 1);
    if (mode === '160000') {
      return refuse('source-nested-repo', `${rel} is a submodule (a gitlink entry) — refused, the same reason a nested .git is: a second history the seed commit cannot hold honestly`);
    }
    if (ENV_FILE.test(basename(rel))) {
      return refuse('source-env-file', `${rel} is an environment file — refused by NAME, whatever it contains (hard line: secrets never enter the tree)`);
    }
    if (mode === '120000') {
      let target;
      try { target = await readlink(join(root, rel)); } catch (e) {
        return refuse('source-unreadable', `${rel}: tracked symlink could not be read (${/** @type {Error} */ (e)?.message ?? e})`);
      }
      let resolved = null;
      try { resolved = await realpath(join(root, rel)); } catch { /* a dangling link resolves to nothing — treated as outside, below */ }
      if (resolved === null || !(resolved === rootReal || resolved.startsWith(`${rootReal}${sep}`))) {
        return refuse('source-symlink', `${rel} is a symlink resolving outside ${root} — refused (a link leaving the source root would silently widen the frozen copy to whatever it points at); a link that stays inside the root is legal tracked content and is copied verbatim`);
      }
      files.push({ rel, symlinkTarget: target });
    } else {
      files.push({ rel, abs: join(root, rel) });
    }
  }
  return { stop: null, files };
}

/**
 * Fetch a URL source ONCE — plain `fetch`, no credentials, no cookies, no
 * custom headers — under an injectable deadline (production default
 * `PROVIDER_TIMEOUT_MS`, reused from `src/clock.js` rather than a second
 * number; a test injects a short one so a silent-server case does not cost
 * real minutes). The body is read as it streams so an oversize response is
 * caught at `MAX_BUFFER` (`src/kinds.js`, reused) WITHOUT ever buffering more
 * than the ceiling — a `response.text()` on a large body would have already
 * paid the memory cost this exists to cap.
 * @param {string} url
 * @param {number} timeoutMs
 * Redirects are FOLLOWED but never invisible (M2b fix 5): the URL the body
 * actually came from (`res.url`) rides back out, into the manifest and onto
 * `prep-source`'s stdout, so a link that quietly lands on a login page or a
 * different host is something a person can SEE before a single token spends.
 * @returns {Promise<{stop: null, buf: Buffer, contentType: string, finalUrl: string}|SourceRefusal>}
 */
async function fetchOnce(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ac.signal, redirect: 'follow', credentials: 'omit' });
  } catch (e) {
    if (/** @type {any} */ (e)?.name === 'AbortError') {
      return refuse('source-fetch-timeout', `${url} did not answer inside ${timeoutMs}ms — a timeout REFUSES here, it never falls back to a partial or cached read`);
    }
    return refuse('source-fetch-failed', `${url} could not be fetched: ${/** @type {Error} */ (e)?.message ?? String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return refuse('source-fetch-failed', `${url} answered ${res.status} ${res.statusText}`);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!TEXT_CONTENT_TYPES.some((re) => re.test(contentType))) {
    return refuse('source-not-text', `${url} answered content-type "${contentType || '(none)'}" — text only for now (${TEXT_CONTENT_TYPES.map((r) => r.source).join(', ')})`);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    // a body-less 2xx (204, or a fetch polyfill with no stream) — nothing to
    // freeze, and an empty file would lie about having read something
    return refuse('source-fetch-failed', `${url} answered with no readable body`);
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BUFFER) {
      try { await reader.cancel(); } catch { /* best-effort — the fetch is being abandoned either way */ }
      return refuse('source-fetch-oversize', `${url} exceeded the ${MAX_BUFFER}B ceiling — the body is truncated, so any content read from it would be unknown, not zero`);
    }
    chunks.push(value);
  }
  return { stop: null, buf: Buffer.concat(chunks), contentType, finalUrl: res.url || url };
}

/**
 * Build the frozen source tree — `<into>/tree/input/…` (the copy), `<into>/tree/output/`
 * (empty, where the run writes), `<into>/source.json` (the manifest, OUTSIDE
 * the tree so no worker can read or edit it). One hidden git commit seeds the
 * tree with a neutralized identity; the seed sha rides in the manifest and is
 * what every close in this run measures against (`seedAtHead`, src/kinds.js).
 *
 * `destination`, when given, is recorded in the manifest (never in a signed
 * job spec — a job spec is a repeatable SHAPE, source/destination a PER-RUN
 * value, see `readSourceManifest`'s own comment) as the run's declared
 * drop-off point. D3 rework (hamr's ruling, 2026-09-12, condensed in
 * `docs/product/ITEM33-BUILD.md`): **destination is a DIRECTORY, never a
 * filename** — it may already exist (need not be empty), and it may sit
 * inside the source itself (the same-dir case: "i can limit your actions to
 * a certain fix in a certain dir and your output will also be there"). A job
 * may produce more than one file; the agent names them, and `copyOut`
 * delivers every non-empty file it finds under `output/`, each under its own
 * dated name. There is therefore no separate `output` field any more — the
 * old single-file `output-invalid` guard existed only to stop a
 * manifest-declared path from escaping the tree, and that vector is closed
 * structurally now: `copyOut` always reads `output/` itself, never a path a
 * manifest could have been hand-edited to name.
 *
 * A `kind: 'repo'` source's `destination` is a DIFFERENT thing entirely
 * (hamr: "destination if for code on a green then that would be the place
 * agent allowed to do changes") — it names the WRITE FENCE inside the copied
 * repo, the signed `writeScope` field's job (`src/job.js:363`), not a
 * filesystem drop-off point this door proves or copies into. It is recorded
 * as declared, unvalidated by `proveDestination`, and `frontDoorFromManifest`
 * never hands a repo source's destination to `copyOut` — wiring it into
 * `writeScope` is M3/M4's job, not this one.
 * `worktree` (P6 item 1, repo sources ONLY — ignored for every other kind): instead of COPYING the repo, make the
 * run's tree a detached git worktree of the person's own repo at that directory (the shared
 * `src/worktree.js`, the bundle door's own spelling), hide `.bareloop/` from their `git status`, and record the
 * worktree and the repo root in the manifest. `into` then holds only `source.json`; the tree is `worktree`, at the
 * repo's current commit (uncommitted edits are NOT in it). No seed commit is made — the seed IS the repo's HEAD.
 * @param {{source: string, into: string, destination?: string, worktree?: string,
 *   fetchTimeoutMs?: number, afterScan?: () => (void|Promise<void>)}} args
 *   `fetchTimeoutMs` is test-only — production callers omit it and get
 *   `PROVIDER_TIMEOUT_MS`. `afterScan` is a test seam too: called exactly once,
 *   after the secret scan finished and before the freeze loop re-reads any
 *   file's bytes, so a test can swap a file inside that window
 *   deterministically. Production never sets it; absent, behaviour is unchanged.
 * @returns {Promise<{stop: null, into: string, tree: string, manifestPath: string, manifest: Record<string, any>}|SourceRefusal>}
 */
export async function prepareSource({ source, into, destination, worktree, fetchTimeoutMs = PROVIDER_TIMEOUT_MS, afterScan }) {
  const intoAbs = resolve(into);
  if (existsSync(intoAbs)) {
    return refuse('into-exists', `${intoAbs} already exists — a source door writes a FRESH tree, never reuses one (the export worktree rule)`);
  }
  const isUrl = /^https?:\/\//i.test(source);
  // needed here, before the source is actually walked below, because a repo
  // source's destination takes a DIFFERENT path (the write-fence recording
  // above) than every other kind's (the directory proof). The real walk
  // below makes the authoritative kind determination (and refuses
  // source-is-linked-worktree when `.git` is a file); `looksLikeRepoSource`
  // only has to agree with it closely enough to route the destination check
  // correctly, and it does — both read the same `.git` existence test.
  const isRepoLike = looksLikeRepoSource(source);
  // hamr's ruling (PRD item 33): source AND destination are proven at job
  // start, $0 — and review finding #2 sharpens WHEN: before `into` is
  // created, never after, so a refused destination leaves nothing on disk
  // (no half-built tree for a job that was never going to be able to land
  // its result). Order matters here: this runs before any source is read,
  // fetched, or walked.
  if (destination !== undefined) {
    if (isRepoLike) {
      if (typeof destination !== 'string' || destination.length === 0) {
        return refuse('destination-invalid', 'destination must be a non-empty value — a repo source records it as the declared write fence, wired into writeScope in a later milestone');
      }
    } else {
      const dp = await proveDestination(destination, { into: intoAbs });
      if (dp.stop !== null) return dp;
    }
  }

  /** @type {{kind: 'url'|'file'|'folder'|'repo', files: {rel: string, abs?: string, buf?: Buffer, symlinkTarget?: string}[], root?: string, finalUrl?: string, sourceSubdir?: string}} */
  let frozen;

  if (isUrl) {
    let u;
    try { u = new URL(source); } catch { return refuse('source-unreadable', `${source} does not parse as a URL`); }
    if (u.username !== '' || u.password !== '') {
      return refuse('source-unreadable', 'no embedded credentials (user:pass@host) — secrets never enter a source door, and a URL is fetched with no credentials at all');
    }
    if (scanSecrets(source).length) {
      return refuse('source-unreadable', 'the URL carries a known secret-token shape — secrets never enter the tree/manifest (hard line #3)');
    }
    const fetched = await fetchOnce(source, fetchTimeoutMs);
    if (fetched.stop !== null) return fetched;
    // the URL the body ACTUALLY came from, after any redirect (M2b fix 5) —
    // scanned the same way the typed one was, because a redirect target is a
    // string this door is about to write into the manifest. Reviewed and
    // deliberately NOT also re-checked for embedded credentials the way the
    // typed URL is: proven live (this session) that `fetch`'s own redirect
    // handling in 'cors' mode (the default this door uses) already returns a
    // network error — `source-fetch-failed` — for any redirect whose target
    // carries a `user:pass@host` userinfo, so a second check here would be
    // unreachable dead code, never provable by a real test.
    if (scanSecrets(fetched.finalUrl).length) {
      return refuse('source-unreadable', 'the URL redirected to a location carrying a known secret-token shape — secrets never enter the tree/manifest (hard line #3)');
    }
    // no reliable filename off a URL in general — the last path segment when
    // there is one, else a fixed name; either way ONE file, never a listing
    const last = new URL(fetched.finalUrl).pathname.split('/').filter(Boolean).at(-1);
    const rel = last || 'source.txt';
    if (ENV_FILE.test(rel)) {
      return refuse('source-env-file', `${fetched.finalUrl} names an environment file — refused by NAME, whatever it contains (hard line: secrets never enter the tree)`);
    }
    frozen = { kind: 'url', files: [{ rel, buf: fetched.buf }], finalUrl: fetched.finalUrl };
  } else {
    const sourceAbs = resolve(source);
    let st;
    try { st = await lstat(sourceAbs); } catch { return refuse('source-unreadable', `${source} does not exist or cannot be read`); }
    if (st.isSymbolicLink()) return refuse('source-symlink', `${source} is a symlink — named, never followed`);
    if (st.isDirectory()) {
      // M2b fix 7 (hamr: yes — the PR-review job): a git repo IS an allowed
      // source now. It is COPIED with its history, never used in place (the
      // patients-are-copies rule), and gets the same `output/`, manifest,
      // destination and copy-out every other source gets. Its own guards
      // (the input stays untouched) arrive with M4.
      //
      // RULING 2 ADDENDUM (hamr, 2026-09-13, option A): a Source that is a
      // SUBFOLDER inside a git repo IS a repo job — the boundary is the
      // NEAREST ancestor's `.git`, found by walking UP from Source, never
      // only a `.git` sitting directly inside Source itself (a monorepo
      // package like `myrepo/packages/api` used to fall to the plain-folder
      // path below, which has no checks yet and would hit untracked
      // `node_modules` symlinks as a refusal, F164's class). The WHOLE
      // repo's tracked files are frozen — `listRepoFiles(repoRoot)`, not just
      // the subfolder — exactly as for a repo-ROOT source today.
      const found = nearestGitAncestor(sourceAbs);
      if (found !== null && found.isFile) {
        // a `.git` FILE (a linked worktree or a submodule) points its gitdir
        // somewhere else entirely — copying it would aim every git command,
        // the seed commit included, at the ORIGINAL repo. Refused, never
        // followed, for the same reason a symlink is. `found.dir` is the
        // ancestor that actually carries the file — Source itself when
        // Source IS that ancestor, an ancestor ABOVE Source otherwise.
        return refuse('source-is-linked-worktree', `${found.dir}/.git is a file, not a directory — this is a linked worktree or a submodule, whose real git directory lives elsewhere; point the door at the repo itself (a copy would silently commit into the original)`);
      }
      const isRepo = found !== null;
      if (isRepo) {
        const repoRoot = /** @type {{dir: string}} */ (found).dir;
        const walked = await listRepoFiles(repoRoot);
        if (walked.stop !== null) return walked;
        // Source's own path relative to the repo root — '' when Source IS
        // the repo root, a real subpath (e.g. "packages/api") when it is a
        // subfolder. Recorded in the manifest (below) for later use; nothing
        // downstream reads it yet — the fence/scope wiring is a later piece.
        const sourceSubdir = relative(repoRoot, sourceAbs).split(sep).join('/');
        // hamr's ruling A (PRD item 34 loose end, 2026-09-13, live-proven at
        // $0): the ruling-2 addendum above freezes the WHOLE repo whenever
        // Source is a subfolder, but `listRepoFiles` only ever returns
        // TRACKED paths — when the subfolder itself is gitignored or simply
        // untracked, NONE of its own files are among them, and the freeze
        // silently succeeds with a `kind: 'repo'` tree that holds nothing the
        // person actually pointed Source at. Refused here, before `into` is
        // created and before a single byte is scanned or written — a repo
        // ROOT source (`sourceSubdir === ''`) is exempt (it always has the
        // whole tracked tree by definition), and a subfolder with AT LEAST
        // ONE tracked file underneath it is unaffected (that is the existing,
        // unchanged "partially-ignored files inside a tracked folder" case).
        if (sourceSubdir !== '' && !walked.files.some((f) => f.rel === sourceSubdir || f.rel.startsWith(`${sourceSubdir}/`))) {
          return refuse('source-untracked-in-repo', `${sourceAbs} is inside the git repo at ${repoRoot}, but git does not track anything in it, so a repo job would not see its files — commit the files, or point Source at a folder outside the repo`);
        }
        frozen = {
          kind: 'repo', root: repoRoot, files: walked.files, sourceSubdir,
        };
      } else {
        const walked = await walkFolder(sourceAbs);
        if (walked.stop !== null) return walked;
        frozen = {
          kind: 'folder',
          root: sourceAbs,
          files: walked.files.map((rel) => ({ rel, abs: join(sourceAbs, rel) })),
        };
      }
    } else if (st.isFile()) {
      const name = /** @type {string} */ (source.split(sep).at(-1) ?? source);
      if (ENV_FILE.test(name)) {
        return refuse('source-env-file', `${source} is an environment file — refused by NAME, whatever it contains (hard line: secrets never enter the tree)`);
      }
      if (st.size > MAX_BUFFER) {
        return refuse('source-file-oversize', `${source} is ${st.size}B, over the ${MAX_BUFFER}B per-file ceiling — a source door freezes what a run can actually read, never a file it would only ever see a truncated prefix of`);
      }
      const buf = await readFile(sourceAbs);
      if (hasNulByte(buf.subarray(0, 8192))) return refuse('source-not-text', `${source} carries a NUL byte in its first 8KB — text only for now (hole H7)`);
      frozen = { kind: 'file', files: [{ rel: name, buf }] };
    } else {
      return refuse('source-unreadable', `${source} is neither a regular file, a folder, nor an http(s) URL`);
    }
    // D3 rework: a destination sitting inside the source is now LEGAL —
    // hamr's same-dir case ("i can limit your actions to a certain fix in a
    // certain dir and your output will also be there"). `destination-in-source`
    // is gone; `copyOut` never overwrites an existing file (dated names,
    // `COPYFILE_EXCL`), so a same-dir destination cannot clobber the source.
  }

  // a repo source keeps its own shape (the history is the point, and a
  // worker reviewing a PR needs the repo AT the tree root); every other kind
  // is frozen under `input/`, leaving `output/` as the only place a run writes
  const underInput = frozen.kind !== 'repo';
  /** @param {string} rel */
  const treeRel = (rel) => (underInput ? `input/${rel}` : rel);

  // hard line (CLAUDE.md): secrets never enter the tree, the spine, the
  // configs, or the ledger — an append-only log that captures a key captures
  // it forever. Every frozen file's content is scanned BEFORE anything is
  // written under `into` (no mkdir has run yet — a refusal here leaves
  // nothing on disk, `into` itself included). The matched text is never
  // read into this refusal — only the file path and the pattern name. One
  // file at a time: a repo source can be far larger than memory if every
  // buffer is held at once.
  //
  // D2 (closes the F166 residual): a BINARY file (a NUL byte in its first
  // 8KB) used to be hashed and never scanned — a named hole sitting on a hard
  // line. It now runs through the SAME `SECRET_PATTERNS` inventory, decoded
  // `latin1` rather than `utf8` — `latin1` is byte-preserving (one byte, one
  // code point), so an ASCII key sitting inside a compiled artifact still
  // matches; `utf8` would have thrown or mangled bytes on arbitrary binary
  // content. No second pattern list, ever.
  /** @type {{rel: string, names: string[]}[]} */
  const secretHits = [];
  /** @type {{path: string, bytes: number, sha256: string}[]} */
  const fileMeta = [];
  for (const f of frozen.files) {
    const buf = f.buf ?? (f.symlinkTarget !== undefined ? Buffer.from(f.symlinkTarget, 'utf8') : await readFile(/** @type {string} */ (f.abs)));
    fileMeta.push({ path: f.rel, bytes: buf.length, sha256: sha256Hex(buf) });
    const isBinary = f.symlinkTarget === undefined && hasNulByte(buf.subarray(0, 8192));
    // P6 item 2 (hamr 2026-10-05 Q2=A): a repo going onto a WORKTREE is the person's OWN repo, left in place — a secret
    // already in it is MASKED wherever bareloop records it (`redactSecrets`), not a refusal. Every other kind keeps the scan.
    if (worktree !== undefined && frozen.kind === 'repo') continue;
    const names = secretPatternNames(buf.toString(isBinary ? 'latin1' : 'utf8'));
    if (names.length) secretHits.push({ rel: f.rel, names });
  }
  if (secretHits.length) {
    const detail = secretHits.map((h) => `${h.rel} (${h.names.join(', ')})`).join('; ');
    return refuse('source-carries-secret', `${secretHits.length} file(s) carry a known secret shape — refused before anything was written (hard line #3, secrets never enter the tree): ${detail}`);
  }

  if (worktree !== undefined && frozen.kind === 'repo') {
    const repoRoot = /** @type {string} */ (frozen.root);
    const wt = resolve(worktree);
    try {
      hideBareloopDir(repoRoot);
      addWorktree(repoRoot, wt);
    } catch (e) {
      return refuse('source-worktree-failed', `could not make the job's worktree in ${repoRoot}: ${/** @type {Error} */ (e).message} (the repo needs at least one commit)`);
    }
    const headAt = await git(wt, ['rev-parse', 'HEAD']);
    if (!headAt.ok) return refuse('source-git-failed', `git rev-parse HEAD failed in ${wt}: ${headAt.err}`);
    const wtManifest = {
      kind: 'repo',
      source,
      ...(frozen.sourceSubdir === undefined ? {} : { sourceSubdir: frozen.sourceSubdir }),
      fetchedAt: new Date().toISOString(),
      files: fileMeta,
      seed: headAt.out.trim(),
      destination: destination ?? null,
      worktree: wt,
      repo: repoRoot,
    };
    await mkdir(intoAbs, { recursive: true });
    const wtManifestPath = join(intoAbs, 'source.json');
    await writeFile(wtManifestPath, `${JSON.stringify(wtManifest, null, 2)}\n`);
    return { stop: null, into: intoAbs, tree: wt, manifestPath: wtManifestPath, manifest: wtManifest };
  }

  const treeDir = join(intoAbs, 'tree');
  const outputDir = join(treeDir, 'output');
  await mkdir(treeDir, { recursive: true });
  if (frozen.kind === 'repo') {
    // the history, copied verbatim — `verbatimSymlinks` so git's own internal
    // links are never dereferenced into copies of what they point at
    await cp(join(/** @type {string} */ (frozen.root), '.git'), join(treeDir, '.git'), { recursive: true, verbatimSymlinks: true });
    // strip the copied hooks (see NO_HOOKS above) — `force: true` because a
    // repo with no hooks configured has no `hooks/` to remove at all
    await rm(join(treeDir, '.git', 'hooks'), { recursive: true, force: true });
    // F177: hide the copy's own future `node_modules/` before the seed is
    // committed below — see `hideNodeModulesInCopy`'s docstring
    const hideStop = await hideNodeModulesInCopy(treeDir);
    if (hideStop !== null) return hideStop;
  }
  await mkdir(outputDir, { recursive: true });
  // git tracks no empty directories — a `.gitkeep` is what makes `output/`
  // actually exist in the seed commit the close measures changes against
  await writeFile(join(outputDir, '.gitkeep'), '');
  // TOCTOU close (item 34 L1, fix-ledger `src/source.js:506,537`): a folder/
  // repo file's bytes were hashed and secret-scanned ABOVE, from one read —
  // then re-read a SECOND time here via `copyFile`, off disk, to freeze into
  // the tree. A file swapped on disk between the two reads would have its
  // secret scan run against bytes different from the ones actually frozen —
  // exactly the gap the hard line (secrets never enter the tree) exists to
  // close. Fixed by re-verifying, not by caching every buffer: caching would
  // hold a whole repo's bytes in memory at once (the streaming design above
  // this loop exists precisely to avoid that for a repo source "far larger
  // than memory"). Instead, this second read is hashed again and compared
  // against `fileMeta`'s scan-time `sha256` (same index, same file order as
  // the scan loop above) — a match means the bytes frozen ARE the bytes
  // scanned; a mismatch refuses rather than silently freezing content the
  // scan never saw. `copyFile` also preserved the source file's mode bits
  // (verified: 0o755 in, 0o755 out; a plain `writeFile` defaults to 0o644),
  // so the replacement chmod's the destination from a fresh `stat` to keep
  // that behaviour unchanged.
  if (afterScan) await afterScan();
  for (let i = 0; i < frozen.files.length; i += 1) {
    const f = frozen.files[i];
    const dest = join(treeDir, treeRel(f.rel));
    await mkdir(dirname(dest), { recursive: true });
    if (f.buf) { await writeFile(dest, f.buf); continue; }
    if (f.symlinkTarget !== undefined) { await symlink(f.symlinkTarget, dest); continue; }
    const [freshBuf, srcStat] = await Promise.all([
      readFile(/** @type {string} */ (f.abs)),
      stat(/** @type {string} */ (f.abs)),
    ]);
    if (sha256Hex(freshBuf) !== fileMeta[i].sha256) {
      return refuse('source-changed-after-scan', `${f.rel} changed on disk after its secret scan — refused rather than freezing bytes the scan never saw (hard line #3)`);
    }
    await writeFile(dest, freshBuf);
    await chmod(dest, srcStat.mode & 0o777);
  }

  if (frozen.kind !== 'repo') {
    const init = await git(treeDir, ['init', '-q']);
    if (!init.ok) return refuse('source-git-failed', `git init failed in ${treeDir}: ${init.err}`);
  }
  // `-f` (M2b fix 6) for a PLAIN FOLDER/FILE/URL source only: a `.gitignore`
  // sitting INSIDE such a source must never decide what the seed holds — the
  // hidden git tree has no gitignore of its own yet, so "gitignored" has no
  // honest meaning there. Every file this door froze is a file it promised
  // in the manifest, and a close measures the run's writes against the seed —
  // a file present on disk but absent from the seed would read as the worker
  // having written it.
  //
  // D1 rework (F165): a REPO source drops `-f`. Only tracked files ever reach
  // the copied tree (`listRepoFiles`, above) — nothing gitignored in the
  // SOURCE repo is a candidate to add at all — so a plain `add -A` here adds
  // modifications to already-tracked paths and never force-resurrects
  // anything the source repo chose to ignore (`node_modules`, a gitignored
  // `.env`, this repo's own `.claude/`).
  const addArgs = frozen.kind === 'repo' ? ['add', '-A'] : ['add', '-A', '-f'];
  const add = await git(treeDir, [...NO_HOOKS, ...addArgs]);
  if (!add.ok) return refuse('source-git-failed', `git add failed in ${treeDir}: ${add.err}`);
  const commit = await git(treeDir, [...GIT_IDENTITY, ...NO_HOOKS, 'commit', '-q', '-m', 'bareloop: source front door seed']);
  if (!commit.ok) return refuse('source-git-failed', `git commit failed in ${treeDir}: ${commit.err}`);
  const head = await git(treeDir, ['rev-parse', 'HEAD']);
  if (!head.ok) return refuse('source-git-failed', `git rev-parse HEAD failed in ${treeDir}: ${head.err}`);
  const seed = head.out.trim();

  // M2b fix 6, the CHECK rather than the hope: the manifest says the seed
  // holds these files, so read the seed back and prove it does. A bare
  // emptiness check would miss partial omission (memory: a completeness guard
  // built on an emptiness check misses exactly this), so the two sets are
  // diffed, both ways, by name.
  const listed = await git(treeDir, ['ls-tree', '-r', '--name-only', 'HEAD']);
  if (!listed.ok) return refuse('source-git-failed', `git ls-tree failed in ${treeDir}: ${listed.err}`);
  const inSeed = new Set(listed.out.split('\n').map((l) => l.trim()).filter(Boolean));
  const missing = fileMeta.map((f) => treeRel(f.path)).filter((p) => !inSeed.has(p));
  if (missing.length) {
    return refuse('source-seed-incomplete', `${missing.length} frozen file(s) are missing from the seed commit — the manifest would claim bytes the seed does not carry, and a close would read them as the worker's own writes: ${missing.join(', ')}`);
  }

  const manifest = {
    kind: frozen.kind,
    source,
    // Source's own path relative to the repo root (ruling 2 addendum,
    // 2026-09-13) — '' when Source IS the repo root, a real subpath (e.g.
    // "packages/api") when it is a subfolder frozen as part of the WHOLE
    // repo. A NEW field beside the existing ones: `source` above keeps its
    // existing meaning (the original Source path, untouched), and nothing
    // downstream reads `sourceSubdir` yet — recorded here, wired later.
    ...(frozen.sourceSubdir === undefined ? {} : { sourceSubdir: frozen.sourceSubdir }),
    ...(frozen.finalUrl === undefined ? {} : { finalUrl: frozen.finalUrl }),
    fetchedAt: new Date().toISOString(),
    files: fileMeta,
    seed,
    destination: destination ?? null,
  };
  const manifestPath = join(intoAbs, 'source.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { stop: null, into: intoAbs, tree: treeDir, manifestPath, manifest };
}

/**
 * The install command a lockfile in `dir` implies — checked in a fixed order
 * so a tree carrying more than one lockfile still picks exactly one command,
 * deterministically. `npm install` (no lockfile match) is the fallback, never
 * a refusal — a repo can legally have dependencies with no committed
 * lockfile.
 * @type {ReadonlyArray<{file: string, command: string}>}
 */
const LOCKFILE_COMMANDS = Object.freeze([
  Object.freeze({ file: 'package-lock.json', command: 'npm ci' }),
  Object.freeze({ file: 'npm-shrinkwrap.json', command: 'npm ci' }),
  Object.freeze({ file: 'pnpm-lock.yaml', command: 'pnpm install --frozen-lockfile' }),
  Object.freeze({ file: 'yarn.lock', command: 'yarn install --frozen-lockfile' }),
  Object.freeze({ file: 'bun.lockb', command: 'bun install --frozen-lockfile' }),
  Object.freeze({ file: 'bun.lock', command: 'bun install --frozen-lockfile' }),
]);

/**
 * THE INSTALL-GAP DETECTOR (PRD item 33 close-out, `docs/product/PRD.md:450-452`,
 * hamr's ruling 2026-09-14, option A): `prepareSource` copies ONLY git-tracked
 * files (hamr's ruling, `docs/product/ITEM33-BUILD.md:225-239` — unchanged by
 * this function), so a JS/TS repo's prepared copy never carries `node_modules`,
 * and every close stage needing a tool (`tsc`, a test runner) instrument-stops
 * with nothing telling the person why. bareloop NEVER runs an install itself —
 * it only ever touches gated primitives, and a shell-out to `npm`/etc from
 * inside this module would be exactly the verb hamr's law reserves for the
 * worker's own granted tools, never the arbiter-side machinery that decides
 * whether a run even starts. This is a pure, $0 DETECTOR: it names the gap and
 * the exact command a person runs THEMSELVES in the copy, then returns.
 *
 * JS/TS ONLY for now — a repo in another detected language returns `null`
 * here unconditionally (no `package.json` to find), which is the correct
 * "nothing to report" reading, not a gap in this function; per-language
 * dependency-gap data for other languages is M3b's job
 * (`docs/product/ITEM33-BUILD.md`, "M3b"), not this one's.
 *
 * SUBFOLDER-AS-REPO (ruling 2 addendum, commit 2a020d8): a subfolder job
 * freezes the WHOLE repo, so `package.json` may sit at the repo root, at the
 * subfolder itself, or anywhere between — the SAME nearest-manifest-walking-up
 * rule `detectLanguage` (`src/detectlang.js`) applies, done independently here
 * (not by importing `detectLanguage`) to avoid a `source.js` ⇄ `detectlang.js`
 * import cycle, since `detectlang.js` already imports `nearestGitAncestor`
 * from this module.
 *
 * @param {string} treeDir the prepared tree's root (`prepareSource`'s
 *   returned `tree`, e.g. `<into>/tree` — a REPO source sits directly at this
 *   root; every other kind sits under `input/` inside it and has no repo
 *   dependency story yet, so callers only need this for a `kind: 'repo'`
 *   manifest)
 * @param {string} [sourceSubdir] the manifest's own `sourceSubdir` ('' or
 *   undefined when Source IS the repo root)
 * @returns {{dir: string, lockFile: string|null, manager: string, command: string, reason: string}|null} `null`
 *   when there is nothing to report: no JS/TS manifest found walking up from
 *   `sourceSubdir` to `treeDir`, the nearest one found has no dependencies,
 *   `node_modules` is already there, or the manifest cannot even be read as
 *   JSON (an invalid `package.json` is "cannot tell", never a false alarm).
 */
export function missingDependencies(treeDir, sourceSubdir = '') {
  const root = resolve(treeDir);
  let dir = sourceSubdir ? resolve(root, sourceSubdir) : root;
  /** @type {string[]} */
  const chain = [];
  for (;;) {
    chain.push(dir);
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root — safety only, never reachable under `root`
    dir = parent;
  }

  for (const d of chain) {
    const pkgPath = join(d, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      return null; // cannot tell — an invalid package.json is not a fabricated gap
    }
    if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) return null;
    const depCount = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    if (depCount === 0) return null; // a manifest with nothing to install is not a gap
    if (existsSync(join(d, 'node_modules'))) return null;

    const lock = LOCKFILE_COMMANDS.find((l) => existsSync(join(d, l.file)));
    const installCmd = lock ? lock.command : 'npm install';
    const rel = relative(root, d).split(sep).join('/');
    return {
      dir: d,
      lockFile: lock ? lock.file : null,
      manager: installCmd.split(' ')[0],
      command: rel === '' ? installCmd : `cd ${rel} && ${installCmd}`,
      reason: `${rel === '' ? 'package.json' : `${rel}/package.json`} lists dependencies but the copy has no node_modules`,
    };
  }
  return null;
}

/**
 * The delivered name (M2b fix 4, kept under D3): a destination FILE of
 * `/home/me/profile.md` lands as `/home/me/profile-2026-09-12.md`, and a
 * SECOND delivery of the same name the same day as
 * `profile-2026-09-12-2.md`, `-3`, … (the work-branch collision rule, the same
 * spelling `prepareWorkBranch` uses). The date is the delivery's, not the
 * run's: what a person wants to know opening the folder later is when the file
 * arrived. D3: `destination` here is a FULL FILE PATH inside the destination
 * DIRECTORY (`copyOut` builds one per output file it delivers) — this
 * function itself is unchanged from M2b, it is just no longer handed the
 * bare top-level destination directly.
 *
 * Nothing is ever overwritten, which is why the name is computed rather than
 * taken: a plain `profile.md` would eventually collide with the person's own
 * file or a previous run's, and the only honest answers to a collision are
 * "refuse" or "a new name" — hamr picked a new name.
 * @param {string} destination the absolute FILE path as declared
 * @param {Date} now
 * @param {number} n 1 = the plain dated name, 2+ = the same-day suffix
 * @returns {string}
 */
export function datedDestination(destination, now, n) {
  const dir = dirname(destination);
  const base = destination.slice(dir.length + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return join(dir, `${stem}-${day}${n > 1 ? `-${n}` : ''}${ext}`);
}

/**
 * The first dated name that is free, or a refusal when every same-day slot up
 * to `MAX_SAME_DAY` is taken. Used by `copyOut` at delivery time (per output
 * file) so a same-day repeat delivery of the same name never disagrees with
 * what "landable" means.
 * @param {string} destination an absolute FILE path
 * @param {Date} [now]
 * @returns {{stop: null, path: string}|SourceRefusal}
 */
export function pickDelivery(destination, now = new Date()) {
  for (let n = 1; n <= MAX_SAME_DAY; n++) {
    const candidate = datedDestination(destination, now, n);
    if (!existsSync(candidate)) return { stop: null, path: candidate };
  }
  return refuse('destination-exists', `every same-day name for ${destination} is taken (up to -${MAX_SAME_DAY}) — bareloop never overwrites a person's file`);
}

/**
 * Prove a destination DIRECTORY is landable — $0, mechanical, before any
 * token spends (PRD item 33 ruling: "source and destination are proven at
 * job start"). D3 rework (hamr's ruling, 2026-09-12): **destination is a
 * directory, never a filename** — it may already exist, and need not be
 * empty (a job may write into a folder that already holds other files, or
 * even sit inside the source itself, the same-dir case). What this proves is
 * narrower than the M2/M2b version: only that the directory is USABLE
 * (exists as a directory and is writable, or can be created) — it can say
 * nothing about individual delivered FILE names, because those are not known
 * until the run actually produces them (the agent names its own output
 * files); per-file same-day collisions are handled at delivery time, inside
 * `copyOut`, via `pickDelivery`.
 * @param {unknown} destination absolute directory path
 * @param {{into: string}} o `into` — the run's own scratch root (prepared by
 *   `prepareSource`, or a run's own `workdir` when there is no source door);
 *   the destination may never sit inside it.
 * @returns {Promise<{stop: null}|SourceRefusal>}
 */
export async function proveDestination(destination, { into }) {
  if (typeof destination !== 'string' || destination.length === 0) {
    return refuse('destination-invalid', 'destination must be a non-empty absolute path');
  }
  if (!destination.startsWith(sep) && !/^[a-zA-Z]:[\\/]/.test(destination)) {
    return refuse('destination-not-absolute', `${destination} is not absolute — the destination is a LOCAL directory the person moves elsewhere themselves, never a scope-relative path`);
  }
  const destAbs = resolve(destination);
  const intoAbs = resolve(into);
  if (destAbs === intoAbs || destAbs.startsWith(`${intoAbs}${sep}`)) {
    return refuse('destination-contained', `${destination} sits inside ${into} — the drop-off point may never be inside the run's own scratch tree`);
  }
  let dstat = null;
  try { dstat = await stat(destAbs); } catch { /* does not exist yet — proven creatable below */ }
  if (dstat !== null) {
    if (!dstat.isDirectory()) {
      return refuse('destination-not-directory', `${destination} exists and is not a directory — the destination is a DIRECTORY a job writes one or more named files into, never a filename itself`);
    }
    try {
      await access(destAbs, fsConstants.W_OK);
    } catch {
      return refuse('destination-not-writable', `${destination} exists but is not writable`);
    }
    return { stop: null };
  }
  const parent = dirname(destAbs);
  let pstat;
  try { pstat = await stat(parent); } catch {
    return refuse('destination-parent-missing', `${parent} does not exist — create it first, or point the destination somewhere that does`);
  }
  if (!pstat.isDirectory()) {
    return refuse('destination-parent-missing', `${parent} is not a directory`);
  }
  try {
    await access(parent, fsConstants.W_OK);
  } catch {
    return refuse('destination-parent-unwritable', `${parent} exists but is not writable`);
  }
  return { stop: null };
}

/**
 * Recursively list every REGULAR file under `dir`, relative to it, excluding
 * `.gitkeep` (the seed placeholder that makes the empty `output/` directory
 * exist in git — never a delivered file). A symlink is skipped, never
 * followed — this door has no reason to ever deliver one, since nothing this
 * run itself wrote under `output/` should be a link at all.
 * @param {string} dir @param {string} [rel]
 * @returns {Promise<string[]>}
 */
async function listOutputFiles(dir, rel = '') {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  /** @type {string[]} */
  let out = [];
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (relPath === '.gitkeep') continue;
    if (e.isDirectory()) out = out.concat(await listOutputFiles(join(dir, e.name), relPath));
    else if (e.isFile()) out.push(relPath);
  }
  return out;
}

/**
 * Copy the run's own output to the proven destination DIRECTORY — once per
 * file, never overwriting (`COPYFILE_EXCL`, so even a file that appears
 * between `proveDestination` and here refuses rather than clobbers), on a
 * minted green only. This function renders no verdict and changes none: a
 * refusal here is reported beside the green it could not deliver, never
 * folded back into it.
 *
 * D3 rework (hamr's ruling, 2026-09-12): a job may produce MORE THAN ONE
 * file (his example: a flight search producing one sheet for "SFO→LAX
 * red-eye" and another for "SFO under $700") — the agent names them
 * meaningfully, and EVERY non-empty file under `tree/output/` (excluding
 * `output/.gitkeep`) is delivered, each under its own dated name
 * (`datedDestination`/`pickDelivery`, M2b fix 4, unchanged). An empty file is
 * silently skipped (not a delivered result, same judgment M2b made for the
 * single-file case) rather than refusing the whole batch over one empty
 * file; the refusal is reserved for the case where NOTHING is left to
 * deliver at all.
 *
 * `into`, when given, is the run's own SCRATCH ROOT (`prepareSource`'s
 * `into`, of which `tree` is the `tree/` subdirectory) — review finding #3:
 * a destination sitting inside `<into>` but outside `tree` (e.g. dropped
 * straight in the scratch area, never inside the frozen tree) must still
 * refuse `destination-contained`, which a containment check against `tree`
 * alone cannot see. Omitted, it defaults to `tree` (the pre-fix behaviour),
 * for direct callers that only ever had a tree, never an `into`.
 * `amend` (S3), when given, is `(rel under output/, bytes) => bytes`: the DELIVERED copy is written from what it returns (the file in the tree is never touched), and the delivery record is of those bytes.
 * `report` (MD2, "Ruling 2026-11-18 (later): one markdown report per run"), when given, is `{name, render}`: after every file is delivered, `render` is asked ONCE with every step file (`steps/<n>.json`) as `{rel, orig, delivered}`
 * (`orig` the bytes as the tree holds them, `delivered` the amended copy); a string is written as ONE file `<name>-YYYY-MM-DD.md` at the destination root and recorded like any delivered file; null writes nothing.
 * It takes the dated suffix of the first delivered step file (so a same-day second run gets `-2` for both). Never overwriting: when that name is taken it lands under the next free same-day name (`pickDelivery`) and its file entry
 * carries `pairedTaken`, the basename it could not take (hamr 2026-11-18). It writes only inside this green-only door.
 * @param {{tree: string, into?: string, destination: string, amend?: (rel: string, buf: Buffer) => Buffer, report?: {name: string, render: (files: {rel: string, orig: Buffer, delivered: Buffer}[]) => string|null}}} o
 * @returns {Promise<{stop: null, files: {path: string, bytes: number, sha256: string, pairedTaken?: string}[]}|SourceRefusal>}
 */
export async function copyOut({ tree, into, destination, amend, report }) {
  const prove = await proveDestination(destination, { into: into ?? tree });
  if (prove.stop !== null) return prove;
  const destAbs = resolve(destination);
  await mkdir(destAbs, { recursive: true });
  const outputDir = join(tree, 'output');
  const candidates = await listOutputFiles(outputDir);
  /** @type {{path: string, bytes: number, sha256: string, pairedTaken?: string}[]} */
  const delivered = [];
  /** @type {{rel: string, orig: Buffer, delivered: Buffer, suffix: string}[]} */
  const stepFiles = [];
  for (const rel of candidates) {
    const srcPath = join(outputDir, rel);
    const read = await readFile(srcPath);
    const buf = amend === undefined ? read : amend(rel.split(sep).join('/'), read);
    if (buf.length === 0) continue; // an empty file is not a delivered result — skipped, never refused
    const declaredFile = join(destAbs, rel);
    await mkdir(dirname(declaredFile), { recursive: true });
    const pick = pickDelivery(declaredFile);
    if (pick.stop !== null) return pick;
    try {
      // `COPYFILE_EXCL` is the race backstop for a file that appears between
      // `pickDelivery` choosing a free name and this line — a mutation that
      // drops it survives every test in this file for exactly that reason,
      // and is a known, accepted survivor, not a gap.
      if (buf === read) await copyFile(srcPath, pick.path, fsConstants.COPYFILE_EXCL);
      else await writeFile(pick.path, buf, { flag: 'wx' });
    } catch (e) {
      if (/** @type {any} */ (e)?.code === 'EEXIST') return refuse('destination-exists', `${pick.path} already exists — bareloop never overwrites a person's file`);
      return refuse('destination-write-failed', `copying to ${pick.path} failed: ${/** @type {Error} */ (e)?.message ?? String(e)}`);
    }
    delivered.push({ path: pick.path, bytes: buf.length, sha256: sha256Hex(buf) });
    const relPosix = rel.split(sep).join('/');
    if (/^steps\/\d+\.json$/.test(relPosix)) stepFiles.push({ rel: relPosix, orig: read, delivered: buf, suffix: /(-\d{4}-\d{2}-\d{2}(?:-\d+)?)\.json$/.exec(pick.path)?.[1] ?? '' });
  }
  const text = report !== undefined && stepFiles.length > 0 ? report.render(stepFiles.map(({ rel, orig, delivered: d }) => ({ rel, orig, delivered: d }))) : null;
  if (report !== undefined && text !== null && text.length > 0) {
    const name = report.name.replace(/[/\\\0]/g, '-').replace(/^\.+/, '') || 'report';
    const paired = join(destAbs, `${name}${stepFiles[0].suffix}.md`);
    let mdPath = paired;
    if (existsSync(paired)) {
      const mdPick = pickDelivery(join(destAbs, `${name}.md`));
      if (mdPick.stop !== null) return mdPick;
      mdPath = mdPick.path;
    }
    const mdBuf = Buffer.from(text, 'utf8');
    try { await writeFile(mdPath, mdBuf, { flag: 'wx' }); } catch (e) {
      if (/** @type {any} */ (e)?.code === 'EEXIST') return refuse('destination-exists', `${mdPath} already exists — bareloop never overwrites a person's file`);
      return refuse('destination-write-failed', `copying to ${mdPath} failed: ${/** @type {Error} */ (e)?.message ?? String(e)}`);
    }
    delivered.push({ path: mdPath, bytes: mdBuf.length, sha256: sha256Hex(mdBuf), ...(mdPath !== paired ? { pairedTaken: basename(paired) } : {}) });
  }
  if (delivered.length === 0) {
    return refuse('destination-output-missing', `no non-empty file exists under ${outputDir} — the run never produced anything this job was declared to write`);
  }
  return { stop: null, files: delivered };
}

/**
 * Read a source-door manifest, if one is there. mid-build spec correction
 * (2026-09-11, the main session, on hamr's question about export): a job
 * spec is a SHAPE, signed once — source and destination are a PER-RUN value,
 * the way `bareloop run <bundle> --repo <path>` varies the repo instance
 * without touching the bundle's signature. Baking an absolute destination
 * path into `job.js`/`jobSpecHash` would sign one instance where the spec is
 * meant to describe a repeatable shape, so the run instance lives HERE
 * instead — the manifest `prepareSource` already writes outside the tree —
 * and nothing was added to the job schema.
 *
 * Absence is reported as absence: a patient the JOBS table points at
 * directly, never having gone through `prepareSource`, has no manifest, and
 * that IS "repo jobs untouched" — nothing here invents a destination for a
 * job that never declared one. A manifest that EXISTS but cannot be read or
 * parsed is a named stop, never a silent skip: the run has evidence
 * something is there and wrong, and hiding that is worse than refusing on it.
 * @param {string} into the manifest's own directory — `<into>/source.json`
 *   (a run-u-style caller passes `dirname(workdir)`, since `workdir` IS
 *   `<into>/tree`)
 * @returns {Promise<{stop: null, present: false, manifest: null}|{stop: null, present: true, manifest: Record<string, any>}|SourceRefusal>}
 */
export async function readSourceManifest(into) {
  const manifestPath = join(resolve(into), 'source.json');
  if (!existsSync(manifestPath)) return { stop: null, present: false, manifest: null };
  let raw;
  try { raw = await readFile(manifestPath, 'utf8'); } catch (e) {
    return refuse('source-manifest-unreadable', `${manifestPath} exists but could not be read: ${/** @type {Error} */ (e)?.message ?? String(e)}`);
  }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (e) {
    return refuse('source-manifest-invalid', `${manifestPath} is not valid JSON: ${/** @type {Error} */ (e)?.message ?? String(e)}`);
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return refuse('source-manifest-invalid', `${manifestPath} must contain a JSON object`);
  }
  return { stop: null, present: true, manifest };
}

/**
 * Reduce a `readSourceManifest` success result to the `{destination}` a
 * runner acts on, or `null` when there is none to act on (no manifest, one
 * that never declared a destination, or — D3 — a `kind: 'repo'` manifest,
 * whose `destination` names the WRITE FENCE inside the copied repo, never a
 * filesystem drop-off point this door proves or copies into: "repo jobs
 * UNCHANGED", `writeScope` already does that job, `src/job.js:363`). Pure
 * extraction of the one piece of `run-u.mjs`'s front-door reading that has
 * any logic in it (the rest is spine emits and control flow) —
 * unit-testable apart from the script, which is otherwise unreachable
 * without a live provider key.
 * @param {{present: boolean, manifest: Record<string, any>|null}} read
 * @returns {{destination: string}|null}
 */
export function frontDoorFromManifest(read) {
  if (!read.present || !read.manifest) return null;
  if (read.manifest.kind === 'repo') return null;
  const { destination } = read.manifest;
  if (typeof destination !== 'string' || !destination) return null;
  return { destination };
}

/**
 * The $0 refusal for a non-repo source, worded by the kind the source door recorded (`prep.manifest.kind`) — a single
 * file is not a "folder", and Source must be the repo folder with the file named in Destination (hamr 2026-10-05).
 * @param {string} kind `prep.manifest.kind`: 'file' | 'folder' | 'url' (a 'repo' never reaches this)
 * @returns {string}
 */
export function nonRepoSourceMessage(kind) {
  if (kind === 'file') return 'This file is inside a git repo, and Deterministic is picked: that needs the repo folder as Source. If you meant Rubric, pick Rubric and Revise. Nothing spent.';
  if (kind === 'folder') return "Source is a plain folder, not a code project (no git repo found). bareloop can't check this kind of job yet. Nothing spent.";
  return "Source is not a code project (no git repo found). bareloop can't check this kind of job yet. Nothing spent.";
}

/**
 * P7 (docs/product/PANEL-BUILD.md, "Inputs"): prove the NUMBERED INPUTS at $0, before any token. Line 1 is the repo
 * (an absolute path to an existing folder); lines 2+ are files or folders INSIDE that repo, repo-relative. A line
 * that is not one of those is a named red naming its line number — never a throw, never a silent skip:
 *   - a `search:` line or a URL, and a path that leaves the repo: "only files inside the repo for now" (search and
 *     outside-the-repo inputs arrive with the plain-folder piece);
 *   - a path that does not exist, or that git does not track (a repo job would not see it);
 *   - the front door's own refusals for a file: an environment file by NAME, a symlink, a non-text file, an oversize
 *     file. A known secret shape in its content is NOT a refusal (masked where recorded, as the P6 worktree door does).
 * A folder value is checked for existence and tracking only (its files are the repo's own, which the worktree door
 * already masks). Reads the tree; writes nothing.
 * MCP + tickets piece 1a: with `opts.mcp` (the job's signed `{server, tools}`), a line 2+ whose value is a GitHub issues address is a TICKET line, not a repo path: it is proven at $0
 * as "the MCP can read it" (`proveTicketLine`: server named in the person's config, not remote, `issue_read` signed). Only one such line; it is read and frozen at run start.
 * Without `opts.mcp` the same line is the old refusal ("only files inside the repo for now").
 * @param {{n: number, label: string, value: string}[]} inputs the parsed Inputs (`parseInputs`)
 * @param {{mcp?: {server: string, tools: string[]}, configPath?: string}} [opts]
 * @returns {Promise<{ok: true, repo: string, root: string|null}|{ok: false, error: string}>} `repo` = line 1's absolute path; `root` = the git root it sits in (null when line 1 alone was given and it is not in a git repo)
 */
export async function proveInputFiles(inputs, opts = {}) {
  const first = inputs[0];
  if (!first) return { ok: false, error: 'Inputs, line 1: the repo is required' };
  /** @param {number} n @param {string} msg @returns {{ok: false, error: string}} */
  const bad = (n, msg) => ({ ok: false, error: `Inputs, line ${n}: ${msg}` });
  if (/^https?:\/\//i.test(first.value) || !isAbsolute(first.value)) return bad(1, 'the repo must be an absolute path, like /home/me/myrepo');
  const repo = resolve(first.value);
  let st;
  try { st = lstatSync(repo); } catch { return bad(1, `${repo} does not exist`); }
  // line 1 alone is the repo the job works on; whether it IS a code repo is the source door's own refusal (and
  // `nonRepoSourceMessage`) downstream — only lines 2+ need a git tree to be proven against
  const found = st.isDirectory() ? nearestGitAncestor(repo) : null;
  if (inputs.length === 1) return { ok: true, repo, root: found && !found.isFile ? found.dir : null };
  if (!st.isDirectory()) return bad(1, `${repo} is not a folder — line 1 is the repo`);
  if (found === null || found.isFile) return bad(1, `${repo} is not inside a git repo, so the other inputs cannot be checked`);
  const root = found.dir;
  const rootReal = await realpath(root);
  const repoReal = await realpath(repo);
  let ticketLines = 0;
  for (const inp of inputs.slice(1)) {
    const { n, label, value } = inp;
    if (opts.mcp !== undefined && parseTicketList(value).ok) {
      if (++ticketLines > 1) return bad(n, 'only one ticket address per job - a second issues or pulls address is not read');
      const listed = parseTicketList(value);
      const proof = proveTicketLine(opts.mcp, opts.configPath === undefined ? {} : { configPath: opts.configPath }, listed.ok ? listed.kind : 'issue');
      if (!proof.ok) return bad(n, proof.error);
      continue;
    }
    if (/^search$/i.test(label) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return bad(n, 'only files inside the repo for now');
    // like-for-like: resolve against the repo as the REAL filesystem sees it, so a repo reached through a symlinked parent
    // compares against `rootReal` in the same spelling (a symlinked INPUT FILE is still refused below, by lstat)
    const abs = resolve(repoReal, value);
    const outside = (/** @type {string} */ p) => !(p === rootReal || p.startsWith(`${rootReal}${sep}`));
    if (outside(abs)) return bad(n, 'only files inside the repo for now');
    let ls;
    try { ls = await lstat(abs); } catch { return bad(n, `${value} does not exist in the repo`); }
    if (ls.isSymbolicLink()) return bad(n, `${value} is a symlink — refused, never followed`);
    let real;
    try { real = await realpath(abs); } catch { return bad(n, `${value} does not exist in the repo`); }
    if (outside(real)) return bad(n, 'only files inside the repo for now');
    const rel = relative(rootReal, abs).split(sep).join('/');
    const tracked = await git(root, ['ls-files', '-z', '--', rel === '' ? '.' : rel]);
    if (!tracked.ok || tracked.out.split('\0').filter(Boolean).length === 0) {
      return bad(n, `${value} is not tracked by git — a repo job only sees tracked files; commit it first`);
    }
    if (ls.isDirectory()) continue;
    if (ENV_FILE.test(basename(abs))) return bad(n, `${value} is an environment file — refused by NAME, whatever it contains (secrets never enter a job)`);
    if (ls.size > MAX_BUFFER) return bad(n, `${value} is over the ${MAX_BUFFER}B per-file ceiling`);
    const buf = await readFile(abs);
    if (hasNulByte(buf.subarray(0, 8192))) return bad(n, `${value} is not a text file — text only for now`);
    // a secret-shaped CONTENT is not refused (P6 worktree repo door, hamr 2026-10-05 Q2=A, same ruling for inputs): the file is
    // the person's own, left in place; bareloop masks a secret wherever IT records one (`redactSecrets`, the one inventory) and
    // never copies this file's text into a record — only its path travels. `.env` by name and symlinks stay refused above.
  }
  return { ok: true, repo, root };
}

/** the per-file ceiling for a rubric input: bareguard's `cited` check searches a quote in a source only up to this size
 * (its `quoteSourceMaxBytes`); a bigger file could never be cited from, so the door refuses it at $0 */
export const RUBRIC_INPUT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Does this source manifest belong to a rubric job on local files (`proveRubricInputs` wrote it)? One spelling for both
 * doors (the panel session and the CLI author run): a non-repo source that froze numbered, labelled input files.
 * @param {Record<string, any>|null|undefined} manifest
 * @returns {boolean}
 */
export function isRubricFilesManifest(manifest) {
  return !!manifest && manifest.kind !== 'repo' && Array.isArray(manifest.inputs) && manifest.inputs.length > 0;
}

/**
 * PART 1a (docs/product/ITEM33-BUILD.md, "Addendum 2026-10-12"): the front door for a RUBRIC job whose inputs are the
 * person's own LOCAL FILES, not a repo. Each numbered `label: /absolute/file` line is proven at $0 and frozen into the
 * same hidden-git tree a plain folder gets (`prepareSource`, which also refuses a secret shape, an environment file
 * and a symlink), under `input/`; the manifest then also records `inputs: [{label, rel, sha256}]` — the bytes the
 * rubric's `cited` check will search a quote in, hashed once, here. A line that is a web address is fetched ONCE with
 * barebrowse (PART 1c, read only) and its text frozen under `input/` like a file (the manifest row also records its `url`,
 * so run start can fetch it again); a `search:` line is a named refusal (a later build); so is a relative path, a missing file, a folder, a file over
 * {@link RUBRIC_INPUT_MAX_BYTES}, and text that is not valid UTF-8. Every refusal is plain words naming the line and
 * ends "Nothing spent." — nothing here touches a model.
 * @param {{inputs: {n: number, label: string, value: string}[], into: string, destination?: string, fetchUrl?: (url: string) => Promise<{ok: true, text: string, url: string}|{ok: false, error: string, attempts?: {chars: number, ms: number, head: string}[]}>}} o `fetchUrl` - how a web address is read (default barebrowse via `fetchPageText`; a test injects a stub, never the network)
 * @returns {Promise<{ok: true, prep: {stop: null, into: string, tree: string, manifestPath: string, manifest: Record<string, any>}}|{ok: false, error: string, code: string, attempts?: {chars: number, ms: number, head: string}[]}>}
 */
export async function proveRubricInputs({ inputs, into, destination, fetchUrl = (u) => fetchPageText(u) }) {
  /** @param {string} code @param {number} n @param {string} msg @returns {{ok: false, error: string, code: string}} */
  const bad = (code, n, msg) => ({ ok: false, code, error: `line ${n}: ${msg} Nothing spent.` });
  if (!Array.isArray(inputs) || inputs.length === 0) return { ok: false, code: 'inputs-missing', error: 'Inputs is required. Nothing spent.' };
  /** @type {Set<string>} */
  const labels = new Set();
  /** @type {{label: string, name: string, buf: Buffer, url?: string}[]} */
  const staged = [];
  /** @type {Set<string>} */
  const names = new Set();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  for (const inp of inputs) {
    const { n, label, value } = inp;
    if (/^search$/i.test(label) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !isWebUrl(value))) {
      return bad('web-input', n, 'a search, or an address that is not http or https, is not an input yet.');
    }
    if (labels.has(label.toLowerCase())) return bad('label-repeat', n, `the label "${label}" is already used by an earlier line.`);
    labels.add(label.toLowerCase());
    if (isWebUrl(value)) {
      const got = await fetchUrl(value.trim());
      if (!got.ok) return { ...bad('input-url-unreadable', n, `${got.error.replace(/(?<![.\s])[.\s]+$/, '')}.`), ...(got.attempts?.length ? { attempts: got.attempts } : {}) };
      const pageBuf = Buffer.from(got.text, 'utf8');
      const leak = secretPatternNames(got.text);
      if (leak.length) return bad('input-url-secret', n, `the page at ${got.url} carries a known secret shape (${leak.join(', ')}) - refused, secrets never enter a job.`);
      const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
      const pageName = names.has(`${stem}.txt`) ? `${n}-${stem}.txt` : `${stem}.txt`;
      names.add(pageName);
      staged.push({ label, name: pageName, buf: pageBuf, url: got.url });
      continue;
    }
    if (!isAbsolute(value)) return bad('input-not-absolute', n, `${value} must be the full path of a file, like /home/me/notes.md.`);
    const abs = resolve(value);
    let ls;
    try { ls = await lstat(abs); } catch { return bad('input-missing', n, `${abs} does not exist.`); }
    if (ls.isSymbolicLink()) return bad('input-symlink', n, `${abs} is a symlink — refused, never followed.`);
    if (!ls.isFile()) return bad('input-not-file', n, `${abs} is not a file — each input line is one file.`);
    const base = basename(abs);
    if (ENV_FILE.test(base)) return bad('input-env-file', n, `${abs} is an environment file — refused by name, whatever it contains.`);
    if (ls.size > RUBRIC_INPUT_MAX_BYTES) return bad('input-oversize', n, `${abs} is over the ${RUBRIC_INPUT_MAX_BYTES / (1024 * 1024)} MiB limit for a quoted input.`);
    const buf = await readFile(abs);
    try { utf8.decode(buf); } catch { return bad('input-not-utf8', n, `${abs} is not UTF-8 text — text files only for now.`); }
    if (hasNulByte(buf)) return bad('input-not-text', n, `${abs} is not a text file — text files only for now.`);
    // two files with one name keep the line number in front, so neither overwrites the other under input/
    const name = names.has(base) ? `${n}-${base}` : base;
    names.add(name);
    staged.push({ label, name, buf });
  }
  const stage = await mkdtemp(join(tmpdir(), 'bareloop-rubric-inputs-'));
  try {
    for (const f of staged) await writeFile(join(stage, f.name), f.buf);
    const prep = await prepareSource({ source: stage, into, ...(destination === undefined ? {} : { destination }) });
    if (prep.stop !== null) return { ok: false, code: prep.code, error: prep.stop };
    // `source` names the person's own first file, never the scratch staging folder that was already removed
    const manifest = {
      ...prep.manifest,
      source: isWebUrl(inputs[0].value) ? inputs[0].value.trim() : resolve(inputs[0].value),
      inputs: staged.map((f) => ({ label: f.label, rel: `input/${f.name}`, sha256: sha256Hex(f.buf), ...(f.url === undefined ? {} : { url: f.url }) })),
    };
    await writeFile(prep.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { ok: true, prep: { ...prep, manifest } };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/**
 * Is this Inputs value a path to an existing regular FILE on this machine (not a repo folder, not a web address, not a
 * missing path)? The $0 peek that tells a rubric job on local files from a rubric job on a repo before a session exists;
 * `proveRubricInputs` makes the authoritative, line-by-line proof.
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeLocalFile(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || !isAbsolute(value)) return false;
  try { return lstatSync(resolve(value)).isFile(); } catch { return false; }
}

/**
 * Is this Inputs value one a rubric job can work on without a repo: a regular FILE on this machine, or a web address (PART 1c)?
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeRubricInput(value) {
  return isWebUrl(value) || looksLikeLocalFile(value);
}

/**
 * RUN START for a rubric job with web inputs (PART 1c, RF22): fetch every web input AGAIN and make that text the run's frozen input
 * BEFORE the worker starts. The drafting copy was only for the look (prices change); the close grades, and the worker reads, THIS
 * copy. It is written into the prepared tree, committed as the new seed (so the page is never read as a worker write), and
 * `source.json` is rewritten (new sha256 per input, new seed, `draftSha256` keeps what the look saw). Nothing but the text of a
 * recorded web address is ever refetched; a job with only file inputs returns at once and changes nothing.
 *
 * MCP + tickets (piece 1): with `ticket` (a job that reads tickets: `{number, mcp}`, the number per run from `--ticket`), the ONE input row whose address is a
 * GitHub issues list is read through the person's MCP server instead of the page reader: the ticket's reply, MASKED with the one secret inventory before the sha
 * (a secret in a ticket is masked, never refused; page rows keep their refusal), is the run's frozen input. The row keeps its signed `url` (the list address) and
 * gains `mcp:{server,exposed,missing,calls}`, `ticket:{number,title,state,source}` and `masked:<count>`. Any refusal (server or tool missing, a device login,
 * an empty reply, no list row or two) is the same plain `did not start` words at $0.
 * @param {{into: string, fetchUrl?: (url: string) => Promise<{ok: true, text: string, url: string}|{ok: false, error: string}>, ticket?: {number: number, mcp: {server: string, tools: string[]}}}} o `into` - the prepared copy (source.json + tree/)
 * @returns {Promise<{ok: true, refreshed: string[], seed: string|null, ticketText?: string}|{ok: false, error: string}>}
 */
export async function refreezeUrlInputs({ into, fetchUrl = (u) => fetchPageText(u), ticket }) {
  const read = await readSourceManifest(into);
  if (read.stop !== null) return { ok: false, error: read.stop };
  if (!read.present || !read.manifest) return { ok: true, refreshed: [], seed: null };
  const manifest = read.manifest;
  const rows = Array.isArray(manifest.inputs) ? manifest.inputs.filter((/** @type {any} */ r) => r && typeof r.url === 'string' && r.url !== '') : [];
  if (rows.length === 0) return { ok: true, refreshed: [], seed: null };
  const tree = join(resolve(into), 'tree');
  /** @type {{row: any, buf: Buffer, ticket?: import('./ticket.js').Ticket}[]} */
  const fresh = [];
  const listRows = ticket === undefined ? [] : rows.filter((/** @type {any} */ r) => parseTicketList(r.url).ok);
  if (ticket !== undefined && listRows.length !== 1) {
    return { ok: false, error: listRows.length === 0
      ? 'This job reads a ticket, but none of its Inputs is the issues or pulls page of a GitHub repository (owner/repo/issues or owner/repo/pulls). The run did not start. Nothing spent.'
      : 'This job reads one ticket, but more than one of its Inputs is a GitHub issues or pulls address. The run did not start. Nothing spent.' };
  }
  for (const row of rows) {
    if (ticket !== undefined && listRows[0] === row) {
      const t = await readTicket({ mcp: ticket.mcp, listUrl: row.url, number: ticket.number });
      if (!t.ok) return { ok: false, error: `Input "${row.label}": ${t.error}. The run did not start. Nothing spent.` };
      fresh.push({ row, buf: Buffer.from(t.ticket.text, 'utf8'), ticket: t.ticket });
      continue;
    }
    const got = await fetchUrl(row.url);
    if (!got.ok) return { ok: false, error: `Input "${row.label}": ${got.error}. The run did not start. Nothing spent.` };
    const leak = secretPatternNames(got.text);
    if (leak.length) return { ok: false, error: `Input "${row.label}": the page at ${got.url} carries a known secret shape (${leak.join(', ')}) - refused, secrets never enter a job. The run did not start. Nothing spent.` };
    fresh.push({ row, buf: Buffer.from(got.text, 'utf8') });
  }
  for (const f of fresh) await writeFile(join(tree, f.row.rel), f.buf);
  const add = await git(tree, [...NO_HOOKS, 'add', '-A', '-f']);
  if (!add.ok) return { ok: false, error: `the fresh page copy could not be staged: ${add.err}. The run did not start. Nothing spent.` };
  const commit = await git(tree, [...GIT_IDENTITY, ...NO_HOOKS, 'commit', '-q', '--allow-empty', '-m', 'bareloop: run start - fresh copy of the web inputs']);
  if (!commit.ok) return { ok: false, error: `the fresh page copy could not be committed: ${commit.err}. The run did not start. Nothing spent.` };
  const head = await git(tree, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, error: `git rev-parse HEAD failed in ${tree}: ${head.err}. The run did not start. Nothing spent.` };
  const seed = head.out.trim();
  const byLabel = new Map(fresh.map((f) => [f.row.label, f.buf]));
  const ticketByLabel = new Map(fresh.filter((f) => f.ticket !== undefined).map((f) => [f.row.label, /** @type {import('./ticket.js').Ticket} */ (f.ticket)]));
  const inputs = manifest.inputs.map((/** @type {any} */ r) => {
    const buf = byLabel.get(r.label);
    if (buf === undefined || typeof r.url !== 'string') return r;
    const next = { ...r, draftSha256: r.draftSha256 ?? r.sha256, sha256: sha256Hex(buf) };
    const tk = ticketByLabel.get(r.label);
    if (tk === undefined) return next;
    return { ...next, mcp: tk.record, ticket: { number: tk.number, title: tk.title, state: tk.state, source: tk.source }, masked: tk.masked };
  });
  const files = Array.isArray(manifest.files) ? manifest.files.map((/** @type {any} */ m) => {
    const hit = inputs.find((/** @type {any} */ r) => typeof r.url === 'string' && r.rel === `input/${m.path}`);
    if (!hit) return m;
    const buf = byLabel.get(hit.label);
    return buf === undefined ? m : { ...m, bytes: buf.length, sha256: sha256Hex(buf) };
  }) : manifest.files;
  const next = { ...manifest, inputs, files, seed, refrozenAt: new Date().toISOString() };
  await writeFile(join(resolve(into), 'source.json'), `${JSON.stringify(next, null, 2)}\n`);
  const read1 = fresh.find((f) => f.ticket !== undefined)?.ticket;
  return { ok: true, refreshed: rows.map((/** @type {any} */ r) => r.label), seed, ...(read1 === undefined ? {} : { ticketText: read1.text }) };
}

/**
 * Commit whatever the run start just wrote into the prepared tree as the tree's new seed (S3: the numbered view of a sheet, `src/sheetrun.js`), so a file bareloop made is never read as a worker write.
 * The same plumbing `refreezeUrlInputs` uses: every git call pins the hooks path and the identity.
 * @param {string} tree the prepared tree @param {string} message
 * @returns {Promise<{ok: true, seed: string}|{ok: false, error: string}>}
 */
export async function commitFrozenFiles(tree, message) {
  const add = await git(tree, [...NO_HOOKS, 'add', '-A', '-f']);
  if (!add.ok) return { ok: false, error: `the files written at the run's start could not be staged: ${add.err}` };
  const commit = await git(tree, [...GIT_IDENTITY, ...NO_HOOKS, 'commit', '-q', '--allow-empty', '-m', message]);
  if (!commit.ok) return { ok: false, error: `the files written at the run's start could not be committed: ${commit.err}` };
  const head = await git(tree, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, error: `git rev-parse HEAD failed in ${tree}: ${head.err}` };
  return { ok: true, seed: head.out.trim() };
}

/**
 * PRD v1.106 Part 5 Q2: what `source.json` says about web inputs, read synchronously and never throwing: whether the copy has any web input
 * (`inputs[].url`) and when the run-start refetch last finished (`refrozenAt`, written last by {@link refreezeUrlInputs}). The panel decides
 * "fetching the page..." from this: it applies while a web input exists and no refetch has finished at or after `sinceIso`.
 * @param {string} sourceJsonPath @param {string|null|undefined} sinceIso
 * @returns {{ hasWeb: boolean, fetching: boolean }}
 */
export function webFetchState(sourceJsonPath, sinceIso) {
  try {
    const m = JSON.parse(readFileSync(sourceJsonPath, 'utf8'));
    const hasWeb = Array.isArray(m?.inputs) && m.inputs.some((/** @type {any} */ r) => r && typeof r.url === 'string' && r.url !== '');
    if (!hasWeb) return { hasWeb: false, fetching: false };
    const done = typeof m.refrozenAt === 'string' ? Date.parse(m.refrozenAt) : NaN;
    const since = typeof sinceIso === 'string' ? Date.parse(sinceIso) : NaN;
    return { hasWeb: true, fetching: !(Number.isFinite(done) && (!Number.isFinite(since) || done >= since)) };
  } catch { return { hasWeb: false, fetching: false }; }
}
