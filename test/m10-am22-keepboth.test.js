// M10 am22 (docs/wiki/the-module-ladder.md): a fact line keeps the checks the person picked. $0 tests; each must-fail case was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignedText } from '../src/signed-text.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { validateDeclaration } from '../src/declaration.js';
import { parseMapAnswer } from '../src/pagemap.js';
import { applyPageWords, lookFactOf } from '../src/pagelook.js';
import { PAGE, raw, JOB } from './fixtures/m10-map/load.mjs';
import { closeByClass } from '../src/closers.js';
import { sha256Text } from '../src/citedcheck.js';
import { scopedRules, settleRules, applyPicks } from '../src/checkpick.js';

const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR&hl=en&curr=USD';
const prose = (guard = 'under $150; departure time between 05:00 and 23:59; nonstop') => `1. List 3 flights from Amsterdam to London,
   guardrail: ${guard}
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`;
const signed = parseSignedText(prose());
assert.equal(signed.ok, true);
const cat = loadCatalogue();
assert.equal(cat.ok, true);

/** the page-read of one saved F71 draft: what the map KEPT and DROPPED, as the drafter keeps it */
function lookOf(n) {
  const p = parseMapAnswer(raw(n));
  const r = applyPageWords(PAGE, /** @type {any} */ (p).mapping, JOB);
  return { facts: r.facts.map((f) => lookFactOf(f, 'flights')), dropped: r.dropped.map((d) => ({ ...d, source: 'flights' })) };
}
/** the facts a careful drafter writes for draft 3's look */
const goodFacts = () => [
  { name: 'origin airport', shape: 'phrase', phrase: 'Leaves Amsterdam Airport Schiphol' },
  { name: 'destination airport', shape: 'phrase', phrase: 'arrives at Heathrow Airport' },
  { name: 'price', shape: 'money', anchor: 'From', unit: ['US dollars'], rule: { op: 'lt', value: 150 } },
  { name: 'departure time', shape: 'time', anchor: 'Departure time:', rule: { op: 'between', lo: '05:00', hi: '23:59' } },
  { name: 'nonstop', shape: 'phrase', phrase: 'Nonstop' },
];
const decl = (cited, over = {}) => ({
  steps: [
    { goal: signed.lines[0].text, primitives: [], reads: ['flights'], emits: 'flights_found', fromLine: 1, close: { class: 'green', cited }, ...over },
    { goal: signed.lines[1].text, primitives: [], reads: ['flights_found'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { goal: signed.lines[2].text, primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'green', 2: 'hitl' },
  unjudgeable: {},
  refused: [],
  inputFacts: {},
});
const part = (facts = goodFacts(), count = { min: 3, max: 3 }) => ({ source: 'flights', facts, ...(count === null ? {} : { count }) });
const check = (d, { words = true, look = lookOf(3) } = {}) => validateDeclaration(d, {
  arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: false, fitJobLine: true,
  ...(words ? { pageWords: { texts: { flights: PAGE }, look } } : {}),
});
const reds = (d, o) => { const r = check(d, o); return r.ok ? [] : [...r.reds]; };

// ---- the fact line's close, with a pick ----
const page = 'Release notes\n## [1.2.0] - 2026-10-01\nChanged: the exporter now streams rows.\n';
const source = { ok: true, text: page, sha256: sha256Text(page) };
const factPart = { source: 'notes', facts: [{ name: 'heading', shape: 'phrase', phrase: '## [1.2.0] - 2026-10-01' }], count: { min: 1, max: 1 } };
const stepWith = (picked) => ({ close: { class: 'green', cited: factPart, ...(picked ? { picked } : {}) } });
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const good = [{ quote: '## [1.2.0] - 2026-10-01', values: {} }];
const close = (art, picked = [{ rule: 'maxWords', value: 80 }]) => closeByClass(stepWith(picked), art, { reads: {}, businessDate: '', source });

test('(1) a fact line with a picked at most 80 words: green only when facts AND the pick pass', async () => {
  assert.equal((await close({ results: good, text: words(42) })).verdict, 'green');
  const long = await close({ results: good, text: words(93) });
  assert.equal(long.verdict, 'red');
  assert.match(long.red, /93 words, limit 80|not met: at most 80 words/);
  const made = await close({ results: [{ quote: '## [9.9.9] - 2030-01-01', values: {} }], text: words(42) });
  assert.equal(made.verdict, 'red');
  assert.equal((await close({ results: [], text: words(42) })).verdict, 'red');
  const both = await close({ results: [], text: words(93) });
  assert.equal(both.verdict, 'red');
  assert.match(both.red, /words/);
  assert.ok(both.red.split('\n').length >= 2, 'both reasons are told');
});

test('(1) a line without picks closes as before; text on it is not judged', async () => {
  const r = await closeByClass(stepWith(null), { results: good, text: words(500) }, { reads: {}, businessDate: '', source });
  assert.equal(r.verdict, 'green', 'no picks: text is not judged, exactly as before');
});

test('(1) applyPicks keeps a pick on a green line: close.picked beside the fact close, the line stays green, pickedLines records it', () => {
  const decl = { steps: [{ fromLine: 1, close: { class: 'green', cited: factPart } }, { fromLine: 2, close: { class: 'hitl' } }], guardrailClasses: { 1: 'green' }, unjudgeable: {} };
  const rules = [{ line: 1, rule: 1, text: 'under 80 words' }];
  const settled = settleRules(rules, [{ line: 1, rule: 1, check: { rule: 'maxWords', value: 80 } }], []);
  const out = applyPicks(decl, rules, settled, () => 'x');
  assert.deepEqual(out.steps[0].close, { class: 'green', cited: factPart, picked: [{ rule: 'maxWords', value: 80 }] });
  assert.equal(out.guardrailClasses['1'], 'green');
  assert.deepEqual(out.pickedLines, [1]);
});

test('(1) the validator accepts close.picked on a fact step (a list of text rules) and refuses it on a step that checks no facts', () => {
  const d = decl(part());
  d.steps[0].close.picked = [{ rule: 'maxWords', value: 80 }];
  d.pickedLines = [1];
  assert.deepEqual(reds(d), []);
  const bad = decl(part());
  bad.steps[1].close = { class: 'hitl', picked: [{ rule: 'maxWords', value: 80 }] };
  assert.match(reds(bad).join('\n'), /close\.picked is for a step that checks facts/);
  const junk = decl(part());
  junk.steps[0].close.picked = [{ rule: 'cells' }];
  assert.match(reds(junk).join('\n'), /close\.picked must be/);
});

test('(2) a fact line with picks and no text, or empty text, is red even when its facts pass; never green, never a casualty', async () => {
  const none = await close({ results: good });
  assert.equal(none.verdict, 'red');
  assert.match(none.red, /no text/);
  const empty = await close({ results: good, text: '' });
  assert.equal(empty.verdict, 'red');
  assert.match(empty.red, /not met: the answer is not empty/);
  const notString = await close({ results: good, text: 42 });
  assert.equal(notString.verdict, 'red');
  // only maxWords picked: empty text still red (the code floor), a good text still green
  assert.equal((await close({ results: good, text: '' }, [{ rule: 'maxWords', value: 80 }])).verdict, 'red');
  assert.equal((await close({ results: good, text: words(3) }, [{ rule: 'maxWords', value: 80 }])).verdict, 'green');
});

test('(2) the check rows of a fact line with picks: the fact row, then each pick, with the floor listed', async () => {
  const { closeRecords } = await import('../src/try-checks.js');
  const art = { results: good, text: words(93) };
  const step = stepWith([{ rule: 'maxWords', value: 80 }]);
  const closed = await closeByClass(step, art, { reads: {}, businessDate: '', source });
  const rows = closeRecords(step, art, closed);
  assert.ok(rows.some((r) => /at most 80 words/.test(r.text) && r.ok === false && /93 words/.test(r.result)), JSON.stringify(rows));
  assert.ok(rows[0].text.startsWith('every result is quoted') && rows[0].ok === true);
});

test('(2) a fact step with picks is offered a "text" box and told to write it; one without is offered none (the step never sees the check itself)', async () => {
  const { buildEmitArtifactSchema } = await import('../src/model-step.js');
  const withText = buildEmitArtifactSchema('green', true, null, true);
  assert.ok(withText.properties.text && withText.required.includes('text'));
  assert.equal(withText.additionalProperties, false);
  assert.equal(buildEmitArtifactSchema('green', true).properties.text, undefined);
  assert.equal(JSON.stringify(withText).includes('maxWords'), false);
});
