// M11 amendment 22 (docs/wiki/the-module-ladder.md): Reopen is also on the Run tab, decided by the Ask tab's one rule (`reopenOffer`), one click reopens once.
// $0: a fake modelStep in-process, the panel over real HTTP; the button itself in a real headless chromium at 1280, 390 and 320.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep, requestStop, stopParkedRun } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { listRuns } from '../src/panel/data.js';
import { answerAsk } from '../src/ask.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { killChildrenAfter, rq } from './m4e-world.mjs';

killChildrenAfter();
const HANDLES = [];
after(async () => { await Promise.all(HANDLES.map((h) => h.close())); });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const D = 86_400_000;

/** A signed job2 whose first run parks at its ask. */
async function parkedRun(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m11am22-${tag}-`));
  const w = { base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(),
    sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  assert.equal(run.outcome, 'paused', run.red);
  w.h = remember(await createPanelServer({ port: 0, root: w.root }));
  HANDLES.push(w.h);
  w.post = (url, body) => rq(w.h.port, { method: 'POST', url, body });
  w.get = (url) => rq(w.h.port, { url });
  w.row = () => listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
  w.askPath = path.join(w.runDir, 'ask.json');
  // a real expiry is in the three files the runner wrote (ask.json, asks/<id>.json, state.json); after a reopen the deadline is the reopen record's
  w.expireAt = (iso) => {
    const askId = JSON.parse(readFileSync(w.askPath, 'utf8')).askId;
    const reopens = readdirSync(w.runDir).filter((f) => /^reopen\..*\.json$/.test(f)).sort();
    const files = reopens.length > 0 ? [path.join(w.runDir, reopens.at(-1))] : [w.askPath, path.join(w.runDir, 'asks', `${askId}.json`), path.join(w.runDir, 'state.json')];
    for (const f of files) { const j = JSON.parse(readFileSync(f, 'utf8')); j.expiresAt = iso; if ('askedAt' in j) j.askedAt = new Date(Date.parse(iso) - 3_600_000).toISOString(); writeFileSync(f, JSON.stringify(j)); }
    return askId;
  };
  w.markers = () => readdirSync(w.runDir).filter((n) => n.startsWith('needs-removed-'));
  return w;
}
const stopIt = async (w) => {
  requestStop(w.runDir);
  const s = await stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(s.outcome, 'stopped', s.red);
};


const NO_ANSWER = 'Nobody answered in time.';
const LATE_ANSWER = 'Your answer came after the deadline.';
/** the Run tab's offer and the Ask tab's offer for the run, read over HTTP */
const both = async (w) => {
  const run = (await w.get('/api/runs/job2/run-1')).json().reopen;
  const asks = (await w.get('/api/runs/job2/run-1/asks')).json().asks;
  const hit = asks.filter((a) => a.reopen !== null).at(-1);
  const ask = hit ? { askId: hit.askId, ...hit.reopen } : null;
  return { run, ask };
};

test('Must fail: a reopenable expired ask has Reopen on the Ask tab but not on the Run tab, or the other way round; the why line is the Ask tab\'s (item 1, 2)', async () => {
  const w = await parkedRun('both');
  w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  const { run, ask } = await both(w);
  assert.ok(ask !== null, 'the Ask tab offers Reopen');
  assert.deepEqual(run, ask, 'the Run tab carries the Ask tab\'s own answer');
  assert.equal(run.why, NO_ANSWER);
  assert.ok(Number.isFinite(run.waitMs));
  assert.equal(typeof run.askId, 'string');
});

test('Must fail: the Run tab\'s why line is not the Ask tab\'s "Your answer came after the deadline." for a late answer (item 1)', async () => {
  const w = await parkedRun('late');
  const askId = w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  const at = new Date(Date.now() - 60_000).toISOString();   // after the deadline, before now
  writeFileSync(path.join(w.runDir, 'answer.json'), JSON.stringify({ askId, decision: 'accept', answeredAt: at, by: 'human' }));
  const { run, ask } = await both(w);
  assert.deepEqual(run, ask);
  assert.equal(run.late, true);
  assert.equal(run.why, LATE_ANSWER);
});

test('Must fail: the Run tab offers Reopen for an ask that is answered, still open, or on a run that has ended (item 1)', async () => {
  const w = await parkedRun('none');
  // still open
  assert.deepEqual(await both(w), { run: null, ask: null });
  // answered in time (the ask is still open, its answer saved)
  const r = answerAsk({ runDir: w.runDir, askId: JSON.parse(readFileSync(w.askPath, 'utf8')).askId, decision: 'accept' });
  assert.equal(r.ok, true, r.red);
  assert.deepEqual(await both(w), { run: null, ask: null });
});

test('Must fail: the Run tab offers Reopen on a run that has ended (item 1)', async () => {
  const w = await parkedRun('ended');
  w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  assert.notEqual((await both(w)).run, null, 'offered while the run is parked');
  await stopIt(w);
  assert.deepEqual(await both(w), { run: null, ask: null });
});

test('Must fail: one reopen leaves a Reopen on the Run tab or the Ask tab; a second reopen of the same ask goes through (item 3)', async () => {
  const w = await parkedRun('once');
  const askId = w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  assert.equal((await w.post('/api/reopen', { flow: 'job2', runId: 'run-1', askId })).status, 200);
  assert.deepEqual(await both(w), { run: null, ask: null }, 'both go together');
  const again = await w.post('/api/reopen', { flow: 'job2', runId: 'run-1', askId });
  assert.equal(again.status, 409, 'not expired any more: nothing reopens twice');
  assert.equal(readdirSync(w.runDir).filter((f) => /^reopen\..*\.json$/.test(f)).length, 1);
});

// ---- the button itself, in a real headless chromium: one click reopens once, both buttons go, the action row spills nothing -------------------------
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: Reopen on the Run tab with its why line; a double click reopens once; both buttons go; no spill (item 1-3)`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await parkedRun(`page${width}`);
    w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    const card = 'document.querySelector("[data-testid=rl-run-job2-run-1]")';
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!!document.querySelector("#run-actions [data-testid=run-reopen]")'), 'Reopen is in the Run tab\'s action row');
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=btn-reopen]")'), 'and on the Ask tab');
    const row = await chrome.ev(`(function(){ var el = document.getElementById("run-actions"); var vw = document.documentElement.clientWidth; var over = [];
      el.querySelectorAll("*").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + " " + (e.getAttribute("data-testid") || "") + " " + Math.round(r.right)); });
      return { vw: vw, docW: document.documentElement.scrollWidth, over: over, text: el.textContent, hint: (el.querySelector(".hint") || {}).textContent, btn: el.querySelector("[data-testid=run-reopen]").textContent }; })()`);
    console.log(`# am22 action row ${width}px ${JSON.stringify(row)}`);
    assert.deepEqual(row.over, [], 'no box in the action row past the screen');
    assert.ok(row.docW <= row.vw, `document ${row.docW}px on a ${row.vw}px screen`);
    assert.equal(row.hint, NO_ANSWER);
    assert.match(row.btn, /^Reopen for another /);
    // a double click: two clicks in the same turn; the page must send ONE request (the server would refuse a second, so count what the page sends)
    await chrome.ev('(function(){ window.__reopenPosts = 0; var real = window.fetch; window.fetch = function(u){ if(String(u) === "/api/reopen") window.__reopenPosts += 1; return real.apply(this, arguments); }; return true; })()');
    await chrome.ev('(function(){ var b = document.querySelector("#run-actions [data-testid=run-reopen]"); b.click(); b.click(); return true; })()');
    assert.ok(await chrome.waitFor('!document.querySelector("#run-actions [data-testid=run-reopen]") && !document.querySelector("[data-testid=btn-reopen]")'), 'both buttons went');
    assert.equal(readdirSync(w.runDir).filter((f) => /^reopen\..*\.json$/.test(f)).length, 1, 'one reopen record');
    assert.equal(await chrome.ev('window.__reopenPosts'), 1, 'the page sent one reopen request');
  });
}
