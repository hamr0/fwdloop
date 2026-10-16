// M9 amendment 13: the Run tab summary is ONE framed box (ENDED, NEXT, SCHEDULE as label | value). Frame: red on a SCHEDULE problem, else the run's own
// sign ([✓] green, [✗] red, [?] magenta, [■] grey). M9 am14 (signed 2026-10-16) amends item 2: the frame is the colour of that run's card in the runs list
// for every glyph, so a running run is amber, a waiting one grey, [!] expired and [II] stuck amber (the card's dot colours). ENDED/NEXT text never red; SCHEDULE label+lines red only on a problem.
// The page's own renderSummary is driven with synthetic run details in headless chromium over the real panel page (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { greenWorld } from './m9-trigger-world.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const SHOTS = process.env.SHOT_DIR || null;
void fileURLToPath; void path;

const ENDED = { reason: '10/16 06:31 · failed · Stopped at line 1: the step said it did not finish.', next: 'Run it again from the Chat card.' };
const SCHED = (red) => ({ line1: 'when a new file arrives in ~/fwdloop-in/', line2: 'last 10/16 06:31 · run-4 · failed · next: waiting for a new file', red });
const CASES = {
  passedHealthy: { glyph: '[✓]', summary: { ended: ENDED, schedule: SCHED(false) } },
  failedHealthy: { glyph: '[✗]', summary: { ended: ENDED, schedule: SCHED(false) } },
  failedProblem: { glyph: '[✗]', summary: { ended: ENDED, schedule: SCHED(true) } },
  crashed: { glyph: '[?]', summary: { ended: ENDED } },
  stopped: { glyph: '[■]', summary: { ended: ENDED, schedule: SCHED(false) } },
  runningSched: { glyph: '[▶]', summary: { schedule: SCHED(false) } },
  waiting: { glyph: '[·]', summary: { schedule: SCHED(false) } },
  expired: { glyph: '[!]', summary: { ended: ENDED } },
  stuck: { glyph: '[II]', summary: { ended: ENDED } },
};

async function world(t, width) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  // the page's own path: select the real run; its detail GET is patched (glyph + summary) so renderSummary paints each case
  await chrome.ev(`(function(){ var real = window.fetch; window.__patch = null;
    window.fetch = function(u, o){ var p = real.apply(this, arguments);
      if(window.__patch && String(u) === "/api/runs/job2/seed-pass") return p.then(function(r){ return r.json().then(function(j){ Object.assign(j, window.__patch); return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }); });
      return p; }; })()`);
  return chrome;
}
const paint = async (chrome, d0, key) => {
  // a tag in the first visible line tells the poll's repaint of THIS case from the previous one
  const d = JSON.parse(JSON.stringify(d0)); const tag = ` [${key}]`;
  if (d.summary.ended) d.summary.ended.reason += tag; else d.summary.schedule.line1 += tag;
  await chrome.ev(`window.__patch = ${JSON.stringify(d)}; document.getElementById("tab-runs").click(); window.__sel = Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); }); window.__sel.length ? (window.__sel[window.__sel.length - 1].click(), true) : false`);
  await chrome.waitFor(`(function(){ var b = document.querySelector("[data-testid=ended-block]"); return !!b && (${JSON.stringify(!!(d.summary.ended || d.summary.schedule))} ? !b.hidden && b.innerHTML.indexOf(${JSON.stringify(tag)}) >= 0 : true); })()`, 8000);
  await new Promise((r) => { setTimeout(r, 150); });
  return chrome.ev(`(function(){ try{
  var box = document.querySelector("[data-testid=ended-block]"); if(!box || box.hidden) return { present: !!box };
  var red = (function(){ var p = document.createElement("span"); p.style.color = "var(--red)"; document.body.appendChild(p); var c = getComputedStyle(p).color; p.remove(); return c; })();
  var col = function(sel){ var e = box.querySelector(sel); return e ? getComputedStyle(e).color : null; };
  var frames = document.querySelectorAll("#summary-blocks .ended-block").length;
  var tok = function(n){ var p = document.createElement("span"); p.style.borderTop = "2px solid var(--" + n + ")"; document.body.appendChild(p); var c = getComputedStyle(p).borderTopColor; p.remove(); return c; };
  return { present: true, frames: frames, border: getComputedStyle(box).borderTopColor, none: tok("border-strong"), green: tok("green"), red: tok("red"), magenta: tok("magenta"), grey: tok("grey-dot"), amber: tok("amber"),
    endedRed: col("[data-testid=ended-reason]") === red || col("[data-testid=ended-next]") === red,
    schedRed: col("[data-testid=sched-line1]") === red && col("[data-testid=sched-line2]") === red && getComputedStyle(box.querySelector(".ended-label.is-red") || document.body).color === red,
    schedAnyRed: col("[data-testid=sched-line1]") === red || col("[data-testid=sched-line2]") === red,
    labels: Array.from(box.querySelectorAll(".ended-label")).map(function(e){ return e.textContent; }),
    spill: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }catch(e){ return {err:String(e)}; } })()`);
};

test('am13 at 1280: one box, frame by the run\'s sign, ENDED/NEXT never red, SCHEDULE red only on a problem', async (t) => {
  const chrome = await world(t, 1280);
  if (!chrome) return;
  const r = {};
  for (const [k, d] of Object.entries(CASES)) r[k] = await paint(chrome, d, k);
  const J = (k) => `${k}: ${JSON.stringify(r[k])}`;
  for (const k of Object.keys(CASES)) assert.equal(r[k].frames, 1, `not one box: ${J(k)}`);
  assert.deepEqual(r.failedHealthy.labels, ['ENDED', 'NEXT', 'SCHEDULE', ''], J('failedHealthy'));
  assert.equal(r.passedHealthy.border, r.passedHealthy.green, `passed + healthy schedule is green: ${J('passedHealthy')}`);
  assert.notEqual(r.passedHealthy.border, r.passedHealthy.red, 'passed + healthy schedule has no red frame');
  assert.equal(r.failedHealthy.border, r.failedHealthy.red, J('failedHealthy'));
  assert.equal(r.crashed.border, r.crashed.magenta, J('crashed'));
  assert.equal(r.stopped.border, r.stopped.grey, `stopped is grey, never red: ${J('stopped')}`);
  assert.equal(r.runningSched.border, r.runningSched.amber, `am14: running takes its card colour (amber): ${J('runningSched')}`);
  assert.equal(r.waiting.border, r.waiting.grey, `am14: waiting takes its card colour (grey): ${J('waiting')}`);
  assert.equal(r.expired.border, r.expired.amber, `am14: [!] expired is amber like its card: ${J('expired')}`);
  assert.equal(r.stuck.border, r.stuck.amber, `am14: [II] stuck is amber like its card: ${J('stuck')}`);
  assert.deepEqual(r.runningSched.labels, ['SCHEDULE', ''], 'a running run still shows SCHEDULE');
  assert.equal(r.failedProblem.border, r.failedProblem.red, 'a schedule problem is a red frame');
  assert.equal(r.failedProblem.schedRed, true, 'problem: label and both lines red');
  assert.equal(r.failedHealthy.schedAnyRed, false, 'a failed run with a fine schedule: SCHEDULE is not red');
  for (const k of Object.keys(CASES)) assert.equal(r[k].endedRed, false, `ENDED/NEXT never red: ${J(k)}`);
});

for (const width of [1280, 390, 320]) {
  test(`am13 at ${width}: no sideways spill, screenshots`, async (t) => {
    const chrome = await world(t, width);
    if (!chrome) return;
    for (const [name, key] of [['failed', 'failedProblem'], ['passed', 'passedHealthy']]) {
      const r = await paint(chrome, CASES[key], key);
      assert.ok(r.spill <= 0, `sideways scroll ${r.spill}px at ${width}`);
      if (SHOTS && (width !== 390 || name === 'failed') && (width !== 320)) {
        mkdirSync(SHOTS, { recursive: true });
        await chrome.screenshot(path.join(SHOTS, `am13-${name}-${width}.png`));
      }
    }
  });
}
