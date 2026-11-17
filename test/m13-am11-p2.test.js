// M13 am11 rules 1 and 2 at the drafter: the AI answers ONE question (is there a last step that writes or sends everything before it?), code checks the answer is the LAST line (not an Ask);
// with none, the AI suggests one line and the question carries the signed words; `known` (the person's answer) calls nothing (no `none` since M13 am11c). The tentative send is kept or taken out of the prose.
// Fake provider, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { RECOGNISE_SYSTEM, SUGGEST_SYSTEM, suggestionQuestion, withoutSend, recognisedIsLast, cleanSuggestion } from '../src/action-line.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

const out = () => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-am11p2-')); mkdirSync(path.join(d, 'out')); return path.join(d, 'out'); };
const prose = (lines, sendLine, dest, extra = '') => `${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}${extra}\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $5 per run\nguardrail: send at line ${sendLine} to file:${dest}\n`;
const step = (fromLine, emits, reads, primitives, cls = 'hitl') => ({ primitives, reads, emits, fromLine, close: { class: cls } });
const plan = (withSend) => ({
  steps: [step(1, 'n1', [], ['read']), ...(withSend ? [step(2, 'out', ['n1'], ['write'])] : [step(2, 'n2', ['n1'], ['read'])])],
  guardrailClasses: {}, unjudgeable: {}, refused: [],
});
const names = (p) => p.calls.map((c) => c.tools[0]);

test('rule 1: the AI names the last line: it is the action; the send stays; one forced call with the F204 words, metered', async () => {
  const dest = out();
  const p = fakeProvider([toolReply(plan(true))]); p.recognise = 2;
  const r = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, dest), actionMode: 'check', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('; '));
  assert.deepEqual(names(p).slice(0, 2), ['record_action', 'emit_declaration']);
  assert.equal(p.calls[0].messages[0].content, RECOGNISE_SYSTEM);
  assert.deepEqual(p.calls[0].options.toolChoice, { name: 'record_action' });
  assert.equal(p.calls[0].options.thinkingMode, 'off');
  assert.match(p.calls[0].messages[1].content, /^The job:\n1\. Write the note\n2\. Write it out\n\nDestination: folder /);
  assert.equal(r.log[0].kind, 'action-recognise');
  assert.deepEqual(r.action, { line: 2, by: 'agent' });
  assert.match(r.proseText, /guardrail: send at line 2 to /);
  assert.ok(r.costUsd > 0);
});

test('rule 1: the AI names a line that is not the last, or none: no action; the question is asked (rule 2) and the send is taken out', async () => {
  for (const named of [1, null]) {
    const dest = out();
    const p = fakeProvider([toolReply(plan(false))]); p.recognise = named; p.suggest = 'Write the result out to the Destination.';
    // eslint-disable-next-line no-await-in-loop
    const r = await draft({ proseText: prose(['Write the note', 'Tidy it'], 2, dest), actionMode: 'check', provider: p, rates: RATES, modelId: MODEL });
    assert.equal(r.stop, 'look-asks', `${named}: ${r.reds.join('; ')}`);
    assert.deepEqual(names(p), ['record_action', 'suggest_action']);
    assert.equal(p.calls[1].messages[0].content, SUGGEST_SYSTEM);
    assert.deepEqual(r.questions.map((q) => [q.line, q.source, q.ask, q.question, q.proposal]), [[2, 'look', 'action', suggestionQuestion('Write the result out to the Destination.'), 'Write the result out to the Destination.']]);
    assert.doesNotMatch(r.proseText, /send at line/, 'nothing is added or sent without an answer');
    assert.deepEqual(r.action, null);
  }
});

test('rule 1: a last line that is an Ask is never the action: no recognise call, straight to the suggestion', async () => {
  const dest = out();
  const p = fakeProvider([toolReply(plan(false))]); p.recognise = 2; p.suggest = 'Write it out.';
  const r = await draft({ proseText: prose(['Write the note', 'ask 30m: look at it'], 2, dest), actionMode: 'check', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'look-asks');
  assert.deepEqual(names(p), ['suggest_action']);
});

test('rule 2: no usable suggestion (a newline, empty): nothing is asked and no line is added', async () => {
  const dest = out();
  const p = fakeProvider([toolReply(plan(false))]); p.recognise = null; p.suggest = 'two\nlines';
  const r = await draft({ proseText: prose(['Write the note', 'Tidy it'], 2, dest), actionMode: 'check', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('; '));
  assert.deepEqual(r.questions ?? [], []);
  assert.doesNotMatch(r.proseText, /send at line/);
});

test('known (an Agree or typed line) calls nothing about the action and keeps the send (no "none" mode since am11c)', async () => {
  const dest = out();
  const known = fakeProvider([toolReply(plan(true))]);
  const a = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, dest), actionMode: 'known', provider: known, rates: RATES, modelId: MODEL });
  assert.equal(a.ok, true, a.reds.join('; '));
  assert.deepEqual(names(known), ['emit_declaration']);
  assert.match(a.proseText, /send at line 2 to /);
  assert.deepEqual(a.action, { line: 2, by: 'you' });
});

test('no actionMode: the prose file is the truth (a hand-written send line): no action call, and a guardrail on the send line is still refused at $0', async () => {
  const dest = out();
  const p = fakeProvider([toolReply(plan(true))]);
  const r = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, dest), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('; '));
  assert.deepEqual(names(p), ['emit_declaration']);
  const g = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, dest, '\n   guardrail: under 5 words'), provider: fakeProvider([toolReply(plan(true))]), rates: RATES, modelId: MODEL });
  assert.equal(g.stop, 'pre-flight');
});

test('check: the action line the AI named carries a guardrail: refused with the send-line words (after the one call)', async () => {
  const dest = out();
  const p = fakeProvider([toolReply(plan(true))]); p.recognise = 2;
  const r = await draft({ proseText: prose(['Write the note', 'Write it out'], 2, dest, '\n   guardrail: under 5 words'), actionMode: 'check', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, false);
  assert.match(r.reds.join(' '), /line 2 is the send line/);
  assert.deepEqual(names(p), ['record_action']);
});

test('the checks: only the LAST line, never an Ask, is the action; a suggestion is one plain line', () => {
  assert.equal(recognisedIsLast({ action: { line: 3 } }, 3, false), true);
  assert.equal(recognisedIsLast({ action: { line: 2 } }, 3, false), false);
  assert.equal(recognisedIsLast({ action: { line: 3 } }, 3, true), false);
  assert.equal(recognisedIsLast({ action: { line: null } }, 3, false), false);
  assert.equal(recognisedIsLast({ action: { line: '3' } }, 3, false), false);
  assert.equal(recognisedIsLast(null, 3, false), false);
  assert.equal(cleanSuggestion({ text: ' Write it out. ' }), 'Write it out.');
  assert.equal(cleanSuggestion({ text: '' }), null);
  assert.equal(cleanSuggestion({ text: 'a\nb' }), null);
  assert.equal(withoutSend('1. a\n\nArbiter guardrails\nguardrail: cap $1 per run\nguardrail: send at line 1 to file:/x\n'), '1. a\n\nArbiter guardrails\nguardrail: cap $1 per run\n');
});
