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
  for (const [status, say] of [['ignored', 'thinking on (the model thought anyway)'], ['unsupported', "thinking on (this model can't change it)"], ['unknown', 'thinking off (not confirmed)']]) {
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

test('A5 (am12): a retry: every try is its own line with its OWN result and reason, from try 1; none when one try passed', () => {
  const reds1 = ['declaration: steps[0] bad'];
  const l = draftStepList({
    log: okLog({ revisions: 1, rounds: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: reds1 }, { round: 2, kind: 'revision', outcome: 'valid' }] }),
    declaration: decl(),
  });
  const tries = l.filter((s) => s.id.startsWith('try'));
  assert.deepEqual(tries.map((s) => [s.label, s.status]), [['try 1', 'failed'], ['try 2', 'done']]);
  assert.deepEqual(tries[0].reds, reds1); // try 1's OWN refusal sits on try 1 (the page's one translator makes it plain)
  assert.deepEqual(tries[1].reds, undefined);
  assert.deepEqual(tries[1].details, []);
  assert.equal(l.find((s) => s.id === 'drafted').details[0], '2 rounds · $0.0056');
  assert.ok(!draftStepList({ log: okLog(), declaration: decl() }).some((s) => s.id.startsWith('try')));
});

// the shape of hamr's real draft d-00mv548zrh-d6c7 (4 rounds: validator, validator, broken JSON, free retry ok); the text is scrubbed
const REAL_SHAPE = {
  revisions: 2, structureRetries: 1, rounds: 4,
  log: [
    { round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: ['declaration: steps[2].close.shape.sections names "A" which is not a section'] },
    { round: 2, kind: 'revision', outcome: 'validator: 2 red(s)', reds: ['declaration: steps[0] reads artifact "x" that no earlier step emits', 'declaration: steps[1] reads artifact "y" that no earlier step emits'] },
    { round: 3, kind: 'revision', outcome: "structure: the tool call's arguments were not valid JSON (Expected ',' at position 846)" },
    { round: 4, kind: 'structure-retry', outcome: 'valid' },
  ],
};

test('A5b (am12): the free retry after a broken reply is "try 3 again", never "try 4"; earlier tries are grey and a grey note sits above them', () => {
  const l = draftStepList({ log: okLog(REAL_SHAPE), declaration: decl() });
  const tries = l.filter((s) => s.id.startsWith('try'));
  assert.deepEqual(tries.map((s) => [s.label, s.status, s.grey === true]), [['try 1', 'failed', true], ['try 2', 'failed', true], ['try 3', 'failed', true], ['try 3 again', 'done', true]]);
  assert.deepEqual(tries[2].details, ['the reply came back broken; one free retry']);
  assert.equal(tries[0].reds.length, 1);
  assert.equal(tries[1].reds.length, 2);
  assert.ok(!l.some((s) => s.label === 'try 4'));
  const note = l.find((s) => s.id === 'tries-note');
  assert.equal(note.label, 'Earlier tries were refused by the checks and fixed by the AI. Nothing for you to do.');
  assert.equal(l.indexOf(note) + 1, l.findIndex((s) => s.id.startsWith('try')), 'the note is directly above the first try');
});

test('A5c (am12): a draft that ends red keeps its LAST try red and shows no "fixed by the AI" note', () => {
  const reds = ['declaration: steps[0] bad'];
  const l = draftStepList({
    log: okLog({ ok: false, stop: 'validator', reds, rounds: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds }, { round: 2, kind: 'revision', outcome: 'validator: 1 red(s)', reds }] }),
    declaration: decl(),
  });
  const tries = l.filter((s) => s.id.startsWith('try'));
  assert.deepEqual(tries.map((s) => [s.label, s.status, s.grey === true]), [['try 1', 'failed', true], ['try 2', 'failed', false]]);
  assert.ok(!l.some((s) => s.id === 'tries-note'));
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
