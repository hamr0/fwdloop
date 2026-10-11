// hamr, live, on the Ask tab at an ask: "when i scroll down any of the 3 text boxes, it scrolls back up, can't read."
// Root cause: every ask payload carries `timeLeftMs`, which differs on every poll, so the page's "unchanged payload" signature never matched and the
// whole Ask tab was rebuilt every 2 s (its evidence boxes new elements, scrollTop 0). Standing rule: never re-render over what the human is reading.
// $0: a parked run from the CLI's fake model step, the real panel, headless chromium (skips when none is installed).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
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
const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));

const LONG = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n${`Line of long evidence text number ${i}. `.repeat(12)}`).join('\n\n');

/** job2 parked at its ask with long evidence text in every artifact. Returns { root, home, runDir, askId }. */
function parked() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-askscroll-'));
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
  const askId = /askId=(\S+)/.exec(r.stdout)[1];
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const longen = (o) => { if (Array.isArray(o)) o.forEach(longen); else if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'text' && typeof o[k] === 'string') o[k] = LONG; else longen(o[k]); } return o; };
  for (const f of [...readdirSync(path.join(runDir, 'artifacts')).map((n) => path.join(runDir, 'artifacts', n)), path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`)]) {
    writeFileSync(f, JSON.stringify(longen(JSON.parse(readFileSync(f, 'utf8')))));
  }
  return { root, home, runDir, askId };
}

const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const BOXES = 'document.querySelectorAll("#ask-list .ro-value.scroll")';

async function open(width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const world = parked();
  const h = remember(await createPanelServer({ port: 0, root: world.root, settings: { home: world.home, env: {} } }));
  HANDLES.push(h);
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  // count every Ask poll the page makes, so "waited more than two refresh ticks" is a count, not a guess
  await chrome.ev(`window.__asks = 0; (function(){ var f = window.fetch; window.fetch = function(u){ if(String(u).indexOf("/asks") !== -1) window.__asks++; return f.apply(this, arguments); }; })()`);
  await chrome.ev('document.getElementById("tab-ask").click()');
  assert.ok(await chrome.waitFor(`${BOXES}.length >= 3`), 'the ask shows its evidence boxes');
  return { chrome, world };
}

for (const width of [1280, 390]) {
  test(`browser ${width}px: a scrolled evidence box keeps its scroll (and its element) across more than two refresh ticks; the time left still counts down`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    const left = () => chrome.ev('(Array.from(document.querySelectorAll("#ask-list .wf-meta")).map(function(e){ return e.textContent; }).filter(function(t){ return t.indexOf("time left: ") === 0; })[0]) || null');
    const left0 = await left();
    assert.match(left0, /^time left: /);
    // scroll every box, mark it, remember the tick count
    const set = await chrome.ev(`(function(){ var n = 0; ${BOXES}.forEach(function(b, i){ b.__mark = "m" + i; b.scrollTop = 200 + i * 50; n += b.scrollTop > 0 ? 1 : 0; }); return n; })()`);
    assert.ok(set >= 3, 'every box really scrolled');
    const ticks0 = await chrome.ev('window.__asks');
    assert.ok(await chrome.waitFor(`window.__asks >= ${ticks0 + 3}`, 15000), 'three more Ask polls happened');
    const after2 = await chrome.ev(`Array.prototype.map.call(${BOXES}, function(b){ return [b.__mark || null, b.scrollTop]; })`);
    assert.deepEqual(after2.map((x) => x[0]), ['m0', 'm1', 'm2', ...after2.slice(3).map(() => null)].slice(0, after2.length), 'the same boxes: nothing was rebuilt');
    assert.ok(after2.slice(0, 3).every(([, top], i) => top === 200 + i * 50), `scrollTop unchanged, got ${JSON.stringify(after2)}`);
    assert.notEqual(await left(), left0, 'the time left is kept fresh in place');
  });
}

test('browser: when the ask payload really changes the Ask tab does redraw, and the scrolled boxes keep their scrollTop', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome, world } = o;
  await chrome.ev(`${BOXES}.forEach(function(b, i){ b.__mark = "old"; b.scrollTop = 300; })`);
  // a real change: the ask's wording (the books are the page's source of truth)
  for (const f of [path.join(world.runDir, 'ask.json'), path.join(world.runDir, 'asks', `${world.askId}.json`)]) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.question = 'check it with me, again';
    writeFileSync(f, JSON.stringify(j));
  }
  assert.ok(await chrome.waitFor(`document.getElementById("ask-list").textContent.indexOf("check it with me, again") !== -1`, 15000), 'the page redrew from the changed books');
  const now = await chrome.ev(`Array.prototype.map.call(${BOXES}, function(b){ return [b.__mark || null, b.scrollTop]; })`);
  assert.ok(now.every(([mark]) => mark === null), 'these are new boxes (a real redraw)');
  assert.ok(now.slice(0, 3).every(([, top]) => top > 0), `scrollTop kept across the redraw, got ${JSON.stringify(now)}`);
});

test('browser 390px: the Inbox row and the Runs detail pane are not rebuilt by a refresh tick: same row element, same Run detail nodes; the Inbox time left counts down in place', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(390);
  if (!o) { t.skip('no chromium installed'); return; }
  const { chrome } = o;
  await chrome.ev(`(function(){ var f = window.fetch; window.fetch = function(u){ if(String(u).indexOf("/api/inbox") !== -1) window.__inbox = (window.__inbox || 0) + 1; return f.apply(this, arguments); }; })()`);
  // Runs detail: mark a node deep inside it; a rebuild would drop the mark
  await chrome.ev('document.getElementById("tab-run").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("#run-content *").length > 10'), 'the Run detail is drawn');
  await chrome.ev('(function(){ var all = document.querySelectorAll("#run-content *"); all[all.length - 1].__mark = "deep"; window.__deep = all[all.length - 1]; })()');
  // Inbox row
  await chrome.ev('document.getElementById("tab-inbox").click()');
  assert.ok(await chrome.waitFor('document.querySelectorAll("#inbox-list .inbox-row").length === 1'));
  const meta = () => chrome.ev('document.querySelector("#inbox-list .inbox-row [data-testid=inbox-sign-word]").textContent');
  const left0 = await meta();
  assert.match(left0, /time left: /);
  await chrome.ev('document.querySelector("#inbox-list .inbox-row").__mark = "row"');
  const n0 = (await chrome.ev('window.__inbox || 0'));
  assert.ok(await chrome.waitFor(`(window.__inbox || 0) >= ${n0 + 1}`, 20000), 'one more Inbox poll happened');
  assert.equal(await chrome.ev('document.querySelector("#inbox-list .inbox-row").__mark || null'), 'row', 'the same row element');
  assert.notEqual(await meta(), left0, 'time left moved in place');
  assert.ok(await chrome.ev('window.__deep.isConnected && window.__deep.__mark === "deep"'), 'the Run detail was not rebuilt by the tick');
});
