// M6 am9 piece 4: reuse-check. A RED run (`[✗]`, the panel's glyph rule, read by the server) always answers Start drafting, job changed or not; with the job
// unchanged it is a run of the SAME workflow (no new name). Stopped `[■]` and waiting are not red; green stays as am6 item 2. The page only shows the answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();
async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  w.seedPassed('job2', 'seed-red', { outcome: 'red' });
  w.seedPassed('job2', 'seed-stop', { outcome: 'stopped' });
  return w;
}
const entryOf = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
async function reuseBody(w, over = {}) {
  const e = await entryOf(w);
  return {
    flow: 'job2', fromRun: 'seed-pass', job: e.edit.card.job, destination: e.values.destination, capUsd: String(e.values.capUsd), askWaits: e.values.askWaits, inputs: w.inputs(), ...over,
  };
}
const check = (w, body) => w.post('/api/author/reuse-check', body);

test('must fail: Reuse on a red run, job unchanged, answers draft (never run / sign-run), as a run of the same workflow with no new name', async () => {
  const w = await signedWorld();
  const r = await check(w, await reuseBody(w, { fromRun: 'seed-red' }));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json().kind, 'draft');
  assert.equal(r.json().runOf, true);
  assert.equal(r.json().suggestedName, undefined, 'the name stays the workflow\'s');
  // a run field changed on a red run is still Start drafting (the label does not depend on the run fields)
  const c = await check(w, await reuseBody(w, { fromRun: 'seed-red', capUsd: '0.30' }));
  assert.equal(c.json().kind, 'draft');
  const d = await check(w, await reuseBody(w, { fromRun: 'seed-red', destination: w.inDir }));
  assert.equal(d.json().kind, 'draft');
});

test('a red run with a CHANGED job is a new workflow: draft with the next free name, not runOf', async () => {
  const w = await signedWorld();
  const e = await entryOf(w);
  const r = await check(w, await reuseBody(w, { fromRun: 'seed-red', job: `${e.edit.card.job}\nand one more step` }));
  assert.equal(r.json().kind, 'draft');
  assert.equal(r.json().runOf, undefined);
  assert.equal(r.json().suggestedName, 'job2-2');
});

test('only [✗] is red: a stopped run, a green run and a run with no fromRun answer run / sign-run as before', async () => {
  const w = await signedWorld();
  for (const fromRun of ['seed-stop', 'seed-pass', undefined, 'no-such-run']) {
    const r = await check(w, await reuseBody(w, { fromRun }));
    assert.equal(r.json().kind, 'run', `${fromRun}: ${r.text}`);
  }
  assert.equal((await check(w, await reuseBody(w, { fromRun: 'seed-stop', capUsd: '0.30' }))).json().kind, 'sign-run');
});

test('a waiting run (an ask open, no end row) is not red', async () => {
  const w = await signedWorld();
  const runDir = path.join(w.root, 'job2', 'runs', 'seed-wait');
  mkdirSync(runDir, { recursive: true });
  appendFileSync(path.join(runDir, 'ask.json'), `${JSON.stringify({ askId: 'a1', at: '2026-10-06T10:00:00.000Z' })}\n`);
  const r = await check(w, await reuseBody(w, { fromRun: 'seed-wait' }));
  assert.notEqual(r.json().kind, 'draft', r.text);
});

// ---- the page: a red run's Reuse card reads Start drafting with the name box hidden, and the draft call names the run (real browser; skips when none)
import { rmSync } from 'node:fs';
import { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { greenWorld } from './m9-trigger-world.mjs';

const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const BTN = 'document.getElementById("chat-main-btn")';
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

test('page source: Start drafting sends the run it was opened from; the name box is only for a changed job', () => {
  assert.match(PAGE, /reuseRunOf = reuseKind === "draft" && r\.body\.runOf === true/);
  assert.match(PAGE, /newNameField\.hidden = !\(mode === "run" && reuseKind === "draft" && !reuseRunOf\)/);
  assert.match(PAGE, /fromRun: pickedRun \? pickedRun\.runId/);
});

test('page: Reuse workflow on a red run reads Start drafting (name box hidden); on a green run it reads Run now', { skip: process.env.FWDLOOP_NO_BROWSER === '1' && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(() => chrome.close());
  const { w } = await greenWorld();
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  w.seedPassed('job2', 'seed-red', { outcome: 'red' });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('typeof window.fwdloopRunAgain === "function"'));
  await chrome.ev('window.fwdloopRunAgain({flow: "job2", runId: "seed-red"})');
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Start drafting"`), `label: ${await chrome.ev(`${BTN}.textContent`)}`);
  assert.equal(await chrome.ev('document.getElementById("jf-run-newname-field").hidden'), true, 'a run of the same workflow has no new name');
  await chrome.ev('window.fwdloopRunAgain({flow: "job2", runId: "seed-pass"})');
  assert.ok(await chrome.waitFor(`/^Run now/.test(${BTN}.textContent)`), `label: ${await chrome.ev(`${BTN}.textContent`)}`);
});
