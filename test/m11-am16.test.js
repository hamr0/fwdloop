// M11 amendment 16 (signed 2026-10-17): the Scheduled section has its own search box under its header; typing narrows its cards by job name;
// empty shows all; no match says `no scheduled job matches`. The main search and filters still never hide a Scheduled card; the Scheduled box
// touches nothing outside Scheduled. Part 1 drives the page's own functions; part 2 drives the real panel in headless chromium (skips when none). $0.
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
function fnSrc(name) {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(start, i + 1);
  }
  assert.fail(`function ${name} has no closing brace`);
}
const NAMES = [
  'escapeXml', 'duration', 'glyphClass', 'dotClass', 'signHtml', 'readableDateTime', 'runSpendText', 'runWallText', 'runAtText',
  'rlShortDate', 'groupRunsByFlow', 'matchesSearch', 'filterRuns', 'filterWorkflows', 'filtersActive',
  'rlModel', 'rlSectHtml', 'rlJumpCardHtml', 'rlScheduledCardHtml', 'rlRunCardHtml', 'rlJobCardHtml', 'rlTopHtml', 'rlJobsHtml', 'filterBarHTML',
];
const CHIP_WORDS = PAGE.match(/ {2}var INBOX_CHIP_WORD = [^\n]*/)?.[0] ?? '';
const lib = new Function(`${CHIP_WORDS}\n${NAMES.map(fnSrc).join('\n')}\nreturn {${NAMES.join(',')}};`)();
const LIMITS = { quietDays: 30, olderRuns: 7 };
const S = (search) => ({ results: [], time: 'all', search });
const run = (flow, n) => ({
  flow, runId: `run-${n}`, glyph: '[✓]', word: 'passed', line: null, label: 'passed', pulse: false, spend: '$0.0100', spendWhy: null,
  wallMs: 60_000, at: new Date(2026, 9, 12, 13, 46).toISOString(), askedAt: null, startedAt: null, model: 'deepseek-flash', needs: null, live: false,
});
const SCHED = [
  { flow: 'payroll', at: 'Mon 09:00', in: 'in 2 h', words: 'daily', runId: 'run-1' },
  { flow: 'Invoices-weekly', at: 'Fri 17:00', in: 'in 3 d', words: 'weekly', runId: null },
  { flow: 'kyc', at: null, in: null, words: 'when a file arrives', runId: 'run-2' },
];
const data = (scheduled) => ({ rows: [run('payroll', 1), run('other', 1)], jobs: [{ flow: 'payroll', quiet: false, activityMs: 1 }, { flow: 'other', quiet: false, activityMs: 1 }], scheduled, limits: LIMITS });
const model = (d, filters = S('')) => lib.rlModel(d, lib.filterWorkflows(lib.groupRunsByFlow(d.rows), filters, Date.now()), filters, LIMITS, { flow: null, runId: null }, {});
const names = (html) => [...html.matchAll(/data-testid="rl-sched-([^"]+)"/g)].map((x) => x[1]);

test('am16: the Scheduled header has its own search box under it; empty shows every card; a 0-item section draws neither header nor box', () => {
  const html = lib.rlTopHtml(model(data(SCHED)), '');
  assert.match(html, /Scheduled \(3\)<\/div><input[^>]*id="rl-sched-q"/, 'the box sits right under the header');
  assert.equal((html.match(/ id="rl-sched-q"/g) || []).length, 1, 'one box, one unique id');
  assert.deepEqual(names(html), ['payroll', 'Invoices-weekly', 'kyc']);
  const none = lib.rlTopHtml(model(data([])), '');
  assert.doesNotMatch(none, /Scheduled|rl-sched-q/);
});

test('am16: typing narrows the Scheduled cards by job name, case-insensitive; the box keeps what was typed', () => {
  const html = lib.rlTopHtml(model(data(SCHED)), 'INVOICE');
  assert.deepEqual(names(html), ['Invoices-weekly']);
  assert.match(html, /id="rl-sched-q"[^>]*value="INVOICE"/);
  assert.deepEqual(names(lib.rlTopHtml(model(data(SCHED)), 'p')), ['payroll']);
});

test('am16: no match says so (and the box stays); an empty or whitespace-free query is not a match test', () => {
  const html = lib.rlTopHtml(model(data(SCHED)), 'zzz');
  assert.deepEqual(names(html), []);
  assert.match(html, /no scheduled job matches/);
  assert.match(html, /id="rl-sched-q"/, 'the box stays so the user can clear it');
  assert.doesNotMatch(lib.rlTopHtml(model(data(SCHED)), ''), /no scheduled job matches/);
});

test('am16: the main search and filters never hide a Scheduled card, and the Scheduled box changes nothing outside Scheduled', () => {
  const hidden = lib.rlTopHtml(model(data(SCHED), S('nothing-matches-this')), '');
  assert.deepEqual(names(hidden), ['payroll', 'Invoices-weekly', 'kyc']);
  const m = model(data(SCHED));
  const jobs = lib.rlJobsHtml(m);
  const top = (q) => lib.rlTopHtml(m, q).split('Scheduled (')[0];
  assert.equal(top('zzz'), top(''), 'sections above Scheduled are the same whatever the Scheduled query');
  assert.equal(lib.rlJobsHtml(model(data(SCHED))), jobs);
  assert.match(jobs, /payroll/);
  assert.match(jobs, /other/, 'Jobs section keeps every job');
});

async function world(t, width) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  // the page's /api/runs poll answers with three Scheduled cards; `window.__tick` rides in one card's words so a poll that repaints can be told apart
  await chrome.ev(`(function(){ var real = window.fetch; window.__tick = 0;
    window.fetch = function(u, o){ var p = real.apply(this, arguments);
      if(String(u) === "/api/runs") return p.then(function(r){ return r.json().then(function(j){ j.scheduled = ${JSON.stringify(SCHED)}.map(function(s, i){ return i === 0 ? Object.assign({}, s, { words: s.words + " #" + window.__tick }) : s; }); return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }); });
      return p; }; })()`);
  await chrome.ev('document.getElementById("tab-runs").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid^=rl-sched-]:not([data-testid=rl-scheduled-search])").length === 3', 20000), 'three Scheduled cards drawn');
  return chrome;
}
const type = (chrome, v) => chrome.ev(`(function(){ var i = document.getElementById("rl-sched-q"); i.focus(); i.value = ${JSON.stringify(v)}; i.setSelectionRange(2, 2); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const cards = (chrome) => chrome.ev('Array.from(document.querySelectorAll("[data-testid^=rl-sched-]:not([data-testid=rl-scheduled-search])")).map(function(e){ return e.getAttribute("data-testid"); })');

test('am16 on the real panel: typing narrows Scheduled only; a poll that repaints keeps the box focused, its text and its caret', async (t) => {
  const chrome = await world(t, 1280);
  if (!chrome) return;
  const jobsBefore = await chrome.ev('document.getElementById("wf-list").innerHTML');
  await type(chrome, 'kyc');
  assert.deepEqual(await cards(chrome), ['rl-sched-kyc']);
  assert.equal(await chrome.ev('document.getElementById("wf-list").innerHTML'), jobsBefore, 'the Jobs list is untouched');
  await type(chrome, 'zzz');
  assert.equal(await chrome.ev('document.getElementById("rl-top").textContent.indexOf("no scheduled job matches") >= 0'), true);
  await type(chrome, 'pay');
  await chrome.ev('window.__tick = 7');
  assert.ok(await chrome.waitFor('document.getElementById("rl-top").textContent.indexOf("#7") >= 0', 20000), 'a poll repainted the section');
  const s = await chrome.ev('(function(){ var i = document.getElementById("rl-sched-q"); return { focus: document.activeElement === i, v: i.value, c: i.selectionStart, n: document.querySelectorAll("#rl-sched-q").length }; })()');
  assert.deepEqual(s, { focus: true, v: 'pay', c: 2, n: 1 }, 'focus, text and caret survive the repaint');
  await type(chrome, '');
  assert.equal((await cards(chrome)).length, 3, 'empty shows every card');
});

test('am16 on the real panel: the main search never hides a Scheduled card', async (t) => {
  const chrome = await world(t, 1280);
  if (!chrome) return;
  await chrome.ev('(function(){ var i = document.querySelector("#panel-runs .search-input:not(#rl-sched-q)"); i.value = "zzz-nothing"; i.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await new Promise((r) => { setTimeout(r, 500); });
  assert.equal((await cards(chrome)).length, 3);
});

for (const width of [390, 320]) {
  test(`am16 at ${width}: the box fits, no sideways scroll`, async (t) => {
    const chrome = await world(t, width);
    if (!chrome) return;
    await type(chrome, 'zzz');
    const r = await chrome.ev('(function(){ var i = document.getElementById("rl-sched-q").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: i.right, w: window.innerWidth, left: i.left }; })()');
    assert.ok(r.spill <= 0, `sideways scroll ${JSON.stringify(r)}`);
    assert.ok(r.right <= r.w && r.left >= 0, `box inside the screen ${JSON.stringify(r)}`);
  });
}
