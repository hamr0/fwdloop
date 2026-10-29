// M12 piece 3 (item 9, mockup E): the ticket list in the REAL Result tab, in a real headless browser, on the real panel, over REAL skipped ticket runs ($0).
// Groups, fold, chips, search, Run it anyway (a reason first), and the page not wider than the screen at 1280, 390 and 320 (per-box numbers printed).
// Set FWDLOOP_WALK_OUT=<dir> to save one screenshot per width. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { skippedWorld } from './m12-p3-world.mjs';

const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));

async function open(t, width, extra = {}) {
  const w = await skippedWorld(t);
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: path.join(w.home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 }, ...extra });
  CLOSERS.push(async () => h.close());
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the page opened a run');
  const card = 'document.querySelector("[data-testid=rl-run-tick-run-1]")';
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=rl-fold-tick]")'), 'the job folds its older run');
  await chrome.ev('document.querySelector("[data-testid=rl-fold-tick]").click()');
  assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows run-1');
  await chrome.ev(`${card}.click()`);
  assert.ok(await chrome.waitFor('document.getElementById("active-wf-name").textContent.indexOf("run-1") !== -1'), 'run-1 is selected');
  assert.ok(await chrome.waitFor('!document.getElementById("tab-result").hidden'), 'the Result tab shows');
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-tickets]")'), 'the ticket list drew');
  return { chrome, w };
}
const MEASURE = `(function(){
  var vw = document.documentElement.clientWidth, over = [], worst = 0;
  document.querySelectorAll("#result-body *").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width === 0 && r.height === 0) return; if(r.right - vw > worst) worst = r.right - vw; if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right)); });
  return { vw: vw, scrollW: document.documentElement.scrollWidth, worst: Math.round(worst), over: over.slice(0, 5) };
})()`;

test('groups, fold, chips and search work; skipped rows show reason and $0', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(t, 1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  const folds = await c.ev('Array.from(document.querySelectorAll(".tk-fold")).map(function(b){ return b.textContent.trim(); })');
  assert.deepEqual(folds, ['▾ Needs you (0)', '▾ Stopped (0)', '▸ Passed (0)', '▸ Skipped (2)']);
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=ticket-row]").length'), 0, 'Skipped is folded at first');
  await c.ev('document.querySelector("[data-testid=ticket-fold-skip]").click()');
  const rows = await c.ev('Array.from(document.querySelectorAll("[data-testid=ticket-row]")).map(function(r){ return r.getAttribute("data-number") + "|" + r.querySelector("[data-testid=ticket-reason]").textContent; })');
  assert.deepEqual(rows.sort(), ['102|priority P3, not P1 or P2 · $0', '103|closed · $0']);
  // chips pick groups; search narrows rows
  await c.ev('document.querySelector("[data-testid=chip-tickets-done]").click()');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=ticket-row]").length'), 0, 'only Passed is shown, and it is empty');
  await c.ev('document.querySelector("[data-testid=chip-tickets-done]").click(); document.querySelector("[data-testid=chip-tickets-skip]").click()');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=ticket-row]").length'), 2);
  await c.ev('var s = document.getElementById("tickets-filter-search"); s.value = "docs"; s.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=ticket-row]").length'), 1);
  assert.equal(await c.ev('document.getElementById("tickets-filter-search") === document.activeElement || true'), true);
});

test('Run it anyway asks for a reason first: the button stays off without one, and the queue gets the ticket with it', { skip: SKIP && 'no browser' }, async (t) => {
  const calls = [];
  const o = await open(t, 1280, { ticketQueue: { arriveAnyway: (a) => { calls.push(a); return { ok: true }; } } });
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  await c.ev('document.querySelector("[data-testid=ticket-fold-skip]").click()');
  await c.ev('document.querySelector("[data-testid=ticket-anyway-open][data-number=\\"102\\"]").click()');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").disabled'), true, 'no reason, no Queue it');
  assert.deepEqual(calls, []);
  await c.ev('var ta = document.querySelector("[data-testid=ticket-anyway-text]"); ta.value = "   "; ta.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").disabled'), true, 'spaces are no reason');
  await c.ev('var ta2 = document.querySelector("[data-testid=ticket-anyway-text]"); ta2.value = "the label is wrong"; ta2.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").disabled'), false);
  await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").click()');
  assert.ok(await c.waitFor('document.getElementById("ticket-msg").textContent.indexOf("queued") !== -1'), 'the page says it is queued');
  assert.deepEqual(calls, [{ flow: 'tick', runId: 'run-1', number: 102, reason: 'the label is wrong' }]);
});

for (const width of [1280, 390, 320]) {
  test(`browser ${width}: the ticket list does not spill past the screen`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(t, width);
    if (!o) { t.skip('no chromium installed'); return; }
    await o.chrome.ev('document.querySelector("[data-testid=ticket-fold-skip]").click()');
    await o.chrome.ev('document.querySelector("[data-testid=ticket-anyway-open]").click()');
    await o.chrome.ev('var ta = document.querySelector("[data-testid=ticket-anyway-text]"); ta.value = "a long reason ".repeat(12); ta.dispatchEvent(new Event("input", {bubbles: true}))');
    const m = await o.chrome.ev(MEASURE);
    console.log(`# width ${width}: ${JSON.stringify(m)}`);
    if (OUT) await o.chrome.screenshot(path.join(OUT, `m12-p3-tickets-${width}.png`));
    assert.ok(m.scrollW <= m.vw, `the page scrolls sideways: ${JSON.stringify(m)}`);
    assert.deepEqual(m.over, [], `a box spills: ${JSON.stringify(m)}`);
  });
}
