// M4d amendment 1 (docs/wiki/the-module-ladder.md, "M4d" Amendment 1): Name, API shape and Base URL are editable on the
// Providers table and read through ONE lookup (`resolveSlot`). $0, no network: `fetch` is stubbed, the config home is a
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

test('(a) route: a bad Base URL, an empty/spaced/overlong model id, an unknown shape or slot is refused with a sentence and NOTHING is saved', async () => {
  const { h, home } = await setup();
  const before = cfgText(home);
  const bad = [
    { slot: 'deepseek', baseUrl: 'ftp://x' }, { slot: 'deepseek', baseUrl: 'api.x.com' }, { slot: 'deepseek', baseUrl: 'http://a b' }, { slot: 'deepseek', baseUrl: 5 },
    { slot: 'deepseek', name: '' }, { slot: 'deepseek', name: 'two words' }, { slot: 'deepseek', name: 'x'.repeat(201) }, { slot: 'deepseek', name: 7 },
    { slot: 'deepseek', shape: 'nope' }, { slot: 'deepseek', shape: '' },
    { slot: 'deepseek', name: 'ok-model', shape: 'nope' }, // one bad field: the good one is NOT saved either
    { slot: 'nope', name: 'ok-model' }, { slot: 'deepseek' },
  ];
  for (const body of bad) {
    const r = await post(h.port, '/api/settings/provider', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().ok, false);
    assert.match(r.json().say, /\S+ \S+/, 'a plain sentence');
    assert.equal(cfgText(home), before, `config.json untouched after ${JSON.stringify(body)}`);
  }
});

test('route: a good save is written under the slot, trailing slashes dropped; an empty Base URL clears it; the GET carries shapes, effective values and defaults', async () => {
  const { h, home } = await setup();
  assert.equal((await post(h.port, '/api/settings/provider', { slot: 'deepseek', name: 'my-model', shape: 'anthropic-api', baseUrl: 'https://proxy.example.com/v1//' })).json().ok, true);
  assert.deepEqual(readConfig({ home }).providers, { deepseek: { model: 'my-model', shape: 'anthropic-api', baseUrl: 'https://proxy.example.com/v1' } });
  const g = (await rq(h.port, { url: '/api/settings/providers' })).json();
  assert.deepEqual(g.shapes.map((x) => x.id), ['anthropic-api', 'openai-api', 'gemini-api']);
  const row = g.rows.find((r) => r.slot === 'deepseek');
  assert.deepEqual([row.model, row.shape, row.baseUrl, row.savedBaseUrl], ['my-model', 'anthropic-api', 'https://proxy.example.com/v1', 'https://proxy.example.com/v1']);
  assert.deepEqual(row.defaults, { model: 'deepseek-flash', shape: 'openai-api', baseUrl: 'https://api.anthropic.com/v1' });
  assert.equal((await post(h.port, '/api/settings/provider', { slot: 'deepseek', baseUrl: '' })).json().ok, true);
  assert.equal(readConfig({ home }).providers.deepseek.baseUrl, undefined);
  const row2 = (await rq(h.port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === 'deepseek');
  assert.equal(row2.baseUrl, 'https://api.anthropic.com/v1', 'blank = the default for the effective shape');
  assert.ok(!cfgText(home).includes(KEY), '(d) no key value in config.json');
});

test('config: a hand-edited bad providers block refuses by name on read; updateConfig refuses and leaves the file unchanged', () => {
  const home = newHome();
  writeFileSync(configPath(home), JSON.stringify({ providers: { deepseek: { baseUrl: 'javascript:alert(1)' } } }));
  assert.throws(() => readConfig({ home }), (e) => e instanceof ConfigError && /providers\.deepseek\.baseUrl/.test(e.message));
  const home2 = newHome();
  updateConfig({ providers: { deepseek: { model: 'm1' } } }, { home: home2 });
  const before = cfgText(home2);
  assert.throws(() => updateConfig({ providers: { deepseek: { shape: 'bogus' } } }, { home: home2 }), ConfigError);
  assert.equal(cfgText(home2), before);
});

test('one lookup: a saved model id reaches the provider, the spend row and the price lookup; an id the table does not know books at the highest rate, never 0', async () => {
  const home = newHome();
  const spendPath = path.join(tmp('spend'), 'spend.jsonl');
  const run = () => makeLiveModelStep({ slot: 'deepseek', spendPath, env: { DEEPSEEK_API_KEY: KEY } })({ goal: 'g', primitives: [], reads: {}, gap: null }, {}, { class: 'hitl' });
  const restore = install({ inputTokens: 100, cacheReadTokens: 0, outputTokens: 50 });
  try {
    await withHome(home, async () => {
      const r1 = await run();
      assert.equal(r1.ok, true, r1.red);
      updateConfig({ providers: { deepseek: { model: 'deepseek-v4-pro' } } }, { home });
      assert.equal((await run()).ok, true);
      updateConfig({ providers: { deepseek: { model: 'some-model-the-table-never-heard-of' } } }, { home });
      assert.equal((await run()).ok, true);
    });
  } finally { restore(); }
  const rows = readSpendRows(spendPath);
  assert.deepEqual(rows.map((r) => r.model), ['deepseek-flash', 'deepseek-v4-pro', 'some-model-the-table-never-heard-of']);
  assert.equal(rows[1].price.source.in, 'table');
  assert.equal(rows[1].price.inPerM, 1.32, 'priced by the new model\'s own table row');
  assert.equal(rows[2].price.source.in, 'ceiling');
  assert.ok(rows[2].costUsd > 0 && rows[2].price.inPerM > 0, 'unknown model: never $0');
  // (c) the run booked before the change keeps its recorded model and price, byte for byte
  assert.equal(rows[0].price.inPerM, 0.3);
  assert.equal(rows[0].price.source.in, 'table');
});

test('one lookup: a saved Base URL is the address the provider is called at (and a blank one is the code default)', async () => {
  const home = newHome();
  const seen = [];
  const orig = OpenAI.prototype.generate;
  // no network: the call is replaced AFTER the provider is built, recording the address the built provider holds
  OpenAI.prototype.generate = async function fake() { seen.push(this.baseUrl); return { text: 'hi', toolCalls: [], usage: {}, model: 'm', stopReason: 'stop' }; };
  try {
    await withHome(home, async () => {
      await makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY } }).provider.generate([{ role: 'user', content: 'x' }]);
      updateConfig({ providers: { deepseek: { baseUrl: 'https://proxy.example.com/v9/' } } }, { home });
      await makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY } }).provider.generate([{ role: 'user', content: 'x' }]);
    });
  } finally { OpenAI.prototype.generate = orig; }
  assert.deepEqual(seen, ['https://api.deepseek.com', 'https://proxy.example.com/v9']);
});

test('shape: makeProvider builds the class the shape names (Anthropic, Gemini); resolveSlot is the single reader', async () => {
  const home = newHome();
  updateConfig({ providers: { synthetic: { shape: 'anthropic-api' }, deepseek: { shape: 'gemini-api' } } }, { home });
  const config = readConfig({ home });
  assert.equal(resolveSlot('synthetic', { config }).baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(resolveSlot('deepseek', { config }).baseUrl, '', 'Gemini: bare-agent\'s own address');
  assert.equal(resolveSlot('deepseek', { config }).legacyMaxTokens, false, 'legacy max_tokens is an OpenAI-shape quirk');
  assert.ok(makeProvider('synthetic', { env: { SYNTHETIC_API_KEY: KEY }, configHome: home }).provider instanceof Anthropic);
  assert.ok(makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: home }).provider instanceof Gemini);
  assert.throws(() => resolveSlot('nope'), /unknown provider slot/);
});

test('Test and Balance follow the saved slot: Test calls the saved address with the shape\'s header; Balance is offered only on an OpenAI shape at api.deepseek.com', async () => {
  const { h, home, calls } = await setup();
  const balanceOf = async () => (await rq(h.port, { url: '/api/settings/balance?slot=deepseek' })).json();
  assert.notEqual((await balanceOf()).why, 'Not offered by this provider.');
  assert.equal((await rq(h.port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === 'deepseek').canBalance, true);
  await post(h.port, '/api/settings/provider', { slot: 'deepseek', baseUrl: 'https://proxy.example.com/v1' });
  assert.deepEqual(await balanceOf(), { ok: false, why: 'Not offered by this provider.' });
  assert.equal((await rq(h.port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === 'deepseek').canBalance, false);
  calls.length = 0;
  await post(h.port, '/api/settings/test', { slot: 'deepseek' });
  assert.equal(calls[0].url, 'https://proxy.example.com/v1/models');
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  await post(h.port, '/api/settings/provider', { slot: 'deepseek', baseUrl: '', shape: 'anthropic-api' });
  assert.deepEqual(await balanceOf(), { ok: false, why: 'Not offered by this provider.' });
  calls.length = 0;
  await post(h.port, '/api/settings/test', { slot: 'deepseek' });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models');
  assert.equal(calls[0].headers['x-api-key'], KEY);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.ok(!cfgText(home).includes(KEY));
});

test('page: Name is a text input, API shape a <select>, Base URL a text input — saved on change through /api/settings/provider', () => {
  const build = PAGE.slice(PAGE.indexOf('function buildProviderRow('), PAGE.indexOf('var STATUS_WORD'));
  const cells = [...build.matchAll(/<(input type="text"|select) data-prov="(\w+)"/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(cells, [['name', 'input type="text"'], ['shape', 'select'], ['baseUrl', 'input type="text"']]);
  assert.match(PAGE, /postJSON\("\/api\/settings\/provider"/);
  assert.match(PAGE, /saveProvider\(inp\.closest\("tr"\), inp\)/);
});
