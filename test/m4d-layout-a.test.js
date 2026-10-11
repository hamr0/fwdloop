// M4d Providers layout F (hamr approved 2026-10-11, the lab's Variant F): one shared grid, a key band with real shape / Base URL boxes
// (saved on change), child model rows (USE next to the model name, In/Out side by side), a fold. Layout only: every rule and refusal sentence is the server's, unchanged. $0, no network
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

test('page: the layout-F skeleton is in the source (key band head, model sub-head, refresh bracket, aria-labels, footnote) and the old table, the pencil and the Edit button are gone', () => {
  assert.doesNotMatch(PAGE, /<table class="pv-table"/);
  const head = PAGE.match(/<div class="pv-head"[\s\S]*?<\/div>/)[0];
  assert.deepEqual([...head.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]), ['KEY', 'API SHAPE', 'BASE URL', 'OLD MAX_TOKENS', 'TOKENS', '']);
  assert.ok(PAGE.includes('USE') && PAGE.includes('IN $/1M') && PAGE.includes('OUT $/1M'));
  assert.match(PAGE, /"Refresh models for " \+/);
  assert.ok(PAGE.includes('&#10227; Refresh<') && PAGE.includes('&#10227; refreshing&hellip;'));
  assert.doesNotMatch(PAGE, /data-act="edit|"Edit " \+|openEdit|closeEdit|saveEdit|edit-save/);
  assert.ok(PAGE.includes('refresh models (free) · old max_tokens: tick if the server wants the old field name'));
  assert.match(PAGE, /@media \(max-width: ?720px\)/);
});

const CHROME_SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
test('browser: layout F geometry, fold default, shape / Base URL save on change, refusal sentence, unique ids, labels', { skip: CHROME_SKIP && 'no browser' }, async (t) => {
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
  // GEOMETRY (items 1, 3, 4, 5, 6): the same column edges, USE touching the name, In/Out side by side, the Refresh label on one line
  const geo = await q(`(function(){
    var A=document.querySelector('.pv-key[data-slot="A_KEY"]'), r=function(e){return e.getBoundingClientRect();};
    var k=A.querySelector('.pv-krow'), m=A.querySelector('.pv-mrow[data-model="flash"]'), mh=A.querySelector('.pv-mhead'), hd=document.querySelector('.pv-head');
    var url=r(k.querySelector('[data-prov=baseUrl]')), shape=r(k.querySelector('[data-prov=shape]')), old=r(k.querySelector('[data-prov=legacyMaxTokens]'));
    var use=r(m.querySelector('[data-mf=use]')), name=r(m.querySelector('.pv-m-name')), inn=r(m.querySelector('[data-mf=inPerM]')), out=r(m.querySelector('[data-mf=outPerM]'));
    var tokK=r(k.querySelector('[data-f=tokens]')), tokM=r(m.querySelector('[data-f=model-tokens]'));
    var btn=k.querySelector('[data-act=refresh-models]'), br=r(btn), kr=r(k);
    return {
      keyNameLeft: Math.round(r(k.querySelector('.pv-name code')).left), modelNameVsUse: Math.round(name.left - r(m.querySelector('.pv-m-use')).right),
      useBox: Math.round(r(m.querySelector('.pv-m-use')).width),
      inOutGap: Math.round(out.left - inn.right), sameRow: Math.abs(inn.top - out.top) < 2,
      tokRight: Math.round(tokK.right) === Math.round(tokM.right), tokLeft: Math.round(tokK.left) === Math.round(tokM.left),
      oldOwnCol: old.right <= tokK.left && old.left >= url.right - 1 && old.left >= out.right - 0.5,
      urlUnderPair: Math.abs(url.left - inn.left) < 2 && Math.abs(url.right - out.right) < 2,
      shapeIsSelect: k.querySelector('[data-prov=shape]').tagName, urlIsText: k.querySelector('[data-prov=baseUrl]').type,
      refreshOneLine: btn.scrollWidth <= btn.clientWidth && br.height < 44 && getComputedStyle(btn).whiteSpace === 'nowrap', refreshText: btn.textContent, refreshBrackets: getComputedStyle(btn, '::before').content + ' ' + getComputedStyle(btn, '::after').content,
      headEdges: [...hd.children].map(function(c){return Math.round(r(c).left);}), keyEdges: [...k.children].map(function(c){return Math.round(r(c).left);}),
      keyBorder: getComputedStyle(A).borderTopStyle + ' ' + getComputedStyle(A).borderTopWidth, modBorder: getComputedStyle(m).borderTopStyle + ' ' + getComputedStyle(m).borderTopWidth,
      mhead: mh ? mh.textContent.replace(/\\s+/g, ' ').trim() : null
    };
  })()`);
  assert.equal(geo.shapeIsSelect, 'SELECT'); assert.equal(geo.urlIsText, 'text');
  assert.ok(geo.modelNameVsUse === 0, `the name sits against the USE cell (${geo.modelNameVsUse})`);
  assert.equal(geo.useBox, 44, 'the checkbox cell is 44px');
  assert.ok(geo.sameRow && geo.inOutGap >= 6 && geo.inOutGap <= 10, `In/Out side by side with ~8px (${geo.inOutGap})`);
  assert.ok(geo.tokRight && geo.tokLeft, 'model TOKENS sit on the key band\'s TOKENS edge');
  assert.ok(geo.urlUnderPair, 'Base URL spans the same columns as In + Out');
  assert.ok(geo.oldOwnCol, 'OLD MAX_TOKENS has its own column, clear of the price boxes');
  assert.ok(geo.refreshOneLine, 'Refresh is one line, never squeezed');
  assert.equal(geo.refreshText, '⟳ Refresh');
  assert.equal(geo.refreshBrackets, '"[ " " ]"', 'the panel\'s own bracket button look');
  assert.equal(geo.keyBorder, 'solid 1px'); assert.equal(geo.modBorder, 'dotted 1px');
  assert.match(geo.mhead, /^USE\s*MODEL\s*IN \$\/1M\s*OUT \$\/1M\s*TOKENS$/);
  assert.equal(geo.headEdges[1], geo.keyEdges[1], 'API SHAPE head and the select share an edge');
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
  // shape + Base URL are the key row's own boxes, no pencil
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\').value'), 'https://a.test/v1');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=shape]\').selectedOptions[0].textContent'), 'OpenAI-compatible');
  assert.equal(await q('document.querySelectorAll("[data-act=edit]").length'), 0);
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-act=refresh-models]\').getAttribute("aria-label")'), 'Refresh models for A_KEY');
  // unique ids after every row is painted
  assert.deepEqual(await q('(function(){var s={},d=[];document.querySelectorAll("[id]").forEach(function(e){if(s[e.id])d.push(e.id);s[e.id]=1;});return d;})()'), []);
  // a refused Base URL: on change the server's exact sentence, nothing saved
  const before = readFileSync(configPath(home), 'utf8');
  await q('(function(){var i=document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\');i.value="ftp://nope";i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-f=msg-edit]\').textContent.length > 0'));
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-f=msg-edit]\').textContent'), 'The Base URL must start with http:// or https://. Nothing was saved.');
  assert.equal(readFileSync(configPath(home), 'utf8'), before);
  // a change of either box saves BOTH, judged together
  await q('(function(){var k=document.querySelector(\'.pv-key[data-slot="A_KEY"]\');var i=k.querySelector("[data-prov=baseUrl]");i.value="https://new.test/v2";i.dispatchEvent(new Event("input",{bubbles:true}));var s=k.querySelector("[data-prov=shape]");s.value="anthropic-api";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await new Promise((r) => setTimeout(r, 800));
  const saved = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.equal(saved.providers.A_KEY.baseUrl, 'https://new.test/v2');
  assert.equal(saved.providers.A_KEY.shape, 'anthropic-api');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-prov=baseUrl]\').value'), 'https://new.test/v2');
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] [data-f=msg-edit]\').textContent'), '', 'the refusal is gone after a good save');
  // ticking a model with no price: the server's sentence, the tick put back
  await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-mf=use]\').click()');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-f=msg-model]\').textContent.length > 0'));
  assert.equal(await q('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-f=msg-model]\').textContent'), 'Fill both prices to tick this model.');
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow[data-model="v4-pro"] [data-mf=use]\').checked === false'));
});
