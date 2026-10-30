// Settings > Providers (hamr ruling 2026-10-30, copied from bareloop 9ae105f + 357a482): every key starts folded, and a clicked model row turns blue
// (:focus-within needs the row itself focusable: tabindex -1). $0, no network. The browser half drives headless chromium (headless Firefox never has window focus).
// Must fail when: the fold default follows a ticked model again; the row loses tabindex; the focus-within rule is gone.
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
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-pvfocus-${p}-`));
const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));

async function world() {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), 'A_KEY=canary-key-pvfocus-0123456789abcdef\n', { mode: 0o600 });
  writeFileSync(configPath(home), JSON.stringify({
    providers: { A_KEY: { baseUrl: 'https://a.test/v1' } },
    models: { A_KEY: [{ model: 'flash', use: true, inPerM: 0.4, outPerM: 1.2 }] },
  }));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'flash' }, { id: 'b2' }] }) });
  const h = remember(await createPanelServer({ port: 0, root: tmp('root'), settings: { home, env: {}, fetch: fetchImpl } }));
  HANDLES.push(h);
  return h;
}

test('page: the fold default is false for every key, even one with a ticked model', () => {
  assert.match(PAGE, /if\(folds\[row\.slot\] === undefined\) folds\[row\.slot\] = false;/);
  assert.doesNotMatch(PAGE, /folds\[row\.slot\] = row\.models\.some/);
});

test('page: the model row is focusable (tabindex -1) and the focus-within rule is the Runs-list blue with a ring', () => {
  assert.match(PAGE, /d\.className = "pv-mrow";\s*d\.tabIndex = -1;/);
  assert.match(PAGE, /\.pv-mrow:focus-within,\.pv-mrow:focus-within:hover\{background:var\(--rl-accent-bg-strong\);box-shadow:inset 0 0 0 2px var\(--accent\);\}/);
  assert.match(PAGE, /\.pv-mrow:hover\{background:var\(--panel2\);\}/);
  assert.match(PAGE, /\.pv-mrow:focus\{outline:none;\}/);
});

const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: keys start folded; clicking a model row gives it the blue focus-within background; no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const h = await world();
    await chrome.open(`http://127.0.0.1:${h.port}/`, width);
    await chrome.ev('document.getElementById("settings-open").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll(".pv-key").length === 1 && document.querySelectorAll(".pv-mrow").length >= 2'));
    assert.equal(await chrome.ev('document.querySelector(".pv-key").dataset.open'), '0', 'a key with a ticked model starts folded');
    await chrome.ev('document.querySelector(".pv-key [data-act=fold]").click()');
    const bg = (sel) => chrome.ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundColor`);
    const sel = '.pv-mrow[data-model="b2"]';
    const before = await bg(sel);
    // a real click on the row's own padding (not a field): CDP mouse events at the row's name
    const pt = await chrome.ev(`(function(){document.querySelector('${sel}').scrollIntoView({block:'center'});var r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+3,y:r.top+2};})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    assert.ok(await chrome.waitFor(`document.querySelector('${sel}').matches(':focus-within')`, 3000), 'the click focused the row');
    const want = await chrome.ev('(function(){var p=document.createElement("i");p.style.background="var(--rl-accent-bg-strong)";document.body.appendChild(p);var c=getComputedStyle(p).backgroundColor;p.remove();return c;})()');
    const now = await bg(sel);
    assert.equal(now, want, `focused row wears --rl-accent-bg-strong (was ${before})`);
    assert.notEqual(now, before);
    assert.equal(await chrome.ev(`getComputedStyle(document.querySelector('${sel}')).outlineStyle`), 'none');
    assert.ok(await chrome.ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no horizontal spill');
    if (process.env.PV_SHOTS) await chrome.screenshot(path.join(process.env.PV_SHOTS, `providers-${width}.png`));
  });
}
