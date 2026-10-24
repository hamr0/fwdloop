// M4b am4 item 1 / the build brief: bin/fwdloop's launcher wiring. A bare `fwdloop` shows the menu; start | stop | status | install are verbs; every other verb and
// `fwdloop panel [--port N]` are as they were. The CLI runs as a real child with HOME = a scratch dir, so ~/.config/fwdloop is the scratch one (never hamr's); the
// probe asks 4800..4809 but only READS (GET /api/whoami), so the panel part of the header is matched loosely here (the launcher's own tests inject their ports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';

const BIN = fileURLToPath(new URL('../bin/fwdloop', import.meta.url));
const HEADER1 = /^fwdloop \d+\.\d+\.\d+\S* · (installed ✓|not installed — [^\n]+, pick 4 install) · panels? (not running|running at http:\/\/127\.0\.0\.1:48\d\d)/;
const scratchHome = () => mkdtempSync(join(tmpdir(), 'fwdloop-bin-home-'));
const cli = (home, args, input = '') => spawnSync(process.execPath, [BIN, ...args], {
  input, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: home, NO_COLOR: '1' },
});

/** the menu as a person uses it: wait for the `>` prompt, then type the choice (a line typed before the prompt is not read: the menu reads after the header is built) */
function menuWith(home, choice) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH, HOME: home, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let typed = false;
    const guard = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`menu timed out: ${stdout}`)); }, 60_000);
    child.stdout.on('data', (c) => {
      stdout += c;
      if (!typed && stdout.includes('quit\n> ')) { typed = true; child.stdin.write(`${choice}\n`); }
    });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => { clearTimeout(guard); resolve({ status, stdout, stderr }); });
  });
}

test('bare `fwdloop`: the header, a blank line, the four choices, a prompt; q quits 0 (the menu runs one choice, then quits)', () => {
  const home = scratchHome();
  const r = cli(home, [], 'q\n');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.match(lines[0], HEADER1);
  assert.match(lines[1], /^runs: \d+ running · \d+ need you · \d+ in all$/);
  assert.equal(lines[2], '');
  assert.equal(lines[3], '1 start   2 stop   3 status   4 install   q quit');
  assert.ok(lines[4].startsWith('>'));
});

test('menu 4 install on a fresh HOME creates the folder (700), .env (600) and config.json; a second install says there is nothing to do', async () => {
  const home = scratchHome();
  const r = await menuWith(home, '4');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Installed\. Created:/);
  const dir = join(home, '.config', 'fwdloop');
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8').trim(), '{}');
  const again = cli(home, ['install']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Already installed, nothing to do\.\n$/);
  assert.match(again.stdout.split('\n')[0], /· installed ✓ ·/);
});

test('`fwdloop status` prints the header first, then either the panels or "Panel not running." with exit 3; no sub-command writes anything outside HOME', () => {
  const home = scratchHome();
  const r = cli(home, ['status']);
  assert.match(r.stdout.split('\n')[0], HEADER1);
  if (r.stdout.includes('Panel not running.')) assert.equal(r.status, 3);
  else assert.equal(r.status, 0);
  assert.equal(existsSync(join(home, '.config')), false, 'status creates nothing');
});

test('`fwdloop stop --port 4800` is refused (am5 item 1: stop --port is removed) and `fwdloop start --root` needs an existing folder', () => {
  const home = scratchHome();
  const s = cli(home, ['stop', '--port', '4800']);
  assert.equal(s.status, 1);
  assert.match(s.stderr, /Unknown option "--port" — fwdloop stop takes only --yes\. It stops every panel it finds\./);
  const g = cli(home, ['start', '--root', join(home, 'nope')]);
  assert.equal(g.status, 1);
  assert.match(g.stderr, /--root ".*nope" does not exist/);
});

test('the existing verbs are as they were: an unknown verb is named with the list, `panel --port` still refuses a bad port', () => {
  const home = scratchHome();
  const u = cli(home, ['frobnicate']);
  assert.equal(u.status, 1);
  assert.match(u.stderr, /unknown verb "frobnicate" — expected draft \| sign \| run \| inbox \| show \| answer \| resume \| continue \| panel \| learn \| tidy \| start \| stop \| status \| install/);
  const p = cli(home, ['panel', '--port', 'abc', '--root', '.']);
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /--port must be a valid TCP port/);
});
