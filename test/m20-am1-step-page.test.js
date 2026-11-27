// M20 am1 items 5-6 in a real headless browser on the real panel, $0 (fake provider): the live drafting list (✓ ▶, "M:SS so far", "Drafting so far"), the ended list
// ("took M:SS") and "Drafted in M:SS · $X", at 1280, 390 and 320 px wide: no horizontal scroll, every line inside the viewport. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isFwdloopAlive } from '../src/liveness.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
// `phase: green` shows before the draft's child has exited, and a revise is (rightly) refused `draft-live` until it has: wait on the child, never a clock
const childGone = (w, id) => until(() => { try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; } });
const SPILL = `(function(){ var vw = document.documentElement.clientWidth, bad = [];
  document.querySelectorAll('#chat-progress-row *, [data-testid="drafted-line"]').forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width > 0 && (r.right > vw + 1 || r.left < -1)) bad.push(e.className + ':' + Math.round(r.right)); });
  return JSON.stringify({ doc: document.documentElement.scrollWidth <= vw, bad: bad }); })()`;

test('browser: live and ended drafting list, no dots, "Drafted in", 1280 / 390 / 320 wide', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  // live: a draft whose second call never returns
  const live = await world({ mode: 'hang' });
  const lid = (await live.post('/api/author/draft', live.card({ job: BOX_JOB }))).json().draftId;
  await until(async () => (await state(live, lid))?.stepList?.length >= 2);
  for (const width of [1280, 390, 320]) {
    await chrome.open(`http://127.0.0.1:${live.h.port}/`, width);
    assert.ok(await chrome.waitFor('document.querySelectorAll("#chat-progress-row .step.run").length === 1 && !!document.querySelector("[data-testid=drafting-so-far]")'), `live list at ${width}`);
    assert.match(await chrome.ev('document.querySelector("#chat-progress-row .step.run [data-testid=step-time]").textContent'), /^\d+:\d\d so far$/);
    assert.match(await chrome.ev('document.querySelector("[data-testid=drafting-so-far]").textContent'), /^Drafting so far: \d+:\d\d$/);
    assert.equal(await chrome.ev('getComputedStyle(document.querySelector("#chat-progress-row .step.run .step-sign"), "::after").content'), 'none');
    assert.equal(await chrome.ev('document.querySelector("#chat-progress-row .step.run .step-sign").textContent'), '▶');
    const s = JSON.parse(await chrome.ev(SPILL));
    assert.deepEqual(s, { doc: true, bad: [] }, `no spill at ${width}`);
  }
  // ended
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: BOX_JOB }))).json().draftId;
  await until(async () => (await state(w, id))?.phase === 'green');
  for (const width of [1280, 390, 320]) {
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=drafted-line]")'), `drafted line at ${width}`);
    assert.match(await chrome.ev('document.querySelector("[data-testid=drafted-line]").textContent'), /^Drafted in \d+:\d\d · (at least )?\$\d/);
    assert.ok(await chrome.ev('document.querySelectorAll("#chat-progress-row .step-time").length >= 3'));
    assert.equal(await chrome.ev('document.querySelectorAll("#chat-progress-row .step.run").length'), 0);
    const s = JSON.parse(await chrome.ev(SPILL));
    assert.deepEqual(s, { doc: true, bad: [] }, `no spill at ${width}`);
  }
});

test('browser: a revise lists its own live steps and, ended, the session\'s Drafted in line, 1280 / 390 / 320 wide', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: BOX_JOB }))).json().draftId;
  await until(async () => (await state(w, id))?.phase === 'green');
  await childGone(w, id);
  const hung = BOX_JOB.replace('Read my resume,', 'Read my resume HANGMARK,');
  assert.notEqual(hung, BOX_JOB);
  assert.equal((await w.post(`/api/author/${id}/revise`, w.card({ job: hung }))).status, 202);
  await until(async () => (await state(w, id))?.revises?.[0]?.lines?.length >= 2);
  for (const width of [1280, 390, 320]) {
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('document.querySelectorAll("#chat-progress-row .step.run").length === 1 && !!document.querySelector("[data-testid=drafting-so-far]")'), `live revise at ${width}`);
    assert.ok(await chrome.ev('document.querySelector("#chat-progress-row .step.run [data-testid=step-time]").textContent.endsWith("so far")'));
    assert.deepEqual(JSON.parse(await chrome.ev(SPILL)), { doc: true, bad: [] }, `no spill at ${width}`);
  }
});

test('browser: after a revise ends, Drafted in shows (session time and spend)', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: BOX_JOB }))).json().draftId;
  await until(async () => (await state(w, id))?.phase === 'green');
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/revise`, w.card({ job: BOX_JOB, capUsd: '0.30' }))).status, 202);
  await until(async () => { const j = await state(w, id); return j?.phase === 'green' && j.revises?.length === 1 ? j : null; });
  for (const width of [1280, 390, 320]) {
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=drafted-line]")'), `drafted line at ${width}`);
    assert.match(await chrome.ev('document.querySelector("[data-testid=drafted-line]").textContent'), /^Drafted in \d+:\d\d \u00B7 (at least )?\$\d/);
    assert.deepEqual(JSON.parse(await chrome.ev(SPILL)), { doc: true, bad: [] }, `no spill at ${width}`);
  }
});
