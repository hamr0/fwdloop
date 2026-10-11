// M4d amendment 3, A (items 1 and 3): the thinking allow-list and a cap cut-off counting as a failed try. $0: fake provider / local server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { draft, MAX_STRUCTURE_RETRIES } from '../src/drafter.js';
import { draftCallOptions, makeProvider } from '../src/provider.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply, truncatedReply,
} from './drafter-fixture.mjs';

const DS = { shape: 'openai-api', model: 'deepseek-flash' };

test('item 1: the allow-list — deepseek-flash off sends disabled; other model off sends nothing; on sends nothing; bad mode throws', () => {
  assert.deepEqual(draftCallOptions(DS, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(draftCallOptions(DS), { thinking: { type: 'disabled' } }, 'default is off');
  assert.deepEqual(draftCallOptions({ shape: 'openai-api', model: 'hf:Qwen/Qwen3.8-27B' }, 'off'), {});
  assert.deepEqual(draftCallOptions({ shape: 'anthropic-api', model: 'deepseek-flash' }, 'off'), {});
  assert.deepEqual(draftCallOptions(DS, 'on'), {});
  for (const bad of ['', 'ON', true, null, 'auto']) assert.throws(() => draftCallOptions(DS, bad), /draftThinking must be one of/);
});

async function wireBody(extra) {
  let body;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [
          { id: 't1', type: 'function', function: { name: 'emit_declaration', arguments: JSON.stringify(validArgs()) } }] } }],
        model: 'deepseek-flash', usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 0 } },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-fake-test-key';
  try {
    const r = await draft({
      proseText: job2Fixture().prose,
      makeProviderFn: (slot, opts) => { const b = makeProvider(slot, opts); b.provider.baseUrl = `http://127.0.0.1:${server.address().port}`; return b; },
      ...extra,
    });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
    return body;
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('item 1 on the wire: default and off send thinking disabled (F49); on sends no thinking field', async () => {
  assert.deepEqual((await wireBody({})).thinking, { type: 'disabled' });
  assert.deepEqual((await wireBody({ draftThinking: 'off' })).thinking, { type: 'disabled' });
  assert.equal((await wireBody({ draftThinking: 'on' })).thinking, undefined);
});

test('item 1: a bad draftThinking mode refuses the draft before any call', async () => {
  const r = await draft({ proseText: job2Fixture().prose, draftThinking: 'maybe', makeProviderFn: () => { throw new Error('should not build'); } }).catch((e) => e);
  assert.ok(r instanceof Error || r.ok === false);
  assert.match(String(r.message ?? r.reds), /draftThinking must be one of/);
});

function recProvider(replies) {
  const p = fakeProvider(replies);
  const inner = p.generate.bind(p);
  p.schemas = [];
  p.generate = async (messages, tools, options) => {
    p.schemas.push(JSON.parse(JSON.stringify(tools[0].parameters)));
    return inner(messages, tools, options);
  };
  return p;
}
const run = (provider, extra = {}) => draft({ proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL, ...extra });

test('item 3: a cap cut-off on tries 1 and 2 opens the try-3 question; a question about any job line is kept', async () => {
  const p = recProvider([truncatedReply(), truncatedReply(), toolReply({ ...validArgs(), questions: [{ line: 1, question: 'which file?' }] })]);
  const r = await run(p);
  assert.equal(p.calls.length, 3);
  assert.equal(p.schemas[0].properties.questions, undefined);
  assert.equal(p.schemas[1].properties.questions, undefined);
  assert.ok(p.schemas[2].properties.questions, 'try 3 may ask');
  assert.match(p.calls[2].messages.at(-1).content, /questions/);
  assert.deepEqual(r.questions, [{ line: 1, question: 'which file?' }], 'a cut-off names no line: every job line may be asked about');
  assert.equal(r.revisions, 2);
  assert.match(r.log[0].outcome, /^structure: truncated/, 'still named truncation, never "no tool call"');
});

test('item 3: a cut-off try 1 then a validator red on try 2 also opens try 3', async () => {
  const bad = () => { const a = validArgs(); a.steps[2].primitives = ['stash']; return a; };
  const p = recProvider([truncatedReply(), toolReply(bad()), toolReply(validArgs())]);
  await run(p);
  assert.ok(p.schemas[2].properties.questions);
});

test('item 3: one cut-off then a finished try 2 never opens questions; a cut-off on try 3 still stops as structure', async () => {
  const p = recProvider([truncatedReply(), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true);
  assert.equal(p.schemas[1].properties.questions, undefined);
  const p2 = recProvider([truncatedReply()]);
  const r2 = await run(p2, { budgetUsd: 5 });
  assert.equal(r2.ok, false);
  assert.equal(r2.stop, 'structure');
  assert.match(r2.reds[0], /^truncated:/);
  assert.equal(r2.structureRetries, MAX_STRUCTURE_RETRIES);
  assert.equal(r2.rounds, 3 + MAX_STRUCTURE_RETRIES, 'two failed tries, then try 3 with its structure retries');
});
