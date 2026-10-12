// The m4e-author-sign "stopped" flake: right after a spawn, a LIVE child's /proc/<pid>/cmdline reads EMPTY for a few
// milliseconds (the exec window; captured under CPU load: state R, starttime equal to the recorded one, cmdline "").
// isFwdloopAlive read that as a zombie and said "dead", so a fresh draft showed "stopped". Only a state of Z/X is dead;
// an empty cmdline on anything else is "cannot tell yet" (null -> the caller's freshness rule), never false.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFwdloopAlive } from '../src/liveness.js';

const stat = (state) => `4242 (node-22) ${state} 1 4242 4242 0 -1 4194304 37 0 0 0 0 0 0 0 25 5 1 0 17970591 4096 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 2 0`;
const proc = (cmdline, state) => ({ cmdline: () => cmdline, stat: () => stat(state) });

test('a live process whose cmdline reads empty for a moment (exec window) is "cannot tell", not dead', () => {
  for (const state of ['R', 'S', 'D']) {
    assert.equal(isFwdloopAlive(process.pid, '17970591', proc('', state)), null, state);
  }
});

test('an empty cmdline on a zombie is still dead', () => {
  assert.equal(isFwdloopAlive(process.pid, '17970591', proc('', 'Z')), false);
});

test('a normal fwdloop cmdline is still alive, a foreign one still not', () => {
  assert.equal(isFwdloopAlive(process.pid, '17970591', proc('/usr/bin/node\0/x/bin/fwdloop\0draft\0', 'S')), true);
  assert.equal(isFwdloopAlive(process.pid, '17970591', proc('/usr/bin/node\0/x/other.js\0', 'S')), false);
});
