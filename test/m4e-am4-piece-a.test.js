// M4e amendment 4, piece A (docs/wiki/the-module-ladder.md, "M4e" amendment 4 items 1 and 2; negatives (a) (b)).
// $0: scratch config home, test draft provider, no key, no panel on a fixed port. Every test here is written to go red with its one
// src change taken out (the red line of each was seen).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REFUSAL_SENTENCE } from '../src/monthly.js';
import { capFloorText, capFloorUsd } from '../src/panel/authorcard.js';
import { resolveCeilingUsd } from '../src/runner.js';
import {
  JOB, killChildrenAfter, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
function fnSrc(src, name, indent = '    ') {
  const start = src.indexOf(`${indent}function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return src.slice(start, src.indexOf(`\n${indent}}\n`, start) + indent.length + 2);
}
const check = (w, cap) => w.get(`/api/author/monthly-check?cap=${encodeURIComponent(cap)}`);

// ---- item 1 / negative (a): the money note, its numbers, the button, the forced POST -----------------------------------------
test('am4 (a): with $0.10 left and cap $0.50 the note is red `needs $0.50 ($0.10 left monthly)`; raise the limit and it turns plain with no reload; a forced draft POST refuses at $0', async () => {
  const w = await world({ limit: 0.10 });
  const red = (await check(w, '0.50')).json();
  assert.deepEqual([red.text, red.red], ['needs $0.50 ($0.10 left monthly)', true]);
  // a cap that fits is plain
  const fits = (await check(w, '0.05')).json();
  assert.deepEqual([fits.text, fits.red], ['$0.10 left monthly', false]);
  // the forced POST: the same numbers, the same signed sentence, nothing created, nothing booked
  const r = await w.post('/api/author/draft', w.card({ capUsd: '0.50' }));
  assert.equal(r.status, 400, r.text);
  const cap = r.json().refusals.find((x) => x.field === 'capUsd');
  assert.ok(cap.say.includes(REFUSAL_SENTENCE) && cap.say.includes('Max $0.10 left this month') && cap.say.includes('this needs $0.50'), cap.say);
  assert.equal(existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0, 0, 'nothing created');
  // Settings raises the limit: the very next read is plain (no restart, no reload)
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 5 }));
  const plain = (await check(w, '0.50')).json();
  assert.deepEqual([plain.text, plain.red], ['$5.00 left monthly', false]);
  assert.equal((await w.post('/api/author/draft', w.card({ capUsd: '0.50' }))).status, 202, 'and the draft now goes through');
});

test('am4 item 1: the note is the refusal\'s own number (one function), writes nothing, and says nothing when there is nothing to say', async () => {
  const w = await world({ limit: 0.10 });
  const rowsBefore = existsSync(path.join(w.home, 'runs.jsonl')) ? readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8') : null;
  await check(w, '0.50');
  await check(w, '0.05');
  const rowsAfter = existsSync(path.join(w.home, 'runs.jsonl')) ? readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8') : null;
  assert.equal(rowsAfter, rowsBefore, 'the note wrote no hold row');
  for (const bad of ['', 'abc', '0', '-1']) assert.deepEqual([(await check(w, bad)).json().text, (await check(w, bad)).json().red], ['', false], `cap "${bad}"`);
  const none = await world();
  assert.deepEqual([(await check(none, '0.50')).json().text, (await check(none, '0.50')).json().red], ['', false], 'no limit set: no note');
  writeFileSync(path.join(w.home, 'config.json'), '{ not json');
  const broken = (await check(w, '0.50')).json();
  assert.deepEqual([broken.ok, broken.text, broken.red], [true, '', false], 'an unreadable config clears the note; the server refuses at the door');
});

// the page: its own functions, cut out and run against stubs
function pageNote({ capText, mode = 'new', flowCap = null, job = 'one step', fetchImpl }) {
  const log = { starts: 0, texts: {} };
  const els = { 'jf-cap-note': { textContent: '', classList: { remove() {}, toggle() {} } }, 'jf-run-left': { textContent: '', classList: { remove() {}, toggle() {} } }, 'jf-cap-money': { value: capText }, 'jf-job': { value: job } };
  const src = [fnSrc(CHAT, 'setMoneyNote'), fnSrc(CHAT, 'jobHasModelStep'), fnSrc(CHAT, 'refreshCapNote')].join('\n');
  const f = new Function('els', 'mode', 'flowCap', 'fetchImpl', 'log', `
    var moneyRed = false; var capNoteSeq = 0;
    var capNoteEl = els["jf-cap-note"];
    function byId(id){ return els[id]; }
    function selectedFlow(){ return flowCap === null ? null : { capUsd: flowCap }; }
    function authorGet(p){ return fetchImpl(p); }
    function refreshStartEnabled(){ log.starts++; }
    ${src}
    return { refreshCapNote: refreshCapNote, red: function(){ return moneyRed; } };`)(els, mode, flowCap, fetchImpl, log);
  return { ...f, els, log };
}
const tick = () => new Promise((r) => { setTimeout(r, 5); });

test('am4 (a) page: red note turns the main button off (startReady) and a plain one turns it back on; a fetch error clears the note and the block', async () => {
  const redJson = { ok: true, text: 'needs $0.50 ($0.10 left monthly)', red: true, floorUsd: 0.05, floorText: 'needs at least $0.05 per run' };
  const p = pageNote({ capText: '0.50', fetchImpl: () => Promise.resolve(redJson) });
  p.refreshCapNote();
  await tick();
  assert.equal(p.els['jf-cap-note'].textContent, 'needs $0.50 ($0.10 left monthly)');
  assert.equal(p.red(), true);
  // startReady: the page's own function, with the red flag as its only input
  const startReady = (moneyRed) => new Function('moneyRed', `var mode = "run"; function selectedFlow(){ return {}; } function readRows(){ return []; } function currentCard(){ return {}; } var runInputsEl = {};
    ${fnSrc(CHAT, 'startReady')}\nreturn startReady();`)(moneyRed);
  assert.equal(startReady(true), false, 'red: the button is off');
  assert.equal(startReady(false), true, 'plain: the button is on');
  // the limit was raised: the next read is plain, the flag drops, the button state is recomputed
  const plain = pageNote({ capText: '0.50', fetchImpl: () => Promise.resolve({ ok: true, text: '$5.00 left monthly', red: false, floorUsd: 0.05, floorText: 'x' }) });
  plain.refreshCapNote();
  await tick();
  assert.deepEqual([plain.red(), plain.els['jf-cap-note'].textContent, plain.log.starts], [false, '$5.00 left monthly', 0]);
  // a fetch error, or a refusal-shaped reply, clears the note and unblocks
  let calls = 0;
  const dead = pageNote({ capText: '0.50', fetchImpl: () => { calls += 1; return calls === 1 ? Promise.resolve(redJson) : Promise.reject(new Error('down')); } });
  dead.refreshCapNote();
  await tick();
  assert.equal(dead.red(), true, 'red first');
  dead.refreshCapNote();
  await tick();
  assert.deepEqual([dead.red(), dead.els['jf-cap-note'].textContent], [false, ''], 'the error cleared the red note and the block');
  const garbled = pageNote({ capText: '0.50', fetchImpl: () => Promise.resolve({ ok: false }) });
  garbled.refreshCapNote();
  await tick();
  assert.equal(garbled.red(), false);
  // in Run a signed flow the note sits under the signed cap
  const run = pageNote({ capText: '', mode: 'run', flowCap: 0.25, fetchImpl: () => Promise.resolve(redJson) });
  run.refreshCapNote();
  await tick();
  assert.equal(run.els['jf-run-left'].textContent, 'needs $0.50 ($0.10 left monthly)');
  assert.equal(run.els['jf-cap-note'].textContent, '');
});

test('am4 item 1 page: the note re-reads on typing (debounced 250ms), on card open, on a signed-flow pick, on a Settings limit change', () => {
  assert.match(CHAT, /capNoteTimer = setTimeout\(refreshCapNote, 250\)/);
  assert.match(CHAT, /id === "jf-cap-money"[\s\S]{0,80}scheduleCapNote\(\)/);
  assert.match(CHAT, /document\.addEventListener\("fwdloop-limit-changed", function\(\)\{ refreshCapNote\(\); \}\)/);
  assert.match(fnSrc(CHAT, 'paintRunFlow'), /refreshCapNote\(\)/);
  assert.match(fnSrc(CHAT, 'setMode'), /refreshCapNote\(\)/);
  assert.match(CHAT, /getElementById\("tab-chat"\)\.addEventListener\("click", function\(\)\{[^}]*loadFlows\(\)/);
  assert.match(fnSrc(CHAT, 'loadFlows'), /refreshCapNote\(\)/);
  assert.match(PAGE, /\.hint\.money-red\{color:var\(--red\)/);
});

// ---- item 2 / negative (b) --------------------------------------------------------------------------------------------------
test('am4 (b): a cap below one ceiling round is refused at Draft at $0 with the sentence; at sign too; the floor is the runner\'s own ceiling', async () => {
  assert.equal(capFloorUsd(JOB), resolveCeilingUsd(null), 'one function: the runner\'s per-round ceiling');
  assert.equal(capFloorUsd('Ask: is this ok?'), 0, 'a job of only asks spends no round');
  assert.equal(capFloorText(0.05), 'needs at least $0.05 per run');
  const w = await world();
  const small = await w.post('/api/author/draft', w.card({ capUsd: '0.01' }));
  assert.equal(small.status, 400, small.text);
  assert.deepEqual(small.json().refusals.filter((x) => x.field === 'capUsd').map((x) => x.say), ['needs at least $0.05 per run']);
  assert.equal(existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0, 0, 'nothing created');
  const exact = await w.post('/api/author/draft', w.card({ capUsd: '0.05' }));
  assert.equal(exact.status, 202, 'exactly one round fits (the runner halts only when spent + ceiling > cap)');
  // the page note: the floor line comes from the server's numbers
  const note = (await check(w, '0.01')).json();
  assert.deepEqual([note.floorUsd, note.floorText], [0.05, 'needs at least $0.05 per run']);
  // sign: a green draft whose card cap is below the floor (edited on disk) is never signed
  const id = exact.json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const cardFile = path.join(w.dir(id), 'card.json');
  writeFileSync(cardFile, JSON.stringify({ ...JSON.parse(readFileSync(cardFile, 'utf8')), capUsd: '0.01' }));
  const before = readdirSync(w.root).sort();
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 400, s.text);
  assert.deepEqual([s.json().refused, s.json().say], ['cap-too-small', 'needs at least $0.05 per run']);
  assert.deepEqual(readdirSync(w.root).sort(), before, 'nothing signed, no flow written');
  assert.equal(existsSync(path.join(w.dir(id), 'signed.json')), false);
  assert.deepEqual(w.starts(), [], 'no run started');
});

test('am4 item 2 page: the floor line shows red under Cap only when the cap is below the server\'s floor and the job has a step that is not an Ask', async () => {
  const body = { ok: true, text: '$5.00 left monthly', red: false, floorUsd: 0.05, floorText: 'needs at least $0.05 per run' };
  const small = pageNote({ capText: '0.01', fetchImpl: () => Promise.resolve(body) });
  small.refreshCapNote();
  await tick();
  assert.deepEqual([small.els['jf-cap-note'].textContent, small.red()], ['needs at least $0.05 per run', true]);
  const fits = pageNote({ capText: '0.05', fetchImpl: () => Promise.resolve(body) });
  fits.refreshCapNote();
  await tick();
  assert.deepEqual([fits.els['jf-cap-note'].textContent, fits.red()], ['$5.00 left monthly', false]);
  const asks = pageNote({ capText: '0.01', job: 'Ask: ok?\n~ a guardrail', fetchImpl: () => Promise.resolve(body) });
  asks.refreshCapNote();
  await tick();
  assert.equal(asks.red(), false, 'only asks: nothing to fund');
});
