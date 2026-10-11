// M4d amendment 3, A item 2 — the "Thinking on (drafting)" setting. $0: temp config homes, no network, fake provider / local server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import {
  readConfig, updateConfig, configPath, ConfigError, draftThinkingMode,
} from '../src/config.js';
import { createSettings } from '../src/panel/settings.js';
import { draft } from '../src/drafter.js';
import { makeProvider } from '../src/provider.js';
import { job2Fixture, validArgs } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const home = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m4d3a-'));
// M4d am5: the drafting model, its prices and how its thinking turns off all come from its ticked Settings line.
const LINE = { model: 'deepseek-flash', use: true, inPerM: 0.3, outPerM: 1.2, thinkingOff: 'disabled' };
const tickedAt = (h, line = LINE) => updateConfig({ models: { deepseek: [line] } }, { home: h });
const get = (s) => s.handle({ method: 'GET', pathname: '/api/settings/providers', query: new URLSearchParams(), body: null });
const post = (s, body) => s.handle({ method: 'POST', pathname: '/api/settings/thinking', query: new URLSearchParams(), body });

test('config: draftThinking round-trips; absent = off; other fields are kept; a non-boolean is refused', () => {
  const h = home();
  assert.equal(draftThinkingMode(readConfig({ home: h })), 'off');
  updateConfig({ monthlyLimitUsd: 5, futureField: 'kept' }, { home: h });
  updateConfig({ draftThinking: true }, { home: h });
  const c = readConfig({ home: h });
  assert.equal(c.draftThinking, true);
  assert.equal(c.futureField, 'kept');
  assert.equal(draftThinkingMode(c), 'on');
  updateConfig({ draftThinking: false }, { home: h });
  assert.equal(draftThinkingMode(readConfig({ home: h })), 'off');
  assert.throws(() => updateConfig({ draftThinking: 'yes' }, { home: h }), ConfigError);
  assert.equal(readConfig({ home: h }).draftThinking, false, 'a refusal leaves the file untouched');
  writeFileSync(configPath(h), JSON.stringify({ draftThinking: 1 }));
  assert.throws(() => readConfig({ home: h }), ConfigError, 'a hand-edited non-boolean never reads as a mode');
});

test('route: the providers read says on/off and whether this model can change it; the post saves it', async () => {
  const h = home();
  tickedAt(h);
  const s = createSettings({ home: h, env: {} });
  let g = (await get(s)).body;
  assert.deepEqual(g.draftThinking, { on: false, canChange: true, model: 'deepseek-flash', why: null });
  const r = await post(s, { on: true });
  assert.equal(r.body.ok, true);
  assert.equal(readConfig({ home: h }).draftThinking, true);
  g = (await get(s)).body;
  assert.equal(g.draftThinking.on, true);
  assert.equal((await post(s, { on: 'yes' })).body.ok, false);
  assert.equal(readConfig({ home: h }).draftThinking, true, 'a bad body saves nothing');
});

test('route: a drafting model whose line says "can\'t" says it cannot change this, and saves nothing (M4d am5 item 3: the line decides, no allow-list)', async () => {
  const h = home();
  tickedAt(h, { ...LINE, model: 'some-local-model', thinkingOff: 'cant' });
  const s = createSettings({ home: h, env: {} });
  assert.deepEqual((await get(s)).body.draftThinking, { on: false, canChange: false, model: 'some-local-model', why: null });
  const r = await post(s, { on: true });
  assert.equal(r.body.ok, false);
  assert.match(r.body.say, /can't change this for this model/);
  assert.equal(readConfig({ home: h }).draftThinking, undefined);
  // the same model name with the line set to "disabled" CAN change: the name alone decides nothing
  tickedAt(h, { ...LINE, model: 'some-local-model', thinkingOff: 'disabled' });
  assert.equal((await get(s)).body.draftThinking.canChange, true);
});

test('route: nothing ticked - the box cannot change and says what to do', async () => {
  const s = createSettings({ home: home(), env: {} });
  const d = (await get(s)).body.draftThinking;
  assert.deepEqual([d.canChange, d.model], [false, null]);
  assert.match(d.why, /^Tick a model in Settings > Providers/);
});

test('page: one tick-box "Thinking on (drafting)", wired to the route, with the cannot-change line', () => {
  assert.equal((PAGE.match(/\sid="dt-box"/g) ?? []).length, 1);
  assert.match(PAGE, /Thinking on \(drafting\)/);
  assert.match(PAGE, /can't change this for this model/);
  assert.match(PAGE, /\/api\/settings\/thinking/);
});

test('drafter reads the setting per draft from the config home: unticked sends disabled, ticked sends nothing', async () => {
  const h = home();
  tickedAt(h);
  const saved = { cfg: process.env.FWDLOOP_CONFIG_HOME, key: process.env.DEEPSEEK_API_KEY };
  process.env.FWDLOOP_CONFIG_HOME = h;
  process.env.DEEPSEEK_API_KEY = 'sk-fake-test-key';
  let body;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [
          { id: 't1', type: 'function', function: { name: 'emit_declaration', arguments: JSON.stringify(validArgs()) } }] } }],
        model: 'deepseek-flash', usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 0 } },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const go = async () => {
    const r = await draft({
      proseText: job2Fixture().prose,
      makeProviderFn: (slot, opts) => { const b = makeProvider(slot, opts); b.provider.baseUrl = `http://127.0.0.1:${server.address().port}`; return b; },
    });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
    return body;
  };
  try {
    assert.deepEqual((await go()).thinking, { type: 'disabled' });
    updateConfig({ draftThinking: true }, { home: h });
    assert.equal((await go()).thinking, undefined, 'read again on the next draft');
    updateConfig({ draftThinking: false }, { home: h });
    assert.deepEqual((await go()).thinking, { type: 'disabled' });
  } finally {
    for (const [k, v] of [['FWDLOOP_CONFIG_HOME', saved.cfg], ['DEEPSEEK_API_KEY', saved.key]]) { if (v !== undefined) process.env[k] = v; else delete process.env[k]; }
    await new Promise((resolve) => server.close(resolve));
  }
});
