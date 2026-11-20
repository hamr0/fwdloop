// M13 am11c (docs/wiki/the-module-ladder.md): no Drop on the job's action. The AI's pick shows `[agent]` with no Drop, your pick `[you]`; the suggestion question has Agree / the box
// and no Drop it (a drop answer is refused at the answer door); the "ordinary line" row is gone; every job with a Destination ends with its write. Every other Drop/Add row keeps its Drop/Add.
// Drafter tests: fake provider. Panel tests: real panel + real draft child with the test provider. Browser tests: headless chromium at 1280, 390 and 320 (skip when none). All $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { ruleOfAnswer } from '../src/pageask.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';
import { JOB, killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(async () => { await Promise.all(CLOSERS.map((c) => c())); });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';

// ---- the drafter: no "none" mode, so no job with a Destination ends with no write ---------------------------------------------------------------------
const out = () => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-am11c-')); mkdirSync(path.join(d, 'out')); return path.join(d, 'out'); };
const prose = (lines, sendLine, dest) => `${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $5 per run\nguardrail: send at line ${sendLine} to file:${dest}\n`;
const step = (fromLine, emits, reads, primitives) => ({ primitives, reads, emits, fromLine, close: { class: 'hitl' } });
const plan = { steps: [step(1, 'n1', [], ['read']), step(2, 'out', ['n1'], ['write'])], guardrailClasses: {}, unjudgeable: {}, refused: [] };

test('Must fail: a job with a Destination ends with no write: the drafter has no "none" action mode (it is refused, never a plan with the send taken out)', async () => {
  const p = fakeProvider([toolReply(plan)]); p.recognise = 2;
  const r = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, out()), actionMode: 'none', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, false);
  assert.match(r.reds.join(' '), /actionMode must be check \| known/);
});
test('the drafter still takes check and known, and a dropped record is never written', async () => {
  for (const [mode, by] of [['check', 'agent'], ['known', 'you']]) {
    const p = fakeProvider([toolReply(plan)]); p.recognise = 2;
    const r = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, out()), actionMode: mode, provider: p, rates: RATES, modelId: MODEL });
    assert.equal(r.ok, true, r.reds?.join('; '));
    assert.deepEqual(r.action, { line: 2, by });
  }
});
test('the CLI refuses --action none', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'bin', 'fwdloop'), 'draft', '/nonexistent.txt', '--action', 'none'], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--action takes check or known/);
});

// ---- the answer words: a drop on the action question is not an action -----------------------------------------------------------------------------
test('ruleOfAnswer: a drop on the action question leaves no "none" action (left: true, which the door refuses); agree and typed words are as before', () => {
  const q = { source: 'look', ask: 'action', proposal: 'write it out' };
  assert.deepEqual(ruleOfAnswer(q, 'drop it', 'drop'), { rule: null, left: true });
  assert.deepEqual(ruleOfAnswer(q, 'agree', 'agree'), { rule: null, left: false, action: 'known', actionLine: 'write it out' });
  assert.deepEqual(ruleOfAnswer(q, 'put it in the file', 'rule'), { rule: null, left: false, action: 'known', actionLine: 'put it in the file' });
});
test('Other rows keep Drop it: a question about one of your ~ rules still drops it (rule left Not checked)', () => {
  assert.deepEqual(ruleOfAnswer({ source: 'look', ask: 'cant-check', ruleNo: 1 }, 'drop it', 'drop'), { rule: null, left: true });
});

// ---- the panel ---------------------------------------------------------------------------------------------------------------------------------------
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
async function suggestionOpen() {
  const w = await world({ extraEnv: NO_ACTION });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB4 }))).json().draftId;
  const s = await until(async () => { const j = await state(w, id); return j?.phase === 'questions-open' ? j : null; });
  await idle(w, id);
  return { w, id, s };
}

test('Must fail: the action row has a Drop: a row-edit drop on the action is refused and starts no draft', async () => {
  const { w, id } = await pickedByAi();
  const before = (await state(w, id)).plan;
  const r = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'action' });
  assert.ok(r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.json())}`);
  assert.equal((await state(w, id)).plan, before, 'the plan is the one it was');
});
test('the AI pick: the state has action { line, by: agent } and the page source has no action Drop button or branch', async () => {
  const { g } = await pickedByAi();
  assert.deepEqual(g.action, { line: 5, by: 'agent' });
  const html = readFileSync(path.join(import.meta.dirname, '..', 'src', 'panel', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /data-actionop|plan-action-drop|is an ordinary line/);
});
test('Must fail: the suggestion question offers Drop it: the question has no drop, and a drop answer is refused with the existing sentence, nothing saved', async () => {
  const { w, id, s } = await suggestionOpen();
  const q = s.questions.find((x) => x.ask === 'action');
  assert.ok(q, 'the action question is open');
  assert.equal(q.proposes, true);
  assert.equal(q.drops, false);
  const r = await w.post(`/api/author/${id}/answer`, { k: s.openK, choice: 'drop' });
  assert.equal(r.status, 400, JSON.stringify(r.json()));
  assert.equal(r.json().refused, 'bad-choice');
  assert.match(r.json().say, /nothing to drop/);
  const after = await state(w, id);
  assert.equal(after.phase, 'questions-open', 'the question is still open');
  assert.equal(after.questions.find((x) => x.ask === 'action').answered, false);
});
test('after the action question, Agree gives a job that ends with its write', async () => {
  const { w, id, s } = await suggestionOpen();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: s.openK, choice: 'agree' })).status, 202);
  const g = await settled(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g.say));
  assert.deepEqual(g.action, { line: 5, by: 'you' });
});
test('an old log with a { line, dropped: true } action shows no action row and does not crash', async () => {
  const { w, id } = await pickedByAi();
  const logFile = path.join(w.dir(id), 'draft', 'log.json');
  const log = JSON.parse(readFileSync(logFile, 'utf8'));
  writeFileSync(logFile, JSON.stringify({ ...log, action: { line: log.action.line, dropped: true } }));
  const g = await state(w, id);
  assert.equal(g.phase, 'green');
  assert.equal(g.action, undefined);
});

// ---- the card, in a real browser ---------------------------------------------------------------------------------------------------------------------
const ROW = 'document.querySelector("[data-testid=plan-action-row]")';
const rowText = (chrome) => chrome.ev(`(function(){ var e = ${ROW}; return e ? e.textContent.replace(/\\s+/g, " ").trim() : null; })()`);
const noSpill = async (chrome) => {
  const s = await chrome.ev('({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth })');
  assert.ok(s.sw <= s.vw, JSON.stringify(s));
};
for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the AI's pick shows [agent] with no Drop; no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { w } = await pickedByAi();
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor(`!!${ROW}`, 20000), 'the action row is drawn');
    assert.equal(await rowText(chrome), '› line 5 writes everything before it ! [agent]');
    assert.equal(await chrome.ev(`!!${ROW}.querySelector("button")`), false, 'no button on the action row');
    assert.equal(await chrome.ev('!!document.querySelector("[data-testid=plan-action-drop]")'), false);
    await noSpill(chrome);
  });
  test(`browser ${width}px: the suggestion question shows Agree and the box and no Drop it; no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const { w } = await suggestionOpen();
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('(function(){ var e = document.querySelector("[data-testid=chat-q-agree]"); return !!e && !e.hidden; })()', 20000), 'Agree is shown');
    assert.equal(await chrome.ev('document.querySelector("[data-testid=chat-q-drop]").hidden'), true, 'Drop it is hidden');
    await noSpill(chrome);
  });
}
