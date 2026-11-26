// M20 am3 item 13: each owner named in am3 has a guard that fails when a second reader of its file or fact appears outside its allow-list.
// One file, one `strays` per owner; each allow-list entry carries its reason. Batch 1: items 11, 7, 9, 2, 1, 3.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.js') || n.endsWith('.mjs')) out.push(p);
  }
  return out;
}
export const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
/** src-relative path -> text, plus bin/fwdloop as 'bin/fwdloop' */
export function load() {
  const files = {};
  for (const f of walk(SRC)) files[path.relative(SRC, f)] = readFileSync(f, 'utf8');
  files['bin/fwdloop'] = readFileSync(path.join(ROOT, 'bin', 'fwdloop'), 'utf8');
  return files;
}
/** files that match `re` in code and are not on the allow-list @param {Record<string,string>} files @param {RegExp} re @param {Record<string,string>} allow */
export const strays = (files, re, allow) => Object.keys(files).filter((f) => !Object.hasOwn(allow, f) && re.test(code(files[f])));

// item 11: audit.jsonl and state.json are read by one reader each (readAudit, readRunState, both with a named strict mode); halt.<n>.consumed.json is named in one place
const AUDIT = { 'books.js': 'readAudit: the one reader and the appender', 'liveness.js': 'BOOK_FILES: a name in a list whose mtime says the run is alive; reads nothing' };
const STATE = {
  'books.js': 'readRunState: the one reader',
  'liveness.js': 'BOOK_FILES: mtime only; reads nothing',
  'runner.js': 'the parked-state writer (park) and the set-aside rename on stop; neither reads',
};
const HALT_CONSUMED = { 'books.js': 'haltConsumedCount / nextHaltConsumedName: the one place the name is spelled' };

test('item 11: only the listed files name audit.jsonl, state.json, halt.<n>.consumed.json in code', () => {
  const files = load();
  assert.deepEqual(strays(files, /['"`]audit\.jsonl['"`]/, AUDIT), []);
  assert.deepEqual(strays(files, /['"`]state\.json['"`]/, STATE), []);
  assert.deepEqual(strays(files, /halt\\\.\\d|halt\.\$\{[^}]*\}\.consumed/, HALT_CONSUMED), []);
});

// item 7: a run's trigger.json is read by readTriggerRecord (src/books.js) only
const TRIGGER = {
  'trigger-line.js': 'declares the file name',
  'books.js': 'readTriggerRecord: the one reader',
  'panel/authorstart.js': 'the one writer (the start claim, flag wx)',
  'runvalues.js': 'a name in the "folder holds no run yet" list; reads nothing',
  'bin/fwdloop': 'a name in the "folder holds no run yet" list; reads nothing',
};
test('item 7: only the listed files name trigger.json in code', () => {
  assert.deepEqual(strays(load(), /TRIGGER_RECORD_FILE|['"`]trigger\.json['"`]/, TRIGGER), []);
});

// item 9: a run's run.json and diary.jsonl are read through readRunRecord (runfile.js) and the diary readers (diary.js) only
const RUN_DIARY = {
  'runfile.js': 'the run.json writer and readRunRecord, its one reader',
  'diary.js': 'the diary writer and readKind, its one reader',
  'panel/authorflows.js': 'the file\'s mtime only (lstat to order runs); content goes through readRunInputs',
  'mcp-use.js': 'the file\'s mtime only (statSync after readRunRecord accepted it); content goes through readRunRecord and readTools',
};
test('item 9: only the listed files name run.json or diary.jsonl in code', () => {
  assert.deepEqual(strays(load(), /['"`]run\.json['"`]|['"`]diary\.jsonl['"`]|\bRUN_FILE\b|\bDIARY_FILE\b/, RUN_DIARY), []);
});

// item 2: a run's job/ copy (prose.txt, declaration.json, signature.json) is read only inside src/flow.js, through readRunJobCopy (the copier and planForReuse live there too)
const JOB_COPY = { 'flow.js': 'readRunJobCopy: the one reader; writeRunJobCopy / copyRunPlan write and copy it; planForReuse is its caller' };
test('item 2: only src/flow.js names a run\'s job/ files in code', () => {
  assert.deepEqual(strays(load(), /job\/(prose\.txt|declaration\.json|signature\.json)|\bRUN_JOB_DIR\b/, JOB_COPY), []);
});
