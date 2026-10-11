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
import { resolveUsableModel, effectiveModels } from '../src/provider.js';

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
const provRow = async (port, slot = 'deepseek') => (await rq(port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === slot);

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
  updateConfig({ note: 'keep me', models: { deepseek: [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }] } }, { home });
  const before = readFileSync(configPath(home), 'utf8');
  assert.equal(readConfig({ home }).note, 'keep me');
  assert.deepEqual(readConfig({ home }).models.deepseek, [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }]);
  assert.throws(() => updateConfig({ models: { deepseek: [{ model: 'deepseek-flash', use: true, inPerM: 1 }] } }, { home }), (e) => e instanceof ConfigError && e.message.includes(HALF));
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  assert.equal(readConfig({ home }).models.deepseek[0].inPerM, 0);
  writeFileSync(configPath(home), JSON.stringify({ models: { deepseek: [{ model: 'x', use: true, inPerM: -1, outPerM: 1 }] } }));
  assert.throws(() => readConfig({ home }), ConfigError);
});

// ---- pricing -----------------------------------------------------------------------------------------------------------
test('pricing (M4d am5): a ticked model\'s own price is its only price (source "model"); 0 / 0 is a price, not unknown; an unticked line or an unlisted model is NOT usable - no table, no ceiling', () => {
  const cfg = { models: { deepseek: [
    { model: 'deepseek-flash', use: true, inPerM: 2, outPerM: 8 },
    { model: 'local-llama', use: true, inPerM: 0, outPerM: 0 },
    { model: 'unticked-one', use: false, inPerM: 5, outPerM: 5 },
  ] } };
  const a = resolveUsableModel('deepseek', { config: cfg, model: 'deepseek-flash' });
  assert.deepEqual(a.prices.perM, { inPerM: 2, cachedInPerM: 2, outPerM: 8 });
  assert.deepEqual(a.prices.source, { in: 'model', cachedIn: 'input', out: 'model' });
  const z = resolveUsableModel('deepseek', { config: cfg, model: 'local-llama' });
  assert.deepEqual(z.prices.perM, { inPerM: 0, cachedInPerM: 0, outPerM: 0 });
  assert.equal(z.prices.source.in, 'model');
  const u = resolveUsableModel('deepseek', { config: cfg, model: 'unticked-one' });
  assert.deepEqual([u.ok, u.say], [false, 'Tick unticked-one in Settings > Providers with both prices first.']);
  // a model no line lists, and one only another slot lists: refused by name (the old "highest table rate" fallback is gone)
  assert.equal(resolveUsableModel('deepseek', { config: cfg, model: 'unlisted' }).ok, false);
  assert.equal(resolveUsableModel('synthetic', { config: cfg, model: 'deepseek-flash' }).ok, false, 'another slot\'s list does not apply');
});

// ---- migration ---------------------------------------------------------------------------------------------------------
test('migration (item 10, hamr ruling: prices come only from what was typed): both -> ticked line; half -> UNTICKED with the typed number pre-filled; nothing -> unticked, no price; never the code table; file untouched', () => {
  // a: both old prices typed
  // M4d am5 item 1: no code default model, so the migrated line is built from the NAME typed in the slot's Name box
  const named = { providers: { deepseek: { model: 'deepseek-flash' } } };
  let r = effectiveModels('deepseek', { ...named, prices: { deepseek: { inPerM: 0.4, outPerM: 1.5 } } });
  assert.deepEqual(r.lines, [{ model: 'deepseek-flash', use: true, inPerM: 0.4, outPerM: 1.5 }]);
  assert.equal(r.migrated, true);
  assert.equal(r.unpriced, false);
  // b: half typed (only in) -> unticked, the typed box kept, the other empty; the table pair is NOT used
  r = effectiveModels('deepseek', { ...named, prices: { deepseek: { inPerM: 0.4 } } });
  assert.deepEqual(r.lines, [{ model: 'deepseek-flash', use: false, inPerM: 0.4 }]);
  assert.equal(r.unpriced, true);
  r = effectiveModels('deepseek', { ...named, prices: { deepseek: { outPerM: 2 } } });
  assert.deepEqual(r.lines, [{ model: 'deepseek-flash', use: false, outPerM: 2 }]);
  // c: a name typed, no price -> unticked, no price
  r = effectiveModels('deepseek', named);
  assert.deepEqual(r.lines, [{ model: 'deepseek-flash', use: false }]);
  assert.equal(r.unpriced, true);
  // c2 (M4d am5 item 1): no name typed and no list -> NO line at all; there is no code default model to offer
  r = effectiveModels('deepseek', {});
  assert.deepEqual(r.lines, []);
  // d: an unknown model, nothing typed
  r = effectiveModels('deepseek', { providers: { deepseek: { model: 'my-own-model' } } });
  assert.deepEqual(r.lines, [{ model: 'my-own-model', use: false }]);
  // d2: unknown model WITH a full old price keeps it
  r = effectiveModels('deepseek', { providers: { deepseek: { model: 'my-own-model' } }, prices: { deepseek: { inPerM: 1, outPerM: 2 } } });
  assert.deepEqual(r.lines, [{ model: 'my-own-model', use: true, inPerM: 1, outPerM: 2 }]);
  // an existing list is returned as stored, never migrated
  const list = [{ model: 'a', use: false }];
  r = effectiveModels('deepseek', { models: { deepseek: list }, prices: { deepseek: { inPerM: 1, outPerM: 2 } } });
  assert.deepEqual(r.lines, list);
  assert.equal(r.migrated, false);
  // the full legacy price keeps pricing the current model after the move (and books as the model's price)
  const p = resolveUsableModel('deepseek', { config: { ...named, prices: { deepseek: { inPerM: 0.4, outPerM: 1.5 } } } });
  assert.deepEqual(p.prices.perM, { inPerM: 0.4, cachedInPerM: 0.4, outPerM: 1.5 });
  assert.equal(p.prices.source.in, 'model');
});

test('hamr\'s real config shape prices.deepseek = {inPerM:0.4, cachedInPerM:0.4}: an unticked deepseek-flash line with 0.4 in, out empty; source is never "model" until both are typed and Use is ticked', async () => {
  const config = { providers: { deepseek: { model: 'deepseek-flash' } }, prices: { deepseek: { inPerM: 0.4, cachedInPerM: 0.4 } } };
  assert.deepEqual(effectiveModels('deepseek', config).lines, [{ model: 'deepseek-flash', use: false, inPerM: 0.4 }]);
  assert.equal(resolveUsableModel('deepseek', { config, model: 'deepseek-flash' }).ok, false, 'half a price is never a usable model');
  const { h, home } = await setup({ config });
  const before = readFileSync(configPath(home), 'utf8');
  const row = await provRow(h.port);
  assert.deepEqual(row.models, [{ model: 'deepseek-flash', use: false, inPerM: 0.4, thinkingOff: 'cant' }]);
  assert.equal(row.unpriced, true);
  assert.equal(readFileSync(configPath(home), 'utf8'), before, 'reading writes nothing');
  // ticking with only the typed in-price is refused; nothing saved
  const bad = await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'deepseek-flash', use: true, inPerM: 0.4, outPerM: null });
  assert.equal(bad.json().say, HALF);
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  // another line saved meanwhile is not blocked by the half-filled migrated line
  assert.equal((await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'other', use: false })).json().ok, true);
  // both typed and ticked: now (and only now) the model price applies
  assert.equal((await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'deepseek-flash', use: true, inPerM: 0.4, outPerM: 1.5 })).json().ok, true);
  const saved = readConfig({ home });
  assert.equal(resolveUsableModel('deepseek', { config: saved, model: 'deepseek-flash' }).prices.source.in, 'model');
});

// ---- the route ---------------------------------------------------------------------------------------------------------
test('MUST FAIL (am3): ticking a model with one price box empty saves nothing — config.json is byte-identical — and says the exact sentence', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 9, models: { deepseek: [{ model: 'deepseek-flash', use: false }] } } });
  const before = readFileSync(configPath(home), 'utf8');
  for (const body of [
    { slot: 'deepseek', model: 'deepseek-flash', use: true, inPerM: 1, outPerM: null },
    { slot: 'deepseek', model: 'deepseek-flash', use: true, inPerM: null, outPerM: 2 },
    { slot: 'deepseek', model: 'deepseek-flash', use: false, inPerM: 1, outPerM: null },
  ]) {
    const r = await post(h.port, '/api/settings/model', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().say, HALF);
    assert.equal(readFileSync(configPath(home), 'utf8'), before, 'byte-identical');
  }
  const none = await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'deepseek-flash', use: true, inPerM: null, outPerM: null });
  assert.equal(none.status, 400, 'ticked with no price at all');
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  for (const bad of [{ inPerM: -1, outPerM: 1 }, { inPerM: '1', outPerM: 1 }, { inPerM: 1e999, outPerM: 1 }]) {
    const r = await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'deepseek-flash', use: true, ...bad });
    assert.equal(r.status, 400);
    assert.equal(readFileSync(configPath(home), 'utf8'), before);
  }
  assert.equal((await post(h.port, '/api/settings/model', { slot: 'nope', model: 'x', use: false })).status, 400);
  assert.equal((await post(h.port, '/api/settings/price', { slot: 'deepseek', inPerM: 1 })).status, 404, 'the old per-row price route is gone');
});

test('route: a valid pair (0 / 0 too) saves, migrates the slot (first save writes the list and drops the old prices.<slot>), and the Providers response lists lines with no key value', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 9, providers: { deepseek: { model: 'deepseek-flash' }, synthetic: { model: 'typed-synth-model' } }, prices: { deepseek: { inPerM: 0.4, outPerM: 1.5 }, synthetic: { inPerM: 1, outPerM: 2 } } } });
  const first = await provRow(h.port);
  assert.deepEqual(first.models, [{ model: 'deepseek-flash', use: true, inPerM: 0.4, outPerM: 1.5, thinkingOff: 'cant' }]);
  assert.equal(JSON.parse(readFileSync(configPath(home), 'utf8')).models, undefined, 'reading migrates nothing on disk');
  const ok = await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 });
  assert.equal(ok.json().ok, true);
  const saved = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.deepEqual(saved.models.deepseek, [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0 }]);
  assert.equal(saved.prices.deepseek, undefined, 'the migrated old price is gone');
  assert.deepEqual(saved.prices.synthetic, { inPerM: 1, outPerM: 2 }, 'another slot is untouched');
  assert.equal(saved.monthlyLimitUsd, 9);
  const raw = (await rq(h.port, { url: '/api/settings/providers' })).text;
  assert.ok(!raw.includes(CANARY), 'no key value in the response');
  const row = await provRow(h.port);
  assert.deepEqual(row.models, [{ model: 'deepseek-flash', use: true, inPerM: 0, outPerM: 0, thinkingOff: 'cant' }]);
  assert.equal(row.price, undefined, 'the per-row price object is gone');
  // the synthetic slot migrated for display from its old prices
  assert.deepEqual((await provRow(h.port, 'synthetic')).models, [{ model: 'typed-synth-model', use: true, inPerM: 1, outPerM: 2, thinkingOff: 'cant' }]);
  // un-tick keeps the price; clear both on an unticked line is fine
  assert.equal((await post(h.port, '/api/settings/model', { slot: 'deepseek', model: 'deepseek-flash', use: false, inPerM: null, outPerM: null })).json().ok, true);
  assert.deepEqual((await provRow(h.port)).models, [{ model: 'deepseek-flash', use: false, thinkingOff: 'cant' }]);
});

test('route: the current model with no saved line shows as an unticked, unpriced line the person can fill', async () => {
  const { h } = await setup({ config: { providers: { deepseek: { model: 'typed-model' } }, models: { deepseek: [{ model: 'other', use: false }] } } });
  const row = await provRow(h.port);
  assert.deepEqual(row.models.map((m) => m.model).sort(), ['other', 'typed-model']);
  assert.equal(row.models.find((m) => m.model === 'typed-model').use, false);
});

// ---- the page ----------------------------------------------------------------------------------------------------------
test('page: no per-row In/Out price columns; each model line has Use, name, Price in, Price out; saves through /api/settings/model', () => {
  assert.ok(!/<th>In \$\/1M<\/th>|<th>Out \$\/1M<\/th>/.test(PAGE), 'old price columns removed');
  assert.ok(!PAGE.includes('/api/settings/price'));
  assert.ok(PAGE.includes('/api/settings/model'));
  for (const id of ['model-use', 'model-in', 'model-out']) assert.ok(PAGE.includes(`data-testid="${id}"`), id);
  assert.ok(!/Refresh models/.test(PAGE), 'no Refresh yet (piece B)');
});
