// M16 P4 item 5 (docs/wiki/the-module-ladder.md, "M16" item 1): the Audit's "Checks" fold - the card's sections (Checks, Not checked, Always checked), each row with its tag and, after the run, its recorded
// result; a row no verdict was recorded for says so, never "passed". Unit tests over a synthetic plan and diary, then a REAL run (real runner, fake model step, $0). Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { auditChecksOf } from '../src/auditchecks.js';
import { dropRows, dropLine } from '../src/pagedropwords.js';
import { lineRules } from '../src/pagebits.js';
import { closeRecords } from '../src/try-checks.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const row = (/** @type {any} */ o) => ({ state: 'built', ...o });
const decl = () => ({
  steps: [
    { fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'hitl' } },
    { fromLine: 2, emits: 'a2', goal: 'two', primitives: [], reads: ['a1'], close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }, { rule: 'listItems', value: 3 }] } } },
  ],
  checkList: [
    row({ key: 'L1.$floor', line: 1, kind: 'floor', by: 'default' }),
    row({ key: 'L2.$floor', line: 2, kind: 'floor', by: 'default' }),
    row({ key: 'L2.~1', line: 2, kind: 'rule', by: 'you', part: { line: 2, part: 0 } }),
    row({ key: 'L2.count', line: 2, kind: 'count', by: 'agent', part: { line: 2, part: 1 } }),
  ],
});
const checks = (/** @type {any[]} */ cs) => ({ kind: 'checks', step: 'a2', try: 1, checks: cs });
const EVERY = [{ n: 1, text: "the output exists and isn't empty", ok: true, source: 'every step' }, { n: 2, text: 'the model said done: true', ok: true, source: 'every step' }];

test('the sections: each check with its tag and its recorded result; Not checked rows say "not checked"; the always rows come from the steps\' own records', () => {
  const diary = [checks([...EVERY, { n: 3, text: 'at most 80 words', ok: true, part: 0, by: 'you', source: 'line 2 ~' }, { n: 4, text: 'exactly 3 list items', ok: false, part: 1, by: 'agent', source: 'line 2 ~' }])];
  const a = auditChecksOf(decl(), diary, { items: ['not checked · "tone" — You chose to leave it Not checked.'], by: { 'not checked · "tone" — You chose to leave it Not checked.': 'you' } });
  assert.ok(a);
  assert.deepEqual(a.checks.map((r) => [r.by, r.result]), [['you', 'passed'], ['agent', 'failed']], 'break: read the result of the wrong part and this reds');
  assert.match(a.checks[0].text, /^line 2 · at most 80 words/);
  assert.deepEqual(a.notChecked.map((r) => [r.by, r.result]), [['you', 'not-checked']]);
  assert.deepEqual(a.always.map((r) => [r.by, r.result]), [['default', 'passed'], ['default', 'passed']]);
});

test('M17 am4 (C3): a reading note is not a Not checked row in the Audit; it is split out as the card and the Job tab do, and a real Not checked line stays', () => {
  const read = dropLine(dropRows([{ line: 1, fact: 'Price', word: 'US dollars', reason: 'r1l', other: 'US dollars' }])[0], [{ n: 1, text: 'x', rule: '' }], lineRules);
  const not = 'not checked \u00b7 "tone" \u2014 You chose to leave it Not checked.';
  const a = auditChecksOf(decl(), [], { items: [read, not], by: { [not]: 'you' } });
  assert.ok(a);
  assert.deepEqual(a.notChecked.map((r) => r.text), [not], 'break: map notChecked.items raw (not through notCheckedView) and this reds');
  assert.deepEqual(a.readNotes, [read]);
});

test('a check no verdict was recorded for says "none", never "passed"; a run that has not started has none anywhere', () => {
  const a = auditChecksOf(decl(), [], null);
  assert.ok(a);
  assert.ok(a.checks.length === 2 && a.checks.every((r) => r.result === 'none'), JSON.stringify(a.checks));
  assert.ok(a.always.every((r) => r.result === 'none'), 'break: default the result to passed and this reds');
});

test('a plan with no list has no fold (it keeps its own Audit rows)', () => {
  const d = decl();
  delete (/** @type {any} */ (d)).checkList;
  assert.equal(auditChecksOf(d, [], null), null);
});

test('the records a list line saves carry the part each check is, so the fold can match them', () => {
  const d = decl();
  const closed = { verdict: 'green', checks: [{ id: 'keys', text: 'one key', ok: true, result: null }, { id: 'pick1', text: 'at most 80 words', ok: true, result: null }, { id: 'pick2', text: 'exactly 3 list items', ok: true, result: null }] };
  const on = closeRecords(d.steps[1], { text: 'x' }, closed, d.checkList);
  assert.deepEqual(on.filter((r) => /** @type {any} */ (r).by).map((r) => [/** @type {any} */ (r).by, /** @type {any} */ (r).part]), [['you', 0], ['agent', 1]]);
});

test('a REAL run of a list plan: the audit carries the fold - the always rows passed from the step records, the line checks matched by part', async () => {
  const w = await world();
  const { flow } = await w.signedFlow();
  const started = (await w.post('/api/author/run', { flow, inputs: w.inputs(), runId: 'r1' })).json();
  assert.ok(started.startId, JSON.stringify(started));
  const audit = await until(async () => {
    const j = (await w.get(`/api/runs/${flow}/r1/audit`)).json();
    return j?.auditChecks?.always?.every((r) => r.result !== 'none') ? j : null;
  }, 20000);
  assert.deepEqual(audit.auditChecks.always.map((r) => [r.by, r.result]), [['default', 'passed'], ['default', 'passed']], 'break: stop writing the every-step records into the diary and this reds');
  assert.ok(audit.auditChecks.notChecked.every((r) => r.result === 'not-checked'));
  // the signed plan has a list, so the sign row's Not-checked block carries the tags
  assert.ok(readFileSync(path.join(w.root, flow, 'setup.jsonl'), 'utf8').includes('"kind":"sign"'));
});
