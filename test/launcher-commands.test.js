// borrowed-from: bareloop tests/launcher-commands.test.js@v0.47.1 (704d598)
// Adapted: fwdloop name/app/bin; the injected spawn is `({bin, argv, env, logPath})` (the launcher's start uses src/panel/spawn.js spawnDetached, which
// opens the log and detaches); the "started" panel is a real fwdloop createPanelServer on a scratch flows root; the silent-port words are am5 item 3's
// (bareloop 6d10023); `main` tests drive `launcherMain`; adds: the real spawnDetached writes panel.log (mode 600), the runs line counts a real parked run.
// M4b am4/am5 - start / stop / status / install / the menu. Scratch home, a free HIGH port range (never 4800-4809), injected spawn / kill / opener / stdin:
// no real signal is ever sent and no real panel is launched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  existsSync, statSync, mkdirSync, writeFileSync, readFileSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { createServer as httpServer } from 'node:http';
import { PassThrough } from 'node:stream';
import {
  startCmd, stopCmd, statusCmd, installCmd, menuCmd, launcherMain,
} from '../src/launcher.js';
import { createPanelServer, panelUrl } from '../src/panel/server.js';
import { makePaint } from '../src/tty-colour.js';
import {
  V, VRE, scratch, closers, closeAll, freeBase, squat, fakePanel, silentServer, installedHome, parkedRoot,
} from './launcher-world.mjs';

after(closeAll);

/** an injected kill that behaves like a process table: a real signal runs `onSignal` and the pid is then gone (signal 0 throws ESRCH) */
const mortal = (onSignal) => {
  const dead = new Set();
  return (pid, sig) => {
    if (sig === 0) { if (dead.has(pid)) { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; } return; }
    onSignal(pid, sig); dead.add(pid);
  };
};
const sink = () => { const lines = []; return { out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`), lines, text: () => lines.join('\n') }; };

/** deps for a scratch run; spawn starts a REAL panel server in-process on the --port it is given */
function deps(home, base, extra = {}) {
  const spawned = [];
  const root = join(scratch(), 'flows');
  mkdirSync(root);
  return {
    home, root, ports: [base, base + 1, base + 2, base + 3], timeoutMs: 2000, deadlineMs: 3000, nodeVersion: '22.1.0', version: V,
    fwdloopBin: '/x/bin/fwdloop', spawned,
    spawnFn: (a) => {
      spawned.push(a);
      const port = Number(a.argv[a.argv.indexOf('--port') + 1]);
      createPanelServer({ port, root: a.argv[a.argv.indexOf('--root') + 1], settings: { home, env: {} }, scheduler: { intervalMs: 0 } }).then((p) => { closers.push(p.close); });
      const child = new EventEmitter();
      child.unref = () => {};
      return child;
    },
    open: async () => true,
    ...extra,
  };
}

test('start: nothing running -> a detached panel on the first free port, waits for it, opens the page; the log is panel.log under the home; the panel is told its --root', async () => {
  const home = installedHome();
  const base = await freeBase();
  const d = deps(home, base);
  const opened = [];
  d.open = async (u) => { opened.push(u); return true; };
  const io = sink();
  const rc = await startCmd(io, d);
  assert.equal(rc, 0, io.text());
  assert.equal(io.lines[0], `fwdloop ${V} · installed ✓ · panel not running`);
  assert.equal(io.lines[1], 'runs: 0 running · 0 need you · 0 in all');
  assert.equal(io.lines.at(-1), `Panel started at ${panelUrl(base)} — opening the page.`);
  assert.deepEqual(opened, [panelUrl(base)]);
  assert.equal(d.spawned.length, 1);
  assert.equal(d.spawned[0].bin, '/x/bin/fwdloop');
  assert.deepEqual(d.spawned[0].argv, ['panel', '--port', String(base), '--root', d.root]);
  assert.equal(d.spawned[0].logPath, join(home, 'panel.log'));
  // a second start finds it by asking the ports and starts nothing
  const io2 = sink();
  assert.equal(await startCmd(io2, d), 0);
  assert.equal(d.spawned.length, 1, 'already running: nothing started');
  assert.equal(io2.lines.at(-1), `Panel already running at ${panelUrl(base)} — opening the page.`);
  assert.ok(io2.lines[0].endsWith(`panel running at ${panelUrl(base)}`));
});

test('start with the REAL detached spawn: the child\'s output is appended to panel.log (mode 600) and an unanswering panel is named at the deadline', async () => {
  const home = installedHome();
  const base = await freeBase();
  const script = join(scratch(), 'say.mjs');
  writeFileSync(script, 'console.log("child says hello", process.argv.slice(2).join(" "));\n');
  const d = deps(home, base, { fwdloopBin: script, deadlineMs: 1500 });
  delete d.spawnFn; // the default: spawnDetached
  const io = sink();
  assert.equal(await startCmd(io, d), 1, io.text());
  assert.match(io.text(), /did not answer within 1\.5 seconds\. See .*panel\.log/);
  const log = join(home, 'panel.log');
  const t0 = performance.now();
  while (!existsSync(log) || !readFileSync(log, 'utf8').includes('child says hello')) {
    if (performance.now() - t0 > 5000) assert.fail('the child never wrote panel.log');
    await new Promise((r) => { setTimeout(r, 50); });
  }
  assert.match(readFileSync(log, 'utf8'), new RegExp(`child says hello panel --port ${base} --root `));
  assert.equal(statSync(log).mode & 0o777, 0o600);
});

test('start: a port held by something that is not fwdloop is skipped and said so', async () => {
  const home = installedHome();
  const base = await freeBase();
  await squat(base);
  const d = deps(home, base);
  const io = sink();
  assert.equal(await startCmd(io, d), 0, io.text());
  assert.ok(io.lines.includes(`${base} is taken, using ${base + 1}.`), io.text());
  assert.equal(io.lines.at(-1), `Panel started at ${panelUrl(base + 1)} — opening the page.`);
});

test('start: a bareloop panel on the first port is "not fwdloop": skipped, never reported as ours', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { app: 'bareloop' });
  const d = deps(home, base);
  const io = sink();
  assert.equal(await startCmd(io, d), 0, io.text());
  assert.ok(io.lines.includes(`${base} is taken, using ${base + 1}.`), io.text());
});

test('start: every port taken -> plain words, nothing started, exit 1', async () => {
  const home = installedHome();
  const base = await freeBase();
  await squat(base); await squat(base + 1);
  const d = deps(home, base, { ports: [base, base + 1] });
  const io = sink();
  assert.equal(await startCmd(io, d), 1);
  assert.equal(d.spawned.length, 0);
  assert.match(io.text(), /taken by something else, so the panel was not started/);
});

test('start: no opener available -> the URL is printed instead', async () => {
  const home = installedHome();
  const base = await freeBase();
  const d = deps(home, base, { open: async () => false });
  const io = sink();
  assert.equal(await startCmd(io, d), 0);
  assert.equal(io.lines.at(-1), `Panel started at ${panelUrl(base)} — open it in your browser.`);
});

test('start: a panel that never answers -> deadline, says so and points at panel.log, exit 1', async () => {
  const home = installedHome();
  const base = await freeBase();
  const d = deps(home, base, { deadlineMs: 400, spawnFn: () => { const c = new EventEmitter(); c.unref = () => {}; return c; } });
  const io = sink();
  assert.equal(await startCmd(io, d), 1);
  assert.match(io.text(), /did not answer within 0\.4 seconds\. See .*panel\.log/);
});

test('stop: not running -> "Panel not running." and exit 0, no kill', async () => {
  const home = installedHome();
  const base = await freeBase();
  const kills = [];
  const io = sink();
  assert.equal(await stopCmd([], io, deps(home, base, { kill: (p, s) => kills.push([p, s]) })), 0);
  assert.equal(io.lines.at(-1), 'Panel not running.');
  assert.deepEqual(kills, []);
});

test('stop: a running panel with no drafts -> SIGTERM to the pid it reported (injected kill), waits until the port is quiet, "Panel stopped."', async () => {
  const home = installedHome();
  const base = await freeBase();
  const panel = await fakePanel(base, { pid: 4242 });
  const kills = [];
  const io = sink();
  const rc = await stopCmd([], io, deps(home, base, {
    kill: mortal((pid, sig) => { kills.push([pid, sig]); panel.close(); }),
    ask: async () => { throw new Error('must not ask when no draft is open'); },
  }));
  assert.equal(rc, 0, io.text());
  assert.deepEqual(kills, [[4242, 'SIGTERM']]);
  assert.equal(io.lines.at(-1), 'Panel stopped.');
});

test('stop: open drafts -> the warning, the ask; n leaves it running, y stops it; --yes skips the ask', async () => {
  const home = installedHome();
  const base = await freeBase();
  const panel = await fakePanel(base, { pid: 4243, drafts: 1 });
  const kills = [];
  const kill = mortal((pid, sig) => { kills.push([pid, sig]); panel.close(); });
  const asked = [];
  const no = sink();
  assert.equal(await stopCmd([], no, deps(home, base, { kill, ask: async (q) => { asked.push(q); return 'n'; } })), 0);
  assert.deepEqual(kills, [], 'declined: nothing signalled');
  assert.ok(no.lines.includes('1 draft is open in the panel and will be lost.'));
  assert.ok(no.lines.includes('Runs keep going. Scheduled runs wait until the panel is started again.'));
  assert.equal(asked[0], 'Stop the panel? [y/N] ');
  assert.equal(no.lines.at(-1), 'Not stopped.');
  const yes = sink();
  assert.equal(await stopCmd([], yes, deps(home, base, { kill, ask: async () => 'y' })), 0);
  assert.deepEqual(kills, [[4243, 'SIGTERM']]);
  assert.equal(yes.lines.at(-1), 'Panel stopped.');
});

test('stop --yes: no question even with drafts open; plural wording for several drafts', async () => {
  const home = installedHome();
  const base = await freeBase();
  const panel = await fakePanel(base, { pid: 4244, drafts: 2 });
  const io = sink();
  const rc = await stopCmd(['--yes'], io, deps(home, base, { kill: mortal(() => { panel.close(); }), ask: async () => { throw new Error('--yes must not ask'); } }));
  assert.equal(rc, 0, io.text());
  assert.equal(io.lines.at(-1), 'Panel stopped.');
});

test('stop: two panels found -> both pids signalled, ONE ask with the summed draft count, "2 panels stopped."; no which-one question', async () => {
  const home = installedHome();
  const base = await freeBase();
  const a = await fakePanel(base, { pid: 5001, drafts: 1 });
  const b = await fakePanel(base + 1, { pid: 5002, drafts: 2 });
  const kills = [];
  const kill = mortal((pid) => { kills.push(pid); (pid === 5001 ? a : b).close(); });
  const asked = [];
  const io = sink();
  assert.equal(await stopCmd([], io, deps(home, base, { kill, ask: async (q) => { asked.push(q); return 'y'; } })), 0, io.text());
  assert.deepEqual(kills, [5001, 5002]);
  assert.deepEqual(asked, ['Stop the panel? [y/N] '], 'exactly one ask');
  assert.ok(io.lines.includes('3 drafts are open in the panel and will be lost.'));
  assert.equal(io.lines.at(-1), '2 panels stopped.');
});

test('stop: two panels, answer n -> nothing signalled; --yes -> no ask, both stopped', async () => {
  const home = installedHome();
  const base = await freeBase();
  const a = await fakePanel(base, { pid: 5011, drafts: 1 });
  const b = await fakePanel(base + 1, { pid: 5012 });
  const kills = [];
  const kill = mortal((pid) => { kills.push(pid); (pid === 5011 ? a : b).close(); });
  const no = sink();
  assert.equal(await stopCmd([], no, deps(home, base, { kill, ask: async () => 'n' })), 0);
  assert.deepEqual(kills, []);
  assert.equal(no.lines.at(-1), 'Not stopped.');
  const yes = sink();
  assert.equal(await stopCmd(['--yes'], yes, deps(home, base, { kill, ask: async () => { throw new Error('--yes must not ask'); } })), 0, yes.text());
  assert.deepEqual(kills, [5011, 5012]);
  assert.equal(yes.lines.at(-1), '2 panels stopped.');
});

test('stop --port N (and any unknown option) is refused in plain words; nothing signalled (am5 item 1: stop --port is removed)', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { pid: 5021 });
  const kills = [];
  const io = sink();
  assert.equal(await stopCmd(['--port', String(base)], io, deps(home, base, { kill: (p) => kills.push(p) })), 1);
  assert.deepEqual(kills, []);
  assert.match(io.text(), /Unknown option "--port" — fwdloop stop takes only --yes\. It stops every panel it finds\./);
});

test('start with two panels found -> starts nothing (no spawn), says already running, opens the first', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { pid: 5031 });
  await fakePanel(base + 1, { pid: 5032 });
  const d = deps(home, base);
  const io = sink();
  assert.equal(await startCmd(io, d), 0, io.text());
  assert.equal(d.spawned.length, 0);
  assert.ok(io.lines.some((l) => l.startsWith(`Panel already running at ${panelUrl(base)} `)), io.text());
});

test('status with two panels found -> one line per panel, each led by its url', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { pid: 5041 });
  await fakePanel(base + 1, { pid: 5042 });
  const io = sink();
  assert.equal(await statusCmd(io, deps(home, base)), 0);
  assert.ok(io.lines.includes(`${panelUrl(base)} · pid 5041 · version ${V} · 0 drafts open · 0 schedules on`), io.text());
  assert.ok(io.lines.includes(`${panelUrl(base + 1)} · pid 5042 · version ${V} · 0 drafts open · 0 schedules on`), io.text());
});

test('status: not running -> header then "Panel not running.", exit 3 (the sub-command) but 0 from the menu; running -> pid, drafts, schedules, exit 0', async () => {
  const home = installedHome();
  const base = await freeBase();
  const none = sink();
  assert.equal(await statusCmd(none, deps(home, base)), 3);
  assert.equal(none.lines.length, 3);
  assert.match(none.lines[0], /panel not running$/);
  assert.equal(none.lines[2], 'Panel not running.');
  const viaMenu = sink();
  assert.equal(await menuCmd(viaMenu, deps(home, base, { ask: async () => '3' })), 0, 'the menu worked: exit 0');
  assert.equal(viaMenu.lines.at(-1), 'Panel not running.');
  await fakePanel(base + 2, { pid: 48213, drafts: 1, schedules: 3 });
  const io = sink();
  assert.equal(await statusCmd(io, deps(home, base)), 0);
  assert.ok(io.lines[0].endsWith(`panel running at ${panelUrl(base + 2)}`));
  assert.equal(io.lines[2], `pid 48213 · version ${V} · 1 draft open · 3 schedules on`);
});

test('install: creates what is missing (dir 700, .env 600, config.json), then says there is nothing to do; keys already in .env are untouched', async () => {
  const home = join(scratch(), 'fl');
  const io = sink();
  const d = deps(home, 1);
  assert.equal(await installCmd(io, d), 0, io.text());
  assert.match(io.lines[0], /not installed — no fwdloop folder yet, pick 4 install · panel not running/);
  assert.ok(io.lines.some((l) => /^Installed\. Created:/.test(l)));
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, '.env')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(home, '.env'), 'utf8'), /^# fwdloop keys/, 'the standard comment lines');
  assert.ok(existsSync(join(home, 'config.json')));
  writeFileSync(join(home, '.env'), 'MY_KEY=abc\n', { mode: 0o600 });
  const again = sink();
  assert.equal(await installCmd(again, d), 0);
  assert.equal(again.lines.at(-1), 'Already installed, nothing to do.');
  assert.match(again.lines[0], /installed ✓/);
  assert.equal(readFileSync(join(home, '.env'), 'utf8'), 'MY_KEY=abc\n');
});

test('install: a loose .env gets mode 600 and the config is never overwritten; node below 22 stops with nothing changed', async () => {
  const home = installedHome();
  writeFileSync(join(home, 'config.json'), '{"monthlyLimitUsd":5}\n');
  chmodSync(join(home, '.env'), 0o644);
  const io = sink();
  assert.equal(await installCmd(io, deps(home, 1)), 0);
  assert.equal(statSync(join(home, '.env')).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), '{"monthlyLimitUsd":5}\n');
  const fresh = join(scratch(), 'fl');
  const old = sink();
  assert.equal(await installCmd(old, deps(fresh, 1, { nodeVersion: '20.11.0' })), 1);
  assert.equal(existsSync(fresh), false, 'nothing created');
  assert.match(old.text(), /needs node 22 or newer; this is node 20\.11\.0\. Nothing was changed\./);
});

test('install: a key value already in .env is never read into the output or changed (the canary stays only in the file)', async () => {
  const home = installedHome();
  writeFileSync(join(home, '.env'), 'MY_PROVIDER_KEY=sk-canary-launcher-77f1\n', { mode: 0o600 });
  const io = sink();
  assert.equal(await installCmd(io, deps(home, 1)), 0);
  assert.ok(!io.text().includes('sk-canary-launcher-77f1'));
  assert.equal(readFileSync(join(home, '.env'), 'utf8'), 'MY_PROVIDER_KEY=sk-canary-launcher-77f1\n');
});

test('menu (the approved layout): two header lines, a blank line, the four choices, then the prompt; q quits 0', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base + 1, { pid: 48213 });
  const io = sink();
  const asked = [];
  const rc = await menuCmd(io, deps(home, base, { ask: async (q) => { asked.push(q); return 'q'; } }));
  assert.equal(rc, 0);
  assert.deepEqual(io.lines, [
    `fwdloop ${V} · installed ✓ · panel running at ${panelUrl(base + 1)}`,
    'runs: 0 running · 0 need you · 0 in all',
    '',
    '1 start   2 stop   3 status   4 install   q quit',
  ]);
  assert.deepEqual(asked, ['> ']);
});

test('menu: choice 3 runs status through the same code WITHOUT printing the header twice; an unknown choice is refused', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { pid: 48213, drafts: 1, schedules: 3 });
  const io = sink();
  assert.equal(await menuCmd(io, deps(home, base, { ask: async () => '3' })), 0);
  assert.equal(io.lines.filter((l) => l.startsWith(`fwdloop ${V}`)).length, 1);
  assert.equal(io.lines.at(-1), `pid 48213 · version ${V} · 1 draft open · 3 schedules on`);
  const bad = sink();
  assert.equal(await menuCmd(bad, deps(home, base, { ask: async () => '9' })), 1);
  assert.match(bad.text(), /unknown choice "9"/);
});

test('the runs line on every call counts a real parked run: the menu, status and start all show "0 running · 1 need you · 1 in all"', async () => {
  const home = installedHome();
  const base = await freeBase();
  const { root } = await parkedRoot();
  const m = sink();
  await menuCmd(m, deps(home, base, { root, ask: async () => 'q' }));
  assert.equal(m.lines[1], 'runs: 0 running · 1 need you · 1 in all');
  const s = sink();
  await statusCmd(s, deps(home, base, { root }));
  assert.equal(s.lines[1], 'runs: 0 running · 1 need you · 1 in all');
});

test('launcherMain: bare `fwdloop` shows the menu; the sub-commands status|install go through it with the header first', async () => {
  const home = installedHome();
  const base = await freeBase();
  const stdin = new PassThrough();
  const out = []; const err = [];
  const stdout = { write: (s) => { out.push(s); return true; } };
  const stderr = { write: (s) => { err.push(s); return true; } };
  const launcher = { ports: [base, base + 1], timeoutMs: 2000, nodeVersion: '22.1.0', version: V };
  const run = launcherMain('menu', [], { stdin, stdout, stderr, home, root: home, launcher });
  await new Promise((r) => { setTimeout(r, 300); });
  stdin.write('q\n');
  assert.equal(await run, 0);
  const text = out.join('');
  assert.match(text, new RegExp(`^fwdloop ${VRE} · installed ✓ · panel not running\nruns: 0 running · 0 need you · 0 in all\n\n1 start   2 stop   3 status   4 install   q quit\n`));
  const out2 = [];
  assert.equal(await launcherMain('status', [], { stdout: { write: (s) => { out2.push(s); return true; } }, stderr, home, root: home, launcher }), 3);
  assert.match(out2.join(''), new RegExp(`^fwdloop ${VRE} · installed ✓ · panel not running\nruns: `));
});

test('version: status shows the panel\'s own version; a differing panel gets the header note and the start line; a matching one gets neither; colour words equal plain', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { version: '0.0.0-old', pid: 777, drafts: 2, schedules: 1 });
  const st = sink();
  assert.equal(await statusCmd(st, deps(home, base)), 0);
  assert.equal(st.lines.at(-1), 'pid 777 · version 0.0.0-old · 2 drafts open · 1 schedule on');
  assert.ok(st.lines[0].endsWith(`panel running at ${panelUrl(base)} (version 0.0.0-old — stop and start to use ${V})`), st.lines[0]);
  const open = [];
  const s = sink();
  assert.equal(await startCmd(s, deps(home, base, { open: async (u) => { open.push(u); return true; } })), 0);
  assert.equal(s.lines.at(-2), `Panel already running at ${panelUrl(base)} — opening the page.`);
  assert.equal(s.lines.at(-1), `It is version 0.0.0-old; this fwdloop is ${V}. Run fwdloop stop, then fwdloop start, to use ${V}.`);
  assert.equal(open.length, 1);
  const col = sink();
  await startCmd(col, deps(home, base, { paint: makePaint({ isTTY: true }, {}) }));
  assert.match(col.lines.at(-1), /^\x1b\[33mIt is version 0\.0\.0-old/);
  assert.ok(col.lines.some((l) => l.includes(`\x1b[33m (version 0.0.0-old — stop and start to use ${V})\x1b[0m`)));
  const strip = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(strip(col.lines.at(-1)), s.lines.at(-1));
});

test('version: a panel on the CLI\'s own version gets no note and no extra start line', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { version: V });
  const s = sink();
  assert.equal(await startCmd(s, deps(home, base)), 0);
  assert.doesNotMatch(s.text(), /stop and start to use|It is version/);
  assert.ok(s.lines[0].endsWith(`panel running at ${panelUrl(base)}`));
  assert.equal(s.lines.at(-1), `Panel already running at ${panelUrl(base)} — opening the page.`);
});

test('start: a taken port that stays silent -> start waits, then names the port and how to find and end what holds it (am5 item 3 words), starts NOTHING, exit 1', async () => {
  const home = installedHome();
  const base = await freeBase();
  await silentServer(base);
  const d = deps(home, base, { timeoutMs: 200, silentWaitMs: 900 });
  const io = sink();
  const t0 = performance.now();
  const rc = await startCmd(io, d);
  const took = performance.now() - t0;
  assert.equal(rc, 1, io.text());
  assert.equal(d.spawned.length, 0, 'no second panel');
  assert.equal(io.lines.at(-1), `ERR Port ${base} is taken and not answering. To see what holds it: lsof -i :${base}. If it is a stuck fwdloop, end it: kill <pid>`);
  assert.ok(took >= 900, `waited only ${Math.round(took)} ms`);
  assert.ok(took < 4000, `waited ${Math.round(took)} ms`);
});

test('start: a taken port that answers late as fwdloop -> already running, nothing started', async () => {
  const home = installedHome();
  const base = await freeBase();
  const readyAt = performance.now() + 800;
  const s = httpServer((_q, res) => {
    if (performance.now() < readyAt) return; // loaded: no answer yet
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ app: 'fwdloop', version: V, pid: 4242, port: base, drafts: 0, schedules: 0 }));
  });
  const socks = new Set();
  s.on('connection', (c) => { socks.add(c); c.on('close', () => socks.delete(c)); });
  await new Promise((r) => { s.listen(base, '127.0.0.1', r); });
  closers.push(() => new Promise((r) => { for (const c of socks) c.destroy(); s.close(() => r(undefined)); }));
  const d = deps(home, base, { timeoutMs: 200, silentWaitMs: 5000 });
  const io = sink();
  assert.equal(await startCmd(io, d), 0, io.text());
  assert.equal(d.spawned.length, 0);
  assert.equal(io.lines.at(-1), `Panel already running at ${panelUrl(base)} — opening the page.`);
});

test('start: a taken port whose connection is refused after the free check is moved past, not waited on', async () => {
  const home = installedHome();
  const base = await freeBase();
  // portFree says busy for the first port, but nothing listens there: connection refused = a reply that is not fwdloop
  const d = deps(home, base, { portFree: async (p) => p !== base, silentWaitMs: 60000 });
  const io = sink();
  const t0 = performance.now();
  assert.equal(await startCmd(io, d), 0, io.text());
  assert.ok(performance.now() - t0 < 5000);
  assert.equal(io.lines.at(-1), `Panel started at ${panelUrl(base + 1)} — opening the page.`);
});

test('start: a taken silent port with a later free one still starts nothing (never a second panel next to a silent one)', async () => {
  const home = installedHome();
  const base = await freeBase();
  await silentServer(base);
  const d = deps(home, base, { timeoutMs: 100, silentWaitMs: 300 });
  assert.equal(await startCmd(sink(), d), 1);
  assert.equal(d.spawned.length, 0);
});

test('stop: a pid that is still alive at the deadline is named, exit 1, never "Panel stopped."; one that did stop is still named', async () => {
  const home = installedHome();
  const base = await freeBase();
  const a = await fakePanel(base, { pid: 5101 });
  const b = await fakePanel(base + 1, { pid: 5102 });
  const gone = new Set();
  const kill = (pid, sig) => {
    if (sig === 0) { if (gone.has(pid)) { const e = new Error('x'); e.code = 'ESRCH'; throw e; } return; }
    if (pid === 5101) { gone.add(pid); a.close(); } else b.close(); // 5102: its port goes quiet but the process lingers
  };
  const io = sink();
  const rc = await stopCmd(['--yes'], io, deps(home, base, { kill, deadlineMs: 500 }));
  assert.equal(rc, 1, io.text());
  assert.ok(io.lines.includes(`ERR The panel at ${panelUrl(base + 1)} (pid 5102) did not stop.`), io.text());
  assert.ok(io.lines.includes(`The panel at ${panelUrl(base)} (pid 5101) stopped.`), io.text());
  assert.ok(!io.text().includes('Panel stopped.') && !io.text().includes('panels stopped.'), io.text());
});
