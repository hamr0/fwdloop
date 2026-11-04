// M4d am37 - a model step that answers in text is told so (one fixed line) and made to save: round 2 forces emit_artifact on its first call,
// round 3 sends the same line unforced. Every case runs at $0 against a fake provider with bare-agent's generate(messages, tools, options) shape.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { makeLiveModelStep, NUDGE } from '../src/model-step.js';

const CTX = { goal: 'draft a thing', primitives: [], reads: {}, gap: null };
const RATES = { in: 0.001, out: 0.002 };
const USAGE = { inputTokens: 10, outputTokens: 5 };

const textRound = (text = 'here is the answer') => ({ text, toolCalls: [], usage: USAGE, stopReason: 'stop', model: 'deepseek-flash' });
const saveRound = () => ({
  text: null, toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { text: 'saved', done: true } }], usage: USAGE, stopReason: 'tool_calls', model: 'deepseek-flash',
});

/** A fake provider that records every call (messages and options as they were at the call) and answers by `script(callNo, options, messages)`. */
function scripted(script) {
  const calls = [];
  return {
    calls,
    generate: async (messages, tools, options = {}) => {
      calls.push({ messages: JSON.parse(JSON.stringify(messages)), options: { ...options } });
      // after a tool result the model just says it is done, like a real one (the script answers the rounds before)
      if (messages[messages.length - 1]?.role === 'tool') return textRound('saved');
      return script(calls.length, options, messages);
    },
  };
}

function setup(provider, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am37-'));
  const spendPath = path.join(dir, 'spend.jsonl');
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: RATES, modelId: 'deepseek-flash', ...extra,
  });
  return { dir, spendPath, modelStep };
}

const spendRows = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('the NUDGE is the signed line, exactly', () => {
  assert.equal(NUDGE, 'You answered in text. Call emit_artifact now with that answer; do not reply in text.');
});

test('(1) a step that saves on round 1: today\'s one call, nothing forced, savedBy first', async () => {
  const p = scripted(() => saveRound());
  const { modelStep } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, true);
  assert.equal(r.savedBy, 'first');
  assert.ok(p.calls.every((c) => c.options.toolChoice === undefined), 'no call carries a toolChoice');
  assert.ok(p.calls.every((c) => !c.messages.some((m) => m.content === NUDGE)), 'the line is never sent');
});

test('(2) text on round 1, then a provider that honours forcing: saved on round 2, savedBy forced', async () => {
  const p = scripted((n, options) => {
    if (n === 1) return textRound();
    if (n === 2) { assert.deepEqual(options.toolChoice, { name: 'emit_artifact' }); return saveRound(); }
    return textRound('saved');
  });
  const { modelStep, spendPath } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, true);
  assert.equal(r.savedBy, 'forced');
  assert.deepEqual(r.artifact, { text: 'saved', done: true });
  assert.equal(p.calls[0].options.toolChoice, undefined, 'round 1 forces nothing');
  assert.deepEqual(p.calls[1].options.toolChoice, { name: 'emit_artifact' }, 'round 2 first call is forced');
  const r1 = p.calls[0].messages;
  const r2 = p.calls[1].messages;
  assert.deepEqual(r2.slice(0, r1.length), r1, 'round 2 continues round 1\'s conversation');
  assert.ok(r2.length > r1.length);
  assert.deepEqual(r2[r2.length - 1], { role: 'user', content: NUDGE }, 'round 2 ends with the fixed line');
  assert.ok(r2.some((m) => m.role === 'assistant' && m.content === 'here is the answer'), 'the model\'s own text stays in the conversation');
  const forcedCalls = p.calls.filter((c) => c.options.toolChoice !== undefined);
  assert.equal(forcedCalls.length, 1, 'only the first call of round 2 is forced');
  assert.ok(typeof r.costUsd === 'number' && r.costUsd > 0);
  const total = spendRows(spendPath).reduce((s, x) => s + x.costUsd, 0);
  assert.ok(Math.abs(total - r.costUsd) < 1e-12, 'spend rows sum to the step cost');
});

test('(3) a provider that 400s on the forced call: round 3 sends the line unforced and saves, savedBy fallback', async () => {
  const p = scripted((n, options) => {
    if (n === 1) return textRound();
    if (options.toolChoice) throw new Error('400 Bad Request: tool_choice not supported by this model');
    if (n === 3) return saveRound();
    return textRound('saved');
  });
  const { modelStep } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, true);
  assert.equal(r.savedBy, 'fallback');
  assert.deepEqual(p.calls[1].options.toolChoice, { name: 'emit_artifact' });
  assert.equal(p.calls[2].options.toolChoice, undefined, 'round 3 forces nothing');
  assert.deepEqual(p.calls[2].messages[p.calls[2].messages.length - 1], { role: 'user', content: NUDGE });
});

test('(4) a provider that refuses forcing and keeps answering text: red naming the rounds tried, every round metered', async () => {
  const p = scripted((n, options) => {
    if (options.toolChoice) throw new Error('400 Bad Request: tool_choice not supported');
    return textRound('still text');
  });
  const { modelStep, spendPath } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, false);
  assert.match(r.red, /returned text instead of the tool/);
  assert.match(r.red, /forced save and the fallback were tried/);
  assert.equal(r.savedBy, undefined);
  assert.equal(p.calls.length, 3, 'round 1, the refused forced call, round 3');
  assert.equal(typeof r.costUsd, 'number');
  assert.equal(r.turns, 2, 'the two rounds that were answered are metered; the refused call was never answered, so it books nothing');
  const total = spendRows(spendPath).reduce((s, x) => s + x.costUsd, 0);
  assert.ok(Math.abs(total - r.costUsd) < 1e-12);
});

test('(4b) a provider that honours forcing but the model still ends in text, then text again: red, all 3 rounds metered', async () => {
  const p = scripted(() => textRound('text again'));
  const { modelStep, spendPath } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, false);
  assert.match(r.red, /forced save and the fallback were tried/);
  assert.equal(p.calls.length, 3);
  assert.equal(r.turns, 3);
  const rows = spendRows(spendPath);
  assert.equal(rows.length, 3, 'one spend row per round');
  assert.ok(Math.abs(rows.reduce((s, x) => s + x.costUsd, 0) - r.costUsd) < 1e-12);
});

test('(5) an unpriced round 2 leaves the cost unknown, never 0', async () => {
  const p = scripted((n) => (n === 1 ? textRound() : saveRound()));
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am37-'));
  const orig = p.generate;
  p.generate = async (...a) => {
    const r = await orig(...a);
    return p.calls.length === 2 ? { ...r, usage: undefined } : r;
  };
  const modelStep = makeLiveModelStep({
    spendPath: path.join(dir, 'spend.jsonl'), provider: p, rates: RATES, modelId: 'deepseek-flash',
  });
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, false);
  assert.match(r.red, /pricing-red/);
  assert.equal(r.costUsd, null);
});

test('(5b) an unpriced round 3 leaves the cost unknown, never 0', async () => {
  const p = scripted((n, options) => {
    if (n === 1) return textRound();
    if (options.toolChoice) throw new Error('400 tool_choice');
    return saveRound();
  });
  const orig = p.generate;
  p.generate = async (...a) => {
    const r = await orig(...a);
    return p.calls.length === 3 ? { ...r, usage: undefined } : r;
  };
  const { modelStep } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, false);
  assert.match(r.red, /pricing-red/);
  assert.equal(r.costUsd, null);
});

test('a malformed tool call on round 1 keeps today\'s path: a fresh retry, no line, nothing forced', async () => {
  const prov = scripted((n) => {
    if (n === 1) {
      prov.lastMalformedToolCall = { name: 'emit_artifact', rawArguments: '{"a":1}}', error: 'bad json' };
      return { ...textRound(''), stopReason: 'tool_use', malformedToolCall: prov.lastMalformedToolCall };
    }
    prov.lastMalformedToolCall = null;
    return saveRound();
  });
  prov.lastMalformedToolCall = null;
  const { modelStep } = setup(prov);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, true);
  assert.equal(prov.calls.length, 3, 'round 1, the fresh retry, and the call after the save');
  assert.deepEqual(prov.calls[1].messages, prov.calls[0].messages, 'the retry sends the same messages fresh');
  assert.equal(r.savedBy, 'first');
  assert.ok(prov.calls.every((c) => c.options.toolChoice === undefined));
  assert.ok(prov.calls.every((c) => !c.messages.some((m) => m.content === NUDGE)));
});

test('a provider that says it ignores toolChoice: round 2 sends the line unforced, and a save there is the fallback', async () => {
  const p = scripted((n) => (n === 1 ? textRound() : saveRound()));
  p.honoursToolChoice = false;
  const { modelStep } = setup(p);
  const r = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(r.ok, true);
  assert.equal(r.savedBy, 'fallback');
  assert.ok(p.calls.every((c) => c.options.toolChoice === undefined));
  assert.deepEqual(p.calls[1].messages[p.calls[1].messages.length - 1], { role: 'user', content: NUDGE });
});
