// The ask of a step that checks quotes from a page (a cited close) shows its evidence: the cited results (each with its quote and values), then the unjudged
// evidence below (bug seen live 2026-10-24: "ask.json "evidence" has neither .artifact.text nor .text - unrecognised shape: keys [artifact, unjudged]").
// The fixture is a scrubbed copy of a real run (flights-learn-1, parked at its ask; paths and the signer's name scrubbed). $0: no model, no network.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
const FIX = path.join(HERE, 'fixtures', 'm10-ask-cited-run', 'flow');
const CAT = loadCatalogue().primitives;
const DIRS = [];
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });
const FLOW = 'flights-learn-1';

function rootOf() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-ask-cited-'));
  DIRS.push(base);
  const root = path.join(base, 'flows');
  mkdirSync(root);
  cpSync(FIX, path.join(root, FLOW), { recursive: true });
  return { base, root };
}
const ASK = JSON.parse(readFileSync(path.join(FIX, 'runs', 'run-1', 'ask.json'), 'utf8'));

test('readAskEvidence: the cited results of the step are handed on, the unjudged cells too, and there is no unrecognised-shape line', () => {
  const e = readAskEvidence(ASK);
  assert.equal(e.why, undefined);
  assert.equal(e.draft, null);
  assert.equal(e.results.length, 3);
  assert.deepEqual(e.results.map((r) => r.values.price), ['39', '48', '63']);
  assert.equal(e.unjudged.length, 1);
  assert.equal(e.unjudged[0].emits, 'page_read');
  assert.match(e.unjudged[0].cells.summary, /^Google Flights page read successfully/);
});

test('readAskEvidence: the old M2 and M3 text shapes still read, and an unknown shape still names its keys', () => {
  assert.equal(readAskEvidence({ evidence: { artifact: { text: 'the draft' }, unjudged: [{ step: 's', artifact: { text: 'u' } }] } }).draft.text, 'the draft');
  assert.equal(readAskEvidence({ evidence: { text: 'old' } }).draft.text, 'old');
  const u = readAskEvidence({ evidence: { somethingElse: 1 } });
  assert.match(u.why, /unrecognised shape: keys \["somethingElse"\]/);
  assert.equal(u.results, undefined);
  // an artifact whose "results" is not a list of {quote, values} is not the cited shape
  assert.match(readAskEvidence({ evidence: { artifact: { results: 'x' } } }).why, /unrecognised shape/);
});

test('getRunAsks: the ask carries the Result tab\'s line for the cited results (3 rows, proof from the run\'s record), the unjudged cells, and no error line', () => {
  const { root } = rootOf();
  const ev = getRunAsks({ root, flow: FLOW, runId: 'run-1', catalogue: CAT }).asks[0].evidence;
  assert.equal(ev.why, undefined);
  assert.equal(ev.cited.rows.length, 3);
  assert.deepEqual(ev.cited.facts.map((f) => f.name), ['origin', 'price', 'stops']);
  assert.deepEqual(ev.cited.rows.map((r) => r.cells[1]), ['39 US dollars', '48 US dollars', '63 US dollars']);
  assert.ok(ev.cited.rows[0].proof.marks.length > 0, 'the proof marks come from the record');
  assert.equal(ev.unjudged.length, 1);
  assert.ok(ev.unjudged[0].cells.summary);
});

test('getRunAsks: with no cited record the results still show (quote and values), never an error line', () => {
  const { root } = rootOf();
  rmSync(path.join(root, FLOW, 'runs', 'run-1', 'line-checks.json'));
  const ev = getRunAsks({ root, flow: FLOW, runId: 'run-1', catalogue: CAT }).asks[0].evidence;
  assert.equal(ev.why, undefined);
  assert.equal(ev.cited.rows.length, 3);
  assert.deepEqual(ev.cited.facts.map((f) => f.name), ['price']);
  assert.deepEqual(ev.cited.rows.map((r) => r.cells), [['39'], ['48'], ['63']]);
  assert.equal(ev.cited.rows[0].proof, undefined);
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
  test(`browser ${width}px: the ask card shows the 3 flights and the unjudged step, no error line, nothing spills`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { base, root } = rootOf();
    const h = remember(await createPanelServer({ port: 0, root, settings: { home: path.join(base, 'cfg'), env: {} } }));
    CLOSERS.push(async () => h.close());
    await chrome.send('Page.enable');
    await chrome.open(`http://127.0.0.1:${h.port}/`, width);
    const card = `document.querySelector("[data-testid=rl-run-${FLOW}-run-1]")`;
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the run opened');
    await chrome.ev('document.getElementById("tab-ask").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll("#ask-list [data-testid=result-row]").length === 3'), 'the ask card drew the 3 results');
    const text = await chrome.ev('document.getElementById("ask-list").textContent');
    assert.equal(text.includes('unrecognised shape'), false, 'no error line');
    assert.ok(text.includes('39 US dollars') && text.includes('48 US dollars') && text.includes('63 US dollars'));
    assert.ok(text.includes('unjudged — step: page_read'), 'the unjudged step shows below');
    assert.ok(text.includes('Google Flights page read successfully'), 'its cells show');
    assert.equal(await chrome.ev(`(function(){ var r = document.querySelector("#ask-list [data-testid=result-row]"), u = Array.from(document.querySelectorAll("#ask-list .evidence-heading")).filter(function(e){ return e.textContent.indexOf("unjudged") === 0; })[0];
      return !!(r.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), true, 'the results come before the unjudged evidence');
    const ids = await chrome.ev('Array.from(document.querySelectorAll("[id]")).map(function(e){ return e.id; })');
    assert.equal(new Set(ids).size, ids.length, 'every id on the page is unique');
    const m = await chrome.ev(MEASURE('#ask-list'));
    console.log(`# ask-cited ${width}px ${JSON.stringify(m)}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      await chrome.ev('document.querySelector("#ask-list [data-testid=result-row]").scrollIntoView()');
      await chrome.screenshot(path.join(OUT, `ask-cited-${width}.png`));
    }
    assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
    assert.deepEqual(m.over, [], `ask card boxes past the right edge: worst ${m.worst}px`);
  });
}
