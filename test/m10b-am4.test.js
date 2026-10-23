// M10b amendment 4 (docs/wiki/the-module-ladder.md): the ask card of a step that has sheet checks shows the same lines as the Result tab (each check with its mark and what was
// found, its words and covers, then Not checked) and the step's answer value by value, above the Reason box, where the error line was. The fixture is a copy of a real
// run (test/fixtures/m10b-am4-run: the m10b-aging job parked at its ask). $0: no model, no network.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { readAskEvidence } from '../src/ask.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getRunAsks } from '../src/panel/data.js';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm10b-am4-run', 'flow');
const CAT = loadCatalogue().primitives;
const DIRS = [];
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });

/** a root holding the fixture flow as `m10b-aging` */
function rootOf() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10b-am4-'));
  DIRS.push(base);
  const root = path.join(base, 'flows');
  mkdirSync(root);
  cpSync(FIX, path.join(root, 'm10b-aging'), { recursive: true });
  return { base, root };
}
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v));
const ASK = JSON.parse(readFileSync(path.join(FIX, 'runs', 'run-1', 'ask.json'), 'utf8'));
const ROWS = { 2: 124, 3: 144, 4: 152, 5: 180, 6: 119, 7: 194, 8: 244, 9: 109 };
const ANSWER = ['invoiceCount: 8', ...Object.entries(ROWS).map(([r, d]) => `daysPastDue: row ${r} → ${d}`)];

test('readAskEvidence: the claim boxes of a sheet step are handed on (claims), the earlier steps\' text is still read, the old why stays for a shape no sheet explains', () => {
  const e = readAskEvidence(ASK);
  assert.deepEqual(e.claims, ASK.evidence.artifact);
  assert.equal(e.draft, null);
  assert.equal(e.unjudged.length, 1);
  assert.equal(e.unjudged[0].emits, 'aging_report');
  assert.match(e.unjudged[0].text, /^Aging report read: 8 open invoices/);
  assert.match(e.why, /unrecognised shape/);
  assert.equal(readAskEvidence({ evidence: { somethingElse: 1 } }).claims, undefined, 'a shape with no artifact carries no claims');
  assert.equal(readAskEvidence({ evidence: { artifact: { text: 'x' } } }).claims, undefined, 'the M3 text shape carries no claims');
});

test('getRunAsks: the ask of a sheet step carries the Result tab\'s block (marks, found, words, covers, Not checked) and the answer value by value; no error line', () => {
  const { root } = rootOf();
  const got = getRunAsks({ root, flow: 'm10b-aging', runId: 'run-1', catalogue: CAT });
  const ev = got.asks[0].evidence;
  assert.equal(ev.why, undefined, 'the error line is gone');
  assert.equal(ev.unjudged.length, 1, 'the earlier step text is carried as before');
  assert.equal(ev.sheet.block.line, 2);
  assert.deepEqual(ev.sheet.block.checked.map((c) => [c.ok, c.found]), [[true, 'count checked — 8'], [true, 'date checked — 8 rows']]);
  assert.deepEqual(ev.sheet.block.checked.map((c) => c.coversWords), ['covers "every invoice appears exactly once"', 'covers "days past due = days since \'Due date\' as of 2026-10-11" · covers "days past due = days since \'Due date\' as of 2026-10-11"']);
  assert.equal(ev.sheet.block.notChecked, 'none');
  assert.deepEqual(ev.sheet.answer, ANSWER);
});

test('getRunAsks: claims that match no sheet step keep the old why (never a guess)', () => {
  const { root } = rootOf();
  const file = path.join(root, 'm10b-aging', 'runs', 'run-1');
  for (const f of ['ask.json', path.join('asks', `${ASK.askId}.json`)]) {
    const p = path.join(file, f);
    const a = JSON.parse(readFileSync(p, 'utf8'));
    a.evidence.artifact = { somethingNew: { value: 1 } };
    writeJson(p, a);
  }
  const ev = getRunAsks({ root, flow: 'm10b-aging', runId: 'run-1', catalogue: CAT }).asks[0].evidence;
  assert.equal(ev.sheet, undefined);
  assert.match(ev.why, /unrecognised shape/);
});

// ---- the page, in a real browser at 1280, 390 and 320 ---------------------------------------------------------------------------------------------
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const MEASURE = (rootSel) => `(function(){
  var vw = document.documentElement.clientWidth, worst = 0, over = [], boxes = 0;
  document.querySelectorAll(${JSON.stringify(rootSel)}).forEach(function(r){ r.querySelectorAll("*").forEach(function(e){
    var b = e.getBoundingClientRect();
    if(b.width === 0 && b.height === 0) return;
    boxes++;
    if(b.right - vw > worst) worst = b.right - vw;
    if(b.right > vw + 0.5 || b.left < -0.5) over.push(e.tagName + "." + e.className + " right=" + Math.round(b.right));
  }); });
  return { vw: vw, docW: document.documentElement.scrollWidth, boxes: boxes, worst: Math.round(worst), over: over.slice(0, 8) };
})()`;

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the ask card shows the sheet lines and the answer values, no error line, nothing spills`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { base, root } = rootOf();
    const h = remember(await createPanelServer({ port: 0, root, settings: { home: path.join(base, 'cfg'), env: {} } }));
    CLOSERS.push(async () => h.close());
    await chrome.send('Page.enable');
    await chrome.open(`http://127.0.0.1:${h.port}/`, width);
    const card = 'document.querySelector("[data-testid=rl-run-m10b-aging-run-1]")';
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the run opened');
    await chrome.ev('document.getElementById("tab-ask").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll("#ask-list [data-testid=result-sheet-check]").length === 2'), 'the ask card drew the two sheet checks');
    const text = await chrome.ev('document.getElementById("ask-list").textContent');
    assert.equal(text.includes('unrecognised shape'), false, 'no error line');
    const checks = await chrome.ev('Array.from(document.querySelectorAll("#ask-list [data-testid=result-sheet-check]")).map(function(e){ return e.textContent; })');
    assert.ok(checks[0].startsWith('✓ count checked — 8'), checks[0]);
    assert.ok(checks[0].includes('covers "every invoice appears exactly once"'));
    assert.ok(checks[1].startsWith('✓ date checked — 8 rows'), checks[1]);
    assert.equal(await chrome.ev('document.querySelector("#ask-list [data-testid=result-sheet-notchecked]").textContent'), 'none');
    assert.deepEqual(await chrome.ev('Array.from(document.querySelectorAll("#ask-list [data-testid=ask-sheet-answer]")).map(function(e){ return e.textContent; })'), ANSWER);
    assert.ok(text.includes('unjudged — step: aging_report'), 'the earlier step text still shows');
    // above the Reason box
    assert.equal(await chrome.ev(`(function(){ var a = document.querySelector("#ask-list [data-testid=ask-sheet-answer]"), r = document.querySelector("#ask-list textarea, #ask-list input[type=text]");
      return !r || !!(a.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), true, 'the lines come before the Reason box');
    const ids = await chrome.ev('Array.from(document.querySelectorAll("[id]")).map(function(e){ return e.id; })');
    assert.equal(new Set(ids).size, ids.length, 'every id on the page is unique');
    const m = await chrome.ev(MEASURE('#ask-list'));
    console.log(`# am4 ${width}px ${JSON.stringify(m)}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      await chrome.ev('document.querySelector("#ask-list [data-testid=result-sheet-check]").scrollIntoView()');
      await chrome.screenshot(path.join(OUT, `ask-card-${width}.png`));
    }
    assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
    assert.deepEqual(m.over, [], `ask card boxes past the right edge: worst ${m.worst}px`);
  });
}
