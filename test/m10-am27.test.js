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
