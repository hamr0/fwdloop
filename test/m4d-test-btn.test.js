// M4d Providers: a "[ Test ]" button on each key row, before Refresh. Layout + wiring only; the route (POST /api/settings/test) and its
// sentences are the server's, unchanged. $0: `fetch` is injected; the browser half drives headless chromium and skips when none is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
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
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-testbtn-${p}-`));
const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));

/** A ok, B refused (401), C server error (500), D slow-abort-free but no Base URL, E network failure. */
async function world() {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), ['A_KEY', 'B_KEY', 'C_KEY', 'D_KEY', 'E_KEY'].map((k) => `${k}=k-${k}-0123456789abcdef\n`).join(''), { mode: 0o600 });
  writeFileSync(configPath(home), JSON.stringify({
    providers: { A_KEY: { baseUrl: 'https://a.test/v1' }, B_KEY: { baseUrl: 'https://b.test/v1' }, C_KEY: { baseUrl: 'https://c.test/v1' }, E_KEY: { baseUrl: 'https://e.test/v1' } },
  }));
  const calls = [];
  const fetchImpl = async (url) => {
    const host = new URL(String(url)).host;
    calls.push(host);
    if (host === 'a.test') { await new Promise((r) => setTimeout(r, 30)); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'flash' }] }) }; }
    if (host === 'b.test') return { ok: false, status: 401, json: async () => ({}) };
    if (host === 'e.test') throw new Error('down');
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const h = remember(await createPanelServer({ port: 0, root: tmp('root'), settings: { home, env: {}, fetch: fetchImpl } }));
  HANDLES.push(h);
  return { h, calls };
}

test('page: the Test bracket button sits on each key row right before Refresh, with its aria-label and its disabled "testing…" word', () => {
  assert.match(PAGE, /data-act="test-key"[^>]*aria-label="' \+ escapeXml\("Test " \+ row\.envVar\)/);
  assert.ok(PAGE.includes('>Test</button><button class="btn small pv-refbtn"'), 'Test comes immediately before Refresh');
  assert.ok(PAGE.includes('testing&hellip;'));
});

const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
test('browser: Test per key row; no Base URL = text and no call; ok = "OK · N ms"; failures = the route\'s sentences', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const { h, calls } = await world();
  await chrome.open(`http://127.0.0.1:${h.port}/`, 1280);
  await chrome.ev('document.getElementById("settings-open").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll(".pv-key").length === 5'));
  assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-sum\').textContent.includes("model")'));
  assert.deepEqual(await chrome.ev('[...document.querySelectorAll(".pv-key")].map(k => k.querySelector("[data-act=test-key]").getAttribute("aria-label"))'),
    ['Test A_KEY', 'Test B_KEY', 'Test C_KEY', 'Test D_KEY', 'Test E_KEY']);
  assert.equal(await chrome.ev('(function(){var b=document.querySelector(".pv-krow [data-act=test-key]");return b.textContent+"|"+getComputedStyle(b,"::before").content+getComputedStyle(b,"::after").content+"|"+(b.nextElementSibling===document.querySelector(".pv-krow [data-act=refresh-models]"));})()'), 'Test|"[ "" ]"|true');
  const msg = (s) => chrome.ev(`document.querySelector('.pv-key[data-slot="${s}"] [data-f=msg-test]').textContent`);
  const click = (s) => chrome.ev(`document.querySelector('.pv-key[data-slot="${s}"] [data-act=test-key]').click()`);
  const before = calls.length;
  await click('D_KEY');
  assert.ok(await chrome.waitFor(`document.querySelector('.pv-key[data-slot="D_KEY"] [data-f=msg-test]').textContent.length > 0`));
  assert.equal(await msg('D_KEY'), 'Type a Base URL for D_KEY in Settings.');
  assert.equal(calls.length, before, 'no Base URL: no call');
  await click('A_KEY');
  assert.equal(await chrome.ev(`(function(){var b=document.querySelector('.pv-key[data-slot="A_KEY"] [data-act=test-key]');return b.disabled+"|"+b.textContent;})()`), 'true|testing…');
  assert.ok(await chrome.waitFor(`/^OK · \\d+ ms$/.test(document.querySelector('.pv-key[data-slot="A_KEY"] [data-f=msg-test]').textContent)`));
  assert.equal(await chrome.ev(`document.querySelector('.pv-key[data-slot="A_KEY"] [data-act=test-key]').disabled`), false);
  assert.equal(await chrome.ev(`document.querySelector('.pv-key[data-slot="A_KEY"] [data-act=test-key]').textContent`), 'Test');
  for (const [s, why] of [['B_KEY', 'The provider refused the key.'], ['C_KEY', 'The provider answered with an error.'], ['E_KEY', 'Could not reach the provider.']]) {
    await click(s);
    assert.ok(await chrome.waitFor(`document.querySelector('.pv-key[data-slot="${s}"] [data-f=msg-test]').textContent.length > 0`));
    assert.equal(await msg(s), why);
  }
});

test('browser: grid keeps one set of column edges; the last track fits both buttons (even "testing…" / "⟳ refreshing…") on one line, never clipped', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const { h } = await world();
  const probe = `(function(){
    var r=function(e){return e.getBoundingClientRect();}, out={};
    var k=document.querySelector('.pv-key[data-slot="A_KEY"] .pv-krow'), A=document.querySelector('.pv-key[data-slot="A_KEY"]');
    var tb=k.querySelector('[data-act=test-key]'), rb=k.querySelector('[data-act=refresh-models]');
    var o={t:tb.innerHTML,r:rb.innerHTML,td:tb.disabled,rd:rb.disabled};
    tb.disabled=true; tb.innerHTML='testing&hellip;'; rb.disabled=true; rb.innerHTML='&#10227; refreshing&hellip;';
    var cell=tb.parentNode, cr=r(cell), a=r(tb), b=r(rb);
    out.oneLine = Math.abs(a.top-b.top) < 2 && a.height < 44 && b.height < 44;
    out.fits = a.left >= cr.left - 0.5 && b.right <= cr.right + 0.5 && a.right <= b.left && tb.scrollWidth <= tb.clientWidth && rb.scrollWidth <= rb.clientWidth;
    out.inside = b.right <= r(k).right + 0.5 && a.left >= r(k).left;
    tb.innerHTML=o.t; rb.innerHTML=o.r; tb.disabled=o.td; rb.disabled=o.rd;
    var m=A.querySelector('.pv-mrow');
    if(m) out.tokEdge = Math.round(r(k.querySelector('[data-f=tokens]')).left) === Math.round(r(m.querySelector('[data-f=model-tokens]')).left);
    out.tokLeft = Math.round(r(k.querySelector('[data-f=tokens]')).left);
    out.cols = getComputedStyle(k).gridTemplateColumns;
    out.sw = document.documentElement.scrollWidth === document.documentElement.clientWidth;
    return out;
  })()`;
  for (const w of [1920, 1280, 1279, 1024, 780, 390, 320]) {
    await chrome.open(`http://127.0.0.1:${h.port}/`, w);
    await chrome.ev('document.getElementById("settings-open").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll(".pv-key").length === 5'));
    assert.ok(await chrome.waitFor('document.querySelector(\'.pv-key[data-slot="A_KEY"] .pv-mrow\') !== null'));
    const g = await chrome.ev(probe);
    assert.ok(g.oneLine, `both buttons on one line at ${w}: ${JSON.stringify(g)}`);
    assert.ok(g.fits, `both buttons fully inside their cell at ${w}: ${JSON.stringify(g)}`);
    assert.ok(g.inside && g.sw, `no spill at ${w}`);
    if (w > 1279) assert.ok(g.tokEdge, `key and model TOKENS share an edge at ${w}`);
  }
});
