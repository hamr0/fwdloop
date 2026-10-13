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

test('A2: thinking off applied says "thinking off"; no thinking record or no status shows no thinking line', () => {
  assert.equal(draftStepList({ log: okLog({ thinking: { asked: 'off', status: 'applied', say: null } }), declaration: decl() })[0].label, 'thinking off');
  assert.ok(!shape(draftStepList({ log: okLog({ thinking: undefined }), declaration: decl() })).some((x) => x.startsWith('thinking')));
  assert.ok(!shape(draftStepList({ log: okLog({ thinking: { asked: 'on', status: null, say: null } }), declaration: decl() })).some((x) => x.startsWith('thinking')));
});

test('A3: ignored / unsupported / unknown: the line fails and carries am7\'s own words as its label', () => {
  for (const [status, say] of [['ignored', 'thinking on (the model thought anyway)'], ['unsupported', "thinking on (this model can't change it)"], ['unknown', 'thinking off (not confirmed)']]) {
    const l = draftStepList({ log: okLog({ thinking: { asked: 'on', status, say } }), declaration: decl() });
    assert.deepEqual([l[0].id, l[0].status, l[0].label], ['thinking', 'failed', say]);
  }
});

test('A6 (am15): a softgreen step adds "rubrics · line N"; none when no step is shape-checked; a rubric that cannot be built fails with bareguard\'s reason', () => {
  const l = draftStepList({ log: okLog(), declaration: decl(['green', 'softgreen', 'softgreen']) });
  const r = l.find((s) => s.id === 'rubrics');
  assert.deepEqual([r.status, r.label], ['done', 'rubrics · line 2 · line 3']);
  assert.ok(!draftStepList({ log: okLog(), declaration: decl() }).some((s) => s.id === 'rubrics'));
  const red = 'declaration: steps[1].close.shape cannot be built into a check — sections must be unique';
  const bad = draftStepList({ log: okLog({ ok: false, stop: 'validator', reds: [red, 'declaration: other'], log: [{ round: 1, kind: 'first', outcome: 'validator: 2 red(s)', reds: [red, 'declaration: other'] }] }), declaration: decl(['green', 'softgreen']) });
  const br = bad.find((s) => s.id === 'rubrics');
  assert.deepEqual([br.status, br.label], ['failed', 'rubrics · line 2: sections must be unique']);
});

test('A7: a draft with none of it: no inputs, no declaration -> only what happened is listed; money is never 0 when unknown', () => {
  const l = draftStepList({ log: okLog({ inputs: [], thinking: undefined, costUsd: null, spendComplete: false }), declaration: decl() });
  assert.deepEqual(shape(l), ['drafted:done:drafted · deepseek-flash · 1 round · cost unknown', 'checks:done:plan checks']);
  const part = draftStepList({ log: okLog({ spendComplete: false }), declaration: decl() });
  assert.equal(part.find((s) => s.id === 'drafted').label, 'drafted · deepseek-flash · 1 round · at least $0.0056');
  assert.equal(draftStepList({ log: null, declaration: null }), null);
});

test('A8: a draft that never got a plan (provider red) is drafted-failed with its own reason on the line; no plan checks line', () => {
  const l = draftStepList({
    log: okLog({ ok: false, stop: 'provider-red', reds: ['provider-red: timed out'], log: [{ round: 1, kind: 'first', outcome: 'provider-red: timed out' }], thinking: { asked: 'off', status: null, say: null } }),
    declaration: null,
  });
  assert.deepEqual(shape(l), ['inputs:done:inputs · aging: 11 columns', 'drafted:failed:drafted · deepseek-flash · 1 round · $0.0056 · provider-red: timed out']);
});

// ---- piece B: where the inputs facts come from (one writer: readInputFacts), and that they ride in the draft's log.json ----
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { readInputFacts } from '../src/input-facts.js';
import { draft } from '../src/drafter.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

test('B1: readInputFacts lists one {role, detail} per input: a CSV says its columns, text says its headings', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am10-'));
  const csv = path.join(dir, 'aging.csv'); const md = path.join(dir, 'jd.md');
  writeFileSync(csv, 'a,b,c\n1,2,3\n'); writeFileSync(md, '# One\n\n## Two\nx\n');
  const r = readInputFacts([{ kind: 'file', role: 'aging', path: csv }, { kind: 'file', role: 'jd', path: md }]);
  assert.deepEqual(r.list, [{ role: 'aging', detail: '3 columns' }, { role: 'jd', detail: '2 headings' }]);
});

test('B2: draft() returns the input list; the declaration (hashed) is unchanged by it', async () => {
  const fx = job2Fixture();
  const r = await draft({ proseText: fx.prose, provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.inputs.map((i) => i.role).sort(), ['jd', 'resume']);
  assert.equal(Object.hasOwn(r.declaration, 'inputs'), false);
});
