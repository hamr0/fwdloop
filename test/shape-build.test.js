// borrowed-from: bareloop tests/shape-build.test.js@v0.61.0 (fc56e1f3) -- body unedited; only the two imports of shapelook.js and jobblock.js point at test/support (test-only copies, no src/ file)
// Shape jobs (itemShape), clause 2 "Build or refuse" (docs/product/ITEM33-BUILD.md "Addendum 2026-11-18: shape jobs", code rules R1-R5): the builder of the shape of a job line from the AI's typed suggestion.
// Fixtures are written here, in the live reply's shape (the POC's `fields` / `extraFields` / `itemCountFrom`); no bareguard itemShape is needed ($0, no model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShapeLine, buildShapes, boundGrounded, fieldSpec, hasRealBound, NO_FIELD_WHY, NO_BOUND_WHY } from '../src/shapebuild.js';
import { rubricVocabulary } from 'bareguard';
import { SHAPE_KINDS, shapeAvailable, nameWhy, shapeNameRules } from '../src/shapemenu.js';
import { shapeMenuLines } from './support/shapelook-extract.js';

const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: ['missing', 'wrong-type', 'wrong-value'] };
const TRACKER = { n: 1, text: 'List my research items', rules: ['each item has a title', 'status is in progress, closed or finished', 'the summary is under 200 characters'] };
const f = (/** @type {any} */ o) => ({ required: true, bounds: {}, fromRule: null, ...o });
const TRACKER_ANS = {
  fields: [
    f({ name: 'title', kind: 'text', bounds: { minChars: 1 }, fromRule: 1 }),
    f({ name: 'status', kind: 'oneOf', bounds: { values: ['in progress', 'closed', 'finished'] }, fromRule: 2 }),
    f({ name: 'summary', kind: 'text', bounds: { maxChars: 200 }, fromRule: 3 }),
  ],
  extraFields: [f({ name: 'owner', kind: 'text', required: false })],
  itemCountFrom: null,
};

test('the kind menu is named in one place and carries boolean with equals', () => {
  assert.deepEqual([...SHAPE_KINDS.boolean], ['equals']);
  assert.ok(shapeMenuLines().includes('  boolean: bounds equals'));
  assert.ok(!('object' in SHAPE_KINDS), 'object is not offered');
  assert.equal(shapeAvailable(), true, 'bareguard 0.37 carries itemShape');
  // the table is bareguard's own, not a copy: every kind and option is read from its vocabulary
  const k = /** @type {any} */ (rubricVocabulary).rules.itemShape.fields.fields.kinds;
  for (const [kind, opts] of Object.entries(SHAPE_KINDS)) assert.deepEqual([...opts], Object.keys(k[kind]), kind);
  assert.deepEqual(Object.keys(SHAPE_KINDS), Object.keys(k).filter((x) => x !== 'object'));
});

test('every ~ rule maps to one field of the right kind and a grounded bound; a suggested extra field is held out', () => {
  const r = buildShapeLine({ line: TRACKER, labels: ['tracker'], suggestion: TRACKER_ANS, nameRules: NR });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields.filter((x) => x.by === 'you').map((x) => [x.name, x.kind, x.rule]), [['title', 'text', 1], ['status', 'oneOf', 2], ['summary', 'text', 3]]);
  assert.deepEqual(fieldSpec(r.fields[0]), { kind: 'text', required: true, minChars: 1 });
  assert.deepEqual(r.fields[1].bounds.values, ['in progress', 'closed', 'finished']);
  assert.equal(r.fields[2].bounds.maxChars, 199, '"under 200" signs 199, whatever the AI sent');
  const owner = r.fields.find((x) => x.name === 'owner');
  assert.equal(owner?.by, 'agent');
  assert.equal(owner?.held, true, 'R2: no word of owner in the job: Suggested');
  assert.deepEqual(owner?.bounds, {});
  assert.deepEqual(r.rows.map((x) => x.state), ['built', 'built', 'built']);
});

test('R1: a bound is grounded only in the field\'s own rule (200 is in rule 3, not in rule 1)', () => {
  const ans = { fields: [f({ name: 'title', kind: 'text', bounds: { maxChars: 200 }, fromRule: 1 })] };
  const r = buildShapeLine({ line: TRACKER, labels: [], suggestion: ans, nameRules: NR });
  assert.match(r.refused.map((x) => x.why).join('|'), /maxChars 200 is not in your rule for this field/);
  assert.equal(r.fields.length, 0, 'the number is in another rule of the line, so the field has no limit of its own and covers nothing');
  assert.equal(r.rows[0].state, 'not-checked');
  assert.equal(r.rows[0].reason, NO_BOUND_WHY);
});

test('R1: an AI-added field gets no grounded bound, even one that is a number in the job line', () => {
  const line = { n: 1, text: 'List 3 flights', rules: ['the departure time is between 05:00 and 21:59'] };
  const ans = { fields: [f({ name: 'departure', kind: 'time', bounds: { min: '05:00', max: '21:59' }, fromRule: 1 })], extraFields: [f({ name: 'duration', kind: 'text', bounds: { minChars: 3, maxChars: 20 }, required: false })] };
  const r = buildShapeLine({ line, labels: [], suggestion: ans, nameRules: NR });
  const dur = r.fields.find((x) => x.name === 'duration');
  assert.deepEqual(dur?.bounds, {}, 'the "3" of "List 3 flights" and the 21 of 21:59 ground nothing for a field with no rule');
  assert.deepEqual(r.fields[0].bounds, { min: '05:00', max: '21:59' });
});

test('R1 exception: required + minChars 1 on an AI-added field is the spec\'s "each item has a title"', () => {
  const ans = { fields: [f({ name: 'title', kind: 'text', bounds: { minChars: 1 }, fromRule: 1 })], extraFields: [f({ name: 'link', kind: 'text', bounds: { minChars: 1 } })] };
  const line = { n: 1, text: 'List the link of each item', rules: ['each item has a title'] };
  const r = buildShapeLine({ line, labels: [], suggestion: ans, nameRules: NR });
  assert.deepEqual(r.fields.find((x) => x.name === 'link')?.bounds, { minChars: 1 });
});

test('R2: an AI-added field with a word in the job line is job-derived (on, droppable); one with none is Suggested', () => {
  const line = { n: 1, text: 'List the flights with the airline', rules: ['the price is under 450'] };
  const ans = { fields: [f({ name: 'price', kind: 'money', bounds: { lt: 450 }, fromRule: 1 })], extraFields: [f({ name: 'airline', kind: 'text' }), f({ name: 'duration', kind: 'text' })] };
  const r = buildShapeLine({ line, labels: [], suggestion: ans, nameRules: NR });
  assert.equal(r.fields.find((x) => x.name === 'airline')?.held, false);
  assert.equal(r.fields.find((x) => x.name === 'duration')?.held, true);
});

test('R3: oneOf keeps each grounded value and drops only the ungrounded ones', () => {
  const ans = { fields: [f({ name: 'status', kind: 'oneOf', bounds: { values: ['in progress', 'closed', 'archived'] }, fromRule: 2 })] };
  const r = buildShapeLine({ line: TRACKER, labels: [], suggestion: ans, nameRules: NR });
  assert.deepEqual(r.fields[0].bounds.values, ['in progress', 'closed']);
  assert.match(r.refused.map((x) => x.why).join('|'), /"archived" is not in your rule/);
});

test('R4: an item count is signed only for real labels the person\'s words say "per" or "each"', () => {
  const line = { n: 1, text: 'Read each resume against the job description', rules: ['one blurb per resume', 'the blurb is under 60 words'] };
  const ans = { fields: [f({ name: 'blurb', kind: 'text', bounds: { maxWords: 60 }, fromRule: 2 })], itemCountFrom: ['resume-1', 'resume-2'] };
  const labels = ['job-description', 'resume-1', 'resume-2'];
  const ok = buildShapeLine({ line, labels, suggestion: ans, nameRules: NR });
  assert.deepEqual(ok.itemCount, { labels: ['resume-1', 'resume-2'], n: 2 });
  const wrong = buildShapeLine({ line, labels, suggestion: { ...ans, itemCountFrom: ['job-description'] }, nameRules: NR });
  assert.equal(wrong.itemCount, null, '"job-description" is not said as "per job-description"');
  const unreal = buildShapeLine({ line, labels, suggestion: { ...ans, itemCountFrom: ['resume-9'] }, nameRules: NR });
  assert.equal(unreal.itemCount, null);
  assert.match(unreal.refused.map((x) => x.why).join('|'), /"resume-9" is not an input of this job/);
  const unsaid = buildShapeLine({ line: { ...line, text: 'Read the resumes' , rules: ['the blurb is under 60 words'] }, labels, suggestion: { ...ans, fields: [f({ name: 'blurb', kind: 'text', bounds: { maxWords: 60 }, fromRule: 1 })] }, nameRules: NR });
  assert.equal(unsaid.itemCount, null, 'the AI\'s "one item per input" is not the person\'s words');
});

test('R5: equals only on a field with its own rule, only true or false', () => {
  const line = { n: 1, text: 'List 3 flights with the airline', rules: ['the flight is nonstop'] };
  const ok = buildShapeLine({ line, labels: [], suggestion: { fields: [f({ name: 'nonstop', kind: 'boolean', bounds: { equals: true }, fromRule: 1 })] }, nameRules: NR });
  assert.deepEqual(ok.fields[0].bounds, { equals: true });
  assert.deepEqual(fieldSpec(ok.fields[0]), { kind: 'boolean', required: true, equals: true });
  const own = { fields: [f({ name: 'nonstop', kind: 'boolean', bounds: {}, fromRule: 1 })], extraFields: [f({ name: 'airline', kind: 'boolean', bounds: { equals: true } })] };
  const a = buildShapeLine({ line, labels: [], suggestion: own, nameRules: NR });
  assert.deepEqual(a.fields.find((x) => x.name === 'airline')?.bounds, {}, 'an AI-added field never gets equals');
  assert.equal(a.fields.some((x) => x.name === 'nonstop'), false, 'a yes/no field with no `equals` has no limit: it covers nothing');
  const s = buildShapeLine({ line, labels: [], suggestion: { fields: [f({ name: 'nonstop', kind: 'boolean', bounds: { equals: 'true' }, fromRule: 1 })] }, nameRules: NR });
  assert.equal(s.fields.length, 0, 'the string "true" is not a boolean: no bound left, the rule stays Not checked');
});

test('the menu check: kind, a bound the kind does not list, and a bound of the wrong type are refused with their reason', () => {
  const r = buildShapeLine({ line: TRACKER, labels: [], nameRules: NR, suggestion: { fields: [
    f({ name: 'title', kind: 'text', bounds: { equals: true, minChars: 'one' }, fromRule: 1 }),
    f({ name: 'status', kind: 'enum', bounds: {}, fromRule: 2 }),
    f({ name: 'summary', kind: 'object', fromRule: 3 }),
  ] } });
  const why = r.refused.map((x) => x.why).join(' | ');
  assert.match(why, /equals is not a bound of a text field/);
  assert.match(why, /minChars must be a whole number/);
  assert.match(why, /enum is not a field kind on the menu/);
  assert.match(why, /a nested object field is not offered yet/);
  assert.equal(r.rows[1].state, 'not-checked');
  assert.match(String(r.rows[1].reason), /field refused: enum is not a field kind/);
  assert.equal(r.rows[2].state, 'not-checked');
});

test('the name check: no . : [ ], at most 128 characters, not a reserved reason word, not twice', () => {
  for (const bad of ['a.b', 'a:b', 'a[0]', 'a]', 'x'.repeat(129), '', '  ', 'wrong-value', 'missing']) {
    const r = buildShapeLine({ line: TRACKER, labels: [], nameRules: NR, suggestion: { fields: [f({ name: bad, kind: 'text', fromRule: 1 })] } });
    assert.equal(r.fields.length, 0, `"${bad}" is refused`);
    assert.equal(r.ok, false);
  }
  assert.equal(nameWhy('x'.repeat(128), NR), null);
  const twice = buildShapeLine({ line: TRACKER, labels: [], nameRules: NR, suggestion: { fields: [f({ name: 'title', kind: 'text', bounds: { minChars: 1 }, fromRule: 1 }), f({ name: 'title', kind: 'text', bounds: { minChars: 1 }, fromRule: 3 })] } });
  assert.equal(twice.fields.length, 1);
});

test('the name rules are bareguard\'s own and the reserved-word refusal is ON (wrong-value included)', () => {
  const live = shapeNameRules();
  const IS = /** @type {any} */ (rubricVocabulary).rules.itemShape.fields.fields;
  assert.deepEqual(live.reserved, IS.reservedNames);
  assert.ok(live.reserved?.includes('wrong-value'));
  assert.deepEqual(live.forbidden, IS.nameForbiddenChars);
  assert.equal(live.max, IS.nameMaxLength);
  for (const bad of ['wrong-value', 'missing', 'count-under', 'duplicate']) assert.match(String(nameWhy(bad)), /the checker uses for its own gaps/);
  const r = buildShapeLine({ line: TRACKER, labels: [], suggestion: { fields: [f({ name: 'wrong-value', kind: 'text', fromRule: 1 })] } });
  assert.equal(r.fields.length, 0);
  assert.equal(r.reservedChecked, true);
});

test('a rule no field holds is Not checked with the no-pick sentence; two fields for one rule keep the first', () => {
  const r = buildShapeLine({ line: TRACKER, labels: [], nameRules: NR, suggestion: { fields: [f({ name: 'title', kind: 'text', bounds: { minChars: 1 }, fromRule: 1 }), f({ name: 'heading', kind: 'text', bounds: { minChars: 1 }, fromRule: 1 })] } });
  assert.deepEqual(r.fields.map((x) => x.name), ['title']);
  assert.equal(r.rows[1].reason, NO_FIELD_WHY);
});

test('list fields: `of` is an entry spec whose bounds are grounded in the same rule; a list of lists is refused', () => {
  const line = { n: 1, text: 'List the words', rules: ['matching words is a list of at most 5 words, each under 40 characters'] };
  const ans = { fields: [f({ name: 'matching', kind: 'list', fromRule: 1, bounds: { of: { kind: 'text', maxChars: 40 }, maxEntries: 5 } })] };
  const r = buildShapeLine({ line, labels: [], suggestion: ans, nameRules: NR });
  assert.deepEqual(r.fields[0].bounds, { of: { kind: 'text', maxChars: 39 }, maxEntries: 5 }, '"each under 40" signs 39; "at most 5" signs 5');
  const nested = buildShapeLine({ line, labels: [], suggestion: { fields: [f({ name: 'm', kind: 'list', fromRule: 1, bounds: { of: { kind: 'list' } } })] }, nameRules: NR });
  assert.equal(nested.fields.length, 0, 'a list of lists is refused, and a list with no limit covers nothing');
  const str = buildShapeLine({ line, labels: [], suggestion: { fields: [f({ name: 'm', kind: 'list', fromRule: 1, bounds: { of: 'text', maxEntries: 5 } })] }, nameRules: NR });
  assert.deepEqual(str.fields[0].bounds, { of: { kind: 'text' }, maxEntries: 5 }, 'the POC\'s string form is read as {kind}');
});

test('boundGrounded: an upper bound may be the written number minus one; a lower bound only the written number', () => {
  assert.equal(boundGrounded('maxWords', 59, 'under 60 words'), true);
  assert.equal(boundGrounded('minWords', 59, 'under 60 words'), false);
  assert.equal(boundGrounded('max', 449.99, 'under 450'), true, 'its ceiling is the written 450');
  assert.equal(boundGrounded('max', 300, 'under 450'), false);
  assert.equal(boundGrounded('values', 'closed', 'status is Closed or open'), true);
});

test('buildShapes routes each suggestion by its own line; a line with no suggestion or no rule field has no shape', () => {
  const lines = [TRACKER, { n: 2, text: 'Summarize', rules: ['one sentence'] }];
  const out = buildShapes({ lines, labels: [], nameRules: NR, suggestions: [
    { line: 1, ...TRACKER_ANS }, { line: 7, fields: [] }, 'nope',
    { line: 2, fields: [f({ name: 'x', kind: 'enum', fromRule: 1 })] },
  ] });
  assert.deepEqual(Object.keys(out.built), ['1']);
  assert.ok(out.refused.some((x) => x.line === null && x.helper === 'schema'));
  assert.ok(out.refused.some((x) => x.line === 7 && /not a line a shape can be offered for/.test(x.why)));
  assert.ok(out.refused.some((x) => x.line === 2));
});

test('the law of the words (code signs it, whatever the AI sent): under N = N-1 for counts and `lt: N` for numbers; at most N = N', () => {
  const sign = (/** @type {string} */ rule, /** @type {string} */ kind, /** @type {any} */ bounds) => buildShapeLine({ line: { n: 1, text: 'List things', rules: [rule] }, labels: [], nameRules: NR, suggestion: { fields: [f({ name: 'x', kind, bounds, fromRule: 1 })] } }).fields[0]?.bounds;
  for (const sent of [199, 200]) assert.deepEqual(sign('the summary is under 200 characters', 'text', { maxChars: sent }), { maxChars: 199 }, `AI sent ${sent}`);
  for (const sent of [60, 59]) assert.deepEqual(sign('at most 60 words', 'text', { maxWords: sent }), { maxWords: 60 }, `at most: AI sent ${sent}`);
  assert.deepEqual(sign('fewer than 6 words', 'text', { maxWords: 6 }), { maxWords: 5 });
  assert.deepEqual(sign('less than 4 entries', 'list', { maxEntries: 4, of: 'text' }), { maxEntries: 3, of: { kind: 'text' } });
  assert.deepEqual(sign('the price is below 450', 'number', { max: 450 }), { lt: 450 }, 'a number: the exclusive form');
  assert.deepEqual(sign('the price is under 450', 'number', { lt: 450 }), { lt: 450 });
  assert.deepEqual(sign('the price is under 450', 'number', { max: 449.99 }), { lt: 450 });
  assert.deepEqual(sign('the price is up to 450', 'number', { lt: 450 }), { max: 450 }, 'at most: inclusive');
  assert.deepEqual(sign('no more than 450', 'number', { max: 449 }), { max: 450 });
  assert.deepEqual(sign('the summary is at most 200 characters', 'text', { maxChars: 200 }), { maxChars: 200 });
  assert.deepEqual(sign('the summary has 200 characters', 'text', { maxChars: 200 }), { maxChars: 200 }, 'no direction word: the AI\'s bound stands');
});

// ---- the real shapes DeepSeek proposed in scope round 2 (tests/fixtures/shape-scope/round2-raw-shapes.json, raw answers of the archived drafts smvh566bnsgno airbnb, smvqz6h1bnc5k dell, smwezme3y35id flights) ----
import { readFileSync as readFx } from 'node:fs';
import { parseJobBlock } from './support/jobblock.js';
const RAW = JSON.parse(readFx(new URL('./fixtures/shape-scope/round2-raw-shapes.json', import.meta.url), 'utf8'));
const lineOf = (/** @type {string} */ k) => /** @type {any} */ (parseJobBlock(RAW[k].jobText)).lines[0];

test('REAL airbnb shape: "~ under \u20ac200 total" got `stay: text, required` with no bound: it covers NOTHING, the rule stays Not checked with the no-limit sentence', () => {
  const r = buildShapeLine({ line: lineOf('airbnb'), labels: ['stays'], suggestion: RAW.airbnb.rawShape[0] });
  assert.equal(r.fields.some((x) => x.by === 'you'), false);
  assert.equal(r.rows[0].state, 'not-checked');
  assert.equal(r.rows[0].reason, NO_BOUND_WHY);
  assert.equal(r.ok, false, 'no rule field: the line is no shape line');
});

test('REAL dell shape: `price` money with currency "EUR" is refused by bareguard (it takes a sign), told in plain words for THAT field; with the sign it is built and covers the rule', () => {
  const raw = RAW.dell.rawShape[0];
  const bad = buildShapeLine({ line: lineOf('dell'), labels: ['page'], suggestion: raw });
  assert.equal(bad.fields.some((x) => x.by === 'you'), false);
  assert.match(bad.rows[0].reason ?? '', /^field refused: price: currency must be one of "\$", "\u20ac", "\u00a3"$/);
  const fixed = JSON.parse(JSON.stringify(raw));
  fixed.fields.find((/** @type {any} */ x) => x.name === 'price').bounds.currency = '\u20ac';
  const ok = buildShapeLine({ line: lineOf('dell'), labels: ['page'], suggestion: fixed });
  assert.deepEqual(ok.fields.find((x) => x.name === 'price')?.bounds, { currency: '\u20ac', lt: 1500 });
  assert.equal(ok.rows[0].state, 'built');
});

test('hasRealBound: a number, a count, one-of values, a yes/no value or an entry bound is a bound; a currency, a unit or how a number is read is not', () => {
  for (const b of [{ lt: 1500 }, { minChars: 1 }, { maxWords: 5 }, { values: ['a'] }, { equals: false }, { maxEntries: 2 }, { of: { kind: 'text', maxChars: 4 } }, { currency: '\u20ac', max: 3 }]) assert.equal(hasRealBound(b), true, JSON.stringify(b));
  for (const b of [{}, { currency: '\u20ac' }, { unit: 'euros' }, { fromText: true }, { unique: true }, { of: { kind: 'text' } }, { ignoreCase: true }]) assert.equal(hasRealBound(b), false, JSON.stringify(b));
});
