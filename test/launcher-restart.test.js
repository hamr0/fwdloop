// M4b am6 (borrowed-from: built from the signed text - bareloop's fix/records-and-stop had no restart/startedAt commit when this was written).
// Item 1: the header and `status` show when the panel started, in the panel's own date style (local MM/DD HH:MM, index.html rlShortDate); an older
// panel without the field shows nothing extra. Item 2: `restart` = the existing stop, then the existing start, on the same port when free.
// Scratch homes, a free HIGH port range (never 4800-4809), injected spawn / kill / opener: no real signal, no real panel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  statusCmd, restartCmd, menuCmd, headerLines,
} from '../src/launcher.js';
import { createPanelServer, panelUrl } from '../src/panel/server.js';
import {
  V, scratch, closers, closeAll, freeBase, fakePanel, installedHome,
} from './launcher-world.mjs';

after(closeAll);

const sink = () => { const lines = []; return { out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`), lines, text: () => lines.join('\n') }; };
const mortal = (onSignal) => {
  const dead = new Set();
  return (pid, sig) => {
    if (sig === 0) { if (dead.has(pid)) { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; } return; }
    onSignal(pid, sig); dead.add(pid);
  };
};
/** local MM/DD HH:MM, built independently of the launcher */
const short = (iso) => {
  const d = new Date(iso);
  const t = (n) => String(n).padStart(2, '0');
  return `${t(d.getMonth() + 1)}/${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}`;
};
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

const STAMP = '2026-10-24T21:40:00.000Z';

test('item 1: the header says "started MM/DD HH:MM" (local, the panel\'s style) after the url; status prints it too', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { pid: 4301, startedAt: STAMP });
  const lines = await headerLines(deps(home, base));
  assert.equal(lines[0], `fwdloop ${V} · installed ✓ · panel running at ${panelUrl(base)} · started ${short(STAMP)}`);
  const io = sink();
  assert.equal(await statusCmd(io, deps(home, base)), 0);
  assert.equal(io.lines.at(-1), `pid 4301 · version ${V} · 0 drafts open · 0 schedules on · started ${short(STAMP)}`);
});

test('item 1: a panel without startedAt (older) shows nothing extra in the header or status', async () => {
  const home = installedHome();
  const base = await freeBase();
  await fakePanel(base, { pid: 4302 });
  const lines = await headerLines(deps(home, base));
  assert.equal(lines[0], `fwdloop ${V} · installed ✓ · panel running at ${panelUrl(base)}`);
  const io = sink();
  await statusCmd(io, deps(home, base));
  assert.equal(io.lines.at(-1), `pid 4302 · version ${V} · 0 drafts open · 0 schedules on`);
});

test('item 2: restart with a panel up -> stop (SIGTERM its pid), then start on the SAME port even when a lower port is free', async () => {
  const home = installedHome();
  const base = await freeBase();
  const panel = await fakePanel(base + 1, { pid: 4303 });
  const kills = [];
  const d = deps(home, base, { kill: mortal((pid, sig) => { kills.push([pid, sig]); panel.close(); }) });
  const io = sink();
  const rc = await restartCmd([], io, d);
  assert.equal(rc, 0, io.text());
  assert.deepEqual(kills, [[4303, 'SIGTERM']]);
  assert.equal(d.spawned.length, 1);
  assert.equal(d.spawned[0].argv[d.spawned[0].argv.indexOf('--port') + 1], String(base + 1), 'same port');
  const text = io.text();
  assert.ok(text.indexOf('Panel stopped.') !== -1 && text.indexOf('Panel stopped.') < text.indexOf('Panel started'), text);
  assert.equal(io.lines.filter((l) => l.startsWith(`fwdloop ${V}`)).length, 1, 'one header');
});

test('item 2: restart with no panel running just starts (no kill)', async () => {
  const home = installedHome();
  const base = await freeBase();
  const kills = [];
  const d = deps(home, base, { kill: (p, s) => kills.push([p, s]) });
  const io = sink();
  assert.equal(await restartCmd([], io, d), 0, io.text());
  assert.deepEqual(kills, []);
  assert.equal(d.spawned.length, 1);
  assert.equal(io.lines.at(-1), `Panel started at ${panelUrl(base)} — opening the page.`);
});

test('item 2: restart with open drafts asks the stop question; n leaves it running and starts nothing; --yes skips the ask', async () => {
  const home = installedHome();
  const base = await freeBase();
  const panel = await fakePanel(base, { pid: 4304, drafts: 1 });
  const kills = [];
  const kill = mortal((pid, sig) => { kills.push([pid, sig]); panel.close(); });
  const asked = [];
  const d = deps(home, base, { kill, ask: async (q) => { asked.push(q); return 'n'; } });
  const no = sink();
  assert.equal(await restartCmd([], no, d), 0);
  assert.deepEqual(kills, []);
  assert.equal(d.spawned.length, 0, 'declined: nothing started');
  assert.equal(asked[0], 'Stop the panel? [y/N] ');
  assert.equal(no.lines.at(-1), 'Not stopped.');
  const d2 = deps(home, base, { kill, ask: async () => { throw new Error('--yes must not ask'); } });
  const yes = sink();
  assert.equal(await restartCmd(['--yes'], yes, d2), 0, yes.text());
  assert.deepEqual(kills, [[4304, 'SIGTERM']]);
  assert.equal(d2.spawned.length, 1);
});

test('item 2: the menu is "1 start   2 stop   3 restart   4 status   5 install   6 update   q quit"; 3 restarts, 4 is status, 5 is install; the unknown-choice line lists 1-5', async () => {
  const home = installedHome();
  const base = await freeBase();
  const io = sink();
  await menuCmd(io, deps(home, base, { ask: async () => 'q' }));
  assert.equal(io.lines.at(-1), '1 start   2 stop   3 restart   4 status   5 install   6 update   q quit');
  const r = sink();
  const dr = deps(home, base, { ask: async () => '3' });
  assert.equal(await menuCmd(r, dr), 0, r.text());
  assert.equal(dr.spawned.length, 1, '3 = restart (no panel: starts)');
  const bad = sink();
  assert.equal(await menuCmd(bad, deps(home, base, { ask: async () => '9' })), 1);
  assert.match(bad.text(), /one of: 1, 2, 3, 4, 5, 6, q/);
  const st = sink();
  assert.equal(await menuCmd(st, deps(home, await freeBase(), { ask: async () => '4' })), 0);
  assert.equal(st.lines.at(-1), 'Panel not running.');
});
