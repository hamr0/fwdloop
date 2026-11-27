// M20 am1 item 4: a draft's `log.json` is read only by `readDraftLog` (src/flow.js); a run's `log.json` only by `readLog` (src/books.js). Four draft readers
// (src/panel/spawn.js as used in src/panel/author.js, src/planrebuild.js, src/setup.js, src/authoring.js) became one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDraftLog } from '../src/flow.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** file (relative to src) -> why it names `log.json` */
const NAMES = {
  'books.js': 'readLog: the run\'s log.json, its one reader',
  'flow.js': 'readDraftLog: the draft\'s log.json, its one reader',
  'runner.js': 'writeLog: the run\'s log.json writer',
  'authoring.js': 'the draft\'s log.json writer (the CLI draft)',
  'planrebuild.js': 'the draft\'s log.json writer (the $0 rebuild)',
  'panel/data.js': 'screen words only ("log.json is missing"); reads nothing here',
  'liveness.js': 'BOOK_FILES: a name in a list of files whose mtime says the run is alive; reads nothing',
};

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
/** files among `files` (src-relative path -> text) that name `log.json` in code and are not listed @param {Record<string,string>} files */
export const strays = (files, allow = NAMES) => Object.keys(files).filter((f) => !Object.hasOwn(allow, f) && /log\.json/.test(code(files[f])));

test('only the listed files name log.json in code (every other reader goes through readLog or readDraftLog)', () => {
  const files = {};
  for (const f of walk(SRC)) files[path.relative(SRC, f)] = readFileSync(f, 'utf8');
  assert.deepEqual(strays(files), []);
});

test('the guard can fail: a new reader of log.json is a stray', () => {
  assert.deepEqual(strays({ 'panel/newtab.js': "const r = readFileInside(dir, 'log.json');" }), ['panel/newtab.js']);
  assert.deepEqual(strays({ 'panel/newtab.js': "// log.json only in a comment\nconst x = 1;" }), []);
});

test('readDraftLog: an object reads, with or without a plan folder; missing, torn, an array and a symlink out read as null', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-m20a1-dlog-'));
  const out = mkdtempSync(path.join(tmpdir(), 'fwdloop-m20a1-dlog-out-'));
  try {
    assert.equal(readDraftLog(d), null, 'missing');
    writeFileSync(path.join(d, 'log.json'), JSON.stringify({ ok: true, action: 'draft' }));
    assert.deepEqual(readDraftLog(d), { ok: true, action: 'draft' });
    mkdirSync(path.join(d, 'draft-2'));
    writeFileSync(path.join(d, 'draft-2', 'log.json'), '{"checkCard":{"notChecked":[]}}');
    assert.deepEqual(readDraftLog(d, 'draft-2'), { checkCard: { notChecked: [] } });
    writeFileSync(path.join(d, 'draft-2', 'log.json'), '{ torn');
    assert.equal(readDraftLog(d, 'draft-2'), null, 'torn');
    writeFileSync(path.join(d, 'draft-2', 'log.json'), '[1,2]');
    assert.equal(readDraftLog(d, 'draft-2'), null, 'an array is not a log');
    writeFileSync(path.join(out, 'secret.json'), '{"leak":true}');
    mkdirSync(path.join(d, 'draft-3'));
    symlinkSync(path.join(out, 'secret.json'), path.join(d, 'draft-3', 'log.json'));
    assert.equal(readDraftLog(d, 'draft-3'), null, 'a symlinked log.json never reads the outside content');
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
