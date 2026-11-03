// M10 amendment 14: (1) a guardrail on the send line is refused at $0 (card and drafter pre-flight). (2) is replaced by M10 am16.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cardFields, checkCard, cardToProse } from '../src/panel/authorcard.js';
import { checkSendLineGuardrail, guardrailStandaloneNumbers } from '../src/declaration.js';
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

// M10 am16 replaced (2) and am15: the drafter no longer writes a check, so its check cannot carry a made-up number or word. The same refusals now live in code's
// keep-or-drop (test/m10-am16-checkpick.test.js: "a number the guardrail never names", "a word the guardrail never names").

test('numbers: digits joined to letters are not standalone; commas and decimals read as one number; send-line check is pure', () => {
  assert.deepEqual(guardrailStandaloneNumbers('P1 tickets, 250ish each, under 1,000 words, 2.5 times, 3 bullets'), [1000, 2.5, 3]);
  assert.deepEqual(checkSendLineGuardrail([{ n: 2, text: 'x', guardrail: '' }], { sends: [{ line: 2 }] }), []);
  assert.equal(checkSendLineGuardrail([{ n: 2, text: 'x', guardrail: 'g' }], { sends: [{ line: 2 }] }).length, 1);
});

test('the drafter system prompt tells the am16 rule: it writes no check, and the send line has no guardrail', async (t) => {
  const w = world(t);
  const p = fakeProvider([toolReply(validArgs())]);
  await draft({ proseText: cardToProse(w.card({ job: JOB.replace('~ exactly 3 bullets\n', '').replace('~ under 80 words\n', '') })), provider: p, rates: RATES, modelId: MODEL });
  const system = p.calls[0].messages.find((m) => m.role === 'system').content;
  assert.match(system, /You write no check[^\n]*the human picks each check from a list/i);
  assert.match(system, /send line[^\n]*no guardrail/i);
  assert.doesNotMatch(system, /must carry every standalone number|mustCarry word must be a word/);
});
