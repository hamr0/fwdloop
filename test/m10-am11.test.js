// M10 amendment 11 (docs/wiki/the-module-ladder.md): the Checked list shows each check on its own line; code's notes about written forms it did not
// use are "How the page was read", not Not checked. // borrowed-from: bareloop tests/read-notes.test.js@2d22c0f and tests/s1-read-note.test.js@e818c3f (adapted
// to this tree's files). The flights-3 strings are the sign row of flows/m10-walk-flights-3 (hamr's real walk, 2026-10-21), copied here so a tracked-only copy runs.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isReadNote, splitReadNotes, signedFactNames, dropRows, dropLine } from '../src/pagedropwords.js';
import { notCheckedView, NOT_CHECKED_LABEL } from '../src/checked.js';
import { lineRules } from '../src/pagebits.js';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { world } from './m10-am4-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

// the flights-3 sign row (nonstop and price label are signed facts of that declaration; the other two items are the drafter's own words)
const S1_NONSTOP = 'line 2: "nonstop" — "stops" would read the same value as "nonstop". The page gives no second label for it.';
const S1_PRICE = 'line 2: "under $150" — "flight price" would read the same value as "price label". The page gives no second label for it.';
const DRAFTER = ['whether the listed flights are actually the best or cheapest', 'tone and wording of the summary', 'completeness beyond the three flights asked for'];
const FLIGHTS3 = [S1_NONSTOP, S1_PRICE, ...DRAFTER];
const FLIGHTS3_FACTS = ['origin city', 'destination city', 'departure airport', 'arrival airport', 'price label', 'nonstop'];
const decl = (names) => ({ steps: [{ close: { class: 'green', cited: { source: 'flights', facts: names.map((name) => ({ name, shape: 'phrase', phrase: 'x' })) } } }] });

// flights-2: word notes on a kept price fact
const WORDS2 = 'line 2: "under $150" — "US dollars" does not show the same amounts as "$", so it was not used as a second way to write the price. "$" does not show the same values as "From", so it was not used as a second way to read it.';

test('flights-3 (the real case): both S1 lines name a signed fact, so they are How the page was read; the drafter\'s own gaps stay Not checked', () => {
  const v = notCheckedView(FLIGHTS3, decl(FLIGHTS3_FACTS));
  assert.equal(v.label, NOT_CHECKED_LABEL);
  assert.deepEqual(v.readNotes, [S1_NONSTOP, S1_PRICE]);
  assert.deepEqual(v.items, DRAFTER);
  assert.deepEqual(signedFactNames(decl(FLIGHTS3_FACTS)), FLIGHTS3_FACTS);
});

test('an S1 whose other fact is NOT signed stays Not checked (also: no signed list at all)', () => {
  assert.equal(isReadNote(S1_NONSTOP, ['price label']), false);
  assert.equal(isReadNote(S1_NONSTOP), false);
  assert.deepEqual(notCheckedView([S1_NONSTOP], decl(['price label'])), { label: NOT_CHECKED_LABEL, items: [S1_NONSTOP], readNotes: [] });
  assert.equal(isReadNote(S1_NONSTOP, ['nonstop']), true);
});

test('every sentence of a row must qualify: one S1 sentence with an unsigned other keeps the whole row Not checked', () => {
  const two = `${S1_NONSTOP} "a" would read the same value as "ghost". The page gives no second label for it.`;
  assert.equal(isReadNote(two, ['nonstop']), false);
  assert.equal(isReadNote(two, ['nonstop', 'ghost']), true);
});

test('a whole-fact drop stays Not checked, even beside a word note (phrase-no-result, reads-no-result, no-label, column and heading reasons)', () => {
  const jobLines = [{ n: 1, text: 'x', rule: '' }];
  for (const reason of ['phrase-no-result', 'reads-no-result', 'no-label', 'person-left', 'no-column', 'no-heading', 'bad-shape', 's1-name']) {
    const row = dropRows([{ line: 1, fact: 'Price', reason, other: 'Rome' }])[0];
    assert.equal(isReadNote(dropLine(row, jobLines, lineRules), ['Rome', 'Price']), false, reason);
  }
  const mixed = `${WORDS2} No word on this page reads "under $150" safely.`;
  assert.equal(isReadNote(mixed), false, 'a word note on a fact that also lost its label stays Not checked');
  assert.deepEqual(splitReadNotes(['line 1: "Rome" — "Rome" is on the page but in none of its results, so it is not checked.']).readNotes, []);
});

test('every word-level sentence the drop table writes is a read note, built through dropLine from real drops; the same words as a whole-fact drop are not', () => {
  const jobLines = [{ n: 1, text: 'x', rule: '' }];
  for (const reason of ['not-on-page', 'no-value', 'n2', 'r1', 'sign-twice', 'r1l', 'limit-currency', 'limit-unit', 'unit-too-long']) {
    const row = dropRows([{ line: 1, fact: 'Price', word: 'US dollars', reason, other: 'From' }])[0];
    assert.equal(isReadNote(dropLine(row, jobLines, lineRules), []), true, reason);
  }
  const twice = dropRows([{ line: 1, fact: 'Price', word: 'US dollars', reason: 'r1l', other: 'US dollars' }])[0];
  assert.equal(isReadNote(dropLine(twice, jobLines, lineRules)), true, 'r1l: a word listed twice');
  assert.equal(isReadNote(WORDS2), true);
});

test('the other lines never read as a note: wrong head, no dash, the drafter\'s own words, an empty tail', () => {
  assert.equal(isReadNote('tone and wording of the summary'), false);
  assert.equal(isReadNote('line x: "a" — "w" is not written on the page.'), false);
  assert.equal(isReadNote('line 1: "a" "w" is not written on the page.'), false);
  assert.equal(isReadNote('line 1: "a" — '), false);
  assert.equal(isReadNote('line 1: "a" — "w" is not written on the page.!'), false);
  assert.equal(isReadNote('line 1: "a" — "w" is not written on the page.'), true);
});

// ---- the page: each check on its own line --------------------------------------------------------------------------------------------------------
const CHAT = PAGE;
const load = (name) => new Function(`${cutFn(CHAT, 'sheetBlockLines', '  ')}\n${cutFn(CHAT, name, '    ')}\nreturn ${name};`)();
const green = (extra) => ({
  phase: 'green', answers: [],
  checked: [{ step: 1, line: 1, sentences: ['A one.', 'B two.', 'C three.'] }, { step: 2, line: null, sentences: ['D four.'] }],
  notChecked: { label: NOT_CHECKED_LABEL, items: ['tone'], readNotes: [] }, ...extra,
});

test('Chat Checked: each check sentence is its own line (the step\'s label leads the first)', () => {
  const v = load('extrasFor')(green());
  assert.deepEqual(v.blocks.find((b) => b.id === 'chat-checked').lines, ['line 1: A one.', '  B two.', '  C three.', 'step 2: D four.']);
});

test('Chat: How the page was read is its own block right after Not checked; no read notes = no block', () => {
  const ex = load('extrasFor');
  assert.deepEqual(ex(green()).blocks.map((b) => b.id), ['chat-checked', 'chat-notchecked']);
  const v = ex(green({ notChecked: { label: NOT_CHECKED_LABEL, items: ['tone'], readNotes: [S1_NONSTOP] } }));
  assert.deepEqual(v.blocks.map((b) => b.id), ['chat-checked', 'chat-notchecked', 'chat-readnotes']);
  const rn = v.blocks[2];
  assert.equal(rn.head, 'How the page was read');
  assert.deepEqual(rn.lines, [`- ${S1_NONSTOP}`]);
  assert.deepEqual(v.blocks[1].lines, ['- tone'], 'the note is not also in Not checked');
});

function fakeDom() {
  const els = {};
  const mk = (tag) => {
    const e = { tag, children: [], className: '', textContent: '', hidden: false, attrs: {}, appendChild(c) { e.children.push(c); return c; }, setAttribute(k, v) { e.attrs[k] = v; } };
    Object.defineProperty(e, 'innerHTML', { set() { e.children = []; }, get() { return ''; } });
    return e;
  };
  return { getElementById: (id) => (els[id] ??= mk('div')), createElement: (t) => mk(t), els };
}
const jobFn = (name) => cutFn(PAGE, name, '  ');

test('Job tab: each check sentence of a step is its own row; How the page was read is its own fold after Not checked, none = no fold', () => {
  const document = fakeDom();
  const src = ['plainWait', 'textDiv', 'sheetBlockLines', 'stepSummaryText', 'jobStepFold', 'paintJobPlan'].map(jobFn).join('\n');
  const { paintJobPlan } = new Function('document', `${src}\nreturn { paintJobPlan };`)(document);
  const step = { step: 1, line: 1, reads: [], makes: 'a', mayDo: [], check: ['A one.', 'B two.'], checkClass: 'green', ask: false, waitMs: null };
  const plan = (readNotes) => ({ steps: [step], notChecked: { label: NOT_CHECKED_LABEL, recorded: true, items: ['tone'], readNotes } });
  paintJobPlan({ plan: plan([S1_NONSTOP]) }, {});
  const tail = document.els['details-plan-tail'].children;
  assert.deepEqual(tail[0].children.filter((c) => c.textContent.startsWith('check: ')).map((c) => c.textContent), ['check: A one.', 'check: B two.']);
  assert.deepEqual(tail.slice(1).map((d) => d.className), ['plan-fold plan-notchecked', 'plan-fold plan-readnotes']);
  assert.equal(tail[2].children[0].textContent, 'How the page was read');
  assert.deepEqual(tail[2].children.slice(1).map((c) => c.textContent), [S1_NONSTOP]);
  paintJobPlan({ plan: plan([]) }, {});
  assert.deepEqual(document.els['details-plan-tail'].children.slice(1).map((d) => d.className), ['plan-fold plan-notchecked']);
});

// ---- the server: the Job tab and the Result tab split the signed record the same way ----------------------------------------------------------------
test('server: the Job tab and the Result tab show a recorded note as How the page was read, not under Not checked', async () => {
  const w = await world();
  const setupFile = path.join(w.root, 'job2', 'setup.jsonl');
  const sign = { kind: 'sign', n: 0, at: '2026-10-22T10:00:00Z', signedBy: 'hamr', hash: 'h', flowHash: null, notChecked: { label: NOT_CHECKED_LABEL, items: [WORDS2, 'tone and wording of the summary'] } };
  writeFileSync(setupFile, `${JSON.stringify(sign)}\n`);
  const job = (await w.get('/api/runs/job2/run-1/job')).body;
  assert.deepEqual(job.plan.notChecked.items, ['tone and wording of the summary']);
  assert.deepEqual(job.plan.notChecked.readNotes, [WORDS2]);
  const res = (await w.get('/api/runs/job2/run-1/result')).body;
  assert.deepEqual(res.notChecked, ['tone and wording of the summary']);
  assert.deepEqual(res.readNotes, [WORDS2]);
});

// ---- a real browser: the Chat blocks, drawn with the page's own CSS and the page's own functions ------------------------------------------------------
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
test('browser: each check of the Checked block renders on its own text line (short sentences: 3 checks = 3 lines)', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world();
  await chrome.open(`http://127.0.0.1:${w.port}/`, 390);
  const src = `${cutFn(CHAT, 'sheetBlockLines', '  ')}\n${cutFn(CHAT, 'extrasFor', '    ')}`;
  const lines = await chrome.ev(`(function(){
    ${src}
    var v = extrasFor(${JSON.stringify(green({ checked: [{ step: 1, line: 1, sentences: ['A one.', 'B two.', 'C three.'] }] }))});
    var b = v.blocks.find(function(x){ return x.id === 'chat-checked'; });
    var d = document.createElement('div'); d.className = 'msg'; d.id = 'probe-checked';
    d.textContent = b.lines.join('\\n');
    document.body.appendChild(d);
    var lh = parseFloat(getComputedStyle(d).lineHeight) || parseFloat(getComputedStyle(d).fontSize) * 1.2;
    var pad = parseFloat(getComputedStyle(d).paddingTop) + parseFloat(getComputedStyle(d).paddingBottom) + 2;
    return Math.round((d.getBoundingClientRect().height - pad) / lh);
  })()`);
  assert.equal(lines, 3);
});
