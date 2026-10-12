// M4d Providers: "[ Open keys folder ]" next to Reload keys (copied in shape from bareloop's button + route). The server opens the folder of its OWN
// keys file path, never a path from the request, through an injected opener here (no file manager ever opens in a test). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { configPath } from '../src/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

async function setup(settingsExtra = {}) {
  const home = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-okf-')), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), 'A_KEY=k-0123456789abcdef\n', { mode: 0o600 });
  writeFileSync(configPath(home), '{}');
  const h = remember(await createPanelServer({ port: 0, root: mkdtempSync(path.join(tmpdir(), 'fwdloop-okf-root-')), settings: { home, env: {}, ...settingsExtra } }));
  HANDLES.push(h);
  return { h, home };
}
function post(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/settings/open-keys-folder', agent: false,
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...cookieHeader(port) } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(ch).toString('utf8')) }));
    });
    r.on('error', reject); r.end(data);
  });
}
/** A fake spawn that records its call and "spawns" on the next tick (or errors). */
function fakeSpawn(log, { fail = false } = {}) {
  return (cmd, args, o) => {
    log.push({ cmd, args, o });
    const c = new EventEmitter(); c.unref = () => {};
    setImmediate(() => (fail ? c.emit('error', new Error('ENOENT')) : c.emit('spawn')));
    return c;
  };
}

test('route: opens exactly dirname(keys file) with an argv array, detached, no shell; result carries the folder path', async () => {
  const log = [];
  const { h, home } = await setup({ openFolderSpawn: fakeSpawn(log), platform: 'linux' });
  const r = await post(h.port, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, opened: true, path: path.dirname(keysFilePath(home)) });
  assert.equal(log.length, 1);
  assert.equal(log[0].cmd, 'xdg-open');
  assert.deepEqual(log[0].args, [path.dirname(keysFilePath(home))]);
  assert.equal(log[0].o.detached, true); assert.equal(log[0].o.stdio, 'ignore'); assert.ok(!('shell' in log[0].o));
  const mac = await setup({ openFolderSpawn: fakeSpawn(log), platform: 'darwin' });
  await post(mac.h.port, {});
  assert.equal(log[1].cmd, 'open');
});

test('route: a path in the body is refused and nothing opens; a failed or unknown opener hands the path back as text, nothing else', async () => {
  const log = [];
  const { h } = await setup({ openFolderSpawn: fakeSpawn(log), platform: 'linux' });
  for (const body of [{ path: '/etc' }, { dir: '/tmp' }, { folder: '../..' }]) {
    const r = await post(h.port, body);
    assert.equal(r.status, 400); assert.equal(r.json.ok, false); assert.equal(r.json.refused, 'no-path-allowed');
  }
  assert.equal(log.length, 0, 'nothing opened for a body path');
  const bad = await setup({ openFolderSpawn: fakeSpawn(log, { fail: true }), platform: 'linux' });
  assert.deepEqual((await post(bad.h.port, {})).json.opened, false);
  const win = await setup({ openFolderSpawn: fakeSpawn(log), platform: 'win32' });
  const w = await post(win.h.port, {});
  assert.equal(w.json.opened, false); assert.ok(w.json.path);
});

test('NODE_ENV=test: with no injected opener the real one is never called', async () => {
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const { h } = await setup({ platform: 'linux' });
    const r = await post(h.port, {});
    assert.equal(r.json.opened, false, 'no opener, no open');
  } finally { if (was === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was; }
});

test('page: [ Open keys folder ] sits in the KEYS strip next to Reload keys, with its aria-label', () => {
  assert.match(PAGE, /id="open-keys-folder"[^>]*data-testid="open-keys-folder"[^>]*aria-label="Open keys folder"[^>]*>Open keys folder<\/button>\s*<button class="btn small" id="reload-keys"/);
  assert.ok(PAGE.includes('/api/settings/open-keys-folder'));
});
