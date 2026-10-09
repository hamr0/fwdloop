// am31: the step map wraps like text. Boxes keep their two lines (name, then status); arrows sit between boxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PAGE = fs.readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

function load() {
  const body = PAGE.slice(PAGE.indexOf('function escapeXml'), PAGE.indexOf('function wireMapClicks'));
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { draftBox, buildStepBoxes, buildStepMapHTML, markLineStarts, stateWord };`)();
}

const NAMES = ['scout', 'plan', 'doc-checks', 'doc-email', 'doc-sink', 'doc-run', 'doc-audit-sweep'];
function boxes(f) {
  const raw = NAMES.map((n) => ({ emits: n, goal: 'g', closeClass: 'green', attempts: [{ verdict: 'green' }], tryCount: 1 }));
  raw[5].tryCount = 2; raw[5].attempts = [{ verdict: 'red' }, { verdict: 'green' }];
  const st = f.buildStepBoxes(raw);
  st.forEach((b, i) => { b.state = i < 6 ? 'done' : 'stopped'; b.n = i + 1; });
  return st;
}
const text = (html, cls) => [...html.matchAll(new RegExp(`<span class="${cls}">([^<]*)</span>`, 'g'))].map((m) => m[1]);

test('am31: each box keeps its two lines exactly as before (name from stepTitleText, then the status word); a name is never cut', () => {
  const f = load();
  const html = f.buildStepMapHTML([f.draftBox({ present: true })].concat(boxes(f)));
  // captured from the SVG renderer before the change (wide layout, nothing cut)
  assert.deepEqual(text(html, 'chip-name'), ['drafting', '1 scout', '2 plan', '3 doc-checks', '4 doc-email', '5 doc-sink', '6 doc-run — try 2', '7 doc-audit-sweep']);
  assert.deepEqual(text(html, 'chip-state'), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'stopped'].map((s) => f.stateWord(s)));
  assert.doesNotMatch(html, /…/, 'no ellipsis cut');
  assert.match(f.buildStepMapHTML([f.draftBox({ present: false })]), /no draft record/);
});

test('am31: an arrow after every box but the last (stuck to its box); a lead arrow on every box but the first; none alone', () => {
  const f = load();
  const html = f.buildStepMapHTML(boxes(f));
  const items = html.split('<span class="map-item"').slice(1);
  assert.equal(items.length, 7);
  assert.equal((html.match(/class="map-arrow"/g) || []).length, 6, 'between 7 boxes: 6 arrows');
  assert.equal((html.match(/class="map-lead"/g) || []).length, 6, 'lead arrows for wrapped line starts: all but the first box');
  assert.doesNotMatch(items[6], /map-arrow/, 'the last box has no arrow after it');
  assert.doesNotMatch(items[0], /map-lead/, 'the first box has no lead arrow');
  assert.match(items[0], /map-arrow/);
  assert.doesNotMatch(html, /<svg|<line /, 'no SVG left');
});

test('am31: the retry mark is kept on a retried box and only there', () => {
  const f = load();
  const html = f.buildStepMapHTML(boxes(f));
  assert.equal((html.match(/data-retry="/g) || []).length, 1);
  assert.match(html, /data-retry="2"/);
  // today's mark is the label "try N" under the box (kept as is; bareloop's dashed border + ↻N is NOT adopted)
  assert.deepEqual(text(html, 'chip-retry'), ['try 2']);
  assert.doesNotMatch(html, /↻/);
});

test('am31: markLineStarts adds line-start to a box whose offsetTop is below the previous box, removes it otherwise', () => {
  const f = load();
  const mk = (top, cls = []) => { const s = new Set(cls); return { offsetTop: top, classList: { add: (c) => s.add(c), remove: (c) => s.delete(c), has: (c) => s.has(c) } }; };
  const items = [mk(0), mk(0), mk(0), mk(30), mk(30), mk(60, ['line-start']), mk(60, ['line-start'])];
  f.markLineStarts(items);
  assert.deepEqual(items.map((i) => i.classList.has('line-start')), [false, false, false, true, false, true, false]);
  const one = [mk(5, ['line-start'])];
  f.markLineStarts(one);
  assert.equal(one[0].classList.has('line-start'), false, 'the first box never starts a wrapped line');
});

test('am31: the page has the chip CSS, no sideways scroll on the map box, and the borrowed-from header', () => {
  assert.match(PAGE, /borrowed-from: bareloop src\/panel\/index\.html@9edb3e1 \(on d25e52a\)/);
  assert.match(PAGE, /\.map-chips\{display:flex;flex-wrap:wrap/);
  const box = /\.map-box\{[^}]*\}/.exec(PAGE)[0];
  assert.doesNotMatch(box, /overflow-x:auto/);
  assert.doesNotMatch(PAGE, /buildStepMapSVG|computeMapLayout/);
});
