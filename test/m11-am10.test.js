// M11 amendment 10: a Needs you click opens the run on the Run tab (right), and when the run is at an ask
// (waiting or stuck) the left side moves to the Inbox with its ask selected. A stopped run leaves the left on Runs.
// Running now / Scheduled cards are unchanged; the Jobs run card (openRunFromRuns) still opens the Ask tab.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
function fnSrc(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }', start) + 4);
}
class El {
  constructor(id, attrs = {}) { this.id = id; this.attrs = { ...attrs }; this.listeners = []; this.classList = { add() {}, remove() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { if (t === 'click') this.listeners.push(f); }
  click() { for (const f of this.listeners) f(); }
}
function harness(asks) {
  const els = {};
  const mk = (id, panel) => { els[id] = new El(id, { 'aria-controls': panel, 'aria-selected': 'false' }); els[panel] = new El(panel); };
  [['tab-chat', 'panel-chat'], ['tab-runs', 'panel-runs'], ['tab-inbox', 'panel-inbox'],
    ['tab-run', 'panel-run'], ['tab-audit', 'panel-audit'], ['tab-details', 'panel-details'], ['tab-ask', 'panel-ask']].forEach(([t, p]) => mk(t, p));
  els['tab-runs'].setAttribute('aria-selected', 'true');
  els['tab-audit'].setAttribute('aria-selected', 'true');
  const document = { getElementById: (id) => els[id] ?? null, querySelectorAll: () => [] };
  const body = `
    function reflowMap(){}
    function scrollRunIntoViewMobile(){}
    function paintRunsList(){}
    var currentFlow = null, currentRunId = null, rlData = { rows: [] }, rlOpen = {};
    function selectRun(flow, runId){ currentFlow = flow; currentRunId = runId; }
    function reloadLists(){}
    function getJSON(p){ return Promise.resolve({ asks: p.indexOf("/r2/") === -1 ? asks : [] }); }
    ${fnSrc('wireTabs')}
    ${fnSrc('askNeedingYou')}
    ${fnSrc('followAsk')}
    ${fnSrc('openRunFromRuns')}
    ${fnSrc('rlJump')}
    ${fnSrc('rlClick')}
    wireTabs([document.getElementById("tab-chat"), document.getElementById("tab-runs"), document.getElementById("tab-inbox")]);
    wireTabs([document.getElementById("tab-run"), document.getElementById("tab-audit"), document.getElementById("tab-details"), document.getElementById("tab-ask")]);
    return { rlClick: rlClick, open: openRunFromRuns };
  `;
  const api = new Function('document', 'asks', body)(document, asks);
  const sel = (ids) => ids.filter((i) => els[i].getAttribute('aria-selected') === 'true');
  // a click on a jump card: need = a Needs you card
  const clickCard = (flow, runId, need) => {
    const card = { getAttribute: (k) => (k === 'data-rl-jump' ? `${flow}|${runId}` : k === 'data-rl-need' ? (need ? '1' : null) : null) };
    const target = { closest: (s) => (s === '[data-rl-jump]' ? card : null) };
    api.rlClick({ target });
  };
  return { ...api, clickCard, left: () => sel(['tab-chat', 'tab-runs', 'tab-inbox']), right: () => sel(['tab-run', 'tab-audit', 'tab-details', 'tab-ask']) };
}
const flush = () => new Promise((r) => { setTimeout(r, 0); });
async function needsClick(asks) {
  const h = harness(asks);
  h.clickCard('f', 'r1', true);
  await flush();
  return h;
}

test('a waiting Needs you card: Run tab on the right, Inbox on the left (never the Ask tab)', async () => {
  const h = await needsClick([{ askId: 'a1', waiting: true, open: true }]);
  assert.deepEqual([h.left(), h.right()], [['tab-inbox'], ['tab-run']]);
});
test('a stuck Needs you card: Run tab on the right, Inbox on the left', async () => {
  const h = await needsClick([{ askId: 'a1', stuck: true, open: true }]);
  assert.deepEqual([h.left(), h.right()], [['tab-inbox'], ['tab-run']]);
});
test('a stopped Needs you card (no ask waiting) leaves the left on Runs, right on Run', async () => {
  for (const asks of [[], [{ askId: 'a1', open: false, status: 'accepted' }]]) {
    const h = await needsClick(asks);
    assert.deepEqual([h.left(), h.right()], [['tab-runs'], ['tab-run']]);
  }
});
test('a late reply for a run the user already left changes nothing', async () => {
  const h = harness([{ askId: 'a1', waiting: true, open: true }]);
  h.clickCard('f', 'r1', true);
  h.clickCard('f', 'r2', true);
  await flush();
  assert.deepEqual([h.left(), h.right()], [['tab-runs'], ['tab-run']]);
});
test('Running now / Scheduled cards (no need flag) never move the left side, even on a waiting run', async () => {
  const h = harness([{ askId: 'a1', waiting: true, open: true }]);
  h.clickCard('f', 'r1', false);
  await flush();
  assert.deepEqual([h.left(), h.right()], [['tab-runs'], ['tab-run']]);
});
test('the Jobs run card is unchanged: a waiting run still opens Inbox and the Ask tab', async () => {
  const h = harness([{ askId: 'a1', waiting: true, open: true }]);
  h.open({ flow: 'f', runId: 'r1' }, null);
  await flush();
  assert.deepEqual([h.left(), h.right()], [['tab-inbox'], ['tab-ask']]);
});
test('only the Needs you card carries the need flag', () => {
  assert.match(fnSrc('rlJumpCardHtml'), /data-rl-need/);
  assert.doesNotMatch(fnSrc('rlScheduledCardHtml'), /data-rl-need/);
});
