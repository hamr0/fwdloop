// M12 piece 1: a ticket role's Run row keeps its Inputs row, is editable, starts empty, placeholder `a ticket under <list address>`; a page row stays read-only;
// a file trigger is never offered a ticket role. Real-browser walk of the real panel (headless chromium; skips when none). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, world, HERE } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';
import { writeFlow } from '../src/flow.js';
import { writeModelRecord } from '../src/flowmodel.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const LIST = 'https://github.com/hamr0/bareloop/issues?q=is:open+label:fwdloop';
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

test('a ticket row is editable, empty, with the exact placeholder; no file trigger is offered for it; nothing spills at 390', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(() => chrome.close());
  const w = await world({ limit: 5 });
  const prose = sandboxSend(fixture('job2-with-sources.signed.txt')).replace(/guardrail: source jd = file:.*\n?/, `guardrail: source jd = tickets:${LIST}\n`);
  const wr = writeFlow({ root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-27T12:00:00Z', catalogue: loadCatalogue().primitives });
  assert.equal(wr.ok, true);
  writeModelRecord(path.join(w.root, 'job2'), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# R\n');
  seedGreen(w);
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 390);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev('document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = "job2"; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("#jf-run-inputs .jf-path").length === 2'));
  const row = await chrome.ev(`(function(){ var rows = document.querySelectorAll("#jf-run-inputs .jf-inrow"); var el = rows[1].querySelector(".jf-path"); var r = el.getBoundingClientRect();
    return {role: rows[1].querySelector(".jf-role-ro").textContent, value: el.value, ph: el.placeholder, ro: el.readOnly, page: el.getAttribute("data-page"), right: Math.round(r.right), docW: document.documentElement.scrollWidth, winW: window.innerWidth}; })()`);
  assert.equal(row.role, 'jd');
  assert.equal(row.value, '');
  assert.equal(row.ph, `a ticket under ${LIST}`);
  assert.equal(row.ro, false);
  assert.equal(row.page, null);
  assert.ok(row.docW <= row.winW && row.right <= row.winW, JSON.stringify(row));
  assert.ok(await chrome.waitFor('document.getElementById("jf-when") && !document.getElementById("jf-when").disabled'));
  const roles = await chrome.ev('Array.prototype.map.call(document.getElementById("jf-when-role").options, function(o){ return o.value; })');
  assert.deepEqual(roles, ['resume']);
});
