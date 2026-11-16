// M17 am4 + am5 (docs/wiki/the-module-ladder.md), piece P5: Not checked comes only from the list; a `~` rule on an Ask line is Not checked there, never skipped; the AI's own notes, the declaration repair
// and the hidden can't-judge record are gone. Fake provider, $0. Each test below was shown red by breaking src alone (see the ladder's P5 note).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse } from '../src/panel/authorcard.js';
import { draft } from '../src/drafter.js';
import { ASK_LINE_REASON } from '../src/blockassemble.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

const JOB = [
  'Write 3 lines about my garden from the notes', 'Ask: check it with me', '~ looks tidy', 'List 3 jobs for this week from the notes', '~ keep it kind',
  'Ask: check it with me', 'Write a short closing note to my neighbour', 'Ask: check it with me', 'Write it out',
].join('\n');

function prose(t, job = JOB) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-p5-'));
  const out = path.join(home, 'out');
  mkdirSync(out);
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, '# Notes\n- a\n');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return cardToProse(cardFields({ flowName: 'garden', job, inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }));
}
// lines: 1 notes, 2 ask (carries a ~ rule), 3 list (~ keep it kind), 4 ask, 5 note, 6 ask, 7 send
const plan = (over = {}) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'garden', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['garden'], emits: 'ok1', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['ok1'], emits: 'jobs', fromLine: 3, close: { class: 'hitl' } },
    { primitives: [], reads: ['jobs'], emits: 'ok2', fromLine: 4, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['ok2'], emits: 'note', fromLine: 5, close: { class: 'hitl' } },
    { primitives: [], reads: ['note'], emits: 'ok3', fromLine: 6, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['note', 'ok3'], emits: 'sent', fromLine: 7, close: { class: 'hitl' } },
  ],
  guardrailClasses: {}, refused: [], ...over,
});
const go = async (t, over = {}) => {
  const p = fakeProvider([toolReply(plan(over))]);
  const r = await draft({ proseText: prose(t), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  return r;
};

test('am5 item 2 (D3): a ~ rule on an Ask line shows once in Not checked with the signed reason, tagged [you]; it is never skipped', async (t) => {
  const r = await go(t);
  const line = `not checked · "looks tidy" — ${ASK_LINE_REASON}`;
  assert.equal(ASK_LINE_REASON, 'you judge it at the Ask');
  assert.equal(r.notChecked.filter((x) => x === line).length, 1, JSON.stringify(r.notChecked));
  assert.equal(r.notCheckedBy[line], 'you');
});

test('am4 (C1): a Not checked line the AI sent is never on the card; Not checked is the list\'s only', async (t) => {
  const r = await go(t, { notChecked: ['the tone is not machine-checked', 'keep it kind is not checked'] });
  assert.ok(!r.notChecked.some((x) => x.includes('machine-checked') || x.includes('is not checked')), JSON.stringify(r.notChecked));
  assert.ok(r.notChecked.some((x) => x.includes('"keep it kind"')), 'the list says it, once');
  assert.equal(r.notChecked.filter((x) => x.includes('keep it kind')).length, 1);
  assert.equal(Object.values(r.notCheckedBy).includes('agent'), false, 'no [agent] Not checked line');
});

test('am5 item 1 (B8): no round of a draft logs a repair, and an AI-written unjudgeable note neither reaches the plan nor drops a Not checked reason', async (t) => {
  const r = await go(t, { guardrailClasses: { 3: 'green' }, unjudgeable: { 3: 'a reason the AI wrote' } });
  assert.ok(r.log.every((e) => e.repaired === undefined));
  assert.equal(r.declaration.unjudgeable, undefined, 'am4 (C8): a new plan carries no can\'t-judge record');
  assert.ok(r.notChecked.some((x) => x.includes('"keep it kind"') && !x.includes('a reason the AI wrote')), JSON.stringify(r.notChecked));
});
