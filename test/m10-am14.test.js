// M10 amendment 14: (1) a guardrail on the send line is refused at $0 (card and drafter pre-flight); (2) a shape check carries every standalone
// number its line's guardrail names, and none it never named; (3) the drafter is told both rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cardFields, checkCard, cardToProse } from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { checkShapeFitsJobLine, checkSendLineGuardrail, guardrailStandaloneNumbers } from '../src/declaration.js';
import { draft } from '../src/drafter.js';
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

const JOB = [
  'Write 3 lines about my garden from the notes', 'Ask: check it with me', 'List 3 jobs for this week from the notes', '~ exactly 3 bullets',
  'Ask: check it with me', 'Write a short closing note to my neighbour', '~ under 80 words', 'Ask: check it with me', 'Write it out',
].join('\n');

function world(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am14-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am14-home-'));
  const out = path.join(home, 'out');
  mkdirSync(out);
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, '# Notes\n- a\n');
  t.after(() => { for (const d of [root, home]) rmSync(d, { recursive: true, force: true }); });
  const card = (over = {}) => cardFields({ flowName: 'garden', job: JOB, inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y', ...over });
  return { card, check: (over) => checkCard(card(over), { root, home, keys: [] }) };
}

test('card: a guardrail under the send line is refused at $0, naming the line (and the walk job passes)', (t) => {
  const w = world(t);
  assert.equal(w.check().ok, true, 'the walk job (guardrails on lines 3 and 5, none on the send line) passes');
  const r = w.check({ job: `${JOB}\n~ exactly 3 bullets` });
  assert.equal(r.ok, false);
  assert.match(r.refusals.map((x) => x.say).join(' '), /line 7 is the send line.*exactly 3 bullets/);
});

test('drafter pre-flight: a prose file with a guardrail on the send line stops at $0 with no provider call', async (t) => {
  const w = world(t);
  const prose = cardToProse(w.card({ job: `${JOB}\n~ exactly 3 bullets` }));
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await draft({ proseText: prose, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'pre-flight');
  assert.equal(p.calls.length, 0);
  assert.match(r.reds.join(' '), /line 7 is the send line/);
});

const lines = (() => { const p = parseSignedText(cardToProse(cardFields({ flowName: 'g', job: JOB, inputs: '', destination: '/tmp/x', capUsd: '5', askWait: '1h' }))); return p.lines; })();
const red = (step) => { const reds = []; checkShapeFitsJobLine(step, 0, lines, reds); return reds; };
const mk = (fromLine, shape) => ({ fromLine, goal: lines.find((l) => l.n === fromLine).text, close: { class: 'softgreen', shape } });

test('shape check: line 3 "exactly 3 bullets" with a sections-only shape (F137) is red, naming the line and the number', () => {
  const r = red(mk(3, { sections: ['Jobs for this week'] }));
  assert.match(r.join(' '), /line 3's guardrail names 3, but the check does not carry 3/);
});

test('shape check: a shape carrying 3 passes; maxWords 80 on line 5 passes; a number the guardrail never named is red', () => {
  assert.deepEqual(red(mk(3, { linesPerInvoice: 3, mustCarry: ['x'] })), []);
  assert.deepEqual(red(mk(5, { maxWords: 80 })), []);
  assert.match(red(mk(3, { maxWords: 80 })).join(' '), /does not carry 3[\s\S]*maxWords 80, a number the guardrail never names/);
  assert.match(red(mk(5, { maxWords: 80, linesPerInvoice: 7, mustCarry: ['x'] })).join(' '), /linesPerInvoice 7, a number the guardrail never names/);
});

test('numbers: digits joined to letters are not standalone; commas and decimals read as one number; send-line check is pure', () => {
  assert.deepEqual(guardrailStandaloneNumbers('P1 tickets, 250ish each, under 1,000 words, 2.5 times, 3 bullets'), [1000, 2.5, 3]);
  assert.deepEqual(checkSendLineGuardrail([{ n: 2, text: 'x', guardrail: '' }], { sends: [{ line: 2 }] }), []);
  assert.equal(checkSendLineGuardrail([{ n: 2, text: 'x', guardrail: 'g' }], { sends: [{ line: 2 }] }).length, 1);
});

test('the drafter system prompt tells both rules', async (t) => {
  const w = world(t);
  const p = fakeProvider([toolReply(validArgs())]);
  await draft({ proseText: cardToProse(w.card()), provider: p, rates: RATES, modelId: MODEL });
  const system = p.calls[0].messages.find((m) => m.role === 'system').content;
  assert.match(system, /must carry every standalone number[^\n]*leave that line Not checked/i);
  assert.match(system, /send line[^\n]*no guardrail/i);
});
