// M4d amendment 35: next to Settings the header shows a green "● online" while the panel answers and a red "● offline" when the page's own Inbox read
// (every 10 s, no new call) fails. An HTTP answer of any status = online; only a network failure = offline. Drives the real panel in headless chromium
// (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { greenWorld } from './m9-trigger-world.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');

async function open(t, width = 1280) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  // window.__inbox: 'ok' | 'net' (network failure) | 'http500'; every other call passes through
  await chrome.ev(`(function(){ window.__inbox = "ok"; window.__inboxReads = 0; var real = window.fetch;
    window.fetch = function(u){
      if(String(u) === "/api/inbox"){
        __inboxReads++;
        if(__inbox === "net") return Promise.reject(new TypeError("Failed to fetch"));
        if(__inbox === "http500") return Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } }));
      }
      return real.apply(this, arguments); }; return true; })()`);
  return chrome;
}
const dot = (c) => c.ev('(function(){ var e = document.getElementById("online-dot"); return e.textContent + "|" + e.className; })()');
// the page's own catch-up path (a tab coming back) runs one tick that forces the lists read
const poll = async (c, mode) => {
  await c.ev(`window.__inbox = ${JSON.stringify(mode)}; window.__before = window.__inboxReads; document.dispatchEvent(new Event("visibilitychange")); true`);
  assert.ok(await c.waitFor('window.__inboxReads > window.__before', 10000), 'an Inbox read happened');
  await new Promise((r) => setTimeout(r, 300));
};

test('am35: online on load; a network-failed Inbox read shows offline; the next good read shows online; an HTTP 500 stays online', async (t) => {
  const c = await open(t);
  if (!c) return;
  assert.equal(await dot(c), '● online|on');
  await poll(c, 'net');
  assert.equal(await dot(c), '● offline|off');
  await poll(c, 'ok');
  assert.equal(await dot(c), '● online|on');
  await poll(c, 'net');
  assert.equal(await dot(c), '● offline|off');
  await poll(c, 'http500');
  assert.equal(await dot(c), '● online|on', 'node answered with an error: still online');
});

test('am35: the dot sits next to Settings and its id is unique', () => {
  assert.equal(PAGE.split(' id="online-dot"').length - 1, 1);
  assert.match(PAGE, /id="settings-open"[^>]*>&#9881; Settings<\/button>\s*<span id="online-dot"/);
});

for (const width of [1280, 390, 320]) {
  test(`am35: at ${width}px the header does not spill and the dot is one line (online and offline)`, async (t) => {
    const c = await open(t, width);
    if (!c) return;
    const measure = () => c.ev(`(function(){ var e = document.getElementById("online-dot"); var b = e.getBoundingClientRect(); var s = document.getElementById("settings-open").getBoundingClientRect();
      var top = document.querySelector(".topbar");
      return { h: b.height, lh: parseFloat(getComputedStyle(e).lineHeight) || 0, fs: parseFloat(getComputedStyle(e).fontSize), left: b.left, right: b.right, w: window.innerWidth,
        topSpill: top.scrollWidth - top.clientWidth, pageSpill: document.documentElement.scrollWidth - document.documentElement.clientWidth, overlap: !(b.left >= s.right - 0.5 || b.right <= s.left + 0.5) }; })()`);
    for (const mode of ['ok', 'net']) {
      if (mode === 'net') await poll(c, 'net');
      const m = await measure();
      const label = `${width} ${mode} ${JSON.stringify(m)}`;
      assert.ok(m.h < m.fs * 2, `one line: ${label}`);
      assert.ok(m.left >= 0 && m.right <= m.w, `inside the window: ${label}`);
      assert.ok(m.topSpill <= 0 && m.pageSpill <= 0, `no spill: ${label}`);
      assert.equal(m.overlap, false, `not on top of Settings: ${label}`);
    }
  });
}
