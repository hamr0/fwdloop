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
import { FACT_SHAPES } from '../src/citedcheck.js';
import { isAmountShape, isPhraseShape, isLegalCount } from '../src/pagebits.js';
import { canReadLimit } from '../src/pagerules.js';
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

test('1n isAmountShape: the seven old sites ask money-or-number of a fact shape', () => {
  const kind = [...FACT_SHAPES, 'place'];
  // old sites src/pagebits.js:10 (boundOk), src/pagerules.js:223, src/checkblock.js:777, src/citedwords.js:126, src/shaperows.js:199 (positive, either order)
  same('positive', kind, (s) => s === 'money' || s === 'number', isAmountShape);
  same('positive other order', kind, (s) => s === 'number' || s === 'money', isAmountShape);
  // old sites src/citedcheck.js:124 and :323 (negated)
  same('negated', kind, (s) => !(s !== 'number' && s !== 'money'), isAmountShape);
});

test('1n canReadLimit and isPhraseShape: the old sites equal the owners on every fact shape', () => {
  const kind = [...FACT_SHAPES, 'place'];
  // old sites src/checkblock.js:501 (positive), :1167 (negated), src/pagerules.js:49 (negated, other order)
  same('limit positive', kind, (s) => s === 'money' || s === 'time', canReadLimit);
  same('limit negated', kind, (s) => !(s !== 'money' && s !== 'time'), canReadLimit);
  same('limit negated other order', kind, (s) => !(s !== 'time' && s !== 'money'), canReadLimit);
  // old sites src/checkblock.js:492 (isPhrase), src/citedcheck.js:72 (positive), src/checkblock.js:449 (negated)
  same('phrase positive', kind, (s) => s === 'phrase' || s === 'place', isPhraseShape);
  same('phrase negated', kind, (s) => !(s !== 'phrase' && s !== 'place'), isPhraseShape);
});

test('1n isLegalCount: the three old result-count tests equal the owner on every {min, max} a JSON file or an edit can hold', () => {
  const nums = [undefined, 0, 1, 2, 3, 2.5, -1, '2', null, NaN, Infinity, true];
  // old site src/citedcheck.js:139 (factPartReds): `!== undefined` forms
  const old139 = (c) => !!(c !== null && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).every((k) => k === 'min' || k === 'max') && (c.min !== undefined || c.max !== undefined)
    && ['min', 'max'].every((k) => c[k] === undefined || (Number.isInteger(c[k]) && c[k] >= 1)) && (c.min === undefined || c.max === undefined || c.min <= c.max));
  // old site src/citedcheck.js:352 (factShapeReds): Object.hasOwn forms
  const old352 = (c) => !!(c !== null && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).every((k) => k === 'min' || k === 'max') && (Object.hasOwn(c, 'min') || Object.hasOwn(c, 'max'))
    && ['min', 'max'].every((k) => !Object.hasOwn(c, k) || (Number.isInteger(c[k]) && c[k] >= 1))
    && (!Object.hasOwn(c, 'min') || !Object.hasOwn(c, 'max') || c.min <= c.max));
  // old site src/checkblock.js:1154 (addCount): the edit's own min and max
  const old1154 = (e) => {
    const ok = (x) => Number.isInteger(x) && x >= 1;
    return !(![e.min, e.max].some(Number.isInteger) || [e.min, e.max].some((x) => x !== undefined && !ok(x)) || (Number.isInteger(e.min) && Number.isInteger(e.max) && e.min > e.max));
  };
  for (const min of nums) {
    for (const max of nums) {
      // a JSON file cannot hold undefined: a missing key is a missing key
      const c = {};
      if (min !== undefined) c.min = min;
      if (max !== undefined) c.max = max;
      assert.equal(isLegalCount(c), old139(c), `139 ${JSON.stringify(c)}`);
      assert.equal(isLegalCount(c), old352(c), `352 ${JSON.stringify(c)}`);
      assert.equal(isLegalCount({ min, max }), old1154({ min, max }), `1154 ${String(min)} ${String(max)}`);
      // the explicit-undefined key is the one value where :139 and :352 differ (hasOwn); the owner keeps :139's, as addCount needs
      assert.equal(isLegalCount({ min, max }), old139({ min, max }), `139 explicit ${String(min)} ${String(max)}`);
    }
  }
  for (const odd of [null, undefined, '', 'x', 5, [], [1], {}, { min: 1, other: 2 }, { lo: 1 }]) {
    assert.equal(isLegalCount(odd), old139(odd), `odd 139 ${JSON.stringify(odd)}`);
    assert.equal(isLegalCount(odd), old352(odd), `odd 352 ${JSON.stringify(odd)}`);
  }
});

// ---- item 2: the guardrail readers (src/blockpick.js is the one copy) -----------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import * as owner from '../src/blockpick.js';
import * as declaration from '../src/declaration.js';

const NUMBER_WORDS_OLD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const readNumberOld = (t) => Number(t.replace(/,/g, ''));
// old site src/declaration.js:392-438 (HEAD ab6e0077), frozen
const oldDecl = {
  words: (guardrail) => (typeof guardrail !== 'string' ? [] : [...guardrail.matchAll(/(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s*words?\b(?!\s*(?:each|per\s+section)\b)/gi)].map((m) => readNumberOld(m[1]))),
  standalone: (guardrail) => (typeof guardrail !== 'string' ? [] : [...guardrail.matchAll(/(?<![A-Za-z0-9_.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g)].map((m) => Number(m[1].replace(/,/g, '')))),
  perSection: (guardrail) => { const m = typeof guardrail === 'string' ? /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?:\s*words?|ish(?:\s+words?)?)\s+(?:each|per\s+section)\b/i.exec(guardrail) : null; return m ? readNumberOld(m[1]) : null; },
  sections: (guardrail) => { const m = typeof guardrail === 'string' ? /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?sections?\b/i.exec(guardrail) : null; if (!m) return null; return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS_OLD[m[1].toLowerCase()]; },
  items: (guardrail) => { const m = typeof guardrail === 'string' ? /(?<![$€£\d.,])\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(?:bullets?|list items?|items?|lines?|points?)\b/i.exec(guardrail) : null; if (!m) return null; return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS_OLD[m[1].toLowerCase()]; },
};
oldDecl.isCount = (guardrail) => oldDecl.words(guardrail).length > 0 || oldDecl.items(guardrail) !== null || oldDecl.sections(guardrail) !== null;
// old site src/blockpick.js:25-79 (HEAD ab6e0077), frozen; the four readers other than items equal the declaration ones, items has no lookbehind
const oldBlock = {
  ...oldDecl,
  items: (g) => { const m = typeof g === 'string' ? /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(?:bullets?|bullet\s+points?|list\s+items?|items?|lines?|points?)\b/i.exec(g) : null; if (!m) return null; return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS_OLD[m[1].toLowerCase()]; },
};
oldBlock.isCount = (g) => oldBlock.words(g).length > 0 || oldBlock.items(g) !== null || oldBlock.sections(g) !== null;

const READERS = [
  ['guardrailWordNumbers', 'words'], ['guardrailStandaloneNumbers', 'standalone'], ['guardrailWordsPerSection', 'perSection'], ['guardrailSectionCount', 'sections'], ['guardrailItemCount', 'items'],
];
// test/fixtures/m20-am8-guardrail-texts.json: the distinct guardrail texts of every job, signed copy, run copy, draft and test fixture on the F277 measure (2026-11-26), 749 found, 9 dropped as possibly personal (a handle, a home-dir file name, a scratch id): 740 kept
const TEXTS = JSON.parse(readFileSync(new URL('./fixtures/m20-am8-guardrail-texts.json', import.meta.url), 'utf8'));

test('am8 item 2: both old copies and the owner read every real guardrail text the same way (740 kept of 749)', () => {
  assert.equal(TEXTS.length, 740);
  for (const t of [...TEXTS, ...ODD]) {
    for (const [name, key] of READERS) {
      assert.deepEqual(owner[name](t), oldDecl[key](t), `old declaration.js:392-438 ${name} ${JSON.stringify(t)}`);
      assert.deepEqual(owner[name](t), oldBlock[key](t), `old blockpick.js:25-79 ${name} ${JSON.stringify(t)}`);
    }
    assert.equal(owner.isCountable(t), oldDecl.isCount(t), `old declaration.js:438 isCountGuardrail ${JSON.stringify(t)}`);
    assert.equal(owner.isCountable(t), oldBlock.isCount(t), `old blockpick.js:79 isCountable ${JSON.stringify(t)}`);
  }
});

test('am8 item 2: the declaration.js names are the owner\'s functions, not second bodies', () => {
  for (const [name] of READERS) assert.equal(declaration[name], owner[name], name);
});

test('am8 item 2 probes: a price or a decimal before an item word is no count (old blockpick said 5, 3, 5, 5); "3 bullet points" is 3', () => {
  for (const [t, was] of [['$5 per item', 5], ['under $3 each line', 3], ['2.5 items', 5], ['1,5 items', 5]]) {
    assert.equal(owner.guardrailItemCount(t), null, t);
    assert.equal(owner.isCountable(t), false, t);
    assert.equal(oldBlock.items(t), was, `the old blockpick copy read ${t}`);
  }
  assert.equal(owner.guardrailItemCount('3 bullet points'), 3);
});

// ---- item 3: keepOrDrop and countCheck (src/blockpick.js is the one body; src/checkpick.js rowsFromAnswer calls it) ------------------------------
import { rowsFromAnswer } from '../src/checkpick.js';

// test/fixtures/m20-am8-check-suggest-replay.json: the 125 saved check-suggest answers of every draft on the F277 measure (2026-11-26; 145 entries, 20 had no job text to replay), 0 dropped for personal data (the 18 distinct
// guardrail texts are plain rules like "at most 60 words"). Each row holds the guardrail text, the model's entry, and what the OLD path (src/checkpick.js rowsFromAnswer with its own keepOrDrop and countCheck at HEAD c4b73a72) made of it.
const REPLAY = JSON.parse(readFileSync(new URL('./fixtures/m20-am8-check-suggest-replay.json', import.meta.url), 'utf8'));

test('am8 item 3: the 125 saved check-suggest answers come to the same check or the same reason through the one keepOrDrop', () => {
  assert.equal(REPLAY.length, 125);
  assert.equal(REPLAY.filter((r) => r.check !== null).length, REPLAY.filter((r) => r.why === null).length);
  for (const r of REPLAY) {
    const row = rowsFromAnswer([{ line: r.entry.line, rule: r.entry.guardrail, text: r.text }], { checks: [r.entry] })[0];
    assert.deepEqual({ check: row.check, why: row.why }, { check: r.check, why: r.why }, `old src/checkpick.js:keepOrDrop+countCheck ${JSON.stringify(r.text)} ${JSON.stringify(r.entry)}`);
  }
});

test('am8 item 3 probes: list rules the old first filter dropped are kept with their bound, "at least 3 items" is a minimum of 3', () => {
  const via = (text, entry) => rowsFromAnswer([{ line: 1, rule: 1, text }], { checks: [{ line: 1, guardrail: 1, ...entry }] })[0];
  // the old src/checkpick.js:73 keepOrDrop dropped each of these four (the number is not one the text names; maxListItems floor was 1); the first three then fell to the old countCheck's exact listItems 3, 3, 4, the fourth to no check
  assert.deepEqual(via('more than 3 bullets', { rule: 'minListItems', value: 4 }).check, { rule: 'minListItems', value: 4 });
  assert.deepEqual(via('fewer than 3 bullets', { rule: 'maxListItems', value: 2 }).check, { rule: 'maxListItems', value: 2 });
  assert.deepEqual(via('under 4 items', { rule: 'maxListItems', value: 3 }).check, { rule: 'maxListItems', value: 3 });
  assert.deepEqual(via('no more than 0 bullets', { rule: 'maxListItems', value: 0 }).check, { rule: 'maxListItems', value: 0 });
  // the old src/checkpick.js:192 countCheck built listItems 3 for this text
  assert.deepEqual(via('at least 3 items', { rule: 'none' }).check, { rule: 'minListItems', value: 3 });
});

// ---- am8a item 1: the page asks f, g and k through the one list the server hands it (src/page-words.js) -------------------------------------------
import { pageWords } from '../src/page-words.js';
import { TAG } from '../src/checkwords.js';
import { REVISE_PHASES, NOT_GREEN_PHASES } from '../src/panel/author.js';
import { REASON_DECISIONS } from '../src/ask.js';

// the page's own helper functions, read out of src/panel/index.html and run against the list exactly as the server injects it (JSON text)
const PAGE_SRC = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const pageFn = (name) => { const m = PAGE_SRC.match(new RegExp(`function ${name}\\([^)]*\\)\\{[^\\n]*\\}`)); assert.ok(m, `page function ${name}`); return m[0]; };
const PAGE = new Function('PAGE_WORDS', `${pageFn('inWords')}${pageFn('tagWordOf')}${pageFn('reasonMissing')}return { inWords, tagWordOf, reasonMissing };`)(JSON.parse(JSON.stringify(pageWords())));
const PHASES = ['drafting', 'revising', 'redrafting', 'questions-open', 'green', 'red', 'stopped', 'abandoned', 'signed', 'running', 'Red', ' stopped', 'constructor', '__proto__'];

test('am8a: the handed list holds the owners\' words and nothing else', () => {
  assert.deepEqual(Object.keys(pageWords()).sort(), ['notGreen', 'reasonDecisions', 'reviseRunning', 'tags']);
  assert.deepEqual(pageWords().tags, TAG);
  assert.deepEqual(pageWords().reasonDecisions, [...REASON_DECISIONS]);
  assert.deepEqual(pageWords().reviseRunning, [...REVISE_PHASES]);
  assert.deepEqual(pageWords().notGreen, [...NOT_GREEN_PHASES]);
});

test('am8a f: the page\'s tag word is what it was (old site src/panel/index.html:4206), also on names that live on every object and on non-strings', () => {
  same('tag word', ['you', 'agent', 'default'], (by) => (by === 'you' || by === 'agent' || by === 'default' ? '[' + by + ']' : ''), PAGE.tagWordOf);
  same('tag word odd', ['constructor', 'toString', '__proto__', 'hasOwnProperty', ['you'], ['agent'], 'You', 'you '], (by) => (by === 'you' || by === 'agent' || by === 'default' ? '[' + by + ']' : ''), PAGE.tagWordOf);
});

test('am8a g: the page\'s reason test is what it was (old site src/panel/index.html:5293), on every decision, empty, missing and unknown, with and without a reason', () => {
  for (const d of ['accept', 'redo', 'rerun', 'reject', 'Redo', ' redo']) {
    for (const v of ['', '  ', 'because', null, undefined, 0]) {
      assert.equal(PAGE.reasonMissing(d, v), (d === 'redo' || d === 'rerun') && String(v).trim() === '', `${d} / ${JSON.stringify(v)}`);
    }
  }
});

test('am8a k: the page\'s two phase questions and the server\'s revise check are what they were (old sites index.html:5954, 5964, 7003, 7057, 7116, 7149; author.js:794)', () => {
  // old sites: `st.phase === "revising" || st.phase === "redrafting"` (5964, 7003, 7057) and author.js:794
  same('revise running (page)', PHASES, (p) => p === 'revising' || p === 'redrafting', (p) => PAGE.inWords(pageWords().reviseRunning, p));
  same('revise running (server)', PHASES, (p) => p === 'revising' || p === 'redrafting', (p) => REVISE_PHASES.includes(p));
  // old sites: `phase === "red" || phase === "stopped"` (5954, 7149) and `=== "stopped" || === "red"` (7116)
  same('not green', PHASES, (p) => p === 'red' || p === 'stopped', (p) => PAGE.inWords(pageWords().notGreen, p));
  same('not green reversed', PHASES, (p) => p === 'stopped' || p === 'red', (p) => PAGE.inWords(pageWords().notGreen, p));
});

// ---- am8b item 1: ckTagHtml (the tag column of a check row) takes its tag word from tagWordOf ---------------------------------------------------
import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';
import { PAGE_WORDS_PRELUDE } from './page-words.mjs';

// the old ckTagHtml as it stood before am8b (src/panel/index.html, borrowed from bareloop v0.61.0), frozen
const OLD_CK_TAG = `function ckTagHtml(by){ return '<span class="by tagcol" data-testid="plan-by"' + (by ? ' data-by="' + escapeXml(by) + '"' : "") + ">" + (by ? "[" + escapeXml(by) + "]" : "") + "</span>"; }`;
const ckTag = (src) => new Function(`${PAGE_WORDS_PRELUDE}\n${fnSrc(PAGE_SRC, 'escapeXml', '  ')}\n${fnSrc(PAGE_SRC, 'tagWordOf', '  ')}\n${src}\nreturn ckTagHtml;`)();

test('am8b item 1: the page\'s ckTagHtml draws what it drew on you, agent, default, empty and missing', () => {
  const oldFn = ckTag(OLD_CK_TAG);
  const newFn = ckTag(fnSrc(PAGE_SRC, 'ckTagHtml', '  '));
  for (const by of ['you', 'agent', 'default', '', undefined, null]) assert.equal(newFn(by), oldFn(by), `by = ${JSON.stringify(by)}`);
  assert.match(newFn('you'), />\[you\]<\/span>$/);
});

test('am8b item 1: on a word the server never sends, the new ckTagHtml keeps data-by and draws no text (the old one bracketed it)', () => {
  const oldFn = ckTag(OLD_CK_TAG);
  const newFn = ckTag(fnSrc(PAGE_SRC, 'ckTagHtml', '  '));
  assert.equal(newFn('stranger'), '<span class="by tagcol" data-testid="plan-by" data-by="stranger"></span>');
  assert.notEqual(newFn('stranger'), oldFn('stranger'));
});
