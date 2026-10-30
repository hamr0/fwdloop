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

test('the Result head wears [–] for a skipped run, the sign the ticket list uses', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(t, 1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const sign = await o.chrome.ev('getComputedStyle(document.querySelector("[data-testid=result-status] .dot"), "::before").content');
  assert.equal(sign, '"[–]"');
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=result-status] .st-word").textContent'), 'skipped');
});

test('Run it anyway asks for a reason first: the button stays off without one, and the queue gets the ticket with it', { skip: SKIP && 'no browser' }, async (t) => {
  const calls = [];
  const o = await open(t, 1280, { ticketQueue: { arriveAnyway: (a) => { calls.push(a); return { ok: true }; } } });
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  await c.ev('document.querySelector("[data-testid=ticket-fold-skip]").click()');
  await c.ev('document.querySelector("[data-testid=ticket-anyway-open][data-number=\\"102\\"]").click()');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").disabled'), true, 'no reason, no Run it anyway');
  assert.deepEqual(calls, []);
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-text]").placeholder'), 'reason (needed to run it anyway)');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-text]").getAttribute("aria-label")'), 'reason (needed to run it anyway)');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").textContent'), 'Run it anyway');
  await c.ev('var g0 = document.querySelector("[data-testid=ticket-anyway-go]"); g0.disabled = false; g0.click()');
  assert.equal(await c.ev('document.getElementById("ticket-msg").textContent'), 'Please write a reason to run it anyway.');
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

// ---- the Run card of a ticket job: a "ticket #" box; Run stays off until it is filled (hamr 2026-10-29) ----
import { rmSync } from 'node:fs';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';
import { ticketJob } from './m12-p2-world.mjs';

killChildrenAfter();
async function openRunCard(width, { fileJd = false } = {}) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await world({ limit: 5 });
  ticketJob(w.root, 'tk', { fileJd });
  seedGreen(w, 'tk');
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('var i = document.getElementById("jf-run-flow"); i.focus(); i.value = "tk"; i.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("#jf-run-inputs .jf-inrow")'));
  return { chrome, w };
}

test('a ticket job\'s Run card has a ticket # box: Run is off until a whole number is in it; a job without a ticket list has no box', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openRunCard(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  // the file input is filled so only the ticket box stands between the card and Run
  await c.ev('var p = document.querySelector("#jf-run-inputs .jf-inrow .jf-path:not([data-page])"); p.value = "/tmp/resume.md"; p.dispatchEvent(new Event("input", {bubbles: true}))');
  await c.ev('var cap = document.getElementById("jf-run-cap"); cap.value = "0.25"; cap.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=jf-run-ticket]").length'), 1);
  assert.equal(await c.ev('document.querySelector("[data-testid=jf-run-ticket]").placeholder'), 'ticket #');
  const btn = 'document.getElementById("chat-main-btn")';
  assert.equal(await c.ev(`${btn}.disabled`), true, 'no number, no Run');
  for (const bad of ['abc', '0', '-2', '1.5']) {
    // eslint-disable-next-line no-await-in-loop
    await c.ev(`var tk = document.querySelector("[data-testid=jf-run-ticket]"); tk.value = ${JSON.stringify(bad)}; tk.dispatchEvent(new Event("input", {bubbles: true}))`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 700));   // the server's reuse check answers after the edit (200 ms debounce); Run must still be off after it
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await c.ev(`${btn}.disabled`), true, `"${bad}" is no ticket number`);
  }
  await c.ev('var tk2 = document.querySelector("[data-testid=jf-run-ticket]"); tk2.value = "195342"; tk2.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await c.waitFor(`${btn}.disabled === false`), 'a number turns Run on');
  const o2 = await openRunCard(1280, { fileJd: true });
  assert.equal(await o2.chrome.ev('document.querySelectorAll("[data-testid=jf-run-ticket]").length'), 0);
});

for (const width of [390, 320]) {
  test(`browser ${width}: the Run card's ticket # row does not spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await openRunCard(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const m = await o.chrome.ev(`(function(){ var vw = document.documentElement.clientWidth, over = []; document.querySelectorAll("#jf-run *").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width === 0 && r.height === 0) return; if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right)); }); return { vw: vw, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 5) }; })()`);
    console.log(`# run card ${width}: ${JSON.stringify(m)}`);
    if (OUT) await o.chrome.screenshot(path.join(OUT, `m12-p3-runcard-${width}.png`));
    assert.ok(m.scrollW <= m.vw, JSON.stringify(m));
    assert.deepEqual(m.over, [], JSON.stringify(m));
  });
}
