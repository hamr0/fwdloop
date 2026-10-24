// M4d amendment 26 (signed 2026-10-18): thinking shows in Audit (each model try line) and on the Job tab (one row, the run's rule).
// Words: src/thinking.js (thinkingSay and the two helpers beside it); data: each audit row's `thinking` {asked, status} (am25) and <run>/run.json (thinking).
// Real HTTP + a real browser (skips when none). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld, seedGreen } from './m9-trigger-world.mjs';
import { thinkingSay } from '../src/thinking.js';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

const row = (step, attempt, verdict, thinking) => ({
  step, attempt, class: 'green', verdict, gap: verdict === 'red' ? 'happened: produced nothing' : null, usd: 0.001, spendComplete: true, wallMs: 1000,
  model: 'deepseek-flash', modelMatch: true, strike: false, at: '2026-10-06T10:00:00.000Z', tokens: null, tools: null,
  ...(thinking === undefined ? {} : { thinking }),
});
// the am25 run: seven model tries, each a different thing bareagent reported
const AM25 = [
  row('s_applied', 1, 'red', { asked: 'off', status: 'applied' }),
  row('s_applied', 2, 'green', { asked: 'on', status: 'applied' }),
  row('s_other', 1, 'red', { asked: 'on', status: 'ignored' }),
  row('s_other', 2, 'red', { asked: 'on', status: 'unsupported' }),
  row('s_other', 3, 'green', { asked: 'off', status: 'unknown' }),
  row('s_silent', 1, 'green', { asked: 'off', status: null }),   // am27: no reply -> `thinking off (no reply)`
];
const OLD = [row('s_applied', 1, 'red'), row('s_applied', 2, 'green')];   // before am25: no `thinking` field on any row
const put = (runDir, rows) => writeFileSync(path.join(runDir, 'audit.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// One run in the world (seed-pass), so the page's only card is the run under test. kind: 'off' = an am25 run, box off; 'ticked' = an am25 run, box on; 'old' = before am25.
async function thinkWorld(kind) {
  const g = await greenWorld();
  const runDir = path.join(g.flowDir, 'runs', 'seed-pass');
  put(runDir, kind === 'old' ? OLD : AM25);
  if (kind !== 'old') writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ thinking: kind === 'ticked' }));
  // the flow's own model.json says ticked: an old run must still show NO row (it has no record of its own)
  writeFileSync(path.join(g.flowDir, 'model.json'), JSON.stringify({ slot: 'DEEPSEEK_KEY', model: 'deepseek-flash', thinking: true }));
  return g;
}
const auditOf = async (g) => (await g.w.get('/api/runs/job2/seed-pass/audit')).json();
const phrases = (a) => a.rows.filter((r) => r.step.startsWith('s_')).map((r) => [r.step, r.attempt, r.thinkingPhrase ?? null]);

test('am26 item 1/2 (server): each try row carries its thinking words: applied -> thinking <asked>; other statuses -> thinkingSay; nothing reported -> (no reply), am27', async () => {
  const g = await thinkWorld('off');
  assert.deepEqual(phrases(await auditOf(g)), [
    ['s_applied', 1, 'thinking off'], ['s_applied', 2, 'thinking on'],
    ['s_other', 1, thinkingSay('ignored')], ['s_other', 2, thinkingSay('unsupported')], ['s_other', 3, thinkingSay('unknown')],
    ['s_silent', 1, 'thinking off (no reply)'],   // am27 (was null in am26): nothing reported now reads (no reply)
  ]);
  assert.equal(thinkingSay('unsupported'), "thinking on (this model can't change it)", 'the signed example words');
  assert.equal(thinkingSay('unknown'), 'thinking off (not confirmed)', 'the signed example words');
});

test('am26 item 4 (server): a run from before am25 has no thinking words on any row', async () => {
  const g = await thinkWorld('old');
  const p = phrases(await auditOf(g));
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => x[2] === null), JSON.stringify(p));
});

// am28 replaced am26 items 3 and 4's Job tab words and hidden row; the Job tab server and page tests for it are in test/m4d-am28.test.js


async function open(g, width, tab) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); })[0].click()');
  await chrome.ev(`document.getElementById("${tab}").click()`);
  return chrome;
}
const noSpill = async (chrome, width) => {
  const spill = await chrome.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert.ok(spill <= 0, `sideways scroll ${spill}px at ${width}`);
};

for (const width of [1280, 390, 320]) {
  test(`am26 page ${width}px: each try line shows its thinking words after its verdict; the words equal the audit file's; an old run shows none; no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const g = await thinkWorld('off');
    const chrome = await open(g, width, 'tab-audit');
    if (!chrome) { t.skip('no chromium installed'); return; }
    await chrome.waitFor('document.querySelector("[data-testid=audit-group-s_applied]")', 15000);
    await chrome.ev('Array.from(document.querySelectorAll("[data-testid^=audit-group-s_] h4")).forEach(function(h){ if(h.getAttribute("aria-expanded") !== "true") h.click(); })');
    const rows = JSON.parse(await chrome.ev('JSON.stringify(Array.from(document.querySelectorAll("[data-testid^=audit-table-grouped-s_] tbody tr")).map(function(tr){ return tr.querySelector("td[data-label=Verdict]").innerText.replace(/\\s+/g, " ").trim(); }))'));
    assert.equal(rows.length, 6);
    const want = ['failed · thinking off', 'passed · thinking on', `failed · ${thinkingSay('ignored')}`, `failed · ${thinkingSay('unsupported')}`, `passed · ${thinkingSay('unknown')}`, 'passed · thinking off (no reply)'];
    assert.deepEqual(rows, want);
    await noSpill(chrome, width);
    const cells = JSON.parse(await chrome.ev('JSON.stringify(Array.from(document.querySelectorAll("[data-testid^=audit-table-grouped-s_] tbody tr")).map(function(tr){ return tr.scrollWidth - tr.clientWidth; }))'));
    assert.ok(cells.every((n) => n <= 1), `a row spills: ${JSON.stringify(cells)}`);
  });
}

test('am26 page: an old run\'s Audit shows no thinking word anywhere', { skip: SKIP && 'no browser' }, async (t) => {
  const g = await thinkWorld('old');
  const chrome = await open(g, 1280, 'tab-audit');
  if (!chrome) { t.skip('no chromium installed'); return; }
  await chrome.waitFor('document.querySelector("[data-testid=audit-group-s_applied]")', 15000);
  await chrome.ev('Array.from(document.querySelectorAll("[data-testid^=audit-group-s_] h4")).forEach(function(h){ if(h.getAttribute("aria-expanded") !== "true") h.click(); })');
  const txt = await chrome.ev('document.getElementById("audit-groups").innerText');
  assert.match(txt, /failed/);
  assert.doesNotMatch(txt, /thinking/i, txt);
});
