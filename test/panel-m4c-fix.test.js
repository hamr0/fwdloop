// M4c-fix group A — panel safety (docs/wiki/the-module-ladder.md, "M4c-fix", scope 1-7).
// Each test is written to go red with its one src change taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import {
  existsSync, readFileSync, statSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer, writeTokenFile } from '../src/panel/server.js';
import { remember, cookieHeader, cookieName } from '../scripts/panel-fixtures/panel-auth.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4cfix-${p}-`));

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));
async function start(root = tmp('root'), opts = {}) {
  const h = remember(await createPanelServer({ port: 0, root, ...opts }));
  HANDLES.push(h);
  return h;
}

/** Raw request; sends the panel's cookie unless `headers` names its own. */
function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host: `127.0.0.1:${port}`, ...cookieHeader(port), ...headers };
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    const r = http.request({
      host: '127.0.0.1', port, method, path: url, headers: h, agent: false,
    }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        resolve({
          status: res.statusCode, headers: res.headers, text, json() { try { return JSON.parse(text); } catch { return null; } },
        });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

// --- item 2: token file, link, cookie -------------------------------------
test('item 2 (ii): every request needs the cookie — page, /api, POST — 403 without, and no body carries the token', async () => {
  const h = await start();
  const none = { cookie: '' };
  const wrong = { cookie: `${cookieName(h.port)}=${'0'.repeat(64)}` };
  for (const headers of [none, wrong]) {
    for (const [method, url] of [['GET', '/'], ['GET', '/index.html'], ['GET', '/api/runs'], ['GET', '/api/inbox'], ['HEAD', '/'], ['POST', '/api/answer'], ['PUT', '/api/answer']]) {
      const r = await rq(h.port, {
        method, url, headers: { ...headers, origin: `http://127.0.0.1:${h.port}` }, body: method === 'POST' ? '{}' : undefined,
      });
      assert.equal(r.status, 403, `${method} ${url}`);
      assert.ok(!r.text.includes(h.token) && !JSON.stringify(r.headers).includes(h.token), 'the refusal carries no token');
    }
  }
  assert.equal((await rq(h.port, { url: '/' })).status, 200, 'with the cookie the page is served');
});

test('item 2: the printed link sets an HttpOnly SameSite=Strict cookie and redirects to /; a wrong ?t= sets nothing', async () => {
  const h = await start();
  const link = await rq(h.port, { url: `/?t=${h.token}`, headers: { cookie: '' } });
  assert.equal(link.status, 302);
  assert.equal(link.headers.location, '/');
  const sc = String(link.headers['set-cookie']);
  assert.match(sc, new RegExp(`^${cookieName(h.port)}=${h.token};`));
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  const bad = await rq(h.port, { url: `/?t=${'f'.repeat(64)}`, headers: { cookie: '' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers['set-cookie'], undefined);
  const elsewhere = await rq(h.port, { url: `/api/runs?t=${h.token}`, headers: { cookie: '' } });
  assert.equal(elsewhere.status, 403, 'the link works on / only');
  const page = await rq(h.port, { url: '/' });
  assert.ok(!page.text.includes(h.token), 'the served page carries no token');
});

test('item 2 (ii): writeTokenFile — dir 0700, file 0600, replaced (even a loose old one), XDG_RUNTIME_DIR first; a symlinked dir is refused', () => {
  const xdg = tmp('xdg');
  const file = writeTokenFile({ port: 4801, token: 'a'.repeat(64), env: { XDG_RUNTIME_DIR: xdg } });
  assert.equal(file, path.join(xdg, 'fwdloop', 'panel-4801.token'));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(readFileSync(file, 'utf8').trim(), 'a'.repeat(64));
  // an old, loose file is replaced by a 0600 one
  const dir = path.dirname(file);
  const loose = path.join(dir, 'panel-4802.token');
  writeTokenFile({ port: 4802, token: 'b'.repeat(64), dir });
  assert.equal(statSync(loose).mode & 0o777, 0o600);
  writeTokenFile({ port: 4802, token: 'c'.repeat(64), dir });
  assert.equal(readFileSync(loose, 'utf8').trim(), 'c'.repeat(64));
  const real = tmp('real');
  const link = path.join(tmp('lnk'), 'fwdloop');
  symlinkSync(real, link);
  assert.throws(() => writeTokenFile({ port: 4803, token: 'd'.repeat(64), dir: link }), /not a directory owned by this user/);
  assert.equal(existsSync(path.join(real, 'panel-4803.token')), false);
});
