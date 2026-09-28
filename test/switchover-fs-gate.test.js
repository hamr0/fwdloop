// Tests for the fix-once switch-over (fix-ledger item "step `write` may
// overwrite frozen inputs") — bare-agent 0.47's `createShellTools({
// noFollowSymlinks: true })` + bareguard 0.19's fs Gate, wired into
// src/primitives.js's `resolvePrimitives`. $0, real filesystem against temp
// directories only, no network.
//
// Two kinds of test in this file:
//  1. VALIDATION tests (marked below) call bareguard's Gate and bare-agent's
//     shell tools DIRECTLY — not through src/primitives.js — to confirm the
//     upstream behaviour this switch-over relies on actually holds as
//     delivered (hamr's rule: validate, never patch around).
//  2. INTEGRATION tests go through `resolvePrimitives` end to end (cases
//     a-g from the task brief).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Gate } from 'bareguard';
import { createShellTools, resolveToolPath } from 'bare-agent/tools';

import { resolvePrimitives } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

const loaded = loadCatalogue();
assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.reds.join('\n'));
const CATALOGUE = loaded.primitives;

function tmpDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// ===========================================================================
// 1. VALIDATION — bareguard's Gate, called directly
// ===========================================================================

test('VALIDATION bareguard Gate: fs is deny-by-default — no readScope/writeScope configured denies both, rule ".unset"', async () => {
  const gate = new Gate({ fs: {} });
  const runDir = tmpDir('fwdloop-gv-unset-');
  const readDecision = await gate.check({ type: 'read', path: path.join(runDir, 'x') });
  const writeDecision = await gate.check({ type: 'write', path: path.join(runDir, 'x') });
  assert.equal(readDecision.outcome, 'deny');
  assert.equal(readDecision.rule, 'fs.readScope.unset');
  assert.equal(writeDecision.outcome, 'deny');
  assert.equal(writeDecision.rule, 'fs.writeScope.unset');
});

test('VALIDATION bareguard Gate: a relative or "~" agent path is denied with rule "fs.invalidPath" — never canonicalized by the gate itself', async () => {
  const runDir = tmpDir('fwdloop-gv-invalid-');
  const gate = new Gate({ fs: { readScope: [runDir], writeScope: [runDir] } });
  const relDecision = await gate.check({ type: 'read', path: 'relative/x.txt' });
  const tildeDecision = await gate.check({ type: 'read', path: '~/.bashrc' });
  assert.equal(relDecision.outcome, 'deny');
  assert.equal(relDecision.rule, 'fs.invalidPath');
  assert.equal(tildeDecision.outcome, 'deny');
  assert.equal(tildeDecision.rule, 'fs.invalidPath');
});

test('VALIDATION bareguard Gate: a symlink inside an allowed scope pointing OUTSIDE it resolves-and-denies, rule ".symlinkEscape"', async () => {
  const runDir = tmpDir('fwdloop-gv-escape-');
  const outsideDir = tmpDir('fwdloop-gv-outside-');
  const secretFile = path.join(outsideDir, 'secret.txt');
  writeFileSync(secretFile, 'top secret');
  const linkPath = path.join(runDir, 'link.txt');
  symlinkSync(secretFile, linkPath);

  const gate = new Gate({ fs: { readScope: [runDir], writeScope: [runDir] } });
  const decision = await gate.check({ type: 'read', path: linkPath });
  assert.equal(decision.outcome, 'deny');
  assert.equal(decision.rule, 'fs.readScope.symlinkEscape');
});

test('VALIDATION bareguard Gate: a dangling symlink inside an allowed write scope denies, rule ".danglingSymlink"', async () => {
  const runDir = tmpDir('fwdloop-gv-dangling-');
  const danglingLink = path.join(runDir, 'dangling.txt');
  symlinkSync(path.join(runDir, 'does-not-exist'), danglingLink);

  const gate = new Gate({ fs: { readScope: [runDir], writeScope: [runDir] } });
  const decision = await gate.check({ type: 'write', path: danglingLink });
  assert.equal(decision.outcome, 'deny');
  assert.equal(decision.rule, 'fs.writeScope.danglingSymlink');
});

test('VALIDATION bareguard Gate: there is no "fs.resolveSymlinks" opt-out key — setting one does not disable the resolved-path check', async () => {
  const runDir = tmpDir('fwdloop-gv-nokey-');
  const outsideDir = tmpDir('fwdloop-gv-nokey-outside-');
  const secretFile = path.join(outsideDir, 'secret.txt');
  writeFileSync(secretFile, 'top secret');
  const linkPath = path.join(runDir, 'link.txt');
  symlinkSync(secretFile, linkPath);

  // Passing an unrecognized `resolveSymlinks` key must have NO effect — the
  // symlink-escape check is always on, as the task brief and README claim.
  const gate = new Gate({ fs: { readScope: [runDir], writeScope: [runDir], resolveSymlinks: false } });
  const decision = await gate.check({ type: 'read', path: linkPath });
  assert.equal(decision.outcome, 'deny');
  assert.equal(decision.rule, 'fs.readScope.symlinkEscape');
});

test('VALIDATION bareguard Gate: a writeScope grant does not imply read, and vice versa', async () => {
  const readOnlyDir = tmpDir('fwdloop-gv-ro-');
  const writeOnlyDir = tmpDir('fwdloop-gv-wo-');
  const gate = new Gate({ fs: { readScope: [readOnlyDir], writeScope: [writeOnlyDir] } });
  const writeIntoReadScope = await gate.check({ type: 'write', path: path.join(readOnlyDir, 'x.txt') });
  const readFromWriteScope = await gate.check({ type: 'read', path: path.join(writeOnlyDir, 'x.txt') });
  assert.equal(writeIntoReadScope.outcome, 'deny');
  assert.equal(readFromWriteScope.outcome, 'deny');
});

// ===========================================================================
// 2. VALIDATION — bare-agent's shell tools, called directly
// ===========================================================================

test('VALIDATION bare-agent createShellTools({noFollowSymlinks:true}): a symlinked FINAL-component file throws ELOOP on read', async () => {
  const dir = tmpDir('fwdloop-bav-file-');
  const realFile = path.join(dir, 'real.txt');
  writeFileSync(realFile, 'hello');
  const link = path.join(dir, 'link.txt');
  symlinkSync(realFile, link);

  const { tools } = createShellTools({ noFollowSymlinks: true });
  const read = tools.find((t) => t.name === 'shell_read');
  await assert.rejects(() => read.execute({ path: link }), (err) => {
    assert.equal(err.code, 'ELOOP');
    return true;
  });
  // Control: the real file (not a symlink) still reads fine.
  const text = await read.execute({ path: realFile });
  assert.match(text, /hello/);
});

test('VALIDATION bare-agent createShellTools({noFollowSymlinks:true}): a symlinked FINAL-component directory throws ELOOP on read', async () => {
  const dir = tmpDir('fwdloop-bav-dir-');
  const realDir = path.join(dir, 'realdir');
  mkdirSync(realDir);
  writeFileSync(path.join(realDir, 'in.txt'), 'x');
  const link = path.join(dir, 'linkdir');
  symlinkSync(realDir, link);

  const { tools } = createShellTools({ noFollowSymlinks: true });
  const read = tools.find((t) => t.name === 'shell_read');
  await assert.rejects(() => read.execute({ path: link }), (err) => {
    assert.equal(err.code, 'ELOOP');
    return true;
  });
});

test('VALIDATION bare-agent createShellTools({noFollowSymlinks:true}): a DANGLING final-component symlink throws ELOOP on read and on write, never creates a file', async () => {
  const dir = tmpDir('fwdloop-bav-dangle-');
  const dangling = path.join(dir, 'dangling.txt');
  symlinkSync(path.join(dir, 'does-not-exist'), dangling);

  const { tools } = createShellTools({ noFollowSymlinks: true });
  const read = tools.find((t) => t.name === 'shell_read');
  const write = tools.find((t) => t.name === 'shell_write');
  await assert.rejects(() => read.execute({ path: dangling }), (err) => {
    assert.equal(err.code, 'ELOOP');
    return true;
  });
  await assert.rejects(() => write.execute({ path: dangling, content: 'x' }), (err) => {
    assert.equal(err.code, 'ELOOP');
    return true;
  });
  assert.equal(existsSync(path.join(dir, 'does-not-exist')), false, 'the dangling target must never be created');
});

test('VALIDATION bare-agent resolveToolPath: expands "~", throws on empty/non-string, is idempotent on an absolute path', () => {
  const expanded = resolveToolPath('~/some-file.txt');
  assert.ok(path.isAbsolute(expanded));
  assert.doesNotMatch(expanded, /^~/);
  assert.throws(() => resolveToolPath(''), /non-empty string/);
  assert.throws(() => resolveToolPath(123), /non-empty string/);
  const abs = '/tmp/already/absolute';
  assert.equal(resolveToolPath(resolveToolPath(abs)), resolveToolPath(abs));
});

// ===========================================================================
// 3. INTEGRATION — src/primitives.js's resolvePrimitives, end to end
// ===========================================================================

function frozenInputRunDir() {
  const runDir = tmpDir('fwdloop-sw-run-');
  mkdirSync(path.join(runDir, 'inputs'), { recursive: true });
  const frozenPath = path.join(runDir, 'inputs', 'jd.md');
  writeFileSync(frozenPath, 'frozen job description');
  return { runDir, frozenPath };
}

// (a) write to a frozen input under <runDir>/inputs/ is refused, file unchanged.
test('(a) write to a frozen input under <runDir>/inputs/ is refused — file unchanged', async () => {
  const { runDir, frozenPath } = frozenInputRunDir();
  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  await assert.rejects(
    () => tools.write.execute({ path: frozenPath, content: 'tampered' }),
    /outside the sandbox/,
  );
  assert.equal(readFileSync(frozenPath, 'utf8'), 'frozen job description');
});

// (b) write to <runDir>/state.json and <runDir>/audit.jsonl is refused.
test('(b) write to <runDir>/state.json and <runDir>/audit.jsonl is refused', async () => {
  const runDir = tmpDir('fwdloop-sw-run-');
  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  await assert.rejects(() => tools.write.execute({ path: path.join(runDir, 'state.json'), content: '{}' }), /outside the sandbox/);
  await assert.rejects(() => tools.write.execute({ path: path.join(runDir, 'audit.jsonl'), content: '{}' }), /outside the sandbox/);
  assert.equal(existsSync(path.join(runDir, 'state.json')), false);
  assert.equal(existsSync(path.join(runDir, 'audit.jsonl')), false);
});

// (c) write to <runDir>/out/x.txt is allowed; relative 'out/y.txt' lands in <runDir>/out/y.txt.
test('(c) write to <runDir>/out/x.txt is allowed; a relative "out/y.txt" lands in <runDir>/out/y.txt', async () => {
  const runDir = tmpDir('fwdloop-sw-run-');
  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  const absTarget = path.join(runDir, 'out', 'x.txt');
  await tools.write.execute({ path: absTarget, content: 'abs' });
  assert.equal(readFileSync(absTarget, 'utf8'), 'abs');

  await tools.write.execute({ path: 'out/y.txt', content: 'rel' });
  assert.equal(readFileSync(path.join(runDir, 'out', 'y.txt'), 'utf8'), 'rel');
});

// (d) read of a symlink inside runDir pointing outside is refused, secret not returned.
test('(d) read of <runDir>/link.txt symlinked to an outside file is refused — secret never returned', async () => {
  const runDir = tmpDir('fwdloop-sw-run-');
  const outsideDir = tmpDir('fwdloop-sw-outside-');
  const secretPath = path.join(outsideDir, 'secret.txt');
  writeFileSync(secretPath, 'do-not-leak-this');
  const linkPath = path.join(runDir, 'link.txt');
  symlinkSync(secretPath, linkPath);

  const { tools } = resolvePrimitives(CATALOGUE, ['read'], { runDir });
  await assert.rejects(
    () => tools.read.execute({ path: linkPath }),
    (err) => {
      assert.doesNotMatch(err.message, /do-not-leak-this/);
      return true;
    },
  );
});

// (e) write through a dangling symlink in <runDir>/out pointing outside is refused, no file created outside.
test('(e) write through a dangling symlink in <runDir>/out pointing outside is refused — no file created outside', async () => {
  const runDir = tmpDir('fwdloop-sw-run-');
  const outsideDir = tmpDir('fwdloop-sw-outside-');
  mkdirSync(path.join(runDir, 'out'), { recursive: true });
  const outsideTarget = path.join(outsideDir, 'escaped.txt');
  const danglingLink = path.join(runDir, 'out', 'dangling.txt');
  symlinkSync(outsideTarget, danglingLink);

  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  await assert.rejects(() => tools.write.execute({ path: danglingLink, content: 'escape' }));
  assert.equal(existsSync(outsideTarget), false);
});

// (f) read of '/etc/passwd' and '~/.bashrc' is refused.
test('(f) read of "/etc/passwd" and "~/.bashrc" is refused', async () => {
  const runDir = tmpDir('fwdloop-sw-run-');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], { runDir });
  await assert.rejects(() => tools.read.execute({ path: '/etc/passwd' }), /outside the sandbox/);
  await assert.rejects(() => tools.read.execute({ path: '~/.bashrc' }), /outside the sandbox/);
});

// (g) read of a frozen input by role still works; read of <runDir>/artifacts/<file> works.
test('(g) read of a frozen input by role still works; read of <runDir>/artifacts/<file> works', async () => {
  const { runDir, frozenPath } = frozenInputRunDir();
  mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  writeFileSync(path.join(runDir, 'artifacts', 'note.txt'), 'artifact text');

  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'jd', frozen: frozenPath }],
  });
  const roleText = await tools.read.execute({ role: 'jd' });
  assert.match(roleText, /frozen job description/);

  const artifactText = await tools.read.execute({ path: path.join(runDir, 'artifacts', 'note.txt') });
  assert.match(artifactText, /artifact text/);
});
