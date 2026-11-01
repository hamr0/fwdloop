// M13 piece 6 follow-up (hamr 2026-11-01): a ticket row wears `#<n> · <title>` (the title the run froze, `run.json` inputs[].ticket.title, outside text: escaped, cut with an
// ellipsis, never wider than the screen), and clicking the name opens that run; the fold arrow stays a separate control. Server side first, then the REAL Result tab.
// Must fail when: the title is dropped or not read from a string only; a missing title shows "null"/"undefined"; a <b> title is drawn as markup; the name does not open the
// run; the name also folds the row (or the arrow stops folding); a 200-char title spills the page sideways at 1280, 390 or 320; an element id repeats.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { buildJobGrid } from '../src/panel/jobgrid.js';
import { skippedWorld } from './m12-p3-world.mjs';
import { buildWorld } from './m4d-am29-world.mjs';

const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const run = (runId, extra = {}) => ({
  runId, glyph: '[–]', ticket: 7, at: 1000, history: { spentUsd: 0, spendComplete: true, wallMs: 3 }, spendRows: [], diary: [], steps: [], reason: 'closed', ...extra,
});
const rowsOf = (g) => g.groups.flatMap((x) => x.rows);

test('the grid row carries the ticket title only when it is a string; a missing, null or odd title is null (never the word null)', () => {
  const g = buildJobGrid({ runs: [run('run-1', { title: 'Fix the door' }), run('run-2', { title: null }), run('run-3', { title: 42 }), run('run-4', {}), run('run-5', { ticket: null, title: 'x' })] });
  const by = Object.fromEntries(rowsOf(g).map((r) => [r.runId, r]));
  assert.equal(by['run-1'].title, 'Fix the door');
  assert.equal(by['run-1'].name, '#7');
  assert.equal(by['run-2'].title, null);
  assert.equal(by['run-3'].title, null);
  assert.equal(by['run-4'].title, null);
  assert.equal(by['run-5'].title, null, 'a run with no ticket has no title');
});

/** Rewrite one run's saved ticket title in its run.json (the field the runner froze). */
function setTitle(root, runId, title) {
  const f = path.join(root, 'tick', 'runs', runId, 'run.json');
  const rec = JSON.parse(readFileSync(f, 'utf8'));
  for (const e of rec.inputs) if (e.ticket) { if (title === undefined) delete e.ticket.title; else e.ticket.title = title; }
  writeFileSync(f, JSON.stringify(rec));
}

test('through the real panel: the saved title rides the row; a missing title is null', async (t) => {
  const w = await skippedWorld(t);
  setTitle(w.root, 'run-2', undefined);
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: path.join(w.home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 } });
  CLOSERS.push(async () => h.close());
  const g = await (await fetch(`http://127.0.0.1:${h.port}/api/runs/tick/run-1/grid`)).json();
  assert.deepEqual(rowsOf(g).map((r) => [r.name, r.title]).sort(), [['#102', 'Docs typo'], ['#103', null]]);
});

async function openSkipped(t, width, titles = {}) {
  const w = await skippedWorld(t);
  for (const [id, title] of Object.entries(titles)) setTitle(w.root, id, title);
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: path.join(w.home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 } });
  CLOSERS.push(async () => h.close());
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened a run');
  assert.ok(await chrome.waitFor('!document.getElementById("tab-result").hidden'), 'the Result tab shows');
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-grid]")', 20000), 'the grid drew');
  await chrome.ev('document.querySelector("[data-testid=grid-fold-skip]").click()');
  return { chrome, w };
}
const NAMES = 'Array.from(document.querySelectorAll("[data-testid=grid-row]")).map(function(r){ return r.querySelector("[data-testid=grid-name]").textContent; }).sort()';

test('browser: the row reads "#<n> · <title>"; a missing title reads "#<n>" alone', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openSkipped(t, 1280, { 'run-2': undefined });
  if (!o) { t.skip('no chromium installed'); return; }
  const names = await o.chrome.ev(NAMES);
  assert.ok(names.includes('#102 · Docs typo'), JSON.stringify(names));
  assert.ok(names.includes('#103'), JSON.stringify(names));
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=grid-row] [data-testid=grid-name]").getAttribute("title") !== null'), true, 'the full title is in a tooltip');
});

test('browser: a title is outside text: a <b> title renders as text, not markup', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openSkipped(t, 1280, { 'run-1': '<b>bold</b> <img src=x onerror="window.__hit=1">' });
  if (!o) { t.skip('no chromium installed'); return; }
  const names = await o.chrome.ev(NAMES);
  assert.ok(names.includes('#102 · <b>bold</b> <img src=x onerror="window.__hit=1">'), JSON.stringify(names));
  assert.equal(await o.chrome.ev('document.querySelectorAll("[data-testid=grid-table] b, [data-testid=grid-table] img").length'), 0);
  assert.equal(await o.chrome.ev('window.__hit === undefined'), true);
});

test('browser: clicking the name opens that run (the active run changes); a skipped row does it too, and does not fold anything', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openSkipped(t, 1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  const active = await c.ev('document.getElementById("active-wf-name").textContent');
  const other = active.indexOf('run-1') !== -1 ? 'run-2' : 'run-1';
  await c.ev(`document.querySelector("[data-testid=grid-row][data-run=${other}] [data-testid=grid-name]").click()`);
  assert.ok(await c.waitFor(`document.getElementById("active-wf-name").textContent.indexOf("${other}") !== -1`), `${other} became the active run`);
  assert.equal(await c.ev('document.getElementById("tab-run").getAttribute("aria-selected")'), 'true', 'the Run tab shows it');
});

test('browser: on a plain job the run-<n> name opens its run and does not fold; the arrow folds and unfolds on its own', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld();
  delete process.env.FWDLOOP_CONFIG_HOME;
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} }, scheduler: { intervalMs: 0 } });
  CLOSERS.push(async () => h.close());
  await chrome.open(`http://127.0.0.1:${h.port}/`, 1280);
  assert.ok(await chrome.waitFor('!document.getElementById("tab-result").hidden', 20000));
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-grid]")', 20000));
  await chrome.ev('document.querySelector("[data-testid=grid-fold-done]").click()');
  const steps = 'document.querySelectorAll("[data-testid=grid-table] tr.step-sub").length';
  assert.equal(await chrome.ev('document.querySelector("[data-testid=grid-name]").textContent'), 'run-1');
  await chrome.ev('document.querySelector("[data-testid=grid-name]").click()');
  assert.equal(await chrome.ev(steps), 0, 'the name does not fold the row');
  assert.ok(await chrome.waitFor('document.getElementById("tab-run").getAttribute("aria-selected") === "true"'), 'the name went to the run');
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=grid-open]")'));
  await chrome.ev('document.querySelector("[data-testid=grid-open]").click()');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=grid-open]").getAttribute("aria-expanded")'), 'true');
  assert.ok(await chrome.ev(steps) > 0, 'the arrow folds the step marks open');
  await chrome.ev('document.querySelector("[data-testid=grid-open]").click()');
  assert.equal(await chrome.ev(steps), 0, 'and closed again');
});

for (const width of [1280, 390, 320]) {
  test(`browser ${width}: a 200-char title is cut on one line and the page does not spill; no element id repeats`, { skip: SKIP && 'no browser' }, async (t) => {
    const long = `${'Very long ticket title '.repeat(9)}`.slice(0, 200);
    const o = await openSkipped(t, width, { 'run-1': long, 'run-2': long.replace(/ /g, 'W') });
    if (!o) { t.skip('no chromium installed'); return; }
    const m = await o.chrome.ev(`(function(){
      var vw = document.documentElement.clientWidth, over = [];
      document.querySelectorAll("#result-body *").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width === 0 && r.height === 0) return; var w = e.closest(".grid-wrap"); if(w && w !== e) return; if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right)); });
      var n = document.querySelector("[data-testid=grid-name]"), cell = n.closest("td"), gw = document.querySelector("#result-body .grid-wrap");
      return { vw: vw, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 5), nameW: Math.round(n.getBoundingClientRect().width), cellW: Math.round(cell.getBoundingClientRect().width),
        cut: n.scrollWidth > n.clientWidth, oneLine: n.getBoundingClientRect().height < 40, ell: getComputedStyle(n).textOverflow, gridBox: gw.clientWidth, gridInner: gw.scrollWidth };
    })()`);
    console.log(`# title ${width}: ${JSON.stringify(m)}`);
    assert.ok(m.scrollW <= m.vw, JSON.stringify(m));
    assert.deepEqual(m.over, [], JSON.stringify(m));
    assert.equal(m.cut, true, 'the long title is cut, not wrapped');
    assert.equal(m.oneLine, true, JSON.stringify(m));
    assert.equal(m.ell, 'ellipsis');
    assert.ok(m.cellW <= 300, `the name cell is capped: ${JSON.stringify(m)}`);
    const dup = await o.chrome.ev('(function(){ var seen = {}, d = []; document.querySelectorAll("[id]").forEach(function(e){ if(seen[e.id]) d.push(e.id); seen[e.id] = 1; }); return d; })()');
    assert.deepEqual(dup, [], `repeated ids: ${dup}`);
  });
}
