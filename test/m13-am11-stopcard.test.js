// M13 am11 rule 3 on screen: the stop before the action is the Ask tab's card with the ask's own words and the two signed buttons, Accept and Not now. No reason box, no Redo or Rerun, no Your call card on the
// Result tab. Not now is the Stop (the run ends stopped, nothing written). The real panel in headless chromium at 1280, 390 and 320 (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const HANDLES = [];
const CLOSERS = [];
after(async () => { await Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CAT = loadCatalogue().primitives;
const step = (goal, fromLine, emits, reads, primitives = []) => ({ goal, primitives, reads, emits, fromLine, close: { class: 'hitl' } });

async function parkedAtTheStop(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am11stop-${tag}-`));
  const root = path.join(base, 'flows'); const dest = path.join(base, 'dest');
  mkdirSync(root); mkdirSync(dest);
  const prose = `1. Write the note\n2. Write it out\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $1 per run\nguardrail: send at line 2 to file:${dest}\n`;
  const w = writeFlow({ root, name: 'j', proseText: prose, declaration: { guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {}, steps: [step('Write the note', 1, 'n1', [], ['read']), step('Write it out', 2, 'out', ['n1'], ['write'])] }, signedBy: 'hamr', signedAt: '2026-11-16T10:00:00Z', catalogue: CAT });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const modelStep = async () => ({ ok: true, costUsd: 0.001, artifact: { text: 'NOTE', done: true } });
  const run = await runFlow({ root, name: 'j', runId: 'run-1', sources: [], catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-16', askStep: makeParkingAskStep() });
  assert.equal(run.outcome, 'paused', run.red);
  const h = remember(await createPanelServer({ port: 0, root }));
  HANDLES.push(h);
  return { h, dest, root };
}

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the stop has the ask's words and two buttons, Accept and Not now; Not now stops the run, nothing is written; no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await parkedAtTheStop(`b${width}`);
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    const card = 'document.querySelector("[data-testid=rl-run-j-run-1]")';
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=btn-accept]")'), 'the Ask tab has Accept');
    assert.deepEqual(await chrome.ev('Array.from(document.querySelectorAll("[data-testid=action-bar] button")).map(function(b){ return b.textContent; })'), ['Accept', 'Not now']);
    assert.equal(await chrome.ev('!!document.querySelector("[data-testid=answer-reason]") || !!document.querySelector("[data-testid=btn-redo]") || !!document.querySelector("[data-testid=btn-rerun]")'), false, 'no reason box, no Redo or Rerun');
    assert.match(await chrome.ev('document.body.innerText'), /You have not seen this yet\./);
    const spill = await chrome.ev('({ vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth })');
    assert.ok(spill.scrollW <= spill.vw, JSON.stringify(spill));
    await chrome.ev('document.querySelector("[data-testid=btn-not-now]").click()');
    assert.ok(await chrome.waitFor('!document.querySelector("[data-testid=btn-accept]")'), 'the stop is gone after Not now');
    const sent = existsSync(w.dest) ? readdirSync(w.dest) : [];
    assert.deepEqual(sent, [], 'nothing was written');
  });
}
