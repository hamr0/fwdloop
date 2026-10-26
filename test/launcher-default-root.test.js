// M4b amendment 7 items 1-2: with no `--root` every verb uses <config home>/flows (made 0700 if missing); the current folder is never the default; `--root X` still wins.
// The CLI runs as a real child with HOME = a scratch dir (never hamr's ~/.config); `start` is the launcher's injected spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { startCmd } from '../src/launcher.js';
import { defaultFlowsRoot } from '../src/config.js';
import { V, freeBase, installedHome } from './launcher-world.mjs';

const BIN = fileURLToPath(new URL('../bin/fwdloop', import.meta.url));
const scratch = (p) => mkdtempSync(join(tmpdir(), `fwdloop-${p}-`));
const sink = () => { const lines = []; return { out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`), lines, text: () => lines.join('\n') }; };
const cli = (home, cwd, args) => spawnSync(process.execPath, [BIN, ...args], {
  cwd, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: home, NO_COLOR: '1' },
});
/** a folder that looks like the old default: a flow with a run holding a (legacy) ask, and a `.starts/` refused-start folder */
function poisonedCwd() {
  const cwd = scratch('cwd');
  mkdirSync(join(cwd, 'oldflow', 'runs', 'run-1'), { recursive: true });
  writeFileSync(join(cwd, 'oldflow', 'runs', 'run-1', 'ask.json'), JSON.stringify({ question: 'OLD-REFUSED-START' }));
  mkdirSync(join(cwd, '.starts', 'refused-1'), { recursive: true });
  return cwd;
}

test('start with no --root hands the panel <config home>/flows, made 0700', async () => {
  const home = installedHome();
  const spawned = [];
  const io = sink();
  const base = await freeBase();
  const rc = await startCmd(io, {
    home, ports: [base], timeoutMs: 300, deadlineMs: 400, nodeVersion: '22.1.0', version: V, fwdloopBin: '/x/bin/fwdloop',
    spawnFn: (a) => { spawned.push(a); const e = { unref() {}, on() {} }; return e; }, open: async () => true,
  });
  assert.ok(rc === 0 || rc === 1, io.text());
  assert.equal(spawned.length, 1, io.text());
  const root = spawned[0].argv[spawned[0].argv.indexOf('--root') + 1];
  assert.equal(root, join(home, 'flows'));
  assert.equal(statSync(root).mode & 0o777, 0o700);
});

test('defaultFlowsRoot makes the folder 0700 and leaves an existing one alone', () => {
  const home = join(scratch('home'), 'cfg');
  const root = defaultFlowsRoot(home);
  assert.equal(root, join(home, 'flows'));
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(defaultFlowsRoot(home), root);
});

test('NEGATIVE: a verb typed in a folder holding old flows and a .starts/ folder, with no --root, never reads that folder', () => {
  const home = scratch('home');
  const cwd = poisonedCwd();
  const control = cli(home, cwd, ['inbox', '--root', cwd]);
  assert.match(control.stdout, /OLD-REFUSED-START/, `control: --root <cwd> does list the fixture: ${control.stdout}${control.stderr}`);
  const r = cli(home, cwd, ['inbox']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'inbox: no open asks\n');
  assert.ok(!r.stdout.includes('oldflow') && !r.stdout.includes('.starts'));
  const flows = join(home, '.config', 'fwdloop', 'flows');
  assert.equal(realpathSync(flows), flows.replace(realpathSync(home), realpathSync(home)));
  assert.equal(statSync(flows).mode & 0o777, 0o700);
  assert.ok(!existsSync(join(cwd, 'flows')));
});

test('show with no --root looks in <config home>/flows (not found there, named in the refusal)', () => {
  const home = scratch('home');
  const cwd = poisonedCwd();
  const r = cli(home, cwd, ['show', 'ask-none']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(join(realpathSync(home), '.config', 'fwdloop', 'flows')), r.stderr);
  assert.ok(!r.stderr.includes(realpathSync(cwd)), r.stderr);
});

test('--root X still gives X', () => {
  const home = scratch('home');
  const x = scratch('x');
  const r = cli(home, scratch('cwd'), ['show', 'ask-none', '--root', x]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(realpathSync(x)), r.stderr);
  assert.ok(!existsSync(join(home, '.config', 'fwdloop', 'flows')), 'an explicit --root makes no default folder');
});
