// M13 am7, the Reuse workflow card: ONE Ask wait box for the asks that do not set their own; Run id XOR Name of the new workflow.
// Real-browser walk (skips when no chromium) + source checks. The "changed" decision is the server's reuse-check, the same one that picks the button.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';
import { seedGreen } from './m9-trigger-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
const load = (name, ...deps) => new Function(`${[...deps, name].map((n) => cutFn(CHAT, n, '    ')).join('\n')}\nreturn ${name};`)();
const BTN = 'document.getElementById("chat-main-btn")';
const JOB = 'document.getElementById("jf-run-jobbox")';
test('source: no per-line wait boxes; one Ask wait box; the Run id field can be hidden', () => {
  assert.doesNotMatch(PAGE, /Ask wait \\u00b7 line/);
  assert.doesNotMatch(PAGE, /jf-run-wait-"/);
  assert.match(PAGE, /<label for="jf-run-wait">Ask wait<\/label>/);
  assert.match(PAGE, /id="jf-run-id-field"/);
});

async function open(width = 1280) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const w = await world({ limit: 5 });
  await w.signedFlow();
  seedGreen(w);
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
const hidden = (chrome, id) => chrome.ev(`document.getElementById("${id}").hidden`);

test('askWaitsFrom: the one box sets every ask that shares the job wait; an ask with its own wait keeps it; an empty box changes nothing', () => {
  const f = load('askWaitsFrom', 'sharedAskWait');
  assert.deepEqual(f({ 5: '1h', 7: '1h' }, '45m'), { 5: '45m', 7: '45m' }, 'both asks follow the one box');
  assert.deepEqual(f({ 5: '1h', 7: '2h', 9: '1h' }, '45m'), { 5: '45m', 9: '45m' }, 'the 2h ask sets its own wait and is untouched');
  assert.deepEqual(f({ 5: '2h', 7: '1h', 9: '1h' }, '45m'), { 7: '45m', 9: '45m' }, 'the shared wait is the commonest, not the first');
  assert.deepEqual(f({ 5: '1h', 7: '2h' }, '45m'), { 5: '45m' }, 'a tie: the first ask sets the shared wait');
  assert.deepEqual(f({ 5: '1h', 7: '1h' }, '  '), {});
  assert.deepEqual(f({}, '45m'), {});
});

test('a job has ONE Ask wait box, no per-line boxes, starting at the shared wait', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  assert.equal(await chrome.ev('document.querySelectorAll("#jf-run input.jf-wait").length'), 1);
  assert.equal(await chrome.ev('document.getElementById("jf-run-wait").value'), '30m');
  assert.equal(await chrome.ev('document.querySelectorAll("#jf-run .jf-waitrow").length'), 0);
  assert.equal(await chrome.ev('[...document.querySelectorAll("#jf-run label")].filter(function(l){ return /Ask wait/.test(l.textContent); }).length'), 1);
});

test('typing a different wait is Sign & run; the ask that sets its own wait keeps it; undo is Run now', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  await typeIn(chrome, 'jf-run-wait', '45m');
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Sign & run"`), `label: ${await label(chrome)}`);
  assert.equal(await hidden(chrome, 'jf-run-newname-field'), true, 'a wait is not a job field: no new name');
  await typeIn(chrome, 'jf-run-wait', '30m');
  assert.ok(await chrome.waitFor(`/^Run now/.test(${BTN}.textContent)`), 'flips back on undo');
});

test('Run id XOR Name of the new workflow: a job edit swaps them, undo swaps back; a cap change leaves Run id', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  assert.equal(await hidden(chrome, 'jf-run-id-field'), false);
  assert.equal(await hidden(chrome, 'jf-run-newname-field'), true);
  assert.match(await chrome.ev('document.getElementById("jf-run-id").value'), /^run-\d+$/);
  await typeIn(chrome, 'jf-run-cap', '0.30');
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Sign & run"`));
  assert.equal(await hidden(chrome, 'jf-run-id-field'), false, 'Sign & run is the same job: Run id');
  assert.equal(await hidden(chrome, 'jf-run-newname-field'), true);
  await typeIn(chrome, 'jf-run-cap', '0.25');
  const original = await chrome.ev(`${JOB}.value`);
  await typeIn(chrome, 'jf-run-jobbox', `${original}\nand one more step`);
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Start drafting"`));
  assert.equal(await hidden(chrome, 'jf-run-newname-field'), false);
  assert.equal(await hidden(chrome, 'jf-run-id-field'), true, 'a changed job shows the new name and no Run id');
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname").value'), 'job2-2');
  await typeIn(chrome, 'jf-run-jobbox', original);
  assert.ok(await chrome.waitFor(`/^Run now/.test(${BTN}.textContent)`));
  assert.equal(await hidden(chrome, 'jf-run-id-field'), false, 'undone: Run id is back');
  assert.equal(await hidden(chrome, 'jf-run-newname-field'), true);
});
