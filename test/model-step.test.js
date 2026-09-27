// Tests for src/model-step.js — M2 piece 2. Every case runs at $0 against a
// FAKE provider matching bare-agent's own `generate(messages, tools, options)`
// contract (same pattern poc/m0/runner.test.mjs uses) — no real provider
// call, no key read from a real secret store.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdtempSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  makeLiveModelStep, isTransportFailure, buildEmitArtifactSchema, LIVE_PROVIDER_OPTIONS,
} from '../src/model-step.js';

function tmpSpendPath() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-modelstep-'));
  return path.join(dir, 'spend.jsonl');
}

function readSpendRows(spendPath) {
  if (!existsSync(spendPath)) return [];
  return readFileSync(spendPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const CTX = { goal: 'draft a thing', primitives: [], reads: {}, gap: null };

// ---------------------------------------------------------------------------
// isTransportFailure / buildEmitArtifactSchema — pure functions
// ---------------------------------------------------------------------------

test('isTransportFailure: true for the named transport codes and fetch/TLS text', () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EAI_AGAIN']) {
    assert.equal(isTransportFailure({ code }), true, code);
  }
  assert.equal(isTransportFailure({ message: 'fetch failed' }), true);
  assert.equal(isTransportFailure({ message: 'unable to verify the first certificate (TLS)' }), true);
});

test('isTransportFailure: false for an EDEADLINE wall-clock timeout — never retried, never "transport"', () => {
  assert.equal(isTransportFailure({ code: 'EDEADLINE', message: 'deadline exceeded' }), false);
});

test('isTransportFailure: false for an ordinary HTTP-status error', () => {
  assert.equal(isTransportFailure({ status: 500, message: 'internal server error' }), false);
  assert.equal(isTransportFailure(null), false);
});

test('buildEmitArtifactSchema: class-only — green/softgreen/hitl differ, and no key ever holds a shape word', () => {
  const green = buildEmitArtifactSchema('green');
  const softgreen = buildEmitArtifactSchema('softgreen');
  const hitl = buildEmitArtifactSchema('hitl');
  const fallback = buildEmitArtifactSchema(undefined);
  assert.ok('fields' in green.properties);
  assert.ok('text' in softgreen.properties);
  assert.deepEqual(hitl, fallback);
  const serialised = JSON.stringify([green, softgreen, hitl]).toLowerCase();
  for (const forbidden of ['maxwords', 'sections', 'linesperinvoice', 'mustcarry']) {
    assert.ok(!serialised.includes(forbidden), `schema leaked shape word "${forbidden}"`);
  }
});

// M2 amendment 1 item 1: every class's schema carries the step's own typed
// self-report — done (required) and blocker — so runner.js can take the
// model's own word at face value before any close runs.
test('buildEmitArtifactSchema: every class gains a required "done" boolean and a "blocker" string|null', () => {
  for (const cls of ['green', 'softgreen', 'hitl', undefined]) {
    const schema = buildEmitArtifactSchema(cls);
    assert.equal(schema.properties.done.type, 'boolean', cls);
    assert.deepEqual(schema.properties.blocker.type, ['string', 'null'], cls);
    assert.ok(schema.required.includes('done'), `${cls}: "done" must be required`);
  }
});

// ---------------------------------------------------------------------------
// Happy path metering
// ---------------------------------------------------------------------------

function fakeTwoRoundProvider() {
  let n = 0;
  return {
    generate: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: null,
          toolCalls: [{
            id: 't1', name: 'emit_artifact', arguments: { text: 'the artifact' },
          }],
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      return {
        text: '', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash',
      };
    },
  };
}

test('happy path: one attempt sums every round into one costUsd, never the last round only', async () => {
  const spendPath = tmpSpendPath();
  const modelStep = makeLiveModelStep({
    spendPath, provider: fakeTwoRoundProvider(), rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifact, { text: 'the artifact' });
  assert.equal(typeof result.costUsd, 'number');
  assert.ok(result.costUsd > 0);
  assert.equal(result.modelMatch, 'match');
  const rows = readSpendRows(spendPath);
  assert.equal(rows.length, 1, 'one Loop round-set -> one spend row for this attempt');
  assert.equal(rows[0].rounds, 2, 'both internal Loop rounds folded into the row');
});

// ---------------------------------------------------------------------------
// Malformed tool-call retried once, then a red naming it distinctly
// ---------------------------------------------------------------------------

function fakeAlwaysMalformedProvider() {
  return {
    lastMalformedToolCall: null,
    generate: async function generate() {
      const malformedToolCall = { name: 'emit_artifact', rawArguments: '{"a":1}}', error: 'bad json at 8' };
      this.lastMalformedToolCall = malformedToolCall;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 20, outputTokens: 10 }, stopReason: 'tool_use', model: 'deepseek-flash', malformedToolCall,
      };
    },
  };
}

test('a malformed tool-call twice in a row reds naming it distinctly, metered both times (never null cost)', async () => {
  const spendPath = tmpSpendPath();
  const provider = fakeAlwaysMalformedProvider();
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, false);
  assert.match(result.red, /arguments were not valid JSON twice in a row/);
  assert.match(result.red, /bad json at 8/);
  const rows = readSpendRows(spendPath);
  assert.equal(rows.length, 2, 'one spend row per round');
  assert.ok(rows.every((r) => typeof r.costUsd === 'number'));
});

test('PROOF the above can fail: a malformed round followed by a clean one is ok:true', async () => {
  const spendPath = tmpSpendPath();
  let attempt = 0;
  const provider = {
    lastMalformedToolCall: null,
    generate: async function generate() {
      attempt += 1;
      if (attempt === 1) {
        const malformedToolCall = { name: 'emit_artifact', rawArguments: '{"a":1}}', error: 'bad json' };
        this.lastMalformedToolCall = malformedToolCall;
        return {
          text: '', toolCalls: [], usage: { inputTokens: 20, outputTokens: 10 }, stopReason: 'tool_use', model: 'deepseek-flash', malformedToolCall,
        };
      }
      this.lastMalformedToolCall = null;
      return {
        text: null,
        toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { text: 'ok' } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'tool_use',
        model: 'deepseek-flash',
      };
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifact, { text: 'ok' });
});

// ---------------------------------------------------------------------------
// Transport fault -> { ok:false, transport:true, spendComplete:false }, floor preserved
// ---------------------------------------------------------------------------

test('a transport fault returns transport:true with the priced-so-far floor, spendComplete:false, and is NEVER retried inside this module', async () => {
  const spendPath = tmpSpendPath();
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      const e = new Error('socket hang up');
      e.code = 'ECONNRESET';
      throw e;
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, false);
  assert.equal(result.transport, true);
  assert.equal(result.spendComplete, false);
  assert.equal(calls, 1, 'exactly one call — this module never retries a transport fault; the caller (runFlow) does');
  assert.equal(result.costUsd, null, 'no round priced anything before the throw — the floor is honestly unknown, never asserted as 0');
});

test('a transport fault WITH a priced round already captured keeps that known partial as the floor, never drops it', async () => {
  const spendPath = tmpSpendPath();
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: null, toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { text: 'partial' } }], usage: { inputTokens: 100, outputTokens: 50 }, stopReason: 'tool_calls', model: 'deepseek-flash',
        };
      }
      const e = new Error('finishing round: socket reset');
      e.code = 'ECONNRESET';
      throw e;
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, false);
  assert.equal(result.transport, true);
  assert.ok(result.costUsd > 0, 'the priced round before the throw must survive as the floor, never dropped to 0 or null');
});

// ---------------------------------------------------------------------------
// A wall-clock deadline is never retried
// ---------------------------------------------------------------------------

test('an EDEADLINE wall-clock timeout returns a wall-halt red, never transport:true', async () => {
  const spendPath = tmpSpendPath();
  const provider = {
    generate: async () => {
      const e = new Error('deadline exceeded');
      e.code = 'EDEADLINE';
      throw e;
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, false);
  assert.equal(result.transport, undefined);
  assert.match(result.red, /^wall-halt:/);
});

// ---------------------------------------------------------------------------
// Unknown model -> ceiling + substituted stamp on the spend row
// ---------------------------------------------------------------------------

test('an unknown model still meters (via the injected rates) and stamps modelMatch "substituted" when the provider serves a different concrete model', async () => {
  const spendPath = tmpSpendPath();
  const provider = {
    generate: async () => ({
      text: null,
      toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { text: 'x' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'tool_calls',
      model: 'deepseek-v4-pro',
    }),
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, true);
  assert.equal(result.modelMatch, 'substituted');
});

// ---------------------------------------------------------------------------
// Key preflight red — never throws out of the ralph loop
// ---------------------------------------------------------------------------

test('key preflight: a live call with no key set returns a red, never throws (rule 5, never crash for a model failure)', async () => {
  const spendPath = tmpSpendPath();
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const modelStep = makeLiveModelStep({ slot: 'deepseek', model: 'deepseek-flash', spendPath });
    const result = await modelStep(CTX, {}, { class: 'hitl' });
    assert.equal(result.ok, false);
    assert.match(result.red, /key: .*DEEPSEEK_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('LIVE_PROVIDER_OPTIONS: the live call\'s actual config — timeoutMs 300s, deadlineMs 240s', () => {
  assert.deepEqual(LIVE_PROVIDER_OPTIONS, { timeoutMs: 300_000, deadlineMs: 240_000 });
});

// ---------------------------------------------------------------------------
// max_tokens truncation is a deterministic red, never retried
// ---------------------------------------------------------------------------

test('a max_tokens stop is an immediate red naming the truncation, never retried', async () => {
  const spendPath = tmpSpendPath();
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      return {
        text: 'truncated...', toolCalls: [], usage: { inputTokens: 10, outputTokens: 16000 }, stopReason: 'max_tokens', model: 'deepseek-flash',
      };
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, false);
  assert.match(result.red, /^truncated:/);
  assert.equal(calls, 1, 'a truncated stop is deterministic, never retried');
});

// grantedTools are handed to the Loop as ordinary tools alongside emit_artifact
test('grantedTools are passed through to the Loop as callable tools', async () => {
  const spendPath = tmpSpendPath();
  let seenToolNames = null;
  const provider = {
    generate: async (messages, tools) => {
      seenToolNames = tools.map((t) => t.name);
      return {
        text: null, toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { text: 'x' } }], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'tool_calls', model: 'deepseek-flash',
      };
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const fakeReadTool = {
    name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} }, execute: async () => 'x',
  };
  await modelStep(CTX, { read: fakeReadTool }, { class: 'hitl' });
  assert.ok(seenToolNames.includes('read'));
  assert.ok(seenToolNames.includes('emit_artifact'));
});

// ---------------------------------------------------------------------------
// M4a-3 (docs/wiki/the-module-ladder.md, "M4a" section, "Amendment M4a-3 —
// SIGNED by hamr 2026-09-27"): `tools`/`ungranted` come straight from
// bare-agent's own `result.metrics.byTool` — never inferred, never a
// separately-maintained hook that could drift from what the Loop actually
// dispatched.
// ---------------------------------------------------------------------------

function fakeReadWriteTool(name) {
  return {
    name, description: name, parameters: { type: 'object', properties: {} }, execute: async () => 'ok',
  };
}

// Negative scenario (a): a tool call made during an attempt that is missing
// from the row's counts is caught. This fake model spans TWO of
// `liveModelStep`'s own OUTER rounds (round 1 calls read+write then returns
// a bare final-text with no tool call, triggering the module's own
// retry-once; round 2 calls read again, then emits) — each outer round
// produces its own separate `result.metrics.byTool` and its own separate
// `addToolCounts` call, so this is the one shape that actually exercises
// SUMMING across rounds (a naive implementation that overwrites instead of
// accumulates would report `read: 1`, not `read: 2`).
test('M4a-3 (a): tools tallies every GRANTED tool call across the whole attempt, per name, exactly — never dropped, never merged', async () => {
  const spendPath = tmpSpendPath();
  let n = 0;
  const provider = {
    generate: async () => {
      n += 1;
      if (n === 1) {
        // outer round 1, iteration 1: two tool calls in one internal turn
        return {
          text: null,
          toolCalls: [
            { id: 't0a', name: 'read', arguments: { path: 'a' } },
            { id: 't0b', name: 'write', arguments: { path: 'b' } },
          ],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      if (n === 2) {
        // outer round 1, iteration 2: a bare final text, no tool call at all
        // -> liveModelStep's own "no captured artifact" retry fires once.
        return {
          text: 'thinking out loud, no tool this turn',
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'stop',
          model: 'deepseek-flash',
        };
      }
      if (n === 3) {
        // outer round 2, iteration 1: read again — must SUM with round 1's
        // read, not overwrite it.
        return {
          text: null,
          toolCalls: [{ id: 't1', name: 'read', arguments: { path: 'c' } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      // outer round 2, iteration 2: emit_artifact — success.
      return {
        text: null,
        toolCalls: [{ id: 't2', name: 'emit_artifact', arguments: { text: 'ok' } }],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: 'tool_calls',
        model: 'deepseek-flash',
      };
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, { read: fakeReadWriteTool('read'), write: fakeReadWriteTool('write') }, { class: 'hitl' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tools, { read: 2, write: 1 }, 'emit_artifact itself is never tallied into tools');
  assert.equal(result.ungranted, undefined, 'nothing ungranted was ever called, so the key is absent');
});

// Negative scenario (b): a called tool the step was NOT granted is flagged
// in `ungranted`, never silently merged into `tools` as if it had been
// allowed and had really run. `grep` is never in `grantedTools` here, so it
// is never even in the `tools` array Loop.run() is offered — bare-agent's
// own "Unknown tool" path fires (loop.js: `toolMap.get` misses), the model
// is told the tool doesn't exist, and only THEN does it call the granted
// `read` and finally `emit_artifact`.
test('M4a-3 (b): an ungranted tool call is flagged in "ungranted", never counted in "tools"', async () => {
  const spendPath = tmpSpendPath();
  let n = 0;
  const provider = {
    generate: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: null,
          toolCalls: [{ id: 't0', name: 'grep', arguments: { pattern: 'x' } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      if (n === 2) {
        return {
          text: null,
          toolCalls: [{ id: 't1', name: 'read', arguments: { path: 'a' } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      return {
        text: null,
        toolCalls: [{ id: 't2', name: 'emit_artifact', arguments: { text: 'ok' } }],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: 'tool_calls',
        model: 'deepseek-flash',
      };
    },
  };
  const modelStep = makeLiveModelStep({
    spendPath, provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, { read: fakeReadWriteTool('read') }, { class: 'hitl' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ungranted, ['grep']);
  assert.deepEqual(result.tools, { read: 1 }, '"grep" must never land in tools as if it had been allowed and had really run');
});

// Negative scenario (c) half — a NO-model-call red (the key preflight
// failure, before any provider was ever built) carries `tools: null`, the
// same "nothing to sum" shape `tokens: null` already carries — never `{}`
// standing in for "no model call" and never invented.
test('M4a-3: a no-model-call red (key preflight) carries tools:null, exactly like tokens:null', async () => {
  const spendPath = tmpSpendPath();
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const modelStep = makeLiveModelStep({ slot: 'deepseek', model: 'deepseek-flash', spendPath });
    const result = await modelStep(CTX, {}, { class: 'hitl' });
    assert.equal(result.ok, false);
    assert.equal(result.tools, null);
    assert.equal(result.ungranted, undefined);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

// A model call that never invokes any granted tool (only emit_artifact)
// still carries a known, empty tally — `{}`, never `null` (a "no model call"
// row is the only case that gets `null`).
test('M4a-3: a model call that invokes no granted tool at all carries tools:{}, never null', async () => {
  const spendPath = tmpSpendPath();
  const modelStep = makeLiveModelStep({
    spendPath, provider: fakeTwoRoundProvider(), rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  const result = await modelStep(CTX, {}, { class: 'hitl' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tools, {});
  assert.equal(result.ungranted, undefined);
});

