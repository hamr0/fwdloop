// M9 amendments 6 and 7: how a run began (Job tab Started, Audit first row), the workflow's Schedule field, the Audit's folded schedule group, and the Run tab's
// ENDED date/time and SCHEDULE block. The words are built in src/summary-words.js from typed facts; ONE owner (`scheduleHead`) serves the Job tab's Schedule
// field and the Run tab's SCHEDULE line 1. Real HTTP + a real browser (skips when none), $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  appendFileSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, tickedConfig } from './m4e-world.mjs';
import { DAILY, greenWorld } from './m9-trigger-world.mjs';
import { readOutcomes } from '../src/panel/authortrigger.js';
import {
  auditStartedWords, fireRowWords, scheduleBlockWords, scheduleFieldWords, scheduleHead, shortStamp, startedWords,
} from '../src/summary-words.js';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const z = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };

async function fireWorld() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  writeFileSync(path.join(g.w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 5 })));
  return { ...g, clock };
}
const setSchedule = async (w) => {
  const body = { flow: 'job2', trigger: DAILY, planOf: 'seed-pass' };
  const p = await w.post('/api/author/trigger-prepare', body);
  assert.equal(p.status, 200, p.text);
  const s = await w.post('/api/author/trigger', { ...body, hash: p.json().hash });
  assert.equal(s.status, 200, s.text);
};
const job = async (w, id) => (await w.get(`/api/runs/job2/${id}/job`)).json();
const audit = async (w, id) => (await w.get(`/api/runs/job2/${id}/audit`)).json();
const detail = async (w, id) => (await w.get(`/api/runs/job2/${id}`)).json();
const fire = (f, hh = 9) => { f.clock.t = at(13, hh, 0, 30); f.w.h.tick(); return readOutcomes(f.flowDir).at(-1); };
const addFire = (flowDir, over) => appendFileSync(path.join(flowDir, 'triggers.jsonl'), `${JSON.stringify({ at: new Date(at(13, 12)).toISOString(), flow: 'job2', trigger: 'daily 09:00', ...over })}\n`);

test('words (pure): Started / Audit first row / Schedule field / fire rows, the signed examples', () => {
  const d = { kind: 'daily', hour: 8, minute: 15 };
  assert.equal(scheduleHead(d), 'every day at 08:15');
  assert.equal(scheduleHead(null), null);
  assert.equal(startedWords(null, null), 'By hand');
  assert.equal(startedWords(null, at(15, 13, 46)), `By hand · ${stamp(at(15, 13, 46))}`);
  const rec = { kind: 'clock', words: 'every day at 08:15', catchUp: true, lateMin: 10, slot: new Date(at(15, 8, 15)).toISOString(), fromRun: 'run-7' };
  assert.equal(startedWords(rec, at(15, 8, 25)), `By the schedule: every day at 08:15 · catch-up, 10 min late · ${stamp(at(15, 8, 25))}`);
  assert.equal(startedWords({ kind: 'file', triggerKind: 'new-file', file: '/in/aging-oct.csv' }, null), 'By a new file: aging-oct.csv');
  assert.equal(startedWords({ kind: 'file', triggerKind: 'file-updated', file: '/in/aging.csv' }, null), 'By a file update: aging.csv');
  assert.equal(auditStartedWords(rec), 'started by the schedule · every day at 08:15 · slot 08:15 · from run-7 · catch-up');
  assert.equal(auditStartedWords(null), null);
  assert.equal(scheduleFieldWords({ trigger: null }), 'none');
  assert.equal(scheduleFieldWords({ trigger: d, from: 'run-7', model: 'deepseek-flash', destination: '/x/out', inputs: ['aging-oct.csv'], home: '/x' }), 'every day at 08:15 · from run-7 · deepseek-flash · ~/out · aging-oct.csv');
  assert.match(fireRowWords({ at: new Date(at(14, 8, 15)).toISOString(), outcome: 'monthly-exhausted', leftUsd: 0.12, needUsd: 0.5 }), /^10\/14 08:15 · month used up · \$0\.12 left this month, a run needs up to \$0\.50\.$/);
  assert.equal(shortStamp(at(5, 9, 5)), '10/05 09:05');
});

test('am6 must fail: a scheduled run\'s Job tab and Audit say it was scheduled, from which run; a hand run says it was not', async () => {
  const f = await fireWorld();
  await setSchedule(f.w);
  const row = fire(f);
  assert.equal(row.outcome, 'started', JSON.stringify(row));
  const j = await job(f.w, row.runId);
  assert.match(j.started, /^By the schedule: every day at 09:00( · .*)?$/);
  const a = await audit(f.w, row.runId);
  assert.equal(a.scheduleStarted, 'started by the schedule · every day at 09:00 · slot 09:00 · from seed-pass');
  const hand = await job(f.w, 'seed-pass');
  assert.match(hand.started, /^By hand/);
  assert.equal((await audit(f.w, 'seed-pass')).scheduleStarted, null);
});

test('am6 must fail: the Job tab Schedule field is the workflow\'s schedule with what it is bound to, or none; it AGREES with the Run tab SCHEDULE line 1', async () => {
  const f = await fireWorld();
  assert.equal((await job(f.w, 'seed-pass')).schedule, 'none');
  await setSchedule(f.w);
  const j = await job(f.w, 'seed-pass');
  assert.match(j.schedule, /^every day at 09:00 · from seed-pass · /);
  const d = await detail(f.w, 'seed-pass');
  assert.ok(j.schedule.startsWith(d.summary.schedule.line1), `Schedule field "${j.schedule}" must start with SCHEDULE line 1 "${d.summary.schedule.line1}"`);
});

test('am6 must fail: fires that started nothing show in the Audit of the run the schedule was set from, folded, newest first, at most 7 — and on no other run', async () => {
  const f = await fireWorld();
  await setSchedule(f.w);
  for (let i = 0; i < 9; i += 1) addFire(f.flowDir, { at: new Date(at(13, 9 + (i % 3), i)).toISOString(), outcome: 'refused', why: `reason ${i}.` });
  addFire(f.flowDir, { at: new Date(at(13, 20)).toISOString(), outcome: 'busy', say: 'run-3 is running; finish or stop it first' });
  const a = await audit(f.w, 'seed-pass');
  assert.equal(a.scheduleGroup.label, 'schedule');
  assert.equal(a.scheduleGroup.items.length, 7);
  assert.equal(a.scheduleGroup.total, 7);
  assert.match(a.scheduleGroup.items[0], /^10\/13 20:00 · busy · run-3 is running; finish or stop it first\.$/, 'newest first');
  assert.match(a.scheduleGroup.items[1], /refused · reason 8\.$/);
  f.w.seedPassed('job2', 'other');
  assert.equal((await audit(f.w, 'other')).scheduleGroup, null, 'only on the run the schedule was set from');
});

test('am7 must fail: ENDED has the end date and time; SCHEDULE exists even By hand; Started has the start time when the books hold one', async () => {
  const f = await fireWorld();
  const d = await detail(f.w, 'seed-pass');
  assert.match(d.summary.ended.reason, /^\d\d\/\d\d \d\d:\d\d · passed · Goal met\.$/);
  assert.deepEqual(d.summary.schedule, { line1: 'By hand', line2: null, red: false });
  assert.equal(startedWords(null, at(15, 13, 46)), `By hand · ${stamp(at(15, 13, 46))}`);
});

test('am7: SCHEDULE line 2 = last <stamp> · <run> · <outcome> · next <day stamp>; a problem turns it red with the reason; the next good fire clears it', async () => {
  const f = await fireWorld();
  await setSchedule(f.w);
  let d = await detail(f.w, 'seed-pass');
  assert.equal(d.summary.schedule.line1, 'every day at 09:00');
  assert.match(d.summary.schedule.line2, /^no run yet · next (Mon|Tue|Wed|Thu|Fri|Sat|Sun) 10\/13 09:00$/);
  const row = fire(f);
  assert.equal(row.outcome, 'started');
  d = await detail(f.w, 'seed-pass');
  assert.match(d.summary.schedule.line2, new RegExp(`^last ${stamp(at(13, 9, 0, 30)).replace('/', '\\/')} · ${row.runId} · (running|passed|failed|crashed|waiting|stopped)( · catch-up)? · next \\w{3} 10/14 09:00$`));
  assert.equal(d.summary.schedule.red, false);
  addFire(f.flowDir, { at: new Date(at(14, 9)).toISOString(), outcome: 'refused', why: 'The input "jd" is not there (/x/jd.md). Nothing started.' });
  d = await detail(f.w, 'seed-pass');
  assert.equal(d.summary.schedule.red, true);
  assert.equal(d.summary.schedule.line2, `last ${stamp(at(14, 9))} · refused: The input "jd" is not there (/x/jd.md). Nothing started. · next: fix it in Cancel / modify schedule`);
  addFire(f.flowDir, { at: new Date(at(15, 9)).toISOString(), outcome: 'started', runId: row.runId });
  d = await detail(f.w, 'seed-pass');
  assert.equal(d.summary.schedule.red, false, 'a schedule whose last fire worked is not red');
});

test('am7: a file schedule\'s line 2 ends "next: waiting for a new file"', () => {
  const b = scheduleBlockWords({ trigger: { kind: 'new-file', role: 'jd', folder: '/in' }, last: { at: new Date(at(14, 8, 16)).toISOString(), runId: 'run-3', outcome: 'passed', catchUp: false }, nextSlotMs: null, armed: true, problem: null, home: '/h' });
  assert.equal(b.line2, `last 10/14 08:16 · run-3 · passed · next: waiting for a new file`);
  assert.match(b.line1, /^when a new file arrives in /);
});

test('page source: Started and Schedule sit directly under Model on the Job tab; SCHEDULE paints label, both lines and frame red', () => {
  const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  const i = PAGE.indexOf('id="details-model"');
  const rest = PAGE.slice(i, i + 700);
  assert.ok(rest.indexOf('id="details-started"') > 0 && rest.indexOf('id="details-started"') < rest.indexOf('id="details-schedule"'), 'Model, then Started, then Schedule');
  assert.ok(rest.indexOf('id="details-schedule"') < rest.indexOf('id="details-title"') || !rest.includes('details-job-title') || rest.indexOf('id="details-schedule"') < rest.indexOf('id="details-job-title"'));
  assert.match(PAGE, /\.ended-text\.is-red,\.ended-label\.is-red\{color:var\(--red\);\}/);
  assert.doesNotMatch(PAGE.replace(/<!--[\s\S]*?-->/g, ''), /\["SCHEDULED", sm\.scheduled\.text/);
});

async function openRun(width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const f = await fireWorld();
  await setSchedule(f.w);
  addFire(f.flowDir, { at: new Date(at(14, 9)).toISOString(), outcome: 'refused', why: 'The input "jd" is not there (/some/long/path/to/the/input/file/that/is/missing/jd.md). Nothing started.' });
  await chrome.open(`http://127.0.0.1:${f.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); })[0].click()');
  assert.ok(await chrome.waitFor('!document.getElementById("sched-block").hidden', 15000));
  return { chrome, f };
}

for (const width of [1280, 390, 320]) {
  test(`page ${width}px: a problem turns SCHEDULE's label, both lines and frame red; the lines wrap, no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await openRun(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    const red = await chrome.ev(`(function(){ var b = document.getElementById("sched-block"); var red = getComputedStyle(document.documentElement).getPropertyValue("--red").trim();
      var c = function(e){ return getComputedStyle(e).color; };
      var l = b.querySelector(".ended-label"), a = b.querySelector('[data-testid=sched-line1]'), z = b.querySelector('[data-testid=sched-line2]');
      var probe = document.createElement("span"); probe.style.color = "var(--red)"; document.body.appendChild(probe); var want = c(probe); probe.remove();
      return {frame: b.classList.contains("red"), label: c(l) === want, l1: c(a) === want, l2: c(z) === want, text2: z.textContent}; })()`);
    assert.deepEqual([red.frame, red.label, red.l1, red.l2], [true, true, true, true], JSON.stringify(red));
    assert.match(red.text2, /next: fix it in Cancel \/ modify schedule$/);
    const spill = await chrome.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    assert.ok(spill <= 0, `sideways scroll ${spill}px at ${width}`);
    const box = await chrome.ev('(function(){ var b = document.getElementById("sched-block").getBoundingClientRect(); var z = document.querySelector("[data-testid=sched-line2]").getBoundingClientRect(); return {right: b.right, zr: z.right, vw: document.documentElement.clientWidth}; })()');
    assert.ok(box.zr <= box.vw && box.right <= box.vw, JSON.stringify(box));
  });
}
