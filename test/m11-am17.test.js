// M11 amendment 17 (signed 2026-10-17, replaces am16): there is NO separate Scheduled search box. The ONE search box narrows the Scheduled cards by
// job name (case-insensitive substring) along with Jobs; a run number or a date narrows only Jobs. The result and 7d/30d/all chips never touch
// Scheduled. A new `scheduled` chip: pressed, only Scheduled shows (Jobs and the quiet fold hide), the search narrows only Scheduled; no match says
// `no scheduled job matches`. Running now and Needs you are never filtered or searched. No Scheduled match draws nothing, header included.
// Part 1 drives the page's own functions; part 2 drives the real panel in headless chromium (skips when none). $0.
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
const F = (over = {}) => ({ results: [], time: 'all', search: '', scheduled: false, ...over });
const run = (flow, n, over = {}) => ({
  flow, runId: `run-${n}`, glyph: '[✓]', word: 'passed', line: null, label: 'passed', pulse: false, spend: '$0.0100', spendWhy: null,
  wallMs: 60_000, at: new Date(2026, 9, 12, 13, 46).toISOString(), askedAt: null, startedAt: null, model: 'deepseek-flash', needs: null, live: false, ...over,
});
const SCHED = [
  { flow: 'payroll', at: 'Mon 09:00', in: 'in 2 h', words: 'daily', runId: 'run-1' },
  { flow: 'Invoices-weekly', at: 'Fri 17:00', in: 'in 3 d', words: 'weekly', runId: null },
  { flow: 'kyc', at: null, in: null, words: 'when a file arrives', runId: 'run-2' },
];
const ROWS = [run('payroll', 1), run('other', 1), run('busy', 4, { glyph: '[▶]', live: true }), run('asker', 2, { glyph: '[·]', needs: 'Answer' })];
const data = (scheduled) => ({ rows: ROWS, jobs: ['payroll', 'other', 'busy', 'asker'].map((flow) => ({ flow, quiet: false, activityMs: 1 })), scheduled, limits: LIMITS });
const model = (d, filters = F()) => lib.rlModel(d, lib.filterWorkflows(lib.groupRunsByFlow(d.rows), filters, Date.now()), filters, LIMITS, { flow: null, runId: null }, {});
const top = (filters, sched = SCHED) => lib.rlTopHtml(model(data(sched), filters), filters);
const names = (html) => [...html.matchAll(/data-testid="rl-sched-([^"]+)"/g)].map((x) => x[1]);

test('am17 item 1: no separate Scheduled search box exists anywhere', () => {
  assert.doesNotMatch(PAGE, /rl-sched-q|rl-scheduled-search|rlSchedQ/);
  assert.doesNotMatch(top(F()), /<input/);
});

test('am17 item 1: the one search narrows Scheduled cards by job name, case-insensitive substring', () => {
  assert.deepEqual(names(top(F({ search: 'INVOICE' }))), ['Invoices-weekly']);
  assert.deepEqual(names(top(F({ search: 'p' }))), ['payroll']);
  assert.deepEqual(names(top(F({ search: '' }))), ['payroll', 'Invoices-weekly', 'kyc']);
});

test('am17 item 1: a run number or a date narrows only Jobs; a job-name word beside one still narrows Scheduled', () => {
  for (const q of ['run-23', '10/13', '2026-10-12']) {
    assert.deepEqual(names(top(F({ search: q }))), ['payroll', 'Invoices-weekly', 'kyc'], `query ${q} leaves Scheduled alone`);
  }
  assert.deepEqual(names(top(F({ search: 'kyc run-23' }))), ['kyc'], 'the name word still narrows');
});

test('am17 item 5: Scheduled with no match draws nothing, header included', () => {
  const html = top(F({ search: 'zzz' }));
  assert.doesNotMatch(html, /Scheduled/);
  assert.doesNotMatch(html, /no scheduled job matches/, 'only the scheduled chip says it');
  assert.deepEqual(names(html), []);
  assert.doesNotMatch(top(F(), []), /Scheduled/);
});

test('am17 item 2: result chips and 7d/30d never hide a Scheduled card', () => {
  const all = ['payroll', 'Invoices-weekly', 'kyc'];
  assert.deepEqual(names(top(F({ results: ['[✗]'] }))), all);
  assert.deepEqual(names(top(F({ results: ['[▶]', '[?]'], time: '7d' }))), all);
  assert.deepEqual(names(top(F({ time: '30d' }))), all);
});

test('am17 item 3: the scheduled chip sits in the runs filter bar with its word, title and a unique testid; the Inbox bar has none', () => {
  const runs = lib.filterBarHTML('runs');
  assert.match(runs, /<button[^>]*title="scheduled jobs only"[^>]*data-testid="chip-runs-scheduled"[^>]*>scheduled<\/button>/);
  assert.equal((runs.match(/data-testid="chip-runs-scheduled"/g) || []).length, 1);
  assert.doesNotMatch(lib.filterBarHTML('inbox', true), /scheduled/);
});

test('am17 item 3/5: with the scheduled chip pressed the search narrows Scheduled; no match says `no scheduled job matches`', () => {
  assert.deepEqual(names(top(F({ scheduled: true, search: 'kyc' }))), ['kyc']);
  const none = top(F({ scheduled: true, search: 'zzz' }));
  assert.match(none, /no scheduled job matches/);
  assert.deepEqual(names(none), []);
  assert.match(top(F({ scheduled: true }), []), /no scheduled job matches/, 'nothing scheduled at all reads the same');
});

test('am17 item 4: Running now and Needs you are never filtered or searched, chip or not', () => {
  for (const f of [F({ search: 'zzz' }), F({ results: ['[✗]'], time: '7d' }), F({ scheduled: true, search: 'zzz' }), F({ scheduled: true })]) {
    const html = top(f);
    assert.match(html, /Running now \(1\)/, JSON.stringify(f));
    assert.match(html, /Needs you \(1\)/, JSON.stringify(f));
    assert.match(html, /rl-live-busy|data-rl-jump="busy\|run-4"/);
  }
});

async function world(t, width) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  await chrome.ev(`(function(){ var real = window.fetch;
    window.fetch = function(u, o){ var p = real.apply(this, arguments);
      if(String(u) === "/api/runs") return p.then(function(r){ return r.json().then(function(j){ j.scheduled = ${JSON.stringify(SCHED)}; return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }); });
      return p; }; })()`);
  await chrome.ev('document.getElementById("tab-runs").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid^=rl-sched-]").length === 3', 20000), 'three Scheduled cards drawn');
  return chrome;
}
const typeMain = (chrome, v) => chrome.ev(`(function(){ var i = document.getElementById("runs-filter-search"); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const chip = (chrome) => chrome.ev('document.querySelector("[data-testid=chip-runs-scheduled]").click(); true');
const cards = (chrome) => chrome.ev('Array.from(document.querySelectorAll("[data-testid^=rl-sched-]")).map(function(e){ return e.getAttribute("data-testid"); })');
const jobsHtml = (chrome) => chrome.ev('document.getElementById("wf-list").innerHTML');

test('am17 on the real panel: one box only; the main search narrows Scheduled; the chip hides Jobs; pressing again restores', async (t) => {
  const chrome = await world(t, 1280);
  if (!chrome) return;
  assert.equal(await chrome.ev('document.querySelectorAll("#panel-runs input[type=text]").length'), 1, 'one search box on the Runs tab');
  const jobsBefore = await jobsHtml(chrome);
  assert.ok(jobsBefore.length > 0);
  await typeMain(chrome, 'kyc');
  assert.deepEqual(await cards(chrome), ['rl-sched-kyc']);
  await typeMain(chrome, 'zzz-nothing');
  assert.deepEqual(await cards(chrome), []);
  assert.equal(await chrome.ev('document.getElementById("rl-top").textContent.indexOf("Scheduled") >= 0'), false, 'no header');
  await typeMain(chrome, '');
  await chip(chrome);
  assert.equal(await chrome.ev('document.querySelector("[data-testid=chip-runs-scheduled]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await jobsHtml(chrome), '', 'Jobs and the quiet fold hidden');
  assert.equal((await cards(chrome)).length, 3);
  await typeMain(chrome, 'zzz-nothing');
  assert.equal(await chrome.ev('document.getElementById("rl-top").textContent.indexOf("no scheduled job matches") >= 0'), true);
  await typeMain(chrome, '');
  await chip(chrome);
  assert.equal(await chrome.ev('document.querySelector("[data-testid=chip-runs-scheduled]").getAttribute("aria-pressed")'), 'false');
  assert.equal(await jobsHtml(chrome), jobsBefore, 'pressed again: back to normal');
});

test('am17 on the real panel: a result chip and 7d never hide a Scheduled card', async (t) => {
  const chrome = await world(t, 1280);
  if (!chrome) return;
  await chrome.ev('document.querySelector("[data-testid=chip-runs-res-fail]").click(); document.querySelector("[data-testid=chip-runs-time-7d]").click(); true');
  assert.equal((await cards(chrome)).length, 3);
});

for (const width of [1280, 390, 320]) {
  test(`am17 at ${width}: the chip row wraps, nothing spills sideways, the chip stays on screen`, async (t) => {
    const chrome = await world(t, width);
    if (!chrome) return;
    await chip(chrome);
    await typeMain(chrome, 'zzz');
    const r = await chrome.ev('(function(){ var c = document.querySelector("[data-testid=chip-runs-scheduled]").getBoundingClientRect(); var bar = document.querySelector("[data-testid=runs-filters]").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, cl: c.left, cr: c.right, bl: bar.left, br: bar.right, w: window.innerWidth, ch: c.height }; })()');
    assert.ok(r.spill <= 0, `sideways scroll ${JSON.stringify(r)}`);
    assert.ok(r.cl >= 0 && r.cr <= r.w && r.br <= r.w, `chip and bar inside the screen ${JSON.stringify(r)}`);
    assert.ok(r.ch > 0, 'chip is drawn');
  });
}
