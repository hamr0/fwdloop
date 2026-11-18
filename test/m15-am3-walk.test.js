// M15 am3 items 1 and 7: the Result tab's Saved row with a report saved under a new name, at 1280, 390 and 320 px, in a real headless browser on the real panel. The top card's Saved row opens the
// file and says `saved under a new name because <taken name> was already taken`; the Saved card at the bottom says it too; nothing spills past the right edge.
// Set FWDLOOP_WALK_OUT=<dir> to save one screenshot per width. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world } from './m10-am4-world.mjs';
import { SEND_DIR } from './send-sandbox.js';

const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));

const MEASURE = `(function(){
  var vw = document.documentElement.clientWidth;
  var body = document.getElementById("result-body");
  var worst = 0, over = [];
  body.querySelectorAll("*").forEach(function(e){
    var r = e.getBoundingClientRect();
    if(r.width === 0 && r.height === 0) return;
    if(r.right - vw > worst) worst = r.right - vw;
    if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right));
  });
  var q = function(id){ var e = document.querySelector('#result-body [data-testid=' + id + ']'); return e ? e.textContent : null; };
  var a = document.querySelector('#result-body [data-testid=result-file-top] a');
  return { vw: vw, docW: document.documentElement.scrollWidth, worst: Math.round(worst), over: over.slice(0, 8), topNote: q("result-file-top-note"), cardNote: q("result-file-note"), link: a ? a.textContent : null, href: a ? a.getAttribute("href") : null };
})()`;

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: a report saved under a new name says why, in the Saved row and the Saved card`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await world({ taken: true });
    const files = readdirSync(SEND_DIR);
    assert.equal(files.length, 2, `the taken file and the report: ${files}`);
    const second = files.find((f) => /-2\.md$/.test(f));
    const first = files.find((f) => f !== second);
    assert.match(second, /^job2-\d{4}-\d{2}-\d{2}-2\.md$/);
    await chrome.open(`http://127.0.0.1:${w.port}/`, width);
    const card = 'document.querySelector("[data-testid=rl-run-job2-run-1]")';
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the run opened');
    await chrome.ev('document.getElementById("tab-result").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("#result-body [data-testid=result-file-top-note]")'), 'the Saved row drew its note');
    const m = await chrome.ev(MEASURE);
    console.log(`# am3 walk ${width}px ${JSON.stringify(m)}`);
    await chrome.ev('document.querySelector("#result-body [data-testid=result-file-top]").scrollIntoView({block: "center"})');
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `am3-saved-${width}.png`)); }
    const want = `saved under a new name because ${first} was already taken`;
    assert.equal(m.topNote, want);
    assert.equal(m.cardNote, want);
    assert.equal(m.link, second, 'the saved-file link is the file that was written');
    assert.match(m.href, /\/download\?i=0&view=1$/);
    assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
    assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
  });
}
