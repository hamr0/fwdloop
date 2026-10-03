// M4c refresh rates (/branch-review (code read, 2026-10-02): the one 2 s page loop re-drew every list every tick, so a clicked or
// Tab-focused Inbox row lost its highlight and focus within 2 s, and lists lost their scroll). $0: the
// page's own functions cut out by name, run over a fake server, a fake clock and a tiny fake DOM.
// Claims: (a) lists at most every 10 s while the open run keeps the 2 s beat; (b) an unchanged payload
// never touches the DOM; (c) a selected Inbox row stays selected + focused across a rebuild;
// (d) the open run going live -> done forces exactly one immediate list refresh.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function fnSrc(name) {
  const start = page.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return page.slice(start, page.indexOf('\n  }', start) + 4);
}

// ---- a tiny fake DOM: just what the Inbox list builders touch --------------------------------------
function makeDoc() {
  const doc = { hidden: false, activeElement: null, byId: {} };
  const el = () => {
    const e = {
      className: '', children: [], attrs: {}, textContent: '', scrollTop: 0, builds: 0, parent: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      addEventListener() {},
      focus() { doc.activeElement = this; },
      contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; },
      querySelectorAll() {
        const out = [];
        const walk = (n) => { for (const c of n.children) { if (c.attrs['data-testid'] !== undefined) out.push(c); walk(c); } };
        walk(this);
        return out;
      },
      set innerHTML(v) { this.children = []; this.builds++; },
      get innerHTML() { return ''; },
    };
    return e;
  };
  doc.createElement = el;
  doc.getElementById = (id) => (doc.byId[id] ??= el());
  return doc;
}

const stop = (askId, extra = {}) => ({ flow: 'job2', runId: 'r1', askId, section: 1, waiting: true, timeLeftMs: 60000, question: 'q', ...extra });

/** The real Inbox renderers over the fake DOM; `state` is the page's own selection. */
function inboxHarness(state = {}) {
  const doc = makeDoc();
  const scope = new Function('document', 'state', `
    var currentFlow = state.flow || null, currentRunId = state.runId || null, currentAskId = state.askId || null;
    var lastSig = { inbox: null, runs: null, detail: null, asks: null, audit: null };
    function duration(ms){ return ms + "ms"; } function readableDateTime(x){ return x; }
    function selectRun(){}
    var INBOX_HEADS = { 1: "waiting on you", 2: "working", 3: "answered" };
    ${['sig', 'withScrollPreserved', 'withFocusPreserved', 'textDiv', 'stopStatusLine', 'renderStopRow', 'renderInbox', 'buildInbox'].map(fnSrc).join('\n')}
    return { renderInbox: renderInbox, pick: function(f, r, a){ currentFlow = f; currentRunId = r; currentAskId = a; } };
  `)(doc, state);
  const list = doc.getElementById('inbox-list');
  doc.getElementById('inbox-count-label');
  return { doc, scope, list };
}
const rowOf = (list, askId) => list.children.find((c) => c.attrs['data-testid'] === `inbox-row-job2-r1-${askId}`);

// ---- the loop: real pageTick/reloadLists/reloadRun, fake server + clock --------------------------------
function loopHarness(world) {
  const seen = { fetched: [], inbox: 0 };
  const timers = [];
  const clock = { now: 1e9 };
  const doc = { hidden: false, activeElement: null, getElementById: () => null };
  const getJSON = async (p) => {
    seen.fetched.push(p);
    if (p === '/api/runs') return { rows: world.runs };
    if (p === '/api/inbox') return { rows: world.inbox, openCount: 0 };
    if (p.endsWith('/asks')) return world.asks || { asks: [], blocks: [] };
    if (p.endsWith('/audit')) return { rows: [] };
    if (world.detailFails) throw new Error('books unreadable');
    return world.detail;
  };
  const scope = new Function('getJSON', 'document', 'setTimeout', 'clearTimeout', 'seen', 'Date', `
    var currentFlow = "job2", currentRunId = "r1", currentAskId = null;
    var LIVE_POLL_MS = 2000, LISTS_POLL_MS = 10000, LIVE_MAX_MS = 300000, live = null, pollTimer = null, askDrawnFor = null;
    var lastListsAt = 0, openRunLive = true, wasHidden = false, pendingAnswer = null;
    var lastSig = { inbox: null, runs: null, detail: null, asks: null, audit: null };
    var runsFilterBar = { setItems: function(){}, refresh: function(){} };
    function renderInbox(){ seen.inbox++; } function renderRun(){} function renderAudit(){} function renderAsk(r){ return seen.renderAsk ? seen.renderAsk(r) : undefined; }
    function watchStep(){}
    ${['holdAskRender', 'sig', 'withScrollPreserved', 'paintRun', 'reloadLists', 'reloadRun', 'schedulePoll', 'pageTick'].map(fnSrc).join('\n')}
    return { schedulePoll: schedulePoll, hold: holdAskRender, state: { get openRunLive(){ return openRunLive; } } };
  `)(getJSON, doc, (fn) => { timers.push(fn); return timers.length; }, () => {}, seen, { now: () => clock.now });
  const tick = async () => { clock.now += 2000; const fn = timers.pop(); assert.ok(fn, 'a tick was scheduled'); fn(); await sleep(20); };
  scope.schedulePoll(2000);
  const count = (p) => seen.fetched.filter((x) => x === p).length;
  return { seen, tick, count, hold: scope.hold, state: scope.state };
}

test('(a) lists are fetched at most once per 10 s across 2 s ticks while the open run is read every tick', async () => {
  const world = { runs: [{ flow: 'job2', runId: 'r1', glyph: '[▶]' }], inbox: [], detail: { glyph: '[▶]' } };
  const h = loopHarness(world);
  for (let i = 0; i < 5; i++) await h.tick();   // t = 2, 4, 6, 8, 10 s
  assert.equal(h.count('/api/runs/job2/r1'), 5, 'the open run is read on every 2 s tick');
  assert.equal(h.count('/api/inbox'), 1, 'lists: read on the first tick only, not again within 10 s');
  assert.equal(h.count('/api/runs'), 1);
  await h.tick();                               // t = 12 s: 10 s since the first list read
  assert.equal(h.count('/api/inbox'), 2);
  assert.equal(h.count('/api/runs'), 2);
  for (let i = 0; i < 4; i++) await h.tick();   // t = 14 .. 20 s
  assert.equal(h.count('/api/inbox'), 2, 'throttled again until t = 22 s');
  assert.equal(h.count('/api/runs/job2/r1'), 10);
});

test('(b) an unchanged payload never rebuilds the Inbox DOM; a changed one does', () => {
  const { scope, list } = inboxHarness();
  const rows = [stop('a1')];
  scope.renderInbox(rows, 1);
  assert.equal(list.builds, 1);
  scope.renderInbox(JSON.parse(JSON.stringify(rows)), 1);
  assert.equal(list.builds, 1, 'same payload: the DOM is not touched');
  scope.renderInbox([stop('a1', { timeLeftMs: 50000 })], 1);
  assert.equal(list.builds, 2, 'control: a changed payload does rebuild');
});

test('(c) a selected Inbox row stays selected + aria-pressed (and keyboard-focused) after a rebuild with changed data', () => {
  const { doc, scope, list } = inboxHarness({ flow: 'job2', runId: 'r1', askId: 'a2' });
  scope.renderInbox([stop('a1'), stop('a2')], 2);
  assert.match(rowOf(list, 'a2').className, /\bselected\b/, 'built selected off the page state');
  assert.equal(rowOf(list, 'a2').attrs['aria-pressed'], 'true');
  assert.doesNotMatch(rowOf(list, 'a1').className, /\bselected\b/, 'only the named ask lights up');
  rowOf(list, 'a2').focus();
  const before = rowOf(list, 'a2');
  scope.renderInbox([stop('a1', { timeLeftMs: 1 }), stop('a2', { timeLeftMs: 1 })], 2);
  const after = rowOf(list, 'a2');
  assert.notEqual(after, before, 'the row really was rebuilt');
  assert.match(after.className, /\bselected\b/);
  assert.equal(after.attrs['aria-pressed'], 'true');
  assert.equal(doc.activeElement, after, 'keyboard focus is back on the matching rebuilt row');
});

test('(d) the open run going live -> done forces one immediate list refresh, ahead of the 10 s mark', async () => {
  const world = { runs: [{ flow: 'job2', runId: 'r1', glyph: '[▶]' }], inbox: [], detail: { glyph: '[▶]' } };
  const h = loopHarness(world);
  await h.tick();                                  // t=2: lists due (first), run live
  assert.equal(h.count('/api/inbox'), 1);
  await h.tick();                                  // t=4: throttled
  assert.equal(h.count('/api/inbox'), 1);
  world.detail = { glyph: '[✓]' };                  // the run finishes
  await h.tick();                                  // t=6: this tick sees it
  assert.equal(h.count('/api/inbox'), 2, 'one immediate refresh on live -> done, 4 s early');
  assert.equal(h.count('/api/runs'), 2);
  const detailReads = h.count('/api/runs/job2/r1');
  await h.tick(); await h.tick();                  // t=8, 10: a finished run is no longer polled
  assert.equal(h.count('/api/runs/job2/r1'), detailReads, 'a done run is not re-read every 2 s');
  assert.equal(h.count('/api/inbox'), 2, 'and no second forced refresh');
});

test('(e) a redraw held over a typed reason is retried on the next tick even though the payload no longer changes', async () => {
  const ask = (n) => ({ asks: [{ askId: 'a1', waiting: true }], blocks: [{ stepName: 'ask', n }] });
  const world = { runs: [], inbox: [], detail: { glyph: '[▶]' }, asks: ask(1) };
  const h = loopHarness(world);
  const box = { askId: 'a1', value: 'half a reas', focused: false };   // the human is typing on ask A
  const drawn = [];
  // the page's own guard (real holdAskRender) in front of a drawing stand-in, same contract as renderAsk
  h.seen.renderAsk = (r) => { if (h.hold(box, r)) return false; drawn.push(r.blocks[0].n); return true; };
  await h.tick();                       // first read: held, nothing drawn
  assert.deepEqual(drawn, []);
  world.asks = ask(2);                  // another ask answered via the CLI: the payload changes
  await h.tick();                       // changed payload, still held
  assert.deepEqual(drawn, []);
  box.value = '';                       // the human clears / blurs the box
  await h.tick();                       // SAME payload as the last tick: must still redraw
  assert.deepEqual(drawn, [2], 'the held redraw is retried and the Ask tab shows the new blocks');
  await h.tick();
  assert.deepEqual(drawn, [2], 'once drawn, an unchanged payload is skipped again');
});

test('(f) the real renderAsk returns false when held and true after drawing the empty states', () => {
  const els = { 'ask-empty': {}, 'ask-list': {} };
  const doc = { getElementById: (id) => els[id], querySelector: () => ta, activeElement: null };
  const ta = { getAttribute: () => 'a1', value: 'typing', };
  const run = new Function('document', 'askDrawnFor', `
    function holdAskRender(box, result){ ${/function holdAskRender\(box, result\)\{([\s\S]*?)\n  \}/.exec(page)[1]} }
    ${fnSrc('readReasonBox')}
    ${fnSrc('renderAsk')}
    return renderAsk;
  `)(doc, null);
  const held = { asks: [{ askId: 'a1', waiting: true }], blocks: [{ stepName: 's' }], flow: 'f', runId: 'r' };
  assert.equal(run(held, null), false, 'held over a typed reason: nothing drawn');
  assert.equal(run({ blocks: [], asks: [] }, null), true, 'empty state is a real draw');
  assert.equal(run(null, null), true);
});

test('(g) a finished run is re-read at the list rate (10 s), not never and not every 2 s', async () => {
  const world = { runs: [], inbox: [], detail: { glyph: '[✓]', v: 1 } };
  const h = loopHarness(world);
  await h.tick();                                  // t=2: first read, lists due, run is finished
  assert.equal(h.count('/api/runs/job2/r1'), 1);
  assert.equal(h.state.openRunLive, false);
  for (let i = 0; i < 4; i++) await h.tick();     // t=4..10: lists not due again until t=12
  assert.equal(h.count('/api/runs/job2/r1'), 1, 'no 2 s re-read of a finished run');
  await h.tick();                                  // t=12: lists due again
  assert.equal(h.count('/api/runs/job2/r1'), 2, 'the finished run is re-read at the list rate');
  assert.equal(h.count('/api/runs/job2/r1/asks'), 2);
  assert.equal(h.count('/api/runs/job2/r1/audit'), 2);
});

test('(h) a run whose books cannot be read drops to the list rate, not 2 s forever', async () => {
  const world = { runs: [], inbox: [], detail: null, detailFails: true };
  const h = loopHarness(world);
  await h.tick();                                  // t=2: detail fetch fails
  assert.equal(h.state.openRunLive, false, 'an unreadable run is not treated as live');
  for (let i = 0; i < 4; i++) await h.tick();     // t=4..10
  assert.equal(h.count('/api/runs/job2/r1'), 1, 'not re-read every 2 s');
  await h.tick();                                  // t=12
  assert.equal(h.count('/api/runs/job2/r1'), 2, 'retried at the list rate');
  world.detailFails = false; world.detail = { glyph: '[▶]' };
  for (let i = 0; i < 5; i++) await h.tick();     // t=14..22: the next list-rate read finds it live and puts it back on the 2 s beat
  assert.equal(h.state.openRunLive, true);
  assert.ok(h.count('/api/runs/job2/r1') >= 3, 'back to the 2 s beat once readable');
});

test('(i) selectRun: a late detail reply for a run you left never paints over the one you opened', async () => {
  const replies = {};
  const getJSON = (p) => new Promise((res, rej) => { replies[p] = { res, rej }; });
  const painted = [];
  const els = {};
  const doc = { querySelectorAll: () => [], getElementById: (id) => (els[id] ??= { hidden: false, textContent: '' }) };
  const scope = new Function('getJSON', 'document', 'painted', `
    var currentFlow = null, currentRunId = null, currentAskId = null, openRunLive = true;
    var lastSig = { inbox: null, runs: null, detail: null, asks: null, audit: null };
    function clearSelection(){} function renderAudit(){} function renderJob(){} function renderAsk(){}
    function paintRun(d){ painted.push(d.runId); openRunLive = !(d && d.glyph === "[\u2713]"); }
    ${fnSrc('selectRun')}
    return { selectRun: selectRun, st: { get live(){ return openRunLive; }, get run(){ return currentRunId; } } };
  `)(getJSON, doc, painted);
  scope.selectRun('f', 'A', null, '.x');
  scope.selectRun('f', 'B', null, '.x');
  replies['/api/runs/f/B'].res({ runId: 'B', glyph: '[▶]' });
  await sleep(5);
  replies['/api/runs/f/A'].res({ runId: 'A', glyph: '[✓]' });   // A answers late, and is finished
  await sleep(5);
  assert.deepEqual(painted, ['B'], 'the late reply for A paints nothing');
  assert.equal(scope.st.live, true, "A's finished glyph never reached openRunLive");
  // and a late FAILURE for the run you left does not say "failed to load" or flip the flag either
  scope.selectRun('f', 'C', null, '.x');
  scope.selectRun('f', 'D', null, '.x');
  replies['/api/runs/f/C'].rej(new Error('nope'));
  await sleep(5);
  assert.equal(scope.st.live, true);
  assert.equal(els['run-empty']?.textContent ?? '', '', 'no failure text for a run that is no longer open');
});

test('amendment 1 (e)(4) selectRun: a late audit, job and asks reply for a run you left paints nothing', async () => {
  const replies = {};
  const getJSON = (p) => new Promise((res, rej) => { replies[p] = { res, rej }; });
  const drawn = [];
  const els = {};
  const doc = { querySelectorAll: () => [], getElementById: (id) => (els[id] ??= { hidden: false, textContent: '' }) };
  const scope = new Function('getJSON', 'document', 'drawn', `
    var currentFlow = null, currentRunId = null, currentAskId = null, openRunLive = true;
    var lastSig = { inbox: null, runs: null, detail: null, asks: null, audit: null };
    function clearSelection(){} function paintRun(){}
    function renderAudit(a){ drawn.push('audit:' + (a && a.id)); }
    function renderJob(j){ drawn.push('job:' + (j && j.id)); }
    function renderAsk(a, f, err){ drawn.push('asks:' + (a ? a.id : err)); }
    ${fnSrc('selectRun')}
    return { selectRun: selectRun };
  `)(getJSON, doc, drawn);
  scope.selectRun('f', 'A', null, '.x');
  scope.selectRun('f', 'B', null, '.x');
  for (const k of ['audit', 'job', 'asks']) replies[`/api/runs/f/B/${k}`].res({ id: `B-${k}` });
  await sleep(5);
  for (const k of ['audit', 'job', 'asks']) replies[`/api/runs/f/A/${k}`].res({ id: `A-${k}` }); // A answers late
  await sleep(5);
  assert.deepEqual(drawn.sort(), ['asks:B-asks', 'audit:B-audit', 'job:B-job'], 'only the open run (B) is drawn');
  // a late FAILURE for the run you left draws nothing either (not even the "no data" view)
  scope.selectRun('f', 'C', null, '.x');
  scope.selectRun('f', 'D', null, '.x');
  drawn.length = 0;
  for (const k of ['audit', 'job', 'asks']) replies[`/api/runs/f/C/${k}`].rej(new Error('late nope'));
  await sleep(5);
  assert.deepEqual(drawn, [], 'a failed reply for a left run draws nothing');
});
