// M10 amendment 4 (docs/wiki/the-module-ladder.md): the Result tab, copied byte for byte from bareloop (src/panel/index.html@2959217).
// The page only draws; the DOM-diff feeds bareloop's own exported /result JSON (test/fixtures/m10-result/result-mvfphtwl.json) to OUR renderer and compares
// its #result-body to bareloop's rendered export of the same run (result-body.html). Any difference is a red, except the two named below.
// $0: a parked run from the CLI's fake model step (job2 reads a .docx, so it is an M10 job), the real panel, headless chromium.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync,
} from 'node:fs';
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
async function open(width, {
  detailPatch = {}, resultBody = null, world = parkedM10(), stubAnswer = false,
} = {}) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const h = remember(await createPanelServer({ port: 0, root: world.root, settings: { home: world.home, env: {} } }));
  HANDLES.push(h);
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){ var f = window.fetch; var patch = ${JSON.stringify(detailPatch)}; var body = ${JSON.stringify(resultBody)}; var stub = ${JSON.stringify(stubAnswer)};
      window.__posts = [];
      window.fetch = function(u, init){
        var s = String(u);
        if(stub && /\\/api\\/answer$/.test(s) && init && init.method === "POST"){ window.__posts.push(JSON.parse(init.body)); return Promise.resolve(new Response(JSON.stringify({ok: true}), {status: 202, headers: {"content-type": "application/json"}})); }
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
// the label rides the payload (am41 item 3: the page holds no copy of these words); bareloop's page has it in the source, the text drawn is the same
const RESULT = { ...GOLDEN_JSON, flow: 'flight-revised', runId: 'run-3', notCheckedLabel: "Not checked (the AI's own reading)" };
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

test('DOM-diff 1280: our renderer, fed bareloop\'s /result JSON for run mvfphtwl, draws bareloop\'s #result-body (the Your-call card minus its Pause button, am5 item 2)', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { detailPatch: DETAIL, resultBody: RESULT });
  if (!o) { t.skip('no chromium installed'); return; }
  await o.chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await o.chrome.waitFor('document.getElementById("result-body").innerHTML.length > 100'), 'the Result tab drew');
  await o.chrome.ev('document.querySelectorAll("#result-body details").forEach(function(d){ d.open = true; })');
  // the golden was exported while the run waited for its accept, with the rerun box open (the person pressed "Rerun with my words")
  await o.chrome.ev('document.querySelector("[data-testid=result-rerun-open]").click()');
  const got = ours(await o.chrome.ev('document.getElementById("result-body").outerHTML'));
  // am5 item 2: fwdloop's Your call has no Pause (a run waiting for you stays open and spends nothing). Everything else is bareloop's, byte for byte.
  const PAUSE = '<button class="btn" type="button" data-testid="result-pause">Pause</button>';
  assert.ok(norm(GOLDEN_HTML).includes(PAUSE), 'the golden has the Pause button this test removes');
  const want = norm(GOLDEN_HTML).replace(PAUSE, '');
  assert.ok(want.includes('id="result-door-card"') && !want.includes('result-pause'));
  assert.equal(got, want);
});

// ---- M10 am5 item 2: the Your-call card ----
const resultTab = async (o) => {
  await o.chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await o.chrome.waitFor('document.getElementById("result-body").innerHTML.length > 100'), 'the Result tab drew');
};
const doorDetail = { ...DETAIL, flow: 'job2', runId: 'run-1' };

test('the Your-call card has Accept and Rerun with my words, and no Pause; bareloop\'s words come from the server\'s payload', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { detailPatch: DETAIL, resultBody: RESULT });
  if (!o) { t.skip('no chromium installed'); return; }
  await resultTab(o);
  assert.deepEqual(await o.chrome.ev('Array.from(document.querySelectorAll("#result-door-card button")).map(function(b){ return b.textContent; })'), ['Accept', 'Rerun with my words', 'Rerun']);
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=result-pause]")'), null);
  assert.equal(await o.chrome.ev('document.querySelector("#result-door-card .st-word").textContent'), 'waiting for you');
  assert.match(await o.chrome.ev('document.querySelector("#result-door-card .ro-value").textContent'), /the checks passed; is this what you wanted\?$/);
});

test('no door in the payload, no card (a run nobody is waiting on)', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { detailPatch: DETAIL, resultBody: { ...RESULT, door: null } });
  if (!o) { t.skip('no chromium installed'); return; }
  await resultTab(o);
  assert.equal(await o.chrome.ev('document.getElementById("result-door-card")'), null);
});

// the Result tab's Accept is the Ask tab's Accept: the same route, the same body (ONE writer of the answer)
test('Accept on the Result tab posts exactly what Accept on the Ask tab posts', { skip: SKIP && 'no browser' }, async (t) => {
  const ask = await open(1280, { stubAnswer: true });
  if (!ask) { t.skip('no chromium installed'); return; }
  await ask.chrome.ev('document.getElementById("tab-ask").click()');
  assert.ok(await ask.chrome.waitFor('!!document.querySelector("[data-testid=btn-accept]")'), 'the Ask tab has its Accept');
  await ask.chrome.ev('document.querySelector("[data-testid=btn-accept]").click()');
  assert.ok(await ask.chrome.waitFor('window.__posts.length === 1'));
  const fromAsk = await ask.chrome.ev('window.__posts[0]');
  const res = await open(1280, { stubAnswer: true, world: ask.world });
  await resultTab(res);
  assert.ok(await res.chrome.waitFor('!!document.querySelector("[data-testid=result-accept]")'), 'the real run waits, so its real /result carries the door');
  await res.chrome.ev('document.querySelector("[data-testid=result-accept]").click()');
  assert.ok(await res.chrome.waitFor('window.__posts.length === 1'));
  const fromResult = await res.chrome.ev('window.__posts[0]');
  assert.deepEqual(fromResult, fromAsk);
  assert.equal(fromResult.decision, 'accept');
  assert.equal(fromResult.flow, 'job2');
  assert.match(fromResult.askId, /\S/);
});

test('Rerun with my words is the Ask tab\'s rerun: decision rerun, the words as the reason; empty words send nothing', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { stubAnswer: true });
  if (!o) { t.skip('no chromium installed'); return; }
  await resultTab(o);
  assert.ok(await o.chrome.waitFor('!!document.querySelector("[data-testid=result-rerun-open]")'));
  await o.chrome.ev('document.querySelector("[data-testid=result-rerun-open]").click()');
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=result-rerun]").disabled'), true, 'empty words: the button is off');
  await o.chrome.ev('document.querySelector("[data-testid=result-rerun]").click()');
  assert.equal(await o.chrome.ev('window.__posts.length'), 0, 'a click on the disabled button sends nothing');
  await o.chrome.ev('var t = document.getElementById("result-rerun-text"); t.value = "only morning flights"; t.dispatchEvent(new Event("input"))');
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=result-rerun]").disabled'), false);
  await o.chrome.ev('document.querySelector("[data-testid=result-rerun]").click()');
  assert.ok(await o.chrome.waitFor('window.__posts.length === 1'));
  const p = await o.chrome.ev('window.__posts[0]');
  assert.deepEqual([p.decision, p.reason, p.flow, p.runId], ['rerun', 'only morning flights', 'job2', 'run-1']);
});

test('words typed in the rerun box (and the open box) survive the tab being drawn again', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280, { stubAnswer: true });
  if (!o) { t.skip('no chromium installed'); return; }
  await resultTab(o);
  assert.ok(await o.chrome.waitFor('!!document.querySelector("[data-testid=result-rerun-open]")'));
  await o.chrome.ev('document.querySelector("[data-testid=result-rerun-open]").click(); var t = document.getElementById("result-rerun-text"); t.value = "half typed"; t.dispatchEvent(new Event("input"))');
  await o.chrome.ev('window.__before = document.getElementById("result-door-card"); document.getElementById("tab-result").click()');
  assert.ok(await o.chrome.waitFor('document.getElementById("result-door-card") !== window.__before'), 'the card was drawn again');
  assert.equal(await o.chrome.ev('document.getElementById("result-rerun-text").value'), 'half typed');
  assert.equal(await o.chrome.ev('document.getElementById("result-rerun-box").hidden'), false);
  assert.equal(await o.chrome.ev('document.querySelector("[data-testid=result-rerun]").disabled'), false);
});

test('one writer: the page posts an answer from exactly one function, and the door buttons go through it', () => {
  const page = readFileSync(path.join(REPO, 'src', 'panel', 'index.html'), 'utf8');
  assert.equal((page.match(/postJSON\("\/api\/answer"/g) ?? []).length, 1);
  const wire = page.slice(page.indexOf('function wireResultDoor'), page.indexOf('function wireResultDoor') + 1800);
  assert.equal((wire.match(/sendAnswer\(card, ask, ctx, "/g) ?? []).length, 2);
  assert.doesNotMatch(wire, /authorPost|postJSON|fetch\(/);
});

test('a real Accept on the Result tab saves the answer in the run\'s own folder, and the Ask tab then shows no doors for that ask (accepted anywhere is accepted everywhere)', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  await resultTab(o);
  assert.ok(await o.chrome.waitFor('!!document.querySelector("[data-testid=result-accept]")'));
  await o.chrome.ev('document.querySelector("[data-testid=result-accept]").click()');
  const saved = () => readdirSync(o.world.runDir).filter((f) => /^answer(\..*consumed)?\.json$/.test(f));
  for (let i = 0; i < 100 && saved().length === 0; i += 1) await new Promise((r) => { setTimeout(r, 100); }); // eslint-disable-line no-await-in-loop
  assert.ok(saved().length > 0, 'the answer is on disk');
  const door = await o.chrome.ev('fetch("/api/runs/job2/run-1/result").then(function(r){ return r.json(); }).then(function(a){ return a.door; })');
  assert.equal(door, null, 'the Result tab\'s door is gone');
});

// ---- M10 am9 item 2: the checks a step ran, one row each ----
test('browser 1280: a line with checks lists each one, ✓ or ✗, in the Audit try line\'s words (text and the result in brackets); a failed one shows ✗ and its reason', { skip: SKIP && 'no browser' }, async (t) => {
  const line = {
    n: 1, text: 'list every expense over 500', rules: [], kind: 'text', passed: false, file: null, notChecked: [],
    checks: [
      { ok: true, text: 'cells only from column \'Amount\'', result: null },
      { ok: true, text: 'every cited cell is in the saved sheet', result: '6 of 6' },
      { ok: false, text: 'at most 600 words', result: '700 words' },
    ],
  };
  const o = await open(1280, { detailPatch: DETAIL, resultBody: { ...RESULT, lines: [line], pages: [], pageNote: null } });
  if (!o) { t.skip('no chromium installed'); return; }
  await resultTab(o);
  const rows = await o.chrome.ev('Array.from(document.querySelectorAll("[data-testid=result-check]")).map(function(e){ return e.textContent; })');
  assert.deepEqual(rows, ['\u2713 cells only from column \'Amount\'', '\u2713 every cited cell is in the saved sheet (6 of 6)', '\u2717 at most 600 words (700 words)']);
  assert.equal(await o.chrome.ev('document.querySelectorAll("[data-testid=result-check] .rs-bad").length'), 1);
});
