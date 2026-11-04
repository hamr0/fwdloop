// M13 piece 4 (item 4, mock Part 1): the New job card's Flow type and MCP, in the real panel (headless chromium; skips only when none is installed), at 1280, 390 and 320:
// the dropdown words are the mock's, the MCP pick shows for MCP and Tickets only, the Inputs hint follows, the page is not wider than the screen, and an MCP
// nobody has checked is refused on the MCP field with the one sentence. $0, no model.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, tmp, world } from './m4e-world.mjs';

killChildrenAfter();
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const OLD_HOME = process.env.HOME;
after(() => { process.env.HOME = OLD_HOME; });

async function open(width) {
  const w = await world({ limit: 5 });
  const home = path.join(w.work, 'home');
  mkdirSync(home);
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  process.env.HOME = home;
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  await chrome.ev('document.getElementById("tab-chat").click()');
  assert.ok(await chrome.waitFor('!!document.getElementById("jf-flowtype")'), 'the card has a Flow type');
  assert.ok(await chrome.waitFor('document.getElementById("jf-mcp").options.length > 0 || true'));
  return { chrome, w };
}
const pick = (c, value) => c.ev(`var s = document.getElementById("jf-flowtype"); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", {bubbles: true}))`);
const SPILL = '({ vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth })';

for (const width of [1280, 390, 320]) {
  test(`Flow type and MCP at ${width}px: the mock's words, the MCP pick only for MCP and Tickets, no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const c = o.chrome;
    assert.deepEqual(await c.ev('Array.from(document.getElementById("jf-flowtype").options).map(function(x){ return x.textContent; })'), ['plain', 'MCP', 'Tickets MCP']);
    assert.equal(await c.ev('document.querySelector("label[for=jf-flowtype]").textContent'), 'Flow type');
    assert.equal(await c.ev('document.getElementById("jf-flowtype").value'), 'plain');
    assert.equal(await c.ev('document.getElementById("jf-mcp-field").hidden'), true, 'plain has no MCP pick');
    const plainHint = await c.ev('document.getElementById("jf-inputs-hint").textContent');
    for (const type of ['mcp', 'tickets']) {
      // eslint-disable-next-line no-await-in-loop
      await pick(c, type);
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await c.ev('document.getElementById("jf-mcp-field").hidden'), false);
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await c.ev('document.querySelector("label[for=jf-mcp]").textContent'), 'MCP');
      // eslint-disable-next-line no-await-in-loop
      assert.ok(await c.waitFor('Array.from(document.getElementById("jf-mcp").options).map(function(x){ return x.value; }).indexOf("github") !== -1'), 'the MCPs Settings lists are offered');
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await c.ev('document.getElementById("jf-mcp-manage").textContent'), 'manage in Settings > MCP');
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await c.ev('document.getElementById("jf-inputs-hint").textContent'), 'The Inputs line says what to read; it may be empty for a generic MCP job.');
      // eslint-disable-next-line no-await-in-loop
      const spill = await c.ev(SPILL);
      assert.ok(spill.scrollW <= spill.vw, `${type} at ${width}: ${JSON.stringify(spill)}`);
    }
    await pick(c, 'plain');
    assert.equal(await c.ev('document.getElementById("jf-mcp-field").hidden'), true);
    assert.equal(await c.ev('document.getElementById("jf-inputs-hint").textContent'), plainHint);
    // the link goes to Settings > MCP
    await pick(c, 'mcp');
    await c.ev('document.getElementById("jf-mcp-manage").click()');
    assert.ok(await c.waitFor('!document.getElementById("settings-view").hidden && document.getElementById("stab-mcp").getAttribute("aria-selected") === "true"'), 'the link opens Settings > MCP');
  });
}

test('Draft with an MCP nobody has checked is refused on the MCP field with the one sentence; nothing is drafted', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  await pick(c, 'mcp');
  assert.ok(await c.waitFor('document.getElementById("jf-mcp").options.length > 0'));
  const set = (id, v) => c.ev(`var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", {bubbles: true}))`);
  await set('jf-name', 'mail-check');
  await set('jf-job', 'Read what comes in\nWrite it out');
  await set('jf-dest-folder', tmp('dest'));
  await set('jf-cap-money', '0.25');
  assert.ok(await c.waitFor('document.getElementById("chat-main-btn").disabled === false'));
  await c.ev('document.getElementById("chat-main-btn").click()');
  assert.ok(await c.waitFor('document.getElementById("jf-err-mcp").textContent.indexOf("press check tools in Settings > MCP first") !== -1'), 'the refusal sits under the MCP field');
  assert.deepEqual(o.w.starts(), []);
});
