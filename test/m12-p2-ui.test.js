// M12 piece 2: the Run card's When dropdown offers `When a new ticket arrives in <input name>` only for a job with a GitHub issues-list input, picks among those inputs,
// shows no path box for it, and keeps the file choices on their file inputs. Real-browser walk of the real panel (headless chromium; skips when none). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';
import { LIST, ticketJob } from './m12-p2-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const WHEN = 'document.getElementById("jf-when")';
const OUT = process.env.FWDLOOP_SHOTS ?? null;

async function open(fileJd, width = 1280) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const w = await world({ limit: 5 });
  ticketJob(w.root, 'tk', { fileJd });
  seedGreen(w, 'tk');
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "tk"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor(`${WHEN} && !${WHEN}.disabled`));
  return { chrome, w };
}
const opts = (chrome) => chrome.ev(`Array.prototype.map.call(${WHEN}.options, function(o){ return o.hidden || o.disabled ? "" : o.value; }).filter(Boolean)`);


test('a ticket-list input offers the ticket choice (its own inputs only); file choices keep the file inputs; the path box is hidden for tickets; nothing spills at 390 and 320', { skip: SKIP && 'no browser' }, async (t) => {
  for (const width of [1280, 390, 320]) {
    // eslint-disable-next-line no-await-in-loop
    const o = await open(false, width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    assert.deepEqual(await opts(chrome), ['hand', 'daily', 'weekdays', 'weekly', 'file-updated', 'new-file', 'new-ticket']);
    const roles = () => chrome.ev('Array.prototype.map.call(document.getElementById("jf-when-role").options, function(o){ return o.value; })');
    await chrome.ev(`${WHEN}.value = "new-ticket"; ${WHEN}.dispatchEvent(new Event("change", {bubbles: true}))`);
    assert.deepEqual(await roles(), ['jd']);
    assert.equal(await chrome.ev('document.getElementById("jf-when-path").hidden'), true);
    assert.equal(await chrome.ev('document.getElementById("jf-when-filebox").hidden'), false);
    assert.equal(await chrome.ev('document.documentElement.scrollWidth <= window.innerWidth'), true, `page spill at ${width}`);
    await chrome.ev(`${WHEN}.value = "new-file"; ${WHEN}.dispatchEvent(new Event("change", {bubbles: true}))`);
    assert.deepEqual(await roles(), ['resume']);
    assert.equal(await chrome.ev('document.getElementById("jf-when-path").hidden'), false);
  }
});

test('a job without a ticket list does not offer the ticket choice', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(true);
  if (!o) { t.skip('no chromium installed'); return; }
  assert.deepEqual(await opts(o.chrome), ['hand', 'daily', 'weekdays', 'weekly', 'file-updated', 'new-file']);
});
