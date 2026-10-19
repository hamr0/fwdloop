// M4d amendment 28 (signed 2026-10-18): Model and Thinking share one row on the Job tab. Value `on retries` / `always on`; a run with no
// thinking.json (before am25) shows `—`, never a guess from model.json. Words: src/thinking.js thinkingRuleWords. Real HTTP + a real browser (skips when none). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld } from './m9-trigger-world.mjs';
import { thinkingRuleWords } from '../src/thinking.js';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

// kind: 'off' = an am25 run, box off; 'ticked' = box on; 'old' = before am25 (no thinking.json)
async function world(kind) {
  const g = await greenWorld();
  const runDir = path.join(g.flowDir, 'runs', 'seed-pass');
  if (kind !== 'old') writeFileSync(path.join(runDir, 'thinking.json'), JSON.stringify({ thinking: kind === 'ticked' }));
  // the flow's own model.json says ticked: an old run must still read `—`
  writeFileSync(path.join(g.flowDir, 'model.json'), JSON.stringify({ slot: 'DEEPSEEK_KEY', model: 'deepseek-flash', thinking: true }));
  return g;
}
const jobOf = async (g) => (await g.w.get('/api/runs/job2/seed-pass/job')).json();

test('item 2/3/4 (words): one function owns them; on retries / always on / — for no record', () => {
  assert.equal(thinkingRuleWords(false), 'on retries');
  assert.equal(thinkingRuleWords(true), 'always on');
  assert.equal(thinkingRuleWords(null), '—');
});

test('item 2/3 (server): the Job tab value is the run\'s own rule; an old run reads `—` whatever model.json says; never null', async () => {
  assert.equal((await jobOf(await world('off'))).thinkingRule, 'on retries');
  assert.equal((await jobOf(await world('ticked'))).thinkingRule, 'always on');
  assert.equal((await jobOf(await world('old'))).thinkingRule, '—');
});

test('item 1 (page source): Model and Thinking are two fields in ONE .field-row; Started follows that row; no hidden Thinking row', () => {
  const m = PAGE.indexOf('id="details-model"');
  const t = PAGE.indexOf('id="details-thinking"');
  const rowOpen = PAGE.lastIndexOf('<div class="field-row">', m);
  const rowEnd = PAGE.indexOf('</div>\n            </div>', m);
  assert.ok(rowOpen !== -1 && m > rowOpen && t > m && t < rowEnd + 20, 'Model and Thinking inside one field-row');
  assert.equal(PAGE.slice(rowOpen, m).includes('<h4'), false);
  assert.ok(PAGE.indexOf('id="details-started"') > t, 'Started comes after the paired row');
  assert.match(PAGE, /<label>Thinking<\/label>/);
  assert.doesNotMatch(PAGE, /id="details-thinking-field"[^>]*hidden/);
  assert.equal((PAGE.match(/ id="details-thinking"/g) || []).length, 1);
});

async function open(g, width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); })[0].click()');
  await chrome.ev('document.getElementById("tab-details").click()');
  assert.ok(await chrome.waitFor('!document.getElementById("job-card").hidden && document.getElementById("details-title").textContent.indexOf("job2") >= 0 && document.getElementById("details-thinking").textContent !== "—" || document.getElementById("details-model").textContent !== "—"', 15000));
  return chrome;
}
const geo = (chrome) => chrome.ev(`JSON.stringify((function(){
  var m = document.getElementById("details-model").closest(".field").getBoundingClientRect();
  var t = document.getElementById("details-thinking").closest(".field").getBoundingClientRect();
  var s = document.getElementById("details-started").closest(".field").getBoundingClientRect();
  return {mTop: m.top, tTop: t.top, tBottom: t.bottom, mBottom: m.bottom, sTop: s.top, tRight: t.right, vw: document.documentElement.clientWidth,
    spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, shown: getComputedStyle(document.getElementById("details-thinking").closest(".field")).display};
})())`).then(JSON.parse);

for (const width of [1280, 390, 320]) {
  test(`am28 page ${width}px: Thinking is on the Model row (or wraps under it, as the caps do); always shown; old run reads —; Started follows; no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const a = await open(await world('off'), width);
    if (!a) { t.skip('no chromium installed'); return; }
    assert.equal(await a.ev('document.getElementById("details-thinking").textContent'), 'on retries');
    assert.equal(await a.ev('document.querySelector("#details-thinking-field label").textContent'), 'Thinking');
    const ga = await geo(a);
    assert.notEqual(ga.shown, 'none');
    assert.ok(ga.spill <= 0, `sideways scroll ${ga.spill}px`);
    assert.ok(ga.tRight <= ga.vw, 'Thinking inside the viewport');
    assert.ok(ga.sTop >= Math.max(ga.mBottom, ga.tBottom) - 1, 'Started below the paired row');
    if (width >= 390) assert.ok(Math.abs(ga.mTop - ga.tTop) < 2, `side by side at ${width}: ${ga.mTop} vs ${ga.tTop}`);
    const b = await open(await world('ticked'), width);
    assert.equal(await b.ev('document.getElementById("details-thinking").textContent'), 'always on');
    const c = await open(await world('old'), width);
    assert.equal(await c.ev('document.getElementById("details-thinking").textContent'), '—');
    const gc = await geo(c);
    assert.notEqual(gc.shown, 'none', 'the row shows on an old run');
    assert.ok(gc.spill <= 0);
  });
}
