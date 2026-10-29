// The Audit check grid (bareloop variant F, copied from bareloop@c79d396 and adapted): a model step draws as a grid (rows = its checks, columns = tries), an errors list
// under it and the rounds folded per try. The runs are the REAL ones (test/m4d-am29-world.mjs: real runner, real model step, fake provider); the "no verdict" and the
// "+M more lines" cases are made from a real run's own audit/diary rows edited to that shape (the one thing the product itself cannot be made to write on demand). $0.
// Must fail when: the default-open row is not the LAST failed try; a ? row is clickable; the 8-line cap or its button is gone; a not-run check reads as a verdict;
// the rounds fold builds before it is opened.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildWorld } from './m4d-am29-world.mjs';
import { DIARY_FILE } from '../src/diary.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';

const HANDLES = [];
const CLOSERS = [];
after(async () => { for (const h of HANDLES) await h.close(); for (const c of CLOSERS) await c(); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const STEP = 'resume-summary';
const G = `document.querySelector("[data-testid=audit-grid-${STEP}]")`;

const editLines = (file, edit) => writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.stringify(edit(JSON.parse(l)))).join('\n') + '\n');

async function open(width, opts, shape) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld(opts);
  if (shape) shape(w);
  const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} } }));
  HANDLES.push(h);
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened the newest run');
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor(`${G}`, 20000));
  return chrome;
}
const rowsOpen = (chrome) => chrome.ev(`Array.from(${G}.querySelectorAll("button.fx-rowhead")).map(function(b){ return b.getAttribute("data-fxrow") + ":" + b.getAttribute("aria-expanded"); })`);

for (const width of [1280, 320]) {
  test(`grid ${width}px: only the LAST failed try is open on load, rows open on their own, a ✗ cell opens its try, the grid stays in its box`, { skip: SKIP && 'no browser' }, async (t) => {
    // redoFails: the redone step fails again on every try, so the step has two red tries (1 and 4) with green ones between
    const chrome = await open(width, { redo: true, redoFails: true });
    if (!chrome) { t.skip('no chromium installed'); return; }
    const reds = await chrome.ev(`Array.from(${G}.querySelectorAll("button.cell.fail")).map(function(b){ return b.getAttribute("data-fx").split(":")[0]; }).filter(function(x, i, a){ return a.indexOf(x) === i; })`);
    assert.ok(reds.length >= 2, `two red tries to tell apart: ${reds}`);
    const open0 = await rowsOpen(chrome);
    assert.deepEqual(open0.filter((x) => x.endsWith(':true')), [`${reds.at(-1)}:true`], `only the last red try is open: ${open0}`);
    // a ✗ cell of the first red try opens that try's row, the other stays as it was
    await chrome.ev(`${G}.querySelector("button.cell.fail[data-fx^='${reds[0]}:']").click()`);
    assert.equal((await rowsOpen(chrome)).filter((x) => x.endsWith(':true')).length, 2, 'rows open independently');
    assert.equal(await chrome.ev(`${G}.querySelectorAll("button.cell.fail[aria-expanded=true]").length > 0`), true, 'its cells wear the open state');
    // the grid sits inside the page
    const r = await chrome.ev(`(function(){ var vw = document.documentElement.clientWidth, w = ${G}.querySelector(".grid-wrap").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - vw, right: w.right, vw: vw }; })()`);
    assert.ok(r.spill <= 0 && r.right <= r.vw + 0.5, JSON.stringify(r));
  });

  test(`no verdict ${width}px: a red try with no check record reads ? in every cell, its row is faint and cannot be clicked`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await open(width, { redo: true }, (w) => {
      // try 1 of the summary step loses its check record (as a run from before the records, or a try no check ran in)
      const rows = readFileSync(path.join(w.runDir, DIARY_FILE), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)).filter((r) => !(r.kind === 'checks' && r.step === STEP && r.try === 1));
      writeFileSync(path.join(w.runDir, DIARY_FILE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    });
    if (!chrome) { t.skip('no chromium installed'); return; }
    assert.equal(await chrome.ev(`${G}.querySelectorAll("button.fx-rowhead").length`), 0, 'no clickable row: the only red try has no verdict');
    assert.equal(await chrome.ev(`${G}.querySelectorAll("button.cell.fail").length`), 0);
    assert.match(await chrome.ev(`${G}.querySelector(".fx-row-q").innerText`), /^try 1\s+\?\s+705 words, limit 600/);
    assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("td.c")).filter(function(c, i) { return i % 3 === 0; }).map(function(c){ return c.textContent + "|" + c.querySelector(".cell").title; })`), Array(5).fill('?|try 1: no verdict'));
    assert.match(await chrome.ev(`${G}.querySelector("thead th.t").textContent`), /^try 1 \?/);
  });
}

test('errors: the first 8 lines, "+M more lines" shows the rest, "show first 8 only" folds back', { skip: SKIP && 'no browser' }, async (t) => {
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1} of the text`);
  const chrome = await open(1280, { redo: true }, (w) => {
    editLines(path.join(w.runDir, 'audit.jsonl'), (r) => (r.step === STEP && r.attempt === 1 ? { ...r, gap: lines.join('\n') } : r));
  });
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.match(await chrome.ev(`${G}.querySelector("button.fx-rowhead").innerText`), /try 1\s+#4 ✗ \+1 more check\s+line 1 of the text\s+\(\+11 more\)/);
  const shown = () => chrome.ev(`${G}.querySelectorAll(".fx-body .fx-lines div").length`);
  assert.equal(await shown(), 8);
  assert.equal(await chrome.ev(`${G}.querySelector(".fx-more").textContent`), '+4 more lines');
  await chrome.ev(`${G}.querySelector(".fx-more").click()`);
  assert.equal(await shown(), 12);
  assert.equal(await chrome.ev(`${G}.querySelector(".fx-more").textContent`), 'show first 8 only');
  await chrome.ev(`${G}.querySelector(".fx-more").click()`);
  assert.equal(await shown(), 8);
});

test('a check the done check halted before reads "not run" (·), a pass reads ✓ with its number on hover', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await open(1280, { redo: true }, (w) => {
    // try 1: only #1 and #2 ran, #2 failed (the model said done: false) - the close's checks never ran
    const rows = readFileSync(path.join(w.runDir, DIARY_FILE), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)).map((r) => (r.kind === 'checks' && r.step === STEP && r.try === 1
      ? { ...r, checks: [r.checks[0], { ...r.checks[1], ok: false, result: 'it said done: false' }] } : r));
    writeFileSync(path.join(w.runDir, DIARY_FILE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("tbody tr")).map(function(tr){ return tr.querySelectorAll("td.c")[0].textContent; })`), ['✓', '✗', '·', '·', '·']);
  assert.equal(await chrome.ev(`${G}.querySelectorAll("td.c")[0].querySelector(".cell").title.indexOf("passed: ") === 0`), true);
  assert.equal(await chrome.ev(`${G}.querySelectorAll("tbody tr")[2].querySelector("td.c .cell").title`), 'not run (first-red-wins stopped the close)');
});
