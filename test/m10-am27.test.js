// M10 am27 (docs/wiki/the-module-ladder.md): at drafting (1) a count guardrail never reaches the page look or the drafter, (2) code repairs two plan mistakes and logs each,
// (3) a single count the suggestion call keeps nothing for gets a code-built pick, (4) every draft records the per-line retention. Fake provider, $0. Each test was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse } from '../src/panel/authorcard.js';
import { draft, hideCounts } from '../src/drafter.js';
import { repairDeclaration } from '../src/repairs.js';
import { countCheck } from '../src/checkpick.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

const JOB = [
  'Write 3 lines about my garden from the notes', 'Ask: check it with me', 'List 3 jobs for this week from the notes', '~ exactly 3 bullets; under 80 words; keep it kind',
  'Ask: check it with me', 'Write a short closing note to my neighbour', 'Ask: check it with me',
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

test('(1) the drafter\'s prompt never carries a count guardrail; a non-count guardrail still does', async (t) => {
  const p = fakeProvider([toolReply(plan())]);
  const r = await draft({ proseText: prose(t), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  const sent = JSON.stringify(p.calls[0].messages);
  assert.ok(!/exactly 3 bullets|under 80 words/.test(sent), 'a count reached the drafter');
  assert.ok(sent.includes('keep it kind'), 'the non-count rule is still shown');
});

test('(1) hideCounts: the page look sees only the non-count rules; a visible rule number maps back to the original one', () => {
  const jobLines = [{ n: 1, text: 'List jobs', rule: 'exactly 3 bullets; keep it kind; under 80 words; nonstop' }, { n: 2, text: 'Ask' }];
  const { seenLines, toOriginal } = hideCounts(jobLines);
  assert.deepEqual(seenLines, [{ n: 1, text: 'List jobs', rule: 'keep it kind; nonstop' }, { n: 2, text: 'Ask' }]);
  assert.deepEqual(toOriginal({ line: 1, forRule: 2, name: 'x' }), { line: 1, forRule: 4, name: 'x' });
  assert.deepEqual(toOriginal({ line: 1, rule: 1 }), { line: 1, rule: 2 });
  assert.deepEqual(toOriginal({ line: 1 }), { line: 1 });
});

// ---- (2) the two code repairs, each logged; none grants a primitive ----
const ARB = { sources: [{ role: 'flights', kind: 'page' }, { role: 'notes', kind: 'file' }] };
const cited = (source) => ({ class: 'green', cited: { source, facts: [{ name: 'price', rule: { op: 'lt', value: 150 } }] } });
const gdecl = (over = {}) => ({
  steps: [{ primitives: ['read'], reads: ['notes'], emits: 'a', fromLine: 1, close: cited('flights') }, { primitives: [], reads: ['a'], emits: 'b', fromLine: 2, close: { class: 'hitl' } }],
  guardrailClasses: { 1: 'green' }, unjudgeable: {}, refused: [], ...over,
});

test('(2) a green step citing a declared page it does not read gets that page added to its reads, logged; primitives and class are untouched', () => {
  const d = gdecl();
  const before = JSON.stringify(d);
  const { declaration, repaired } = repairDeclaration(d, ARB);
  assert.equal(JSON.stringify(d), before, 'the input is not changed');
  assert.deepEqual(declaration.steps[0].reads, ['notes', 'flights']);
  assert.deepEqual(declaration.steps[0].primitives, ['read']);
  assert.equal(declaration.steps[0].close.class, 'green');
  assert.deepEqual(repaired, ['steps[0].reads: added "flights" (its cited check reads it)']);
  // a source that is no declared role is not invented into reads; a step that already reads it is left alone
  assert.deepEqual(repairDeclaration(gdecl({ steps: [{ ...gdecl().steps[0], close: cited('nowhere') }] }), ARB).repaired, []);
  assert.deepEqual(repairDeclaration(gdecl({ steps: [{ ...gdecl().steps[0], reads: ['flights'] }] }), ARB).repaired, []);
});

test('(2) an unjudgeable note on a line whose class is green is dropped, logged with its reason; a note on a non-green line stays', () => {
  const d = gdecl({ steps: [{ ...gdecl().steps[0], reads: ['flights'] }], unjudgeable: { 1: 'Rome is not on the page', 2: 'a human judges it' }, guardrailClasses: { 1: 'green', 2: 'hitl' } });
  const { declaration, repaired } = repairDeclaration(d, ARB);
  assert.deepEqual(declaration.unjudgeable, { 2: 'a human judges it' });
  assert.deepEqual(repaired, ['unjudgeable: dropped the entry for line 1 (its class is green; reason was: Rome is not on the page)']);
  assert.equal(declaration.guardrailClasses[1], 'green');
  assert.deepEqual(repairDeclaration(gdecl(), { sources: [] }).repaired, [], 'nothing to repair is nothing logged');
});

test('(2) a repair never grants a primitive: every step keeps exactly its own primitives', () => {
  const d = gdecl({ unjudgeable: { 1: 'x' } });
  const { declaration } = repairDeclaration(d, ARB);
  assert.deepEqual(declaration.steps.map((s) => s.primitives), d.steps.map((s) => s.primitives));
  assert.deepEqual(declaration.steps.map((s) => s.close.class), ['green', 'hitl']);
});

test('(2) a draft whose plan needs a repair carries the log of it on that round', async (t) => {
  const bad = plan({ guardrailClasses: { 5: 'green' }, unjudgeable: { 5: 'the page cannot prove it' } });
  const p = fakeProvider([toolReply(bad)]);
  const r = await draft({ proseText: prose(t, JOB.replace(/\n~ [^\n]*/, '')), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  const round = r.log.find((e) => e.kind === 'draft' || e.round === 1);
  assert.deepEqual(round.repaired, ['unjudgeable: dropped the entry for line 5 (its class is green; reason was: the page cannot prove it)']);
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
