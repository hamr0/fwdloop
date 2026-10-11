// M4d amendment 6, piece B (items 3, 4, 5): Settings asks each row's provider for its model list (free), shows one line per
// row + model with a tick and both prices, and refuses a tick without both prices. $0: fetch is injected; every home is a tracked mkdtemp dir.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import {
  mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { configPath, readConfig } from '../src/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const KEY = 'canary-am6-b-aaaa-1111111111111111';
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am6b-${p}-`));
const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

function snapshot(dir) {
  const out = {};
  for (const n of readdirSync(dir).sort()) out[n] = statSync(path.join(dir, n)).isDirectory() ? 'dir' : readFileSync(path.join(dir, n), 'utf8');
  return out;
}

async function world(config, fetchImpl) {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `LIST_KEY=${KEY}\n`, { mode: 0o600 });
  writeFileSync(configPath(home), JSON.stringify(config));
  const calls = [];
  const srv = remember(await createPanelServer({
    port: 0, root: tmp('root'), settings: { home, env: {}, fetch: async (url, opts) => { calls.push({ url: String(url), headers: opts?.headers, method: opts?.method }); return fetchImpl(url, opts); } },
  }));
  HANDLES.push(srv);
  const rq = (method, url, body) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const hd = { host: `127.0.0.1:${srv.port}`, ...cookieHeader(srv.port) };
    if (method === 'POST') hd.origin = `http://127.0.0.1:${srv.port}`;
    if (data !== undefined) hd['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, headers: hd, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); resolve({ status: res.statusCode, text, json() { try { return JSON.parse(text); } catch { return null; } } }); });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
  return { home, calls, rq };
}
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('B1: the model list is one free GET of <Base URL>/models with the key in the header only; ids come back sorted; nothing is written', async () => {
  const cfg = { providers: { LIST_KEY: { shape: 'openai-api', baseUrl: 'https://list.example.test/v1/' } } };
  const w = await world(cfg, ok({ data: [{ id: 'm-b' }, { id: 'm-a' }, { id: 'm-b' }, { nope: 1 }] }));
  const before = snapshot(w.home);
  const r = (await w.rq('POST', '/api/settings/models', { slot: 'LIST_KEY' })).json();
  assert.deepEqual(r, { ok: true, models: ['m-a', 'm-b'] });
  assert.deepEqual(w.calls.map((c) => [c.method, c.url]), [['GET', 'https://list.example.test/v1/models']]);
  assert.equal(w.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(snapshot(w.home), before, 'listing writes nothing (listed-but-unticked models are not saved)');
});

test('B2: each API shape reads its own list shape and header (Anthropic data[].id with x-api-key; Gemini models[].name without the models/ prefix)', async () => {
  const a = await world({ providers: { LIST_KEY: { shape: 'anthropic-api', baseUrl: 'https://a.example.test/v1' } } }, ok({ data: [{ id: 'claude-ish' }] }));
  assert.deepEqual((await a.rq('POST', '/api/settings/models', { slot: 'LIST_KEY' })).json().models, ['claude-ish']);
  assert.equal(a.calls[0].headers['x-api-key'], KEY);
  const g = await world({ providers: { LIST_KEY: { shape: 'gemini-api', baseUrl: 'https://g.example.test/v1beta' } } }, ok({ models: [{ name: 'models/gem-1' }, { name: 'gem-2' }] }));
  assert.deepEqual((await g.rq('POST', '/api/settings/models', { slot: 'LIST_KEY' })).json().models, ['gem-1', 'gem-2']);
  assert.equal(g.calls[0].headers['x-goog-api-key'], KEY);
});

test('B3: a failed list says why in a plain sentence (the page then offers a typed model name box); no Base URL calls nothing; a key that is not a row is refused', async () => {
  const bad = await world({ providers: { LIST_KEY: { baseUrl: 'https://list.example.test/v1' } } }, async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.deepEqual((await bad.rq('POST', '/api/settings/models', { slot: 'LIST_KEY' })).json(), { ok: false, why: 'The provider refused the key.' });
  const empty = await world({ providers: { LIST_KEY: { baseUrl: 'https://list.example.test/v1' } } }, ok({ unexpected: true }));
  assert.deepEqual((await empty.rq('POST', '/api/settings/models', { slot: 'LIST_KEY' })).json(), { ok: false, why: 'The provider did not list any models.' });
  const none = await world({}, ok({ data: [] }));
  assert.deepEqual((await none.rq('POST', '/api/settings/models', { slot: 'LIST_KEY' })).json(), { ok: false, why: 'Type a Base URL for LIST_KEY in Settings.' });
  assert.equal(none.calls.length, 0);
  const stranger = await none.rq('POST', '/api/settings/models', { slot: 'NOT_A_ROW' });
  assert.deepEqual([stranger.status, stranger.json().refused], [400, 'unknown-provider']);
});

test('B4: ticking needs both prices - "Fill both prices to tick this model."; 0 is a price; an unticked line may stay empty; typed lines are saved', async () => {
  const w = await world({ providers: { LIST_KEY: { baseUrl: 'https://list.example.test/v1' } } }, ok({ data: [] }));
  const save = (body) => w.rq('POST', '/api/settings/model', { slot: 'LIST_KEY', ...body });
  const before = snapshot(w.home);
  for (const body of [{ model: 'm1', use: true }, { model: 'm1', use: true, inPerM: 1, outPerM: null }, { model: 'm1', use: true, inPerM: null, outPerM: null }]) {
    const r = await save(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().say, body.outPerM === null && body.inPerM === 1 ? 'Fill both price boxes or clear both.' : 'Fill both prices to tick this model.');
    assert.deepEqual(snapshot(w.home), before, 'nothing saved');
  }
  assert.equal((await save({ model: 'typed-one', use: false })).json().ok, true, 'a typed name is saved as an unticked, empty line');
  assert.equal((await save({ model: 'm1', use: true, inPerM: 0, outPerM: 0 })).json().ok, true, '0 / 0 is accepted');
  assert.deepEqual(readConfig({ home: w.home }).models.LIST_KEY, [{ model: 'typed-one', use: false }, { model: 'm1', use: true, inPerM: 0, outPerM: 0 }]);
});

test('B5: the page - a refresh-models button per key row (layout F: "⟳ Refresh"); one line per model with tick, Price in, Price out and nothing about thinking; a typed model box when the list failed; listing on open, Reload keys and Refresh, never on a save', () => {
  const build = PAGE.slice(PAGE.indexOf('function buildProviderRow('), PAGE.indexOf('function buildModelLine('));
  assert.match(build, /data-act="refresh-models"[^>]*aria-label="[^"]*"[^>]*>&#10227; Refresh</);
  const line = PAGE.slice(PAGE.indexOf('function buildModelLine('), PAGE.indexOf('function paintModels('));
  assert.deepEqual([...line.matchAll(/data-mf="(\w+)"/g)].map((m) => m[1]), ['use', 'inPerM', 'outPerM']);
  assert.match(PAGE, /data-testid="model-typed"/);
  assert.match(PAGE, /postJSON\("\/api\/settings\/models"/);
  const settingsJs = PAGE.slice(PAGE.indexOf('M4d piece 4: Settings.'), PAGE.indexOf('// theme toggle'));
  assert.match(settingsJs, /settings-open"\)\.addEventListener\("click", function\(\)\{[^}]*loadProviders\(true\)/);
  assert.match(settingsJs, /reload-keys"\)\.addEventListener\("click", function\(\)\{ loadProviders\(true\)/);
  const saveModelFn = settingsJs.slice(settingsJs.indexOf('function saveModel('), settingsJs.indexOf('function saveProvider('));
  assert.doesNotMatch(saveModelFn, /loadProviders\(true\)|refreshModels/);
});
