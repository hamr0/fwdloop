// M4d amendment 7 on bare-agent 0.52.0 (docs/wiki/the-module-ladder.md "M4d amendment 7"): bareagent decides thinking and never throws just because a model
// can't switch; it reports `thinkingStatus` ('applied' | 'unsupported' | 'ignored' | 'unknown'). We record it per round, take the WORST for the draft,
// and say it loudly on the page when it is not 'applied'. $0, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { draft } from '../src/drafter.js';
import { thinkingSupport, thinkingSay, worstThinkingStatus } from '../src/thinking.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply, textReply,
} from './drafter-fixture.mjs';
import { world, killChildrenAfter, until, HERE } from './m4e-world.mjs';

killChildrenAfter();
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const run = (provider, extra = {}) => draft({ proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL, ...extra });

test('A: bare-agent 0.54 is installed and package.json asks for it', () => {
  const v = JSON.parse(readFileSync(new URL('../node_modules/bare-agent/package.json', import.meta.url), 'utf8')).version;
  assert.match(v, /^0\.52\.|^0\.5[3-9]\.|^0\.[6-9]\d\./);
  assert.match(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['bare-agent'], /0\.54\./);
});

test('B1: the row\'s Base URL is the 3rd argument of bareagent\'s lookup (a row of the common chat protocol on a host bareagent knows resolves by that host)', () => {
  const seen = [];
  const impl = (...a) => { seen.push(a); return { switchable: true }; };
  assert.equal(thinkingSupport('openai-api', 'm', { impl, baseUrl: 'https://api.deepseek.com/v1' }), true);
  assert.deepEqual(seen, [['openai', 'm', { baseUrl: 'https://api.deepseek.com/v1' }]]);
  // the REAL lookup: a measured OpenAI model id is switchable by id alone, but on a DeepSeek host the request path sends DeepSeek's shapes, which never measured it
  assert.equal(thinkingSupport('openai-api', 'gpt-5'), true);
  assert.equal(thinkingSupport('openai-api', 'gpt-5', { baseUrl: 'https://api.deepseek.com/v1' }), 'unverified');
});

test('B2: the Chat menu asks the lookup with the row\'s own Base URL', async () => {
  const calls = [];
  const w = await world({ authorOpts: { thinkingSupport: (shape, model, opts) => { calls.push([shape, model, opts]); return 'unverified'; } } });
  await w.get('/api/author/models');
  assert.deepEqual(calls, [['openai-api', 'fake-ticked', { baseUrl: 'http://127.0.0.1:9' }]]);
});

test('C1: the loud sentences, one function; applied says nothing', () => {
  // M4d am11: fixed strings, whatever was asked (they say what the model did)
  assert.equal(thinkingSay('ignored'), 'thinking on (the model thought anyway)');
  assert.equal(thinkingSay('unsupported'), "thinking on (this model can't change it)");
  assert.equal(thinkingSay('unknown'), 'thinking off (not confirmed)');
  assert.equal(thinkingSay('applied'), null);
  assert.equal(thinkingSay(null), null);
});

test('C2: worst wins: ignored > unsupported > unknown > applied', () => {
  assert.equal(worstThinkingStatus(['applied', 'unknown', 'unsupported', 'applied']), 'unsupported');
  assert.equal(worstThinkingStatus(['unknown', 'ignored', 'unsupported']), 'ignored');
  assert.equal(worstThinkingStatus(['applied', 'unknown']), 'unknown');
  assert.equal(worstThinkingStatus(['applied', 'applied']), 'applied');
  assert.equal(worstThinkingStatus([undefined, null]), null);
});

test('D1: each round records its thinkingStatus (and thinkingApplied stays); the draft carries the worst and the sentence', async () => {
  const p = fakeProvider([
    { ...textReply('no tool'), thinkingStatus: 'unknown', thinkingApplied: null },
    { ...toolReply(validArgs()), thinkingStatus: 'ignored', thinkingApplied: false },
  ]);
  const r = await run(p, { draftThinking: 'off' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.log.map((e) => e.thinkingStatus), ['unknown', 'ignored']);
  assert.equal(r.log[1].thinkingApplied, false);
  assert.deepEqual(r.thinking, { asked: 'off', status: 'ignored', say: 'thinking on (the model thought anyway)' });
});

test('D2: applied everywhere (or no status from the provider) means no sentence', async () => {
  const a = await run(fakeProvider([{ ...toolReply(validArgs()), thinkingStatus: 'applied' }]), { draftThinking: 'off' });
  assert.deepEqual(a.thinking, { asked: 'off', status: 'applied', say: null });
  const none = await run(fakeProvider([toolReply(validArgs())]), { draftThinking: 'on' });
  assert.deepEqual(none.thinking, { asked: 'on', status: null, say: null });
});

test('D3: a ValidationError (raw thinking + thinkingMode) is a plain provider-red, loud with its message, counted unmetered', async () => {
  const { ValidationError } = await import('bare-agent');
  const provider = { async generate() { throw new ValidationError('[OpenAIProvider] both the raw thinking option and thinkingMode are set'); } };
  const r = await run(provider, { draftThinking: 'off' });
  assert.equal(r.stop, 'provider-red');
  assert.equal(r.spendComplete, false);
  assert.match(r.reds[0], /^provider-red: .*raw thinking option/);
});

test('E1: the page view of a green plan carries the thinking line in its step list (from log.json; M4d am10 moved it there); applied is a plain "thinking off"', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'ignored' } });
  const id = (await w.post('/api/author/draft', w.card({}))).json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green');
  assert.deepEqual([g.stepList[0].id, g.stepList[0].status, g.stepList[0].label], ['thinking', 'failed', 'thinking on (the model thought anyway)']);
  const w2 = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'applied' } });
  const id2 = (await w2.post('/api/author/draft', w2.card({}))).json().draftId;
  const g2 = await until(async () => { const j = (await w2.get(`/api/author/${id2}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.deepEqual([g2.stepList[0].status, g2.stepList[0].label], ['done', 'thinking off']);
});

test('E2: M4d am10 item 6 - the thinking sentence is in the step list, no longer a "chat-thinking" block beside the plan', () => {
  const start = PAGE.indexOf('function extrasFor(');
  const fn = PAGE.slice(start, PAGE.indexOf('\n    }', start) + 6);
  const extrasFor = new Function(`${fn}\nreturn extrasFor;`)();
  const base = { phase: 'green', checked: [], notChecked: { label: 'Not checked', items: [] } };
  assert.equal(extrasFor({ ...base, thinkingSay: 'thinking: not confirmed by the model' }).blocks.some((b) => b.id === 'chat-thinking'), false);
});
