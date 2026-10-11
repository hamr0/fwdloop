// M4d Providers layout A (hamr approved 2026-10-11): one parent row per key, child model rows, a fold, and a pencil that edits
// shape + Base URL in place. Layout only: every rule and refusal sentence is the server's, unchanged. $0, no network
// (`fetch` is injected); the browser half drives a real headless chromium and skips when none is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { configPath } from '../src/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CANARY = 'canary-key-m4d-layouta-9f8e7d6c5b4a39281706';
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-layouta-${p}-`));

const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));

/** Four keys: A has two listed models (one ticked with prices), B three listed none ticked, C's list fails, D nothing typed. */
async function world() {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), ['A_KEY', 'B_KEY', 'C_KEY'].map((k) => `${k}=${CANARY}\n`).join(''), { mode: 0o600 });
  writeFileSync(configPath(home), JSON.stringify({
    providers: { A_KEY: { baseUrl: 'https://a.test/v1' }, B_KEY: { baseUrl: 'https://b.test/v1' }, C_KEY: { baseUrl: 'https://c.test/v1' } },
    models: { A_KEY: [{ model: 'flash', use: true, inPerM: 0.4, outPerM: 1.2 }] },
  }));
  // spend: two rows name model "flash", one names no model; B has a row too (key tokens only)
  const runDir = tmp('rundir');
  const row = (provider, model, input, output) => JSON.stringify({ provider, ...(model ? { model } : {}), tokens: { inputTokens: input, outputTokens: output }, costUsd: 0.01, spendComplete: true, price: { inPerM: 1, outPerM: 1 }, at: new Date().toISOString() });
  writeFileSync(path.join(runDir, 'spend.jsonl'), `${[row('A_KEY', 'flash', 1000, 234), row('A_KEY', 'flash', 100, 66), row('A_KEY', null, 500, 0), row('B_KEY', 'b1', 10, 5)].join('\n')}\n`);
  writeFileSync(path.join(home, 'runs.jsonl'), `${JSON.stringify({ kind: 'hold', holdId: 'h1', what: 'run', flow: 'f', runId: 'r', runDir, pid: 1, holdUsd: 1, spentAtHold: 0, at: new Date().toISOString() })}\n`);
  const lists = { 'a.test': ['flash', 'v4-pro'], 'b.test': ['b1', 'b2', 'b3'] };
  const fetchImpl = async (url) => {
    const host = new URL(String(url)).host;
    if (!lists[host]) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data: lists[host].map((id) => ({ id })) }) };
  };
  const h = remember(await createPanelServer({ port: 0, root: tmp('root'), settings: { home, env: {}, fetch: fetchImpl } }));
  HANDLES.push(h);
  return { h, home };
}
const getJson = async (port, url) => (await fetch(`http://127.0.0.1:${port}${url}`)).json();

test('server: each model line carries its own tokens from the spend rows that name it; none = absent (never 0); the key keeps its whole total', async () => {
  const { h } = await world();
  const d = await getJson(h.port, '/api/settings/providers');
  const a = d.rows.find((r) => r.slot === 'A_KEY');
  assert.equal(a.tokens, 1900, 'the key total counts every row of the key, model named or not');
  assert.deepEqual(a.models, [{ model: 'flash', use: true, inPerM: 0.4, outPerM: 1.2, tokens: 1400 }]);
  assert.equal(d.rows.find((r) => r.slot === 'B_KEY').models.length, 0, 'unlisted models are the page\'s, not the server\'s');
  assert.equal(d.rows.find((r) => r.slot === 'B_KEY').tokens, 15, 'a key whose rows name a model that is not a saved line still totals');
  assert.ok(!JSON.stringify(d).includes(CANARY));
});

test('page: the layout-A skeleton is in the source (columns, fold, pencil, aria-labels, footnote) and the old table is gone', () => {
  assert.doesNotMatch(PAGE, /<table class="pv-table"/);
  for (const t of ['KEY / MODEL', 'SHAPE · BASE URL', 'OLD MAX_TOKENS', 'USE', 'IN $/1M', 'OUT $/1M', 'TOKENS']) assert.ok(PAGE.includes(t), t);
  assert.match(PAGE, /"Refresh models for " \+/);
  assert.match(PAGE, /"Edit " \+/);
  assert.ok(PAGE.includes('refresh models (free) · ✎ edit shape / base URL · old max_tokens: tick if the server wants the old field name'));
  assert.match(PAGE, /@media \(max-width: ?600px\)/);
});

const CHROME_SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
test('browser: fold default, ✎ save / cancel round trip, refusal sentence, unique ids, labels', { skip: CHROME_SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const { h, home } = await world();
  await chrome.open(`http://127.0.0.1:${h.port}/`, 1280);
  await chrome.ev('document.getElementById("settings-open").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll(".pv-key").length === 3'), 'one parent row per key');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="B_KEY"] .pv-sum\').textContent.includes("3 models")'), 'B listed');
  const q = (expr) => chrome.ev(expr);
  // fold default: A (a ticked model) unfolded; B (none ticked) and C (list failed) folded
  assert.deepEqual(await q('[...document.querySelectorAll(".pv-key")].map(k => [k.dataset.slot, k.dataset.open])'), [['A_KEY', '1'], ['B_KEY', '0'], ['C_KEY', '0']]);
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="B_KEY"] .pv-sum\').textContent'), '3 models · none ticked');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-sum\').textContent'), '2 models · 1 ticked');
  assert.equal(await q('getComputedStyle(document.querySelector(\'.pv-key[data-slot="B_KEY"] .pv-models\')).display'), 'none', 'folded hides its models');
  assert.equal(await q('document.querySelectorAll(\'.pv-key[data-slot="A_KEY"] .pv-mrow\').length'), 2);
  // the fold toggles and survives a repaint
  await q('document.querySelector(\'.pv-key[data-slot="B_KEY"] [data-act=fold]\').click()');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="B_KEY"]\').dataset.open'), '1');
  await q('document.getElementById("reload-keys").click()');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="B_KEY"]\').dataset.open'), '1', 'a repaint keeps the person\'s fold');
  // per-model tokens: the model that rows name shows them, the other shows a dash
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="flash"] [data-f=model-tokens]\').textContent'), '1.4k');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-f=model-tokens]\').textContent'), '—');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-f=tokens]\').textContent'), '1.9k');
  // the key line, labels, one line of grey text
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-line\').textContent'), 'OpenAI-compatible · a.test/v1');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=refresh-models]\').getAttribute("aria-label")'), 'Refresh models for A_KEY');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=edit]\').getAttribute("aria-label")'), 'Edit A_KEY');
  // unique ids after every row is painted
  assert.deepEqual(await q('(function(){var s={},d=[];document.querySelectorAll("[id]").forEach(function(e){if(s[e.id])d.push(e.id);s[e.id]=1;});return d;})()'), []);
  // pencil: boxes appear; Cancel writes nothing and folds back to one line
  const before = readFileSync(configPath(home), 'utf8');
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=edit]\').click()');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\').value'), 'https://a.test/v1');
  await q('(function(){var i=document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\');i.value="https://zzz.test/v9";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=edit-cancel]\').click()');
  assert.equal(await q('document.querySelectorAll(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\').length'), 0, 'boxes gone');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-line\').textContent'), 'OpenAI-compatible · a.test/v1');
  assert.equal(readFileSync(configPath(home), 'utf8'), before, 'Cancel saves nothing');
  // pencil: a refused value keeps the boxes open and shows the server's exact sentence; nothing saved
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=edit]\').click()');
  await q('(function(){var i=document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\');i.value="ftp://nope";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=edit-save]\').click()');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-f=msg-edit]\').textContent.length > 0'));
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-f=msg-edit]\').textContent'), 'The Base URL must start with http:// or https://. Nothing was saved.');
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  // pencil: Save writes shape + Base URL and folds back to one line
  await q('(function(){var k=document.querySelector(\'.pv-key[data-slot="A_KEY"]\');var i=k.querySelector("[data-prov=baseUrl]");i.value="https://new.test/v2";i.dispatchEvent(new Event("input",{bubbles:true}));var s=k.querySelector("[data-prov=shape]");s.value="anthropic-api";s.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=edit-save]\').click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\').length === 0'));
  const saved = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.equal(saved.providers.A_KEY.baseUrl, 'https://new.test/v2');
  assert.equal(saved.providers.A_KEY.shape, 'anthropic-api');
  assert.match(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-line\').textContent'), /new\.test\/v2$/);
  // ticking a model with no price: the server's sentence, the tick put back
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-mf=use]\').click()');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-f=msg-model]\').textContent.length > 0'));
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-f=msg-model]\').textContent'), 'Fill both prices to tick this model.');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-mf=use]\').checked === false'));
});
