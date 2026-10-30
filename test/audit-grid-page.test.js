// The Audit check grid (bareloop variant F, copied from bareloop@c79d396 and adapted): a model step draws as a grid (rows = its checks, columns = tries), an errors list
// under it and the rounds folded per try. The runs are the REAL ones (test/m4d-am29-world.mjs: real runner, real model step, fake provider); the "no verdict" and the
// "+M more lines" cases are made from a real run's own audit/diary rows edited to that shape (the one thing the product itself cannot be made to write on demand). $0.
// M4d am36: the hints row, the folded every-step row, one line per red try, output judged once (see the tests at the end).
// Must fail when: the default-open row is not the LAST failed try; a ? row is clickable; the 8-line cap or its button is gone; a not-run check reads as a verdict;
// the rounds fold builds before it is opened.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { readAudit } from '../src/books.js';
import { buildWorld } from './m4d-am29-world.mjs';
import { DIARY_FILE } from '../src/diary.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';

const HANDLES = [];
const CLOSERS = [];
after(async () => { for (const h of HANDLES) await h.close(); for (const c of CLOSERS) await c(); delete process.env.FWDLOOP_CONFIG_HOME; });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const STEP = 'resume-summary';
const G = `document.querySelector("[data-testid=audit-grid-${STEP}]")`;

const editLines = (file, edit) => writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.stringify(edit(JSON.parse(l)))).join('\n') + '\n');

async function open(width, opts, shape) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld(opts);
  delete process.env.FWDLOOP_CONFIG_HOME; // the hints tests set it for the build only; the next test starts without
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
    assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("td.c")).filter(function(c, i) { return i % 3 === 0; }).map(function(c){ return c.textContent + "|" + c.querySelector(".cell").title; })`), Array(4).fill('?|try 1: no verdict'));
    assert.match(await chrome.ev(`${G}.querySelector("thead th.t").textContent`), /^try 1 \?/);
  });
}

test('errors: the first 8 lines, "+M more lines" shows the rest, "show first 8 only" folds back', { skip: SKIP && 'no browser' }, async (t) => {
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1} of the text`);
  const chrome = await open(1280, { redo: true }, (w) => {
    editLines(path.join(w.runDir, 'audit.jsonl'), (r) => (r.step === STEP && r.attempt === 1 ? { ...r, gap: lines.join('\n') } : r));
  });
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.match(await chrome.ev(`${G}.querySelector("button.fx-rowhead").innerText`), /^▾\s+try 1\s+✗\s+line 1 of the text\s+\(\+11 more\)$/);
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
  assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("tbody tr:not(.step-sub)")).map(function(tr){ return tr.querySelectorAll("td.c")[0].textContent; })`), ['✗', '·', '·', '·']);
  assert.equal(await chrome.ev(`${G}.querySelectorAll("td.c")[1].querySelector(".cell").title.indexOf("passed: ") === 0`), true, 'a pass of the try 2 column says its number');
  assert.equal(await chrome.ev(`${G}.querySelectorAll("tbody tr:not(.step-sub)")[1].querySelector("td.c .cell").title`), 'not run (first-red-wins stopped the close)');
});

// M4d am36 item 3: a scratch config home with learningHints ON and one real ledger row, so the retry tries are handed a block the product itself writes
function hintsHome() {
  const h = mkdtempSync(path.join(tmpdir(), 'fwdloop-am36-'));
  writeFileSync(path.join(h, 'config.json'), JSON.stringify({ learningHints: true }));
  const now = new Date();
  const L = countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now });
  writeLedger({ ...L, rows: L.rows.map((r) => ({ ...r, lastSeen: now.toISOString() })) }, h);
  return h;
}

for (const width of [1280, 320]) {
  test(`hints ${width}px: each handed try has its own N hints button, closed on load, a click opens that try's own text titled try N · told from earlier runs · N hints`, { skip: SKIP && 'no browser' }, async (t) => {
    process.env.FWDLOOP_CONFIG_HOME = hintsHome();
    let handed;
    const chrome = await open(width, { redo: true, redoFails: true }, (w) => {
      // each try's own text, as the audit row recorded it; try 4 gets a distinct text so "its own" can fail
      editLines(path.join(w.runDir, 'audit.jsonl'), (r) => (r.step === STEP && r.attempt === 4 ? { ...r, hintsText: 'try four was told something else\n   indented line' } : r));
      handed = readAudit(w.runDir).filter((x) => x.step === STEP && x.hints).map((x) => ({ n: x.attempt, count: x.hints, text: x.hintsText }));
    });
    if (!chrome) { t.skip('no chromium installed'); return; }
    assert.ok(handed.length >= 2, `hints on two tries or more: ${handed.map((h) => h.n)}`);
    const word = (h) => `${h.count} ${h.count === 1 ? 'hint' : 'hints'}`;
    // one button per handed try, in its own column; the others read a dash; no hints text is open on load
    assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("tr.hint-row td.c")).map(function(c){ var b = c.querySelector("button.btn.small"); return b ? b.getAttribute("data-hint") + ":" + b.textContent : c.textContent; })`),
      Array.from({ length: 5 }, (_, i) => { const h = handed.find((x) => x.n === i + 1); return h ? `${h.n}:${word(h)}` : '\u2014'; }));
    assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow").length`), 0, 'closed on load');
    assert.equal(await chrome.ev(`${G}.querySelectorAll("button[data-hint][aria-expanded=true]").length`), 0);
    for (const h of handed) {
      await chrome.ev(`${G}.querySelector("button[data-hint='${h.n}']").click()`);
      assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow").length`), 1);
      assert.equal(await chrome.ev(`${G}.querySelector(".fx-row.hintrow .fx-try").textContent`), `try ${h.n} \u00b7 told from earlier runs \u00b7 ${word(h)}`);
      const all = h.text.split('\n').map((l) => l.replace(/^\s+/, ''));
      assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll(".fx-row.hintrow .fx-lines div")).map(function(e){ return e.textContent; })`), all.slice(0, 8), `try ${h.n}: its own text`);
      await chrome.ev(`${G}.querySelector("button[data-hint='${h.n}']").click()`);
      assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow").length`), 0, 'a second click on the button closes it');
    }
    // the hints text sits in the errors area, above the red lines, and opening it does not change which red try is open
    await chrome.ev(`${G}.querySelector("button[data-hint='${handed[0].n}']").click()`);
    assert.match(await chrome.ev(`${G}.querySelector(".fx-errors").innerText`), /^ERRORS\s+▾\s+try \d \u00b7 told from earlier runs/);
    assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row:not(.hintrow).open").length`), 1);
    // the separate per-try hints box is gone
    assert.equal(await chrome.ev(`document.querySelectorAll("[data-testid^=audit-try-hints]").length`), 0);
  });
}

test('hints: more than 8 lines read 8, then "+M more lines" shows the rest', { skip: SKIP && 'no browser' }, async (t) => {
  process.env.FWDLOOP_CONFIG_HOME = hintsHome();
  const lines = Array.from({ length: 11 }, (_, i) => `hint line ${i + 1}`);
  const chrome = await open(1280, { redo: true }, (w) => {
    editLines(path.join(w.runDir, 'audit.jsonl'), (r) => (r.step === STEP && r.attempt === 2 ? { ...r, hintsText: lines.join('\n') } : r));
  });
  if (!chrome) { t.skip('no chromium installed'); return; }
  await chrome.ev(`${G}.querySelector("button[data-hint='2']").click()`);
  const shown = () => chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow .fx-lines div").length`);
  assert.equal(await shown(), 8);
  assert.equal(await chrome.ev(`${G}.querySelector(".fx-row.hintrow .fx-more").textContent`), '+3 more lines');
  await chrome.ev(`${G}.querySelector(".fx-row.hintrow .fx-more").click()`);
  assert.equal(await shown(), 11);
});

for (const failing of [2, 1]) {
  test(`every step: a failed check #${failing} turns the one folded row to ✗ for that try; a click on the row lists both checks`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await open(1280, { redo: true }, (w) => {
      const rows = readFileSync(path.join(w.runDir, DIARY_FILE), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)).map((r) => (r.kind === 'checks' && r.step === STEP && r.try === 1
        ? { ...r, checks: r.checks.map((c) => (c.n === failing ? { ...c, ok: false, result: 'it failed' } : c)) } : r));
      writeFileSync(path.join(w.runDir, DIARY_FILE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    });
    if (!chrome) { t.skip('no chromium installed'); return; }
    const first = `${G}.querySelector("tbody tr:not(.hint-row)")`;
    assert.equal(await chrome.ev(`${first}.querySelector("td.q").textContent.trim()`), 'every step: exists, done');
    assert.equal(await chrome.ev(`Array.from(${first}.querySelectorAll("td.c")).map(function(c){ return c.textContent; }).join("")`), '✗✓✓', 'one row, one glyph per try: ✗ for try 1 only');
    assert.equal(await chrome.ev(`${G}.querySelectorAll("tr:not(.hint-row) td.q").length`), 4, 'checks 1 and 2 are not two rows');
    assert.equal(await chrome.ev(`${G}.querySelector("tr.step-sub").hidden`), true, 'the two checks are folded');
    await chrome.ev(`${G}.querySelector("button[data-every]").click()`);
    assert.equal(await chrome.ev(`${G}.querySelector("tr.step-sub").hidden`), false);
    const subs = await chrome.ev(`Array.from(${G}.querySelectorAll("tr.step-sub .sub-line")).map(function(l){ return l.innerText.replace(/\\s+/g, " "); })`);
    assert.equal(subs.length, 2);
    assert.match(subs[0], failing === 1 ? /^1 the output exists and isn't empty ✗✓✓$/ : /^1 the output exists and isn't empty ✓✓✓$/);
    assert.match(subs[1], failing === 2 ? /^2 the model said done: true ✗✓✓$/ : /^2 the model said done: true ✓✓✓$/);
    await chrome.ev(`${G}.querySelector("button[data-every]").click()`);
    assert.equal(await chrome.ev(`${G}.querySelector("tr.step-sub").hidden`), true, 'a second click folds them');
  });
}

test('errors list: one line per red try, no #K and no "more check", (+M more) kept; a click on the line or its ✗ cell opens the whole text', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await open(1280, { redo: true, redoFails: true });
  if (!chrome) { t.skip('no chromium installed'); return; }
  const heads = await chrome.ev(`Array.from(${G}.querySelectorAll(".fx-errors button.fx-rowhead")).map(function(b){ return b.innerText.replace(/\\s+/g, " ").trim(); })`);
  assert.ok(heads.length >= 2, `one line per red try: ${heads}`);
  assert.equal(heads.length, new Set(heads.map((h) => h.split(' ')[2])).size, 'one line per try');
  for (const h of heads) assert.match(h, /^[▸▾] try \d ✗ \S.*$/);
  assert.equal(heads.filter((h) => /#\d|more check/.test(h)).length, 0);
  assert.match(await chrome.ev(`${G}.querySelector(".fx-errors").innerText`), /\n▸?\s*try \d\s+✗/);
  assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-errors .fx-row.open").length`), 1, 'only the last red try is open on load');
  await chrome.ev(`${G}.querySelector(".fx-errors button.fx-rowhead").click()`);
  assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-errors .fx-row.open").length`), 2, 'a click on a line opens it');
  await chrome.ev(`${G}.querySelector(".fx-errors button.fx-rowhead").click()`);
  await chrome.ev(`${G}.querySelector("button.cell.fail").click()`);
  assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-errors .fx-row.open").length`), 2, 'a click on a ✗ cell opens the same line');
});
