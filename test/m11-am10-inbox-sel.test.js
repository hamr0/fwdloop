// M11 amendment 10 item 2 ("the left side moves to the Inbox with its ask selected"): in the real page the Inbox card of the clicked
// Needs you run is selected and wears the same blue overlay as a selected Jobs run card, for a waiting ask and an expired one, and
// it stays so across the next list poll. Headless chromium over the real panel; skips when none is installed. $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

async function parkedRun(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m11sel-${tag}-`));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({ root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
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
  CLOSERS.push(() => w.h.close());
  w.expire = () => {
    const askPath = path.join(w.runDir, 'ask.json');
    const askId = JSON.parse(readFileSync(askPath, 'utf8')).askId;
    const iso = new Date(Date.now() - 3_600_000).toISOString();
    for (const f of [askPath, path.join(w.runDir, 'asks', `${askId}.json`), path.join(w.runDir, 'state.json')]) {
      const j = JSON.parse(readFileSync(f, 'utf8')); j.expiresAt = iso; if ('askedAt' in j) j.askedAt = new Date(Date.parse(iso) - 3_600_000).toISOString(); writeFileSync(f, JSON.stringify(j));
    }
  };
  return w;
}

const INBOX_ROW = '[data-testid^="inbox-row-job2-run-1"]';
async function walk(w, t) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  await chrome.ev('document.getElementById("tab-runs").click()');
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=rl-need-job2-run-1]")'), 'the Needs you card is shown');
  // the colour a selected Jobs run card wears (the page's own css, read off a real selected card)
  await chrome.ev('document.querySelector("[data-testid=rl-need-job2-run-1]").click()');
  await chrome.ev('document.getElementById("tab-runs").click()');
  const jobsBg = await chrome.ev(`(function(){ var d = document.createElement("div"); d.className = "rl-card rl-sel"; document.getElementById("panel-runs").appendChild(d); var c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
  assert.match(jobsBg, /rgba\(122, 162, 247, 0\.2\)/);
  return { chrome, jobsBg };
}
const state = (chrome) => chrome.ev(`(function(){ var r = document.querySelector(${JSON.stringify(INBOX_ROW)}); return r ? { selected: r.classList.contains("selected"), bg: getComputedStyle(r).backgroundColor, left: document.getElementById("tab-inbox").getAttribute("aria-selected") } : null; })()`);

for (const [label, expired] of [['waiting', false], ['expired (Reopen)', true]]) {
  test(`${label} Needs you click: the run's Inbox card is selected, wears the Jobs selected blue, and keeps it after a list poll`, async (t) => {
    const w = await parkedRun(expired ? 'exp' : 'wait');
    if (expired) w.expire();
    const g = await walk(w, t);
    if (!g) return;
    const { chrome, jobsBg } = g;
    await chrome.ev('document.getElementById("tab-runs").click()');
    await chrome.ev('document.querySelector("[data-testid=rl-need-job2-run-1]").click()');
    assert.ok(await chrome.waitFor(`document.getElementById("tab-inbox").getAttribute("aria-selected") === "true" && !!document.querySelector(${JSON.stringify(INBOX_ROW + '.selected')})`), `Inbox card selected: ${JSON.stringify(await state(chrome))}`);
    assert.equal((await state(chrome)).bg, jobsBg, 'same blue overlay as a selected Jobs run card');
    await chrome.ev('reloadLists()');
    await new Promise((r) => { setTimeout(r, 1500); });
    const after2 = await state(chrome);
    assert.equal(after2.selected, true, 'still selected after the list reload');
    assert.equal(after2.bg, jobsBg);
  });
}

// hamr's walk after 7c7415d: the selected Inbox card must look like a selected Jobs card (border colour AND width AND overlay, both themes)
// and be in the viewport after a Needs you click.
const look = (chrome) => chrome.ev(`(function(){
  var r = document.querySelector(${JSON.stringify(INBOX_ROW + '.selected')});
  var d = document.createElement("div"); d.className = "rl-card rl-sel"; document.getElementById("panel-runs").appendChild(d);
  var j = getComputedStyle(d), i = r && getComputedStyle(r), rect = r && r.getBoundingClientRect();
  var out = { inbox: i && { bc: i.borderTopColor, bl: i.borderLeftColor, bw: i.borderTopWidth, blw: i.borderLeftWidth, bg: i.backgroundColor },
    jobs: { bc: j.borderTopColor, bw: j.borderTopWidth, bg: j.backgroundColor },
    inView: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight };
  d.remove(); return out; })()`);

for (const theme of ['light', 'dark']) {
  test(`Needs you click (${theme}): the selected Inbox card has the border colour, width and overlay of a selected Jobs card and is in view`, async (t) => {
    const w = await parkedRun(`look-${theme}`);
    const g = await walk(w, t);
    if (!g) return;
    const { chrome } = g;
    await chrome.ev(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
    // a short window: the Inbox card sits below the fold until the click scrolls it into view
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 200, deviceScaleFactor: 1, mobile: false });
    await chrome.ev('document.getElementById("tab-runs").click()');
    await chrome.ev('document.querySelector("[data-testid=rl-need-job2-run-1]").click()');
    assert.ok(await chrome.waitFor(`!!document.querySelector(${JSON.stringify(INBOX_ROW + '.selected')})`), 'Inbox card selected');
    await new Promise((r) => { setTimeout(r, 600); });
    const s = await look(chrome);
    if (process.env.SHOT_DIR) {
      mkdirSync(process.env.SHOT_DIR, { recursive: true });
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
      await chrome.screenshot(path.join(process.env.SHOT_DIR, `inbox-sel-${theme}.png`));
      if (theme === 'light') { await chrome.ev('document.getElementById("tab-runs").click()'); await chrome.screenshot(path.join(process.env.SHOT_DIR, 'jobs-sel-light.png')); }
    }
    assert.equal(s.inbox.bc, s.jobs.bc, `border colour ${JSON.stringify(s)}`);
    assert.equal(s.inbox.bl, s.jobs.bc, `left border colour ${JSON.stringify(s)}`);
    assert.equal(s.inbox.bw, s.jobs.bw, 'border width');
    assert.equal(s.inbox.blw, s.jobs.bw, 'left border width');
    assert.equal(s.inbox.bg, s.jobs.bg, 'overlay');
    assert.equal(s.inView, true, 'the card is within the viewport');
  });
}
