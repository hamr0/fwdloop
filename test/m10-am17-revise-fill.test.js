// M4e am14 item 2 ("Revise opens every card field, filled in as last drafted") in a real headless browser, on the real panel, $0 (fake provider):
// the page drafted, the human answered the ask in the Chat box, the answer-redraft wrote card-1.json with the answer as a `~` line. Revise must show
// that newest card in the Job box (not what was first typed), and a cap-only Draft then asks nothing (M10 am17). Skips only when no chromium is installed.
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
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});

test('browser: after an answer-redraft, Revise shows the newest card (the ~ answer line); a cap-only Draft asks nothing', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  assert.equal((await settle(w, id, ['questions-open'])).phase, 'questions-open');
  await childGone(w, id);
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('!document.getElementById("chat-question").hidden'), 'the Chat box shows the question');
  assert.ok(!(await chrome.ev('document.getElementById("jf-job").value')).includes('~ three short bullet points'));
  await chrome.ev('var a = document.getElementById("chat-q-answer"); a.value = "three short bullet points"; a.dispatchEvent(new Event("input")); document.getElementById("chat-q-send").click()');
  assert.equal((await settle(w, id, ['green'])).phase, 'green');
  await childGone(w, id);
  const card1 = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.ok(card1.job.includes('~ three short bullet points'), 'the redraft wrote the answer as a ~ line');
  assert.ok(await chrome.waitFor('!document.getElementById("chat-revise-btn").disabled'), 'Revise is offered');
  await chrome.ev('document.getElementById("chat-revise-btn").click()');
  assert.ok(await chrome.waitFor('!document.getElementById("jf-job").readOnly'), 'the Job box opened');
  assert.equal(await chrome.ev('document.getElementById("jf-job").value'), card1.job, 'the Job box shows the newest card, answers included');
  // cap-only change, then Draft: nothing is asked again
  await chrome.ev(`var c = document.getElementById("jf-cap-money"); c.value = ${JSON.stringify(String(card1.capUsd + 1))}; c.dispatchEvent(new Event("input", {bubbles: true}))`);
  assert.ok(await chrome.waitFor('!document.getElementById("chat-main-btn").disabled'), 'Draft is enabled');
  await chrome.ev('document.getElementById("chat-main-btn").click()');
  const s = await until(async () => { const j = await state(w, id); return j?.revises?.length === 2 && ['green', 'questions-open', 'red', 'stopped'].includes(j.phase) ? j : null; });
  await childGone(w, id);
  assert.equal(s.phase, 'green', JSON.stringify(s.questions ?? s.reds ?? s));
  const card2 = JSON.parse(readFileSync(path.join(w.dir(id), 'card-2.json'), 'utf8'));
  assert.ok(card2.job.includes('~ three short bullet points'), 'card-2 keeps the ~ answer line');
});
