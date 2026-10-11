// M4d amendment 1 (docs/wiki/the-module-ladder.md, "M4d" Amendment 1), as amendment 6 changed it: API shape and Base URL (and the legacy max_tokens tick) are editable on the
// Providers table, per key name, and read through ONE lookup (`resolveSlot`). $0, no network: `fetch` is stubbed, the config home is a
// tracked mkdtemp dir (never the real ~/.config/fwdloop). Each test goes red with its one src change taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAI, Anthropic, Gemini } from 'bare-agent/providers';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { configPath, readConfig, updateConfig, ConfigError } from '../src/config.js';
import { makeProvider, resolveSlot, readSpendRows } from '../src/provider.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { install } from './fixtures/m4d-fake-openai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const KEY = 'test-key-not-a-secret-shape';
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4da1-${p}-`));
const newHome = () => { const h = path.join(tmp('home'), 'fwdloop'); mkdirSync(h, { recursive: true, mode: 0o700 }); return h; };
const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

async function setup({ fetchImpl } = {}) {
  const home = newHome();
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${KEY}\n`, { mode: 0o600 });
  const calls = [];
  const h = remember(await createPanelServer({
    port: 0,
    root: tmp('root'),
    settings: {
      home, env: {}, fetch: async (url, opts) => { calls.push({ url: String(url), headers: opts?.headers }); return (fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({}) })))(url, opts); },
    },
  }));
  HANDLES.push(h);
  return { h, home, calls };
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
const cfgText = (home) => { try { return readFileSync(configPath(home), 'utf8'); } catch { return null; } };

async function withHome(home, fn) {
  const saved = { NODE_ENV: process.env.NODE_ENV, FWDLOOP_CONFIG_HOME: process.env.FWDLOOP_CONFIG_HOME };
  process.env.NODE_ENV = 'test';
  process.env.FWDLOOP_CONFIG_HOME = home;
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('(a) route: a bad Base URL, an unknown shape, a non-boolean tick or a key not in the file is refused with a sentence and NOTHING is saved', async () => {
  const { h, home } = await setup();
  const before = cfgText(home);
  const bad = [
    { slot: 'DEEPSEEK_API_KEY', baseUrl: 'ftp://x' }, { slot: 'DEEPSEEK_API_KEY', baseUrl: 'api.x.com' }, { slot: 'DEEPSEEK_API_KEY', baseUrl: 'http://a b' }, { slot: 'DEEPSEEK_API_KEY', baseUrl: 5 },
    { slot: 'DEEPSEEK_API_KEY', legacyMaxTokens: 'yes' }, { slot: 'DEEPSEEK_API_KEY', legacyMaxTokens: 1 },
    { slot: 'DEEPSEEK_API_KEY', shape: 'nope' }, { slot: 'DEEPSEEK_API_KEY', shape: '' },
    { slot: 'DEEPSEEK_API_KEY', baseUrl: 'http://ok.example.com', shape: 'nope' }, // one bad field: the good one is NOT saved either
    { slot: 'nope', shape: 'openai-api' }, { slot: 'DEEPSEEK_API_KEY' },
  ];
  for (const body of bad) {
    const r = await post(h.port, '/api/settings/provider', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().ok, false);
    assert.equal(r.json().refused, body.slot === 'nope' ? 'unknown-provider' : 'bad-provider', 'refused by the route\'s own value check, not by the config file\'s backstop');
    assert.match(r.json().say, /\S+ \S+/, 'a plain sentence');
    assert.equal(cfgText(home), before, `config.json untouched after ${JSON.stringify(body)}`);
  }
});

test('route: a good save is written under the key name, trailing slashes dropped; an empty Base URL clears it; the GET carries shapes and the effective values', async () => {
  const { h, home } = await setup();
  assert.equal((await post(h.port, '/api/settings/provider', { slot: 'DEEPSEEK_API_KEY', shape: 'anthropic-api', baseUrl: 'https://proxy.example.com/v1//' })).json().ok, true);
  assert.deepEqual(readConfig({ home }).providers, { DEEPSEEK_API_KEY: { shape: 'anthropic-api', baseUrl: 'https://proxy.example.com/v1' } });
  const g = (await rq(h.port, { url: '/api/settings/providers' })).json();
  assert.deepEqual(g.shapes.map((x) => x.id), ['anthropic-api', 'openai-api', 'gemini-api']);
  const row = g.rows.find((r) => r.slot === 'DEEPSEEK_API_KEY');
  assert.deepEqual([row.shape, row.baseUrl], ['anthropic-api', 'https://proxy.example.com/v1']);
  assert.equal((await post(h.port, '/api/settings/provider', { slot: 'DEEPSEEK_API_KEY', baseUrl: '' })).json().ok, true);
  assert.equal(readConfig({ home }).providers.DEEPSEEK_API_KEY.baseUrl, undefined);
  const row2 = (await rq(h.port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === 'DEEPSEEK_API_KEY');
  assert.equal(row2.baseUrl, '', 'blank = no address: nothing is built in (M4d am6)');
  assert.ok(!cfgText(home).includes(KEY), '(d) no key value in config.json');
});

test('config: a hand-edited bad providers block refuses by name on read; updateConfig refuses and leaves the file unchanged', () => {
  const home = newHome();
  writeFileSync(configPath(home), JSON.stringify({ providers: { DEEPSEEK_API_KEY: { baseUrl: 'javascript:alert(1)' } } }));
  assert.throws(() => readConfig({ home }), (e) => e instanceof ConfigError && /providers\.DEEPSEEK_API_KEY\.baseUrl/.test(e.message));
  const home2 = newHome();
  updateConfig({ providers: { DEEPSEEK_API_KEY: { baseUrl: 'http://127.0.0.1:9' } } }, { home: home2 });
  const before = cfgText(home2);
  assert.throws(() => updateConfig({ providers: { DEEPSEEK_API_KEY: { shape: 'bogus' } } }, { home: home2 }), ConfigError);
  assert.equal(cfgText(home2), before);
});

test('one lookup: the ticked Settings model reaches the provider, the spend row and the price; an unticked one is refused by name and books nothing, never priced from code', async () => {
  const home = newHome();
  const spendPath = path.join(tmp('spend'), 'spend.jsonl');
  const run = (model) => makeLiveModelStep({ slot: 'DEEPSEEK_API_KEY', model, spendPath, env: { DEEPSEEK_API_KEY: KEY } })({ goal: 'g', primitives: [], reads: {}, gap: null }, {}, { class: 'hitl' });
  const providers = { DEEPSEEK_API_KEY: { shape: 'openai-api', baseUrl: 'http://127.0.0.1:9' } };
  const tick = (model, inPerM, outPerM) => updateConfig({ providers, models: { DEEPSEEK_API_KEY: [{ model, use: true, inPerM, outPerM }] } }, { home });
  const restore = install({ inputTokens: 100, cacheReadTokens: 0, outputTokens: 50 });
  try {
    await withHome(home, async () => {
      tick('first-model', 0.3, 1.2);
      const r1 = await run('first-model');
      assert.equal(r1.ok, true, r1.red);
      tick('second-model', 1.32, 3.96);
      assert.equal((await run('second-model')).ok, true);
      updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'second-model', use: false, inPerM: 1.32, outPerM: 3.96 }] } }, { home });
      const refused = await run('second-model');
      assert.equal(refused.ok, false);
      assert.equal(refused.red, 'Tick second-model in Settings > Providers with both prices first.');
      assert.equal(refused.model, null, 'no provider was built');
    });
  } finally { restore(); }
  const rows = readSpendRows(spendPath);
  assert.deepEqual(rows.map((r) => r.model), ['first-model', 'second-model'], 'the refused call booked no row');
  assert.equal(rows[1].price.source.in, 'model');
  assert.equal(rows[1].price.inPerM, 1.32, 'priced by the ticked line\'s own typed price');
  assert.ok(rows[1].costUsd > 0);
  // (c) the run booked before the change keeps its recorded model and price, byte for byte
  assert.equal(rows[0].price.inPerM, 0.3);
  assert.equal(rows[0].price.source.in, 'model');
});

test('one lookup: a saved Base URL is the address the provider is called at', async () => {
  const home = newHome();
  const seen = [];
  const line = [{ model: 'm', use: true, inPerM: 1, outPerM: 1 }];
  updateConfig({ models: { DEEPSEEK_API_KEY: line }, providers: { DEEPSEEK_API_KEY: { baseUrl: 'http://127.0.0.1:9/first' } } }, { home });
  const orig = OpenAI.prototype.generate;
  // no network: the call is replaced AFTER the provider is built, recording the address the built provider holds
  OpenAI.prototype.generate = async function fake() { seen.push(this.baseUrl); return { text: 'hi', toolCalls: [], usage: {}, model: 'm', stopReason: 'stop' }; };
  try {
    await withHome(home, async () => {
      await makeProvider('DEEPSEEK_API_KEY', { model: 'm', env: { DEEPSEEK_API_KEY: KEY } }).provider.generate([{ role: 'user', content: 'x' }]);
      updateConfig({ providers: { DEEPSEEK_API_KEY: { baseUrl: 'https://proxy.example.com/v9/' } } }, { home });
      await makeProvider('DEEPSEEK_API_KEY', { model: 'm', env: { DEEPSEEK_API_KEY: KEY } }).provider.generate([{ role: 'user', content: 'x' }]);
    });
  } finally { OpenAI.prototype.generate = orig; }
  assert.deepEqual(seen, ['http://127.0.0.1:9/first', 'https://proxy.example.com/v9']);
});

test('shape: makeProvider builds the class the shape names (Anthropic, Gemini); resolveSlot is the single reader', async () => {
  const home = newHome();
  updateConfig({ providers: { ANTH_KEY: { shape: 'anthropic-api', baseUrl: 'http://127.0.0.1:9/a' }, GEM_KEY: { shape: 'gemini-api', baseUrl: 'http://127.0.0.1:9/g', legacyMaxTokens: true } } }, { home });
  for (const slot of ['ANTH_KEY', 'GEM_KEY']) updateConfig({ models: { [slot]: [{ model: 'm', use: true, inPerM: 1, outPerM: 1 }] } }, { home });
  const config = readConfig({ home });
  assert.equal(resolveSlot('ANTH_KEY', { config }).baseUrl, 'http://127.0.0.1:9/a');
  assert.equal(resolveSlot('GEM_KEY', { config }).legacyMaxTokens, false, 'legacy max_tokens is an OpenAI-shape quirk');
  assert.ok(makeProvider('ANTH_KEY', { model: 'm', env: { ANTH_KEY: KEY }, configHome: home }).provider instanceof Anthropic);
  assert.ok(makeProvider('GEM_KEY', { model: 'm', env: { GEM_KEY: KEY }, configHome: home }).provider instanceof Gemini);
  assert.throws(() => resolveSlot('no such'), /unknown provider/);
});

test('Test follows the saved row: it calls the saved address with the shape\'s header', async () => {
  const { h, home, calls } = await setup();
  await post(h.port, '/api/settings/provider', { slot: 'DEEPSEEK_API_KEY', baseUrl: 'https://proxy.example.com/v1' });
  await post(h.port, '/api/settings/test', { slot: 'DEEPSEEK_API_KEY' });
  assert.equal(calls[0].url, 'https://proxy.example.com/v1/models');
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  calls.length = 0;
  await post(h.port, '/api/settings/provider', { slot: 'DEEPSEEK_API_KEY', baseUrl: 'https://other.example.com/v1', shape: 'anthropic-api' });
  await post(h.port, '/api/settings/test', { slot: 'DEEPSEEK_API_KEY' });
  assert.equal(calls[0].url, 'https://other.example.com/v1/models');
  assert.equal(calls[0].headers['x-api-key'], KEY);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.ok(!cfgText(home).includes(KEY));
});

test('page: API shape is a <select> and Base URL a text input, both always editable on the key row (layout F), saved together on change through /api/settings/provider; the legacy max_tokens tick saves alone on change', () => {
  const row = PAGE.slice(PAGE.indexOf('function buildProviderRow('), PAGE.indexOf('function buildModelLine('));
  assert.deepEqual([...row.matchAll(/<(input type="text"|select) data-prov="(\w+)"/g)].map((m) => [m[2], m[1]]), [['shape', 'select'], ['baseUrl', 'input type="text"']]);
  assert.deepEqual([...row.matchAll(/<(input type="checkbox") data-prov="(\w+)"/g)].map((m) => [m[2], m[1]]), [['legacyMaxTokens', 'input type="checkbox"']]);
  assert.match(PAGE, /postJSON\("\/api\/settings\/provider"/);
  assert.match(PAGE, /saveProvider\(inp\.closest\("\.pv-key"\), inp\)/);
  assert.match(PAGE, /shape: key\.querySelector\("\[data-prov=shape\]"\)\.value, baseUrl: key\.querySelector/, 'a change of either box sends both fields in one request');
});
