// borrowed-from: bareloop tests/launcher-colour.test.js@v0.47.1 (704d598)
// Adapted: fwdloop name/app; the "main" test drives `launcherMain` (src/launcher.js), the entry bin/fwdloop calls, instead of bareloop's cli.js main.
// M4b am4 item 8: colours only on a terminal (TTY, no NO_COLOR, TERM not dumb); colours wrap words and never change them (stripped == plain).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { makePaint } from '../src/tty-colour.js';
import { buildHeader, menuCmd, installCmd, launcherMain } from '../src/launcher.js';
import { panelUrl } from '../src/panel/server.js';
import {
  V, VRE, scratch, closeAll, fakePanel, freeBase,
} from './launcher-world.mjs';

after(closeAll);

// eslint-disable-next-line no-control-regex
const strip = (/** @type {string} */ s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const sink = () => { const lines = []; return { out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`), lines }; };

test('makePaint: on for a TTY with no NO_COLOR; off with NO_COLOR, off when not a TTY, off for TERM=dumb; an empty NO_COLOR does not turn it off', () => {
  assert.equal(makePaint({ isTTY: true }, {}).on, true);
  assert.equal(makePaint({ isTTY: true }, { TERM: 'xterm-256color' }).on, true);
  assert.equal(makePaint({ isTTY: true }, { NO_COLOR: '1' }).on, false);
  assert.equal(makePaint({ isTTY: false }, {}).on, false);
  assert.equal(makePaint({}, {}).on, false);
  assert.equal(makePaint({ isTTY: true }, { TERM: 'dumb' }).on, false);
  assert.equal(makePaint({ isTTY: true }, { NO_COLOR: '' }).on, true);
  assert.equal(makePaint({ isTTY: true }, {}).red('x'), '\x1b[31mx\x1b[0m');
  assert.equal(makePaint({ isTTY: false }, {}).red('x'), 'x');
});

test('header + menu: with colour the words are the same (stripped), the rule frames the header, the numbers are bold cyan', async () => {
  const home = join(scratch(), 'fl');
  const port = (await fakePanel(await freeBase())).port;
  const base = { home, root: home, ports: [port], timeoutMs: 2000, nodeVersion: '22.1.0', version: V };
  const plain = await buildHeader({ ...base, paint: makePaint({ isTTY: false }, {}) });
  const col = await buildHeader({ ...base, paint: makePaint({ isTTY: true }, {}) });
  assert.equal(plain.lines.length, 2);
  assert.equal(col.lines.length, 4);
  assert.equal(strip(col.lines[0]), '─'.repeat(56));
  assert.equal(strip(col.lines[3]), '─'.repeat(56));
  assert.deepEqual(col.lines.slice(1, 3).map(strip), plain.lines);
  assert.match(col.lines[1], new RegExp(`\\x1b\\[1;36mfwdloop\\x1b\\[0m \\x1b\\[90m${VRE}`));
  assert.match(col.lines[1], /\x1b\[31mnot installed\x1b\[0m — no fwdloop folder yet, pick \x1b\[1;36m5\x1b\[0m install/);
  assert.ok(col.lines[1].includes(`panel \x1b[32mrunning\x1b[0m at \x1b[36m${panelUrl(port)}\x1b[0m`), col.lines[1]);
  assert.match(col.lines[2], /\x1b\[90mruns:\x1b\[0m \x1b\[90m0 running\x1b\[0m/);
  const io = sink();
  await menuCmd(io, { ...base, ask: async () => 'q', paint: makePaint({ isTTY: true }, {}) });
  assert.equal(io.lines.at(-1), `  ${'\x1b[1;36m1\x1b[0m'} start   \x1b[1;36m2\x1b[0m stop   \x1b[1;36m3\x1b[0m restart   \x1b[1;36m4\x1b[0m status   \x1b[1;36m5\x1b[0m install   \x1b[1;36mq\x1b[0m quit`);
  const ioPlain = sink();
  await menuCmd(ioPlain, { ...base, ask: async () => 'q', paint: makePaint({ isTTY: false }, {}) });
  assert.equal(ioPlain.lines.at(-1), '1 start   2 stop   3 restart   4 status   5 install   q quit');
});

test('refusals are red on a colour terminal, plain words when stripped', async () => {
  const io = sink();
  const rc = await installCmd(io, { home: join(scratch(), 'fl'), root: scratch(), ports: [], nodeVersion: '20.1.0', version: '1.0.0', paint: makePaint({ isTTY: true }, {}), paintErr: makePaint({ isTTY: true }, {}) });
  assert.equal(rc, 1);
  const err = io.lines.find((l) => l.startsWith('ERR '));
  assert.match(err, /^ERR \x1b\[31mfwdloop needs node 22/);
  assert.match(strip(err), /needs node 22 or newer; this is node 20\.1\.0\. Nothing was changed\.$/);
});

test('launcherMain: stdout a TTY and no NO_COLOR -> coloured header; NO_COLOR set or not a TTY -> not a single escape code in it', async () => {
  const home = join(scratch(), 'fl');
  const launcher = { ports: [], timeoutMs: 50, nodeVersion: '22.1.0', version: V };
  // the header is what fwdloop wrote with out(); readline's own terminal codes (prompt echo) come after it and are not ours
  const run = async (isTTY, processEnv) => {
    const stdout = new PassThrough();
    stdout.isTTY = isTTY;
    stdout.columns = 80;
    const chunks = [];
    stdout.on('data', (c) => chunks.push(String(c)));
    const stdin = new PassThrough(); stdin.end('q\n');
    await launcherMain('menu', [], { stdin, stdout, stderr: { write: () => true }, home, root: home, launcher, processEnv });
    return chunks.join('').split('1 start')[0];
  };
  const on = await run(true, {});
  assert.match(on, /\x1b\[90m─{56}/);
  assert.doesNotMatch(await run(true, { NO_COLOR: '1' }), /\x1b/);
  assert.doesNotMatch(await run(true, { TERM: 'dumb' }), /\x1b/);
  assert.doesNotMatch(await run(false, {}), /\x1b/);
  assert.match(strip(on), new RegExp(`fwdloop ${VRE} · not installed — no fwdloop folder yet, pick 5 install · panel not running`));
});
