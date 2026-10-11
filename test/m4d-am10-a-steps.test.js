// M4d amendment 10 (docs/wiki/the-module-ladder.md "M4d amendment 10"), piece A: ONE function builds the Chat list of what a draft really did,
// from the draft's own log.json and declaration. $0, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftStepList } from '../src/draft-steps.js';

const okLog = (extra = {}) => ({
  ok: true, stop: null, reds: [], rounds: 1, calls: 1, costUsd: 0.0055503, spendComplete: true, modelId: 'deepseek-flash', structureRetries: 0, revisions: 0,
  thinking: { asked: 'on', status: 'applied', say: null },
  inputs: [{ role: 'aging', detail: '11 columns' }],
  log: [{ round: 1, kind: 'first', thinkingStatus: 'applied', outcome: 'valid' }],
  ...extra,
});
const decl = (classes = ['green', 'hitl']) => ({ steps: classes.map((c, i) => ({ fromLine: i + 1, close: { class: c } })) });
const shape = (list) => list.map((s) => `${s.id}:${s.status}:${s.label}`);

test('A1: a green draft: thinking, inputs, drafted, plan checks; no rubrics, no tries; details as signed', () => {
  const l = draftStepList({ log: okLog(), declaration: decl() });
  assert.deepEqual(shape(l), ['thinking:done:thinking on', 'inputs:done:inputs', 'drafted:done:drafted with deepseek-flash', 'checks:done:plan checks']);
  assert.deepEqual(l[1].details, ['aging: 11 columns']);
  assert.deepEqual(l[2].details, ['1 round · $0.0056']);
  assert.deepEqual(l[0].details, []);
  assert.deepEqual(l[3].details, []);
});

test('A2: thinking off applied says "thinking off"; no thinking record or no status shows no thinking line', () => {
  assert.equal(draftStepList({ log: okLog({ thinking: { asked: 'off', status: 'applied', say: null } }), declaration: decl() })[0].label, 'thinking off');
  assert.ok(!shape(draftStepList({ log: okLog({ thinking: undefined }), declaration: decl() })).some((x) => x.startsWith('thinking')));
  assert.ok(!shape(draftStepList({ log: okLog({ thinking: { asked: 'on', status: null, say: null } }), declaration: decl() })).some((x) => x.startsWith('thinking')));
});

test('A3: ignored / unsupported / unknown: the line fails and carries am7\'s own words as its label', () => {
  for (const [status, say] of [['ignored', 'thinking: you asked on, the model ignored it'], ['unsupported', "thinking: this model can't switch it; ran without"], ['unknown', 'thinking: not confirmed by the model']]) {
    const l = draftStepList({ log: okLog({ thinking: { asked: 'on', status, say } }), declaration: decl() });
    assert.deepEqual([l[0].id, l[0].status, l[0].label], ['thinking', 'failed', say]);
  }
});

test('A4: a red (refused) draft: each refusal is a plan-checks detail; drafted still shows', () => {
  const reds = ['declaration: steps[2] uses a verb that is not wired', 'declaration: line 3 is neither served by any step'];
  const l = draftStepList({
    log: okLog({ ok: false, stop: 'validator', reds, revisions: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 2 red(s)', reds }, { round: 2, kind: 'revision', outcome: 'validator: 2 red(s)', reds }, { round: 3, kind: 'revision', outcome: 'validator: 2 red(s)', reds }], rounds: 3, calls: 3 }),
    declaration: decl(),
  });
  const checks = l.find((s) => s.id === 'checks');
  assert.equal(checks.status, 'failed');
  assert.deepEqual(checks.reds, reds);
  assert.equal(l.find((s) => s.id === 'drafted').status, 'done');
});

test('A5: a retry: try 2 of 3 and try 3 of 3 only when they happened, each with the reason from the round before', () => {
  const reds1 = ['declaration: steps[0] bad'];
  const l = draftStepList({
    log: okLog({ revisions: 1, rounds: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: reds1 }, { round: 2, kind: 'revision', outcome: 'valid' }] }),
    declaration: decl(),
  });
  assert.deepEqual(shape(l).slice(-2), ['checks:done:plan checks', 'try-2:done:try 2 of 3']);
  assert.deepEqual(l.find((s) => s.id === 'try-2').details, reds1);
  assert.equal(l.find((s) => s.id === 'drafted').details[0], '2 rounds · $0.0056');
  const l3 = draftStepList({
    log: okLog({ rounds: 3, log: [{ round: 1, kind: 'first', outcome: 'structure: no usable tool call (text instead of the tool)' }, { round: 2, kind: 'structure-retry', outcome: 'validator: 1 red(s)', reds: reds1 }, { round: 3, kind: 'revision', outcome: 'valid' }] }),
    declaration: decl(),
  });
  assert.deepEqual(l3.filter((s) => s.id.startsWith('try')).map((s) => [s.label, s.details]), [['try 2 of 3', ['no usable tool call (text instead of the tool)']], ['try 3 of 3', reds1]]);
});

test('A6: a softgreen step adds rubrics with "line N: built"; none when no step is shape-checked; a rubric that cannot be built fails with bareguard\'s reason', () => {
  const l = draftStepList({ log: okLog(), declaration: decl(['green', 'softgreen', 'softgreen']) });
  const r = l.find((s) => s.id === 'rubrics');
  assert.deepEqual([r.status, r.details], ['done', ['line 2: built', 'line 3: built']]);
  assert.ok(!draftStepList({ log: okLog(), declaration: decl() }).some((s) => s.id === 'rubrics'));
  const red = 'declaration: steps[1].close.shape cannot be built into a check — sections must be unique';
  const bad = draftStepList({ log: okLog({ ok: false, stop: 'validator', reds: [red, 'declaration: other'], log: [{ round: 1, kind: 'first', outcome: 'validator: 2 red(s)', reds: [red, 'declaration: other'] }] }), declaration: decl(['green', 'softgreen']) });
  const br = bad.find((s) => s.id === 'rubrics');
  assert.deepEqual([br.status, br.details], ['failed', ['line 2: sections must be unique']]);
  assert.deepEqual(bad.find((s) => s.id === 'checks').reds, ['declaration: other']);
});

test('A7: a draft with none of it: no inputs, no declaration -> only what happened is listed; money is never 0 when unknown', () => {
  const l = draftStepList({ log: okLog({ inputs: [], thinking: undefined, costUsd: null, spendComplete: false }), declaration: decl() });
  assert.deepEqual(shape(l), ['drafted:done:drafted with deepseek-flash', 'checks:done:plan checks']);
  assert.deepEqual(l[0].details, ['1 round · cost unknown']);
  const part = draftStepList({ log: okLog({ spendComplete: false }), declaration: decl() });
  assert.deepEqual(part.find((s) => s.id === 'drafted').details, ['1 round · at least $0.0056']);
  assert.equal(draftStepList({ log: null, declaration: null }), null);
});

test('A8: a draft that never got a plan (provider red) is drafted-failed with its reasons; no plan checks line', () => {
  const l = draftStepList({
    log: okLog({ ok: false, stop: 'provider-red', reds: ['provider-red: timed out'], log: [{ round: 1, kind: 'first', outcome: 'provider-red: timed out' }], thinking: { asked: 'off', status: null, say: null } }),
    declaration: null,
  });
  assert.deepEqual(shape(l), ['inputs:done:inputs', 'drafted:failed:drafted with deepseek-flash']);
  assert.deepEqual(l[1].details.slice(-1), ['provider-red: timed out']);
});
