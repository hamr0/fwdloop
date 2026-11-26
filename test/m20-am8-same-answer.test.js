// M20 am8 item 1: for each merged question, every OLD site's predicate (frozen here as a literal copy, named `old site file:line`) gives the owner's answer on every value of its kind plus empty, missing and unknown values.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { readFileInside } from '../src/inside.js';
import { readRecordFile, readRowChoices, readShapeDropped, readSheetDropped, readColumns } from '../src/pickrecord.js';
import { test } from 'node:test';
import { lockMayBeHeld } from '../src/liveness.js';
import { noJudgment } from '../src/closers.js';
import { answerPickedUp } from '../src/panel/data.js';
import { FLOW_TYPES, isFlowType } from '../src/declaration.js';
import { scheduleChoices, scheduleKindsOf } from '../src/schedule-choices.js';
import { isThinkingMode } from '../src/thinking.js';
import { endsRun } from '../src/runner.js';
import { isFactKind } from '../src/checkblock.js';
import { isShapeAsk } from '../src/pageask.js';
import { needsReason } from '../src/ask.js';
import { tagOf } from '../src/checkwords.js';
import { isRowChoice } from '../src/pickrecord.js';
import { startedNothing } from '../src/summary-words.js';

const ODD = ['', null, undefined, 'nonsense', 0, {}, 'Live', ' live'];
/** old == owner on every value @param {string} what @param {unknown[]} kind @param {(v:any)=>unknown} oldFn @param {(v:any)=>unknown} owner */
const same = (what, kind, oldFn, owner) => {
  for (const v of [...kind, ...ODD]) assert.equal(owner(v), oldFn(v), `${what}: ${JSON.stringify(v)}`);
};

test('1a lockMayBeHeld: the three old sites ask live-or-unknown of a lock state', () => {
  const states = ['none', 'live', 'dead', 'unknown', 'empty'];
  // old site src/panel/authorresume.js:71 and src/runner.js:2305
  same('lock.state', states, (s) => s === 'live' || s === 'unknown', lockMayBeHeld);
  // old site src/panel/data.js:298 (the `lock` word of stuckState, the same state string)
  same('data lock', states, (lock) => lock === 'live' || lock === 'unknown', lockMayBeHeld);
});

test('1b noJudgment: the old sites ask crash-or-unparseable of a closer verdict', () => {
  const verdicts = ['green', 'red', 'hitl', 'unparseable', 'crash', 'stopped', 'close-casualty'];
  // old sites src/closers.js:125,126 (withItemShape), :353,:354 (withNumbers), :383,:384 (closeFactAndPicks), in the `v === 'crash' || v === 'unparseable'` form
  same('closers verdict', verdicts, (v) => v === 'crash' || v === 'unparseable', noJudgment);
  // old site src/try-checks.js:77, the pair in the other order
  same('try-checks verdict', verdicts, (v) => v === 'unparseable' || v === 'crash', noJudgment);
  // src/runner.js:1223 asks `!== 'red'` after green and hitl returned: equal on the three verdicts that can reach it, different on any other, so it stays apart (see the guard)
  for (const v of ['red', 'unparseable', 'crash']) assert.equal(noJudgment(v), v !== 'red');
});

test('1c answerPickedUp: the three old data.js sites ask starting-or-not-started of the resume, for this ask', () => {
  const states = ['starting', 'not-started', 'broken', 'took-over'];
  const resumes = [...states.flatMap((state) => [{ state, askId: 'a1' }, { state, askId: 'other' }, { state }]), null, undefined, {}, '', 0, { state: 'starting' }];
  for (const askId of ['a1', undefined, null, '']) {
    for (const r of resumes) {
      // old site src/panel/data.js:2433 (answerSaved)
      const old2433 = r != null && r.askId === askId && (r.state === 'starting' || r.state === 'not-started');
      // old site src/panel/data.js:2439 (answered), with `open` true and false
      const old2439 = (open) => open && r != null && r.askId === askId && (r.state === 'starting' || r.state === 'not-started');
      // old site src/panel/data.js:2462 (reopenOffer), read as the truth of its `if`
      const old2462 = !!(r && r.askId === askId && (r.state === 'starting' || r.state === 'not-started'));
      const tag = JSON.stringify([r, askId]);
      assert.equal(answerPickedUp(r, askId), old2433, `2433 ${tag}`);
      for (const open of [true, false]) assert.equal(open && answerPickedUp(r, askId), old2439(open), `2439 ${open} ${tag}`);
      assert.equal(!!answerPickedUp(r, askId), old2462, `2462 ${tag}`);
    }
  }
});

test('1d startedNothing: the old data.js:1493 test equals the owner on every fire outcome and on a missing or odd row', () => {
  const outcomes = ['started', 'busy', 'monthly-exhausted', 'refused', 'schedule-changed', 'skipped', 'caught-up'];
  const rows = [...outcomes.map((outcome) => ({ outcome })), {}, null, undefined, { outcome: null }, { outcome: 'nonsense' }, 0, ''];
  for (const latest of rows) {
    // old site src/panel/data.js:1493 (the schedule block's `problem`), read as the truth of the ternary it fed
    const old = !!(latest && latest.outcome !== 'started' && ['busy', 'monthly-exhausted', 'refused'].includes(latest.outcome));
    assert.equal(!!startedNothing(latest), old, JSON.stringify(latest));
  }
});

test('1e isRowChoice: the five old sites ask drop-or-add of a choice word', () => {
  const kind = ['drop', 'add'];
  // old sites src/pickrecord.js:117 and src/checkblock.js:1335 (positive form); src/checkblock.js:1314, :1343 and src/panel/author.js:944 (negated form)
  same('positive', kind, (c) => c === 'drop' || c === 'add', isRowChoice);
  same('negated', kind, (c) => !(c !== 'drop' && c !== 'add'), isRowChoice);
  same('array', [['drop']], (c) => c === 'drop' || c === 'add', isRowChoice);
});

test('1f tagOf: the node sites that spelled the three origin tags equal `tagOf(by) !== ""`, also on names that live on every object', () => {
  const kind = ['you', 'agent', 'default'];
  // old sites src/blockassemble.js:126, src/checklistsign.js:80,86,92, src/auditchecks.js:66, src/panel/result.js:227 (`x === 'you' || x === 'agent' || x === 'default'`), src/checklook.js:43 (the same triple)
  same('triple', [...kind, 'constructor', 'toString', '__proto__', 'hasOwnProperty'], (b) => b === 'you' || b === 'agent' || b === 'default', (b) => tagOf(b) !== '');
});

test('1g needsReason: the two old node sites ask redo-or-rerun of a decision word', () => {
  const kind = ['accept', 'redo', 'rerun', 'reject', 'timeout', 'park'];
  // old sites src/ask.js:446 (answerAsk) and src/runner.js:1795 (the saved answer's re-check, read as `isRedo`)
  same('decision', kind, (d) => d === 'redo' || d === 'rerun', needsReason);
});

test('1h isFlowType: the old node sites, the schedule choices and the page equal the owner on every flow type and odd value', () => {
  const kind = ['plain', 'mcp', 'tickets', 'Plain', 'ticket', 'constructor', '__proto__', ['plain'], 5];
  // old sites src/panel/authorcard.js:484 and bin/fwdloop:922 (a membership test of the three words)
  same('membership', kind, (x) => ['plain', 'mcp', 'tickets'].includes(x), isFlowType);
  // old sites src/declaration.js:113 and :122 (the string-typed form)
  same('declaration', kind, (x) => typeof x === 'string' && FLOW_TYPES.includes(x), isFlowType);
  // old site src/schedule-choices.js:32 typeOf: unknown reads plain; compared by the kinds each reads
  const oldTypeOf = (x) => (x === 'mcp' || x === 'tickets' ? x : 'plain');
  const all = scheduleChoices();
  for (const v of [...kind, ...ODD]) assert.deepEqual(scheduleKindsOf(v), all[oldTypeOf(v)].map((c) => c.kind), `typeOf ${JSON.stringify(v)}`);
  // old page sites index.html:1688, :6329, :6656: the page now asks the keys of the choices it gets; the keys are exactly the flow types
  assert.deepEqual(Object.keys(all), [...FLOW_TYPES]);
  same('page', kind, oldTypeOf, (x) => (typeof x === 'string' && Object.prototype.hasOwnProperty.call(all, x) ? x : 'plain'));
});

test('1i isThinkingMode: the four old sites ask on-or-off of a thinking word', () => {
  const kind = ['on', 'off'];
  // old sites src/model-step.js:395, src/draft-steps.js:67, src/thinking.js:68,69 (positive form)
  same('positive', [...kind, 'On', 'auto'], (m) => m === 'on' || m === 'off', isThinkingMode);
  // old site src/drafter.js:396 (the refusal form)
  same('negated', kind, (m) => !(m !== 'on' && m !== 'off'), isThinkingMode);
});

test('1j endsRun: the three old runner.js sites ask paused-or-stopped of an ask loop return', () => {
  const types = ['paused', 'stopped', 'halted', 'accepted'];
  for (const type of [...types, '', null, undefined, 'nonsense']) {
    // old sites src/runner.js:2030, :2150, :2840 (`x.type === 'paused' || x.type === 'stopped'`)
    assert.equal(endsRun({ type }), type === 'paused' || type === 'stopped', JSON.stringify(type));
  }
  assert.equal(endsRun({}), false);
});

test('1l isFactKind and isShapeAsk: the old checkblock.js and pageask.js sites equal the owners', () => {
  const kinds = ['rule', 'fact', 'phrase', 'count', 'cited', 'numbers', 'note', 'floor', 'sheet', 'shape', 'stage'];
  // old sites src/checkblock.js:387,395,708,1145 (`r.kind === 'fact' || r.kind === 'phrase'`) and :1116 (negated)
  same('fact-or-phrase', kinds, (k) => k === 'fact' || k === 'phrase', isFactKind);
  same('negated', kinds, (k) => !(k !== 'fact' && k !== 'phrase'), isFactKind);
  const asks = ['reading', 'check', 'no-check', 'cant-check', 'action', 'column'];
  // old sites src/pageask.js:135,141 and src/panel/authorcard.js:199 (`x.ask === 'check' || x.ask === 'no-check'`)
  same('shape ask', asks, (a) => a === 'check' || a === 'no-check', isShapeAsk);
});

test('1m the five picks-record readers: opening through readJsonFile reads every kind of file as the old open-and-parse did', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'am8-1m-'));
  const entry = { lineWords: 'a', occurrence: 0, ruleText: 'r', tail: 't', choice: 'drop', key: 'k', line: 1, index: 0, check: { x: 1 }, text: 'x', name: 'n', word: 'w', column: 'c' };
  const body = (extra) => JSON.stringify({ picks: [entry, null, { lineWords: 5 }], rowChoices: [entry, { ...entry, choice: 'keep' }], shapeDropped: [entry], sheetDropped: [entry], columns: [entry], ...extra });
  const files = { object: body({}), empty: '', torn: '{"picks": [', array: '[1,2]', string: '"x"', number: '5', nullDoc: 'null', noFields: '{}', wrongTypes: '{"picks":"x","rowChoices":5,"shapeDropped":{},"sheetDropped":null,"columns":true}' };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, `${name}.json`), text);
  mkdirSync(path.join(dir, 'isdir.json'));
  symlinkSync(path.join(dir, 'object.json'), path.join(dir, 'link.json'));
  // old sites src/pickrecord.js:98,117,126,140,154: open through readFileInside, JSON.parse inside try, the field's own filter after
  const oldRead = (file, field, keep) => {
    try {
      const g = readFileInside(path.dirname(file), path.basename(file));
      if (!g.ok) return null;
      const j = JSON.parse(g.text);
      return Array.isArray(j?.[field]) ? j[field].filter(keep) : null;
    } catch { return null; }
  };
  const readers = [
    ['picks', readRecordFile, (e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.ruleText === 'string'],
    ['rowChoices', readRowChoices, (e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.tail === 'string' && (e.choice === 'drop' || e.choice === 'add')],
    ['shapeDropped', readShapeDropped, (d) => d && typeof d.lineWords === 'string' && Number.isInteger(d.occurrence) && (typeof d.name === 'string' || Number.isInteger(d.rule))],
    ['sheetDropped', readSheetDropped, (d) => d && typeof d.key === 'string' && Number.isInteger(d.line) && d.check && typeof d.check === 'object' && !Array.isArray(d.check)],
    ['columns', readColumns, (e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.word === 'string' && typeof e.column === 'string'],
  ];
  for (const name of [...Object.keys(files), 'isdir', 'link', 'missing']) {
    const file = path.join(dir, `${name}.json`);
    for (const [field, reader, keep] of readers) assert.deepEqual(reader(file), oldRead(file, field, keep), `${field} of ${name}`);
  }
});
