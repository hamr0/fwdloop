// M10 amendment 4 (docs/wiki/the-module-ladder.md): the Result tab, copied byte for byte from bareloop (src/panel/index.html@2959217).
// The page only draws; the DOM-diff feeds bareloop's own exported /result JSON (test/fixtures/m10-result/result-mvfphtwl.json) to OUR renderer and compares
// its #result-body to bareloop's rendered export of the same run (result-body.html). Any difference is a red, except the two named below.
// $0: a parked run from the CLI's fake model step (job2 reads a .docx, so it is an M10 job), the real panel, headless chromium.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const GOLDEN_JSON = JSON.parse(fixture('m10-result/result-mvfphtwl.json'));
const GOLDEN_HTML = fixture('m10-result/result-body.html');
const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

/** job2 (reads resume.docx + jd.md) parked at its ask by the CLI's fake model step: $0. */
export function parkedM10() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am4-'));
  const root = path.join(base, 'flows');
  const src = path.join(base, 'src');
  const home = path.join(base, 'cfg', 'fwdloop');
  for (const d of [root, src, home]) mkdirSync(d, { recursive: true });
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives,
  });
  assert.equal(w.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, DEEPSEEK_API_KEY: 'test-key-not-real', FWDLOOP_TEST_MODEL_STEP: path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs') };
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'fwdloop'), 'run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return { root, home, runDir: path.join(root, 'job2', 'runs', 'run-1') };
}

/**
 * In-page, before any script runs: the run's detail answers with `detailPatch` laid over the real one, and the Result route answers `resultBody`.
 * Everything else is the real panel's.
 */
async function open(width, { detailPatch = {}, resultBody = null, world = parkedM10() } = {}) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const h = remember(await createPanelServer({ port: 0, root: world.root, settings: { home: world.home, env: {} } }));
  HANDLES.push(h);
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){ var f = window.fetch; var patch = ${JSON.stringify(detailPatch)}; var body = ${JSON.stringify(resultBody)};
      window.fetch = function(u){
        var s = String(u);
        if(body && /\\/api\\/runs\\/[^/]+\\/[^/]+\\/result$/.test(s)) return Promise.resolve(new Response(JSON.stringify(body), {status: 200, headers: {"content-type": "application/json"}}));
        if(/\\/api\\/runs\\/[^/]+\\/[^/]+$/.test(s)) return f.apply(this, arguments).then(function(r){ return r.json().then(function(d){ return new Response(JSON.stringify(Object.assign(d, patch)), {status: 200, headers: {"content-type": "application/json"}}); }); });
        return f.apply(this, arguments);
      }; })()`,
  });
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the page opened the newest run');
  return { chrome, world, port: h.port };
}

// The two allowed differences, named. Anything else is a red.
//  1. fwdloop's Run tab words its money line "<spend> of <cap> cap" (its own caption); bareloop's has no " cap".
//  2. fwdloop's routes are /api/runs/<flow>/<runId>/..., bareloop's /api/runs/<runid>/...
const norm = (h) => h.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ open=""/g, '').trim();
const ours = (h) => norm(h).replace('$0.04 of $1.00 cap<', '$0.04 of $1.00<').replace('/api/runs/flight-revised/run-3/download', '/api/runs/mvfphtwl/download');

const DETAIL = { hasResult: true, word: 'passed', glyph: '[✓]', checkType: 'rubric', flow: 'flight-revised', runId: 'run-3', spend: '$0.04', capUsd: 1, wallMs: 91000 };
const RESULT = { ...GOLDEN_JSON, flow: 'flight-revised', runId: 'run-3' };
delete RESULT.runid;

test('browser 1280: the Result tab sits fifth (Run, Audit / logs, Job, Ask, Result) and is shown for an M10 job', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const tabs = await o.chrome.ev('Array.from(document.querySelectorAll(".rp-tabrow button")).filter(function(b){ return !b.hidden; }).map(function(b){ return b.getAttribute("data-testid") + "|" + b.textContent; })');
  assert.deepEqual(tabs, ['right-tab-run|Run', 'right-tab-audit|Audit / logs', 'right-tab-details|Job', 'right-tab-ask|Ask', 'right-tab-result|Result']);
});

test('browser: a run that is not an M10 job has no Result tab', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { detailPatch: { hasResult: false } });
  if (!o) { t.skip('no chromium installed'); return; }
  assert.equal(await o.chrome.ev('document.getElementById("tab-result").hidden'), true);
  const tabs = await o.chrome.ev('Array.from(document.querySelectorAll(".rp-tabrow button")).filter(function(b){ return !b.hidden; }).map(function(b){ return b.getAttribute("data-testid"); })');
  assert.deepEqual(tabs, ['right-tab-run', 'right-tab-audit', 'right-tab-details', 'right-tab-ask']);
});

test('browser: empty states use bareloop\'s words ("select a run first"; the panel is empty before a run is chosen)', () => {
  const page = readFileSync(path.join(REPO, 'src', 'panel', 'index.html'), 'utf8');
  assert.match(page, /<div id="result-empty" class="hint"[^>]*>select a run first<\/div>/);
});

test('DOM-diff 1280: our renderer, fed bareloop\'s /result JSON for run mvfphtwl, draws bareloop\'s #result-body (minus the Your-call card, not built)', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { detailPatch: DETAIL, resultBody: RESULT });
  if (!o) { t.skip('no chromium installed'); return; }
  await o.chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await o.chrome.waitFor('document.getElementById("result-body").innerHTML.length > 100'), 'the Result tab drew');
  await o.chrome.ev('document.querySelectorAll("#result-body details").forEach(function(d){ d.open = true; })');
  const got = ours(await o.chrome.ev('document.getElementById("result-body").outerHTML'));
  // the golden was exported while the run waited for its accept; the Your-call card (item 5) is not part of this piece
  const want = norm(GOLDEN_HTML).replace(/<div class="job-card" id="result-door-card".*?<div id="result-door-msg" data-testid="result-door-msg"><\/div><\/div>/, '');
  assert.equal(want.includes('result-door'), false, 'the golden minus the door card');
  assert.equal(got, want);
});
