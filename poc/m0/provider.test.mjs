import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProvider, PROVIDER_SLOTS, resolveModelRate,
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
