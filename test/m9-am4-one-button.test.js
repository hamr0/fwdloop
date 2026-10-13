// M9 amendment 4: the Run card has ONE main button. When is changed -> it reads "Sign schedule" (two clicks, $0, starts nothing).
// Source checks plus a real-browser walk of the real panel (headless chromium; skips when none is installed). Fake provider, $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld } from './m9-trigger-world.mjs';

killChildrenAfter();
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

test('there is one main button on the Run card: no separate jf-when-set button, ids unique', () => {
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))], []);
  assert.equal(ids.includes('jf-when-set'), false);
  assert.doesNotMatch(PAGE, /jf-when-set/);
});

async function open(width = 1280) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const { w } = await greenWorld();
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true }); // the page would re-attach the signed draft as a live session and lock the card
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  await chrome.ev(`window.__posts = []; (function(){ var f = window.fetch; window.fetch = function(u, o){ if(o && o.method === "POST") window.__posts.push(String(u)); return f.apply(this, arguments); }; })()`);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'), 'mode radios enabled');
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "job2"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-when") && !document.getElementById("jf-when").disabled'));
  return { chrome, w };
}

// am5 replaced am4's "Click again to sign..." / "Saved..." lines and the Run-now-again-after-sign end state: click 1 now makes the button read
// "Confirm: <words>", click 2 clears the card. The full two-click walks (sign, cancel) live in m9-am5-schedule-buttons.test.js.
test('browser: changing When turns the main button into Sign schedule; click 1 dims it and prepares (no hint line); no run route is hit', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, w } = o;
  const label = () => chrome.ev('document.getElementById("chat-main-btn").textContent');
  assert.match(await label(), /^Run now — spends up to \$/, 'unchanged When: the main button runs');
  await chrome.ev('(function(){ var s = document.getElementById("jf-when"); s.value = "daily"; s.dispatchEvent(new Event("change", {bubbles: true})); })()');
  assert.equal(await label(), 'Sign schedule');
  const btn = 'document.getElementById("chat-main-btn")';
  assert.equal(await chrome.ev(`(function(){ ${btn}.click(); return ${btn}.disabled; })()`), true, 'dimmed at once on click 1');
  assert.ok(await chrome.waitFor('window.__posts.some(function(p){ return p.indexOf("trigger-prepare") !== -1; })'), 'click 1 = prepare');
  assert.ok(await chrome.waitFor(`!${btn}.disabled`), 'click 1 returns: undimmed');
  assert.match(await label(), /^Confirm: every day at \d\d:\d\d$/);
  const posts = await chrome.ev('window.__posts');
  assert.equal(posts.filter((p) => /\/api\/author\/run/.test(p)).length, 0, `no run route hit: ${posts}`);
  assert.deepEqual(w.starts(), [], 'no start folder');
  assert.equal(existsSync(path.join(w.root, 'job2', 'runs', 'run-1')), false, 'no run');
});

test('browser: changing When back to the signed value returns Run now and drops a half-done hash', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(390);
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, w } = o;
  await chrome.ev('(function(){ var s = document.getElementById("jf-when"); s.value = "daily"; s.dispatchEvent(new Event("change", {bubbles: true})); })()');
  await chrome.ev('document.getElementById("chat-main-btn").click()');
  assert.ok(await chrome.waitFor('window.__posts.some(function(p){ return p.indexOf("trigger-prepare") !== -1; })'));
  await chrome.ev('(function(){ var s = document.getElementById("jf-when"); s.value = "hand"; s.dispatchEvent(new Event("change", {bubbles: true})); })()');
  assert.match(await chrome.ev('document.getElementById("chat-main-btn").textContent'), /^Run now — spends up to \$/);
  assert.deepEqual(w.starts(), []);
});
