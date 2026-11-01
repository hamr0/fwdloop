// M13 piece 5 (item 7, mock Part 1 and Part 2): the Schedule row on the New job card and the Run card's grey line, in the real panel (headless chromium; skips only when none is installed),
// at 1280, 390 and 320. The options follow the flow type, the time box and the two hints follow the pick, the card sends the schedule it shows, and nothing is wider than the screen. $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, rq, world } from './m4e-world.mjs';
import { LIST, ticketJob } from './m12-p2-world.mjs';
import { ledgerOf, readSchedule } from '../src/schedule.js';
import { readRows } from '../src/trigger-clock.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, writeRunJobCopy } from '../src/flow.js';
import { createTriggerDoor } from '../src/panel/authortrigger.js';

killChildrenAfter();
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const OLD_HOME = process.env.HOME;
after(() => { process.env.HOME = OLD_HOME; });

async function open(width, setup = () => {}) {
  const w = await world({ limit: 5 });
  const home = path.join(w.work, 'home');
  mkdirSync(home);
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  process.env.HOME = home;
  setup(w);
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  await chrome.ev('document.getElementById("tab-chat").click()');
  assert.ok(await chrome.waitFor('!!document.getElementById("jf-sched")'), 'the card has a Schedule');
  return { chrome, w };
}
const setSel = (c, id, value) => c.ev(`var s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", {bubbles: true}))`);
const SPILL = '({ vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth })';
const shown = (c, id) => c.ev(`!document.getElementById(${JSON.stringify(id)}).hidden`);
const optionsOf = (c) => c.ev('Array.from(document.getElementById("jf-sched").options).filter(function(o){ return !o.hidden && !o.disabled; }).map(function(o){ return o.textContent; })');

for (const width of [1280, 390, 320]) {
  test(`the Schedule row at ${width}px: the mock's words per flow type, the time box and hints follow the pick, no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const c = o.chrome;
    assert.equal(await c.ev('document.querySelector("label[for=jf-sched]").textContent'), 'Schedule');
    assert.equal(await c.ev('document.getElementById("jf-sched").value'), 'hand');
    assert.deepEqual(await optionsOf(c), ['By hand', 'Every day at HH:MM'], 'plain');
    assert.equal(await shown(c, 'jf-sched-hint'), false, 'By hand has no hint');
    await setSel(c, 'jf-flowtype', 'mcp');
    assert.deepEqual(await optionsOf(c), ['By hand', 'Every day at HH:MM'], 'MCP (generic)');
    await setSel(c, 'jf-flowtype', 'tickets');
    assert.deepEqual(await optionsOf(c), ['By hand', 'When a new ticket arrives', 'Every day at HH:MM'], 'Tickets');
    await setSel(c, 'jf-sched', 'new-ticket');
    assert.equal(await c.ev('document.getElementById("jf-sched-hint").textContent'), 'off until the first green run, then turns on');
    assert.equal(await c.ev('document.getElementById("jf-sched-ticket-hint").textContent'), 'the first run reads the newest ticket at the time it starts; older tickets never run');
    assert.deepEqual([await shown(c, 'jf-sched-hint'), await shown(c, 'jf-sched-ticket-hint'), await shown(c, 'jf-sched-clock')], [true, true, false]);
    await setSel(c, 'jf-sched', 'daily');
    assert.deepEqual([await shown(c, 'jf-sched-hint'), await shown(c, 'jf-sched-ticket-hint'), await shown(c, 'jf-sched-clock')], [true, false, true]);
    const spill = await c.ev(SPILL);
    assert.ok(spill.scrollW <= spill.vw, `Schedule at ${width}: ${JSON.stringify(spill)}`);
    const row = await c.ev('(function(){ var r = document.getElementById("jf-sched-field").getBoundingClientRect(); return { left: r.left, right: r.right, vw: document.documentElement.clientWidth }; })()');
    assert.ok(row.left >= 0 && row.right <= row.vw, `the Schedule row stays inside the screen at ${width}: ${JSON.stringify(row)}`);
    // leaving Tickets takes the ticket choice away and the card falls back to By hand
    await setSel(c, 'jf-sched', 'new-ticket');
    await setSel(c, 'jf-flowtype', 'plain');
    assert.equal(await c.ev('document.getElementById("jf-sched").value'), 'hand');
    assert.deepEqual(await optionsOf(c), ['By hand', 'Every day at HH:MM']);
  });
}

test('the card sends the schedule it shows: Every day at 07:05 is {kind daily, hour 7, minute 5}; By hand sends none; a wiped time is refused under the Schedule box', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await open(1280);
  if (!o) { t.skip('no chromium installed'); return; }
  const c = o.chrome;
  await c.ev('window.__bodies = []; var of = window.fetch; window.fetch = function(u, op){ if(String(u).indexOf("/api/author/draft") !== -1) window.__bodies.push(op.body); return of.apply(this, arguments); }');
  const set = (id, v) => c.ev(`var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", {bubbles: true}))`);
  await set('jf-name', 'sched-card');
  await set('jf-job', 'Read what comes in\nWrite it out');
  await set('jf-cap-money', '0.25');
  await setSel(c, 'jf-sched', 'daily');
  await set('jf-sched-time', '07:05');
  assert.ok(await c.waitFor('document.getElementById("chat-main-btn").disabled === false'));
  await c.ev('document.getElementById("chat-main-btn").click()');
  assert.ok(await c.waitFor('window.__bodies.length === 1'));
  assert.deepEqual(JSON.parse(await c.ev('window.__bodies[0]')).schedule, { kind: 'daily', hour: 7, minute: 5 });
  // a wiped time box is refused by the server under the Schedule box
  await set('jf-sched-time', '');
  assert.ok(await c.waitFor('document.getElementById("chat-main-btn").disabled === false'));
  await c.ev('document.getElementById("chat-main-btn").click()');
  assert.ok(await c.waitFor('window.__bodies.length === 2'));
  assert.ok(await c.waitFor('document.getElementById("jf-err-schedule").textContent.indexOf("The time must be an hour 0-23 and a minute 0-59, like 09:00.") !== -1'), 'the refusal sits under the Schedule box');
  // By hand: no schedule in the body
  await setSel(c, 'jf-sched', 'hand');
  assert.ok(await c.waitFor('document.getElementById("chat-main-btn").disabled === false'));
  await c.ev('document.getElementById("chat-main-btn").click()');
  assert.ok(await c.waitFor('window.__bodies.length === 3'));
  assert.equal('schedule' in JSON.parse(await c.ev('window.__bodies[2]')), false);
});

for (const width of [390, 320]) {
  test(`the Run tab of a job whose schedule waits shows the one grey line at ${width}px, and not once the schedule is on`, { skip: SKIP && 'no browser' }, async (t) => {
    let flowDir; let sig; let read;
    const o = await open(width, (w) => {
      ticketJob(w.root, 'tk');
      flowDir = path.join(w.root, 'tk');
      read = readFlow({ root: w.root, name: 'tk', catalogue: loadCatalogue().primitives });
      sig = read.signature.flow;
      const runDir = path.join(flowDir, 'runs', 'first-a');
      mkdirSync(runDir, { recursive: true });
      assert.equal(writeRunJobCopy(flowDir, runDir, sig).ok, true);
      writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ inputs: [{ id: 'jd', ticket: { number: 5 } }] }));
      const door = createTriggerDoor({ root: w.root, flowsDoor: {}, starter: {}, loadEnv: () => ({ ok: true, env: {}, keyNames: [] }), monthlyClaim: () => null, modelRefusal: () => [] });
      door.signSchedule({ flow: 'tk', flowSignatureHash: sig, trigger: { kind: 'new-ticket', role: 'jd', list: LIST, server: 'github', tool: 'list_issues' }, from: 'first-a', signedBy: 'hamr' });
      appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId: 'first-a', at: new Date().toISOString(), outcome: 'not-done', spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: sig })}\n`);
    });
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome: c, w } = o;
    await c.ev('document.getElementById("tab-runs").click()');
    assert.ok(await c.waitFor('Array.from(document.querySelectorAll(".rl-card")).some(function(e){ return /first-a/.test(e.textContent); })', 15000));
    await c.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /first-a/.test(e.textContent); }).pop().click()');
    const LINE = '[data-testid=sched-line2]';
    assert.ok(await c.waitFor(`!!document.querySelector(${JSON.stringify(LINE)})`, 8000), 'the SCHEDULE box drew');
    assert.equal(await c.ev(`document.querySelector(${JSON.stringify(LINE)}).textContent`), 'Schedule waiting for a green run');
    const colours = await c.ev(`(function(){ var tok = function(n){ var p = document.createElement("span"); p.style.color = "var(--" + n + ")"; document.body.appendChild(p); var c = getComputedStyle(p).color; p.remove(); return c; };
      var e = document.querySelector(${JSON.stringify(LINE)}); return { line: getComputedStyle(e).color, grey: tok("grey-dot"), red: tok("red"), redLabel: !!document.querySelector("#ended-block .is-red") }; })()`);
    assert.equal(colours.line, colours.grey, 'the line is grey');
    assert.notEqual(colours.line, colours.red);
    assert.equal(colours.redLabel, false, 'a red run that waits is normal shaping, not a warning');
    const spill = await c.ev(SPILL);
    assert.ok(spill.scrollW <= spill.vw, `Run tab at ${width}: ${JSON.stringify(spill)}`);
    // the job's first green run ends and the panel's next check turns the schedule on: the line is gone
    appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId: 'first-a', at: new Date().toISOString(), outcome: 'complete', spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: sig })}\n`);
    w.h.tick();
    const sc = readSchedule(flowDir);
    assert.equal(readRows(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === 'armed').length, 1, 'the panel\'s check turned it on');
    const body = (await rq(w.h.port, { url: '/api/runs/tk/first-a' })).json();
    assert.notEqual(body.summary.schedule.line2, 'Schedule waiting for a green run');
  });
}
