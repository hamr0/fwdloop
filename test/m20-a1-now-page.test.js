// M20 am1 item 8 in a real headless browser on the real panel, $0 (gated fake model step, a real `fwdloop run` child): the NOW row "AI working · M:SS" is the first row
// of the box while a try runs, the box shows while NOW shows, and it is gone once the run ends. 1280, 390 and 320 wide: no horizontal scroll, no element spills.
// Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { writeFileSync } from 'node:fs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { GATED_STEP, killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const SPILL = `(function(){ var vw = document.documentElement.clientWidth, bad = [];
  document.querySelectorAll('#ended-block, #ended-block *').forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width > 0 && (r.right > vw + 1 || r.left < -1)) bad.push(e.className + ':' + Math.round(r.right)); });
  return JSON.stringify({ doc: document.documentElement.scrollWidth <= vw, bad: bad }); })()`;

test('browser: the NOW row shows while a try runs, first in the box, and goes when the run parks; 1280 / 390 / 320 wide', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world({ step: GATED_STEP });
  await w.signedFlow();
  const start = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r1' })).json();
  await until(async () => { const j = (await w.get(`/api/author/start/${start.startId}`)).json(); return j?.phase === 'started' && j.state === 'working' ? j : null; });
  await until(async () => /^AI working · \d+:\d\d$/.test((await w.get('/api/runs/job2/r1')).json().summary?.now ?? ''));
  for (const width of [1280, 390, 320]) {
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    // open the run by the Runs tab, then its card
    await chrome.ev('(function(){ var c = Array.from(document.querySelectorAll("button, a, [role=tab]")).find(function(x){ return /Runs/.test(x.textContent) && x.textContent.length < 12; }); if(c) c.click(); })()');
    await chrome.waitFor('Array.from(document.querySelectorAll("button")).some(function(x){ return /r1/.test(x.textContent); })', 10000);
    await chrome.ev('(function(){ var c = Array.from(document.querySelectorAll("button")).find(function(x){ return /r1/.test(x.textContent); }); if(c) c.click(); })()');
    assert.ok(await chrome.waitFor('(function(){ var b = document.getElementById("ended-block"); return !!b && !b.hidden && !!b.querySelector("[data-testid=now-row]"); })()', 15000), `NOW row at ${width}`);
    assert.match(await chrome.ev('document.querySelector("[data-testid=now-row]").textContent'), /^AI working · \d+:\d\d$/);
    assert.equal(await chrome.ev('document.getElementById("ended-block").querySelector(".ended-row .ended-label").textContent'), 'NOW', 'the first row');
    assert.equal(await chrome.ev('document.getElementById("ended-block").querySelector("[data-testid=ended-reason]") === null'), true, 'no ENDED while live');
    assert.deepEqual(JSON.parse(await chrome.ev(SPILL)), { doc: true, bad: [] }, `no spill at ${width}`);
  }
  writeFileSync(w.gate, 'go');
  await until(async () => (await w.get('/api/runs/job2/r1')).json().summary?.now === null);
  assert.ok(await chrome.waitFor('(function(){ var b = document.getElementById("ended-block"); return !b || b.hidden || !b.querySelector("[data-testid=now-row]"); })()', 15000), 'NOW gone after the try ends');
});
