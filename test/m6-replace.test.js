// M6 (docs/wiki/the-module-ladder.md, "M6 scope — SIGNED by hamr 2026-10-10"): "Signing replaces the job." This is the POC of the
// riskiest assumption, as a test: the ONE writer (`writeFlow`) can replace a signed job in its existing folder ALL OR NOTHING. A failure
// between the file writes leaves the old job intact and runnable; a success replaces prose, declaration, signature and the signed/ copy
// together, keeps the flow name, its runs/ folder and its books, and keeps no old version anywhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow, readFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const OLD = { prose: fixture('job1.m1.signed.txt'), decl: JSON.parse(fixture('job1.m1.declaration.json')) };
const NEW = { prose: fixture('job2-with-sources.signed.txt'), decl: JSON.parse(fixture('job2.m1.declaration.json')) };

/** every file under dir (relative path -> sha256), so "byte-identical" is one deepEqual */
function snapshot(dir, rel = '') {
  const out = {};
  for (const n of readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}

function signedOld() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6r-'));
  const w = writeFlow({ root, name: 'f', proseText: OLD.prose, declaration: OLD.decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  // what a flow folder holds beyond the three files: a run, the flow's books, the setup record
  mkdirSync(path.join(w.dir, 'runs', 'run-1'), { recursive: true });
  writeFileSync(path.join(w.dir, 'runs', 'run-1', 'audit.jsonl'), '{"step":1}\n');
  writeFileSync(path.join(w.dir, 'runs.jsonl'), '{"runId":"run-1"}\n');
  writeFileSync(path.join(w.dir, 'setup.jsonl'), '{"kind":"sign","flowHash":"old"}\n');
  return { root, dir: w.dir, hash: w.signature.flow };
}
const replaceWith = (x, extra = {}) => writeFlow({
  root: x.root, name: 'f', proseText: NEW.prose, declaration: NEW.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: x.hash }, ...extra,
});
const readOk = (root) => readFlow({ root, name: 'f', catalogue: CAT });

test('replace: prose, declaration, signature and signed/ change together; runs/ and the books stay; no old version is kept', () => {
  const x = signedOld();
  const runBefore = snapshot(path.join(x.dir, 'runs'));
  const r = replaceWith(x);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(readFileSync(path.join(x.dir, 'prose.txt'), 'utf8'), NEW.prose);
  assert.equal(readFileSync(path.join(x.dir, 'signed', 'prose.txt'), 'utf8'), NEW.prose);
  assert.notEqual(r.signature.flow, x.hash);
  assert.equal(readOk(x.root).ok, true, 'the replaced job verifies and reads');
  assert.deepEqual(snapshot(path.join(x.dir, 'runs')), runBefore, 'runs/ is untouched');
  assert.equal(readFileSync(path.join(x.dir, 'runs.jsonl'), 'utf8'), '{"runId":"run-1"}\n', 'the flow books stay');
  assert.equal(existsSync(path.join(x.dir, 'setup.jsonl')), false, 'the old setup record is gone (it described the old job); the caller writes the new one');
  assert.deepEqual(readdirSync(x.dir).sort(), ['declaration.json', 'prose.txt', 'runs', 'runs.jsonl', 'signature.json', 'signed'], 'no backup, no staging, no old version left in the folder');
});

test('replace: a failure at ANY step between the file writes leaves the old job byte-identical and runnable', () => {
  const steps = [];
  const probe = signedOld();
  replaceWith(probe, { onReplaceStep: (s) => steps.push(s) });
  assert.ok(steps.length >= 5, `the swap reports its steps (${steps.join(',')})`);
  for (const step of steps) {
    const x = signedOld();
    const before = snapshot(x.dir);
    const r = replaceWith(x, { onReplaceStep: (s) => { if (s === step) throw new Error(`injected failure after ${s}`); } });
    assert.equal(r.ok, false, `failure after "${step}" is refused`);
    assert.match(r.reds.join('\n'), /injected failure/);
    assert.deepEqual(snapshot(x.dir), before, `after "${step}" failed: every file is back, byte for byte, nothing extra`);
    assert.equal(readOk(x.root).ok, true, 'and the old job still verifies');
    assert.equal(readOk(x.root).signature.flow, x.hash);
  }
});

test('replace: a stale edit (the job was signed again meanwhile) is refused by name and changes nothing', () => {
  const x = signedOld();
  const first = replaceWith(x);
  assert.equal(first.ok, true);
  const before = snapshot(x.dir);
  const stale = writeFlow({ root: x.root, name: 'f', proseText: OLD.prose, declaration: OLD.decl, signedBy: 'hamr', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT, replaces: { flowHash: x.hash } });
  assert.equal(stale.ok, false);
  assert.match(stale.reds.join('\n'), /"f" was signed again since you opened it/);
  assert.deepEqual(snapshot(x.dir), before);
});

test('replace: without `replaces`, a taken name is still refused exactly as before', () => {
  const x = signedOld();
  const before = snapshot(x.dir);
  const r = writeFlow({ root: x.root, name: 'f', proseText: NEW.prose, declaration: NEW.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT });
  assert.equal(r.ok, false);
  assert.match(r.reds.join('\n'), /already exists/);
  assert.deepEqual(snapshot(x.dir), before);
});

test('replace: a name with nothing signed under it is refused (replace is not create)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6r-'));
  const r = writeFlow({ root, name: 'nope', proseText: NEW.prose, declaration: NEW.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z', catalogue: CAT, replaces: { flowHash: 'a'.repeat(64) } });
  assert.equal(r.ok, false);
  assert.match(r.reds.join('\n'), /nothing signed to replace/);
  assert.equal(existsSync(path.join(root, 'nope')), false, 'no folder is created');
});

test('replace: a replacement that does not pass the checks changes nothing', () => {
  const x = signedOld();
  const before = snapshot(x.dir);
  const r = replaceWith(x, { proseText: 'not a signed text' });
  assert.equal(r.ok, false);
  assert.deepEqual(snapshot(x.dir), before);
});

// F2 (fix ledger): a HARD KILL inside the swap (SIGKILL: no catch, no finally) must not leave the job refused. The child process runs the real
// replace and kills itself after the named step; the parent then reads the folder the way the CLI / panel does.
test('replace: SIGKILL after ANY swap step leaves a job that reads and verifies (the old one until the signature lands, then the new one), no stray files', () => {
  const steps = [];
  replaceWith(signedOld(), { onReplaceStep: (s) => steps.push(s) });
  const flowUrl = new URL('../src/flow.js', import.meta.url).href;
  const catUrl = new URL('../src/catalogue.js', import.meta.url).href;
  for (const step of steps) {
    const x = signedOld();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { writeFlow } from ${JSON.stringify(flowUrl)};
      import { loadCatalogue } from ${JSON.stringify(catUrl)};
      const j = JSON.parse(process.env.KILL_JOB);
      writeFlow({ root: j.root, name: 'f', proseText: j.prose, declaration: j.decl, signedBy: 'hamr', signedAt: '2026-10-10T11:00:00Z',
        catalogue: loadCatalogue().primitives, replaces: { flowHash: j.hash }, onReplaceStep: (s) => { if (s === j.step) process.kill(process.pid, 'SIGKILL'); } });
    `], { env: { ...process.env, KILL_JOB: JSON.stringify({ root: x.root, prose: NEW.prose, decl: NEW.decl, hash: x.hash, step }) }, timeout: 20_000 });
    assert.equal(child.signal, 'SIGKILL', `the child was killed after "${step}" (${child.stderr})`);
    const r = readOk(x.root);
    assert.equal(r.ok, true, `after a kill following "${step}" the job must read: ${JSON.stringify(r.reds)}`);
    const complete = step === 'signature.json';
    assert.notEqual(r.signature.flow === x.hash, complete, `after "${step}": ${complete ? 'the new job' : 'the old job'}`);
    // once the signature has landed the job is whole and reads fine, so nothing triggers a recovery: the dead process's leftovers wait for the next replace to clear them
    if (!complete) assert.deepEqual(readdirSync(x.dir).filter((n) => n.startsWith('.replace-')), [], `after "${step}" no staging or backup folder is left`);
  }
});
