// M9 amendment 5: schedule buttons. The Run card button follows When (Run now / Sign schedule / Cancel schedule); signing or cancelling takes
// two clicks, click 2 clears the card and starts nothing; a scheduled job's Run tab has Cancel / modify schedule next to Run again.
// Real-browser walk of the real panel (headless chromium; skips when none is installed). Fake provider, $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const SCHEDULED = { kind: 'daily', hour: 13, minute: 15 };
const BTN = 'document.getElementById("chat-main-btn")';
const WHEN = 'document.getElementById("jf-when")';

async function open({ scheduled = false, width = 1280 } = {}) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const { w } = await greenWorld();
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  if (scheduled) assert.equal((await setTrigger(w, SCHEDULED)).status, 200);
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  await chrome.ev(`window.__posts = []; (function(){ var f = window.fetch; window.fetch = function(u, o){ if(o && o.method === "POST") window.__posts.push(String(u)); return f.apply(this, arguments); }; })()`);
  return { chrome, w };
}
async function pickJob(chrome) {
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'), 'mode radios enabled');
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "job2"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor(`${WHEN} && !${WHEN}.disabled`));
}
const pick = (chrome, v) => chrome.ev(`(function(){ var s = ${WHEN}; s.value = "${v}"; s.dispatchEvent(new Event("change", {bubbles: true})); })()`);
const label = (chrome) => chrome.ev(`${BTN}.textContent`);
const runPosts = (chrome) => chrome.ev('window.__posts.filter(function(p){ return /\\/api\\/author\\/run/.test(p); })');
const cleared = (chrome) => chrome.waitFor('document.getElementById("rw-picked").hidden === true && document.getElementById("jf-run-flow").value === ""', 6000);
// the default empty card a fresh page load shows: New job checked, the Run-a-signed-flow fields hidden
const newJobCard = (chrome) => chrome.waitFor('document.querySelector(\'input[name="jf-mode"][value="new"]\').checked === true && document.getElementById("jf-run").hidden === true', 6000);

test('the By hand option reads Cancel schedule only on a scheduled job', { skip: SKIP && 'no browser' }, async (t) => {
  const plain = await open();
  if (!plain) { t.skip('no chromium installed'); return; }
  await pickJob(plain.chrome);
  assert.equal(await plain.chrome.ev(`${WHEN}.querySelector('option[value="hand"]').textContent`), 'By hand');
  const sch = await open({ scheduled: true });
  await pickJob(sch.chrome);
  assert.equal(await sch.chrome.ev(`${WHEN}.querySelector('option[value="hand"]').textContent`), 'Cancel schedule');
  assert.equal(await sch.chrome.ev(`${WHEN}.value`), 'daily');
  assert.match(await label(sch.chrome), /^Run now — spends up to \$/);
});

test('Sign schedule: click 1 makes the button read Confirm: <words>; click 2 signs, clears the card, starts nothing', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, w } = o;
  await pickJob(chrome);
  await pick(chrome, 'daily');
  await chrome.ev('(function(){ var t = document.getElementById("jf-when-time"); t.value = "13:15"; t.dispatchEvent(new Event("change", {bubbles: true})); })()');
  assert.equal(await label(chrome), 'Sign schedule');
  await chrome.ev(`${BTN}.click()`);
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Confirm: every day at 13:15"`), `button after click 1: ${await label(chrome)}`);
  assert.equal(await chrome.ev('document.getElementById("chat-main-hint").textContent'), '', 'the hint lines are gone');
  assert.equal(await chrome.ev(`(function(){ ${BTN}.click(); return ${BTN}.disabled; })()`), true, 'dimmed on click 2');
  assert.ok(await cleared(chrome), 'the card is cleared after click 2');
  assert.ok(await newJobCard(chrome), 'the card is back to New job, not Run a signed flow');
  assert.equal(await chrome.ev('document.getElementById("chat-main-hint").textContent'), '');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(await runPosts(chrome), [], 'no run-route POST');
  assert.deepEqual(w.starts(), [], 'no start folder');
  const trig = (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2').trigger;
  assert.equal(trig.trigger.kind, 'daily');
});

test('Cancel schedule: the choice makes the button Cancel schedule; click 1 reads Confirm: cancel schedule; click 2 leaves it By hand, clears the card, starts nothing', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open({ scheduled: true });
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, w } = o;
  await pickJob(chrome);
  await pick(chrome, 'hand');
  assert.equal(await label(chrome), 'Cancel schedule');
  await chrome.ev(`${BTN}.click()`);
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Confirm: cancel schedule"`), `button after click 1: ${await label(chrome)}`);
  await chrome.ev(`${BTN}.click()`);
  assert.ok(await cleared(chrome), 'the card is cleared after click 2');
  assert.ok(await newJobCard(chrome), 'the card is back to New job, not Run a signed flow');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(await runPosts(chrome), [], 'no run-route POST');
  assert.deepEqual(w.starts(), [], 'no start folder');
  const trig = (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2').trigger;
  assert.equal(trig.trigger, null, 'the job is By hand');
  assert.doesNotMatch(readFileSync(path.join(w.root, 'job2', 'prose.txt'), 'utf8'), /guardrail: trigger/);
});

async function openRunTab(chrome) {
  await chrome.ev('document.getElementById("tab-runs").click()');
  await chrome.ev('selectRun("job2", "seed-pass", null, null)');
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=run-again]")'), 'Run again shown');
}

test('a scheduled job Run tab has Cancel / modify schedule next to Run again and it opens the Run card on that job', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open({ scheduled: true });
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  await openRunTab(chrome);
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=run-cancel-schedule]")'), 'Cancel / modify shown');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=run-cancel-schedule]").textContent'), 'Cancel / modify schedule');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=run-again]").nextElementSibling === document.querySelector("[data-testid=run-cancel-schedule]")'), true, 'next to Run again');
  await chrome.ev('document.querySelector("[data-testid=run-cancel-schedule]").click()');
  assert.ok(await chrome.waitFor(`${WHEN} && !${WHEN}.disabled && ${WHEN}.value === "daily"`), 'the Run card shows the schedule');
  assert.match(await chrome.ev('document.getElementById("jf-run-flow").value'), /^job2/);
});

test('a job without a schedule has no Cancel / modify button on its Run tab', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open();
  if (!o) { t.skip('no chromium installed'); return; }
  await openRunTab(o.chrome);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=run-cancel-schedule]")'), null);
});
