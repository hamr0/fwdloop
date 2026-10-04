// M4c amendment 1 (docs/wiki/the-module-ladder.md): (a) where a click in Runs lands,
// (b) an Inbox card always opens the Ask tab, (c) the one ordering of Runs. $0: fake model
// step, no key. The page is one inline script, so its functions are cut out by name and run
// against a small fake DOM (real wireTabs included).

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { listRuns, orderRuns } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const loaded = loadCatalogue();
assert.equal(loaded.ok, true);
const CATALOGUE = loaded.primitives;

const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4c-a1-${p}-`));
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE };

function makeFlow(root, name = 'job2') {
  const result = writeFlow({
    root, name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-30T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
}
function sources() {
  const d = tmp('src');
  writeFileSync(path.join(d, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(d, 'jd.md'), 'JD text goes here.');
  return ['--source', `resume=${path.join(d, 'resume.docx')}`, '--source', `jd=${path.join(d, 'jd.md')}`];
}
function cli(args) {
  const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(child);
  let stdout = '';
  child.stdout.on('data', (b) => { stdout += b; });
  return new Promise((resolve) => { child.on('exit', (code) => resolve({ code, stdout })); });
}
async function park(root, runId) {
  const r = await cli(['run', 'job2', '--root', root, ...sources(), '--run-id', runId]);
  assert.equal(r.code, 0, r.stdout);
  return /askId=(\S+)/.exec(r.stdout)[1];
}
function setExpiry(root, runId, askId, iso) {
  const runDir = path.join(root, 'job2', 'runs', runId);
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`)]) {
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = iso;
    writeFileSync(f, JSON.stringify(j));
  }
}
/** A finished run: parked, accepted, resumed to its end row. */
async function finish(root, runId) {
  const askId = await park(root, runId);
  const a = spawnSync(process.execPath, [BIN, 'answer', askId, 'accept', '--root', root], { env, encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  const r = await cli(['resume', runId, '--flow', 'job2', '--root', root]);
  assert.equal(r.code, 0, r.stdout);
}

// ---- (c) order ----------------------------------------------------------------------------------
const W = (runId, timeLeftMs) => ({ flow: 'f', runId, glyph: '[·]', waiting: true, timeLeftMs, at: null });
const R = (runId) => ({ flow: 'f', runId, glyph: '[▶]', waiting: false, at: null });
const D = (runId, at) => ({ flow: 'f', runId, glyph: '[✓]', waiting: false, at });

test('(c) orderRuns: waiting (least time left first) > running > finished newest first; unknown time last, stable', () => {
  const rows = [
    D('old', '2026-09-01T00:00:00Z'), D('new', '2026-09-29T00:00:00Z'), R('running'),
    W('late', 7_200_000), W('soon', 600_000), D('no-time', null), D('mid', '2026-09-15T00:00:00Z'),
  ];
  assert.deepEqual(orderRuns(rows).map((r) => r.runId), ['soon', 'late', 'running', 'new', 'mid', 'old', 'no-time']);
  assert.deepEqual(orderRuns([D('x', null), D('y', null), D('z', null)]).map((r) => r.runId), ['x', 'y', 'z']);
});

test('(c) real books: a parked run with no end row sits above a newer finished run; less time left first; History and Workflows share it', async () => {
  const root = tmp('order');
  makeFlow(root);
  await finish(root, 'done-newest'); // has an end row with `at`
  const late = await park(root, 'wait-late');
  const soon = await park(root, 'wait-soon');
  setExpiry(root, 'wait-late', late, new Date(Date.now() + 2 * 3600_000).toISOString());
  setExpiry(root, 'wait-soon', soon, new Date(Date.now() + 10 * 60_000).toISOString());
  const rows = listRuns({ root, catalogue: CATALOGUE });
  assert.deepEqual(rows.map((r) => r.runId), ['wait-soon', 'wait-late', 'done-newest']);
  assert.equal(rows[0].waiting, true);
  assert.equal(rows[0].waitingAskId, soon);
  assert.equal(rows[2].waiting, false);

  // Workflows: the page's own groupRunsByFlow takes the first run per flow — that is the waiting one
  const start = PAGE.indexOf('function groupRunsByFlow(');
  const groupRunsByFlow = new Function(`${PAGE.slice(start, PAGE.indexOf('\n  }', start) + 4)}\nreturn groupRunsByFlow;`)();
  const [g] = groupRunsByFlow(rows);
  assert.equal(g.lastRunId, 'wait-soon', 'the job\'s top row is its waiting run');
});

// ---- (a) and (b): the page's own functions over a fake DOM --------------------------------------
function fnSrc(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }', start) + 4);
}
class El {
  constructor(id, attrs = {}) {
    this.id = id; this.attrs = { ...attrs }; this.hidden = false; this.listeners = [];
    const cls = new Set(); this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c) };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { if (t === 'click') this.listeners.push(f); }
  click() { for (const f of this.listeners) f(); }
}
/** Both real tab groups, wired by the page's real wireTabs; starts with Audit on the right, Chat on the left. */
function pageHarness(world = {}) {
  const els = {};
  const mk = (id, panel) => { els[id] = new El(id, { 'aria-controls': panel, 'aria-selected': 'false' }); els[panel] = new El(panel); };
  [['tab-chat', 'panel-chat'], ['tab-runs', 'panel-runs'], ['tab-inbox', 'panel-inbox'],
    ['tab-run', 'panel-run'], ['tab-audit', 'panel-audit'], ['tab-details', 'panel-details'], ['tab-ask', 'panel-ask']].forEach(([t, p]) => mk(t, p));
  els['tab-chat'].setAttribute('aria-selected', 'true');
  els['tab-audit'].setAttribute('aria-selected', 'true');
  const inboxRows = {};
  const document = {
    getElementById: (id) => els[id] ?? null,
    // like a real DOM: a selector that is not one well-formed [data-testid="..."] throws instead of quietly missing
    querySelector: (sel) => {
      const m = /^\[data-testid="([^"]*)"\]$/.exec(sel);
      if (!m) throw new SyntaxError(`'${sel}' is not a valid selector`);
      return inboxRows[m[1]] ?? null;
    },
    // the real page's rows carry their own data-testid; the fake stamps it from the key it was filed under
    // honours its selector like a real DOM: the Inbox rows answer ONLY to ".inbox-row" (a typo in the page's selector gets [])
    querySelectorAll: (sel) => (sel === '.inbox-row' ? Object.entries(inboxRows).map(([id, el]) => { el.setAttribute('data-testid', id); return el; }) : []),
  };
  const calls = { selectRun: [], fetched: [], lists: 0 };
  const body = `
    function reflowMap(){}
    function scrollRunIntoViewMobile(){}
    var currentFlow = null, currentRunId = null;
    function selectRun(flow, runId, rowEl, sib, askId){ currentFlow = flow; currentRunId = runId; calls.selectRun.push({ flow: flow, runId: runId, rowEl: rowEl, sib: sib, askId: askId }); }
    function reloadLists(){ calls.lists++; }
    function getJSON(p){ calls.fetched.push(p); var id = decodeURIComponent(p.split("/")[4]); return world.fail ? Promise.reject(new Error('books unreadable')) : Promise.resolve(world.asks[id]); }
    ${fnSrc('wireTabs')}
    ${fnSrc('askNeedingYou')}
    ${fnSrc('openRunFromRuns')}
    wireTabs([document.getElementById("tab-chat"), document.getElementById("tab-runs"), document.getElementById("tab-inbox")]);
    wireTabs([document.getElementById("tab-run"), document.getElementById("tab-audit"), document.getElementById("tab-details"), document.getElementById("tab-ask")]);
    return { openRunFromRuns: openRunFromRuns };
  `;
  const api = new Function('document', 'calls', 'world', body)(document, calls, world);
  const selected = (ids) => ids.filter((i) => els[i].getAttribute('aria-selected') === 'true');
  return {
    ...api, els, inboxRows, calls,
    right: () => selected(['tab-run', 'tab-audit', 'tab-details', 'tab-ask']),
    left: () => selected(['tab-chat', 'tab-runs', 'tab-inbox']),
  };
}

const flush = () => new Promise((r) => { setTimeout(r, 0); });

test('(a) clicking a waiting run: right = Run at once then Ask (M4c-fix amendment 2 (i)), left = Inbox with that ask\'s row selected', async () => {
  const h = pageHarness({ asks: { r1: { asks: [{ askId: 'ask9', waiting: true, stuck: false }] } } });
  h.els['tab-runs'].click(); // left on Runs, right still on Audit from before
  h.els['tab-audit'].click();
  const inboxRow = new El('row');
  h.inboxRows['inbox-row-job2-r1-ask9'] = inboxRow;
  h.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: true, waitingAskId: 'ask9' }, new El('runs-row'));
  assert.deepEqual(h.right(), ['tab-run'], 'the right side opens at once');
  await flush();
  assert.deepEqual(h.right(), ['tab-ask']);
  assert.deepEqual(h.left(), ['tab-inbox']);
  const last = h.calls.selectRun.at(-1);
  assert.equal(last.rowEl, inboxRow, 'the inbox row is the selected one');
  assert.equal(last.askId, 'ask9');
  assert.equal(h.calls.lists, 1, 'the lists are refreshed before the jump');
});

test('(a) a hand-edited askId with a quote and bracket still finds its inbox row and does not throw', async () => {
  const h = pageHarness({ asks: { r1: { asks: [{ askId: 'a"]b', waiting: true }] } } });
  const inboxRow = new El('row');
  h.inboxRows['inbox-row-job2-r1-a"]b'] = inboxRow;
  h.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: true, waitingAskId: 'a"]b' }, new El('runs-row'));
  await flush();
  assert.equal(h.calls.selectRun.at(-1).rowEl, inboxRow);
  assert.equal(h.calls.selectRun.at(-1).askId, 'a"]b');
});

test('(a) clicking a finished run: right = Run (from Audit), left stays on Runs', async () => {
  const h = pageHarness({ asks: { r2: { asks: [{ askId: 'a1', waiting: false, stuck: false, open: false }] } } });
  h.els['tab-runs'].click();
  h.els['tab-audit'].click();
  const runsRow = new El('runs-row');
  h.openRunFromRuns({ flow: 'job2', runId: 'r2', waiting: false, waitingAskId: null }, runsRow);
  await flush();
  assert.deepEqual(h.right(), ['tab-run']);
  assert.deepEqual(h.left(), ['tab-runs']);
  assert.equal(h.calls.selectRun.length, 1);
  assert.equal(h.calls.selectRun[0].rowEl, runsRow);
});

// walk issue 4: the jump is decided from the run's own fresh asks, never from the cached list row.
test('issue 4: a STUCK run jumps to the Inbox too (stuck counts as waiting, M4c amendment 2 (b)) — even though its list row says waiting:false', async () => {
  const h = pageHarness({ asks: { r1: { asks: [{ askId: 'ask9', waiting: false, stuck: true }] } } });
  h.els['tab-runs'].click();
  const inboxRow = new El('row');
  h.inboxRows['inbox-row-job2-r1-ask9'] = inboxRow;
  h.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: false, stuck: true, waitingAskId: null }, new El('runs-row'));
  await flush();
  assert.deepEqual(h.left(), ['tab-inbox']);
  assert.equal(h.calls.selectRun.at(-1).askId, 'ask9');
});

test('issue 4: a STALE list row (says finished/running; the run has just parked) still jumps, and a stale "waiting" row for a run that is no longer waiting does not', async () => {
  const parked = pageHarness({ asks: { r1: { asks: [{ askId: 'ask2', waiting: true }] } } });
  parked.els['tab-runs'].click();
  parked.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: false, glyph: '[▶]' }, new El('runs-row'));
  await flush();
  assert.deepEqual(parked.left(), ['tab-inbox'], 'fresh state wins over the 10 s old list row');
  const answered = pageHarness({ asks: { r1: { asks: [{ askId: 'ask1', waiting: false, stuck: false, open: false, status: 'accepted' }] } } });
  answered.els['tab-runs'].click();
  answered.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: true, waitingAskId: 'ask1' }, new El('runs-row'));
  await flush();
  assert.deepEqual(answered.left(), ['tab-runs'], 'a stale waiting row does not drag the left side to the Inbox');
});

test('issue 4: a late reply for a run the user already left changes nothing; unreadable books leave the left side alone', async () => {
  const h = pageHarness({ asks: { r1: { asks: [{ askId: 'ask9', waiting: true }] } } });
  h.els['tab-runs'].click();
  h.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: true }, new El('a'));
  h.openRunFromRuns({ flow: 'job2', runId: 'r1b', waiting: false }, new El('b')); // the user moved on before r1's reply landed
  h.calls.fetched.length = 0;
  await flush();
  assert.deepEqual(h.left(), ['tab-runs']);
  const bad = pageHarness({ fail: true });
  bad.els['tab-runs'].click();
  bad.openRunFromRuns({ flow: 'job2', runId: 'r1', waiting: true }, new El('c'));
  await flush();
  assert.deepEqual(bad.left(), ['tab-runs']);
  assert.deepEqual(bad.right(), ['tab-run']);
});

test('(a) all three Runs rows (Workflows parent, child, History) go through that one function', () => {
  assert.match(fnSrc('buildRunRowEl'), /openRunFromRuns\(r, row\)/);
  assert.match(fnSrc('renderWorkflows'), /openRunFromRuns\(/);
});

test('(b) an Inbox card click opens the Ask tab — waiting card and old answered/expired card alike', () => {
  const start = PAGE.indexOf('function activate(){');
  const src = PAGE.slice(start, PAGE.indexOf('\n    }\n', start) + 6);
  for (const row of [
    { flow: 'job2', runId: 'r1', askId: 'a1', waiting: true, section: 1, status: 'unanswered' },
    { flow: 'job2', runId: 'r1', askId: 'a0', waiting: false, section: 3, status: 'accepted' },
    { flow: 'job2', runId: 'r2', askId: 'a7', waiting: false, section: 3, status: 'expired' },
  ]) {
    const h = pageHarness();
    h.els['tab-runs'].click();
    const wrap = new El('card');
    new Function('document', 'selectRun', 'row', 'wrap', `${src}\nactivate();`)(
      { getElementById: (id) => h.els[id] }, (...a) => h.calls.selectRun.push(a), row, wrap,
    );
    assert.deepEqual(h.right(), ['tab-ask'], `${row.status} card`);
    assert.equal(h.calls.selectRun[0][4], row.askId, 'focused on that card\'s own ask');
  }
  assert.match(PAGE, /wrap\.addEventListener\("click", activate\)/, 'every card is wired to it, no status gate');
});
