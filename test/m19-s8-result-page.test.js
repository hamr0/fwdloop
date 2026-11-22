// M19 S8 (section 3.7, the signed mock A2): the Result tab draws a shape line as a fold in the real page, in headless chromium at 1280, 390 and 320. $0: job2 run for real in process (test/m10-am4-world.mjs); the page's /result
// answers the real body with its lines swapped for shape lines (a 7-field line with one failed item, a 2-field line), so only the drawing is tested; the server side is test/m19-s8-result.test.js.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world } from './m10-am4-world.mjs';
import { buildShapePart } from '../src/shaperows.js';
import { shapeResultModel } from '../src/shaperesult.js';

const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

const fields = (n) => Array.from({ length: n }, (_v, k) => ({ name: k === 0 ? 'title' : `field_number_${k}`, spec: k === 0 ? { kind: 'text', required: true, minChars: 1 } : { kind: 'text', maxChars: 9 }, rule: 1, by: 'you' }));
const model = (n) => {
  const f = fields(n);
  const ok = Object.fromEntries(f.map((x) => [x.name, 'abc']));
  ok.title = 'A rather long title that goes on and on well past forty characters of text';
  const bad = { ...ok, title: 'Second', field_number_1: 'x'.repeat(30) };
  return shapeResultModel({ part: buildShapePart({ text: 't', fields: f }), results: [ok, bad], reds: ['#1:field_number_1:too-long:chars:30>9'], rules: ['each field is under 10 characters'] });
};
const SHAPE_LINES = [
  { n: 1, text: 'List the items', rules: [], kind: 'shape', passed: false, shape: model(7), notChecked: ['whether each one is true — you judge it at Accept'] },
  { n: 2, text: 'List more', rules: [], kind: 'shape', passed: false, shape: model(2), notChecked: [] },
];

async function open(w, width, lines) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){ var f = window.fetch; var lines = ${JSON.stringify(lines)};
      window.fetch = function(u){ var s = String(u);
        if(/\\/api\\/runs\\/[^/]+\\/[^/]+\\/result$/.test(s)) return f.apply(this, arguments).then(function(r){ return r.json().then(function(d){ d.lines = lines; return new Response(JSON.stringify(d), {status: 200, headers: {"content-type": "application/json"}}); }); });
        return f.apply(this, arguments); }; })()`,
  });
  await chrome.open(`http://127.0.0.1:${w.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the page opened the newest run');
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=result-shape]").length > 0'), 'the Result tab drew the shape card');
  return chrome;
}

for (const width of [1280, 390, 320]) {
  test(`browser ${width}: a shape line is a fold: the row words, the stats line, a failed item open and tinted with its red reason, no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const w = await world();
    const chrome = await open(w, width, SHAPE_LINES);
    if (!chrome) { t.skip('no chromium installed'); return; }
    const first = 'document.querySelectorAll("[data-testid=result-shape]")[0]';
    assert.equal(await chrome.ev('document.querySelectorAll("[data-testid=result-shape]").length'), 2, 'one card per shape line');
    assert.equal(await chrome.ev(`${first}.querySelector("h4").textContent`), 'Result · line 1', 'two lines: the heading names the line');
    assert.equal(await chrome.ev(`${first}.querySelector("[data-testid=shape-stats]").textContent`), 'job2 · run-1 · 2 items · 1 passed · 1 failed');
    // item 1: folded, `1 · title…  ✓ 7 of 7  ▸`
    const row = (i) => `${first}.querySelectorAll("[data-testid=shape-item]")[${i}]`;
    assert.equal(await chrome.ev(`${row(0)}.open`), false, 'a passing item starts folded');
    assert.equal(await chrome.ev(`${row(0)}.querySelector("[data-testid=shape-name]").textContent`), `1 · ${'A rather long title that goes on and on well'.slice(0, 39)}…`);
    assert.equal(await chrome.ev(`${row(0)}.querySelector("[data-testid=shape-count]").textContent`), '✓ 7 of 7');
    assert.equal(await chrome.ev(`getComputedStyle(${row(0)}.querySelector(".sf-ar"), "::before").content`), '"▸"');
    // item 2: open, tinted, the failing field with the red reason
    assert.equal(await chrome.ev(`${row(1)}.open`), true, 'a failed item starts open');
    assert.equal(await chrome.ev(`${row(1)}.querySelector("[data-testid=shape-count]").textContent`), '✓ 6 of 7'.replace('✓', '✗'));
    assert.notEqual(await chrome.ev(`getComputedStyle(${row(1)}.querySelector("summary")).backgroundColor`), 'rgba(0, 0, 0, 0)', 'the failed row is tinted');
    assert.equal(await chrome.ev(`getComputedStyle(${row(0)}.querySelector("summary")).backgroundColor`), 'rgba(0, 0, 0, 0)');
    assert.equal(await chrome.ev(`${row(1)}.querySelectorAll("[data-testid=shape-field]").length`), 7, 'one line per field');
    assert.equal(await chrome.ev(`${row(1)}.querySelector("[data-result=failed] .why").textContent`), '· is too long (30 characters, under 10)');
    assert.equal(await chrome.ev(`${row(1)}.querySelectorAll("[data-result=failed]").length`), 1);
    // opening the folded item shows its seven fields
    await chrome.ev(`${row(0)}.open = true`);
    assert.equal(await chrome.ev(`${row(0)}.querySelectorAll("[data-testid=shape-field]").length`), 7);
    // the Not checked line of the line that has one
    assert.equal(await chrome.ev(`${first}.querySelector("[data-testid=result-line-notchecked]").textContent`), 'whether each one is true — you judge it at Accept');
    // no spill: the page, the result body, every card, every fold box and every row
    assert.equal(await chrome.ev('document.documentElement.scrollWidth <= window.innerWidth'), true, 'no horizontal page scroll');
    assert.equal(await chrome.ev('Array.from(document.querySelectorAll("#result-body, #result-body .job-card, #result-body .sf-list, #result-body .sf-item, #result-body .sf-item > summary, #result-body .sf-fl")).filter(function(e){ return e.scrollWidth > e.clientWidth + 1; }).length'), 0, 'no box spills');
    assert.equal(await chrome.ev('Array.from(document.querySelectorAll("[id]")).map(function(e){ return e.id; }).filter(function(id, i, a){ return a.indexOf(id) !== i; }).length'), 0, 'element ids stay unique');
  });
}

test('browser: one shape line only: the heading is `Result`; a line with no readable answer says "no saved result to show" and draws no fold', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world();
  const chrome = await open(w, 1280, [{ ...SHAPE_LINES[1], shape: null }]);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.equal(await chrome.ev('document.querySelector("[data-testid=result-shape] h4").textContent'), 'Result');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=result-shape] [data-testid=result-nofile]").textContent'), 'no saved result to show');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=shape-fold]")'), null);
  assert.equal(await chrome.ev('document.querySelector("[data-testid=shape-stats]")'), null);
});
