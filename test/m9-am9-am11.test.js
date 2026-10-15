// M9 amendments 9 and 11 (docs/wiki/the-module-ladder.md): the Audit's `schedule` section (one for every run of a job that has a schedule now, always folded,
// `this run` + `tries`) and its head sign ([▶] a run of the job running, [✗] SCHEDULE red, else [·]). Words: src/summary-words.js. Real HTTP + a real browser
// (skips when none), $0. Replaces the M9 am6 items 3-4 tests (first row on the origin run, `schedule (k)` group on the origin run only).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { appendFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { GATED_STEP, killChildrenAfter, tickedConfig, until } from './m4e-world.mjs';
import { DAILY, greenWorld } from './m9-trigger-world.mjs';
import { scheduleAuditWords } from '../src/summary-words.js';

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const iso = (ms) => new Date(ms).toISOString();
const z = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const flat = (rows) => rows.map((r) => [r.label, r.stamp, r.text].filter(Boolean).join('  '));

async function fireWorld(o = {}) {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 }, ...o });
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
const audit = async (w, id) => (await w.get(`/api/runs/job2/${id}/audit`)).json();
const addFire = (flowDir, over) => appendFileSync(path.join(flowDir, 'triggers.jsonl'), `${JSON.stringify({ at: iso(at(13, 12)), flow: 'job2', trigger: 'daily 09:00', ...over })}\n`);

const block = { line1: 'new file in ~/fwdloop-in', red: false };
const base = { trigger: { kind: 'new-file' }, runId: 'run-9', from: 'run-7', rec: null, startMs: at(15, 13, 20), block, running: false, fires: [] };

test('am9 words (pure): head, this run (hand / scheduled / origin), tries newest first, at most 7, only fires that started nothing, `none`', () => {
  assert.equal(scheduleAuditWords({ ...base, trigger: null }), null, 'no schedule, no section');
  const none = scheduleAuditWords(base);
  assert.equal(none.head, 'new file in ~/fwdloop-in · from run-7');
  assert.deepEqual(flat(none.rows), ['this run  10/15 13:20  by hand.', 'tries  none']);
  assert.deepEqual(flat(scheduleAuditWords({ ...base, runId: 'run-7' }).rows)[0], 'this run  10/15 13:20  by hand. The schedule was set from this run.');
  const rec = { kind: 'file', triggerKind: 'new-file', file: '/in/aging-oct.csv' };
  assert.equal(flat(scheduleAuditWords({ ...base, rec, startMs: at(15, 20, 43) }).rows)[0], 'this run  10/15 20:43  started by the schedule · new file aging-oct.csv');
  const fires = [
    { at: iso(at(15, 20, 43)), outcome: 'busy' },
    { at: iso(at(15, 20, 50)), outcome: 'started', runId: 'run-8' },
    { at: iso(at(15, 20, 57)), outcome: 'refused', why: 'The input "jd" is not there. Nothing started.' },
    { at: iso(at(15, 21, 0)), outcome: 'monthly-exhausted', leftUsd: 0.01, needUsd: 0.5 },
  ];
  const w = scheduleAuditWords({ ...base, fires });
  assert.equal(w.head, 'new file in ~/fwdloop-in · from run-7 · 3 tries started nothing');
  assert.deepEqual(flat(w.rows).slice(1), [
    'tries  10/15 21:00  month used up: $0.01 left, needs $0.50. Nothing started.',
    '10/15 20:57  refused: The input "jd" is not there. Nothing started.',
    '10/15 20:43  busy: a run of this job was still working. Nothing started.',
  ]);
  const many = Array.from({ length: 12 }, (_, i) => ({ at: iso(at(14, 8, i)), outcome: 'refused', why: `r${i}` }));
  const m = scheduleAuditWords({ ...base, fires: many });
  assert.equal(m.rows.length, 1 + 7, 'tries shows at most 7');
  assert.match(m.rows[1].text, /r11/, 'newest first');
});

test('am11 words (pure): [▶] while a run runs, [✗] when SCHEDULE is red, else [·]; running wins', () => {
  assert.equal(scheduleAuditWords(base).sign, '[·]');
  assert.equal(scheduleAuditWords({ ...base, block: { ...block, red: true } }).sign, '[✗]');
  assert.equal(scheduleAuditWords({ ...base, running: true }).sign, '[▶]');
  assert.equal(scheduleAuditWords({ ...base, running: true, block: { ...block, red: true } }).sign, '[▶]');
});

test('am9 must fail: the section is missing on a run of a scheduled job (any run, not only the origin), or shows on a job with no schedule', async () => {
  const f = await fireWorld();
  assert.equal((await audit(f.w, 'seed-pass')).schedule, null, 'no schedule now: no section');
  await setSchedule(f.w);
  f.w.seedPassed('job2', 'other');
  const a = await audit(f.w, 'seed-pass');
  assert.equal(a.schedule.head, 'every day at 09:00 · from seed-pass');
  assert.match(flat(a.schedule.rows)[0], /^this run  (\d\d\/\d\d \d\d:\d\d  )?by hand\. The schedule was set from this run\.$/);
  const o = await audit(f.w, 'other');
  assert.ok(o.schedule, 'a run that is not the origin has it too');
  assert.match(flat(o.schedule.rows)[0], /^this run  (\d\d\/\d\d \d\d:\d\d  )?by hand\.$/);
  assert.equal(a.scheduleStarted, undefined);
  assert.equal(a.scheduleGroup, undefined);
});

test('am9 must fail: tries shows more than 7, a fire that started a run, or leaves out an earlier signing\'s fire; a scheduled run says what started it', async () => {
  const f = await fireWorld();
  addFire(f.flowDir, { at: iso(at(1, 9)), outcome: 'busy', say: 'a run of this job was still working' });   // before any signing of this schedule
  await setSchedule(f.w);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  for (let i = 0; i < 9; i += 1) addFire(f.flowDir, { at: iso(at(13, 10, i)), outcome: 'refused', why: `reason ${i}.` });
  const run = (await until(async () => (await f.w.get('/api/runs')).json().rows.find((r) => /^run-\d+$/.test(r.runId)) ?? null)).runId;
  const a = await audit(f.w, 'seed-pass');
  assert.equal(a.schedule.rows.length, 1 + 7);
  assert.equal(a.schedule.rows[1].text, 'refused: reason 8. Nothing started.');
  assert.ok(a.schedule.rows.every((r) => !/started by the schedule/.test(r.text) || r.label === 'this run'), 'no fire that started a run in tries');
  assert.equal(a.schedule.head, 'every day at 09:00 · from seed-pass · 10 tries started nothing', 'the one from before this signing counts');
  const s = await audit(f.w, run);
  assert.equal(s.schedule.rows[0].text, 'started by the schedule · every day at 09:00');
  assert.notEqual(s.schedule.rows[0].stamp, '');
  assert.equal(s.schedule.rows[1].label, 'tries');
});

test('am11 must fail: not [✗] while SCHEDULE is red; [✗] clears when it is not; [▶] only while a run of the job runs (a run waiting at its ask is not running)', async () => {
  const f = await fireWorld({ step: GATED_STEP });
  await setSchedule(f.w);
  assert.equal((await audit(f.w, 'seed-pass')).schedule.sign, '[·]');
  addFire(f.flowDir, { at: iso(at(13, 9)), outcome: 'refused', why: 'The input "jd" is not there. Nothing started.' });
  const red = (await f.w.get('/api/runs/job2/seed-pass')).json().summary.schedule.red;
  assert.equal(red, true);
  assert.equal((await audit(f.w, 'seed-pass')).schedule.sign, '[✗]', 'the same red as the Run tab');
  addFire(f.flowDir, { at: iso(at(13, 10)), outcome: 'started', runId: 'seed-pass' });
  assert.equal((await audit(f.w, 'seed-pass')).schedule.sign, '[·]');
  // a run working: [▶]; once it waits at its ask: not [▶]
  const run = await f.w.post('/api/author/run', { flow: 'job2', inputs: f.w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  await until(async () => { const v = (await f.w.get(`/api/author/start/${run.json().startId}`)).json(); return v.phase === 'started' && v.state === 'working' ? v : null; });
  assert.equal((await audit(f.w, 'seed-pass')).schedule.sign, '[▶]');
  writeFileSync(f.w.gate, 'go');
  await until(async () => (await f.w.get(`/api/author/start/${run.json().startId}`)).json().state === 'parked');
  assert.equal((await audit(f.w, 'seed-pass')).schedule.sign, '[·]');
  void unlinkSync;
});

async function openAudit(width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const f = await fireWorld();
  await setSchedule(f.w);
  addFire(f.flowDir, { at: iso(at(14, 9)), outcome: 'refused', why: 'The input "jd" is not there (/some/long/path/to/the/input/file/that/is/missing/jd.md). Nothing started.' });
  await chrome.open(`http://127.0.0.1:${f.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); })[0].click()');
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=audit-group-schedule]")', 15000));
  return { chrome, f };
}

for (const width of [1280, 390, 320]) {
  test(`am9 page ${width}px: the schedule section is first, folded on open, opens on a click; the sign is red; no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await openAudit(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    const q = (e) => chrome.ev(e);
    assert.equal(await q('document.getElementById("audit-groups").firstElementChild.getAttribute("data-testid")'), 'audit-group-schedule', 'first section');
    assert.equal(await q('document.querySelector("[data-testid=audit-group-schedule] [role=button]").getAttribute("aria-expanded")'), 'false');
    assert.equal(await q('document.querySelector("[data-testid=audit-table-schedule]").hidden'), true, 'folded on open');
    assert.equal(await q('document.querySelector("[data-testid=audit-schedule-sign]").textContent'), '[✗]');
    assert.match(await q('document.querySelector("[data-testid=audit-schedule-head]").textContent'), /^every day at 09:00 · from seed-pass · 1 try started nothing$/);
    await q('document.querySelector("[data-testid=audit-group-schedule] [role=button]").click()');
    assert.equal(await q('document.querySelector("[data-testid=audit-table-schedule]").hidden'), false, 'opens on click');
    assert.match(await q('document.querySelector("[data-testid=audit-table-schedule]").textContent'), /refused: The input "jd" is not there/);
    const spill = await q('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    assert.ok(spill <= 0, `sideways scroll ${spill}px at ${width}`);
    const box = await q('(function(){ var r = document.querySelector("[data-testid=audit-group-schedule]").getBoundingClientRect(); return {right: r.right, vw: document.documentElement.clientWidth}; })()');
    assert.ok(box.right <= box.vw, JSON.stringify(box));
  });
}

// am9 item 1 ("It looks like the drafting and step sections"): the schedule rows are rows of the SAME Audit row family as a step section's (one class, the dotted
// separators, aligned columns), and the unfolded text keeps a gap between label, stamp and words.
for (const width of [1280, 390, 320]) {
  test(`am9 page ${width}px: schedule rows use the Audit row class of a step section, with a gap between label, stamp and words, no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await openAudit(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    const q = (e) => chrome.ev(e);
    await q('document.querySelector("[data-testid=audit-group-schedule] [role=button]").click()');
    const sel = '[data-testid=audit-group-schedule] tbody tr';
    const stepCls = await q('(function(){ var r = document.querySelector("[data-testid^=audit-table-grouped-] tbody tr"); return r ? r.className : null; })()');
    assert.equal(stepCls, 'audit-tap', 'a step section row is the audit-tap row');
    assert.equal(await q(`document.querySelectorAll("${sel}")[0].className`), stepCls, 'schedule row class is the step section row class');
    assert.ok(await q(`document.querySelectorAll("${sel}").length`) >= 2, 'this run + the try: each its own row');
    const txt = await q('document.querySelector("[data-testid=audit-group-schedule]").innerText');
    assert.doesNotMatch(txt, /this run\d|tries\d|\d\d:\d\d[A-Za-z]/, `no run-together words: ${JSON.stringify(txt)}`);
    const raw = await q('document.querySelector("[data-testid=audit-group-schedule]").textContent');
    assert.doesNotMatch(raw, /this run\d|tries\d/, 'a gap in the markup text too');
    // desktop: label, stamp, words. Phone: the step rows' one line (label, words, time), the stamp's HH:MM at the end, as a step row
    assert.match(txt, width === 1280 ? /tries\s+10\/14 09:00\s+refused/ : /tries\s+refused[\s\S]*10\/14 09:00/, 'label, then the stamp, then the words');
    const cut = await q('(function(){ var n = document.querySelector("[data-testid=audit-group-schedule] .audit-fold-name"); return {text: n.textContent, over: n.scrollWidth - n.clientWidth}; })()');
    assert.deepEqual(cut, { text: 'schedule', over: 0 }, `the title word is shown in full at ${width}`);
    const stamps = await q('Array.from(document.querySelectorAll("[data-testid=audit-table-schedule] td.am-time")).map(function(n){ return n.textContent; })');
    assert.ok(stamps.includes('10/14 09:00'), `the date shows at every width: ${JSON.stringify(stamps)}`);
    const spill = await q('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    assert.ok(spill <= 0, `sideways scroll ${spill}px at ${width}`);
    const rows = await q(`Array.from(document.querySelectorAll("${sel}")).map(function(r){ return r.scrollWidth - r.clientWidth; })`);
    assert.ok(rows.every((n) => n <= 1), `a row spills: ${JSON.stringify(rows)}`);
    const dotted = await q(`getComputedStyle(document.querySelector("${sel.split(',')[0]} td")||document.body).borderBottomStyle`);
    if (width === 1280) assert.equal(dotted, 'dotted', 'the dotted separator between rows');
  });
}
