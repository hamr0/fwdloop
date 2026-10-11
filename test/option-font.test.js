// hamr's nit: the opened list of a dropdown (its <option>s) used the system font; selects had font:inherit but options did not.
// One rule gives every option/optgroup the page font. $0: the real panel in headless chromium (skips when none is installed).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';

const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

test('browser: the options of the API shape dropdown and the Chat model menu are in the page font (Courier), not the system font', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const home = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-optfont-')), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), 'A_KEY=k-A_KEY-0123456789abcdef\n', { mode: 0o600 });
  const h = remember(await createPanelServer({ port: 0, root: mkdtempSync(path.join(tmpdir(), 'fwdloop-optfont-root-')), settings: { home, env: {} } }));
  HANDLES.push(h);
  await chrome.open(`http://127.0.0.1:${h.port}/`, 1280);
  await chrome.ev('document.getElementById("settings-open").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=prov-shape] option").length > 0'), 'the API shape dropdown has options');
  const fam = (sel) => chrome.ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).fontFamily`);
  const shape = await fam('[data-testid=prov-shape] option');
  assert.match(shape, /Courier/, `prov-shape option font-family was ${shape}`);
  const model = await fam('#jf-model option');
  assert.match(model, /Courier/, `jf-model option font-family was ${model}`);
});
