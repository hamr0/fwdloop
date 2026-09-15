import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenAI } from 'bare-agent/providers';
import {
  makeProvider, PROVIDER_SLOTS, resolveModelRate, MalformedToolCallTolerantOpenAI,
} from './provider.mjs';

test('unknown slot throws', () => {
  assert.throws(() => makeProvider('nope'), /unknown provider slot "nope"/);
});

test('missing env key throws and never returns a provider', () => {
  const envVar = PROVIDER_SLOTS.synthetic.envVar;
  const saved = process.env[envVar];
  delete process.env[envVar];
  try {
    assert.throws(() => makeProvider('synthetic'), new RegExp(`${envVar} is not set`));
  } finally {
    if (saved !== undefined) process.env[envVar] = saved;
  }
});

test('a model with no rate entry throws — never returns a 0 rate', () => {
  const envVar = PROVIDER_SLOTS.synthetic.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    assert.throws(
      () => makeProvider('synthetic', { model: 'hf:nobody/no-such-model' }),
      /no hand-entered rate for model suffix/,
    );
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

test('a known slot+model returns the right baseUrl, modelId and non-zero rates', () => {
  const envVar = PROVIDER_SLOTS.deepseek.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    const { rates, modelId, suffix, slot } = makeProvider('deepseek', { model: 'deepseek-v4-pro' });
    assert.equal(modelId, 'deepseek-v4-pro');
    assert.equal(suffix, 'deepseek-v4-pro');
    assert.equal(slot, 'deepseek');
    assert.ok(rates.in > 0);
    assert.ok(rates.out > 0);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

test('default model is used when none is given', () => {
  const envVar = PROVIDER_SLOTS.synthetic.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    const { modelId } = makeProvider('synthetic');
    assert.equal(modelId, PROVIDER_SLOTS.synthetic.defaultModel);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

test('PROOF the test can fail: a thrown error never contains the API key', () => {
  const envVar = PROVIDER_SLOTS.synthetic.envVar;
  const saved = process.env[envVar];
  const secret = 'sk-super-secret-do-not-leak-12345';
  process.env[envVar] = secret;
  try {
    // model has no rate entry -> throws, but the key was already read into apiKey by then;
    // the error message must not carry it forward.
    try {
      makeProvider('synthetic', { model: 'hf:nobody/no-such-model' });
      assert.fail('expected makeProvider to throw');
    } catch (err) {
      assert.ok(!err.message.includes(secret), `error message leaked the API key: ${err.message}`);
    }
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

// F11 — the output cap must not be theatre. DeepSeek ignores `max_completion_tokens`
// (bare-agent 0.42.0's default key) and honours only legacy `max_tokens`; synthetic is fine
// with the default. This asserts the flag reaches the constructed provider per slot. It can
// fail: flip either expectation and it goes red.
test('slot legacyMaxTokens reaches the provider — deepseek legacy, synthetic default', () => {
  const prev = { s: process.env.SYNTHETIC_API_KEY, d: process.env.DEEPSEEK_API_KEY };
  process.env.SYNTHETIC_API_KEY = 'test-key-syn';
  process.env.DEEPSEEK_API_KEY = 'test-key-ds';
  try {
    assert.equal(makeProvider('deepseek').provider.legacyMaxTokens, true);
    assert.equal(makeProvider('synthetic').provider.legacyMaxTokens, false);
  } finally {
    if (prev.s === undefined) delete process.env.SYNTHETIC_API_KEY; else process.env.SYNTHETIC_API_KEY = prev.s;
    if (prev.d === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prev.d;
  }
});

// F22: DeepSeek retired `deepseek-v4-flash` under us and 47/57 ledger rows silently priced
// under a routed name before anyone noticed. The mechanical guard against a repeat is: EVERY
// provider slot's own `defaultModel` must resolve to a rate through the real lookup — not a
// hand-picked model name, the slot's actual current default — so a future rename that forgets
// to add the price fails this suite instead of pricing silently at $0 the next time someone
// swaps a defaultModel without touching spend.mjs.
test('every provider slot default model resolves to a real, non-zero rate', () => {
  for (const [slotName, slot] of Object.entries(PROVIDER_SLOTS)) {
    const { rates } = resolveModelRate(slot.defaultModel);
    assert.ok(rates.in > 0, `${slotName}'s default model "${slot.defaultModel}" has a non-positive input rate`);
    assert.ok(rates.out > 0, `${slotName}'s default model "${slot.defaultModel}" has a non-positive output rate`);
  }
});

// PROOF the test above can fail: run the SAME resolution logic (resolveModelRate, the one
// function makeProvider itself calls — not a re-implementation, not a regex on a model name)
// against an injected slot list whose default model has no rate entry, and confirm it is
// rejected. The injected model id is randomised per run so this can never be satisfied by
// coincidentally matching a real table entry — it proves the mechanism, not today's fixture.
// A model suffix that names an Object.prototype member ("constructor", "toString", ...) must
// still be rejected: `ratesTable[suffix]` truthiness resolves to the INHERITED function on a
// plain object, skipping the "no rate -> throw" guard and letting a run proceed with
// rates.in/rates.out undefined — never rendered as 0, PRD §5. Object.hasOwn is the fix.
test('resolveModelRate rejects a suffix that names an inherited Object.prototype member, never falling through to it', () => {
  for (const poisoned of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.throws(
      () => resolveModelRate(poisoned),
      /no hand-entered rate for model suffix/,
      `expected suffix "${poisoned}" to be rejected, not resolved to an inherited prototype member`,
    );
  }
});

test('PROOF the test above can fail: a real table entry (not on the prototype) still resolves fine', () => {
  const { rates } = resolveModelRate('deepseek-flash');
  assert.ok(rates.in > 0);
  assert.ok(rates.out > 0);
});

// M0b Part 2.2 — makeProvider is the ONE writer for provider construction;
// the runner passes timeoutMs THROUGH it rather than constructing its own
// `new OpenAI(...)` a second time.
test('timeoutMs reaches the constructed provider when supplied', () => {
  const envVar = PROVIDER_SLOTS.deepseek.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    const { provider } = makeProvider('deepseek', { timeoutMs: 300_000 });
    assert.equal(provider.timeoutMs, 300_000);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

test('PROOF the test above can fail: omitting timeoutMs never sets it to 300_000 by accident', () => {
  const envVar = PROVIDER_SLOTS.deepseek.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    const { provider } = makeProvider('deepseek', {});
    assert.notEqual(provider.timeoutMs, 300_000);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

// F27 (2026-09-14) — BA-19 TOTAL wall-clock deadline, beside BA-18's idle `timeoutMs`. Same
// conditional-spread pattern as timeoutMs above: passes through when supplied, absent otherwise.
test('deadlineMs reaches the constructed provider when supplied', () => {
  const envVar = PROVIDER_SLOTS.deepseek.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    const { provider } = makeProvider('deepseek', { deadlineMs: 5 });
    assert.equal(provider.deadlineMs, 5);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

test('PROOF the test above can fail: omitting deadlineMs never sets it by accident', () => {
  const envVar = PROVIDER_SLOTS.deepseek.envVar;
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  try {
    const { provider } = makeProvider('deepseek', {});
    assert.equal(provider.deadlineMs, undefined);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

// F27's real proof: a local server that behaves EXACTLY like the observed DeepSeek hang — HTTP
// 200 + headers + one byte, then never another byte, socket held open (so BA-18's idle bound
// never trips — this is the "zombie stream" shape, not a dead connection). $0, no network: this
// is 127.0.0.1. `timeoutMs: 5000` proves the IDLE bound does not save us (it's way bigger than
// the deadline and the socket stays "active" from the server's point of view — one byte flowed);
// `deadlineMs: 300` is the ceiling under test. Asserts rejection well under 5000ms with the BA-19
// discriminators: `code: 'EDEADLINE'`, `retryable: false`.
test('a zombie stream (200 + one byte, then silence forever) trips deadlineMs, not the idle timeoutMs', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{'); // one byte, then hang — never res.end()
  });
  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 60_000;
  const sockets = new Set();
  server.on('connection', (sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const provider = new OpenAI({
      apiKey: 'test-key-not-real',
      model: 'deepseek-flash',
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 5000,
      deadlineMs: 300,
    });
    const startedAt = Date.now();
    await assert.rejects(
      () => provider.generate([{ role: 'user', content: 'hi' }], []),
      (err) => {
        assert.equal(err.code, 'EDEADLINE');
        assert.equal(err.retryable, false);
        return true;
      },
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 5000, `expected the deadline (300ms) to trip well under the idle bound (5000ms); took ${elapsedMs}ms`);
  } finally {
    for (const sock of sockets) sock.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PROOF the test above can fail: a server that answers promptly never trips the deadline', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const provider = new OpenAI({
      apiKey: 'test-key-not-real',
      model: 'deepseek-flash',
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 5000,
      deadlineMs: 300,
    });
    const result = await provider.generate([{ role: 'user', content: 'hi' }], []);
    assert.equal(result.text, 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PROOF the test above can fail: a slot whose default model has no rate entry is rejected by resolveModelRate', () => {
  const neverPricedModelId = `test-only-unpriced-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const injectedSlots = {
    driftedSlot: { defaultModel: neverPricedModelId, envVar: 'UNUSED', baseUrl: 'unused' },
  };
  // Same loop shape as the real coverage test, run against the injected slot + the real table
  // (which, by construction, cannot contain a random freshly-generated id) — this is what would
  // have caught F22 mechanically instead of via a human reading warning #47.
  for (const [slotName, slot] of Object.entries(injectedSlots)) {
    assert.throws(
      () => resolveModelRate(slot.defaultModel),
      /no hand-entered rate for model suffix/,
      `expected slot "${slotName}"'s unpriced default model to be rejected, not silently priced at 0`,
    );
  }
});

// ---------------------------------------------------------------------------
// F28 (2026-09-15) — a tool-call whose `function.arguments` is not valid JSON
// (captured live: a trailing `}`) must be METERED, not lost to a transport-shaped
// null-cost row. Real bare-agent `OpenAIProvider._request` parses the local
// server's own JSON body fine (that part is untouched) — the SyntaxError under
// test is bare-agent's OWN `JSON.parse(tc.function.arguments)` inside `generate()`.
// ---------------------------------------------------------------------------

test('F28: a malformed tool-call arguments string resolves generate() instead of throwing, carrying usage + malformedToolCall', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'emit_x', arguments: '{"a":1}}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      model: 'deepseek-flash',
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const provider = new MalformedToolCallTolerantOpenAI({
      apiKey: 'test-key-not-real',
      model: 'deepseek-flash',
      baseUrl: `http://127.0.0.1:${port}`,
    });
    const result = await provider.generate(
      [{ role: 'user', content: 'hi' }],
      [{ name: 'emit_x', description: 'd', parameters: { type: 'object', properties: {} } }],
    );
    assert.deepEqual(result.toolCalls, []);
    assert.ok(result.malformedToolCall, 'expected malformedToolCall to be set on the returned result');
    assert.equal(result.malformedToolCall.rawArguments, '{"a":1}}');
    assert.equal(result.malformedToolCall.name, 'emit_x');
    assert.match(result.malformedToolCall.error, /JSON/);
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.outputTokens, 20);
    // Also stashed on the instance — the channel runModelStepOnPrimitives reads (Loop's own
    // `loop.run()` return does not forward unknown `generate()` fields).
    assert.deepEqual(provider.lastMalformedToolCall, result.malformedToolCall);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PROOF the test above can fail: valid tool-call arguments still parse — the wrapper is transparent', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'emit_x', arguments: '{"a":1}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      model: 'deepseek-flash',
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const provider = new MalformedToolCallTolerantOpenAI({
      apiKey: 'test-key-not-real',
      model: 'deepseek-flash',
      baseUrl: `http://127.0.0.1:${port}`,
    });
    const result = await provider.generate(
      [{ role: 'user', content: 'hi' }],
      [{ name: 'emit_x', description: 'd', parameters: { type: 'object', properties: {} } }],
    );
    assert.equal(result.toolCalls.length, 1);
    assert.deepEqual(result.toolCalls[0].arguments, { a: 1 });
    assert.equal(result.malformedToolCall, undefined);
    assert.equal(provider.lastMalformedToolCall, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PROOF the wrapper only catches a SyntaxError-with-tool-calls: an HTTP 500 still rejects', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'boom' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const provider = new MalformedToolCallTolerantOpenAI({
      apiKey: 'test-key-not-real',
      model: 'deepseek-flash',
      baseUrl: `http://127.0.0.1:${port}`,
    });
    await assert.rejects(
      () => provider.generate([{ role: 'user', content: 'hi' }], []),
      /boom|500/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
