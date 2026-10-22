// M10 (hamr 2026-10-20): a file trigger never offers a web-page input; a page input's full address shows in its Run-row box (ellipsis + title) and in the
// Job tab's Schedule field; the New job hint allows a web address. Real-browser walk of the real panel (headless chromium; skips when none). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const LONG = 'https://www.google.com/travel/flights?q=Flights%20from%20BOS%20to%20ORD%20on%202026-11-01%20through%202026-11-08&hl=en&gl=us&curr=USD&tfs=CBwQAhopEgoyMDI2LTExLTAxag0IAhIJL20vMDFjeDM';
const WHEN = 'document.getElementById("jf-when")';
const OUT = process.env.FWDLOOP_SHOTS ?? null;

async function open(inputsOf, width = 1280) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const w = await world({ limit: 5 });
  await w.signedFlow({ inputs: inputsOf(w) });
  seedGreen(w);
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "job2"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor(`${WHEN} && !${WHEN}.disabled`));
  return { chrome, w };
}
const opts = (chrome) => chrome.ev(`Array.prototype.map.call(${WHEN}.options, function(o){ return o.hidden || o.disabled ? "" : o.value; }).filter(Boolean)`);

test('a job with only page inputs offers the clock options only; a mixed job lists only its file roles for a file trigger', { skip: SKIP && 'no browser' }, async (t) => {
  const only = await open((w) => `jd: ${LONG}`);
  if (!only) { t.skip('no chromium installed'); return; }
  assert.deepEqual(await opts(only.chrome), ['hand', 'daily', 'weekdays', 'weekly']);
  const mixed = await open((w) => `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${LONG}`);
  assert.deepEqual(await opts(mixed.chrome), ['hand', 'daily', 'weekdays', 'weekly', 'file-updated', 'new-file']);
  assert.deepEqual(await mixed.chrome.ev('Array.prototype.map.call(document.getElementById("jf-when-role").options, function(o){ return o.value; })'), ['resume']);
});

test('a page input shows its full address in the Run row box with the whole on hover, read-only; nothing spills at 1280, 390 and 320', { skip: SKIP && 'no browser' }, async (t) => {
  const numbers = {};
  for (const width of [1280, 390, 320]) {
    // eslint-disable-next-line no-await-in-loop
    const o = await open((w) => `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${LONG}`, width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    const row = await chrome.ev(`(function(){ var el = document.querySelectorAll("#jf-run-inputs .jf-path")[1]; var cs = getComputedStyle(el); var r = el.getBoundingClientRect();
      return {value: el.value, title: el.title, ro: el.readOnly, ellipsis: cs.textOverflow, right: Math.round(r.right), w: Math.round(r.width), docW: document.documentElement.scrollWidth, winW: window.innerWidth}; })()`);
    assert.equal(row.value, LONG);
    assert.equal(row.ro, true);
    assert.match(row.title, /web page/);
    assert.equal(row.ellipsis, 'ellipsis');
    assert.ok(row.docW <= row.winW, `page spill at ${width}: ${row.docW} > ${row.winW}`);
    assert.ok(row.right <= row.winW, `box spill at ${width}`);
    numbers[width] = row;
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `page-input-${width}.png`)); }
  }
  console.log('spill numbers', JSON.stringify(Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, { boxRight: v.right, boxW: v.w, docW: v.docW, winW: v.winW }]))));
});

test('the New job inputs hint keeps its words and also allows a web address', () => {
  const html = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.match(html, /One line per file: a name, a colon, its full path starting with \/, or a web address \(http:\/\/ or https:\/\/\)\. The page never reads the file\./);
});
