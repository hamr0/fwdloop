// M10 piece 5 (item 2, "a quote in a doc") at the drafter: the drafter offers a cited fact part for a document input (.md / .txt / .docx) and code proves its words on
// the drafting copy of the document, as for a page. Fake provider, local files, $0.
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
    { primitives: [], reads: ['terms'], emits: 'fees_found', fromLine: 1, close: { class: 'green', cited: { source: 'terms', facts, count } } },
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

test('a markdown document: the drafter is told it may quote it, and a cited part whose words are in the document is valid', () => withFile('terms.md', MD, async (f) => {
  const p = fakeProvider([toolReply(decl(good()))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.declaration.steps[0].close.cited.count, { min: 2, max: 2 });
  const sys = p.calls[0].messages[0].content;
  assert.match(sys, /Document inputs in this job: terms\./);
  assert.match(sys, /close\.cited = \{source, facts, count\}/);
  assert.match(sys, /For a document input there is no list of kept labels/);
}));

// must fail (signed): a kept word isn't in the source
test('a label that is not in the document is refused at $0 naming the line', () => withFile('terms.md', MD, async (f) => {
  const bad = [{ name: 'fee', shape: 'number', anchor: 'The cost is', rule: { op: 'lt', value: 100 } }];
  const p = fakeProvider([toolReply(decl(bad)), toolReply(decl(good()))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true);
  assert.equal(r.revisions, 1);
  assert.ok(JSON.stringify(p.calls[1].messages).includes('line 1') && JSON.stringify(p.calls[1].messages).includes('The cost is'), 'the refusal named the line and the word');
}));

test('a number rule the person never wrote is refused on a document too', () => withFile('terms.md', MD, async (f) => {
  const bad = [{ name: 'fee', shape: 'number', anchor: 'The fee is', rule: { op: 'lt', value: 77 } }];
  const p = fakeProvider([toolReply(decl(bad)), toolReply(decl(bad)), toolReply(decl(bad))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes('77') && x.includes('line 1')), JSON.stringify(r.reds));
}));

test('a .docx document: proved on its paragraph text', () => withFile('terms.docx', makeDocx(para('Heading1', 'Fees') + para(null, 'The fee is 45 dollars per month.') + para(null, 'The fee is 60 dollars per month.')), async (f) => {
  const p = fakeProvider([emptyMap(), toolReply(decl(good()))]);
  const r = await draft({ proseText: prose(f), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('\n'));
  const bad = fakeProvider([emptyMap(), toolReply(decl([{ name: 'fee', shape: 'number', anchor: 'The cost is' }])), toolReply(decl([{ name: 'fee', shape: 'number', anchor: 'The cost is' }])), toolReply(decl([{ name: 'fee', shape: 'number', anchor: 'The cost is' }]))]);
  assert.equal((await draft({ proseText: prose(f), provider: bad, rates: RATES, modelId: MODEL })).ok, false);
}));
