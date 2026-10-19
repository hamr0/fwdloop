// M9 amendment 23 (signed 2026-10-18): the Audit `schedule` header reads like the other part headers:
// `▾ [✗] failed schedule · <schedule words> · from run-1 · 5 tries started nothing`. The word comes from the server's one sign->word table
// (data.js SIGN_WORDS, sent as `signWords`), never typed in the page. Real panel page in headless chromium (skips when none). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, tickedConfig } from './m4e-world.mjs';
import { DAILY, greenWorld, sigNow } from './m9-trigger-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { for (const c of CLOSERS) await c(); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const at = (day, hh = 0) => new Date(2026, 9, day, hh).getTime();
const iso = (ms) => new Date(ms).toISOString();

async function openAudit(width, patchWord) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  writeFileSync(path.join(g.w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 5 })));
  const body = { flow: 'job2', trigger: DAILY, planOf: 'seed-pass' };
  const p = await g.w.post('/api/author/trigger-prepare', body);
  const s = await g.w.post('/api/author/trigger', { ...body, hash: p.json().hash });
  assert.equal(s.status, 200, s.text);
  appendFileSync(path.join(g.flowDir, 'triggers.jsonl'), `${JSON.stringify({ at: iso(at(14, 9)), flow: 'job2', trigger: 'daily 09:00', sig: sigNow(g.flowDir), outcome: 'refused', why: 'The input "jd" is not there. Nothing started.' })}\n`);
  await chrome.open(`http://127.0.0.1:${g.w.h.port}/`, width);
  assert.ok(await chrome.waitFor('document.querySelectorAll(".rl-card").length > 0', 15000));
  if (patchWord) {
    await chrome.ev(`(function(){ var real = window.fetch; window.fetch = function(u){ var p = real.apply(this, arguments);
      if(String(u).indexOf("/api/runs/job2/seed-pass/audit") === 0) return p.then(function(r){ return r.json().then(function(j){ j.schedule.word = ${JSON.stringify(patchWord)}; return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }); });
      return p; }; })()`);
  }
  await chrome.ev('Array.from(document.querySelectorAll(".rl-card")).filter(function(e){ return /seed-pass/.test(e.textContent); })[0].click()');
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=audit-group-schedule]")', 15000));
  return { chrome, g };
}
const HEAD = 'document.querySelector("[data-testid=audit-group-schedule] h4")';

for (const width of [1280, 390, 320]) {
  test(`am23 page ${width}px: header is sign, word, schedule, then the parts after a middle dot; no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await openAudit(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const q = (e) => o.chrome.ev(e);
    const kids = await q(`Array.from(${HEAD}.children).map(function(n){ return n.getAttribute("data-testid") || n.className.split(" ")[0]; })`);
    assert.deepEqual(kids, ['audit-schedule-sign', 'audit-fold-name', 'audit-schedule-lead', 'audit-schedule-head'], 'order: sign+word badge, schedule, dot, parts');
    assert.equal(await q(`${HEAD}.children[0].textContent`), '[✗] failed', 'sign then the word');
    const text = (await q(`${HEAD}.innerText`)).replace(/\s+/g, ' ').trim();
    assert.match(text, /^\[✗\] failed schedule · every day at 09:00 · from seed-pass · 1 try started nothing$/, `signed example: ${JSON.stringify(text)}`);
    assert.doesNotMatch(text, /· ·/, 'no doubled dot');
    assert.equal(await q('document.querySelector("[data-testid=audit-schedule-head]").textContent'), 'every day at 09:00 · from seed-pass · 1 try started nothing');
    const spill = await q('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    assert.ok(spill <= 0, `sideways scroll ${spill}px at ${width}`);
    const box = await q('(function(){ var r = document.querySelector("[data-testid=audit-group-schedule]").getBoundingClientRect(); return {right: r.right, vw: document.documentElement.clientWidth}; })()');
    assert.ok(box.right <= box.vw, JSON.stringify(box));
  });
}

test('am23: the page draws the word the server sends (`schedule.word`), it types none', { skip: SKIP && 'no browser' }, async (t) => {
  const o = await openAudit(1280, 'borked');
  if (!o) { t.skip('no chromium installed'); return; }
  assert.ok(await o.chrome.waitFor(`${HEAD}.children[0].textContent === '[✗] borked'`, 15000), `got ${await o.chrome.ev(`${HEAD}.children[0].textContent`)}`);   // the next refresh repaints the audit with the patched reply
});

test('am23: the server sends the word from the one sign->word table for every sign the header can wear', async () => {
  const { SIGN_WORDS } = await import('../src/panel/data.js');
  assert.deepEqual([SIGN_WORDS['[✗]'], SIGN_WORDS['[▶]'], SIGN_WORDS['[·]']], ['failed', 'running', 'waiting']);
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  writeFileSync(path.join(g.w.home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: 5 })));
  const body = { flow: 'job2', trigger: DAILY, planOf: 'seed-pass' };
  const p = await g.w.post('/api/author/trigger-prepare', body);
  assert.equal((await g.w.post('/api/author/trigger', { ...body, hash: p.json().hash })).status, 200);
  const a = (await g.w.get('/api/runs/job2/seed-pass/audit')).json();
  assert.equal(a.schedule.word, SIGN_WORDS[a.schedule.sign], `word follows the sign: ${a.schedule.sign}`);
  assert.equal(a.schedule.sign, '[·]');
  assert.equal(a.schedule.word, 'waiting');
});
