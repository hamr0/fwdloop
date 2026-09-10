// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider (a plain object satisfying bare-agent's
// `Provider.generate(messages, tools, options)` interface), never a real
// OpenAIProvider — same seam scout.test.mjs and drafter.test.mjs use. A live
// probe exists only behind `TOKENPROBE_LIVE=1` in tokenprobe.mjs's own CLI
// block, never here and never in the default `npm test` path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYLOAD, payloadText, TOKENPROBE_ROUND_BOUND, RATIO_GAP_THRESHOLD,
  makeEmitPayloadTool, extractJsonArray, isCompliant, charsPerOutputToken,
  classifyArm, verdict, runArm, runProbe, formatReport,
} from './tokenprobe.mjs';

// ---------------------------------------------------------------------------
// The payload — deterministic and identical across arms.
// ---------------------------------------------------------------------------

test('PAYLOAD is the integers 1..100, in order', () => {
  assert.equal(PAYLOAD.length, 100);
  assert.equal(PAYLOAD[0], 1);
  assert.equal(PAYLOAD[99], 100);
  for (let i = 0; i < PAYLOAD.length; i += 1) assert.equal(PAYLOAD[i], i + 1);
});

test('payloadText is deterministic — same call twice, identical string', () => {
  assert.equal(payloadText(), payloadText());
  assert.equal(payloadText(), JSON.stringify(PAYLOAD));
});

test('PROOF the test can fail: a DIFFERENT array does not equal payloadText()', () => {
  assert.notEqual(payloadText(), JSON.stringify([...PAYLOAD, 101]));
});

// ---------------------------------------------------------------------------
// extractJsonArray — must survive markdown fences and prose, and fail closed
// on garbage (never throw).
// ---------------------------------------------------------------------------

test('extractJsonArray parses a bare JSON array', () => {
  assert.deepEqual(extractJsonArray(payloadText()), PAYLOAD);
});

test('extractJsonArray parses an array wrapped in markdown fences / prose', () => {
  const wrapped = `Sure, here it is:\n\`\`\`json\n${payloadText()}\n\`\`\`\nHope that helps!`;
  assert.deepEqual(extractJsonArray(wrapped), PAYLOAD);
});

test('extractJsonArray returns null (never throws) on garbage or non-array JSON', () => {
  assert.equal(extractJsonArray('not json at all'), null);
  assert.equal(extractJsonArray('{"not":"an array"}'), null);
  assert.equal(extractJsonArray(null), null);
  assert.equal(extractJsonArray(undefined), null);
  assert.equal(extractJsonArray('[1, 2, this is broken'), null);
});

// ---------------------------------------------------------------------------
// isCompliant — exact match only. Order, length, and type all matter.
// ---------------------------------------------------------------------------

test('isCompliant: exact payload is compliant', () => {
  assert.equal(isCompliant([...PAYLOAD]), true);
});

test('isCompliant: reordered, truncated, padded, or type-mismatched arrays are NOT compliant', () => {
  assert.equal(isCompliant([...PAYLOAD].reverse()), false);
  assert.equal(isCompliant(PAYLOAD.slice(0, 99)), false);
  assert.equal(isCompliant([...PAYLOAD, 101]), false);
  assert.equal(isCompliant([...PAYLOAD.slice(0, 99), '100']), false); // string, not number
  assert.equal(isCompliant(null), false);
  assert.equal(isCompliant('not an array'), false);
});

// ---------------------------------------------------------------------------
// charsPerOutputToken — pure arithmetic, never 0/NaN for missing data.
// ---------------------------------------------------------------------------

test('charsPerOutputToken: normal division', () => {
  assert.equal(charsPerOutputToken(400, 100), 4);
  assert.equal(charsPerOutputToken(1415, 106), 1415 / 106);
});

test('charsPerOutputToken: null (never 0/NaN) when outputTokens is missing, zero, or negative', () => {
  assert.equal(charsPerOutputToken(400, 0), null);
  assert.equal(charsPerOutputToken(400, -5), null);
  assert.equal(charsPerOutputToken(400, null), null);
  assert.equal(charsPerOutputToken(400, undefined), null);
  assert.equal(charsPerOutputToken(400, NaN), null);
});

test('charsPerOutputToken: null when charCount is not a sane non-negative number', () => {
  assert.equal(charsPerOutputToken(-1, 100), null);
  assert.equal(charsPerOutputToken(NaN, 100), null);
  assert.equal(charsPerOutputToken(null, 100), null);
});

test('PROOF the test can fail: a genuinely valid pair returns a positive finite number, not null', () => {
  const r = charsPerOutputToken(200, 50);
  assert.equal(Number.isFinite(r), true);
  assert.ok(r > 0);
});

// ---------------------------------------------------------------------------
// classifyArm — casualty vs evidence.
// ---------------------------------------------------------------------------

test('classifyArm: an errored measurement is a casualty', () => {
  const c = classifyArm({ error: 'boom', compliant: true, ratio: 4 });
  assert.equal(c.status, 'casualty');
  assert.match(c.reason, /errored/);
});

test('classifyArm: a non-compliant echo is a casualty, never evidence', () => {
  const c = classifyArm({ error: null, compliant: false, ratio: 4 });
  assert.equal(c.status, 'casualty');
  assert.match(c.reason, /non-compliant/);
});

test('classifyArm: a null ratio (no reported output tokens) is a casualty — unknown cost is never 0', () => {
  const c = classifyArm({ error: null, compliant: true, ratio: null });
  assert.equal(c.status, 'casualty');
  assert.match(c.reason, /never treated as 0/);
});

test('classifyArm: a clean measurement is evidence', () => {
  const c = classifyArm({ error: null, compliant: true, ratio: 4 });
  assert.equal(c.status, 'evidence');
});

// ---------------------------------------------------------------------------
// verdict — the decision rule. Hand-built numbers for (a), (b), and casualty.
// ---------------------------------------------------------------------------

test('verdict: close ratios -> explanation (a), honest count', () => {
  const text = { error: null, compliant: true, ratio: 4.0 };
  const tool = { error: null, compliant: true, ratio: 4.2 };
  const v = verdict(text, tool);
  assert.equal(v.verdict, 'a');
});

test('verdict: TOOL ratio far higher -> explanation (b), under-counted', () => {
  const text = { error: null, compliant: true, ratio: 4.0 };
  const tool = { error: null, compliant: true, ratio: 13.35 }; // matches the reported 1415/106 case
  const v = verdict(text, tool);
  assert.equal(v.verdict, 'b');
  assert.match(v.detail, /UNDER-COUNTED/);
});

test('verdict: right at the threshold boundary is (b) (>=), just under is (a)', () => {
  const text = { error: null, compliant: true, ratio: 10 };
  const atThreshold = verdict(text, { error: null, compliant: true, ratio: 10 * RATIO_GAP_THRESHOLD });
  const justUnder = verdict(text, { error: null, compliant: true, ratio: 10 * RATIO_GAP_THRESHOLD - 0.01 });
  assert.equal(atThreshold.verdict, 'b');
  assert.equal(justUnder.verdict, 'a');
});

test('verdict: either arm a casualty -> inconclusive-casualty, never read as support for (a) or (b)', () => {
  const goodText = { error: null, compliant: true, ratio: 4.0 };
  const badTool = { error: null, compliant: false, ratio: 4.0 };
  const v1 = verdict(goodText, badTool);
  assert.equal(v1.verdict, 'inconclusive-casualty');
  assert.match(v1.detail, /TOOL arm/);

  const badText = { error: 'timeout', compliant: false, ratio: null };
  const v2 = verdict(badText, goodText);
  assert.equal(v2.verdict, 'inconclusive-casualty');
  assert.match(v2.detail, /TEXT arm/);
});

test('PROOF the test can fail: swapping which arm is casualty changes which side the detail names', () => {
  const good = { error: null, compliant: true, ratio: 4.0 };
  const bad = { error: null, compliant: false, ratio: 4.0 };
  const textBad = verdict(bad, good).detail;
  const toolBad = verdict(good, bad).detail;
  assert.notEqual(textBad, toolBad);
});

// ---------------------------------------------------------------------------
// Round bound — one echo per arm, fixed in code.
// ---------------------------------------------------------------------------

test('TOKENPROBE_ROUND_BOUND is 1', () => {
  assert.equal(TOKENPROBE_ROUND_BOUND, 1);
});

test('the round bound actually binds: a second emit_payload call throws', async () => {
  const { tool, getCallCount } = makeEmitPayloadTool();
  await tool.execute({ numbers: [...PAYLOAD] });
  assert.equal(getCallCount(), 1);
  await assert.rejects(
    () => tool.execute({ numbers: [...PAYLOAD] }),
    /tokenprobe round bound exceeded \(1\)/,
  );
});

// ---------------------------------------------------------------------------
// runArm end-to-end with fake providers — no network.
// ---------------------------------------------------------------------------

// Mirrors scout.test.mjs's fakeProvider: `reply` returned on the FIRST generate()
// call only; every call after that is a plain finished stop with no tool calls,
// so bare-agent's Loop can complete its finishing turn after a tool call without
// looping forever.
function fakeProvider(reply) {
  const calls = [];
  let n = 0;
  return {
    calls,
    generate: async (messages, tools, options) => {
      calls.push({ messages, tools, options });
      n += 1;
      if (n === 1) return reply;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model',
      };
    },
  };
}

test('runArm("text"): a compliant plain-text echo is classified evidence with a computed ratio', async () => {
  const echoText = payloadText();
  const provider = fakeProvider({
    text: echoText, toolCalls: [], usage: { inputTokens: 80, outputTokens: 106 }, stopReason: 'stop', model: 'fake-model',
  });
  const m = await runArm('text', 'fake-model', { provider, rates: { in: 0, out: 0 } });
  assert.equal(m.compliant, true);
  assert.equal(m.charCount, echoText.length);
  assert.equal(m.outputTokens, 106);
  assert.equal(m.ratio, echoText.length / 106);
  assert.equal(classifyArm(m).status, 'evidence');
});

test('runArm("tool"): a compliant tool-call echo is classified evidence, charCount from re-serialized args', async () => {
  const provider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_payload', arguments: { numbers: [...PAYLOAD] } }],
    usage: { inputTokens: 80, outputTokens: 20 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const m = await runArm('tool', 'fake-model', { provider, rates: { in: 0, out: 0 } });
  assert.equal(m.compliant, true);
  assert.equal(m.charCount, JSON.stringify({ numbers: PAYLOAD }).length);
  assert.equal(m.outputTokens, 20);
  assert.ok(m.ratio > 0);
  assert.equal(classifyArm(m).status, 'evidence');
});

test('PROOF the test can fail: a non-compliant tool echo (dropped element) is classified a casualty', async () => {
  const provider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_payload', arguments: { numbers: PAYLOAD.slice(0, 99) } }],
    usage: { inputTokens: 80, outputTokens: 20 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const m = await runArm('tool', 'fake-model', { provider, rates: { in: 0, out: 0 } });
  assert.equal(m.compliant, false);
  assert.equal(classifyArm(m).status, 'casualty');
});

test('runArm: missing usage on the final result is a casualty, not a 0-cost pass', async () => {
  const provider = fakeProvider({
    text: payloadText(), toolCalls: [], usage: null, stopReason: 'stop', model: 'fake-model',
  });
  const m = await runArm('text', 'fake-model', { provider, rates: { in: 0, out: 0 } });
  assert.equal(m.outputTokens, null);
  assert.equal(m.ratio, null);
  assert.equal(classifyArm(m).status, 'casualty');
});

test('runArm: a thrown provider error is captured and classified a casualty, never crashes the probe', async () => {
  const provider = {
    generate: async () => { throw new Error('network exploded'); },
  };
  const m = await runArm('text', 'fake-model', { provider, rates: { in: 0, out: 0 } });
  assert.match(m.error, /network exploded/);
  assert.equal(classifyArm(m).status, 'casualty');
});

test('runArm never writes a spend row when a fake provider is injected (live=false)', async () => {
  // No SPEND_PATH exists in this test's env by construction (fake provider => live=false path
  // never touches assertUnderGlobalCap/appendSpendRow); this test's real assertion is just that
  // calling runArm with a fake provider does not throw for lack of DEEPSEEK_API_KEY/out dir.
  const provider = fakeProvider({
    text: payloadText(), toolCalls: [], usage: { inputTokens: 10, outputTokens: 30 }, stopReason: 'stop', model: 'fake-model',
  });
  await assert.doesNotReject(() => runArm('text', 'fake-model', { provider, rates: { in: 0, out: 0 } }));
});

test('runArm rejects an unknown arm kind', async () => {
  await assert.rejects(() => runArm('bogus', 'fake-model', { provider: {}, rates: { in: 0, out: 0 } }), /unknown arm kind/);
});

// ---------------------------------------------------------------------------
// runProbe end-to-end — both arms, real verdict function, no network.
// ---------------------------------------------------------------------------

test('runProbe: two compliant arms with close ratios verdicts (a)', async () => {
  const textProvider = fakeProvider({
    text: payloadText(), toolCalls: [], usage: { inputTokens: 80, outputTokens: 100 }, stopReason: 'stop', model: 'fake-model',
  });
  const toolProvider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_payload', arguments: { numbers: [...PAYLOAD] } }],
    usage: { inputTokens: 80, outputTokens: 95 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const result = await runProbe('fake-model', {
    textProvider, textRates: { in: 0, out: 0 }, toolProvider, toolRates: { in: 0, out: 0 },
  });
  assert.equal(result.verdict.verdict, 'a');
  assert.ok(formatReport(result).includes('VERDICT: a'));
});

test('runProbe: a suspiciously low TOOL outputTokens count (mirrors the live 106-vs-1415-chars report) verdicts (b)', async () => {
  const textProvider = fakeProvider({
    text: payloadText(), toolCalls: [], usage: { inputTokens: 80, outputTokens: 100 }, stopReason: 'stop', model: 'fake-model',
  });
  const toolProvider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_payload', arguments: { numbers: [...PAYLOAD] } }],
    usage: { inputTokens: 80, outputTokens: 8 }, // same-ish content, far fewer reported output tokens
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const result = await runProbe('fake-model', {
    textProvider, textRates: { in: 0, out: 0 }, toolProvider, toolRates: { in: 0, out: 0 },
  });
  assert.equal(result.verdict.verdict, 'b');
  assert.ok(formatReport(result).includes('VERDICT: b'));
});

test('runProbe: a non-compliant TOOL arm makes the whole probe inconclusive, never a false (a) or (b)', async () => {
  const textProvider = fakeProvider({
    text: payloadText(), toolCalls: [], usage: { inputTokens: 80, outputTokens: 100 }, stopReason: 'stop', model: 'fake-model',
  });
  const toolProvider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_payload', arguments: { numbers: [1, 2, 3] } }], // wrong payload entirely
    usage: { inputTokens: 80, outputTokens: 95 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const result = await runProbe('fake-model', {
    textProvider, textRates: { in: 0, out: 0 }, toolProvider, toolRates: { in: 0, out: 0 },
  });
  assert.equal(result.verdict.verdict, 'inconclusive-casualty');
});
