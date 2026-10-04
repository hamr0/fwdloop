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

// --- item 6: an over-limit body is cut off at once ------------------------------------------------
test('item 6: a body over the limit gets 413 while the client is still sending — it is not read to its end — and the connection is cut', async () => {
  const h = await start();
  const r = http.request({
    host: '127.0.0.1', port: h.port, method: 'POST', path: '/api/answer', agent: false,
    headers: { host: `127.0.0.1:${h.port}`, origin: `http://127.0.0.1:${h.port}`, ...cookieHeader(h.port), 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
  });
  r.on('error', () => {}); // the cut connection may surface as a reset on our side
  try {
    const got = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no 413 within 3 s: the server is still waiting for the body to end')), 3000);
      r.on('response', (res) => {
        const ch = [];
        res.on('data', (c) => ch.push(c));
        res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, text: Buffer.concat(ch).toString('utf8'), conn: res.headers.connection }); });
        res.on('error', () => {});
      });
      r.write(Buffer.alloc(20 * 1024, 120)); // past the 8 KiB limit — and the request is never ended
    });
    assert.equal(got.status, 413);
    assert.equal(JSON.parse(got.text).refused, 'body-too-large');
    assert.equal(got.conn, 'close');
    // and the server cut the socket: it closes on our side without us ending the request
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('socket still open 3 s after the 413')), 3000);
      if (r.socket?.destroyed) { clearTimeout(t); resolve(); return; }
      r.socket?.once('close', () => { clearTimeout(t); resolve(); });
    });
  } finally {
    r.destroy();
  }
});

// --- item 7: two resumes of one run never share a log file ----------------------------------------
test('item 7: a second resume of the same run has its own log — its clean exit does not delete the first one\'s reason', async () => {
  const { createResumer } = await import('../src/panel/resume.js');
  const dir = tmp('logs');
  const logDir = path.join(dir, 'logs');
  const countFile = path.join(dir, 'spawns');
  const releaseFile = path.join(dir, 'release');
  const runDir = path.join(dir, 'run');
  mkdirSync(runDir);
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'panel-fixtures', 'panel-resume-sleep.mjs');
  const resumer = createResumer({
    root: dir, bin, logDir, windowMs: 30000, maxTries: 1, env: { PATH: process.env.PATH, SPAWN_COUNT_FILE: countFile, RELEASE_FILE: releaseFile },
  });
  const logs = () => readdirSync(logDir).filter((f) => f.endsWith('.log'));
  const waitUntil = async (fn) => { for (let i = 0; i < 300; i += 1) { if (fn()) return; await new Promise((r) => { setTimeout(r, 20); }); } throw new Error(`timed out: ${fn}`); };
  try {
    resumer.start({ flow: 'f', runId: 'run-1', runDir, askId: 'a1' }); // the first resume: alive, its reason in its log
    await waitUntil(() => existsSync(countFile) && logs().length === 1 && readFileSync(path.join(logDir, logs()[0]), 'utf8').includes('first-reason'));
    resumer.start({ flow: 'f', runId: 'run-1', runDir, askId: 'a1' }); // the second: exits 0 at once, deleting ITS log
    await waitUntil(() => readFileSync(countFile, 'utf8').trim().split('\n').length === 2);
    await new Promise((r) => { setTimeout(r, 400); }); // let the second's exit and its log removal happen
    assert.equal(logs().length, 1, `the first resume's log must survive the second's clean exit; logs: ${logs()}`);
    assert.match(readFileSync(path.join(logDir, logs()[0]), 'utf8'), /first-reason/);
  } finally {
    writeFileSync(releaseFile, '');
  }
});

// --- amendment 1 (e)(2): a new resume start deletes the previous, finished resume's log ------------
test('amendment 1 (e)(2): starting a new resume deletes the old finished resume\'s log; the new one keeps its own', async () => {
  const { createResumer } = await import('../src/panel/resume.js');
  const dir = tmp('oldlog');
  const logDir = path.join(dir, 'logs');
  const runDir = path.join(dir, 'run');
  mkdirSync(runDir);
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'panel-fixtures', 'panel-resume-echo-key-fail.mjs');
  const resumer = createResumer({ root: dir, bin, logDir, windowMs: 30000, maxTries: 1, env: { PATH: process.env.PATH } });
  const waitUntil = async (fn) => { for (let i = 0; i < 300; i += 1) { if (fn()) return; await new Promise((r) => { setTimeout(r, 20); }); } throw new Error(`timed out: ${fn}`); };
  resumer.start({ flow: 'f', runId: 'run-1', runDir, askId: 'a1' });   // refuses (exit 1): its log is kept, finished
  await waitUntil(() => resumer.get('f', 'run-1').state === 'stuck');
  const first = resumer.get('f', 'run-1').logPath;
  assert.ok(existsSync(first), 'a refusing resume keeps its log');
  resumer.start({ flow: 'f', runId: 'run-1', runDir, askId: 'a1' });   // a new resume: the old finished one's log goes
  await waitUntil(() => resumer.get('f', 'run-1').state === 'stuck');
  const second = resumer.get('f', 'run-1').logPath;
  assert.notEqual(second, first);
  assert.equal(existsSync(first), false, 'the old finished resume\'s log is deleted when a new one starts');
  assert.equal(existsSync(second), true, 'the new resume keeps its own log');
});

// --- negative (xi): a run from before M4c-fix renders and none of its files is rewritten ----------
test('negative (xi): a pre-M4c-fix run is served as before and the panel rewrites none of its files (bytes and mtimes unchanged)', async () => {
  const { root } = symlinkedFlowRoot();
  const runDir = path.join(root, 'ok', 'runs', 'run-1');
  writeFileSync(path.join(runDir, 'audit.jsonl'), '');
  writeFileSync(path.join(runDir, 'ask.json'), JSON.stringify({ askId: 'a1' }));
  const snap = () => readdirSync(runDir).sort().map((f) => `${f}:${statSync(path.join(runDir, f)).mtimeMs}:${readFileSync(path.join(runDir, f), 'utf8')}`);
  const before = snap();
  const h = await start(root);
  for (const sub of ['', '/audit', '/job', '/asks']) await rq(h.port, { url: `/api/runs/ok/run-1${sub}` });
  await rq(h.port, { url: '/api/runs' });
  await rq(h.port, { url: '/api/inbox' });
  assert.equal((await rq(h.port, { url: '/api/runs/ok/run-1' })).status, 200, 'the old run still renders');
  assert.deepEqual(snap(), before);
});

test('exit walk: a browser GET / with no cookie gets a plain 403 page saying what to do (no token, no script); API routes keep the JSON 403', async () => {
  const h = await start();
  const nock = { cookie: '' };
  const page = await rq(h.port, { headers: { ...nock, accept: 'text/html,application/xhtml+xml' } });
  assert.equal(page.status, 403);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /open the link printed in the terminal/);
  assert.equal(page.text.includes(h.token), false, 'no token in the body');
  assert.doesNotMatch(page.text, /<script/i);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  const api = await rq(h.port, { url: '/api/runs', headers: { ...nock, accept: 'text/html' } });
  assert.equal(api.status, 403);
  assert.equal(api.json().refused, 'cookie-missing-or-wrong');
  const fetchStyle = await rq(h.port, { headers: { ...nock, accept: '*/*' } });
  assert.equal(fetchStyle.json().refused, 'cookie-missing-or-wrong');
});
