// M20 am1 item 2: a run is read through `loadRunContext` (src/panel/data.js). readAudit, readHistory, readHaltRecord and readLog are called only in the
// files below, each with its reason; a tab (Audit, Job, Asks, Stops) or any new reader of a run's books goes through the one loader.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** file (relative to the repo root) -> why it may call the four readers */
const ALLOW = {
  'src/books.js': 'defines them',
  'src/panel/data.js': 'holds loadRunContext, the one loader the Runs list, Run, Audit, Job, Asks tabs and the Stops list read through',
  'src/runner.js': 'the writer of the run\'s books: it reads back its own rows (resume, halt, log of earlier legs)',
  'src/memo.js': 'run-end reader, not a tab: the carry memo is written from the record at a step',
  'src/learnstore.js': 'run-end reader, not a tab: the learnings are read from the finished run\'s books',
  'src/panel/authorflows.js': 'asks only "has this run ended" through endRow (the job card\'s pass count and plan reuse)',
  'src/panel/authortrigger.js': 'asks only "has this run ended" through endRow (the schedule\'s first-green gate)',
  'src/panel/authorstart.js': 'asks only "has this run ended" through endRow (a skipped start is an ended one)',
  'src/panel/server.js': 'asks only "has this run ended" through endRow (the Stop door)',
};
const CALL = /\b(readAudit|readHistory|readHaltRecord|readLog)\(/;

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
/** the files (repo-relative) among `files` that call a run reader and are not allow-listed @param {Record<string,string>} files path -> text */
export function strays(files, allow = ALLOW) {
  return Object.keys(files).filter((f) => !Object.hasOwn(allow, f) && CALL.test(code(files[f])));
}

test('the four run readers are called only in the allow-listed files', () => {
  const files = {};
  for (const f of [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'bin', 'fwdloop')]) files[path.relative(ROOT, f)] = readFileSync(f, 'utf8');
  assert.deepEqual(strays(files), [], 'a run is read through loadRunContext, not by its own readAudit/readHistory/readHaltRecord/readLog');
});

test('the guard can fail: a tab that reads the audit itself is a stray', () => {
  assert.deepEqual(strays({ 'src/panel/newtab.js': 'const rows = readAudit(run.runDir);' }), ['src/panel/newtab.js']);
  assert.deepEqual(strays({ 'src/panel/newtab.js': 'const h = readHistory(flowDir);' }), ['src/panel/newtab.js']);
  assert.deepEqual(strays({ 'src/panel/newtab.js': '// readLog(runDir) in a comment\nconst x = 1;' }), []);
  assert.deepEqual(strays({ 'src/panel/data.js': 'readAudit(runDir)' }), []);
});

/** data.js text with the body of `loadRunContext` cut out: what is left may not call a run reader @param {string} text */
export function dataOutsideLoader(text) {
  const start = text.indexOf('function loadRunContext(');
  const end = text.indexOf('\n}\n', start);
  return text.slice(0, start) + text.slice(end + 3);
}

test('inside src/panel/data.js only loadRunContext reads a run (the tabs and the Stops list do not)', () => {
  const text = readFileSync(path.join(ROOT, 'src', 'panel', 'data.js'), 'utf8');
  assert.ok(text.includes('function loadRunContext('));
  assert.equal(CALL.test(code(dataOutsideLoader(text))), false);
  // can fail: a tab that reads the audit itself, outside the loader
  assert.equal(CALL.test(code(dataOutsideLoader(`${text}\nfunction getRunAudit() { return readAudit(runDir); }\n`))), true);
});
