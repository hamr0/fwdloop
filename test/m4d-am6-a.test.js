// M4d amendment 6, piece A (docs/wiki/the-module-ladder.md, "M4d amendment 6" items 1, 2, 8): providers come only from the
// keys file. Every key with a value is a row named by its env name; shape, Base URL and legacyMaxTokens are typed per row;
// no built-in row, no default address, no balance rule. $0, no network: fetch is injected, every home is a tracked mkdtemp dir.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath, loadKeysEnv } from '../src/keysfile.js';
import { configPath, readConfig } from '../src/config.js';
import * as provider from '../src/provider.js';
import { SHAPES } from '../src/providershapes.js';

const KEY_A = 'canary-am6-a-aaaa-1111111111111111';
const KEY_B = 'canary-am6-a-bbbb-2222222222222222';
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am6a-${p}-`));
const LINE = { model: 'm-1', use: true, inPerM: 0.5, outPerM: 1.5 };

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

function home(keysText, config) {
  const h = path.join(tmp('home'), 'fwdloop');
  mkdirSync(h, { recursive: true, mode: 0o700 });
  if (keysText !== null) writeFileSync(keysFilePath(h), keysText, { mode: 0o600 });
  if (config !== undefined) writeFileSync(configPath(h), JSON.stringify(config));
  return h;
}

async function panel(h, fetchImpl) {
  const calls = [];
  const srv = remember(await createPanelServer({
    port: 0,
    root: tmp('root'),
    settings: { home: h, env: {}, fetch: async (url, opts) => { calls.push({ url: String(url), headers: opts?.headers }); return (fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })))(url, opts); } },
  }));
  HANDLES.push(srv);
  return { srv, calls };
}

function rq(port, { method = 'GET', url = '/', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const hd = { host: `127.0.0.1:${port}`, ...cookieHeader(port) };
    if (method === 'POST') hd.origin = `http://127.0.0.1:${port}`;
    if (data !== undefined) hd['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: hd, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); resolve({ status: res.statusCode, json() { try { return JSON.parse(text); } catch { return null; } } }); });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

test('A1: the built-in rows and the fixed draft slot are gone from provider.js', () => {
  assert.equal(provider.PROVIDER_SLOTS, undefined);
  assert.equal(provider.MODEL_SLOT, undefined);
});

test('A2: a row is read from what was typed for its key name: shape, Base URL (no trailing slash), legacyMaxTokens; nothing typed = no address', () => {
  const typed = provider.resolveSlot('ACME_API_KEY', { config: { providers: { ACME_API_KEY: { shape: 'openai-api', baseUrl: 'http://127.0.0.1:9/v1/', legacyMaxTokens: true } } } });
  assert.deepEqual([typed.slot, typed.envVar, typed.shape, typed.baseUrl, typed.legacyMaxTokens], ['ACME_API_KEY', 'ACME_API_KEY', 'openai-api', 'http://127.0.0.1:9/v1', true]);
  const bare = provider.resolveSlot('ACME_API_KEY', { config: {} });
  assert.deepEqual([bare.baseUrl, bare.legacyMaxTokens], ['', false]);
  assert.equal(provider.resolveSlot('ACME_API_KEY', { config: { providers: { ACME_API_KEY: { shape: 'anthropic-api', legacyMaxTokens: true } } } }).legacyMaxTokens, false, 'legacy max_tokens is an OpenAI-shape quirk');
  assert.throws(() => provider.resolveSlot('not a name', { config: {} }), /unknown provider/);
});

test('A3: a row with no Base URL cannot run: refused by name, nothing built', () => {
  const h = home(null, { models: { ACME_API_KEY: [LINE] } });
  assert.throws(() => provider.makeProvider('ACME_API_KEY', { model: 'm-1', env: { ACME_API_KEY: KEY_A }, configHome: h }), (e) => e instanceof provider.ModelRefusal && e.message === 'Type a Base URL for ACME_API_KEY in Settings.');
});

test('A4: legacyMaxTokens is the row\'s own tick: on sends max_tokens, off sends max_completion_tokens', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => { seen.push(JSON.parse(Buffer.concat(ch).toString('utf8'))); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'm-1' })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    for (const legacy of [true, false]) {
      const h = home(null, { models: { ACME_API_KEY: [LINE] }, providers: { ACME_API_KEY: { shape: 'openai-api', baseUrl: `http://127.0.0.1:${server.address().port}`, legacyMaxTokens: legacy } } });
      await provider.makeProvider('ACME_API_KEY', { model: 'm-1', env: { ACME_API_KEY: KEY_A }, configHome: h }).provider.generate([{ role: 'user', content: 'x' }], [], { maxTokens: 50 });
    }
  } finally { server.close(); }
  assert.deepEqual(seen.map((b) => [b.max_tokens !== undefined, b.max_completion_tokens !== undefined]), [[true, false], [false, true]]);
});

test('A5: the keys file: every name with a value is a row; only a name that has a row set up reaches the env (a NODE_OPTIONS line never does)', () => {
  const h = home(`ACME_API_KEY=${KEY_A}\nOTHER_KEY=${KEY_B}\nNODE_OPTIONS=--require /tmp/x\nEMPTY_ONE=\n`);
  const a = loadKeysEnv({ env: {}, home: h, configured: ['ACME_API_KEY'] });
  assert.deepEqual(a.names, ['ACME_API_KEY', 'NODE_OPTIONS', 'OTHER_KEY']);
  assert.equal(a.env.ACME_API_KEY, KEY_A);
  assert.equal(a.env.OTHER_KEY, undefined);
  assert.equal(a.env.NODE_OPTIONS, undefined);
  assert.deepEqual(a.keyNames, ['ACME_API_KEY']);
  const none = loadKeysEnv({ env: { ACME_API_KEY: 'from-shell-1234567890' }, home: h, configured: [] });
  assert.equal(none.env.ACME_API_KEY, 'from-shell-1234567890', 'the shell is never filtered');
  assert.deepEqual(none.keyNames, [], 'a name nobody set up is not a key to scrub or pass on');
});

test('A6: Settings lists a row per key in the file, named by its env name, with nothing built in; an empty file lists none', async () => {
  const empty = await panel(home(null));
  const none = (await rq(empty.srv.port, { url: '/api/settings/providers' })).json();
  assert.deepEqual(none.rows, []);

  const h = home(`ZED_KEY=${KEY_B}\nACME_API_KEY=${KEY_A}\n`, { providers: { ACME_API_KEY: { shape: 'openai-api', baseUrl: 'https://proxy.example.com/v1', legacyMaxTokens: true } }, models: { ACME_API_KEY: [LINE] } });
  const { srv } = await panel(h);
  const body = (await rq(srv.port, { url: '/api/settings/providers' })).json();
  assert.deepEqual(body.rows.map((r) => r.slot), ['ACME_API_KEY', 'ZED_KEY']);
  const [acme, zed] = body.rows;
  assert.deepEqual([acme.envVar, acme.keyStatus, acme.shape, acme.baseUrl, acme.legacyMaxTokens], ['ACME_API_KEY', 'set in file', 'openai-api', 'https://proxy.example.com/v1', true]);
  assert.deepEqual(acme.models.map((m) => m.model), ['m-1']);
  assert.deepEqual([zed.shape, zed.baseUrl, zed.legacyMaxTokens, zed.models], ['openai-api', '', false, []]);
  assert.equal(JSON.stringify(body).includes(KEY_A), false, 'no key value on the page');
});

test('A7: the provider route saves shape, Base URL and legacyMaxTokens for a row of the file only', async () => {
  const h = home(`ACME_API_KEY=${KEY_A}\n`);
  const { srv } = await panel(h);
  const ok = await rq(srv.port, { method: 'POST', url: '/api/settings/provider', body: { slot: 'ACME_API_KEY', shape: 'openai-api', baseUrl: 'http://127.0.0.1:9/v1/', legacyMaxTokens: true } });
  assert.equal(ok.json().ok, true);
  assert.deepEqual(readConfig({ home: h }).providers, { ACME_API_KEY: { shape: 'openai-api', baseUrl: 'http://127.0.0.1:9/v1', legacyMaxTokens: true } });
  const stranger = await rq(srv.port, { method: 'POST', url: '/api/settings/provider', body: { slot: 'NOT_IN_THE_FILE', baseUrl: 'http://127.0.0.1:9' } });
  assert.deepEqual([stranger.status, stranger.json().refused], [400, 'unknown-provider']);
  const bad = await rq(srv.port, { method: 'POST', url: '/api/settings/provider', body: { slot: 'ACME_API_KEY', legacyMaxTokens: 'yes' } });
  assert.equal(bad.json().refused, 'bad-provider');
});

test('A8: Test with no Base URL says so and calls nothing; with one it GETs <Base URL>/models; Balance is gone', async () => {
  const h = home(`ACME_API_KEY=${KEY_A}\n`);
  const { srv, calls } = await panel(h);
  const t1 = (await rq(srv.port, { method: 'POST', url: '/api/settings/test', body: { slot: 'ACME_API_KEY' } })).json();
  assert.deepEqual([t1.ok, t1.why], [false, 'Type a Base URL for ACME_API_KEY in Settings.']);
  assert.equal(calls.length, 0);
  await rq(srv.port, { method: 'POST', url: '/api/settings/provider', body: { slot: 'ACME_API_KEY', baseUrl: 'http://127.0.0.1:9/v1' } });
  const t2 = (await rq(srv.port, { method: 'POST', url: '/api/settings/test', body: { slot: 'ACME_API_KEY' } })).json();
  assert.equal(t2.ok, true);
  assert.deepEqual(calls.map((c) => c.url), ['http://127.0.0.1:9/v1/models']);
  const bal = await rq(srv.port, { url: '/api/settings/balance?slot=ACME_API_KEY' });
  assert.deepEqual([bal.status, bal.json().refused], [404, 'no-such-settings-route']);
});

test('A9: no API shape carries a default web address', () => {
  for (const s of SHAPES) assert.equal(Object.hasOwn(s, 'defaultUrl'), false, s.id);
});
