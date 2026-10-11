// M4d amendment 7, piece 1 (docs/wiki/the-module-ladder.md "M4d amendment 7" items 2-4) on bare-agent 0.51.0:
// bareagent decides and applies thinking. Our drafter says only 'on' or 'off' (`thinkingMode`), never a raw `thinking` field;
// `src/thinking.js` asks the real `thinkingSupport(kind, model)`; a bareagent ValidationError is a loud refusal at $0.
// $0, no network: fake providers, or the REAL bareagent providers pointed at a dead port (the errors under test throw before any send).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ValidationError } from 'bare-agent';
import { Anthropic, OpenAI } from 'bare-agent/providers';
import { draft } from '../src/drafter.js';
import { thinkingSupport } from '../src/thinking.js';
import { makeProvider } from '../src/provider.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const run = (provider, extra = {}) => draft({ proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL, ...extra });
const DEAD = 'http://127.0.0.1:1';

test('A1: bare-agent 0.52 is installed (the installed-version pin lives in m4d-am7c-thinking-status.test.js)', () => {
  const v = JSON.parse(readFileSync(new URL('../node_modules/bare-agent/package.json', import.meta.url), 'utf8')).version;
  assert.match(v, /^0\.5[2-9]\.|^0\.[6-9]\d\./);
});

test('B1: the drafter sends thinkingMode off/on and never a raw `thinking` field; am4 holds (off = forced tool, on = none)', async () => {
  const off = fakeProvider([toolReply(validArgs())]);
  assert.equal((await run(off, { draftThinking: 'off' })).ok, true);
  assert.equal(off.calls[0].options.thinkingMode, 'off');
  assert.deepEqual(off.calls[0].options.toolChoice, { name: 'emit_declaration' });
  assert.equal('thinking' in off.calls[0].options, false);

  const on = fakeProvider([toolReply(validArgs())]);
  assert.equal((await run(on, { draftThinking: 'on' })).ok, true);
  assert.equal(on.calls[0].options.thinkingMode, 'on');
  assert.equal('toolChoice' in on.calls[0].options, false);
  assert.equal('thinking' in on.calls[0].options, false);
});

test('B2: makeProvider no longer takes a raw `thinking` option (the one raw-field path is deleted)', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/provider.js', import.meta.url), 'utf8'), /\bthinking\b/i);
});

test('C1: src/thinking.js passes the real signature (provider kind, model) and reads `.switchable`', () => {
  const seen = [];
  const impl = (kind, model) => { seen.push([kind, model]); return { switchable: false, off: null, on: null, note: '' }; };
  assert.equal(thinkingSupport('anthropic-api', 'm1', { impl }), false);
  assert.equal(thinkingSupport('gemini-api', 'm2', { impl }), false);
  assert.equal(thinkingSupport('openai-api', 'm3', { impl }), false);
  assert.deepEqual(seen, [['anthropic', 'm1'], ['gemini', 'm2'], ['openai', 'm3']]);
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => ({ switchable: true }) }), true);
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => ({ switchable: 'unverified' }) }), 'unverified');
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => true }), 'unverified', 'not the real shape: never trusted');
  assert.equal(thinkingSupport('some-new-shape', 'm', { impl }), 'unverified', 'a shape bareagent has no kind for: the box works, bareagent errors loudly at the call');
});

test('C2: the REAL bareagent answers: a measured not-switchable model is false, an unknown model is unverified', () => {
  assert.equal(thinkingSupport('anthropic-api', 'claude-opus-5-5'), false);
  assert.equal(thinkingSupport('openai-api', 'no-such-model'), 'unverified');
});

test('D1: a ValidationError from bareagent is a loud refusal by name at $0, one call, no structure retry, nothing unmetered', async () => {
  let n = 0;
  const provider = {
    async generate() { n += 1; throw new ValidationError('[AnthropicProvider] thinkingMode off is not supported by claude-opus-5-5'); },
  };
  const r = await run(provider, { draftThinking: 'off' });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'thinking-refused');
  assert.match(r.reds[0], /^thinking: .*claude-opus-5-5/);
  assert.equal(n, 1);
  assert.equal(r.costUsd, 0);
  assert.equal(r.spendComplete, true);
  assert.equal(r.rounds, 0);
});

test('D2: the REAL Anthropic provider on a model that cannot turn thinking off (0.52): NOT refused for that - the call is sent (here it meets the dead port), never a thinking refusal', async () => {
  const provider = new Anthropic({ apiKey: 'k', model: 'claude-opus-5-5', baseUrl: DEAD });
  const r = await run(provider, { draftThinking: 'off' });
  assert.notEqual(r.stop, 'thinking-refused');
  assert.equal(r.stop, 'provider-red');
});

test('D3: bareagent contract probe: raw `thinking` + `thinkingMode` together still throws; on + forced toolChoice on a deepseek model no longer does', async () => {
  assert.throws(() => new OpenAI({
    apiKey: 'k', model: 'deepseek-flash', baseUrl: DEAD, thinking: { type: 'disabled' }, thinkingMode: 'off',
  }), ValidationError);
  const p = new OpenAI({ apiKey: 'k', model: 'deepseek-flash', baseUrl: DEAD });
  const tool = { name: 't', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => ({}) };
  // 0.52: DeepSeek 'on' + a forced tool choice no longer throws; it is sent with thinking disabled and reported 'unsupported' (here: it reaches the dead port)
  await assert.rejects(p.generate([{ role: 'user', content: 'x' }], [tool], { thinkingMode: 'on', toolChoice: { name: 't' } }), (e) => !(e instanceof ValidationError));
});

test('E1: thinkingApplied from the run is recorded on the round\'s log entry (and so in log.json)', async () => {
  const p = fakeProvider([{ ...toolReply(validArgs()), thinkingApplied: false }]);
  const r = await run(p, { draftThinking: 'off' });
  assert.equal(r.ok, true);
  assert.equal(r.log[0].thinkingApplied, false);
});

test('E2: no thinkingApplied from the provider means the log entry carries none', async () => {
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await run(p, { draftThinking: 'off' });
  assert.equal('thinkingApplied' in r.log[0], false);
});
