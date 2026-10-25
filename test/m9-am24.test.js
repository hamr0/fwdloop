// M9 amendment 24: NEXT says one instruction per line. A NEXT with more than one instruction is rows of [label, instruction]; the label is muted and the
// instructions line up in a second column. Four endings split (ask expired, cap halt that can resume, pre-run checks failed, refused); every other NEXT
// stays one line, its words unchanged. Words: src/summary-words.js. Page: the real renderSummary in headless chromium (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { endedWords } from '../src/summary-words.js';
import { greenWorld } from './m9-trigger-world.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const SHOTS = process.env.SHOT_DIR || null;

const F = { line: 4, destination: '/home/x/out', canResume: false, home: '/home/x' };
const SPLIT = {
  'ask-expired': { f: {}, rows: [['reopen it:', 'from the Ask tab'], ['or run it again:', 'from the Chat card']] },
  'cap-halt': { f: { canResume: true }, rows: [['raise the cap:', 'Cap $ on the Chat card'], ['then:', 'Resume from the Chat card']] },
  'preflight-red': { f: {}, rows: [['fix it:', 'what the Audit / logs tab names'], ['then:', 'run it again from the Chat card']] },
  refused: { f: {}, rows: [['see why:', 'the Audit / logs tab'], ['then:', 'fix that and run it again from the Chat card']] },
};

for (const [outcome, c] of Object.entries(SPLIT)) {
  test(`am24 words: ${outcome} splits into its signed label + instruction rows`, () => {
    const w = endedWords({ ...F, ...c.f, outcome });
    assert.deepEqual(w.rows, c.rows);
    assert.equal(w.next, c.rows.map(([l, t]) => `${l} ${t}`).join('\n'), 'next is the same rows, one per line');
  });
}

test('am24 words: ask-timeout also splits like ask-expired; a cap halt that cannot resume, and every other ending, stays one line', () => {
  assert.deepEqual(endedWords({ ...F, outcome: 'ask-timeout' }).rows, SPLIT['ask-expired'].rows);
  assert.deepEqual(endedWords({ ...F, outcome: 'cap-halt' }), { reason: 'Stopped at line 4: the next try could not fit under the money cap.', next: 'Run it again from the Chat card.' });
  for (const o of ['complete', 'stopped', 'redo-halt', 'not-done', 'struck-out', 'attempt-fallback', 'close-casualty', 'provider-red', 'pricing-red', 'red', 'rerun', 'sky-fell']) {
    const w = endedWords({ ...F, outcome: o });
    assert.equal('rows' in w, false, o);
    assert.doesNotMatch(w.next, /\n/, o);
  }
  assert.equal(endedWords({ ...F, outcome: 'stopped', canResume: true }).next, 'Resume from the Chat card.');
  assert.equal(endedWords({ ...F, outcome: 'red', died: true }).next, 'See the Audit / logs tab for the last thing it did.');
});

async function world(t, width) {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return null; }
  CLOSERS.push(() => chrome.close());
  const g = await greenWorld();
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  await chrome.ev(`(function(){ var real = window.fetch; window.__patch = null;
    window.fetch = function(u, o){ var p = real.apply(this, arguments);
      if(window.__patch && String(u) === "/api/runs/job2/seed-pass") return p.then(function(r){ return r.json().then(function(j){ Object.assign(j, window.__patch); return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }); });
      return p; }; })()`);
  return chrome;
}
const paint = async (chrome, ended, key) => {
  const tag = ` [${key}]`;
  const d = { glyph: '[✗]', summary: { ended: { ...ended, reason: ended.reason + tag } } };
  await chrome.ev(`window.__patch = ${JSON.stringify(d)}; document.getElementById("tab-runs").click(); window.__sel = Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); }); window.__sel.length ? (window.__sel[window.__sel.length - 1].click(), true) : false`);
  await chrome.waitFor(`(function(){ var b = document.querySelector("[data-testid=ended-block]"); return !!b && !b.hidden && b.innerHTML.indexOf(${JSON.stringify(tag)}) >= 0; })()`, 8000);
  await new Promise((r) => { setTimeout(r, 150); });
  return chrome.ev(`(function(){ try{
  var box = document.querySelector("[data-testid=ended-block]");
  var next = box.querySelector("[data-testid=ended-next]");
  var rs = Array.from(next.querySelectorAll(".next-row")).map(function(r){ var l = r.querySelector(".next-label"), t = r.querySelector(".next-text");
    return { label: l.textContent, text: t.textContent, labelColor: getComputedStyle(l).color, labelLeft: l.getBoundingClientRect().left, textLeft: t.getBoundingClientRect().left, top: l.getBoundingClientRect().top, right: t.getBoundingClientRect().right }; });
  var endedLabel = box.querySelector(".ended-label");
  return { rows: rs, plain: next.textContent, nextRows: next.querySelectorAll(".next-row").length, mutedColor: getComputedStyle(endedLabel).color, boxRight: box.getBoundingClientRect().right,
    spill: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }catch(e){ return {err:String(e)}; } })()`);
};

for (const [outcome, c] of Object.entries(SPLIT)) {
  test(`am24 page at 1280: ${outcome} paints one instruction per line, muted labels, a second column`, async (t) => {
    const chrome = await world(t, 1280);
    if (!chrome) return;
    const r = await paint(chrome, endedWords({ ...F, ...c.f, outcome }), outcome);
    assert.equal(r.err, undefined, JSON.stringify(r));
    assert.deepEqual(r.rows.map((x) => [x.label, x.text]), c.rows, JSON.stringify(r));
    assert.ok(r.rows[1].top > r.rows[0].top, 'each instruction on its own line');
    assert.equal(r.rows[0].textLeft, r.rows[1].textLeft, 'instructions aligned in a second column');
    assert.ok(r.rows[0].textLeft > r.rows[0].labelLeft + 20, 'the second column is right of the label');
    for (const x of r.rows) assert.equal(x.labelColor, r.mutedColor, 'label is in the muted label colour');
  });
}

test('am24 page at 1280: a single-instruction NEXT stays one line of plain text', async (t) => {
  const chrome = await world(t, 1280);
  if (!chrome) return;
  const r = await paint(chrome, endedWords({ ...F, outcome: 'red' }), 'one');
  assert.equal(r.nextRows, 0, JSON.stringify(r));
  assert.equal(r.plain, 'Run it again from the Chat card.');
});

for (const width of [1280, 390, 320]) {
  test(`am24 page at ${width}: the split NEXT does not spill sideways, screenshots`, async (t) => {
    const chrome = await world(t, width);
    if (!chrome) return;
    for (const outcome of ['refused', 'cap-halt']) {
      const r = await paint(chrome, endedWords({ ...F, ...SPLIT[outcome].f, outcome }), outcome);
      assert.ok(r.spill <= 0, `page spill ${r.spill}px at ${width}`);
      for (const x of r.rows) assert.ok(x.right <= r.boxRight + 0.5, `${outcome}: row spills its box at ${width}: ${JSON.stringify(x)}`);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await chrome.screenshot(path.join(SHOTS, `am24-${outcome}-${width}.png`)); }
    }
  });
}
