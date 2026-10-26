// M6 item 7 (docs/wiki/the-module-ladder.md): "The card is locked as a whole while anything is live (`syncCardLock`)". The Model menu and the
// "Thinking on" box lock with it: shut and `locked` while a draft is live, open again after a red draft, and the menu stays shut (its own reason)
// when no model is ticked even with the card open. Real browser (skips when no chromium); the draft is the fake drafter, started through the panel's own door.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world, killChildrenAfter, until } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const MODEL = 'document.getElementById("jf-model")';
const THINK = 'document.getElementById("jf-thinking")';
const state = (chrome, el) => chrome.ev(`({disabled: ${el}.disabled, locked: ${el}.classList.contains("locked")})`);

async function openPage(w) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  return chrome;
}

test('a live draft locks the Model menu and the Thinking box with the card', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world({ mode: 'hang' });
  const chrome = await openPage(w);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.ok(await chrome.waitFor(`${MODEL}.options.length > 0 && ${MODEL}.value !== ""`), 'the model menu filled');
  assert.deepEqual(await state(chrome, MODEL), { disabled: false, locked: false }, 'open before any draft');
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280); // a reload re-attaches to the live draft
  assert.ok(await chrome.waitFor('document.getElementById("jf-job").readOnly === true'), `the card locked for draft ${id}`);
  assert.deepEqual(await state(chrome, MODEL), { disabled: true, locked: true }, 'Model locked while the draft is live');
  const think = await state(chrome, THINK);
  assert.equal(think.locked, true, 'Thinking box carries the locked class');
  assert.equal(think.disabled, true, 'Thinking box shut while live');
});

test('after a red draft ("Fix and draft again") the Model menu and the Thinking box are open again', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world({ mode: 'bad' });
  const chrome = await openPage(w);
  if (!chrome) { t.skip('no chromium installed'); return; }
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return j?.phase === 'red' ? j : null; });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('document.getElementById("chat-main-btn").textContent === "Fix and draft again"'), 'the red draft is shown');
  assert.equal(await chrome.ev(`${MODEL}.disabled`), false, 'Model open after a red draft');
  assert.equal(await chrome.ev(`${MODEL}.classList.contains("locked")`), false);
  assert.equal(await chrome.ev(`${THINK}.classList.contains("locked")`), false);
});

test('with no model ticked the menu stays shut even with the card open (its own reason is kept)', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world();
  writeFileSync(path.join(w.home, 'config.json'), '{}');
  const chrome = await openPage(w);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.ok(await chrome.waitFor(`${MODEL}.options.length > 0`));
  assert.equal(await chrome.ev('document.getElementById("jf-job").readOnly'), false, 'the card is open');
  assert.deepEqual(await state(chrome, MODEL), { disabled: true, locked: false });
});
