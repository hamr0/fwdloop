// M10 piece 5 (item 2, "a quote in a doc") at the drafter. M16 item 5 replaces M10 am7 item 1 (the drafter writes the facts) FOR THE LINES OF THE LIST: a document line's quote check is built by code
// from the list, and whatever cited part the AI sends for it is dropped, so its words are never judged. The tests below say that. Fake provider, local files, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { RATES, MODEL, fakeProvider, textReply, toolReply } from './drafter-fixture.mjs';
import { makeDocx, para } from './fixtures/docx-make.mjs';

const MD = '# Fees\nThe fee is 45 dollars per month.\nThe fee is 60 dollars per month.\n# Term\nTwelve months.\n';
const prose = (file) => `1. List 2 fees from the terms,
   guardrail: under 100
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source terms = file:${file}
`;
const decl = (facts, count = { min: 2, max: 2 }) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'fees_found', fromLine: 1, close: { class: 'green', cited: { source: 'terms', facts, count } } },
    { primitives: [], reads: ['fees_found'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'green', 2: 'hitl' }, unjudgeable: {}, refused: [],
});
const good = () => [{ name: 'fee', shape: 'number', anchor: 'The fee is', rule: { op: 'lt', value: 100 } }];
const emptyMap = () => ({ ...textReply('{"facts":[]}'), usage: { inputTokens: 1000, outputTokens: 20 } });
const withFile = async (name, bytes, fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10doc-'));
  const f = path.join(dir, name);
  writeFileSync(f, bytes);
  try { return await fn(f); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('M16 item 5: a markdown document line is offered no close.cited; the cited part the AI sends anyway is dropped and the plan is valid', () => withFile('terms.md', MD, async (f) => {
  const p = fakeProvider([toolReply(decl(good()))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.declaration.steps[0].close.cited, undefined, 'the AI wrote no check that reached the plan');
  const sys = p.calls[0].messages[0].content;
  assert.doesNotMatch(sys, /close\.cited/);
  assert.equal(p.calls[0].schemas[0].properties.steps.items.properties.close.properties.cited, undefined);
}));

// must fail (signed): the AI writes a check
test('M16 item 5: a label that is not in the document never reaches the plan (the AI\'s cited part is dropped, nothing to refuse, no revise)', () => withFile('terms.md', MD, async (f) => {
  const bad = [{ name: 'fee', shape: 'number', anchor: 'The cost is', rule: { op: 'lt', value: 100 } }];
  const p = fakeProvider([toolReply(decl(bad))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.revisions, 0);
  assert.equal(r.declaration.steps[0].close.cited, undefined);
}));

test('M16 item 5: a number rule the person never wrote is dropped with the AI\'s cited part, on a document too', () => withFile('terms.md', MD, async (f) => {
  const bad = [{ name: 'fee', shape: 'number', anchor: 'The fee is', rule: { op: 'lt', value: 77 } }];
  const p = fakeProvider([toolReply(decl(bad))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.ok(!JSON.stringify(r.declaration).includes('77'), 'the invented number is nowhere in the plan');
}));

test('M16 item 5: a .docx document line: the AI\'s cited part is dropped as well', () => withFile('terms.docx', makeDocx(para('Heading1', 'Fees') + para(null, 'The fee is 45 dollars per month.') + para(null, 'The fee is 60 dollars per month.')), async (f) => {
  const d = decl([{ name: 'fee', shape: 'number', anchor: 'The cost is' }]);
  d.steps[0].primitives = ['readDocx']; // a .docx is read through its own tool
  const p = fakeProvider([emptyMap(), toolReply(d)]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.equal(r.declaration.steps[0].close.cited, undefined);
}));
