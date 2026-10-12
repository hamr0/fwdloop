// M4d amendment 3, part C (docs/wiki/the-module-ladder.md, "M4d amendment 3", items 7-11): a price per MODEL.
// $0, no network. Every test builds its own config home under a tracked mkdtemp dir.
// Store: config.json `models.<slot> = [{ model, use, inPerM?, outPerM? }]` (USD per 1M; a price is a pair or absent).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import {
  mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';
import {
  configPath, readConfig, updateConfig, ConfigError, modelsProblem,
} from '../src/config.js';
import { resolveUsableModel } from '../src/provider.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CANARY = 'canary-key-m4d-am3c-9f8e7d6c5b4a39281706';
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4dam3c-${p}-`));
const newHome = () => path.join(tmp('home'), 'fwdloop');
const HALF = 'Fill both price boxes or clear both.';

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

async function setup({ config } = {}) {
  const home = newHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${CANARY}\n`, { mode: 0o600 });
  if (config !== undefined) writeFileSync(configPath(home), JSON.stringify(config));
  const h = remember(await createPanelServer({ port: 0, root: tmp('root'), settings: { home, env: {}, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) } }));
  HANDLES.push(h);
  return { h, home };
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
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); resolve({ status: res.statusCode, text, json() { try { return JSON.parse(text); } catch { return null; } } }); });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
const post = (port, url, body) => rq(port, { method: 'POST', url, body });
const provRow = async (port, slot = 'DEEPSEEK_API_KEY') => (await rq(port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === slot);

// ---- store + rules -----------------------------------------------------------------------------------------------------
test('rules: one function decides — a half pair, a negative, text, a ticked line without both prices, a repeated model are refused; 0/0 and an unticked no-price line pass', () => {
  assert.equal(modelsProblem([{ model: 'm', use: true, inPerM: 0, outPerM: 0 }]), null, '0 / 0 typed is a chosen price');
  assert.equal(modelsProblem([{ model: 'm', use: false }]), null, 'unticked, no price');
  assert.equal(modelsProblem([{ model: 'm', use: false, inPerM: 1 }]), HALF);
  assert.equal(modelsProblem([{ model: 'm', use: true, outPerM: 1 }]), HALF);
  assert.match(modelsProblem([{ model: 'm', use: true }]), /both prices/i, 'ticked with no price');
  for (const bad of [-1, '1', Number.NaN, Infinity, null, [], true]) {
    assert.ok(modelsProblem([{ model: 'm', use: true, inPerM: bad, outPerM: 1 }]), `inPerM=${String(bad)}`);
  }
  assert.ok(modelsProblem([{ model: 'm', use: false }, { model: 'm', use: false }]), 'a model listed twice');
  assert.ok(modelsProblem([{ model: 'has space', use: false }]));
  assert.ok(modelsProblem([{ model: 'm', use: 'yes' }]));
  assert.ok(modelsProblem('x'));
});

test('config: models round-trip; a half pair is a ConfigError and the file is byte-identical; unknown top-level fields stay; a hand-edited bad list throws on read', () => {
  const home = newHome();
  updateConfig({ note: 'keep me', models: { DEEPSEEK_API_KEY: [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }] } }, { home });
  const before = readFileSync(configPath(home), 'utf8');
  assert.equal(readConfig({ home }).note, 'keep me');
  assert.deepEqual(readConfig({ home }).models.DEEPSEEK_API_KEY, [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }]);
  assert.throws(() => updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'deepseek-flash', use: true, inPerM: 1 }] } }, { home }), (e) => e instanceof ConfigError && e.message.includes(HALF));
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  assert.equal(readConfig({ home }).models.DEEPSEEK_API_KEY[0].inPerM, 0);
  writeFileSync(configPath(home), JSON.stringify({ models: { DEEPSEEK_API_KEY: [{ model: 'x', use: true, inPerM: -1, outPerM: 1 }] } }));
  assert.throws(() => readConfig({ home }), ConfigError);
});

// ---- pricing -----------------------------------------------------------------------------------------------------------
test('pricing (M4d am5): a ticked model\'s own price is its only price (source "model"); 0 / 0 is a price, not unknown; an unticked line or an unlisted model is NOT usable - no table, no ceiling', () => {
  const cfg = { models: { DEEPSEEK_API_KEY: [
    { model: 'deepseek-flash', use: true, inPerM: 2, outPerM: 8 },
    { model: 'local-llama', use: true, inPerM: 0, outPerM: 0 },
    { model: 'unticked-one', use: false, inPerM: 5, outPerM: 5 },
  ] } };
  const a = resolveUsableModel('DEEPSEEK_API_KEY', { config: cfg, model: 'deepseek-flash' });
  assert.deepEqual(a.prices.perM, { inPerM: 2, cachedInPerM: 2, outPerM: 8 });
  assert.deepEqual(a.prices.source, { in: 'model', cachedIn: 'input', out: 'model' });
  const z = resolveUsableModel('DEEPSEEK_API_KEY', { config: cfg, model: 'local-llama' });
  assert.deepEqual(z.prices.perM, { inPerM: 0, cachedInPerM: 0, outPerM: 0 });
  assert.equal(z.prices.source.in, 'model');
  const u = resolveUsableModel('DEEPSEEK_API_KEY', { config: cfg, model: 'unticked-one' });
  assert.deepEqual([u.ok, u.say], [false, 'Tick unticked-one in Settings > Providers with both prices first.']);
  // a model no line lists, and one only another slot lists: refused by name (the old "highest table rate" fallback is gone)
  assert.equal(resolveUsableModel('DEEPSEEK_API_KEY', { config: cfg, model: 'unlisted' }).ok, false);
  assert.equal(resolveUsableModel('OTHER_KEY', { config: cfg, model: 'deepseek-flash' }).ok, false, 'another slot\'s list does not apply');
});

// ---- routes ---------------------------------------------------------------------------------------------------------------
test('MUST FAIL (am3): ticking a model with one price box empty saves nothing — config.json is byte-identical — and says the exact sentence', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 9, models: { DEEPSEEK_API_KEY: [{ model: 'deepseek-flash', use: false }] } } });
  const before = readFileSync(configPath(home), 'utf8');
  for (const body of [
    { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: true, inPerM: 1, outPerM: null },
    { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: true, inPerM: null, outPerM: 2 },
    { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: false, inPerM: 1, outPerM: null },
  ]) {
    const r = await post(h.port, '/api/settings/model', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().say, HALF);
    assert.equal(readFileSync(configPath(home), 'utf8'), before, 'byte-identical');
  }
  const none = await post(h.port, '/api/settings/model', { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: true, inPerM: null, outPerM: null });
  assert.equal(none.status, 400, 'ticked with no price at all');
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  for (const bad of [{ inPerM: -1, outPerM: 1 }, { inPerM: '1', outPerM: 1 }, { inPerM: 1e999, outPerM: 1 }]) {
    const r = await post(h.port, '/api/settings/model', { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: true, ...bad });
    assert.equal(r.status, 400);
    assert.equal(readFileSync(configPath(home), 'utf8'), before);
  }
  assert.equal((await post(h.port, '/api/settings/model', { slot: 'nope', model: 'x', use: false })).status, 400);
  assert.equal((await post(h.port, '/api/settings/price', { slot: 'DEEPSEEK_API_KEY', inPerM: 1 })).status, 404, 'the old per-row price route is gone');
});

test('route: a valid pair (0 / 0 too) saves; another key\'s lines and an older file\'s thinkingOff are handled; the Providers response lists lines with no key value', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 9, providers: { DEEPSEEK_API_KEY: { baseUrl: 'http://127.0.0.1:9' } }, models: { DEEPSEEK_API_KEY: [{ model: 'deepseek-flash', use: false, thinkingOff: 'disabled' }], OTHER_KEY: [{ model: 'o', use: true, inPerM: 1, outPerM: 2 }] } } });
  const ok = await post(h.port, '/api/settings/model', { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 });
  assert.equal(ok.json().ok, true);
  const saved = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.deepEqual(saved.models.DEEPSEEK_API_KEY, [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }], 'an older file\'s thinkingOff is dropped on save (M4d am7)');
  assert.deepEqual(saved.models.OTHER_KEY, [{ model: 'o', use: true, inPerM: 1, outPerM: 2 }], 'another key is untouched');
  assert.equal(saved.monthlyLimitUsd, 9);
  const raw = (await rq(h.port, { url: '/api/settings/providers' })).text;
  assert.ok(!raw.includes(CANARY), 'no key value in the response');
  const row = await provRow(h.port);
  assert.deepEqual(row.models, [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }]);
  assert.equal(row.price, undefined, 'the per-row price object is gone');
  // un-tick keeps the price; clear both on an unticked line is fine
  assert.equal((await post(h.port, '/api/settings/model', { slot: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', use: false, inPerM: null, outPerM: null })).json().ok, true);
  assert.deepEqual((await provRow(h.port)).models, [{ model: 'deepseek-flash', use: false }]);
});

// ---- the page ----------------------------------------------------------------------------------------------------------
test('page: no per-row In/Out price columns; each model line has Use, name, Price in, Price out; saves through /api/settings/model', () => {
  assert.ok(!/<th>In \$\/1M<\/th>|<th>Out \$\/1M<\/th>/.test(PAGE), 'old price columns removed');
  assert.ok(!PAGE.includes('/api/settings/price'));
  assert.ok(PAGE.includes('/api/settings/model'));
  for (const id of ['model-use', 'model-in', 'model-out']) assert.ok(PAGE.includes(`data-testid="${id}"`), id);
});
