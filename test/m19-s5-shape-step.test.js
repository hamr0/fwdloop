// M19 S5 (docs/wiki/the-module-ladder.md, M19 piece S5, amendments B and E): a line that holds a shape part is signed as `close.itemShape` (never `close.shape`), told its fields and one example item by code, answers through
// emit_artifact with `results`, and is closed by ONE bareguard itemShape check over `results`; on a facts+shape line it is closed and sits beside `cited`. $0, fake provider, no key. The fixtures are bareloop v0.61.0's
// tests/fixtures/shape-combined (copied from the tag); the scenarios are the ones of bareloop tests/shape-combined.test.js, run through fwd's closer (tests/shape-combined.test.js needs the tag's gradeStep, which fwd has not).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { closeByClass } from '../src/closers.js';
import { buildShapePart, shapeItemCheck } from '../src/shaperows.js';
import { shapeBriefOf, shapeLineBrief } from '../src/rubricstep.js';
import { buildEmitArtifactSchema, makeLiveModelStep } from '../src/model-step.js';
import { CheckBlock } from '../src/checkblock.js';
import { buildShapes } from '../src/shapebuild.js';
import { assembleFromBlock } from '../src/blockassemble.js';
import { checkListReds } from '../src/checklistsign.js';
import { parseSignedText } from '../src/signed-text.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { validateDeclaration } from '../src/declaration.js';

const fx = (/** @type {string} */ n) => readFileSync(new URL(`./fixtures/shape-combined/${n}`, import.meta.url), 'utf8');
const TAG = buildShapePart({ text: 'the items of line 1', fields: [{ name: 'tag', spec: { kind: 'oneOf', required: true, values: ['a', 'b'] }, rule: 2, by: 'you' }] });
const itemShape = { fields: TAG.fields };
const FAKE = 'this sentence is not anywhere on the saved page';

async function close(/** @type {string} */ name, /** @type {(a: any) => void} */ mutate = () => {}, withShape = true) {
  const c = JSON.parse(fx(`${name}.part.json`));
  const input = fx(`${name}.input.txt`);
  const answer = JSON.parse(fx(`${name}.answer.json`));
  for (const it of answer.results) it.tag = 'a';
  answer.done = true; answer.blocker = null;
  mutate(answer);
  const cited = { source: c.part.source, facts: c.part.facts, ...(c.part.count ? { count: c.part.count } : {}) };
  return closeByClass({ fromLine: 1, close: { class: 'green', cited, ...(withShape ? { itemShape } : {}) } }, answer, { reads: {}, businessDate: '2026-11-20', source: { ok: true, text: input, sha256: createHash('sha256').update(input).digest('hex') } });
}

test('V4, an extra key inside values, is reported ONCE, by itemShape alone (cited reads claims built from the signed fact names and never sees it)', async () => {
  const g = await close('flights-3', (a) => { a.results[0].values.extra = 'x'; });
  assert.equal(g.verdict, 'red');
  assert.deepEqual((g.shapeGaps ?? []).map((/** @type {any} */ x) => x.check), ['itemShape']);
  assert.deepEqual(g.shapeGaps?.[0].items, ['#0:values:unknown-field:extra']);
  assert.equal(g.red, 'line 1: item 1: "values" has a field "extra" that the job does not ask for');
});

test('V3, a bad shape field AND a made-up quote on item 0: exactly TWO gaps, one from each check, each in plain words', async () => {
  const g = await close('flights-3', (a) => { a.results[0].tag = 'z'; a.results[0].quote = FAKE; });
  assert.equal(g.verdict, 'red');
  assert.equal(g.reds?.length, 2, JSON.stringify(g.reds));
  assert.match(String(g.reds?.[0]), /result 1: the quote is not found word for word/);
  assert.equal(g.reds?.[1], 'line 1: item 1: "tag" is not one of the allowed values');
});

test('each fault has one owner: a bad tag reds itemShape only; a made-up quote reds cited only; a missing tag and an unlisted key red itemShape only', async () => {
  const bad = await close('flights-3', (a) => { a.results[0].tag = 'z'; });
  assert.equal(bad.reds?.length, 1); assert.equal(bad.shapeGaps?.length, 1);
  const q = await close('flights-3', (a) => { a.results[0].quote = FAKE; });
  assert.equal(q.verdict, 'red'); assert.equal(q.shapeGaps, undefined);
  assert.deepEqual((await close('flights-3', (a) => { delete a.results[1].tag; })).shapeGaps?.map((/** @type {any} */ x) => x.items), [['#1:tag:missing']]);
  assert.deepEqual((await close('flights-3', (a) => { a.results[0].note = 'x'; })).shapeGaps?.map((/** @type {any} */ x) => x.items), [['#0:unknown-field:note']]);
  assert.equal((await close('flights-3')).verdict, 'green');
});

test('a line with no itemShape is closed as before: the cited close alone, no shapeGaps', async () => {
  const g = await close('flights-3', (a) => { a.results[0].values.extra = 'x'; a.results[0].tag = 'z'; }, false);
  assert.equal(g.verdict, 'green');
  assert.equal(g.shapeGaps, undefined);
});

test('the real dell answer through the items check alone is green, and its extra key is told once (the dell prices are decimal-comma, which fwd\'s fact check does not read: F228)', async () => {
  const c = JSON.parse(fx('dell-1.part.json'));
  const answer = JSON.parse(fx('dell-1.answer.json'));
  for (const it of answer.results) it.tag = 'a';
  const only = { fromLine: 1, close: { class: 'green', itemShape: { fields: [{ name: 'quote', spec: { kind: 'text', required: true } }, { name: 'values', spec: { kind: 'object', required: true, fields: Object.fromEntries(c.part.facts.map((/** @type {any} */ f) => [f.name, f.shape === 'money' ? { kind: 'number', fromText: true } : { kind: 'text' }])) } }, ...TAG.fields] } } };
  assert.equal((await closeByClass(only, { ...answer, done: true, blocker: null }, { reads: {}, businessDate: 'x' })).verdict, 'green');
  answer.results[0].values.extra = 'x';
  const v = await closeByClass(only, answer, { reads: {}, businessDate: 'x' });
  assert.equal(v.verdict, 'red'); assert.equal(v.shapeGaps?.length, 1);
});

test('the whole-field gaps, in fwd\'s words (the answer, not a file): no results, not a list, too few, too many', async () => {
  const step = { fromLine: 2, close: { class: 'green', itemShape: { fields: TAG.fields, minItems: 2, maxItems: 3 } } };
  const run = (/** @type {any} */ a) => closeByClass(step, a, { reads: {}, businessDate: 'x' });
  assert.equal((await run({ done: true })).red, 'line 2: the answer has no "results" list — give a list of items, one object per item');
  assert.equal((await run({ results: 'x' })).red, 'line 2: "results" in the answer is not a list (it is type:string) — give a list of items');
  assert.equal((await run({ results: [{ tag: 'a' }] })).red, 'line 2: "results" lists 1 item(s), at least 2 are required');
  assert.equal((await run({ results: [{ tag: 'a' }, { tag: 'a' }, { tag: 'a' }, { tag: 'a' }] })).red, 'line 2: "results" lists 4 item(s), at most 3 are allowed');
  assert.equal((await run('not an object')).verdict, 'unparseable');
});

test('the merged itemShape is CLOSED and lists the cited keys: quote (text, required), values (one optional field per signed fact; number from text for money), no claim; the count stays with the fact part', () => {
  const c = JSON.parse(fx('flights-3.part.json'));
  const check = shapeItemCheck(TAG, 'p2-shape', c.part);
  assert.deepEqual(Object.keys(check.fields), ['quote', 'values', 'tag']);
  assert.deepEqual(check.fields.values.fields.price, { kind: 'number', fromText: true });
  assert.equal(Object.hasOwn(check, 'minItems'), false);
});

test('amendment B: the brief of a shape-only line is the signed first line, the fields in plain words and one example item; nothing else', () => {
  const part = buildShapePart({ text: 't', fields: [{ name: 'title', spec: { kind: 'text', required: true, minChars: 1 }, rule: 1, by: 'you' }, { name: 'summary', spec: { kind: 'text', required: false, maxChars: 200 }, rule: 2, by: 'you' }], itemCount: { n: 3 } });
  const lines = shapeLineBrief(2, part).split('\n');
  assert.equal(lines[0], 'Job line 2 is a LIST line. Call emit_artifact exactly once with this step\'s result: {"results": [{...}, {...}]} — no "text", no "cites". One object per item: exactly 3 items.');
  assert.equal(lines[1], '  Every item has these fields, named exactly as written (a field marked optional may be left out when it does not apply):');
  assert.equal(lines[2], '    - title: not empty');
  assert.equal(lines[3], '    - summary: at most 200 characters (optional)');
  assert.match(lines[4], /^ {2}One example item: \{"title":".*","summary":".*"\}$/);
  assert.equal(lines[5], '  Write each value as plain text or a plain number or yes/no (true or false) as the field says, never as a sentence about the value.');
  assert.equal(lines.length, 6);
  assert.match(shapeLineBrief(1, part, true).split('\n')[0], /^Job line 1 is a TEXT line AND a LIST line\. Call emit_artifact exactly once with this step's result: \{"text": "\.\.\.", "results": \[\{\.\.\.\}, \{\.\.\.\}\]\}: "text" as for any text line, and "results" is the list of items\. One object per item: exactly 3 items\.$/);
  assert.match(shapeLineBrief(1, { ...part, minItems: undefined, maxItems: undefined }).split('\n')[0], /One object per item: one item for every one you find\.$/);
  const c = JSON.parse(fx('flights-3.part.json'));
  const extra = shapeBriefOf(TAG, c.part);
  assert.equal(extra[0], '  Each result ALSO carries these fields (named exactly as written; a field marked optional may be left out when it does not apply):');
  assert.equal(extra[1], '    - tag: one of: a, b');
  assert.deepEqual(Object.keys(JSON.parse(/One example result: (\{.*\})/.exec(extra[2])?.[1] ?? 'null')), ['quote', 'values', 'tag']);
});

/** the one user message and the tool schema a step call sends */
async function sent(/** @type {any} */ stepMeta) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-s5-'));
  try {
    /** @type {any[]} */ const seen = [];
    const provider = { generate: async (/** @type {any} */ messages, /** @type {any} */ tools) => { seen.push({ messages, tools }); return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: [], done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' }; } };
    const step = makeLiveModelStep({ spendPath: path.join(dir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    await step({ goal: 'List my items', primitives: [], reads: { notes: { kind: 'text', text: 'page' } }, gap: null }, {}, stepMeta);
    return { user: JSON.parse(seen[0].messages.find((/** @type {any} */ m) => m.role === 'user').content), tools: seen[0].tools };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('amendment B through the real step call: a shape-only step is told the fields under `answering` and answers `results` with done and blocker; a facts+shape step is told them beside its fact brief; nothing else is added', async () => {
  const only = await sent({ class: 'softgreen', itemShape: TAG, line: 1, attempt: 1, step: 's' });
  assert.deepEqual(Object.keys(only.user).sort(), ['answering', 'gap', 'goal', 'reads']);
  assert.equal(only.user.answering, shapeLineBrief(1, TAG));
  const schema = JSON.stringify(only.tools);
  assert.match(schema, /"results"/); assert.match(schema, /"done"/); assert.match(schema, /"blocker"/); assert.doesNotMatch(schema, /"quote"/);
  const c = JSON.parse(fx('flights-3.part.json'));
  const both = await sent({ class: 'green', cited: c.part, itemShape: TAG, line: 1, attempt: 1, step: 's' });
  assert.deepEqual(both.user.quoting.eachResultAlso, shapeBriefOf(TAG, c.part));
  assert.deepEqual(Object.keys(both.user.quoting).sort(), ['answer', 'eachResultAlso', 'eachResultHolds', 'howMany']);
  assert.equal(JSON.stringify(both.user).includes('must fail'), false);
  assert.deepEqual(buildEmitArtifactSchema('green', true).required, ['results', 'done'], 'the cited schema is what it was');
});

const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: null };
const TEXT = 'Resume of Ada. Skills: python, sql. Resume of Alan. Skills: logic.';
const LINES = [{ n: 1, text: 'Write one summary per page', rules: ['Skills', 'the blurb is under 60 words'] }];
const f = (/** @type {any} */ o) => ({ required: true, bounds: {}, fromRule: null, ...o });
function blockWith(/** @type {boolean} */ fact) {
  const b = new CheckBlock({ texts: { page: TEXT }, labels: ['page'], asks: false, split: true });
  b.fromJob(LINES);
  if (fact) b.addLook([{ name: 'skills', shape: 'phrase', phrase: 'Skills', words: ['Skills'], line: 1, source: 'page', forRule: 1, from: 'rule 1' }]);
  b.setGuards(['changed-from-seed'], ['output/']);
  b.reconcile();
  b.setShape(buildShapes({ lines: LINES, labels: ['page'], suggestions: [{ line: 1, fields: [f({ name: 'blurb', kind: 'text', bounds: { maxWords: 59 }, fromRule: 2 })], extraFields: [], itemCountFrom: [] }], nameRules: NR }));
  return b;
}
const decl = () => ({ steps: [{ goal: 'Write one summary per page', primitives: [], reads: ['page'], emits: 'a', fromLine: 1, close: { class: 'hitl' } }], guardrailClasses: {} });
const assemble = (/** @type {any} */ b, /** @type {any} */ cls) => assembleFromBlock({ declaration: decl(), block: b, lines: [{ n: 1, guardrail: 'Skills; the blurb is under 60 words' }], lineSet: new Set([1]), ...(cls === undefined ? {} : { shapeOnlyClass: cls }) });

test('assembly: a facts+shape line keeps its class (green, cited plus itemShape, never close.shape); the signed rows point at both checks', () => {
  for (const cls of [undefined, 'softgreen', 'green']) {
    const out = assemble(blockWith(true), cls);
    const close = out.declaration.steps[0].close;
    assert.equal(close.class, 'green');
    assert.equal(close.cited.source, 'page');
    assert.deepEqual(close.itemShape.fields.map((/** @type {any} */ x) => x.name), ['blurb']);
    assert.equal(Object.hasOwn(close, 'shape'), false, 'amendment E: never close.shape');
    assert.deepEqual(checkListReds(out.declaration), []);
    assert.deepEqual(out.declaration.checkList.filter((/** @type {any} */ r) => r.kind === 'rule').map((/** @type {any} */ r) => r.part), [{ line: 1, part: 0 }, { line: 1, part: 1 }]);
  }
});

test('assembly, M19 am1 item 1 (O1): a shape-only line signs class green with itemShape and no cited, never softgreen and never Not checked; the unruled switch (null) still signs none', () => {
  const out = assemble(blockWith(false));
  const close = out.declaration.steps[0].close;
  assert.equal(close.class, 'green');
  assert.equal(Object.hasOwn(close, 'cited'), false);
  assert.deepEqual(close.itemShape.fields.map((/** @type {any} */ x) => x.name), ['blurb']);
  assert.equal(out.declaration.guardrailClasses['1'], 'green');
  assert.deepEqual(checkListReds(out.declaration), []);
  const shapeRow = out.declaration.checkList.find((/** @type {any} */ r) => r.kind === 'rule' && r.state === 'built');
  assert.ok(shapeRow, 'the list-of-items row is signed built, not Not checked');
  assert.equal(out.notChecked.some((/** @type {string} */ l) => /the items of line 1|blurb/.test(l)), false);
  const none = assemble(blockWith(false), null);
  assert.deepEqual(none.declaration.steps[0].close, { class: 'hitl' });
  assert.deepEqual(none.declaration.checkList.filter((/** @type {any} */ r) => r.kind === 'rule').map((/** @type {any} */ r) => [r.state, r.reason]), [['not-checked', 'No rule can check this, so you judge it at Accept.'], ['not-checked', 'No rule can check this, so you judge it at Accept.']]);
});

test('M19 am1 item 2 (Must-fail 2): on an assembled shape-only line a person\'s 5-word pick still reds a 10-word text, and the items are still read', async () => {
  const LN = [{ n: 1, text: 'Write one summary per page', rules: ['the blurb is under 60 words', 'at most 5 words'] }];
  const b = new CheckBlock({ texts: { page: TEXT }, labels: ['page'], asks: false, split: true });
  b.fromJob(LN);
  b.carry({ picks: [{ line: 1, rule: 2, check: { rule: 'maxWords', value: 5 } }], left: [] });
  b.setGuards(['changed-from-seed'], ['output/']);
  b.reconcile();
  b.setShape(buildShapes({ lines: LN, labels: ['page'], suggestions: [{ line: 1, fields: [f({ name: 'blurb', kind: 'text', bounds: { maxWords: 59 }, fromRule: 1 })], extraFields: [], itemCountFrom: [] }], nameRules: NR }));
  const out = assembleFromBlock({ declaration: decl(), block: b, lines: [{ n: 1, guardrail: 'the blurb is under 60 words; at most 5 words' }], lineSet: new Set([1]) });
  const step = out.declaration.steps[0];
  assert.equal(step.close.class, 'green');
  assert.equal(Object.hasOwn(step.close, 'cited'), false);
  assert.deepEqual(step.close.picked, [{ rule: 'maxWords', value: 5 }]);
  assert.deepEqual(checkListReds(out.declaration), []);
  const ctx = { reads: {}, businessDate: '2026-11-20' };
  const ten = 'one two three four five six seven eight nine ten';
  const bad = await closeByClass(step, { text: ten, results: [{ blurb: 'fine' }], done: true, blocker: null }, ctx);
  assert.equal(bad.verdict, 'red');
  assert.match(String(bad.red), /words/i);
  const good = await closeByClass(step, { text: 'one two three', results: [{ blurb: 'fine' }], done: true, blocker: null }, ctx);
  assert.equal(good.verdict, 'green');
  const badItem = await closeByClass(step, { text: 'one two three', results: [{ blurb: 7 }], done: true, blocker: null }, ctx);
  assert.equal(badItem.verdict, 'red', 'the items are still read beside the pick');
});

const prose = 'guardrail: each item has a tag';
const signed = parseSignedText(`1. List my research items,\n   ${prose},\n2. ask 30m: check it with me,\n   guardrail: nothing goes out before I accept\n3. and once I accept, write it out.\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $0.25 per run\nguardrail: send at line 3 to file:poc/m0/out\nguardrail: source notes = page:https://example.com/notes\n`);
const cat = loadCatalogue();
const check = (/** @type {any} */ close) => validateDeclaration({
  steps: [
    { goal: /** @type {any} */ (signed).lines[0].text, primitives: [], reads: ['notes'], emits: 'items', fromLine: 1, close },
    { goal: /** @type {any} */ (signed).lines[1].text, primitives: [], reads: ['items'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { goal: /** @type {any} */ (signed).lines[2].text, primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: close.class, 2: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {},
}, { arbiter: /** @type {any} */ (signed).arbiter, lines: /** @type {any} */ (signed).lines, catalogue: /** @type {any} */ (cat).primitives, wired: WIRED_VERBS, verbatimGoals: false, fitJobLine: true });
const reds = (/** @type {any} */ r) => (r.ok ? [] : r.reds);

test('the declaration door: itemShape is a close key of its own; a bad shape, a text check beside it on a softgreen line, a hitl class and a list written into close.shape are refused', () => {
  assert.deepEqual(reds(check({ class: 'softgreen', itemShape })), []);
  assert.deepEqual(reds(check({ class: 'green', itemShape })), []);
  assert.match(reds(check({ class: 'softgreen', itemShape: { fields: [] } })).join('|'), /a non-empty list of fields/);
  assert.match(reds(check({ class: 'softgreen', itemShape: { fields: [...TAG.fields, ...TAG.fields] } })).join('|'), /used twice/);
  assert.match(reds(check({ class: 'softgreen', itemShape: { ...itemShape, extra: 1 } })).join('|'), /"extra" is not a field of a list-of-items check/);
  assert.match(reds(check({ class: 'softgreen', itemShape, shape: { maxWords: 5 } })).join('|'), /cannot also carry a text check/);
  assert.match(reds(check({ class: 'hitl', itemShape })).join('|'), /itemShape/);
  assert.match(reds(check({ class: 'softgreen', shape: { fields: TAG.fields } })).join('|'), /close\.shape/, 'a list of items written into close.shape is refused');
});

test('M19 am1 item 3 (Must-fail 3): a green line with neither cited nor itemShape that reads no cells is still refused by am8\'s words; with itemShape it is not', () => {
  const r = check({ class: 'green' });
  assert.equal(r.ok, false);
  assert.match(reds(r).join('|'), /Line 1's check needs cells, but it reads only/);
  assert.deepEqual(reds(check({ class: 'green', itemShape })), []);
});
