// M9 amendment 21 (signed 2026-10-17): the SUMMARY box's top line adds the run's time after its cost ("passed · $0.0047 1m56s"),
// the same number as the `took …` line; unknown time says `time not recorded`, never 0; a run still going or waiting shows none.
// The page's own renderRun is driven with synthetic run details in headless chromium over the real panel page (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { greenWorld } from './m9-trigger-world.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });

const ENDED = { reason: 'ended', next: 'again' };
const CASES = {
  finishedTimed: { glyph: '[✓]', spend: '$0.0047', wallMs: 116000, summary: { ended: ENDED } },
  finishedNoTime: { glyph: '[✗]', spend: '$0.0047', wallMs: null, wallMsWhy: 'history row has no wallMs recorded', summary: { ended: ENDED } },
  finishedZero: { glyph: '[✓]', spend: '$0.0047', wallMs: 0, summary: { ended: ENDED } },
  running: { glyph: '[▶]', spend: '$0.0047', wallMs: null, wallMsWhy: 'running now', summary: {} },
  waiting: { glyph: '[·]', spend: '$0.0047', wallMs: null, wallMsWhy: 'no history row yet (parked or died before completion)', summary: {} },
};

async function world(t) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev(`(function(){ var real = window.fetch; window.__patch = null;
    window.fetch = function(u, o){ var p = real.apply(this, arguments);
      if(window.__patch && String(u) === "/api/runs/job2/seed-pass") return p.then(function(r){ return r.json().then(function(j){ Object.assign(j, window.__patch); return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }); });
      return p; }; })()`);
  return chrome;
}
const paint = async (chrome, d0, key) => {
  const d = JSON.parse(JSON.stringify(d0)); d.stopReason = `case-${key}`;
  await chrome.ev(`window.__patch = ${JSON.stringify(d)}; document.getElementById("tab-runs").click(); window.__sel = Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); }); window.__sel.length ? (window.__sel[window.__sel.length - 1].click(), true) : false`);
  await chrome.waitFor(`(function(){ var b = document.querySelector("[data-testid=summary-why]"); return !!b && b.textContent.indexOf("case-${key}") >= 0; })()`, 8000);
  return chrome.ev(`(function(){ return { head: document.querySelector("#summary-box .summary-headline").textContent, counters: document.getElementById("run-counters").textContent }; })()`);
};

test('am21: the SUMMARY top line carries the time after the cost, the same as the took line; unknown says so; a live or waiting run has none', async (t) => {
  const chrome = await world(t);
  if (!chrome) return;
  const r = {};
  for (const [k, d] of Object.entries(CASES)) r[k] = await paint(chrome, d, k);
  const J = (k) => `${k}: ${JSON.stringify(r[k])}`;
  assert.match(r.finishedTimed.head, /\$0\.0047 · 1m56s$/, `am22 middle dot before the time: ${J('finishedTimed')}`);
  assert.match(r.finishedTimed.counters, /took 1m56s/, J('finishedTimed'));
  assert.match(r.finishedNoTime.head, /\$0\.0047 · time not recorded$/, `unknown time: ${J('finishedNoTime')}`);
  assert.doesNotMatch(r.finishedNoTime.head, /0\.0s|\b0s\b/, `unknown never 0: ${J('finishedNoTime')}`);
  const m = r.finishedZero.counters.match(/took (\S+)/);
  assert.ok(r.finishedZero.head.endsWith(` · ${m[1]}`), `headline time equals took line: ${J('finishedZero')}`);
  for (const k of ['running', 'waiting']) {
    assert.match(r[k].head, /\$0\.0047$/, `${k}: no time on the line: ${J(k)}`);
    assert.doesNotMatch(r[k].head, /time not recorded|\d s\b/, J(k));
  }
});
