// M6a — $0 tests for src/drafter.js against a fake provider. No key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft, MAX_STRUCTURE_RETRIES, MAX_REVISIONS, DRAFT_PROVIDER_OPTIONS } from '../src/drafter.js';
import { buildDeclarationSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply, textReply, truncatedReply, malformedReply,
} from './drafter-fixture.mjs';

const run = (provider, extra = {}) => {
  const fx = job2Fixture();
  return draft({ proseText: fx.prose, provider, rates: RATES, modelId: MODEL, ...extra });
};

test('(a) a valid forced tool call is accepted as-is, one metered round, no converter', async () => {
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.rounds, 1);
  assert.equal(p.calls.length, 1, 'HaltError after capture: no second paid wrap-up round');
  assert.deepEqual(p.calls[0].options.toolChoice, { name: 'emit_declaration' });
  assert.ok(r.costUsd > 0, 'cost is priced, never 0');
  assert.equal(r.declaration.steps[0].primitives[0], 'read');
  assert.deepEqual(Object.keys(r.declaration.inputFacts), ['resume', 'jd']);
  assert.deepEqual(r.declaration.inputFacts.jd, ['About the role', 'Responsibilities']);
});

test('(b1) the schema offers WIRED verbs only — "stash" is not on the enum or the menu', () => {
  const menu = wiredMenu(['core']);
  const enumVerbs = buildDeclarationSchema(menu).properties.steps.items.properties.primitives.items.enum;
  assert.deepEqual([...enumVerbs].sort(), ['addressCells', 'grep', 'read', 'readDocx', 'write']);
  assert.ok(!enumVerbs.includes('stash') && !enumVerbs.includes('recall'));
});

test('(b2) if the model grants an unwired verb anyway, the validator reds it by name (and it is fed back)', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const p = fakeProvider([toolReply(bad), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true);
  assert.equal(r.revisions, 1);
  const revisionPrompt = p.calls[1].messages.at(-1).content;
  assert.match(revisionPrompt, /primitives "stash" is in the catalogue but not wired/);
});

test('(b3) an unwired verb that never gets fixed ends red after MAX_REVISIONS, declaration not ok', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const p = fakeProvider([toolReply(bad)]);
  const r = await run(p);
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'validator');
  assert.equal(r.revisions, MAX_REVISIONS);
  assert.equal(r.rounds, 1 + MAX_REVISIONS);
  assert.ok(r.reds.some((x) => x.includes('"stash"')));
});

test('(c) malformed JSON -> a structure retry, both rounds metered', async () => {
  const p = fakeProvider([malformedReply(), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true);
  assert.equal(r.structureRetries, 1);
  assert.equal(r.rounds, 2);
  assert.match(p.calls[1].messages.at(-1).content, /not valid JSON \(bad json at 9\)/);
  assert.equal(r.log[0].outcome.startsWith('structure:'), true);
});

test('(c2) truncation is named truncation, not "no tool call"; structure retries are capped', async () => {
  const p = fakeProvider([truncatedReply()]);
  const r = await run(p);
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'structure');
  assert.equal(r.structureRetries, MAX_STRUCTURE_RETRIES);
  assert.equal(r.rounds, 1 + MAX_STRUCTURE_RETRIES);
  assert.match(r.reds[0], /^truncated:/);
});

test('(c3) text instead of the tool is a structure failure, then recovers', async () => {
  const p = fakeProvider([textReply(), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true);
  assert.equal(r.structureRetries, 1);
});

test('(d) a validator red -> a revision whose prompt carries the reds; a fixed draft then passes', async () => {
  const bad = validArgs();
  bad.steps[3].fromLine = 5; // ask step moved off the signed ask line
  const p = fakeProvider([toolReply(bad), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true);
  assert.equal(r.revisions, 1);
  assert.equal(r.rounds, 2);
  const prompt = p.calls[1].messages.at(-1).content;
  assert.match(prompt, /REFUSED by the validator/);
  assert.match(prompt, /ask at line 4 has no step bound to it/);
});

test('(e1) the per-draft budget stops the next round, priced and returned', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const p = fakeProvider([toolReply(bad)]);
  const r = await run(p, { budgetUsd: 0.02 }); // one round done ($0.0005); another at the ceiling ($0.0288) would cross
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'budget');
  assert.equal(r.rounds, 1);
  assert.equal(p.calls.length, 1);
  assert.ok(r.costUsd > 0);
});

test('(e2) an unpriced round makes the draft cost null, never 0', async () => {
  const p = fakeProvider([{ ...toolReply(validArgs()), usage: undefined }]);
  const fx = job2Fixture();
  const r = await draft({ proseText: fx.prose, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true);
  assert.equal(r.costUsd, null);
});

test('$0 gates: bad prose and an unreadable source refuse before any provider call', async () => {
  const p = fakeProvider([toolReply(validArgs())]);
  const bad = await draft({ proseText: 'no numbered lines here', provider: p, rates: RATES, modelId: MODEL });
  assert.equal(bad.ok, false);
  assert.equal(bad.stop, 'pre-flight');
  const fx = job2Fixture();
  const gone = await draft({ proseText: fx.prose.replace(fx.jd, '/nonexistent/jd.md'), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(gone.ok, false);
  assert.match(gone.reds[0], /input "jd": cannot read file/);
  assert.equal(p.calls.length, 0);
  assert.equal(bad.costUsd, 0);
});

// F49: the drafter's live makeProvider options must disable DeepSeek thinking.
test('drafter live-provider options disable thinking (F49) and keep the live timeouts', () => {
  assert.deepEqual(DRAFT_PROVIDER_OPTIONS.thinking, { type: 'disabled' });
  assert.equal(DRAFT_PROVIDER_OPTIONS.timeoutMs, 300_000);
});

test('the schema lets a step carry `picks` (source role -> heading names); a valid picks passes, an invented one reds', async () => {
  const props = buildDeclarationSchema(wiredMenu(['core'])).properties.steps.items.properties;
  assert.equal(props.picks.type, 'object');
  assert.deepEqual(props.picks.additionalProperties, { type: 'array', items: { type: 'string' } });
  const args = validArgs();
  args.steps[0].picks = { jd: ['Responsibilities'] };
  const ok = await run(fakeProvider([toolReply(args)]));
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
  args.steps[0].picks = { jd: ['Invented heading'] };
  const bad = await run(fakeProvider([toolReply(args)]));
  assert.equal(bad.ok, false);
  assert.ok(bad.reds.some((x) => x.includes('invented name')), bad.reds.join('\n'));
});

test('(e3) an unpriced round counts at its ceiling toward the budget, never as 0', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const p = fakeProvider([{ ...toolReply(bad), usage: undefined }]);
  const r = await run(p, { budgetUsd: 0.04 }); // ceiling round is ~$0.0288: two of them cross $0.04; at 0 the loop would go on
  assert.equal(r.stop, 'budget');
  assert.equal(p.calls.length, 1);
  assert.equal(r.costUsd, null);
});
