// M10 item 3 (piece 2): our own rule ("a label that reads no value is dropped"), the dedupe before the rules, and the one map call per page
// input (fake model, $0). Each must-fail case from the signed text was seen red first; the forced reds are named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPageWords, lookAtPage, notCheckedLines,
} from '../src/pagelook.js';
import { MAP_UNREADABLE } from '../src/pagemap.js';
import { dropRows, dropSentence } from '../src/pagedropwords.js';
import { PAGE, raw, JOB } from './fixtures/m10-map/load.mjs';

test('a label that is written on the page but reads no value is dropped, with its reason', () => {
  // "Nonstop" is on the page, but no amount is written right after it: as a money label it reads nothing.
  const mapping = { facts: [{ name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['Nonstop', 'From'], unit: ['US dollars'] }] };
  const r = applyPageWords(PAGE, mapping, JOB);
  assert.deepEqual(r.facts[0].words, ['From']);
  assert.deepEqual(r.dropped.filter((d) => d.reason === 'no-value').map((d) => d.word), ['Nonstop']);
});

test('a label that reads no money (a money fact\'s words and no unit) is dropped by the copied rules, the fact keeps its unit', () => {
  const mapping = { facts: [{ name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['Nonstop'], unit: ['US dollars'] }] };
  const r = applyPageWords(PAGE, mapping, JOB);
  assert.deepEqual(r.facts[0].words, []);
  assert.deepEqual(r.dropped.map((d) => d.reason), ['no-value']);
});

test('a time label that reads no time is dropped; a fact whose every time label reads nothing is dropped whole (no-label)', () => {
  const text = 'Leaves 5:00 PM from AMS\nGate B7 open\nTerminal 2';
  const some = applyPageWords(text, { facts: [{ name: 'departure', from: 'line 1 rule 2', shape: 'time', words: ['Leaves', 'Gate'] }] }, JOB);
  assert.deepEqual(some.facts[0].words, ['Leaves']);
  assert.deepEqual(some.dropped.map((d) => d.word), ['Gate'], 'a label that does not read the same time as the first is dropped (R1) - with a reason');
  const none = applyPageWords(text, { facts: [{ name: 'departure', from: 'line 1 rule 2', shape: 'time', words: ['Gate', 'Terminal'] }] }, JOB);
  assert.deepEqual(none.facts, []);
  assert.deepEqual(none.dropped.map((d) => d.reason), ['no-value', 'no-value', 'no-label']);
});

test('a phrase fact is never touched by the no-value rule', () => {
  const mapping = { facts: [{ name: 'nonstop', from: 'line 1 rule 3', shape: 'phrase', words: ['Nonstop'] }] };
  const r = applyPageWords(PAGE, mapping, JOB);
  assert.deepEqual(r.facts[0].words, ['Nonstop']);
  assert.deepEqual(r.dropped, []);
});

test('a currency or unit listed twice in one list is deduped before the rules run: nothing to say, nothing dropped', () => {
  const twiceCurrency = applyPageWords(PAGE, { facts: [{ name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['From'], currency: ['$', '$'] }] }, JOB);
  assert.deepEqual(twiceCurrency.dropped, [], 'a sign listed twice is one sign; the rules must not call it "a unit and a currency"');
  assert.deepEqual(twiceCurrency.facts[0].currency, ['$']);
  const twiceUnit = applyPageWords(PAGE, { facts: [{ name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['From'], unit: ['US dollars', 'US dollars'] }] }, JOB);
  assert.deepEqual(twiceUnit.dropped, []);
  assert.deepEqual(twiceUnit.facts[0].unit, ['US dollars']);
});

test('no drop compares a word with itself, in any listing of the same word', () => {
  for (const f of [{ currency: ['US dollars'], unit: ['US dollars'] }, { currency: ['$', '$'], unit: ['US dollars', 'US dollars'] }, { currency: ['$'], unit: ['$'] }]) {
    const r = applyPageWords(PAGE, { facts: [{ name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['From'], ...f }] }, JOB);
    assert.ok(r.dropped.every((d) => d.word !== d.other || /twice/.test(dropSentence(d))), JSON.stringify(r.dropped));
    for (const row of dropRows(r.dropped)) for (const s of row.sentences) assert.doesNotMatch(s, /^"(.+)" does not show the same (amounts|values) as "\1"/);
  }
});

test('no silent drop: every drop in F71\'s three drafts has a plain sentence from the one table, and a Not-checked line', () => {
  const FALLBACK = /was left out\.$/;
  for (const n of [1, 2, 3]) {
    const mapping = JSON.parse(raw(n));
    const r = applyPageWords(PAGE, mapping, JOB);
    const lines = notCheckedLines(r.dropped, JOB);
    assert.ok(r.dropped.length > 0, `draft ${n} has drops to check`);
    for (const d of r.dropped) assert.doesNotMatch(dropSentence(d), FALLBACK, `draft ${n}: ${JSON.stringify(d)} has no reason in the table`);
    for (const row of dropRows(r.dropped)) for (const s of row.sentences) assert.ok(lines.some((l) => l.includes(s)), `draft ${n}: "${s}" is in no Not-checked line`);
    assert.ok(lines.every((l) => /^line \d+: ".+" — .+/.test(l)), lines.join('\n'));
  }
});

// ---- the one map call per page input -------------------------------------------------------------------------------------------------------
const goodAnswer = JSON.stringify({ facts: [{ name: 'nonstop', from: 'line 1 rule 3', shape: 'phrase', words: ['Nonstop', 'Direct only'] }] });
const model = (replies) => { const calls = []; const f = async (content) => { calls.push(content); const r = replies[Math.min(calls.length - 1, replies.length - 1)]; return typeof r === 'string' ? { text: r } : r; }; f.calls = calls; return f; };

test('lookAtPage: one call, kept facts carry their source, drops come back as Not-checked lines', async () => {
  const callModel = model([goodAnswer]);
  const r = await lookAtPage({ label: 'flights', text: PAGE, jobLines: JOB, callModel });
  assert.equal(r.ok, true);
  assert.equal(callModel.calls.length, 1);
  assert.match(callModel.calls[0], /PAGE TEXT \(the input "flights"\):/);
  assert.deepEqual(r.look.facts.map((f) => [f.name, f.source, f.words, f.line, f.forRule]), [['nonstop', 'flights', ['Nonstop'], 1, 3]]);
  assert.deepEqual(r.notChecked, ['line 1: "nonstop" — "Direct only" is not written on the page.']);
});

test('lookAtPage: an unreadable answer is asked once more; two unreadable answers stop (no repair)', async () => {
  const callModel = model(['not json', '{"facts": "x"}']);
  const r = await lookAtPage({ label: 'flights', text: PAGE, jobLines: JOB, callModel });
  assert.equal(r.ok, false);
  assert.equal(r.reason, MAP_UNREADABLE);
  assert.equal(callModel.calls.length, 2);
  const ok = await lookAtPage({ label: 'flights', text: PAGE, jobLines: JOB, callModel: model(['not json', goodAnswer]) });
  assert.equal(ok.ok, true);
});

test('lookAtPage: an answer cut off at the output cap is unreadable, even when what arrived parses', async () => {
  const callModel = model([{ text: goodAnswer, cutOff: true }]);
  const r = await lookAtPage({ label: 'flights', text: PAGE, jobLines: JOB, callModel });
  assert.equal(r.ok, false);
  assert.equal(callModel.calls.length, 2);
});

test('lookAtPage: a failed call stops with its reason and is not retried here', async () => {
  const callModel = model([{ error: 'the provider answered 500' }]);
  const r = await lookAtPage({ label: 'flights', text: PAGE, jobLines: JOB, callModel });
  assert.equal(r.ok, false);
  assert.match(r.reason, /the provider answered 500/);
  assert.equal(callModel.calls.length, 1);
});
