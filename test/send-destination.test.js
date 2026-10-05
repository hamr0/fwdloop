// M4e amendment 1 ("Destination is any folder", docs/wiki/the-module-ladder.md): negatives (a)-(f),
// proven against the one rule (`checkSendDestination`) and the real write (`sendViaPrimitive`).
// Everything lives in a scratch dir; FWDLOOP_CONFIG_HOME points inside it, so the real
// ~/.config/fwdloop is never read or written.

import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { checkSendDestination } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { serializeArtifact, sha256Hex } from '../src/ask.js';

let base;
let savedHome;
let root;
let runDir;
let cfg;
let dest;
let ctx;
const ARTIFACT = { answer: 'accepted' };
const SHA = sha256Hex(serializeArtifact(ARTIFACT));
const send = (target, filename = 'run1-out.json') => sendViaPrimitive(target, filename, ARTIFACT, SHA, ctx);

before(() => {
  base = mkdtempSync(join(tmpdir(), 'fwdloop-dest-'));
  savedHome = process.env.FWDLOOP_CONFIG_HOME;
  cfg = join(base, 'cfg');
  root = join(base, 'flows');
  runDir = join(root, 'flowA', 'runs', 'r1');
  dest = join(base, 'dest');
  for (const d of [cfg, runDir, join(runDir, 'inputs'), join(root, 'flowB'), dest]) mkdirSync(d, { recursive: true });
  process.env.FWDLOOP_CONFIG_HOME = cfg;
  ctx = { root, runDir };
});

after(() => {
  if (savedHome === undefined) delete process.env.FWDLOOP_CONFIG_HOME;
  else process.env.FWDLOOP_CONFIG_HOME = savedHome;
  rmSync(base, { recursive: true, force: true });
});

test('(a) an absolute folder outside the install folder is written with the accepted bytes', async () => {
  const r = await send(`file:${dest}`);
  assert.equal(r.ok, true, r.red);
  assert.equal(readFileSync(join(dest, 'run1-out.json'), 'utf8'), serializeArtifact(ARTIFACT));
  unlinkSync(join(dest, 'run1-out.json'));
});

test('(b) a relative target keeps today\'s meaning: inside the install folder, fenced to it', () => {
  const ok = checkSendDestination('file:poc/m0/out');
  assert.equal(ok.ok, true, ok.red);
  assert.ok(ok.dir.endsWith('/poc/m0/out'));
  const escaped = checkSendDestination('file:../outside');
  assert.equal(escaped.ok, false);
  assert.match(escaped.red, /resolves outside the repo/);
});

test('(c) the run folder, its inputs/, a flow folder and the config folder are refused at sign and at send', async () => {
  const refusals = [
    [runDir, /run's own folder/],
    [join(runDir, 'inputs'), /run's own folder/],
    [join(root, 'flowB'), /flow folder/],
    [root, /flow folder/],
    [cfg, /config folder/],
  ];
  for (const [folder, why] of refusals) {
    for (const via of ['direct', 'symlink']) {
      let target = folder;
      if (via === 'symlink') {
        target = join(base, `link-${Math.abs(folder.length)}-${refusals.findIndex((x) => x[0] === folder)}`);
        symlinkSync(folder, target);
      }
      const signTime = checkSendDestination(`file:${target}`, { root });
      const sendTime = checkSendDestination(`file:${target}`, ctx);
      assert.equal(sendTime.ok, false, `${via} ${folder} must be refused at send`);
      assert.match(sendTime.red, why);
      // sign time has no run folder yet: the flow root and config folder still refuse
      if (!/run's own/.test(String(why))) assert.equal(signTime.ok, false, `${via} ${folder} must be refused at sign`);
      // eslint-disable-next-line no-await-in-loop
      const sent = await send(`file:${target}`);
      assert.equal(sent.ok, false);
      assert.equal(existsSync(join(folder, 'run1-out.json')), false, 'nothing written');
    }
  }
});

test('(d) a symlink swapped in after sign to point into a refused folder is refused at send', async () => {
  const link = join(base, 'swap');
  symlinkSync(dest, link);
  assert.equal(checkSendDestination(`file:${link}`, { root }).ok, true, 'fine at sign time');
  unlinkSync(link);
  symlinkSync(cfg, link);
  const r = await send(`file:${link}`);
  assert.equal(r.ok, false);
  assert.match(r.red, /config folder/);
  assert.equal(existsSync(join(cfg, 'run1-out.json')), false);
});

test('(e) an existing file with the result\'s name is never overwritten', async () => {
  const existing = join(dest, 'run1-out.json');
  writeFileSync(existing, 'KEEP ME');
  const r = await send(`file:${dest}`);
  assert.equal(r.ok, false);
  assert.match(r.red, /already exists/);
  assert.equal(readFileSync(existing, 'utf8'), 'KEEP ME');
  unlinkSync(existing);
});

test('(f) a target that is a file, or missing, is refused at sign', () => {
  const file = join(dest, 'plain.txt');
  writeFileSync(file, 'x');
  for (const t of [file, join(base, 'no-such-folder')]) {
    const r = checkSendDestination(`file:${t}`, { root });
    assert.equal(r.ok, false);
    assert.match(r.red, /not an existing folder/);
  }
  unlinkSync(file);
});
