// borrowed-from: bareloop tests/launcher-whoami.test.js@v0.47.1 (704d598)
// Adapted: app 'fwdloop'; fwdloop's createPanelServer({root, settings, packagePath}); drafts = the open drafting card on disk; page header placeholder.
// M4b am4 item 7 / am5 item 5: `GET /api/whoami`, the launcher's probe route. Real socket, scratch dirs, port 0.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';

const handles = [];
after(async () => { await Promise.all(handles.map((h) => h.close())); });
const scratch = () => mkdtempSync(join(tmpdir(), 'fwdloop-whoami-'));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** @param {number} port @param {string} path @param {string} [host] @returns {Promise<{status: number, body: string}>} */
function get(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: host ? { host } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function panel(extra = {}) {
  const dir = scratch();
  const root = join(dir, 'flows');
  mkdirSync(root);
  const h = await createPanelServer({ port: 0, root, settings: { home: dir, env: {} }, scheduler: { intervalMs: 0 }, ...extra });
  handles.push(h);
  return { h, dir, root };
}

test('GET /api/whoami names the panel: app fwdloop, version, pid, port, drafts 0, schedules 0 - no token needed', async () => {
  const { h } = await panel();
  const r = await get(h.port, '/api/whoami');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.app, 'fwdloop');
  assert.equal(j.pid, process.pid);
  assert.equal(j.port, h.port);
  assert.equal(j.drafts, 0);
  assert.equal(j.schedules, 0);
  assert.equal(j.version, PKG.version);
});

test('GET /api/whoami is behind the same Host guard: a foreign Host is 403', async () => {
  const { h } = await panel();
  assert.equal((await get(h.port, '/api/whoami', 'evil.example:80')).status, 403);
});

test('whoami and the page header report the version the panel STARTED with, not what package.json says now (am5 item 5)', async () => {
  const dir = scratch();
  const pkg = join(dir, 'package.json');
  writeFileSync(pkg, JSON.stringify({ ...PKG, version: '1.2.3' }));
  const { h } = await panel({ packagePath: pkg });
  assert.equal(JSON.parse((await get(h.port, '/api/whoami')).body).version, '1.2.3');
  writeFileSync(pkg, JSON.stringify({ ...PKG, version: '9.9.9' })); // a bump on disk while the panel keeps running
  assert.equal(JSON.parse((await get(h.port, '/api/whoami')).body).version, '1.2.3');
  const page = (await get(h.port, '/')).body;
  assert.match(page, /data-version="1\.2\.3"/);
  assert.ok(!page.includes('9.9.9'), 'the page must not show the on-disk version');
});

test('whoami drafts is the open drafting card (a draft folder that is not abandoned or signed), schedules is the live schedules', async () => {
  const { h, root } = await panel();
  assert.equal(JSON.parse((await get(h.port, '/api/whoami')).body).drafts, 0);
  // a draft folder the panel made: <root>/.drafts/<id>/card.json, no abandoned.json / signed.json
  const id = `d-${Date.now().toString(36).padStart(10, '0')}-abcd`;
  const dd = join(root, '.drafts', id);
  mkdirSync(dd, { recursive: true });
  writeFileSync(join(dd, 'card.json'), JSON.stringify({ name: 'x', lines: ['1. do a thing'] }));
  const open = JSON.parse((await get(h.port, '/api/whoami')).body);
  assert.equal(open.drafts, 1, 'an unfinished draft card counts');
  writeFileSync(join(dd, 'abandoned.json'), JSON.stringify({ at: new Date().toISOString() }));
  assert.equal(JSON.parse((await get(h.port, '/api/whoami')).body).drafts, 0, 'an abandoned draft does not');
});

test('M4b am6 item 1: whoami carries startedAt, an ISO stamp set once when the panel starts (the same value on every ask)', async () => {
  const before = Date.now();
  const { h } = await panel();
  const a = JSON.parse((await get(h.port, '/api/whoami')).body);
  await new Promise((r) => { setTimeout(r, 30); });
  const b = JSON.parse((await get(h.port, '/api/whoami')).body);
  assert.match(a.startedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(a.startedAt) >= before - 1000 && Date.parse(a.startedAt) <= Date.now());
  assert.equal(b.startedAt, a.startedAt, 'set once, not per request');
});
