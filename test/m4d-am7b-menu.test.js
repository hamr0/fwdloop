// M4d amendment 7b, piece 2: Chat's MODEL menu is never blank. Before the first answer it says it is reading; if the read fails (or the
// answer is not ok) it says so and tries again by itself, so the first load fills it without a trip to Settings and back.
// $0, no browser: the page's own loadModel is cut out of src/panel/index.html and run against a tiny fake DOM and a scripted authorGet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const start = PAGE.indexOf('    function loadModel(');
const SRC = PAGE.slice(start, PAGE.indexOf('\n    function setMode(', start));

function harness(replies) {
  const timers = [];
  const el = { disabled: false, kids: [], value: '', appendChild(o) { this.kids.push(o); }, set innerHTML(v) { this.kids = []; } };
  const doc = { createElement: () => ({ value: '', textContent: '' }) };
  let n = 0;
  const authorGet = () => { const r = replies[Math.min(n, replies.length - 1)]; n += 1; return r === 'fail' ? Promise.reject(new Error('net')) : Promise.resolve(r); };
  const state = { modelLines: [], picks: [] };
  const mk = new Function('modelEl', 'document', 'authorGet', 'modelPick', 'setModelPick', 'setTimeout', 'syncRunPick', 'state',
    `var modelNone = true; function paintModelLock(){ modelEl.disabled = modelNone; } var modelLines = state.modelLines; ${SRC.replace('modelLines = j.lines || [];', 'modelLines = state.modelLines = j.lines || [];')}\n return loadModel;`);
  const loadModel = mk(el, doc, authorGet, () => ({ provider: '', model: '' }), (p, m) => state.picks.push([p, m]), (f, ms) => { timers.push([f, ms]); return timers.length; }, () => {}, state);
  const text = () => el.kids.map((k) => k.textContent).join('|');
  const settle = () => new Promise((r) => { setImmediate(r); });
  return { el, loadModel, timers, text, settle, calls: () => n };
}

test('M1: the menu is not empty in the page as served: it says it is reading', () => {
  assert.match(PAGE, /<select id="jf-model"[^>]*>\s*<option[^>]*>[^<]+<\/option>\s*<\/select>/);
});

test('M2: a failed first read leaves text in the menu, not blank, and tries again by itself', async () => {
  const h = harness(['fail', { ok: true, lines: [], say: 'Tick a model in Settings > Providers.' }]);
  h.loadModel();
  await h.settle();
  assert.notEqual(h.text(), '', 'blank after a failed read');
  assert.equal(h.timers.length, 1, 'a retry is scheduled');
  h.timers[0][0]();
  await h.settle();
  assert.equal(h.text(), 'Tick a model in Settings > Providers.');
});

test('M3: a not-ok answer reads the same: text, then a retry', async () => {
  const h = harness([{ ok: false }, { ok: true, lines: [{ slot: 'K', model: 'm', label: 'K · m', thinking: {} }], say: '' }]);
  h.loadModel();
  await h.settle();
  assert.notEqual(h.text(), '');
  assert.equal(h.timers.length, 1);
  h.timers[0][0]();
  await h.settle();
  assert.equal(h.text(), 'K · m');
});

test('M4: an ok answer needs no retry; retries stop after a few tries (never a hot loop)', async () => {
  const ok = harness([{ ok: true, lines: [], say: '' }]);
  ok.loadModel(); await ok.settle();
  assert.equal(ok.timers.length, 0);
  const bad = harness(['fail']);
  bad.loadModel(); await bad.settle();
  for (let i = 0; i < 20 && bad.timers.length > i; i += 1) { bad.timers[i][0](); await bad.settle(); } // eslint-disable-line no-await-in-loop
  assert.ok(bad.calls() <= 6, `${bad.calls()} reads`);
  assert.notEqual(bad.text(), '');
});
