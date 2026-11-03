// M15 items 1, 2 and 5 (docs/wiki/the-module-ladder.md): the Result tab for every job, a text line's card, and the sent file's link in the top card.
// $0: job2 run for real in process (test/m10-am4-world.mjs), the real panel; the page parts in headless chromium.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { test, after } from 'node:test';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { RESULT_FILE_CHANGED, RESULT_FILE_GONE } from '../src/panel/result.js';
import { world } from './m10-am4-world.mjs';

const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

test('/download?view=1 opens the saved .md in the tab (inline, text/plain, nosniff); without it, it is still an attachment', async () => {
  const w = await world();
  const inline = await w.get('/api/runs/job2/run-1/download?i=0&view=1');
  assert.equal(inline.status, 200);
  assert.match(inline.headers.get('content-disposition'), /^inline; filename="job2-run-1-resume-summary-output\.md"/);
  assert.match(inline.headers.get('content-type'), /^text\/plain/);
  assert.equal(inline.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(inline.raw, readFileSync(w.delivered, 'utf8'));
  assert.match((await w.get('/api/runs/job2/run-1/download?i=0')).headers.get('content-disposition'), /^attachment;/);
});

test('the sent .md matches the accepted answer (item 3): the accepted JSON artifact holds the same text', async () => {
  const w = await world();
  const art = JSON.parse(readFileSync(`${w.runDir}/artifacts/resume-summary-output.json`, 'utf8'));
  assert.equal(readFileSync(w.delivered, 'utf8'), art.text);
});

async function openTab(w, width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  await chrome.open(`http://127.0.0.1:${w.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the page opened the newest run');
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('document.getElementById("result-body").innerHTML.length > 100'), 'the Result tab drew');
  return chrome;
}

test('browser: the top card links the sent .md; a text line shows its text; no horizontal scroll', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world();
  const chrome = await openTab(w, 390);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.equal(await chrome.ev('document.querySelector("[data-testid=result-file-top] a").textContent'), 'job2-run-1-resume-summary-output.md');
  assert.match(await chrome.ev('document.querySelector("[data-testid=result-file-top] a").getAttribute("href")'), /\/api\/runs\/job2\/run-1\/download\?i=0&view=1$/);
  assert.equal(await chrome.ev('document.querySelector("[data-testid=result-head] [data-testid=result-file-top]") !== null'), true, 'in the top card');
  assert.equal(await chrome.ev('document.querySelectorAll("[data-testid=result-answer]").length'), 3, 'one text per text line');
  assert.equal(await chrome.ev('document.documentElement.scrollWidth <= window.innerWidth'), true);
});

test('browser: a gone or changed file shows the server\'s words in the top card, no link', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world();
  appendFileSync(w.delivered, ' ');
  let chrome = await openTab(w, 1280);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.match(await chrome.ev('document.querySelector("[data-testid=result-file-top-gone]").textContent'), new RegExp(RESULT_FILE_CHANGED));
  assert.equal(await chrome.ev('document.querySelector("[data-testid=result-file-top]")'), null);
  rmSync(w.delivered);
  chrome = await openTab(w, 1280);
  assert.match(await chrome.ev('document.querySelector("[data-testid=result-file-top-gone]").textContent'), new RegExp(RESULT_FILE_GONE));
});

test('browser: a run that sent nothing (parked at its ask) shows no file link', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world({ mode: 'park' });
  const chrome = await openTab(w, 1280);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.equal(await chrome.ev('document.querySelector("[data-testid=result-file-top],[data-testid=result-file-top-gone]")'), null);
});
