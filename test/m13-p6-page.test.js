// M13 piece 6 (item 8, mock Part 3 variant B), the REAL Result tab of a PLAIN job (a passed run, real runner, fake provider, $0) in a real headless browser:
// the tab is there for a job that is no M10 job, the row is named run-<n>, the cells and money are the books', a row opens to its lines and a link to its run,
// the page is no wider than the screen at 1280, 390 and 320, and every element id on the page is unique.
// Must fail when: the tab is hidden for a plain job; the row is not named run-<n>; the stats money is not the run's total; a row does not open; the page spills sideways.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { moneyWords } from '../src/panel/jobgrid.js';
import { buildWorld } from './m4d-am29-world.mjs';

const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));

async function open(width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld();
  delete process.env.FWDLOOP_CONFIG_HOME;
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} }, scheduler: { intervalMs: 0 } });
  CLOSERS.push(async () => h.close());
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened the newest run');
  assert.ok(await chrome.waitFor('!document.getElementById("tab-result").hidden'), 'the Result tab shows for a plain job');
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-grid]")', 20000), 'the grid drew');
  return { chrome, w };
}
const MEASURE = `(function(){
  var vw = document.documentElement.clientWidth, over = [];
  document.querySelectorAll("#result-body *").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width === 0 && r.height === 0) return; var w = e.closest(".grid-wrap"); if(w && w !== e) return; if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right)); });
  var gw = document.querySelector("#result-body .grid-wrap");
  return { vw: vw, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 5), gridBox: gw.clientWidth, gridInner: gw.scrollWidth };
})()`;

test('a plain job: run-<n> row in Passed, cells and money from the books, the row opens to its lines and a link to its run', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  const hist = readFileSync(path.join(o.w.root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const spent = moneyWords(hist.reduce((a, r) => a + r.spentUsd, 0), hist.every((r) => r.spendComplete !== false));
  assert.equal(await c.ev('document.querySelector("[data-testid=grid-stats]").textContent'), `0 needs you · 0 stopped · 1 passed · 0 skipped · spent ${spent}`);
  assert.equal(await c.ev('document.querySelector("[data-testid=grid-fold-done]").getAttribute("aria-expanded")'), 'false', 'Passed starts folded');
  assert.equal(await c.ev('document.querySelector("[data-testid=result-grid] h4").textContent'), 'job2', 'a plain job wears its own name, not the ticket word');
  await c.ev('document.querySelector("[data-testid=grid-fold-done]").click()');
  assert.equal(await c.ev('document.querySelector("[data-testid=grid-name]").textContent'), 'run-1');
  const cells = await c.ev('Array.from(document.querySelector("[data-testid=grid-row]").querySelectorAll("td.c")).map(function(td){ return td.textContent; })');
  assert.deepEqual(cells.slice(0, 2), ['✓', '✓']);
  assert.equal(cells[2], `✓${spent}`);
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=grid-table] tr.step-sub").length'), 0, 'a row is closed until it is opened');
  await c.ev('document.querySelector("[data-testid=grid-open]").click()');
  const lines = await c.ev('Array.from(document.querySelectorAll("[data-testid=grid-table] tr.step-sub .sub-line")).map(function(d){ return d.textContent; })');
  assert.ok(lines.some((l) => /^step 1 .*: exists, done$/.test(l)), JSON.stringify(lines));
  assert.equal(lines.at(-1), 'run-1', 'the last line is the link to the run');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=grid-row]").length'), 1);
});

for (const width of [1280, 390, 320]) {
  test(`browser ${width}: a plain job's grid does not spill, and no element id repeats`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    await o.chrome.ev('document.querySelector("[data-testid=grid-fold-done]").click(); document.querySelector("[data-testid=grid-open]").click()');
    const m = await o.chrome.ev(MEASURE);
    console.log(`# plain grid ${width}: ${JSON.stringify(m)}`);
    if (OUT) await o.chrome.screenshot(path.join(OUT, `m13-p6-plain-${width}.png`));
    assert.ok(m.scrollW <= m.vw, JSON.stringify(m));
    assert.deepEqual(m.over, [], JSON.stringify(m));
    const dup = await o.chrome.ev('(function(){ var seen = {}, d = []; document.querySelectorAll("[id]").forEach(function(e){ if(seen[e.id]) d.push(e.id); seen[e.id] = 1; }); return d; })()');
    assert.deepEqual(dup, [], `repeated ids: ${dup}`);
  });
}
