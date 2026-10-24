// M8 item 6: the Audit tab's learnings box (docs/wiki/the-module-ladder.md "M8" item 6): one read-only fold at the top, header `[✓] learnings  What the planner was told from
// earlier runs · N hints`, hidden when the run was handed nothing. Real HTTP for the server's reply; a real browser (skips when none) for the page, at 1280, 390 and 320 wide. $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld } from './m9-trigger-world.mjs';
import { emptyLedger, countLedger, renderHints } from '../src/learn.js';
import { LEARNINGS_FILE } from '../src/flowmodel.js';
import { cardsOf } from './m8-learn-fixtures.js';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const OUT = process.env.FWDLOOP_M8_BOX_OUT || '';
const NOW = new Date();
const built = cardsOf('ms2c0ls7');

/** the exact block the ledger renders for job2 from real cards; `edit` changes the row (the edit is the point of the test that passes it) */
function handed(edit = (/** @type {any} */ r) => r, n = 1) {
  const L = countLedger(emptyLedger(), { runid: 'r0', cards: built.cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW });
  const rows = L.rows.slice(0, n).map((r) => edit({ ...r, lastSeen: NOW.toISOString() }));
  const r = renderHints({ ...L, rows }, { workflow: 'job2', place: null, specHash: null, now: NOW });
  assert.ok(r.text && r.ids.length === rows.length, 'the fixture renders its hints');
  return r;
}
const record = (/** @type {{text: string, ids: string[]}} */ h) => ({ phase: 'draft', text: h.text, ids: h.ids, chars: h.text.length });
const give = (/** @type {any} */ g, /** @type {any} */ rec) => writeFileSync(path.join(g.flowDir, 'runs', 'seed-pass', LEARNINGS_FILE), JSON.stringify(rec));
const audit = async (/** @type {any} */ g) => (await g.w.get('/api/runs/job2/seed-pass/audit')).json();

test('the server: a run with a record gets learnings [{phase, text, chars, ids, hints}], a run without one gets []', async () => {
  const g = await greenWorld();
  assert.deepEqual((await audit(g)).learnings, [], 'no record: nothing handed');
  const h = handed();
  give(g, record(h));
  const a = (await audit(g)).learnings;
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].phase, a[0].text, a[0].chars, a[0].ids], ['draft', h.text, h.text.length, h.ids]);
  assert.equal(a[0].hints.length, h.ids.length, 'parseHintBlock reads every hint of the block');
  writeFileSync(path.join(g.flowDir, 'runs', 'seed-pass', LEARNINGS_FILE), '{not json');
  assert.deepEqual((await audit(g)).learnings, [], 'an unreadable record is no box, never a guess');
});

async function openAudit(/** @type {number} */ width, /** @type {any} */ rec) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  if (rec) give(g, rec);
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); })[0].click()');
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=audit-groups]") && document.querySelectorAll("[data-testid=audit-groups] .audit-group").length > 0', 15000));
  return { chrome, g };
}
const BOX = '[data-testid=audit-group-learnings]';
const HEAD = `document.querySelector("${BOX} h4")`;
const LONG = (() => handed((r) => { r.sample = { ...r.sample, said: [`${'a-very-long-unbroken-word-'.repeat(8)} and some more words to wrap`] }; return r; }))();

for (const width of [1280, 700, 390, 320]) {
  test(`page ${width}px: header exact, N right, body read-only, no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const h = LONG;
    const o = await openAudit(width, record(h));
    if (!o) { t.skip('no chromium installed'); return; }
    const q = (/** @type {string} */ e) => o.chrome.ev(e);
    assert.ok(await o.chrome.waitFor(`!!document.querySelector("${BOX}")`, 15000), 'the box is drawn');
    assert.equal(await q(`${HEAD}.textContent`), `[✓] learnings  What the planner was told from earlier runs · ${h.ids.length} ${h.ids.length === 1 ? 'hint' : 'hints'}`);
    assert.equal(await q('document.getElementById("audit-learnings").hidden'), false);
    assert.equal(await q('document.getElementById("audit-learnings").nextElementSibling.id'), 'audit-groups', 'one fold at the top, above the step groups');
    assert.equal(await q(`document.querySelectorAll("[data-testid=audit-group-learnings]").length`), 1, 'one box');
    assert.equal(await q(`${HEAD}.getAttribute("aria-expanded")`), 'false', 'folded on open');
    assert.equal(await q(`document.querySelector("${BOX} [data-testid=audit-learnings-list]").hidden`), true);
    await q(`${HEAD}.click()`);
    assert.equal(await q(`document.querySelector("${BOX} [data-testid=audit-learnings-list]").hidden`), false, 'a click opens it');
    assert.equal(await q(`document.querySelectorAll("${BOX} button, ${BOX} input, ${BOX} textarea, ${BOX} a").length`), 0, 'read-only: nothing to press or type in');
    const body = await q(`document.querySelector("${BOX} [data-testid=audit-learnings-list]").textContent`);
    assert.match(body, /Read-only\. Given to the planner at the draft \(/);
    assert.ok(body.includes('a-very-long-unbroken-word-'), 'the hint text is shown');
    const spill = await q(`(function(){ var out = {doc: document.documentElement.scrollWidth - document.documentElement.clientWidth};
      document.querySelectorAll("${BOX}, ${BOX} *").forEach(function(e){ if(e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible" && e.clientWidth > 0) out[(e.getAttribute("data-testid") || e.tagName)] = e.scrollWidth - e.clientWidth; });
      return out; })()`);
    console.log(`# m8-6 ${width}px spill ${JSON.stringify(spill)}`);
    assert.ok(spill.doc <= 0, `sideways scroll ${JSON.stringify(spill)}`);
    assert.deepEqual(Object.keys(spill).filter((k) => k !== 'doc'), [], `a box spills its own width: ${JSON.stringify(spill)}`);
    if (OUT) { mkdirSync(OUT, { recursive: true }); await q(`document.querySelector("${BOX}").scrollIntoView()`); await o.chrome.screenshot(path.join(OUT, `fwdloop-${width}.png`)); }
  });
}

test('page: a run with no record shows no box', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openAudit(1280, null);
  if (!o) { t.skip('no chromium installed'); return; }
  assert.equal(await o.chrome.ev(`document.querySelectorAll("${BOX}").length`), 0);
  assert.equal(await o.chrome.ev('document.getElementById("audit-learnings").hidden'), true);
});

test('page: the hint text is escaped (<script> in a hint is text, never markup), and every id on the page is unique', { skip: SKIP && 'no browser' }, async (t) => {
  const h = handed((r) => { r.sample = { ...r.sample, said: ['<script>window.__x=1</script><img src=x onerror="window.__x=2">'] }; return r; });
  assert.ok(h.text.includes('<script>'), 'the fixture carries the markup');
  const o = await openAudit(1280, record(h));
  if (!o) { t.skip('no chromium installed'); return; }
  assert.ok(await o.chrome.waitFor(`!!document.querySelector("${BOX}")`, 15000));
  await o.chrome.ev(`${HEAD}.click()`);
  assert.equal(await o.chrome.ev(`document.querySelectorAll("${BOX} script, ${BOX} img").length`), 0, 'no element was made from the text');
  assert.equal(await o.chrome.ev('window.__x === undefined'), true, 'nothing ran');
  assert.ok((await o.chrome.ev(`document.querySelector("${BOX}").textContent`)).includes('<script>window.__x=1</script>'), 'the text is shown as text');
  const ids = await o.chrome.ev('Array.from(document.querySelectorAll("[id]")).map(function(e){ return e.id; })');
  assert.equal(new Set(ids).size, ids.length, `every id on the page is unique: ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('audit-learnings'));
});
