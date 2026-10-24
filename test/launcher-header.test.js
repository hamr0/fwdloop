// borrowed-from: bareloop tests/launcher-header.test.js@v0.47.1 (704d598)
// Adapted: fwdloop name/app; the run counts come from fwdloop's listRuns rows (`live`, `needs`) - the SAME two reads the panel page makes for its Running now and
// Needs you sections (src/panel/index.html); installState follows fwdloop's config (a throw, not a `problem`); a real parked run in a scratch flows root.
// M4b am4 item 2 / am5 item 2: the two header lines every `fwdloop` call prints, from ONE function. Scratch homes, injected ports/fetch, nothing real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, chmodSync, readFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { countRuns, installState, probePanels, headerLines } from '../src/launcher.js';
import { createPanelServer, panelUrl, runsListForCount } from '../src/panel/server.js';
import {
  V, scratch, closers, closeAll, parkedRoot, fakePanel,
} from './launcher-world.mjs';

after(closeAll);

test('countRuns: running / need you / in all come from the panel\'s own rows (live, needs); a flow with no runs is not a run; a part that is 0 still counts', () => {
  const rows = [
    { flow: 'a', runId: 'run-1', live: true, needs: null },
    { flow: 'b', runId: 'run-1', live: false, needs: 'Resume' },
    { flow: 'c', runId: 'run-2', live: false, needs: 'Answer' },
    { flow: 'd', runId: 'run-1', live: false, needs: null, glyph: null, why: 'unreadable' },
    { flow: 'e', runId: null, glyph: null, why: 'this flow has no runs yet' },
  ];
  assert.deepEqual(countRuns(rows), { running: 1, needYou: 2, total: 4 });
  assert.deepEqual(countRuns([]), { running: 0, needYou: 0, total: 0 });
});

test('the runs line AGREES with the panel: a real parked run counts 1 need you, and the count equals what the panel page makes of the same /api/runs rows', async () => {
  const { root } = await parkedRoot();
  const rows = runsListForCount({ root });
  assert.deepEqual(countRuns(rows), { running: 0, needYou: 1, total: 1 });
  // the real panel's /api/runs, with the two filters the page applies (src/panel/index.html "running: ... r.live === true", "needs: ... r.needs !== ''")
  const h = await createPanelServer({ port: 0, root, settings: { home: scratch(), env: {} }, scheduler: { intervalMs: 0 } });
  closers.push(h.close);
  const data = await (await fetch(`${panelUrl(h.port)}/api/runs`)).json();
  const page = {
    running: data.rows.filter((r) => r.live === true).length,
    needs: data.rows.filter((r) => typeof r.needs === 'string' && r.needs !== '').length,
  };
  const c = countRuns(data.rows);
  assert.deepEqual({ running: c.running, needYou: c.needYou }, { running: page.running, needYou: page.needs });
  assert.equal(page.needs, 1);
  // the page still makes those two reads (if it changes how it splits Needs you, this line must follow it)
  const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.ok(PAGE.includes('running: data.rows.filter(function(r){ return r.live === true; })'));
  assert.ok(PAGE.includes('needs: data.rows.filter(function(r){ return typeof r.needs === "string" && r.needs !== ""; })'));
});

test('installState: missing folder, missing config, bad config, missing/loose .env, old node, then ok - the FIRST missing thing in plain words', () => {
  const root = scratch();
  const home = join(root, 'fl');
  const ok = { nodeVersion: '22.1.0' };
  assert.match(installState({ home, ...ok }).problem ?? '', /no fwdloop folder yet/);
  mkdirSync(home, { mode: 0o700 });
  assert.match(installState({ home, ...ok }).problem ?? '', /no settings file yet/);
  writeFileSync(join(home, 'config.json'), '{ not json');
  assert.match(installState({ home, ...ok }).problem ?? '', /config\.json/);
  writeFileSync(join(home, 'config.json'), '{}');
  assert.match(installState({ home, ...ok }).problem ?? '', /no keys file yet/);
  writeFileSync(join(home, '.env'), '', { mode: 0o644 });
  chmodSync(join(home, '.env'), 0o644);
  assert.match(installState({ home, ...ok }).problem ?? '', /readable by other users/);
  chmodSync(join(home, '.env'), 0o600);
  assert.match(installState({ home, nodeVersion: '20.11.0' }).problem ?? '', /node 22/);
  assert.deepEqual(installState({ home, ...ok }), { ok: true, problem: null });
});

test('probePanels: fwdloop answers win, a non-fwdloop answer (even a bareloop one) and a closed port are skipped; several are all listed', async () => {
  const base = 41000 + Math.floor(Math.random() * 15000);
  const a = await fakePanel(base, { drafts: 1 });
  const b = await fakePanel(base + 1);
  const other = await fakePanel(base + 2, { app: 'bareloop' });
  const ports = [a.port, other.port, b.port, base + 3];
  const found = await probePanels({ ports, timeoutMs: 2000 });
  assert.deepEqual(found.map((f) => f.port).sort(), [a.port, b.port].sort());
  assert.equal(found.find((f) => f.port === a.port)?.drafts, 1);
  assert.deepEqual(await probePanels({ ports: [other.port], timeoutMs: 2000 }), []);
});

test('headerLines: the two lines, installed + panel running; not installed + panel not running; zero parts still show', async () => {
  const root = scratch();
  const home = join(root, 'fl');
  const p = await fakePanel(41000 + Math.floor(Math.random() * 15000));
  const empty = join(root, 'flows');
  mkdirSync(empty);
  const noHome = await headerLines({ home, root: empty, ports: [1], version: V, nodeVersion: '22.1.0', timeoutMs: 100 });
  assert.equal(noHome.length, 2);
  assert.equal(noHome[0], `fwdloop ${V} · not installed — no fwdloop folder yet, pick 4 install · panel not running`);
  assert.equal(noHome[1], 'runs: 0 running · 0 need you · 0 in all');
  mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'config.json'), '{}');
  writeFileSync(join(home, '.env'), '', { mode: 0o600 });
  chmodSync(join(home, '.env'), 0o600);
  const lines = await headerLines({ home, root: empty, ports: [p.port], version: V, nodeVersion: '22.1.0', timeoutMs: 2000 });
  assert.equal(lines[0], `fwdloop ${V} · installed ✓ · panel running at ${panelUrl(p.port)}`);
  assert.equal(lines[1], 'runs: 0 running · 0 need you · 0 in all');
});

test('headerLines with a panel stopped and a real parked run: the line counts from the books alone ($0)', async () => {
  const { root } = await parkedRoot();
  const lines = await headerLines({ home: join(scratch(), 'fl'), root, ports: [1], version: V, nodeVersion: '22.1.0', timeoutMs: 100 });
  assert.equal(lines[1], 'runs: 0 running · 1 need you · 1 in all');
});

test('headerLines: a loaded panel that answers whoami after ~1500 ms still counts as running with the DEFAULT probe timeout (am5 item 2: 2000 ms, was 300)', async () => {
  const home = scratch();
  const server = createServer((_q, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ app: 'fwdloop', version: V, pid: 4242, drafts: 0, schedules: 0 }));
    }, 1500);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', () => r(undefined)); });
  closers.push(() => new Promise((r) => { server.closeAllConnections(); server.close(() => r(undefined)); }));
  const port = /** @type {any} */ (server.address()).port;
  // no timeoutMs: the production default decides
  const lines = await headerLines({ home, root: home, ports: [port], version: V, nodeVersion: '22.1.0' });
  assert.ok(lines[0].endsWith(`panel running at ${panelUrl(port)}`), lines[0]);
});

test('no address is written anywhere but panelUrl: src/launcher.js holds no http:// literal', () => {
  const text = readFileSync(new URL('../src/launcher.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /https?:\/\//);
});
