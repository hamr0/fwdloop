// M11 amendment 3 (docs/wiki/the-module-ladder.md "M11 amendment 3", signed 2026-10-14): Schedule run on the Run tab, `job · k runs` on one line,
// one header style with counts, Inbox filters on "answered and expired" only. Pure page functions over fake data and the page's source, $0;
// the Run tab buttons are a real-browser walk of the real panel (headless chromium; skips when none is installed).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { greenWorld, setTrigger } from './m9-trigger-world.mjs';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fnSrc = (name) => cutFn(PAGE, name, '  ');
const NAMES = ['matchesSearch', 'inboxHeadText', 'inboxMatchesSearch', 'inboxFilterRows'];
const HEADS = [/ {2}var INBOX_HEADS = [^\n]*/, / {2}var INBOX_CHIP_WORD = [^\n]*/].map((re) => PAGE.match(re)[0]).join('\n');
const lib = new Function(`${HEADS}\n${NAMES.map(fnSrc).join('\n')}\nreturn {${NAMES.join(',')}};`)();
const NONE = { results: [], time: 'all', search: '' };
const DAY = 86_400_000;

killChildrenAfter();
const CLOSERS = [];
after(() => { CLOSERS.forEach((c) => c()); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

// ---- item 3 and 4: headers with counts, Inbox filters on section 3 only ----
test('fnSrc cuts a one-line function at its own end: inboxHeadText is exactly one function', () => {
  const src = fnSrc('inboxHeadText');
  assert.equal(src.match(/function /g).length, 1, src);
  assert.match(src.trimEnd(), /\}$/);
});

test('item 3: an Inbox header carries its count: `waiting on you (2)`', () => {
  assert.equal(lib.inboxHeadText(1, 2), 'waiting on you (2)');
  assert.equal(lib.inboxHeadText(2, 0), 'working on your answer (0)');
  assert.equal(lib.inboxHeadText(3, 11), 'answered and expired (11)');
});

test('item 3: Runs and Inbox headers are one style (one rule), normal case, bold, no letter-spacing', () => {
  const rule = /(\.rl-sect[^{]*|\.inbox-h[^{]*)\{([^}]*)\}/g;
  const rules = [...PAGE.matchAll(rule)].filter((m) => !/first-child/.test(m[1]));
  assert.equal(rules.length, 1, `one shared rule, got ${rules.map((m) => m[1]).join(' | ')}`);
  assert.match(rules[0][1], /\.rl-sect/);
  assert.match(rules[0][1], /\.inbox-h/);
  assert.doesNotMatch(rules[0][2], /uppercase|letter-spacing/);
  assert.match(rules[0][2], /font-weight:700/);
  assert.doesNotMatch(PAGE, /style="text-transform:none/, 'no inline un-uppercasing left');
});

const stop = (section, flow, runId, over = {}) => ({ flow, runId, section, askId: `a-${flow}-${runId}`, ...over });
test('item 4: the Inbox filters act on answered and expired only; waiting and working are never hidden', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  const ago = (d) => new Date(NOW - d * DAY).toISOString();
  const rows = [
    stop(1, 'kyc', 'run-1', { waiting: true }),
    stop(2, 'inv', 'run-2', { working: 'accept' }),
    stop(3, 'old', 'run-3', { answeredAt: ago(40) }),
    stop(3, 'mid', 'run-4', { answeredAt: ago(10) }),
    stop(3, 'new', 'run-5', { expiresAt: ago(2) }),
    stop(3, 'nodate', 'run-6'),
  ];
  const ids = (f) => lib.inboxFilterRows(rows, f, NOW).map((r) => r.runId);
  assert.deepEqual(ids(NONE), ['run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6']);
  assert.deepEqual(ids({ ...NONE, search: 'zzz-nothing' }), ['run-1', 'run-2'], 'search hides section 3 only');
  assert.deepEqual(ids({ ...NONE, search: 'MID' }), ['run-1', 'run-2', 'run-4'], 'search by flow, case-insensitive');
  assert.deepEqual(ids({ ...NONE, search: 'run-5' }), ['run-1', 'run-2', 'run-5'], 'search by run id');
  assert.deepEqual(ids({ ...NONE, time: '7d' }), ['run-1', 'run-2', 'run-5'], '7d: answeredAt else expiresAt; no date is out');
  assert.deepEqual(ids({ ...NONE, time: '30d' }), ['run-1', 'run-2', 'run-4', 'run-5']);
});

test('item 4: the Inbox has the filter bar without the sign chips, and the faint line says what it acts on', () => {
  assert.match(PAGE, /filterBarHTML\("inbox", true\)/);
  assert.match(PAGE, /filters below act on answered and expired only/);
  assert.match(PAGE, /createFilterBar\(\{\s*scope: "inbox"/);
  assert.match(fnSrc('filterBarHTML'), /noSigns \?\s*Object\.keys\(INBOX_CHIP_WORD\)/); // am4 item 4: the Inbox gets status chips in their place
});

// ---- item 2: the job card's first line ----
test('item 2: the count on a job card is the name\'s own size, in its own class, after a middle dot', () => {
  assert.match(PAGE, /\.rl-cnt\{[^}]*font-size:inherit/);
  assert.doesNotMatch(PAGE, /<span class="rl-faint">' \+ c\.count/, 'not the small rl-faint span');
  assert.match(PAGE, /<span class="rl-cnt">&middot; ' \+ c\.count/);
});

// ---- item 1: the Run tab buttons ----
const SCHEDULED = { kind: 'daily', hour: 13, minute: 15 };
async function openRun(w, flow = 'job2', runId = 'seed-pass') {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true }); // the signing draft would leave the card busy
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  await chrome.ev('document.getElementById("tab-runs").click()');
  await chrome.ev(`selectRun(${JSON.stringify(flow)}, ${JSON.stringify(runId)}, null, null)`);
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=run-again]")'), 'Run again shown');
  return chrome;
}
const present = (chrome, id) => chrome.ev(`!!document.querySelector("[data-testid=${id}]")`);

test('item 1: the server says canSchedule (a green run, no schedule needed); a job with no green run says no', async () => {
  const { w } = await greenWorld();
  assert.equal((await w.get('/api/runs/job2/seed-pass')).json().summary.canSchedule, true);
  const w2 = await world({ limit: 5 });
  await w2.signedFlow();
  const dir = path.join(w2.root, 'job2', 'runs', 'bad-1');
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(w2.root, 'job2', 'history.jsonl'), `${JSON.stringify({ runId: 'bad-1', at: '2026-10-06T10:00:00.000Z', outcome: 'struck-out', spentUsd: 0.02, spendComplete: true, capUsd: 0.25, wallMs: 9000, signatureHash: 'x' })}\n`);
  assert.equal((await w2.get('/api/runs/job2/bad-1')).json().summary.canSchedule, false);
});

test('item 1: Schedule run beside Run again on a job that can take a schedule and has none; same door', { skip: SKIP && 'no browser' }, async (t) => {
  const { w } = await greenWorld();
  const chrome = await openRun(w);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=run-schedule]")'), 'Schedule run shown');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=run-schedule]").textContent'), 'Schedule run');
  assert.equal(await present(chrome, 'run-cancel-schedule'), false);
  assert.equal(await chrome.ev('document.querySelector("[data-testid=run-again]").nextElementSibling === document.querySelector("[data-testid=run-schedule]")'), true, 'next to Run again');
  await chrome.ev('document.querySelector("[data-testid=run-schedule]").click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && /^job2/.test(document.getElementById("jf-run-flow").value)'), 'the Run card opens on that job');
});

test('item 1: a scheduled job reads Cancel / modify schedule, never Schedule run', { skip: SKIP && 'no browser' }, async (t) => {
  const { w } = await greenWorld();
  assert.equal((await setTrigger(w, SCHEDULED)).status, 200);
  const chrome = await openRun(w);
  if (!chrome) { t.skip('no chromium installed'); return; }
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=run-cancel-schedule]")'));
  assert.equal(await present(chrome, 'run-schedule'), false);
});

test('item 1: a job with no green run shows neither button', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  mkdirSync(path.join(w.root, 'job2', 'runs', 'bad-1'), { recursive: true });
  appendFileSync(path.join(w.root, 'job2', 'history.jsonl'), `${JSON.stringify({ runId: 'bad-1', at: '2026-10-06T10:00:00.000Z', outcome: 'struck-out', spentUsd: 0.02, spendComplete: true, capUsd: 0.25, wallMs: 9000, signatureHash: 'x' })}\n`);
  const chrome = await openRun(w, 'job2', 'bad-1');
  if (!chrome) { t.skip('no chromium installed'); return; }
  await new Promise((r) => { setTimeout(r, 500); });
  assert.equal(await present(chrome, 'run-schedule'), false);
  assert.equal(await present(chrome, 'run-cancel-schedule'), false);
});
