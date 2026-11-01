// M12 piece 3 (item 9) as M13 piece 6 (item 8, mock Part 3 variant B) draws it: the ticket runs in the job's ONE Result grid, in the REAL Result tab, in a real headless browser, on the real panel, over REAL skipped ticket runs ($0).
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
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-grid]")'), 'the grid drew');
  return { chrome, w };
}
const MEASURE = `(function(){
  var vw = document.documentElement.clientWidth, over = [], worst = 0;
  document.querySelectorAll("#result-body *").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width === 0 && r.height === 0) return; var w = e.closest(".grid-wrap"); if(w && w !== e) return; if(r.right - vw > worst) worst = r.right - vw; if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right)); });
  var gw = document.querySelector("#result-body .grid-wrap");
  return { vw: vw, scrollW: document.documentElement.scrollWidth, worst: Math.round(worst), over: over.slice(0, 5), gridBox: gw ? gw.clientWidth : null, gridInner: gw ? gw.scrollWidth : null };
})()`;

test('the four buckets are fold rows of one grid, Skipped folded at first; skipped rows are named #<n> with reason and $0; the stats line counts them', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(t, 1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  const folds = await c.ev('Array.from(document.querySelectorAll(".jg-fold")).map(function(b){ return b.textContent.trim(); })');
  assert.deepEqual(folds, ['▾ Needs you (0)', '▾ Stopped (0)', '▸ Passed (0)', '▸ Skipped (2)']);
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=grid-row]").length'), 0, 'Skipped is folded at first');
  assert.equal(await c.ev('document.querySelector("[data-testid=grid-stats]").textContent'), '0 needs you · 0 stopped · 0 passed · 2 skipped · spent $0');
  await c.ev('document.querySelector("[data-testid=grid-fold-skip]").click()');
  const rows = await c.ev('Array.from(document.querySelectorAll("[data-testid=grid-row]")).map(function(r){ return r.querySelector("[data-testid=grid-name]").textContent + "|" + r.nextElementSibling.querySelector("[data-testid=ticket-reason]").textContent; })');
  assert.deepEqual(rows.sort(), ['#102 · Docs typo|priority P3, not P1 or P2 · $0', '#103 · Old one|closed · $0']);
  const heads = await c.ev('Array.from(document.querySelectorAll("[data-testid=grid-table] thead th")).map(function(h){ return h.textContent; })');
  assert.deepEqual(heads, ['run', 'every stepexists, done', 'output judged', 'cost', 'time']);
  await c.ev('document.querySelector("[data-testid=grid-fold-skip]").click()');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=grid-row]").length'), 0, 'a fold row folds again');
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
  await c.ev('document.querySelector("[data-testid=grid-fold-skip]").click()');
  await c.ev('document.querySelector("[data-testid=ticket-anyway-open][data-number=\\"102\\"]").click()');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").disabled'), true, 'no reason, no Run it anyway');
  assert.deepEqual(calls, []);
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-text]").placeholder'), 'reason (needed to run it anyway)');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-text]").getAttribute("aria-label")'), 'reason (needed to run it anyway)');
  assert.equal(await c.ev('document.querySelector("[data-testid=ticket-anyway-go]").textContent'), 'Run it anyway');
  await c.ev('window.__posts = 0; var of = window.fetch; window.fetch = function(u){ if(String(u).indexOf("ticket-anyway") !== -1) window.__posts += 1; return of.apply(this, arguments); }');
  await c.ev('var g0 = document.querySelector("[data-testid=ticket-anyway-go]"); g0.disabled = false; g0.click()');
  assert.equal(await c.ev('window.__posts'), 0, 'the page itself sends nothing without a reason');
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
  test(`browser ${width}: the Result grid does not spill past the screen`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(t, width);
    if (!o) { t.skip('no chromium installed'); return; }
    await o.chrome.ev('document.querySelector("[data-testid=grid-fold-skip]").click()');
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
async function openRunCard(width, { fileJd = false, flowType = 'tickets' } = {}) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await world({ limit: 5 });
  ticketJob(w.root, 'tk', { fileJd, flowType });
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

test('M13 p4 (R2): a Tickets job\'s Run card has NO ticket # box; with the file input filled, Run is on', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openRunCard(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  await c.ev('var p = document.querySelector("#jf-run-inputs .jf-inrow .jf-path:not([data-page])"); p.value = "/tmp/resume.md"; p.dispatchEvent(new Event("input", {bubbles: true}))');
  await c.ev('var cap = document.getElementById("jf-run-cap"); cap.value = "0.25"; cap.dispatchEvent(new Event("input", {bubbles: true}))');
  assert.equal(await c.ev('document.querySelectorAll("[data-testid=jf-run-ticket], .jf-ticket").length'), 0);
  assert.ok(await c.waitFor('document.getElementById("chat-main-btn").disabled === false'), 'no number is asked for: Run is on');
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

// ---- M13 piece 4 (signed item 5/6): the Run card's schedule options follow the flow type ----
const WHEN_OPTIONS = 'Array.from(document.getElementById("jf-when").options).filter(function(o){ return !o.hidden && !o.disabled; }).map(function(o){ return o.value; })';

test('M13 p4: schedule options by flow type: MCP offers By hand and Every day only; Tickets adds a new ticket arrives; plain offers no ticket option', { skip: SKIP && 'no browser' }, async (t) => {
  const g = await openRunCard(1280, { flowType: 'mcp' });
  if (!g) { t.skip('no chromium installed'); return; }
  assert.deepEqual(await g.chrome.ev(WHEN_OPTIONS), ['hand', 'daily']);
  const k = await openRunCard(1280);
  const tickets = await k.chrome.ev(WHEN_OPTIONS);
  assert.ok(tickets.includes('new-ticket') && tickets.includes('hand') && tickets.includes('daily'), JSON.stringify(tickets));
  const p = await openRunCard(1280, { fileJd: true });
  const plain = await p.chrome.ev(WHEN_OPTIONS);
  assert.equal(plain.includes('new-ticket'), false, JSON.stringify(plain));
  assert.ok(plain.includes('daily'));
});
