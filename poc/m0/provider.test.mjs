import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProvider, PROVIDER_SLOTS } from './provider.mjs';

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
