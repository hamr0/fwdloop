// M10 am27 (docs/wiki/the-module-ladder.md): at drafting (1) a count guardrail never reaches the page look or the drafter, (2) was code repairs (gone, M17 am5),
// (3) a single count the suggestion call keeps nothing for gets a code-built pick, (4) every draft records the per-line retention. Fake provider, $0. Each test was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse } from '../src/panel/authorcard.js';
import { draft, hideCounts } from '../src/drafter.js';
import { retentionOf } from '../src/checkpick.js';
import { countCheck } from '../src/blockpick.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

const JOB = [
  'Write 3 lines about my garden from the notes', 'Ask: check it with me', 'List 3 jobs for this week from the notes', '~ exactly 3 bullets; under 80 words; keep it kind',
  'Ask: check it with me', 'Write a short closing note to my neighbour', 'Ask: check it with me', 'Write it out',
].join('\n');

function prose(t, job = JOB) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-am27-'));
  const out = path.join(home, 'out');
  mkdirSync(out);
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, '# Notes\n- a\n');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return cardToProse(cardFields({ flowName: 'garden', job, inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }));
}
// lines: 1 notes, 2 ask, 3 list, 4 ask, 5 note, 6 ask, 7 send
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
  guardrailClasses: {}, unjudgeable: {}, refused: [], ...over,
});

// M16 item 5 replaces M10 am27 (1) "a count guardrail never reaches the drafter" FOR THE LINES OF THE LIST: their count rules are shown like any other rule (the lines the list is not given keep am27 (1): hideCounts below)
test('(1) M16 item 5: a list line\'s count rules reach the drafter beside its non-count rules', async (t) => {
  const p = fakeProvider([toolReply(plan())]);
  const r = await draft({ proseText: prose(t), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  const sent = JSON.stringify(p.calls[0].messages);
  assert.ok(sent.includes('exactly 3 bullets') && sent.includes('under 80 words'), 'the counts are shown on a list line');
  assert.ok(sent.includes('keep it kind'), 'the non-count rule is shown too');
});

test('(1) hideCounts: the page look sees only the non-count rules; a visible rule number maps back to the original one', () => {
  const jobLines = [{ n: 1, text: 'List jobs', rule: 'exactly 3 bullets; keep it kind; under 80 words; nonstop' }, { n: 2, text: 'Ask' }];
  const { seenLines, toOriginal } = hideCounts(jobLines);
  assert.deepEqual(seenLines, [{ n: 1, text: 'List jobs', rule: 'keep it kind; nonstop' }, { n: 2, text: 'Ask' }]);
  assert.deepEqual(toOriginal({ line: 1, forRule: 2, name: 'x' }), { line: 1, forRule: 4, name: 'x' });
  assert.deepEqual(toOriginal({ line: 1, rule: 1 }), { line: 1, rule: 2 });
  assert.deepEqual(toOriginal({ line: 1 }), { line: 1 });
});

// ---- (2) M17 am5 (1): the old declaration repair (B8) is gone; the list sets each line's reads and its Not checked reasons ----
// M16 item 5 replaces M10 am27 (2) "repairs" FOR LIST LINES: code overwrites the classes and notes of a list line, so the AI's note on line 5 is gone and nothing is logged as repaired
test('(2) M16 item 5: a note the AI sent for a list line is overwritten by code, no repair is logged on that round', async (t) => {
  const bad = plan({ guardrailClasses: { 5: 'green' }, unjudgeable: { 5: 'the page cannot prove it' } });
  const p = fakeProvider([toolReply(bad)]);
  const r = await draft({ proseText: prose(t, JOB.replace(/\n~ [^\n]*/, '')), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  const round = r.log.find((e) => e.kind === 'first');
  assert.equal(round.repaired, undefined);
  assert.equal(r.declaration.unjudgeable, undefined, 'M17 am4 (C8): a new plan carries no unjudgeable record');
  assert.equal(r.declaration.guardrailClasses['5'], undefined);
});

// ---- (3) a single count the suggestion call keeps nothing for gets the pick code builds from the guardrail's own number ----
const suggestReply = (checks) => ({ text: '', toolCalls: [{ id: 's1', name: 'suggest_checks', arguments: { checks } }], usage: { inputTokens: 900, outputTokens: 100 }, stopReason: 'tool_calls', model: MODEL });
const ONE_COUNT = JOB.replace(/\n~ [^\n]*/, '\n~ exactly 3 bullets');

test('(3) countCheck: one count builds the check its own readers name; two counts, a range, a section count build none', () => {
  assert.deepEqual(countCheck('exactly 3 bullets'), { rule: 'listItems', value: 3 });
  assert.deepEqual(countCheck('under 80 words'), { rule: 'maxWords', value: 80 });
  assert.deepEqual(countCheck('at least 50 words'), { rule: 'minWords', value: 50 });
  assert.deepEqual(countCheck('exactly 5 lines'), { rule: 'maxLines', value: 5 });
  assert.equal(countCheck('3 bullets under 80 words'), null);
  assert.equal(countCheck('between 50 and 80 words'), null);
  assert.equal(countCheck('3 sections'), null);
  assert.equal(countCheck('keep it kind'), null);
});

test('(3) the suggestion call keeps nothing for a single count: the person is offered the code-built pick, never "I can\'t check this"', async (t) => {
  for (const checks of [[], [{ line: 3, guardrail: 1, rule: 'maxWords', value: 80 }]]) {
    const p = fakeProvider([suggestReply(checks)]);
    const r = await draft({ proseText: prose(t, ONE_COUNT), provider: p, rates: RATES, modelId: MODEL });
    assert.equal(r.stop, 'look-asks');
    assert.deepEqual(r.questions.map((q) => [q.line, q.ask, q.proposal, q.check]), [[3, 'check', 'exactly 3 list items', { rule: 'listItems', value: 3 }]]);
    assert.ok(!r.questions.some((q) => /can't check this/.test(q.question)));
    assert.equal(p.calls.some((c) => c.tools[0] === 'emit_declaration'), false);
  }
});

// ---- (4) every draft records, per job line, the AI checks written, kept, dropped and the picks ----
const stepOn = (n, close) => ({ primitives: ['read'], reads: [], emits: `e${n}`, fromLine: n, close });
const cites = (...names) => ({ class: 'green', cited: { source: 'flights', facts: names.map((name) => ({ name })) } });

test('(4) retentionOf: per line, cited facts written / kept / dropped, the pick flag and the class as sent and as ended; counts only', () => {
  const drafted = { steps: [stepOn(1, cites('a', 'b', 'c')), stepOn(2, { class: 'hitl' })] };
  const final = { steps: [stepOn(1, cites('a')), stepOn(2, { class: 'softgreen' })] };
  assert.deepEqual(retentionOf(drafted, final, [{ n: 1 }, { n: 2 }, { n: 3 }], [2]), [
    { line: 1, aiParts: 3, kept: 1, dropped: 2, picks: false, classAsked: 'green', classFinal: 'green' },
    { line: 2, aiParts: 0, kept: 0, dropped: 0, picks: true, classAsked: 'hitl', classFinal: 'softgreen' },
    { line: 3, aiParts: 0, kept: 0, dropped: 0, picks: false, classAsked: null, classFinal: null },
  ]);
  assert.deepEqual(retentionOf(null, final, [{ n: 1 }]), []);
});

// M16 item 5 replaces M10 am27 (4) "the per-line record of AI checks" FOR LIST LINES: the declaration round still carries one row per job line, and the AI wrote no check on any of them
test('(4) M16 item 5: the declaration round carries the record, one row per job line, none of them an AI check, in a plan with a pick and in one without', async (t) => {
  for (const picks of [undefined, [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: 'exactly 3 list items' }]]) {
    const p = fakeProvider([toolReply(plan())]);
    const r = await draft({ proseText: prose(t, ONE_COUNT), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false, ...(picks ? { checkPicks: picks } : {}) });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
    const rec = r.log.find((e) => e.kind === 'first').retention;
    assert.ok(Array.isArray(rec) && rec.length === 7, `a row per job line (got ${JSON.stringify(rec)})`);
    assert.deepEqual(rec.map((x) => x.line), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(rec.find((x) => x.line === 3).picks, picks !== undefined);
    assert.ok(rec.every((x) => x.aiParts === 0), 'the AI wrote no check on a list line');
  }
});
