// M6 am11: Reuse workflow fills Cap $ with the job's SIGNED cap, never an earlier run's post-drafting cap; the box left at the signed cap is
// not a changed cap (the button stays Run, not Sign & run). Real browser (skips when no chromium).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld, CAT } from './m9-trigger-world.mjs';
import { readFlow } from '../src/flow.js';
import { flowValues, valuesHash, writeRunValues } from '../src/runvalues.js';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const BTN = 'document.getElementById("chat-main-btn")';
const CAP = 'document.getElementById("jf-run-cap")';

/** A once-green job2 whose seed run was signed at a LOWER cap (what is left after drafting, e.g. $0.20 of the signed $0.25). */
async function openReuse() {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const { w } = await greenWorld();
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  const read = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  const signed = flowValues(read.arbiter);
  const values = { ...signed, capUsd: 0.2 };
  const hash = valuesHash({ flow: 'job2', flowSignatureHash: read.signature.flow, runId: null, version: 0, values });
  const wr = writeRunValues(path.join(w.root, 'job2', 'runs', 'seed-pass'), {
    flow: 'job2', flowSignatureHash: read.signature.flow, runId: 'seed-pass', version: 0, values, hash, signedBy: 'test', at: '2026-10-06T10:00:00.000Z',
  });
  assert.ok(wr.ok, wr.red);
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "seed-pass"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-jobbox") && document.getElementById("jf-run-jobbox").value.length > 0'));
  return { chrome, signedCap: String(signed.capUsd) };
}

test('Reuse of a run signed at a lower cap fills Cap $ with the job\'s signed cap, and the button stays Run', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openReuse();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, signedCap } = o;
  assert.equal(await chrome.ev('document.getElementById("rw-picked-txt").textContent'), 'job2 (seed-pass)', 'the picked item is the run');
  assert.equal(await chrome.ev(`${CAP}.value`), signedCap, 'the signed cap, not the run\'s 0.2');
  assert.ok(await chrome.waitFor(`/^Run now/.test(${BTN}.textContent)`), `label: ${await chrome.ev(`${BTN}.textContent`)}`);
  await new Promise((r) => setTimeout(r, 600));   // the server's reuse-check answer lands; the label must still be Run
  assert.match(await chrome.ev(`${BTN}.textContent`), /^Run now/);
  assert.equal(await chrome.ev(`${CAP}.value`), signedCap);
});

test('a cap really changed from the signed one is still Sign & run', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openReuse();
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  await chrome.ev(`(function(){ var e = ${CAP}; e.value = "0.2"; e.dispatchEvent(new Event("input", {bubbles: true})); })()`);
  assert.ok(await chrome.waitFor(`${BTN}.textContent === "Sign & run"`), `label: ${await chrome.ev(`${BTN}.textContent`)}`);
});
