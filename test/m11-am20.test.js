// M11 amendment 20 (signed 2026-10-17): Scheduled sits BELOW the search box and chips (above Jobs); Running now and Needs you stay above the grey line.
// With the ◷ chip pressed the count line counts scheduled jobs; ◷'s ink is as tall as ✓'s (am21), under forced fonts. Part 1 drives the page's own functions;
// part 2 drives the real panel in headless chromium at 1280/390/320 (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { greenWorld } from './m9-trigger-world.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fnSrc = (name) => cutFn(PAGE, name, '  ');
const NAMES = [
  'escapeXml', 'duration', 'glyphClass', 'dotClass', 'signHtml', 'readableDateTime', 'runSpendText', 'runWallText', 'runAtText',
  'rlShortDate', 'groupRunsByFlow', 'matchesSearch', 'filterRuns', 'filterWorkflows', 'filtersActive',
  'rlModel', 'rlSectHtml', 'rlJumpCardHtml', 'rlScheduledCardHtml', 'rlTopHtml', 'rlSchedShown', 'rlSchedHtml', 'rlSchedCountText',
];
const lib = new Function(`${NAMES.map(fnSrc).join('\n')}\nreturn {${NAMES.join(',')}};`)();
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
const ROWS = [run('payroll', 1), run('busy', 4, { glyph: '[▶]', live: true }), run('asker', 2, { glyph: '[·]', needs: 'Answer' })];
const data = { rows: ROWS, jobs: ['payroll', 'busy', 'asker'].map((flow) => ({ flow, quiet: false, activityMs: 1 })), scheduled: SCHED, limits: LIMITS };
const model = (filters) => lib.rlModel(data, lib.filterWorkflows(lib.groupRunsByFlow(data.rows), filters, Date.now()), filters, LIMITS, { flow: null, runId: null }, {});

test('am20 item 1: rlTopHtml draws only Running now and Needs you; rlSchedHtml draws Scheduled', () => {
  const m = model(F());
  const top = lib.rlTopHtml(m, F());
  assert.match(top, /Running now \(1\)/);
  assert.match(top, /Needs you \(1\)/);
  assert.doesNotMatch(top, /Scheduled|rl-sched-/, 'Scheduled is not in the box above the search');
  const sched = lib.rlSchedHtml(m, F());
  assert.match(sched, /Scheduled \(3\)/);
  assert.doesNotMatch(sched, /Running now|Needs you/);
  assert.match(lib.rlSchedHtml(model(F({ scheduled: true, search: 'zzz' })), F({ scheduled: true, search: 'zzz' })), /no scheduled job matches/);
  assert.equal(lib.rlSchedHtml(model(F({ search: 'zzz' })), F({ search: 'zzz' })), '');
});

test('am20 item 1: the page puts Scheduled in its own box after the filter bar and before Jobs, and the box id is unique', () => {
  const panel = PAGE.slice(PAGE.indexOf('<section id="panel-runs"'), PAGE.indexOf('</section>', PAGE.indexOf('<section id="panel-runs"')));
  const order = ['id="rl-top"', 'class="rl-dash"', 'data-testid="rl-filter-note"', 'id="runs-filterbar-anchor"', 'id="rl-sched"', 'id="wf-list"'].map((s) => panel.indexOf(s));
  assert.ok(order.every((i) => i !== -1), `parts missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal((PAGE.match(/\sid="rl-sched"/g) || []).length, 1);
});

test('am20 item 3: the count words with ◷ pressed', () => {
  assert.equal(lib.rlSchedCountText(1), 'showing 1 scheduled job');
  assert.equal(lib.rlSchedCountText(2), 'showing 2 scheduled jobs');
  assert.equal(lib.rlSchedCountText(0), 'showing 0 scheduled jobs');
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
const forcedFontsSay = (ran, wanted) => `am21 needs at least two forced fonts installed; only ${JSON.stringify(ran)} of ${JSON.stringify(wanted)} found; install them: sudo apt-get install fonts-symbola fonts-freefont-ttf`;
test('am21 the too-few-fonts failure names the fix', () => {
  const say = forcedFontsSay(['FreeSans'], ['Symbola', 'FreeSans']);
  assert.match(say, /sudo apt-get install fonts-symbola fonts-freefont-ttf/);
  assert.match(say, /\["FreeSans"\]/, 'still says which fonts were found');
});
const typeMain = (chrome, v) => chrome.ev(`(function(){ var i = document.getElementById("runs-filter-search"); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const chip = (chrome) => chrome.ev('document.querySelector("[data-testid=chip-runs-scheduled]").click(); true');
const countText = (chrome) => chrome.ev('document.getElementById("runs-filter-count").textContent');

for (const width of [1280, 390, 320]) {
  test(`am20 at ${width}: Scheduled below the search box and chips; top sections above; ◷ count words; ◷ as big as ✓; no sideways scroll`, async (t) => {
    const chrome = await world(t, width);
    if (!chrome) return;
    const pos = await chrome.ev('(function(){ var q = function(s){ return document.querySelector(s).getBoundingClientRect(); };' +
      ' var firstCard = q("[data-testid^=rl-sched-]"); var hdr = document.getElementById("rl-sched").getBoundingClientRect();' +
      ' return { cardTop: firstCard.top, hdrTop: hdr.top, searchBottom: q("#runs-filter-search").bottom, chipsBottom: q("[data-testid=runs-filters]").bottom, topBottom: q("#rl-top").bottom, searchTop: q("#runs-filter-search").top, jobsTop: q("#wf-list").top, schedBottom: hdr.bottom }; })()');
    assert.ok(pos.cardTop > pos.searchBottom, `Scheduled card above the search box bottom ${JSON.stringify(pos)}`);
    assert.ok(pos.topBottom <= pos.searchTop, `Running now / Needs you box below the search ${JSON.stringify(pos)}`);
    assert.ok(pos.schedBottom <= pos.jobsTop + 1, `Scheduled above Jobs ${JSON.stringify(pos)}`);
    assert.match(await countText(chrome), /^showing \d+ of \d+ runs$/, 'unpressed: unchanged');
    await chip(chrome);
    assert.equal(await countText(chrome), 'showing 3 scheduled jobs');
    await typeMain(chrome, 'kyc');
    assert.equal(await countText(chrome), 'showing 1 scheduled job');
    await typeMain(chrome, 'zzz');
    assert.equal(await countText(chrome), 'showing 0 scheduled jobs');
    // M11 am21: the ink you see. ◷'s ink HEIGHT (canvas measureText of the chip's own font) is within 1px of ✓'s, under the default font AND under forced fonts
    // (a fixed size fits one font and not another). The empty space around a mark is not judged.
    // The page's OWN fitChips does the fit: each forced font is injected before the page's scripts run (Page.addScriptToEvaluateOnNewDocument) and the page is reloaded.
    const measure = async (family) => {
      const seen = await chrome.ev('(function(){ var cv = document.createElement("canvas").getContext("2d"); var big = function(f){ cv.font = "100px " + f; var m = cv.measureText("◷"); return m.width + "/" + m.actualBoundingBoxAscent + "/" + m.actualBoundingBoxDescent; };' +
        ' return ' + JSON.stringify(!family) + ' || big(' + JSON.stringify(JSON.stringify(family)) + ') !== big("NoSuchFontAnywhere123"); })()');
      if (!seen) return { installed: false };
      if (forceId) { await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: forceId }); forceId = null; }
      if (family) {
        await chrome.send('Page.enable'); // without it the new-document script does not run on reload
        const css = `.chip.fchip[data-filter-value="scheduled"]{font-family:"${family}" !important;}`;
        const src = `(function(){ var add = function(){ var st = document.createElement("style"); st.textContent = ${JSON.stringify(css)}; document.documentElement.appendChild(st); };` +
          ' if(document.documentElement) add(); else new MutationObserver(function(_, o){ if(document.documentElement){ o.disconnect(); add(); } }).observe(document, { childList: true }); })()';
        forceId = (await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier;
      }
      await chrome.ev('window.__beforeReload = 1; true');
      await chrome.send('Page.reload');
      assert.ok(await chrome.waitFor('!window.__beforeReload && document.readyState === "complete" && !!document.querySelector("[data-testid=chip-runs-scheduled]")', 30000), `page reloaded under "${family || 'default'}"`);
      return chrome.ev('(function(){ var cv = document.createElement("canvas").getContext("2d"); var h = function(sel){ var e = document.querySelector(sel); var cs = getComputedStyle(e);' +
        ' cv.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily; var m = cv.measureText(e.textContent); return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; };' +
        ' var sc = "[data-testid=chip-runs-scheduled]";' +
        ' return { sched: h(sc), pass: h("[data-testid=chip-runs-res-pass]"), fail: h("[data-testid=chip-runs-res-fail]"), fs: getComputedStyle(document.querySelector(sc)).fontSize, installed: true }; })()');
    };
    let forceId = null;
    const fonts = ['', 'Noto Sans Mono Condensed', 'Symbola', 'FreeSans', 'Adwaita Mono'];
    const ran = [];
    for (const family of fonts) {
      const m = await measure(family);
      if (!m.installed) { console.log(`# am21 at ${width}: forced font "${family}" is not installed here`); continue; }
      if (family) ran.push(family);
      console.log(`# am21 at ${width} ${family || '(default)'}: ${JSON.stringify(m)}`);
      assert.ok(Math.abs(m.sched - m.pass) <= 1, `◷ ink height ${m.sched} vs ✓ ${m.pass} under "${family || 'default'}": ${JSON.stringify(m)}`);
    }
    assert.ok(ran.length >= 2, forcedFontsSay(ran, fonts.slice(1)));
    const g = await chrome.ev('({ spill: document.documentElement.scrollWidth - document.documentElement.clientWidth })');
    assert.ok(g.spill <= 0, `sideways scroll ${JSON.stringify(g)}`);
  });
}
