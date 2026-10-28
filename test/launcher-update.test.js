// M4b am8 (built from the signed text, docs/wiki/the-module-ladder.md "M4b amendment 8"): `6 update` / `fwdloop update`. A fake registry and a fake npm: nothing here goes online
// or runs a real npm. Every printed line is compared for exact equality with the signed words.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { updateCmd, menuCmd, launcherMain, runNpm } from '../src/launcher.js';
import {
  scratch, closeAll, freeBase, installedHome,
} from './launcher-world.mjs';

after(closeAll);

const sink = () => { const lines = []; return { out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`), lines, text: () => lines.join('\n') }; };
const reg = (version) => async () => ({ ok: true, json: async () => ({ version }) });
const NOT_UPDATED = 'Not updated. To update later: npm install -g fwdloop@latest';

/** deps with a fake registry, a fake npm that records its args, and an answer script for the y/n */
async function world({ latest = '9.9.9', mine = '1.2.3', answers = [], tty = true, npmCode = 0, registryFetch } = {}) {
  const base = await freeBase();
  const asked = [];
  const npm = [];
  const queue = [...answers];
  return {
    d: {
      home: installedHome(), root: scratch(), ports: [base], timeoutMs: 300, nodeVersion: '22.1.0', version: mine, isTTY: tty,
      registryFetch: registryFetch ?? reg(latest),
      spawnNpm: async (args) => { npm.push(args); return npmCode; },
      ask: async (q) => { asked.push(q); return queue.shift() ?? ''; },
    },
    asked,
    npm,
  };
}
const tail = (io) => io.lines.slice(2); // after the two header lines

test('newest: equal or older registry version -> "You have the newest fwdloop (X)." exit 0, no question, no npm', async () => {
  for (const latest of ['1.2.3', '1.2.2', '0.9.9']) {
    const w = await world({ latest });
    const io = sink();
    assert.equal(await updateCmd(io, w.d), 0);
    assert.deepEqual(tail(io), ['You have the newest fwdloop (1.2.3).']);
    assert.deepEqual(w.asked, []);
    assert.deepEqual(w.npm, []);
  }
});

test('versions compare as numbers: 1.10.0 is newer than 1.9.0 (a string compare would say no)', async () => {
  const w = await world({ mine: '1.9.0', latest: '1.10.0', answers: ['n'] });
  const io = sink();
  await updateCmd(io, w.d);
  assert.equal(tail(io)[0], 'fwdloop 1.10.0 is out. You have 1.9.0.');
});

test('newer + y: asks "Update now? (y/n) ", runs npm install -g fwdloop@latest, prints Updated to Y. exit 0; "YES" counts too', async () => {
  for (const a of ['y', 'Y', 'yes', ' YES ']) {
    const w = await world({ answers: [a] });
    const io = sink();
    assert.equal(await updateCmd(io, w.d), 0);
    assert.deepEqual(tail(io), ['fwdloop 9.9.9 is out. You have 1.2.3.', 'Updated to 9.9.9. Then run fwdloop restart.']);
    assert.deepEqual(w.asked, ['Update now? (y/n) ']);
    assert.deepEqual(w.npm, [['install', '-g', 'fwdloop@latest']]);
  }
});

test('newer + n, or anything else: the "Not updated" line, no npm, exit 0', async () => {
  for (const a of ['n', 'no', 'maybe', 'yy', 'y es']) {
    const w = await world({ answers: [a] });
    const io = sink();
    assert.equal(await updateCmd(io, w.d), 0);
    assert.deepEqual(tail(io), ['fwdloop 9.9.9 is out. You have 1.2.3.', NOT_UPDATED]);
    assert.deepEqual(w.npm, [], a);
  }
});

test('Enter with nothing typed asks once more; a second empty Enter is n; an empty then y installs', async () => {
  const two = await world({ answers: ['', ''] });
  const io = sink();
  assert.equal(await updateCmd(io, two.d), 0);
  assert.deepEqual(two.asked, ['Update now? (y/n) ', 'Update now? (y/n) ']);
  assert.equal(tail(io).at(-1), NOT_UPDATED);
  assert.deepEqual(two.npm, []);
  const yes = await world({ answers: ['', 'y'] });
  const io2 = sink();
  await updateCmd(io2, yes.d);
  assert.deepEqual(yes.npm, [['install', '-g', 'fwdloop@latest']]);
  assert.equal(tail(io2).at(-1), 'Updated to 9.9.9. Then run fwdloop restart.');
});

test('npm fails: the "did not finish" line and a non-zero exit', async () => {
  const w = await world({ answers: ['y'], npmCode: 1 });
  const io = sink();
  assert.equal(await updateCmd(io, w.d), 1);
  assert.deepEqual(tail(io), ['fwdloop 9.9.9 is out. You have 1.2.3.', 'ERR The update did not finish. Run it yourself: npm install -g fwdloop@latest']);
});

test('no terminal: prints the newer line and the "Not updated" line, never asks, never installs, exit 0', async () => {
  const w = await world({ tty: false, answers: ['y'] });
  const io = sink();
  assert.equal(await updateCmd(io, w.d), 0);
  assert.deepEqual(tail(io), ['fwdloop 9.9.9 is out. You have 1.2.3.', NOT_UPDATED]);
  assert.deepEqual(w.asked, []);
  assert.deepEqual(w.npm, []);
});

test('could not reach npm: offline, timeout, non-2xx, bad JSON, no version, a non-version string -> the one line, exit 1, no question, no npm', async () => {
  const bads = {
    offline: async () => { throw new TypeError('fetch failed'); },
    timeout: async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; },
    non2xx: async () => ({ ok: false, status: 503, json: async () => ({ version: '9.9.9' }) }),
    badJson: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }),
    noVersion: async () => ({ ok: true, json: async () => ({ name: 'fwdloop' }) }),
    notAVersion: async () => ({ ok: true, json: async () => ({ version: 'latest' }) }),
  };
  for (const [name, registryFetch] of Object.entries(bads)) {
    const w = await world({ registryFetch, answers: ['y'] });
    const io = sink();
    assert.equal(await updateCmd(io, w.d), 1, name);
    assert.deepEqual(tail(io), ['ERR Could not reach npm to check. Try again later.'], name);
    assert.deepEqual(w.asked, [], name);
    assert.deepEqual(w.npm, [], name);
  }
});

test('the registry read asks the signed URL with a 5-second signal', async () => {
  let seen;
  const w = await world({ registryFetch: async (url, opts) => { seen = { url, signal: opts.signal }; return { ok: true, json: async () => ({ version: '1.2.3' }) }; } });
  await updateCmd(sink(), w.d);
  assert.equal(seen.url, 'https://registry.npmjs.org/fwdloop/latest');
  assert.ok(seen.signal instanceof AbortSignal);
});

test('menu: the top line has "6 update"; choosing 6 or "update" runs it on the menu\'s header', async () => {
  for (const choice of ['6', 'update']) {
    const w = await world({ answers: [] });
    const chosen = [choice, 'y'];
    w.d.ask = async (q) => { w.asked.push(q); return chosen.shift() ?? ''; };
    const io = sink();
    assert.equal(await menuCmd(io, w.d), 0);
    assert.equal(io.lines[3], '1 start   2 stop   3 restart   4 status   5 install   6 update   q quit');
    assert.deepEqual(io.lines.slice(4), ['fwdloop 9.9.9 is out. You have 1.2.3.', 'Updated to 9.9.9. Then pick 3 restart.']);
    assert.equal(io.lines.filter((l) => l.startsWith('fwdloop 1.2.3 ·')).length, 1, 'the header is printed once');
  }
});

test('launcherMain "update" with piped stdin (no terminal) never asks and never installs', async () => {
  const w = await world({ answers: ['y'] });
  const stdin = new PassThrough();
  stdin.end('y\n');
  const out = [];
  const stdout = { write: (s) => out.push(s) };
  const rc = await launcherMain('update', [], { stdin, stdout, stderr: { write: () => {} }, home: w.d.home, root: w.d.root, processEnv: {}, launcher: { ...w.d, isTTY: undefined, ask: undefined, ports: w.d.ports } });
  assert.equal(rc, 0);
  const text = out.join('');
  assert.ok(text.includes(`fwdloop 9.9.9 is out. You have 1.2.3.\n${NOT_UPDATED}\n`), text);
  assert.deepEqual(w.npm, []);
});

/** a fake child process: records kill, can be told to close */
const fakeChild = () => { const c = new EventEmitter(); c.killed = []; c.kill = (sig) => { c.killed.push(sig); }; return c; };

test('runNpm: spawns npm with the args, shell false, stdio inherit; exit 0 -> 0, non-zero -> 1', async () => {
  for (const [code, want] of [[0, 0], [1, 1], [null, 1]]) {
    const calls = [];
    const child = fakeChild();
    const p = runNpm(['install', '-g', 'fwdloop@latest'], { spawnImpl: (...a) => { calls.push(a); return child; } });
    child.emit('close', code);
    assert.equal(await p, want);
    assert.deepEqual(calls, [['npm', ['install', '-g', 'fwdloop@latest'], { shell: false, stdio: 'inherit' }]]);
  }
});

test('runNpm: at the deadline it kills its own child and reports failure; a spawn error is a failure', async () => {
  const child = fakeChild();
  const rc = await runNpm(['x'], { spawnImpl: () => child, deadlineMs: 20 });
  assert.equal(rc, 1);
  assert.deepEqual(child.killed, ['SIGTERM']);
  const bad = fakeChild();
  const p = runNpm(['x'], { spawnImpl: () => bad });
  bad.emit('error', new Error('ENOENT'));
  assert.equal(await p, 1);
  assert.equal(await runNpm(['x'], { spawnImpl: () => { throw new Error('boom'); } }), 1);
});

test('M4b am9: the restart words follow the door - menu says "pick 3 restart", `fwdloop update` says "run fwdloop restart"', async () => {
  const sub = await world({ answers: ['y'] });
  const io = sink();
  assert.equal(await updateCmd(io, sub.d), 0); // no `shown` header = the typed `fwdloop update` door
  assert.equal(io.lines.at(-1), 'Updated to 9.9.9. Then run fwdloop restart.');
  const menu = await world({ answers: [] });
  const chosen = ['6', 'y'];
  menu.d.ask = async () => chosen.shift() ?? '';
  const io2 = sink();
  assert.equal(await menuCmd(io2, menu.d), 0);
  assert.equal(io2.lines.at(-1), 'Updated to 9.9.9. Then pick 3 restart.');
});
