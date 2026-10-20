// M10 amendment 4 item 8: the Result tab at 1280, 600, 390 and 320 px, in a real headless browser, on the real panel. bareloop never checked it on a phone.
// For each width: the document is not wider than the screen, and no box in the tab spills past the right edge of the screen (per-box numbers are printed).
// Set FWDLOOP_WALK_OUT=<dir> to also save one screenshot per width there. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world } from './m10-am4-world.mjs';
import { CITED_CHECKS_FILE } from '../src/panel/result.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm10-result', 'result-mvfphtwl.json'), 'utf8'));
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));

/** a finished run with the page's long address and the golden's three results on line 3 (the record's writer is not built; the reader takes this file) */
async function walkWorld() {
  const url = GOLDEN.pages[0];
  const w = await world({ prose: (p) => p.replace(/guardrail: source jd = file:\S+/, `guardrail: source jd = page:${url}`) });
  const rec = { lines: GOLDEN.lines.map((l) => ({ n: 3, source: 'jd', passed: true, facts: l.facts.map((f, i) => ({ ...f, ...(i === 0 ? { confirmed: true } : {}) })), rows: l.rows, notChecked: ['a long reading with a longunbrokenwordthatcouldpushabox'.repeat(3)] })) };
  writeFileSync(path.join(w.runDir, CITED_CHECKS_FILE), JSON.stringify(rec));
  return w;
}

const MEASURE = `(function(){
  var vw = document.documentElement.clientWidth;
  var body = document.getElementById("result-body");
  body.querySelectorAll("details").forEach(function(d){ d.open = true; });
  var worst = 0, over = [], boxes = 0;
  body.querySelectorAll("*").forEach(function(e){
    var r = e.getBoundingClientRect();
    if(r.width === 0 && r.height === 0) return;
    boxes++;
    if(r.right - vw > worst) worst = r.right - vw;
    if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right));
    if(e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible") over.push("inner-scroll " + e.tagName + "." + e.className);
  });
  var tabs = document.querySelector(".rp-tabrow"); var tr = tabs.getBoundingClientRect();
  return { vw: vw, docW: document.documentElement.scrollWidth, boxes: boxes, worst: Math.round(worst), over: over.slice(0, 8),
           tabRowRight: Math.round(tr.right), tabsScroll: tabs.scrollWidth - tabs.clientWidth, resultTab: !document.getElementById("tab-result").hidden };
})()`;

for (const width of [1280, 600, 390, 320]) {
  test(`browser ${width}px: the Result tab spills nothing past the right edge`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await walkWorld();
    await chrome.open(`http://127.0.0.1:${w.port}/`, width);
    const card = 'document.querySelector("[data-testid=rl-run-job2-run-1]")';
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the run opened');
    await chrome.ev('document.getElementById("tab-result").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll("#result-body [data-testid=result-row]").length === 3'), 'the Result tab drew its three results');
    assert.ok(await chrome.waitFor('!!document.querySelector("#result-body [data-testid=result-download]")'), 'and the Saved card');
    const m = await chrome.ev(MEASURE);
    console.log(`# walk ${width}px ${JSON.stringify(m)}`);
    await chrome.ev('document.querySelector("#result-body").scrollIntoView(); document.querySelector("#result-body [data-testid=result-results]").scrollIntoView()');
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `result-${width}.png`)); }
    assert.equal(m.resultTab, true);
    assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
    assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
    assert.ok(m.worst <= 0, `worst right edge is ${m.worst}px past the screen`);
  });
}
