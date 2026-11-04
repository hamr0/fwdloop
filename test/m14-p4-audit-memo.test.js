// M14 item 7 (Audit tab): in each step's grid a `told in this run` row directly under `told from earlier runs`, one button per try that was handed a memo, opening the
// exact text kept on that try's audit row (`memoText`), the way the hints open; and item 11 / am1: a rerun's reason shows in the first step's rounds in the redo words' shape.
// The run is the REAL one (test/m4d-am29-world.mjs: real runner, real model step, fake provider, so the memo is what the product writes). $0.
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
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { deriveFold, rerunWords } from '../src/audit-fold.js';

const HANDLES = [];
const CLOSERS = [];
after(async () => { for (const h of HANDLES) await h.close(); for (const c of CLOSERS) await c(); delete process.env.FWDLOOP_CONFIG_HOME; });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const STEP = 'resume-summary';
const G = `document.querySelector("[data-testid=audit-grid-${STEP}]")`;

async function open(width, opts, shape) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld(opts);
  delete process.env.FWDLOOP_CONFIG_HOME;
  if (shape) shape(w);
  const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} } }));
  HANDLES.push(h);
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened the newest run');
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor(`${G}`, 20000));
  return { chrome, w };
}

const linesOf = (text) => text.split('\n').map((l) => l.replace(/^\s+/, ''));
const word = (text) => { const n = text.split('\n').length; return `${n} ${n === 1 ? 'line' : 'lines'}`; };

for (const width of [1280, 320]) {
  test(`memo ${width}px: each handed try has its own button under the hints row, closed on load, a click opens that try's own exact text titled try N · told in this run · K lines`, { skip: SKIP && 'no browser' }, async (t) => {
    // hints ON so the hints row exists and the order of the two rows can be told
    const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m14p4-'));
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
    const now = new Date();
    const L = countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now });
    writeLedger({ ...L, rows: L.rows.map((r) => ({ ...r, lastSeen: now.toISOString() })) }, home);
    process.env.FWDLOOP_CONFIG_HOME = home;
    const got = await open(width, { redo: true, redoFails: true });
    if (!got) { t.skip('no chromium installed'); return; }
    const { chrome, w } = got;
    const memos = readAudit(w.runDir).filter((r) => r.step === STEP && typeof r.memoText === 'string').map((r) => ({ n: r.attempt, text: r.memoText }));
    assert.ok(memos.length >= 2, `two tries or more carry a memo: ${memos.map((m) => m.n)}`);
    // the memo row is directly under the hints row
    assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("tbody tr.hint-row td.q")).map(function(c){ return c.textContent; })`), ['told from earlier runs', 'told in this run']);
    assert.equal(await chrome.ev(`${G}.querySelector("tr.memo-row").previousElementSibling.querySelector("td.q").textContent`), 'told from earlier runs');
    const tries = await chrome.ev(`${G}.querySelectorAll("thead th.t").length`);
    assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll("tr.memo-row td.c")).map(function(c){ var b = c.querySelector("button.btn.small"); return b ? b.getAttribute("data-memo") + ":" + b.textContent : c.textContent; })`),
      Array.from({ length: tries }, (_, i) => { const m = memos.find((x) => x.n === i + 1); return m ? `${m.n}:${word(m.text)}` : '—'; }));
    assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow").length`), 0, 'closed on load');
    for (const m of memos) {
      await chrome.ev(`${G}.querySelector("button[data-memo='${m.n}']").click()`);
      assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow").length`), 1);
      assert.equal(await chrome.ev(`${G}.querySelector("button[data-memo='${m.n}']").getAttribute("aria-expanded")`), 'true');
      assert.equal(await chrome.ev(`${G}.querySelector(".fx-row.hintrow .fx-try").textContent`), `try ${m.n} · told in this run · ${word(m.text)}`);
      assert.deepEqual(await chrome.ev(`Array.from(${G}.querySelectorAll(".fx-row.hintrow .fx-lines div")).map(function(e){ return e.textContent; })`), linesOf(m.text).slice(0, 8), `try ${m.n}: its own exact text`);
      await chrome.ev(`${G}.querySelector("button[data-memo='${m.n}']").click()`);
      assert.equal(await chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow").length`), 0, 'a second click closes it');
    }
    // the spill check: nothing leaves the page at this width
    const r = await chrome.ev(`(function(){ var vw = document.documentElement.clientWidth, w = ${G}.querySelector(".grid-wrap").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - vw, right: w.right, vw: vw }; })()`);
    assert.ok(r.spill <= 0 && r.right <= r.vw + 0.5, JSON.stringify(r));
  });
}

test('memo: a try with no memo draws no row; a memo longer than 8 lines reads 8 then "+M more lines"', { skip: SKIP && 'no browser' }, async (t) => {
  const lines = Array.from({ length: 11 }, (_, i) => `memo line ${i + 1}`);
  const got = await open(1280, { redo: true }, (w) => {
    const file = path.join(w.runDir, 'audit.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => { const r = JSON.parse(l); return JSON.stringify(r.step === STEP && r.attempt === 2 ? { ...r, memoText: lines.join('\n') } : r); }).join('\n') + '\n');
  });
  if (!got) { t.skip('no chromium installed'); return; }
  const { chrome } = got;
  await chrome.ev(`${G}.querySelector("button[data-memo='2']").click()`);
  const shown = () => chrome.ev(`${G}.querySelectorAll(".fx-row.hintrow .fx-lines div").length`);
  assert.equal(await shown(), 8);
  assert.equal(await chrome.ev(`${G}.querySelector(".fx-row.hintrow .fx-more").textContent`), '+3 more lines');
  await chrome.ev(`${G}.querySelector(".fx-row.hintrow .fx-more").click()`);
  assert.equal(await shown(), 11);
});

test('no memo anywhere: no `told in this run` row at all', { skip: SKIP && 'no browser' }, async (t) => {
  const got = await open(1280, { redo: true }, (w) => {
    const file = path.join(w.runDir, 'audit.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => { const { memoText: _m, ...r } = JSON.parse(l); return JSON.stringify(r); }).join('\n') + '\n');
  });
  if (!got) { t.skip('no chromium installed'); return; }
  assert.equal(await got.chrome.ev(`${G}.querySelectorAll("tr.memo-row").length`), 0);
});

// am1 item 1 / item 11: the rerun's reason comes from its own run.json, in the redo words' shape, once, as the first row of the first step's first try
test('a rerun reason shows once, in the shape of the redo words, on the first step\'s first try, from the fold', () => {
  const group = { rows: [{ step: 'a', attempt: 1, verdict: 'green' }, { step: 'a', attempt: 2, verdict: 'green' }], tryMarks: ['✓', '✓'], closeClass: 'hitl' };
  const d = { present: true, calls: [{ step: 'a', try: 1, round: 1, at: 'x', costUsd: 0.1, tokens: { in: 1, out: 1, cache: 0 }, ms: 5 }], tools: [], checks: [] };
  const withRerun = deriveFold(group, d, { rerun: { words: 'wrong answer' } });
  const rows = withRerun.rows.filter((r) => r.action === 'human');
  assert.deepEqual(rows.map((r) => [r.try, r.decision]), [[1, 'you said rerun: "wrong answer"']]);
  assert.equal(rerunWords('x'), 'you said rerun: "x"');
  assert.equal(withRerun.rows[0].action, 'human', 'first row of the step');
  assert.equal(deriveFold(group, d, {}).rows.some((r) => r.action === 'human'), false, 'a fresh run has none');
});

// the whole reading path on a real run: run.json's `rerun` -> the panel's audit data -> the first step's try 1 rounds table on the page. The run itself is a normal one with the
// section put in its run.json (how a rerun's own start writes it is proved in test/m14-p1-rerun-record.test.js)
test('a run whose run.json holds a rerun reason shows it in the first step\'s try 1 rounds, nowhere else', { skip: SKIP && 'no browser' }, async (t) => {
  const got = await open(1280, { redo: false }, (w) => {
    const f = path.join(w.runDir, 'run.json');
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), rerun: { decision: 'rerun', words: 'wrong answer', afterStep: 'resume-summary' } }));
  });
  if (!got) { t.skip('no chromium installed'); return; }
  const { chrome } = got;
  // open every fold of every step's try rounds, then count the rerun rows
  await chrome.ev(`Array.from(document.querySelectorAll("details[data-fxrounds]")).forEach(function(d){ d.open = true; })`);
  assert.ok(await chrome.waitFor(`document.querySelectorAll("table.rounds-table").length > 0`, 5000));
  const found = await chrome.ev(`Array.from(document.querySelectorAll("table.rounds-table")).map(function(t){ return [t.getAttribute("data-testid"), Array.from(t.querySelectorAll("tbody tr")).filter(function(r){ return r.textContent.indexOf("you said rerun") >= 0; }).map(function(r){ return Array.from(r.querySelectorAll("td")).map(function(c){ return c.textContent; }); })]; }).filter(function(x){ return x[1].length > 0; })`);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0][0], /^rounds-table-resume-text-try-1$/, 'the first step, try 1');
  assert.deepEqual(found[0][1][0].slice(0, 5), ['\u2014', '1', 'human', '\u2014', 'you said rerun: "wrong answer"']);
});
