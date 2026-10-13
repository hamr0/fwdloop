// M9 piece 2 (docs/wiki/the-module-ladder.md, "M9" item 6, amendment 2 item 2): the file triggers.
// $0, no network, no sleeps: poll() is driven by hand, and mtimes are set explicitly so filesystem
// timestamp granularity cannot make a case flake.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import {
  writeFileSync, appendFileSync, mkdirSync, symlinkSync, unlinkSync, utimesSync, readFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createFileTrigger, readSeen, STABLE_POLLS } from '../src/trigger-files.js';

const root = () => mkdtempSync(path.join(tmpdir(), 'm9files-'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
/** @returns {{dir:string, ledger:string, base:string}} */
function setup() {
  const base = root(); const dir = path.join(base, 'inbox'); mkdirSync(dir);
  return { base, dir, ledger: path.join(base, 'seen.jsonl') };
}
/** Poll until a take or `n` polls; returns every taken item. */
function pollN(w, n = STABLE_POLLS + 2) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...w.poll().run);
  return out;
}
let mt = 1_700_000_000;
const stamp = (p) => { mt += 10; utimesSync(p, mt, mt); };

test('stable for 2 consecutive polls: taken at the poll where size AND mtime match twice in a row', () => {
  assert.equal(STABLE_POLLS, 2);
  const { dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  const f = path.join(dir, 'a.csv'); writeFileSync(f, 'x,1\n'); stamp(f);
  assert.equal(w.poll().run.length, 0, 'first sight');
  assert.equal(w.poll().run.length, 0, 'one match');
  const r = w.poll().run;
  assert.equal(r.length, 1, 'two matches');
  assert.equal(r[0].sha, sha('x,1\n'));
  assert.equal(r[0].size, 4);
  assert.equal(path.basename(r[0].path), 'a.csv');
  assert.equal(pollN(w).length, 0, 'never re-taken');
});

test('a file still being written is not taken until it stops changing', () => {
  const { dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  const f = path.join(dir, 'big.csv'); writeFileSync(f, 'chunk0\n');
  const taken = [];
  for (let i = 1; i <= 8; i++) { // grows between EVERY poll
    appendFileSync(f, `chunk${i}\n`); stamp(f);
    taken.push(...w.poll().run); taken.push(...w.poll().run); // two polls on the same state is still only 1 match
    appendFileSync(f, 'more\n'); stamp(f);
  }
  assert.equal(taken.length, 0, 'growing file never taken');
  stamp(f);
  const done = pollN(w);
  assert.equal(done.length, 1);
  assert.equal(done[0].sha, sha(readFileSync(f)));
  assert.equal(done[0].size, readFileSync(f).length, 'whole file, not a prefix');
});

test('same size but new mtime counts as changing (in-place rewrite)', () => {
  const { dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  const f = path.join(dir, 'a.csv'); writeFileSync(f, 'aaaa'); stamp(f);
  w.poll(); w.poll();
  writeFileSync(f, 'bbbb'); stamp(f); // same size, different mtime, one poll before it would be taken
  assert.equal(w.poll().run.length, 0, 'counter restarted');
  assert.equal(w.poll().run.length, 0);
  const r = w.poll().run;
  assert.equal(r.length, 1);
  assert.equal(r[0].sha, sha('bbbb'));
});

test('same file dropped twice runs once (same name, and another name)', () => {
  const { dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  const x = path.join(dir, 'X.csv');
  writeFileSync(x, 'invoice,100\n');
  assert.equal(pollN(w).length, 1);
  writeFileSync(path.join(dir, 'X-copy.csv'), 'invoice,100\n');
  assert.equal(pollN(w).length, 0, 'same content, other name');
  unlinkSync(x); writeFileSync(x, 'invoice,100\n'); stamp(x);
  assert.equal(pollN(w).length, 0, 're-dropped under the same name');
  writeFileSync(path.join(dir, 'Y.csv'), 'invoice,200\n');
  const y = pollN(w);
  assert.deepEqual(y.map((r) => path.basename(r.path)), ['Y.csv'], 'a different file still runs');
});

test('never twice across restart: a fresh trigger on the same ledger rereads it', () => {
  const { dir, ledger } = setup();
  let w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  writeFileSync(path.join(dir, 'X.csv'), 'invoice,100\n');
  assert.equal(pollN(w).length, 1);
  w = createFileTrigger({ mode: 'new', target: dir, ledger }); // restart: no process state
  const x = path.join(dir, 'X.csv'); unlinkSync(x); writeFileSync(x, 'invoice,100\n');
  writeFileSync(path.join(dir, 'again.csv'), 'invoice,100\n');
  assert.equal(pollN(w, 8).length, 0);
  assert.equal(readSeen(ledger).filter((r) => r.sha === sha('invoice,100\n')).length, 1, 'one row per sha');
});

test('row is written BEFORE the run is handed out (crash loses a run, never doubles one)', () => {
  const { dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  writeFileSync(path.join(dir, 'X.csv'), 'q\n');
  w.poll(); w.poll();
  const r = w.poll().run;
  assert.equal(r.length, 1);
  assert.ok(readSeen(ledger).some((x) => x.sha === r[0].sha && x.kind === 'ran'), 'already on disk when poll returned');
  // simulate: the caller crashed before starting the run; a restart must not hand it out again
  const w2 = createFileTrigger({ mode: 'new', target: dir, ledger });
  assert.equal(pollN(w2, 8).length, 0);
});

test('a folder holding 3 files at arm: no run (am2 item 2)', () => {
  const { dir, ledger } = setup();
  for (const n of ['a.csv', 'b.csv', 'c.csv']) writeFileSync(path.join(dir, n), `${n}\n`);
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  assert.equal(pollN(w, 10).length, 0);
  assert.equal(readSeen(ledger).filter((r) => r.kind === 'baseline').length, 3);
  writeFileSync(path.join(dir, 'd.csv'), 'd\n');
  assert.deepEqual(pollN(w).map((r) => path.basename(r.path)), ['d.csv'], 'only a new file runs');
});

test('file-updated: the current version does not run; a change after arming does; touch/same content does not', () => {
  const { base, ledger } = setup();
  const f = path.join(base, 'invoices.xlsx'); writeFileSync(f, 'v1'); stamp(f);
  const w = createFileTrigger({ mode: 'updated', target: f, ledger }); w.arm();
  assert.equal(pollN(w, 8).length, 0, 'current version is the baseline');
  writeFileSync(f, 'version two'); stamp(f);
  const r = pollN(w);
  assert.equal(r.length, 1);
  assert.equal(r[0].sha, sha('version two'));
  stamp(f); // touch only
  assert.equal(pollN(w).length, 0, 'mtime moved, sha same');
  writeFileSync(f, 'v1'); stamp(f);
  assert.equal(pollN(w).length, 0, 'back to a sha that already ran/baselined');
  writeFileSync(f, 'v3'); stamp(f);
  assert.equal(pollN(w).length, 1);
});

test('file-updated: file missing at arm, then created, is a change and runs', () => {
  const { base, ledger } = setup();
  const f = path.join(base, 'later.csv');
  const w = createFileTrigger({ mode: 'updated', target: f, ledger }); w.arm();
  assert.equal(pollN(w).length, 0, 'absent is quiet, not an error');
  writeFileSync(f, 'hello'); stamp(f);
  assert.equal(pollN(w).length, 1);
});

test('new-file: top level, regular files only; subfolders and symlinks are not taken', () => {
  const { base, dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  mkdirSync(path.join(dir, 'sub')); writeFileSync(path.join(dir, 'sub', 'deep.csv'), 'deep\n');
  const outside = path.join(base, 'secret.txt'); writeFileSync(outside, 'secret\n');
  symlinkSync(outside, path.join(dir, 'link.txt'));
  symlinkSync(path.join(base), path.join(dir, 'dirlink'));
  writeFileSync(path.join(dir, 'ok.csv'), 'ok\n');
  const out = [];
  for (let i = 0; i < 8; i++) out.push(...w.poll().run);
  assert.deepEqual(out.map((r) => path.basename(r.path)), ['ok.csv']);
});

test('refused symlinks are reported by name, once', () => {
  const { base, dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  const outside = path.join(base, 'secret.txt'); writeFileSync(outside, 's\n');
  symlinkSync(outside, path.join(dir, 'link.txt'));
  const first = w.poll();
  assert.equal(first.refused.length, 1);
  assert.match(first.refused[0].why, /symlink/);
  assert.equal(path.basename(first.refused[0].path), 'link.txt');
  assert.equal(w.poll().refused.length, 0, 'said once');
});

test('file-updated refuses a symlink target', () => {
  const { base, ledger } = setup();
  const real = path.join(base, 'real.csv'); writeFileSync(real, 'a');
  const link = path.join(base, 'link.csv'); symlinkSync(real, link);
  const w = createFileTrigger({ mode: 'updated', target: link, ledger });
  assert.throws(() => w.arm(), /symlink/);
  const w2 = createFileTrigger({ mode: 'updated', target: link, ledger });
  const r = w2.poll();
  assert.equal(r.run.length, 0);
  assert.match(r.refused[0].why, /symlink/);
});

test('modes and targets are validated by name', () => {
  const { dir, ledger } = setup();
  assert.throws(() => createFileTrigger({ mode: 'watch', target: dir, ledger }), /mode "watch"/);
  assert.throws(() => createFileTrigger({ mode: 'new', target: path.join(dir, 'nope'), ledger }).arm(), /folder/);
  const f = path.join(dir, 'f.csv'); writeFileSync(f, '1');
  assert.throws(() => createFileTrigger({ mode: 'new', target: f, ledger }).arm(), /folder/);
  assert.throws(() => createFileTrigger({ mode: 'updated', target: dir, ledger }).arm(), /file/);
});

test('ledger is JSONL, write-once per sha, no mutable latest file', () => {
  const { base, dir, ledger } = setup();
  const w = createFileTrigger({ mode: 'new', target: dir, ledger }); w.arm();
  writeFileSync(path.join(dir, 'a'), '1'); writeFileSync(path.join(dir, 'b'), '2');
  pollN(w);
  const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2);
  assert.ok(rows.every((r) => r.id === `sha:${r.sha}` && r.kind === 'ran'));
  assert.deepEqual(readSeen(path.join(base, 'none.jsonl')), []);
});
