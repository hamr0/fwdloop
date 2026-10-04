// M4c-fix amendment 2 (i): clicking a run that needs the human opens BOTH sides on it — Inbox with its ask
// selected on the left, the Ask tab on the right. "Needs you" = waiting, stuck, or expired with the Reopen offer
// (the same `!open && reopen` test answerControls uses). Any other run stays on Runs / Run.
// (j): a Grouped Audit step with exactly one try opens that try's detail in the same tap.
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
  constructor(id, attrs = {}) { this.id = id; this.attrs = { ...attrs }; this.listeners = []; this.hidden = false; const c = new Set(); this.classList = { add: (x) => c.add(x), remove: (x) => c.delete(x) }; }
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
    var currentFlow = null, currentRunId = null;
    function selectRun(flow, runId){ currentFlow = flow; currentRunId = runId; }
    function reloadLists(){}
    function getJSON(p){ return Promise.resolve({ asks: p.indexOf("/r2/") === -1 ? asks : [] }); }
    ${fnSrc('wireTabs')}
    ${fnSrc('askNeedingYou')}
    ${fnSrc('openRunFromRuns')}
    wireTabs([document.getElementById("tab-chat"), document.getElementById("tab-runs"), document.getElementById("tab-inbox")]);
    wireTabs([document.getElementById("tab-run"), document.getElementById("tab-audit"), document.getElementById("tab-details"), document.getElementById("tab-ask")]);
    return { open: openRunFromRuns };
  `;
  const api = new Function('document', 'asks', body)(document, asks);
  const sel = (ids) => ids.filter((i) => els[i].getAttribute('aria-selected') === 'true');
  return { ...api, left: () => sel(['tab-chat', 'tab-runs', 'tab-inbox']), right: () => sel(['tab-run', 'tab-audit', 'tab-details', 'tab-ask']) };
}
const flush = () => new Promise((r) => { setTimeout(r, 0); });
async function click(asks) {
  const h = harness(asks);
  h.open({ flow: 'f', runId: 'r1' }, new El('row'));
  await flush();
  return h;
}

test('(i) a waiting run opens Inbox on the left and Ask on the right', async () => {
  const h = await click([{ askId: 'a1', waiting: true, open: true }]);
  assert.deepEqual([h.left(), h.right()], [['tab-inbox'], ['tab-ask']]);
});
test('(i) a stuck run opens Inbox on the left and Ask on the right', async () => {
  const h = await click([{ askId: 'a1', stuck: true, open: true }]);
  assert.deepEqual([h.left(), h.right()], [['tab-inbox'], ['tab-ask']]);
});
test('(i) an expired ask with the Reopen offer opens Inbox and Ask', async () => {
  const h = await click([{ askId: 'a1', open: false, reopen: { waitMs: 1800000 } }]);
  assert.deepEqual([h.left(), h.right()], [['tab-inbox'], ['tab-ask']]);
});
test('(i) an expired ask with no Reopen offer, and a finished run, stay on Runs / Run', async () => {
  for (const asks of [[{ askId: 'a1', open: false, reopen: null, status: 'expired' }], [{ askId: 'a1', open: false, status: 'accepted' }], []]) {
    const h = await click(asks);
    assert.deepEqual([h.left(), h.right()], [['tab-runs'], ['tab-run']]);
  }
});
test('(i) a late reply for a run the user already left changes nothing', async () => {
  const h = harness([{ askId: 'a1', waiting: true, open: true }]);
  h.open({ flow: 'f', runId: 'r1' }, new El('a'));
  h.open({ flow: 'f', runId: 'r2' }, new El('b'));
  await flush();
  assert.deepEqual([h.left(), h.right()], [['tab-runs'], ['tab-run']]);
});
