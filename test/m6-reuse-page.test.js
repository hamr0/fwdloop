// M6 am5/am6/am7, the page. ONE button "Reuse workflow" (no "Run again", no "Edit this job"); the Reuse card opens every field; the main button's
// label is the SERVER's answer (Run / Sign & run / Start drafting) and flips back on undo. Real-browser walk (skips when no chromium) + source checks.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld } from './m9-trigger-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const BTN = 'document.getElementById("chat-main-btn")';
const JOB = 'document.getElementById("jf-run-jobbox")';

test('source: one Reuse workflow button; no "Run again" or "Edit this job" text anywhere a person can read it; ids unique', () => {
  const text = PAGE.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');
  assert.doesNotMatch(text, /Run again/);
  assert.doesNotMatch(text, /Edit this job/);
  assert.equal((text.match(/makeButton\("Reuse workflow"/g) ?? []).length, 1, 'exactly one Reuse workflow button');
  assert.doesNotMatch(text, /id="jf-run-edit"/);
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))], []);
  assert.ok(ids.includes('jf-run-jobbox') && ids.includes('jf-run-newname'));
});

async function open(width = 1280) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const { w } = await greenWorld();
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "job2"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor(`${JOB} && ${JOB}.value.length > 0`));
  return { chrome, w };
}
const typeIn = (chrome, id, v) => chrome.ev(`(function(){ var e = document.getElementById("${id}"); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", {bubbles: true})); })()`);
const label = (chrome) => chrome.ev(`${BTN}.textContent`);

test('the Reuse card opens the job (not dimmed); the label is Run, flips to Start drafting on a job edit with a suggested name, flips back on undo', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  assert.match(await label(chrome), /^Run now/);
  assert.equal(await chrome.ev(`${JOB}.readOnly`), false, 'the job is editable');
  assert.equal(await chrome.ev('!!document.querySelector("[data-testid=jf-run-job-field].dimmed")'), false);
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname-field").hidden'), true);
  const original = await chrome.ev(`${JOB}.value`);
  await typeIn(chrome, 'jf-run-jobbox', `${original}\nand one more step`);
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Start drafting"`), `label: ${await label(chrome)}`);
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname-field").hidden'), false);
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname").value'), 'job2-2');
  await typeIn(chrome, 'jf-run-jobbox', original);
  assert.ok(await chrome.waitFor(`/^Run now/.test(${BTN}.textContent)`), 'flips back on undo');
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname-field").hidden'), true);
});

test('changing only the cap is Sign & run (no drafting, no draft POST); Start drafting opens the New card with the job, the new name and the draft call', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, w } = o;
  await typeIn(chrome, 'jf-run-cap', '0.30');
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Sign & run"`), `label: ${await label(chrome)}`);
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname-field").hidden'), true);
  await typeIn(chrome, 'jf-run-cap', '0.25');
  const original = await chrome.ev(`${JOB}.value`);
  await typeIn(chrome, 'jf-run-jobbox', original.replace('nothing goes out before I accept', 'nothing goes out before I say so'));
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Start drafting"`));
  await chrome.ev(`${BTN}.click()`);
  assert.ok(await chrome.waitFor('!document.getElementById("jf-new").hidden'), 'the New card shows');
  assert.equal(await chrome.ev('document.getElementById("jf-name").value'), 'job2-2');
  const { readdirSync } = await import('node:fs');
  assert.ok(await new Promise((r) => { const t0 = Date.now(); const i = setInterval(() => { try { if (readdirSync(path.join(w.root, '.drafts')).length > 0) { clearInterval(i); r(true); } } catch { /* none yet */ } if (Date.now() - t0 > 8000) { clearInterval(i); r(false); } }, 200); }), 'a draft started');
});
