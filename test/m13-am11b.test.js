// M13 am11b (docs/wiki/the-module-ladder.md): who picked the action shows on the card (the Drop half went in am11c). The draft log's `action` is written in ONE place (src/drafter.js):
// { line, by: 'agent' } when the AI picked it, { line, by: 'you' } for an Agree or a typed line. The card draws the two cases (M13 am11c took the Drop and its dropped record out).
// Drafter tests: fake provider. Panel tests: real panel + real draft child with the test provider. Browser tests: headless chromium at 1280, 390 and 320 (skip when none). All $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';
import { JOB, killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { await Promise.all(CLOSERS.map((c) => c())); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

// ---- the drafter: the one writer of the log's `action` ---------------------------------------------------------------------------------------------
const out = () => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-am11b-')); mkdirSync(path.join(d, 'out')); return path.join(d, 'out'); };
const prose = (lines, sendLine, dest) => `${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $5 per run\nguardrail: send at line ${sendLine} to file:${dest}\n`;
const step = (fromLine, emits, reads, primitives) => ({ primitives, reads, emits, fromLine, close: { class: 'hitl' } });
const plan = (withSend) => ({
  steps: [step(1, 'n1', [], ['read']), ...(withSend ? [step(2, 'out', ['n1'], ['write'])] : [step(2, 'n2', ['n1'], ['read'])])],
  guardrailClasses: {}, unjudgeable: {}, refused: [],
});
const run = async (mode, withSend) => {
  const p = fakeProvider([toolReply(plan(withSend))]); p.recognise = 2;
  const r = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, out()), actionMode: mode, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds?.join('; '));
  return r;
};

test('drafter: the AI picked the last line (check): { line, by: agent }', async () => {
  assert.deepEqual((await run('check', true)).action, { line: 2, by: 'agent' });
});
test('drafter: the person picked it (known, an Agree or a typed line): { line, by: you }', async () => {
  assert.deepEqual((await run('known', true)).action, { line: 2, by: 'you' });
});
test('drafter: no action mode and no send: null (no action and no Drop)', async () => {
  const p = fakeProvider([toolReply(plan(false))]);
  const r = await draft({ proseText: '1. Write the note\n2. Tidy it\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $5 per run\n', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds?.join('; '));
  assert.equal(r.action, null);
});

// ---- the panel's state ---------------------------------------------------------------------------------------------------------------------------
const NO_ACTION = { FWDLOOP_TEST_DRAFT_ACTION: 'none', FWDLOOP_TEST_DRAFT_ACTION_LINE: 'write it out' };
const JOB4 = JOB.replace(/\nwrite it out$/, '');
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settled = (w, id) => until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
const idle = async (w, id) => {
  const { isFwdloopAlive } = await import('../src/liveness.js');
  return until(() => { try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; } });
};
async function pickedByAi() {
  const w = await world({});
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const g = await settled(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g.say));
  await idle(w, id);
  return { w, id, g };
}
async function pickedByYou(how) {
  const w = await world({ extraEnv: NO_ACTION });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB4 }))).json().draftId;
  await until(async () => ((await state(w, id))?.phase === 'questions-open' ? true : null));
  await idle(w, id);
  const body = how === 'agree' ? { k: 1, choice: 'agree' } : { k: 1, choice: 'rule', answer: 'write it out' };
  assert.equal((await w.post(`/api/author/${id}/answer`, body)).status, 202);
  const g = await settled(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g.say));
  await idle(w, id);
  return { w, id, g };
}

test('panel state: the AI picked it: action { line, by: agent }', async () => {
  const { g } = await pickedByAi();
  assert.deepEqual(g.action, { line: 5, by: 'agent' });
});
test('panel state: an Agree: action { line, by: you }', async () => {
  assert.deepEqual((await pickedByYou('agree')).g.action, { line: 5, by: 'you' });
});
test('panel state: your own words: action { line, by: you }', async () => {
  assert.deepEqual((await pickedByYou('typed')).g.action, { line: 5, by: 'you' });
});
test('panel state: an old log { line } with no by shows as today: { line } only', async () => {
  const { w, id } = await pickedByAi();
  const logFile = path.join(w.dir(id), 'draft', 'log.json');
  const log = JSON.parse(readFileSync(logFile, 'utf8'));
  writeFileSync(logFile, JSON.stringify({ ...log, action: { line: log.action.line } }));
  assert.deepEqual((await state(w, id)).action, { line: 5 });
});

// ---- the card, in a real browser -----------------------------------------------------------------------------------------------------------------
const ROW = 'document.querySelector("[data-testid=plan-action-row]")';
const rowText = (chrome) => chrome.ev(`(function(){ var e = ${ROW}; return e ? e.textContent.replace(/\\s+/g, " ").trim() : null; })()`);
const hasDrop = (chrome) => chrome.ev(`!!document.querySelector("[data-testid=plan-action-drop]")`);
const noSpill = async (chrome) => {
  const s = await chrome.ev('({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, row: (function(){ var e = document.querySelector("[data-testid=plan-action-row]"); if(!e) return null; var b = e.getBoundingClientRect(); return { r: b.right, l: b.left, sw: e.scrollWidth, cw: e.clientWidth }; })() })');
  assert.ok(s.sw <= s.vw, JSON.stringify(s));
  assert.ok(s.row && s.row.l >= 0 && s.row.r <= s.vw && s.row.sw <= s.row.cw + 1, JSON.stringify(s));
};

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the AI's pick shows [agent] (am11c: no Drop); no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { w } = await pickedByAi();
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor(`!!${ROW}`, 20000), 'the action row is drawn');
    assert.equal(await rowText(chrome), '› line 5 writes everything before it ! [agent]');
    assert.equal(await hasDrop(chrome), false);
    await noSpill(chrome);
  });
  test(`browser ${width}px: your pick (Agree) shows [you] with no Drop; no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { w } = await pickedByYou('agree');
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor(`!!${ROW}`, 20000), 'the action row is drawn');
    assert.equal(await rowText(chrome), '› line 5 writes everything before it ~ [you]');
    assert.equal(await hasDrop(chrome), false, 'no Drop on a line you picked');
    assert.equal(await chrome.ev(`${ROW}.textContent.indexOf("[agent]") >= 0`), false);
    await noSpill(chrome);
  });
}
