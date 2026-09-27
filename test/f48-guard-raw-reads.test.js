// F48 round 3 debrief follow-up: "every book reader goes through the safe
// read" was a promise (a code comment on each converted reader) — this test
// makes it a mechanical check instead. It scans every `src/**/*.js` file and
// `bin/fwdloop` for a raw `readFileSync(`/`readdirSync(`/`createReadStream(`/
// `openSync(` call and fails unless that EXACT call site (matched by its
// trimmed line text, not just its file) is on the allow-list below, each
// entry carrying a one-line reason. A brand new raw read added anywhere in
// an allow-listed file — even one that already has an allowed call site on a
// different line — still fails, because the new line's text won't match any
// allow-list entry.
//
// This is deliberately a text scan, not an AST walk: `src/flow.js`'s own
// `readFileInside`/`readdirInside` (`resolveInside` + the actual read) are
// the ONE mechanism every book reader is expected to route through — this
// test's job is to catch anything that reads a run-dir/flow-dir file WITHOUT
// going through them, not to re-implement them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const RAW_CALL_RE = /\b(readFileSync|readdirSync|createReadStream|openSync)\s*\(/;

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
 * Every raw call site currently allowed to exist, past the safe-read
 * mechanism. Each entry is `{ file, snippet, reason }`: `file` is the
 * project-relative path (as `relPath` prints it), `snippet` is matched
 * against the OFFENDING LINE's trimmed text with `.includes` — narrow
 * enough that a different raw call added on a different line in the same
 * file will not accidentally match it.
 */
const ALLOWLIST = [
  {
    file: 'src/flow.js',
    snippet: "return { ok: true, text: readFileSync(resolved.full, 'utf8') };",
    reason: 'this IS the safe-read implementation (readFileInside) — the one gateway every book reader routes through',
  },
  {
    file: 'src/flow.js',
    snippet: 'entries = readdirSync(resolved.full, { withFileTypes: true });',
    reason: 'this IS the safe-read implementation (readdirInside) — the one gateway every directory listing routes through',
  },
  {
    file: 'src/flow.js',
    snippet: "entries = readdirSync(root, { withFileTypes: true });",
    reason: 'listFlowNames: best-effort top-level NAME enumeration under --root (not book content) — a caller that wants a flow validated calls readFlow, which IS symlink-guarded',
  },
  {
    file: 'src/flow.js',
    snippet: 'entries = readdirSync(runsDir, { withFileTypes: true });',
    reason: 'listRunIds: best-effort top-level runId NAME enumeration under a flow\'s runs/ (not book content) — resolveRunDir is the checked path once a caller acts on a name',
  },
  {
    file: 'src/flow.js',
    snippet: "text = readFileSync(filePath, 'utf8');",
    reason: 'readTextFile: readFlow\'s own reader for prose.txt/declaration.json/signature.json — the file itself is symlink-checked (lstatSync) two lines above, and readFlow separately refuses if the flow directory itself is a symlink (F48 round 2); not a run-dir book reader',
  },
  {
    file: 'src/runner.js',
    snippet: "return createHash('sha256').update(readFileSync(path)).digest('hex');",
    reason: 'hashFile: hashes a caller-supplied BUSINESS source path (e.g. resume.docx) at freeze time, not a run/flow-dir book file',
  },
  {
    file: 'src/runner.js',
    snippet: "lockFd = openSync(lockPath, 'wx');",
    reason: 'resume.lock creation, exclusive-create only — not a content read, and \'wx\' refuses to open over an existing entry of any kind (including a symlink)',
  },
  {
    file: 'src/runner.js',
    snippet: "const sha256 = createHash('sha256').update(readFileSync(entry.frozen)).digest('hex');",
    reason: 'resumeRun\'s frozen-input re-hash: reads a frozen input file already sha256-pinned at freeze time (same documented exemption as src/primitives.js\'s frozen-input reader), not a relative book-file name under runDir',
  },
  {
    file: 'src/runner.js',
    snippet: "answer = JSON.parse(readFileSync(answerPath, 'utf8'));",
    reason: 'resumeRun\'s answer.json read: guarded immediately above by resolveInside(runDir, \'answer.json\') — a symlink or escaping ancestor is refused before this line ever runs',
  },
  {
    file: 'src/docx.js',
    snippet: 'buf = readFileSync(path);',
    reason: 'reads a caller-supplied BUSINESS document path (e.g. resume.docx), not a run/flow-dir book file',
  },
  {
    file: 'src/catalogue.js',
    snippet: "text = readFileSync(new URL('./catalogue.json', import.meta.url), 'utf8');",
    reason: 'the package\'s own bundled catalogue.json next to the source file — a self/package file, not user- or run-dir content',
  },
  {
    file: 'src/ask.js',
    snippet: "try { raw = readFileSync(answerPath, 'utf8'); } catch { raw = null; }",
    reason: 'the parking ask loop\'s answer.json read: guarded immediately above by resolveInside(runDir, \'answer.json\') in the same loop iteration — a symlink or escaping ancestor is refused (treated as no-answer-yet) before this line ever runs',
  },
  {
    file: 'src/primitives.js',
    snippet: "const text = readFileSync(frozen, 'utf8');",
    reason: 'documented frozen-input reader exemption (F48): reads a frozen input file already sha256-pinned at freeze time, not a relative book-file name under runDir',
  },
  {
    file: 'src/panel/server.js',
    snippet: "html = readFileSync(indexPath, 'utf8');",
    reason: 'the panel\'s own bundled index.html next to the source file — a self/package file, not run/flow-dir content',
  },
  {
    file: 'src/send.js',
    snippet: 'const bytes = readFileSync(path);',
    reason: 'reads back the bytes send just wrote itself, to prove the write actually landed (M2\'s "happened" re-read) — not a run/flow-dir book read',
  },
];

test('F48 guard: every raw readFileSync/readdirSync/createReadStream/openSync call in src/ and bin/fwdloop is on the narrow allow-list', () => {
  const offenders = [];
  const matchedAllowlistIdx = new Set();

  for (const full of listSourceFiles()) {
    const file = relPath(full);
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((rawLine, i) => {
      if (!RAW_CALL_RE.test(rawLine)) return;
      const lineText = rawLine.trim();
      const allowIdx = ALLOWLIST.findIndex(
        (entry) => entry.file === file && lineText.includes(entry.snippet),
      );
      if (allowIdx === -1) {
        offenders.push(`${file}:${i + 1}: ${lineText}`);
      } else {
        matchedAllowlistIdx.add(allowIdx);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `raw read call(s) outside the F48 safe-read allow-list — either route through readFileInside/readdirInside (src/flow.js) or add a narrow, justified allow-list entry:\n${offenders.join('\n')}`,
  );

  // Keep the allow-list itself honest: an entry that matches nothing any
  // more (the call site was removed or its text changed) must be deleted,
  // not left as unused permission.
  const stale = ALLOWLIST.map((entry, idx) => ({ entry, idx })).filter(({ idx }) => !matchedAllowlistIdx.has(idx));
  assert.deepEqual(
    stale.map(({ entry }) => `${entry.file}: "${entry.snippet}"`),
    [],
    'stale allow-list entries (no longer match any real call site) — remove them',
  );
});
