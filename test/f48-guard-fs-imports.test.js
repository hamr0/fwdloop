// F48 debrief follow-up: the previous guard (test/f48-guard-raw-reads.test.js,
// deleted by this commit) matched a literal regex against each OFFENDING
// LINE's trimmed text. A debrief proved four ways to evade it while still
// reading the filesystem raw: `import { readFileSync as rf } from 'node:fs'`
// (alias — the regex names `readFileSync` literally), a namespace import
// used as `nodefs.readFileSync(...)` or `nodefs['readFileSync'](...)` (the
// regex never sees the literal name at the call site), `readFile` from
// `node:fs/promises` (a name the old regex never listed), and a byte-for-byte
// copy of an ALREADY-allowed line pasted onto a new line in the same file
// (the old check matched by snippet text, not by counting how many times
// that snippet's underlying binding is actually used).
//
// This guard is import-level instead of call-line-level: for every file
// under `src/**/*.js` and `bin/fwdloop`, it finds every way `fs` can be
// reached — static import (named, aliased, default, `* as ns`), dynamic
// `import('...fs...')`, and `require('...fs...')` (however reached, e.g.
// via `createRequire`) — and, for a static import, counts how many times
// EACH imported name is actually used in that file (aliases count under
// their real fs export name; `ns.readFileSync`/`ns['readFileSync']` count
// under `readFileSync` too). A file that reaches fs any way not on the
// allow-list below fails. A file that IS allow-listed but whose per-name
// use count has changed — up (a new call site, including a pasted copy of
// an already-allowed line) or down (a stale entry) — also fails, because
// the allow-list pins an exact count, not just a name.
//
// It also pins every call site of `readArtifact(` in src/runner.js — the
// F48-round-4 collapsing wrapper that is safe to use ONLY where an explicit
// tri-state check already refused any `red` earlier in the same call path
// (see its doc comment in src/runner.js). A new caller of the collapsing
// wrapper must use `readArtifactResult` instead, so a new `readArtifact(`
// call site fails this guard even though it never touches `fs` directly.
//
// Deliberately still a text scan, not a real AST walk (no parser dependency,
// per the dependency-hierarchy rule) — but it scans at the import/binding
// level, not the call-line level, which is what closes the four evasions
// above. `src/flow.js`'s `readFileInside`/`readdirInside` (`resolveInside` +
// the actual read) remain the one mechanism every book reader is expected to
// route through; this guard's job is to catch anything that reaches `fs`
// WITHOUT going through them, or without a narrow, justified, count-pinned
// exemption.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/**
 * Every file this test scans: every `.js` file under `src/` (recursively)
 * plus `bin/fwdloop`. Uses a plain raw `readdirSync`/`readFileSync` itself —
 * this is test infrastructure walking the REPO tree, not a book reader
 * reading a run/flow dir, so it is not part of what it polices.
 */
function listSourceFiles() {
  const files = [];
  const srcRoot = path.join(ROOT, 'src');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(srcRoot);
  const binFwdloop = path.join(ROOT, 'bin', 'fwdloop');
  try {
    if (statSync(binFwdloop).isFile()) files.push(binFwdloop);
  } catch { /* no bin/fwdloop — nothing to add */ }
  return files;
}

function relPath(full) {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

/**
 * Strips `//` and `/* *\/` comments from a JS source text (line/character
 * structure otherwise unchanged, so a `\n` is preserved for every stripped
 * line). String/template literal CONTENTS are left untouched by this one —
 * a bracket-access property name (`ns['readFileSync']`) lives inside a
 * string literal on purpose, so bracket-access scanning needs the string
 * kept intact. Use `stripCommentsAndStrings` below when string contents
 * should be dropped too (identifier-usage counting, where a string or
 * comment merely MENTIONING a name must never count as a use of it).
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inString = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
      if (c === inString) inString = null;
      i += 1;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      inString = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Strips comments (via `stripComments`) AND the CONTENTS of string/template
 * literals (keeping the quotes, now adjacent and empty) from a JS source
 * text. Used for identifier-usage counting, where a string or comment that
 * merely MENTIONS a name must never count as a use of the binding.
 */
function stripCommentsAndStrings(srcIn) {
  const src = stripComments(srcIn);
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Matches `fs`, `node:fs`, `fs/promises`, `node:fs/promises` exactly. */
function isFsSpecifier(spec) {
  return /^(node:)?fs(\/promises)?$/.test(spec);
}

const STATIC_IMPORT_RE = /import\s*(?:\*\s*as\s*(\w+)|\{([^}]*)\}|(\w+))\s*from\s*(['"])([^'"]+)\4\s*;?/gs;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;
const REQUIRE_CALL_RE = /\brequire\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;
// M4c-fix item 22b: ways to reach fs with no import/require token at all.
//   process.binding('fs'), process.getBuiltinModule('fs') (dot or ['bracket']), and any `._load('fs')`
//   (module.constructor._load, Module._load) — each counted under `hiddenFsCount`, never allow-listed.
const HIDDEN_FS_RES = [
  /\bprocess\s*(?:\.\s*|\[\s*['"`])(?:binding|getBuiltinModule)(?:['"`]\s*\])?\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g,
  /(?:\.\s*|\[\s*['"`])_load(?:['"`]\s*\])?\s*\(\s*(['"`])([^'"`]*)\1/g,
];

/**
 * Scans one file's raw source (BEFORE comment/string stripping, since the
 * import specifiers themselves are string literals) for every way it
 * reaches `fs`. Returns `{ names, dynamicImportCount, requireCount }`:
 * `names` maps each real fs export name actually reached to how many times
 * it is used elsewhere in the file (comments/strings excluded, aliases and
 * namespace/default dot-or-bracket access folded under the real name).
 */
function scanFsUsage(text) {
  const names = new Map();
  const bump = (name, by = 1) => names.set(name, (names.get(name) || 0) + by);

  // Remove every static import statement (fs or not) from the body used for
  // counting, so an import line's own mention of a name is never counted as
  // a "use" of it. `bodyForIdents` (comments AND strings stripped) is for
  // plain-identifier counting (named imports, namespace dot-access);
  // `bodyForBrackets` (comments stripped, strings kept) is for bracket
  // access, whose property name deliberately lives inside a string.
  const withoutImports = text.replace(STATIC_IMPORT_RE, '');
  const bodyForIdents = stripCommentsAndStrings(withoutImports);
  const bodyForBrackets = stripComments(withoutImports);

  // `const { readFileSync: r, statSync } = fs` — a destructure of the fs namespace/default binding `fsName`.
  // Each destructured name counts under its REAL fs name, once per use of its local name elsewhere in
  // the file (the destructuring statement itself is cut out first, so it is never counted as a use).
  const countDestructured = (fsName) => {
    const re = new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${fsName}\\s*(?=[;\\n,)]|$)`, 'g');
    const stmts = [...bodyForIdents.matchAll(re)];
    if (!stmts.length) return;
    let rest = bodyForIdents;
    for (const st of stmts) rest = rest.replace(st[0], '');
    for (const st of stmts) {
      for (const raw of st[1].split(',')) {
        const part = raw.trim().replace(/\s*=.*$/s, '');   // drop a default value
        if (!part) continue;
        const colon = part.match(/^(\w+)\s*:\s*(\w+)$/);
        const real = colon ? colon[1] : part;
        const local = colon ? colon[2] : part;
        bump(real, (rest.match(new RegExp(`\\b${local}\\b`, 'g')) || []).length);
      }
    }
  };

  let m;
  STATIC_IMPORT_RE.lastIndex = 0;
  while ((m = STATIC_IMPORT_RE.exec(text))) {
    const [, nsName, namedList, defaultName, , specifier] = m;
    if (!isFsSpecifier(specifier)) continue;

    if (nsName) {
      const dotRe = new RegExp(`\\b${nsName}\\.(\\w+)\\b`, 'g');
      const bracketRe = new RegExp(`\\b${nsName}\\[\\s*(['"])(\\w+)\\1\\s*\\]`, 'g');
      let dm;
      while ((dm = dotRe.exec(bodyForIdents))) bump(dm[1]);
      let bm;
      while ((bm = bracketRe.exec(bodyForBrackets))) bump(bm[2]);
      countDestructured(nsName);
    } else if (defaultName) {
      const dotRe = new RegExp(`\\b${defaultName}\\.(\\w+)\\b`, 'g');
      const bracketRe = new RegExp(`\\b${defaultName}\\[\\s*(['"])(\\w+)\\1\\s*\\]`, 'g');
      let dm;
      while ((dm = dotRe.exec(bodyForIdents))) bump(dm[1]);
      let bm;
      while ((bm = bracketRe.exec(bodyForBrackets))) bump(bm[2]);
      countDestructured(defaultName);
    } else if (namedList) {
      for (const rawSpec of namedList.split(',')) {
        const spec = rawSpec.trim();
        if (!spec) continue;
        const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
        const realName = asMatch ? asMatch[1] : spec;
        const localName = asMatch ? asMatch[2] : spec;
        const useRe = new RegExp(`\\b${localName}\\b`, 'g');
        const count = (bodyForIdents.match(useRe) || []).length;
        bump(realName, count);
      }
    }
  }

  let dynamicImportCount = 0;
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(text))) {
    if (isFsSpecifier(m[2])) dynamicImportCount += 1;
  }

  let requireCount = 0;
  REQUIRE_CALL_RE.lastIndex = 0;
  while ((m = REQUIRE_CALL_RE.exec(text))) {
    if (isFsSpecifier(m[2])) requireCount += 1;
  }

  // `createRequire(...)` hands back a require FUNCTION under whatever local
  // name the caller assigns it — `require(` literally is only one spelling.
  // Find every `const <local> = createRequire(...)` binding, then count
  // calls of THAT local name against an fs specifier too.
  const createRequireBindingRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*createRequire\s*\(/g;
  let cr;
  while ((cr = createRequireBindingRe.exec(bodyForIdents))) {
    const localRequireName = cr[1];
    const aliasCallRe = new RegExp(`\\b${localRequireName}\\s*\\(\\s*(['"\`])([^'"\`]*)\\1\\s*\\)`, 'g');
    let am;
    while ((am = aliasCallRe.exec(bodyForBrackets))) {
      if (isFsSpecifier(am[2])) requireCount += 1;
    }
  }

  let hiddenFsCount = 0;
  const bodyNoComments = stripComments(text);
  for (const re of HIDDEN_FS_RES) {
    re.lastIndex = 0;
    while ((m = re.exec(bodyNoComments))) {
      if (isFsSpecifier(m[2])) hiddenFsCount += 1;
    }
  }

  return { names, dynamicImportCount, requireCount, hiddenFsCount };
}

/**
 * Every file allowed to reach `fs` today, and exactly how. `names` pins
 * the EXACT use count per real fs export name (aliases and namespace/
 * default dot-or-bracket access already folded under the real name by
 * `scanFsUsage`) — a count that moves either direction fails. Classified
 * below (see the task report) as: safe-read implementation (src/flow.js),
 * writes-only books/panel/CLI checks, package-own bundled files, or a
 * documented F48 business-source/gated-read exemption.
 */
const ALLOWLIST = {
  'src/flow.js': {
    reason: 'the safe-read implementation itself (readFileInside/readdirInside/writeFlow/readFlow) — the one gateway every book reader is expected to route through, plus its own symlink-guard checks and atomic-write plumbing',
    names: {
      accessSync: 1, constants: 2, existsSync: 6, lstatSync: 4, mkdirSync: 2,
      readdirSync: 3, readFileSync: 2, realpathSync: 5, renameSync: 1, rmSync: 3,
      writeFileSync: 1,
    },
  },
  'src/runner.js': {
    reason: 'writes/checks for run-dir bookkeeping (mkdir/write/rename/copy/lock create + stale-lock clear + cleanup, M4c amendment 2) plus three documented gated/business reads: hashFile (business source), the frozen-input re-hash (already sha256-pinned at freeze time), and the answer.json read (resolveInside-guarded immediately above); M4e amendment 1: checkSendDestination realpaths/stats the send FOLDER (a business destination, not a book) and the refused folders; the flow-folder test (existsSync of a FLOW_FILES file under the root child)',
    names: {
      accessSync: 1, closeSync: 2, constants: 1, copyFileSync: 1, existsSync: 8,
      mkdirSync: 6, openSync: 1, readFileSync: 3, realpathSync: 5, renameSync: 1,
      statSync: 2, unlinkSync: 3, writeFileSync: 5,
    },
    readArtifactCallSites: 4,
  },
  'src/ask.js': {
    reason: 'ask/answer file lifecycle (mkdir/write/rename for asked/answered/consumed/stale, existsSync checks) plus one documented gated read: the answer.json read is resolveInside-guarded immediately above in the same loop iteration; M4c-fix amendment 1: moving a broken/late answer.json aside as a write-once record (hard link to a free name, then remove the old name — resolveInside-guarded); amendment 1 (b): reopenAsk writes one write-once (wx) reopen record and checks the ask was not already answered',
    names: {
      existsSync: 3, linkSync: 1, mkdirSync: 2, readFileSync: 1, renameSync: 2, unlinkSync: 1, writeFileSync: 4,
    },
  },
  'src/books.js': {
    reason: 'append-only book writer (audit.jsonl/history.jsonl) — writes only, no reads',
    names: { appendFileSync: 1, mkdirSync: 1 },
  },
  'src/liveness.js': {
    reason: 'M4c: /proc reads only (cmdline, stat field 22, a /proc existence probe) plus lstatSync mtime of the run\'s own book files for the 10-minute fallback (presence/mtime only, content never read, symlinks not followed) — pids.jsonl itself is read via books.js readPidRows (readFileInside); M4c amendment 2: resume.lock — lstat (a symlinked lock reads as empty, never followed), one read of its holder JSON, and writeSync of that holder into the fd resumeRun just created with wx',
    names: { lstatSync: 2, readFileSync: 4, writeSync: 1 },
  },
  'src/config.js': {
    reason: 'M4d: the ONE reader/writer of the per-person config.json (~/.config/fwdloop), a regular file OUTSIDE any run/flow dir, not a book. One read (ENOENT = nothing set); the atomic write is mkdir + tmp write + chmod 0600 + rename. Never follows into a run dir.',
    names: {
      chmodSync: 1, mkdirSync: 1, readFileSync: 1, renameSync: 1, writeFileSync: 1,
    },
  },
  'src/keysfile.js': {
    reason: 'M4d: the ONE reader of the per-person keys file (~/.config/fwdloop/.env), a regular file OUTSIDE any run/flow dir, not a book. One open + fstat on the SAME fd (mode check, regular-file check, no TOCTOU) + one read of that fd; creates the dir/file (wx, 0600) when missing. Never follows into a run dir.',
    names: {
      closeSync: 1, fstatSync: 1, mkdirSync: 1, openSync: 2, readFileSync: 1, writeFileSync: 1,
    },
  },
  'src/monthly.js': {
    reason: 'M4d piece 3: the ONE writer/reader of the per-person runs.jsonl (~/.config/fwdloop), a regular file OUTSIDE any run/flow dir, not a book: one append (0600, dir 0700), one read of that file, and realpathSync to record a run dir by its real path (longest existing prefix). Every run/draft dir\'s own spend.jsonl is read through readSpendRows (readFileInside), never fs directly.',
    names: {
      appendFileSync: 1, mkdirSync: 1, readFileSync: 1, realpathSync: 1,
    },
  },
  'src/provider.js': {
    reason: 'append-only spend-log writer — writes only, no reads',
    names: { appendFileSync: 1, mkdirSync: 1 },
  },
  'src/send.js': {
    reason: 'the write itself goes through bare-agent\'s shell_write tool, never a raw fs write (see the borrowed-from note) — this reads back the bytes ACTUALLY on disk after that write, to prove it landed (M2 "happened" re-read), not a run/flow-dir book read; M4e amendment 1: one lstat of the destination file name (presence only, nothing read, symlinks not followed) so a send never overwrites',
    names: { readFileSync: 1, lstatSync: 1 },
  },
  'src/docx.js': {
    reason: 'reads a caller-supplied BUSINESS document path (e.g. resume.docx), not a run/flow-dir book file — documented F48 exemption',
    names: { readFileSync: 1 },
  },
  'src/input-facts.js': {
    reason: 'M6a: reads a caller-signed BUSINESS source file (markdown headings) at draft time, $0 — not a run/flow-dir book file; documented F48 exemption like src/docx.js',
    names: { readFileSync: 1 },
  },
  'src/authoring.js': {
    reason: 'M6a: `fwdloop draft`/`sign` — creates the NEW draft dir and writes its files (writes only; rmdirSync removes only the just-claimed EMPTY dir on a $0 pre-flight refusal), reads the caller-named prose file (a business input, not a book), and existsSync checks on the dir/input sources. Every read of a draft dir\'s own files goes through readFileInside/readdirInside (src/flow.js).',
    names: {
      existsSync: 2, mkdirSync: 2, readFileSync: 1, realpathSync: 1, rmdirSync: 1, writeFileSync: 3,
    },
  },
  'src/primitives.js': {
    reason: 'documented frozen-input reader exemption (F48): reads a frozen input file already sha256-pinned at freeze time, not a relative book-file name under runDir. mkdirSync creates `<runDir>/out` (the write primitive\'s own bareguard-scoped root) ONLY when a step is actually granted `write` — never a raw read/write of run/flow-dir book content.',
    names: { readFileSync: 1, mkdirSync: 1 },
  },
  'src/catalogue.js': {
    reason: 'the package\'s own bundled catalogue.json next to the source file — a self/package file, not user- or run-dir content',
    names: { readFileSync: 1 },
  },
  'src/panel/server.js': {
    reason: 'the panel\'s own bundled index.html next to the source file — a self/package file, not run/flow-dir content; plus M4c-fix item 5: `cleanPaths` realpaths --root to show paths relative to it in error bodies; plus hamr 1A: `loadOrMakeToken` lstats and reads the panel\'s own token file/dir to reuse the token; plus M4c-fix item 2: `writeTokenFile` makes the panel\'s own token dir (0700, lstat-checked) and file (0600) under $XDG_RUNTIME_DIR or ~/.cache — outside the flows root and every run dir',
    names: {
      chmodSync: 1, closeSync: 1, lstatSync: 3, mkdirSync: 1, openSync: 1, readFileSync: 2, realpathSync: 1, unlinkSync: 1, writeSync: 1,
    },
  },
  'src/panel/data.js': {
    reason: 'read-only checks (existsSync/realpathSync symlink guards) — actual book content is read via the imported readFlow/readAudit/readHistory/readAsk/etc. helpers, never fs directly',
    names: { existsSync: 6, realpathSync: 2 },
  },
  'src/panel/resume.js': {
    reason: 'M4b piece 2: the panel\'s resume launcher — creates/opens its OWN private log dir and log file (outside the flows root and every run dir), reads back that log to quote the resume\'s refusal, deletes that log when the resume exits 0 (and a stale attempt log when a newer attempt starts), and existsSync-checks the `answer.<askId>.consumed.json` marker (presence only, never its content) to see that the resume took over. No run/flow-dir book is read or written.',
    names: {
      existsSync: 2, lstatSync: 1, mkdirSync: 1, readFileSync: 1, statSync: 1, unlinkSync: 2,
    },
  },
  'src/panel/spawn.js': {
    reason: 'M4e piece 2a: the ONE detached spawn the panel uses for its CLI children (resume, draft) — opens (creates 0600, appends) the child\'s own log file and closes the fd after the spawn. The log sits in a panel-owned folder (resume: the private log dir; draft: the draft folder), never a run/flow-dir book. No content is read.',
    names: { closeSync: 1, openSync: 1 },
  },
  'src/panel/lock.js': {
    reason: 'M4c-fix amendment 2 (h): the human\'s "Remove the old lock" — realpaths the run dir and --root at use time (the lock must sit inside this run, inside root), then unlinks the one `resume.lock` file, and only when `readResumeLock` (the one lock reader) says it has no recorded holder. No book content is read.',
    names: { realpathSync: 3, unlinkSync: 1 },
  },
  'bin/fwdloop': {
    reason: 'CLI existence checks (source/run-dir presence) plus the one realpathSync in resolveRoot (hamr ruling 2026-09-29: the typed --root is followed once at start) — no content reads',
    names: { existsSync: 3, realpathSync: 1 },
  },
};

/**
 * Counts call sites of the collapsing wrapper `readArtifact(` in
 * src/runner.js, EXCLUDING its own declaration line
 * (`function readArtifact(`) — comments/strings stripped first so a doc
 * comment mentioning the name is never counted as a call site.
 */
function countReadArtifactCallSites(text) {
  const body = stripCommentsAndStrings(text);
  const total = (body.match(/\breadArtifact\(/g) || []).length;
  const declarations = (body.match(/\bfunction\s+readArtifact\(/g) || []).length;
  return total - declarations;
}

test('F48 guard: every way src/ and bin/fwdloop reach fs is on the narrow, count-pinned allow-list', () => {
  const problems = [];
  const matchedFiles = new Set();

  for (const full of listSourceFiles()) {
    const file = relPath(full);
    const text = readFileSync(full, 'utf8');
    const { names, dynamicImportCount, requireCount, hiddenFsCount } = scanFsUsage(text);
    const touchesFs = names.size > 0 || dynamicImportCount > 0 || requireCount > 0 || hiddenFsCount > 0;
    if (!touchesFs) continue;

    const allowed = ALLOWLIST[file];
    if (!allowed) {
      problems.push(`${file}: reaches fs (${[...names.keys()].join(', ') || 'dynamic import/require'}) but is not on the allow-list at all`);
      continue;
    }
    matchedFiles.add(file);

    if (dynamicImportCount > 0) {
      problems.push(`${file}: dynamic import('...fs...') found (${dynamicImportCount}×) — not allow-listed for any file`);
    }
    if (hiddenFsCount > 0) {
      problems.push(`${file}: process.binding/getBuiltinModule/_load of fs found (${hiddenFsCount}×) — not allow-listed for any file`);
    }
    if (requireCount > 0) {
      problems.push(`${file}: require('...fs...') found (${requireCount}×) — not allow-listed for any file`);
    }

    for (const [name, count] of names) {
      const allowedCount = allowed.names[name];
      if (allowedCount === undefined) {
        problems.push(`${file}: uses fs name "${name}" (${count}×) — not in this file's allow-list entry`);
      } else if (allowedCount !== count) {
        problems.push(`${file}: fs name "${name}" used ${count}× but allow-list pins ${allowedCount}× — update the allow-list only if this is a reviewed, intentional change`);
      }
    }
    for (const [name, allowedCount] of Object.entries(allowed.names)) {
      if (!names.has(name) && allowedCount > 0) {
        problems.push(`${file}: allow-list pins "${name}" at ${allowedCount}× but it is no longer used — stale entry, remove it`);
      }
    }
  }

  // Stale whole-file entries: a file the allow-list still names but that no
  // longer touches fs at all.
  for (const file of Object.keys(ALLOWLIST)) {
    if (!matchedFiles.has(file)) {
      problems.push(`${file}: allow-listed but no longer reaches fs at all — stale entry, remove it`);
    }
  }

  // Pin readArtifact( call sites in src/runner.js (F48 round 4): a new
  // caller of the collapsing wrapper must use readArtifactResult instead.
  const runnerFull = path.join(ROOT, 'src', 'runner.js');
  const runnerText = readFileSync(runnerFull, 'utf8');
  const actualCallSites = countReadArtifactCallSites(runnerText);
  const pinnedCallSites = ALLOWLIST['src/runner.js'].readArtifactCallSites;
  if (actualCallSites !== pinnedCallSites) {
    problems.push(`src/runner.js: readArtifact( has ${actualCallSites} call site(s) but the allow-list pins ${pinnedCallSites} — a new call site must use readArtifactResult instead (already gated by the resume done? gate is the only reason the existing ${pinnedCallSites} are allowed)`);
  }

  assert.deepEqual(
    problems,
    [],
    `fs-import guard violation(s):\n${problems.join('\n')}`,
  );
});

// M4c-fix item 22b: each new detection is proven on a planted source string (never by editing src/).
// A control with no fs at all must stay clean, so the scanner cannot "detect" everything.
const flagged = (u) => u.names.size > 0 || u.dynamicImportCount > 0 || u.requireCount > 0 || u.hiddenFsCount > 0;

test('F48 guard: planted evasions are each detected; a clean file is not', () => {
  const clean = scanFsUsage("import path from 'node:path';\nconst { join: j } = path;\nj('a');\n");
  assert.equal(flagged(clean), false, 'control: destructuring path is not fs');

  const destructured = scanFsUsage("import fs from 'node:fs';\nconst { readFileSync: r, statSync } = fs;\nr(p); statSync(p);\n");
  assert.deepEqual([...destructured.names], [['readFileSync', 1], ['statSync', 1]], 'destructured fs, aliased and plain');

  const unusedDestructure = scanFsUsage("import * as nodefs from 'node:fs';\nconst { rmSync } = nodefs;\n");
  assert.ok(unusedDestructure.names.has('rmSync'), 'a destructure with no later use is still flagged');

  for (const [label, line] of [
    ["process.binding('fs')", "const b = process.binding('fs');"],
    ["process.getBuiltinModule('fs')", "const f = process.getBuiltinModule('fs');"],
    ["process.getBuiltinModule('node:fs/promises')", "const f = process.getBuiltinModule('node:fs/promises');"],
    ["process['getBuiltinModule']('fs')", "const f = process['getBuiltinModule']('fs');"],
    ["module.constructor._load('fs')", "const f = module.constructor._load('fs');"],
  ]) {
    const u = scanFsUsage(`${line}\n`);
    assert.equal(u.hiddenFsCount, 1, `${label} is detected`);
    assert.equal(flagged(u), true);
  }
  assert.equal(scanFsUsage("const p = process.getBuiltinModule('path');\n").hiddenFsCount, 0, 'control: a non-fs builtin is not flagged');
  assert.equal(scanFsUsage("// process.binding('fs') in a comment\n").hiddenFsCount, 0, 'control: a comment is not code');
});
