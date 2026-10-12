// Branch-review finding (Low): only names that look like API keys (`isKeyName`: /^[A-Z][A-Z0-9_]*_KEY$/) may be a Settings row or reach a
// child env. $0, no network, temp homes only. Each test goes red with its one src gate taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath, loadKeysEnv, isKeyName } from '../src/keysfile.js';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-keyname-${p}-`));
const newHome = (keys, config) => {
  const h = path.join(tmp('home'), 'fwdloop');
  mkdirSync(h, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(h), keys, { mode: 0o600 });
  if (config) writeFileSync(path.join(h, 'config.json'), JSON.stringify(config));
  return h;
};
const FILE = 'DEEPSEEK_API_KEY=k1\nNODE_OPTIONS=--require /tmp/x.js\nOPENAI_API_KEY=k2\n';
const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

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

test('the rule: key-looking names pass, others do not', () => {
  for (const n of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'SYNTHETIC_API_KEY', 'MY_KEY']) assert.equal(isKeyName(n), true, n);
  for (const n of ['NODE_OPTIONS', 'PATH', 'KEY', 'deepseek_api_key', '_KEY', '1_KEY', 'A_KEY\n', 'A_KEY_X', '', undefined, 5]) assert.equal(isKeyName(n), false, String(n));
});

test('gate 1: a non-key line is not listed in names (the rest of the file still loads)', () => {
  const home = newHome(FILE, { providers: { DEEPSEEK_API_KEY: {}, OPENAI_API_KEY: {} } });
  const r = loadKeysEnv({ env: {}, home, configured: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.names, ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']);
});

test('gate 2: a configured non-key name never reaches env, keyNames or shellOnly', () => {
  const home = newHome(FILE, { providers: { NODE_OPTIONS: {} } });
  const r = loadKeysEnv({ env: { PATH: '/bin' }, home, configured: ['NODE_OPTIONS', 'DEEPSEEK_API_KEY'] });
  assert.equal(r.env.NODE_OPTIONS, undefined);
  assert.deepEqual(r.keyNames, ['DEEPSEEK_API_KEY']);
  assert.equal(r.env.DEEPSEEK_API_KEY, 'k1');
  const s = loadKeysEnv({ env: { NODE_OPTIONS: '--x' }, home, configured: ['NODE_OPTIONS'] });
  assert.deepEqual(s.shellOnly, []);
});

test('gate 3: the provider route refuses a non-key slot by name, and the providers list omits it', async () => {
  const home = newHome(FILE);
  const h = remember(await createPanelServer({ port: 0, root: tmp('root'), settings: { home, env: {} } }));
  HANDLES.push(h);
  const bad = await rq(h.port, { method: 'POST', url: '/api/settings/provider', body: { slot: 'NODE_OPTIONS', baseUrl: 'http://127.0.0.1:9' } });
  assert.equal(bad.status, 400);
  assert.match(bad.json().say, /NODE_OPTIONS is not a key name\. A key name ends in _KEY, like MY_API_KEY\./);
  const list = await rq(h.port, { url: '/api/settings/providers' });
  assert.deepEqual(list.json().rows.map((r) => r.slot), ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']);
  const ok = await rq(h.port, { method: 'POST', url: '/api/settings/provider', body: { slot: 'OPENAI_API_KEY', baseUrl: 'http://127.0.0.1:9' } });
  assert.equal(ok.json().ok, true);
});
