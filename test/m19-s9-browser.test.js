// M19 S9 in a real headless browser, on the real panel, at 1280 and 390 px: a [you] shape row has a Drop; after it the rule reads "You dropped it." under NOT CHECKED with an "Add back" button; Add back puts the row back with its Drop.
// No box spills, element ids stay unique. A shape plan on the real route, $0 (test/m19-s9-world.mjs). Set FWDLOOP_WALK_OUT=<dir> for one screenshot per width. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { shapePlan } from './m19-s9-world.mjs';

killChildrenAfter();
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = /** @type {(() => Promise<any>)[]} */ ([]);
after(() => Promise.all(CLOSERS.map((c) => c())));
const measure = (/** @type {string} */ rootSel) => `(function(){
  var vw = document.documentElement.clientWidth;
  var root = document.querySelector(${JSON.stringify(rootSel)});
  var worst = 0, over = [], boxes = 0;
  root.querySelectorAll("*").forEach(function(e){
    var r = e.getBoundingClientRect();
    if(r.width === 0 && r.height === 0) return;
    boxes++;
    if(r.right - vw > worst) worst = r.right - vw;
    if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + "#" + e.id + " right=" + Math.round(r.right));
  });
  return { vw: vw, docW: document.documentElement.scrollWidth, boxes: boxes, worst: Math.round(worst), over: over.slice(0, 8) };
})()`;
const fits = (/** @type {any} */ m) => {
  assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
  assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
};
const IDS = 'Array.from(document.querySelectorAll("[id]")).map(function(e){return e.id;}).filter(function(id,i,a){return a.indexOf(id)!==i;})';
const BTN = (/** @type {string} */ op) => `document.querySelector('#chat-plan button[data-rowop=${op}][data-rowkey="L3.~2"]')`;
const NC = 'Array.from(document.querySelectorAll("#chat-plan [data-testid=plan-refused]")).map(function(d){ return d.textContent.replace(/\\s+/g, " ").trim(); })';

for (const width of [1280, 390]) {
  test(`browser ${width}px: Drop a [you] shape row, "You dropped it." with Add back, then Add back puts it back`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const snap = async (/** @type {string} */ name) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `m19-s9-${name}-${width}.png`)); } };
    const { w, g, deny, calls } = await shapePlan();
    assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
    deny();
    const calls0 = calls();
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor(`!!${BTN('drop')}`), 'the [you] shape row has a Drop button');
    assert.equal(await chrome.ev(`!!${BTN('add')}`), false);
    assert.deepEqual(await chrome.ev(IDS), [], 'element ids are unique');
    await chrome.ev('document.getElementById("chat-extras").scrollIntoView()');
    let m = await chrome.ev(measure('#chat-extras'));
    console.log(`# walk m19-s9 card ${width}px ${JSON.stringify(m)}`);
    await snap('card');
    fits(m);
    // Drop: the rule is Not checked, "You dropped it.", with an Add back button
    await chrome.ev(`${BTN('drop')}.click()`);
    assert.ok(await chrome.waitFor(`!!${BTN('add')} && !${BTN('drop')}`), 'the dropped rule has an Add back button and no Drop');
    assert.equal(await chrome.ev(`${BTN('add')}.textContent.trim()`), 'Add back');
    const nc = await chrome.ev(NC);
    const dropped = nc.filter((/** @type {string} */ x) => /status is one of in progress, closed, finished/.test(x));
    assert.equal(dropped.length, 1, JSON.stringify(nc));
    assert.match(dropped[0], /You dropped it\./);
    assert.match(dropped[0], /Add back$/);
    assert.equal(await chrome.ev('document.querySelectorAll("#chat-plan button[data-rowop=add]").length'), 2, 'Add back, and the Suggested field\'s Add: no other button');
    assert.deepEqual(await chrome.ev(IDS), []);
    m = await chrome.ev(measure('#chat-extras'));
    console.log(`# walk m19-s9 after-drop ${width}px ${JSON.stringify(m)}`);
    await snap('after-drop');
    fits(m);
    // Add back: the row is Checked again with its Drop, the Not checked row is gone
    await chrome.ev(`${BTN('add')}.click()`);
    assert.ok(await chrome.waitFor(`!!${BTN('drop')} && !${BTN('add')}`), 'Add back put the row back with its Drop');
    assert.ok(!(await chrome.ev(NC)).some((/** @type {string} */ x) => /status is one of in progress, closed, finished/.test(x)), 'the Not checked row is gone');
    m = await chrome.ev(measure('#chat-extras'));
    console.log(`# walk m19-s9 after-add-back ${width}px ${JSON.stringify(m)}`);
    await snap('after-add-back');
    fits(m);
    assert.deepEqual(await chrome.ev(IDS), []);
    assert.equal(calls(), calls0, 'no provider call');
  });
}
