// M4c exit walk fixes (docs/wiki/the-module-ladder.md M4c, item 7 + the signed Exit "sees Inbox (1)
// and [·] pulse when it parks"): (1) the page refreshes itself — ONE loop, no click; (2) a running
// run's words never say "unknown" or "parked or died". $0: the page's own functions cut out by name
// and run against a fake server + fake timers; the wording tests use a real hang-step child process.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { listRuns, getRunDetail } from '../src/panel/data.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const HANG = path.join(HERE, 'fixtures', 'm4c-hang-model-step.mjs');
const page = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CATALOGUE = loadCatalogue().primitives;

const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const flush = () => new Promise((r) => { setTimeout(r, 0); });

// ---- the page's functions, cut out by name ------------------------------------------------------
function fnSrc(name) {
  const start = page.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return page.slice(start, page.indexOf('\n  }', start) + 4);
}

/**
 * The refresh loop with a fake server (`world`) and fake timers. `real` adds the real renderAsk
 * (+ its hold) over a fake DOM so a typed reason can be proven to survive.
 */
function harness(world, { selected = true, typed = null } = {}) {
  const seen = { inboxCount: null, runs: null, detail: null, asksDrawn: 0, listWrites: 0, fetched: [] };
  const timers = [];
  const els = {
    'ask-empty': { hidden: false, textContent: '' },
    'ask-list': {
      hidden: true, appendChild() {}, querySelectorAll: () => [],
      set innerHTML(v) { seen.listWrites++; }, get innerHTML() { return ''; },
    },
  };
  const textarea = typed === null ? null : { value: typed, getAttribute: () => 'a1' };
  const doc = { hidden: false, activeElement: null, getElementById: (id) => els[id], querySelector: () => textarea };
  const getJSON = async (p) => {
    seen.fetched.push(p);
    if (p === '/api/runs') return { rows: world.runs };
    if (p === '/api/inbox') return { rows: world.inbox, openCount: world.inbox.length };
    if (p.endsWith('/asks')) return world.asks;
    if (p.endsWith('/audit')) return { rows: [] };
    return world.detail;
  };
  const clock = { now: 1e9 };
  const scope = new Function('getJSON', 'document', 'setTimeout', 'clearTimeout', 'seen', 'selected', 'Date', `
    var currentFlow = selected ? "job2" : null, currentRunId = selected ? "r1" : null;
    var LIVE_POLL_MS = 2000, LISTS_POLL_MS = 10000, LIVE_MAX_MS = 300000, live = null, pollTimer = null, askDrawnFor = null;
    var lastListsAt = 0, openRunLive = true, wasHidden = false, pendingAnswer = null, currentAskId = null;
    var lastSig = { inbox: null, runs: null, detail: null, asks: null, audit: null };
    var runsFilterBar = { setItems: function(r){ seen.runs = r; }, refresh: function(){} };
    function renderInbox(rows, n){ seen.inboxCount = n; }
    function renderRun(d){ seen.detail = d; }
    function renderAudit(){}
    function renderAskRow(){ seen.asksDrawn++; return { classList: { add: function(){} } }; }
    function say(){} function sayLive(){} function endPending(){} function stopLive(){ live = null; }
    function liveOutcome(){ return { done: false }; }
    ${['sig', 'withScrollPreserved', 'paintRun', 'reloadLists', 'reloadRun', 'schedulePoll', 'pageTick', 'watchStep', 'holdAskRender', 'readReasonBox', 'renderAsk'].map(fnSrc).join('\n')}
    return { pageTick: pageTick, schedulePoll: schedulePoll, get pollTimer(){ return pollTimer; } };
  `)(getJSON, doc, (fn) => { timers.push(fn); return timers.length; }, () => {}, seen, selected, { now: () => clock.now });
  /** Fire the pending tick, as the browser would after LIVE_POLL_MS, and let its fetches land. */
  const tick = async (advanceMs = 2000) => { clock.now += advanceMs; const fn = timers.pop(); assert.ok(fn, 'a tick was scheduled'); fn(); await sleep(20); };
  return { scope, seen, timers, tick, clock };
}

const runRow = (glyph) => ({ flow: 'job2', runId: 'r1', glyph });
const askResult = { flow: 'job2', runId: 'r1', asks: [{ askId: 'a1', waiting: true }], blocks: [{ askIds: ['a1'], stepName: 's', current: { askId: 'a1', open: true } }] };

test('the page ticks on its own: a run that parks after load flips [▶] -> [·] and Inbox (0) -> (1) with no click', async () => {
  const world = { runs: [runRow('[▶]')], inbox: [], detail: { glyph: '[▶]' }, asks: { asks: [], blocks: [] } };
  const { scope, seen, timers, tick } = harness(world);
  // the page's own start-up has scheduled the first tick (cut here: schedulePoll is what start-up calls)
  scope.schedulePoll(2000);
  assert.equal(timers.length, 1);
  await tick();
  assert.equal(seen.inboxCount, 0);
  assert.equal(seen.runs[0].glyph, '[▶]');
  // the run parks while the page sits there
  world.runs = [runRow('[·]')];
  world.inbox = [{ askId: 'a1' }];
  world.detail = { glyph: '[·]' };
  await tick(10000); // lists refresh at most every LISTS_POLL_MS (10 s); the run itself every 2 s
  assert.equal(seen.inboxCount, 1, 'Inbox count updated without a click');
  assert.equal(seen.runs[0].glyph, '[·]', 'Runs list updated without a click');
  assert.equal(seen.detail.glyph, '[·]', 'the selected run header updated without a click');
  assert.equal(timers.length, 1, 'the loop keeps itself going');
});

test('with no run selected the lists still refresh (a first run appearing on its own)', async () => {
  const world = { runs: [], inbox: [], detail: null, asks: null };
  const { scope, seen, tick } = harness(world, { selected: false });
  scope.schedulePoll(2000);
  await tick();
  world.runs = [runRow('[▶]')];
  world.inbox = [{ askId: 'a1' }];
  await tick(10000);
  assert.equal(seen.runs.length, 1);
  assert.equal(seen.inboxCount, 1);
  assert.ok(!seen.fetched.some((p) => p.startsWith('/api/runs/')), 'nothing selected, no per-run fetch');
});

test('the refresh does not redraw the Ask tab over a typed reason (three ticks); with nothing typed it does', async () => {
  const world = { runs: [runRow('[·]')], inbox: [{ askId: 'a1' }], detail: { glyph: '[·]' }, asks: askResult };
  const typed = harness(world, { typed: 'half a sentence' });
  typed.scope.schedulePoll(2000);
  for (let i = 0; i < 3; i++) await typed.tick();
  assert.equal(typed.seen.asksDrawn, 0, 'a box with text in it is never redrawn');
  assert.equal(typed.seen.listWrites, 0);
  const empty = harness(world, { typed: '' });
  empty.scope.schedulePoll(2000);
  await empty.tick();
  assert.ok(empty.seen.asksDrawn >= 1, 'control: an empty, unfocused box is redrawn by the same tick');
});

test('ONE loop: startLive owns no timer of its own, and the page starts the tick', () => {
  const live = fnSrc('startLive');
  assert.doesNotMatch(live, /setTimeout\(/);
  assert.match(live, /schedulePoll\(/);
  assert.equal((page.match(/setTimeout\(pageTick/g) || []).length, 1, 'exactly one place arms the loop');
  assert.match(page, /\n  schedulePoll\(LIVE_POLL_MS\);\n/, 'the page arms the first tick at load');
});

test('the Workflows card and every run row say the same words, from the run\'s own fields: a running run reads "started ...", never "unknown"', () => {
  const words = new Function('readableDateTime', `${['runSpendText', 'runAtText'].map(fnSrc).join('\n')}; return { spend: runSpendText, at: runAtText };`)((iso) => `T(${iso})`);
  const running = { glyph: '[▶]', spend: null, spendWhy: 'running — no priced spend yet', at: null, askedAt: null, startedAt: '2026-10-01T09:00:00Z', atWhy: null };
  assert.equal(words.at(running), 'started T(2026-10-01T09:00:00Z)');
  assert.equal(words.spend(running), 'running — no priced spend yet');
  assert.equal(words.at({ at: '2026-09-30T12:00:00Z' }), '2026-09-30');
  assert.equal(words.at({ askedAt: '2026-10-01T09:00:00Z' }), 'asked T(2026-10-01T09:00:00Z)');
  // both cards go through them (the Workflows card used to read only `at`, so a running or parked flow said "unknown")
  const wf = page.slice(page.indexOf('var wfFullName'), page.indexOf('row.addEventListener("click"', page.indexOf('var wfFullName')));
  assert.match(wf, /runMetaLineHtml\(g\.lastRow, /);
  assert.match(fnSrc('runMetaLineHtml'), /runSpendText\(r\)[\s\S]*runAtText\(r\)/);
  assert.match(fnSrc('buildRunRowEl'), /runMetaLineHtml\(r, null\)/);
});

// ---- a running run's words -----------------------------------------------------------------------
test('a run mid-step reads [▶] with a start time; no "unknown", no "parked or died" anywhere in its card or header', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m4c-refresh-'));
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-30T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = mkdtempSync(path.join(tmpdir(), 'fwdloop-m4c-refresh-src-'));
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text.');
  const child = spawn(process.execPath, [BIN, 'run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'r1'], {
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: HANG }, stdio: 'ignore',
  });
  kids.push(child);
  const runDir = path.join(root, 'job2', 'runs', 'r1');
  for (let i = 0; i < 200 && !existsSync(path.join(runDir, 'pids.jsonl')); i++) await sleep(50);
  const started = JSON.parse(readFileSync(path.join(runDir, 'pids.jsonl'), 'utf8').trim().split('\n').pop()).startedAt;

  const row = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'r1');
  const detail = getRunDetail({ root, flow: 'job2', runId: 'r1', catalogue: CATALOGUE });
  assert.equal(row.glyph, '[▶]');
  assert.equal(detail.glyph, '[▶]');
  assert.equal(row.startedAt, started, 'the card has the run\'s own start time from its pid row');
  assert.equal(detail.startedAt, started);
  for (const [name, obj] of [['row', row], ['detail', { ...detail, steps: undefined }]]) {
    const text = JSON.stringify(obj);
    assert.doesNotMatch(text, /parked or died/, `${name} never says parked or died while running`);
    assert.doesNotMatch(text, /unknown/i, `${name} never says unknown while running`);
  }
  assert.equal(detail.wallMsWhy, 'still running — not finished yet');

  // control: once the process is gone it is [?], and the honest "died" words are back
  child.kill('SIGKILL');
  await new Promise((r) => { child.on('exit', r); });
  const gone = listRuns({ root, catalogue: CATALOGUE }).find((r) => r.runId === 'r1');
  assert.equal(gone.glyph, '[?]');
  assert.equal(gone.startedAt, null);
  assert.match(gone.atWhy, /parked or died/);
});
