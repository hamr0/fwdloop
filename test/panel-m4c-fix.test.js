// M4c-fix group A — panel safety (docs/wiki/the-module-ladder.md, "M4c-fix", scope 1-7).
// Each test is written to go red with its one src change taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer, handleRequest, writeTokenFile } from '../src/panel/server.js';
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

// --- item 3: anti-frame / no-store headers on EVERY response ---------------
test('item 3 (iii): every response — page, JSON, 404, 403, 405, 302, HEAD — carries X-Frame-Options, frame-ancestors and no-store', async () => {
  const h = await start();
  const own = { origin: `http://127.0.0.1:${h.port}` };
  const cases = [
    { url: '/' },
    { method: 'HEAD', url: '/' },
    { url: '/api/runs' },
    { url: '/api/inbox' },
    { url: '/api/runs/nope/nope' },
    { url: '/nope' },
    { method: 'PUT', url: '/api/answer', headers: own },
    { method: 'POST', url: '/api/answer', headers: own, body: '{bad' },
    { url: '/', headers: { cookie: '' } },
    { url: `/?t=${h.token}`, headers: { cookie: '' } },
    { url: '/', headers: { host: 'evil.example.com' } },
  ];
  for (const c of cases) {
    const r = await rq(h.port, c);
    const label = `${c.method ?? 'GET'} ${c.url} -> ${r.status}`;
    assert.equal(r.headers['x-frame-options'], 'DENY', label);
    assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'", label);
    assert.equal(r.headers['cache-control'], 'no-store', label);
  }
});

// --- items 4 + 5: flow must sit inside --root; no absolute path in any error body ----------------
/** root/ok is a real flow with a run; root/evil is a symlink to a flow OUTSIDE root, which also has a run. */
function symlinkedFlowRoot() {
  const root = tmp('root');
  const outside = tmp('outside');
  mkdirSync(path.join(outside, 'runs', 'run-1'), { recursive: true });
  writeFileSync(path.join(outside, 'runs', 'run-1', 'answer.json'), JSON.stringify({ askId: 'a1', decision: 'accept' }));
  mkdirSync(path.join(root, 'ok', 'runs', 'run-1'), { recursive: true });
  symlinkSync(outside, path.join(root, 'evil'));
  return { root, outside, outsideRun: path.join(outside, 'runs', 'run-1') };
}

test('item 4 (iv): a flow symlinked outside --root is refused BY NAME for every read and for answer and resume; nothing is written there', async () => {
  const { root, outside, outsideRun } = symlinkedFlowRoot();
  const h = await start(root);
  const own = { origin: `http://127.0.0.1:${h.port}`, 'content-type': 'application/json' };
  const before = readdirSync(outsideRun);
  for (const sub of ['', '/audit', '/job', '/asks']) {
    const r = await rq(h.port, { url: `/api/runs/evil/run-1${sub}` });
    assert.equal(r.status, 403, `GET ${sub}`);
    assert.equal(r.json().refused, 'flow-outside-root', `GET ${sub}`);
  }
  for (const [url, body] of [
    ['/api/answer', { flow: 'evil', runId: 'run-1', askId: 'a1', decision: 'accept' }],
    ['/api/resume', { flow: 'evil', runId: 'run-1' }],
  ]) {
    const r = await rq(h.port, { method: 'POST', url, headers: own, body });
    assert.equal(r.status, 403, url);
    assert.equal(r.json().refused, 'flow-outside-root', url);
    assert.ok(!r.text.includes(outside), 'the far end of the symlink is not named');
  }
  assert.deepEqual(readdirSync(outsideRun), before, 'nothing was written outside root');
  // control: a real flow inside root is not over-refused (it just has no such run data)
  const ok = await rq(h.port, { url: '/api/runs/ok/run-1' });
  assert.notEqual(ok.json()?.refused, 'flow-outside-root');
});

test('item 5 (v): no error body holds an absolute path — library, bad-runId, symlink and 500 refusals name paths relative to --root', async () => {
  const { root, outside } = symlinkedFlowRoot();
  const flowB = path.join(root, 'linkedruns');
  mkdirSync(flowB);
  symlinkSync(outside, path.join(flowB, 'runs'));
  const h = await start(root);
  const own = { origin: `http://127.0.0.1:${h.port}`, 'content-type': 'application/json' };
  const bodies = [];
  // library refusal: an answer to a run with no open ask names the run dir
  const lib = await rq(h.port, { method: 'POST', url: '/api/answer', headers: own, body: { flow: 'ok', runId: 'run-1', askId: 'a1', decision: 'accept' } });
  assert.equal(lib.status, 409);
  assert.match(lib.json().red, /ok\/runs\/run-1/, 'the path is shown relative to --root');
  bodies.push(lib.text);
  // runs/ symlinked outside the flow
  const sym = await rq(h.port, { method: 'POST', url: '/api/resume', headers: own, body: { flow: 'linkedruns', runId: 'run-1' } });
  assert.equal(sym.status, 400);
  bodies.push(sym.text);
  // flow refusals
  bodies.push((await rq(h.port, { url: '/api/runs/evil/run-1' })).text);
  bodies.push((await rq(h.port, { method: 'POST', url: '/api/resume', headers: own, body: { flow: 'evil', runId: 'run-1' } })).text);
  for (const b of bodies) {
    assert.ok(!b.includes(root) && !b.includes(outside) && !b.includes(tmpdir()), `absolute path in body: ${b}`);
    assert.doesNotMatch(b, /(^|[^\w:/.])\/(home|tmp|var|usr)\//, `absolute path in body: ${b}`);
  }
  // a 500: the route throws an Error whose message holds an absolute path — the body says "internal error" only
  const secretPath = `${outside}/secret-spot`;
  const fakeResumer = { start() { throw new Error(`boom at ${secretPath}`); }, get() { return null; } };
  const srv = http.createServer((req, res) => handleRequest(req, res, {
    root, port: /** @type {any} */ (srv.address()).port, token: 't'.repeat(64), resumer: fakeResumer,
  }));
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  const port = /** @type {any} */ (srv.address()).port;
  try {
    writeFileSync(path.join(root, 'ok', 'runs', 'run-1', 'answer.json'), JSON.stringify({ askId: 'a1', decision: 'accept' }));
    const r500 = await rq(port, {
      method: 'POST', url: '/api/resume', headers: { origin: `http://127.0.0.1:${port}`, cookie: `${cookieName(port)}=${'t'.repeat(64)}` }, body: { flow: 'ok', runId: 'run-1' },
    });
    assert.equal(r500.status, 500);
    assert.equal(r500.json().red, 'internal error');
    assert.ok(!r500.text.includes(secretPath) && !r500.text.includes('boom'), r500.text);
  } finally {
    await new Promise((r) => { srv.close(r); });
  }
});
