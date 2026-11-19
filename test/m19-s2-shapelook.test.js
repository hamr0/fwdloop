// M19 S2 at the drafter and at lookAtShape (docs/wiki/the-module-ladder.md, "M19", S2 and section 3.1): the shape look is ONE call, asked only when the block names a `~` rule still Not checked, run after the page look,
// the sheet look, the asks and the answers; booked as a drafting round (kind `shape-map`). A look that fails never stops the draft. Fake provider (test/m16-drafter-fixture.mjs `router`), $0, no key, no network.
// Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { lookAtShape, SHAPE_SYSTEM, shapeLookPrompt } from '../src/shapelook.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, textOf, router } from './m16-drafter-fixture.mjs';

const FX = new URL('./fixtures/shape-contested/', import.meta.url);
const TRACKER = readFileSync(new URL('research-tracker.txt', FX), 'utf8');
const SHAPE_RAW = readFileSync(new URL('shape-map.raw.json', FX), 'utf8');
const reply = (/** @type {string} */ text, /** @type {number} */ inputTokens = 1000) => ({ ...textOf(text), usage: { inputTokens, outputTokens: 200 } });
const LEDGER = callOf('suggest_extra_checks', { extra: [] });
const EDITS = callOf('submit_edits', { edits: [] });

/** the tracker job: one line of items, three `~` rules, no truth check possible (a file input has no page look) */
function trackerProse(/** @type {import('node:test').TestContext} */ t, rules = ['each item has a title', 'status is one of in progress, closed, finished', 'summary is under 200 characters']) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m19s2-'));
  mkdirSync(path.join(home, 'out'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'tracker.txt');
  writeFileSync(file, TRACKER);
  const guard = rules.length ? `\n   guardrail: ${rules.join('; ')}` : '';
  return `1. List every research item in the tracker, one entry each${guard}\n2. ask 1h: check it with me\n3. and once I accept, write it out\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $0.5 per run\nguardrail: send at line 3 to file:${path.join(home, 'out')}\nguardrail: source tracker = file:${file}\n`;
}
const run = (/** @type {any} */ provider, /** @type {string} */ proseText, /** @type {any} */ extra = {}) => draft({ proseText, provider, rates: RATES, modelId: MODEL, checkList: true, offerQuestions: false, ...extra });
const mapCalls = (/** @type {any} */ p) => p.calls.filter((/** @type {any} */ c) => c.name === 'map');

test('no `~` rule on the job: no candidate, ZERO shape calls and no shape-map or shape-skipped entry (a call made without a candidate turns this red)', async (t) => {
  const p = router({ submit_edits: EDITS, suggest_extra_checks: LEDGER, map: reply(SHAPE_RAW) });
  const r = await run(p, trackerProse(t, []));
  assert.equal(mapCalls(p).length, 0);
  assert.ok(!r.log.some((/** @type {any} */ e) => e.kind === 'shape-map' || e.kind === 'shape-skipped'));
});

test('a rule left Not checked: ONE call with the tag\'s prompt, booked as a drafting round (kind shape-map) with its cost, thinking per call, and code builds the fields', async (t) => {
  const p = router({ submit_edits: EDITS, suggest_extra_checks: LEDGER, map: reply(SHAPE_RAW) });
  const books = /** @type {any[]} */ ([]);
  const r = await run(p, trackerProse(t), { onBook: (/** @type {any} */ b) => books.push([b.inFlight, b.calls]) });
  const maps = mapCalls(p);
  assert.equal(maps.length, 1);
  assert.equal(maps[0].messages[0].content, SHAPE_SYSTEM);
  const user = maps[0].messages[1].content;
  assert.ok(user.startsWith('THE JOB (each ~ rule applies to the line above it):\nLINE 1: List every research item in the tracker, one entry each\n~ rule 1: each item has a title\n~ rule 2: status is one of in progress, closed, finished\n~ rule 3: summary is under 200 characters\n\nTHE INPUTS:\nInput "tracker":\n<<<\n'));
  assert.ok(user.includes('Only these ~ rules have no check yet: line 1 rules 1, 2, 3. Give a field for no other rule.'));
  assert.equal(user, shapeLookPrompt({ jobLines: [{ n: 1, text: 'List every research item in the tracker, one entry each', rules: ['each item has a title', 'status is one of in progress, closed, finished', 'summary is under 200 characters'] }], lineNums: [1], texts: { tracker: TRACKER }, left: [{ line: 1, rules: [1, 2, 3] }] }));
  assert.equal(maps[0].options.thinkingMode, 'off');
  const entry = r.log.find((/** @type {any} */ e) => e.kind === 'shape-map');
  assert.equal(entry.outcome, 'answered');
  assert.equal(entry.rawText, SHAPE_RAW, 'the raw answer is kept in the log');
  assert.ok(r.costUsd > 0 && r.spendComplete === true && r.rounds === r.calls, 'the round is metered and counted');
  assert.ok(books.some(([inFlight]) => inFlight === true) && books.some(([inFlight]) => inFlight === false));
  // until S5 (the shape part in the close) a built part is refused by the step validator, so the rules read Not checked in that red's words (test/m19-s3-shape-rows.test.js says the same); the set shape shows as its extra field's row
  assert.ok(r.checkRows.some((/** @type {any} */ x) => x.rowKind === 'shape' && x.key === 'L1.shape.owner'), `code built the suggestion and the block holds it: ${JSON.stringify(r.checkRows.map((/** @type {any} */ x) => [x.key, x.rowKind]))}`);
});

test('an unreadable answer twice: two calls booked, ONE draft-log line in the tag\'s words, and the draft goes on to the drafting round (no shape)', async (t) => {
  const p = router({ submit_edits: EDITS, suggest_extra_checks: LEDGER, map: [reply('not json'), reply('still not json')] });
  const r = await run(p, trackerProse(t));
  assert.equal(mapCalls(p).length, 2);
  const skipped = r.log.filter((/** @type {any} */ e) => e.kind === 'shape-skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].line, 'the shape look did not complete: The AI\'s answer about the shape of the answer was not readable twice. Nothing was signed.; going on without a shape');
  assert.ok(p.names().includes('emit_declaration'), 'the draft went on to its drafting round');
  assert.ok(r.costUsd > 0);
  assert.ok(!r.checkRows.some((/** @type {any} */ x) => x.rowKind === 'shape'));
});

test('the cap is reached before the call: NO shape call, the log line says the ceiling was spent (a call made past the cap turns this red)', async (t) => {
  // the ledger turn is metered at about $0.51 of the $0.5 cap, so the shape look's own hold no longer fits
  const big = { ...LEDGER, usage: { inputTokens: 1_700_000, outputTokens: 100 } };
  const q = router({ submit_edits: EDITS, suggest_extra_checks: big, map: reply(SHAPE_RAW) });
  const r = await run(q, trackerProse(t));
  assert.equal(mapCalls(q).length, 0);
  assert.equal(r.log.find((/** @type {any} */ e) => e.kind === 'shape-skipped')?.line, "the shape look did not complete: the AI's look at the shape of the answer was not made: the $0.5 ceiling was already spent; going on without a shape");
});

test('a transport failure is retried once and the failed attempt is booked UNPRICED (spend not complete, never $0 for it); the retry answers and the shape is built', async (t) => {
  let n = 0;
  const p = router({ submit_edits: EDITS, suggest_extra_checks: LEDGER, map: () => { n += 1; if (n === 1) throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }); return reply(SHAPE_RAW); } });
  const r = await run(p, trackerProse(t));
  assert.equal(mapCalls(p).length, 2);
  assert.equal(r.spendComplete, false, 'the thrown round has no metering: its cost is unknown');
  assert.ok(!r.log.some((/** @type {any} */ e) => e.kind === 'shape-skipped'));
  assert.equal(r.log.filter((/** @type {any} */ e) => e.kind === 'shape-map').length, 2);
  assert.ok(r.checkRows.some((/** @type {any} */ x) => x.rowKind === 'shape'));
});

test('lookAtShape: a 429 waits the vendor\'s stated time ONCE (not an attempt); a second 429, or a second transport failure, is a failed look in the tag\'s words', async () => {
  const job = [{ n: 1, text: 'x', rules: ['a'] }];
  const slept = /** @type {number[]} */ ([]);
  const rate = () => Object.assign(new Error('Please try again in 2s.'), { status: 429 });
  let i = 0;
  const once = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], sleep: async (ms) => { slept.push(ms); }, callModel: async () => (i++ === 0 ? { error: 'x', threw: rate() } : { text: SHAPE_RAW }) });
  assert.equal(once.ok, true);
  assert.deepEqual(slept, [2250]);
  const twice = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], sleep: async () => {}, callModel: async () => ({ error: 'Please try again in 2s.', threw: rate() }) });
  assert.deepEqual([twice.ok, twice.reason], [false, 'the call about the shape of the answer failed: Please try again in 2s.']);
  const boom = () => Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
  const down = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], callModel: async () => ({ error: 'fetch failed', threw: boom() }) });
  assert.deepEqual([down.ok, down.attempts, down.reason], [false, 2, 'the call about the shape of the answer failed: fetch failed']);
  const cut = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], callModel: async () => ({ text: SHAPE_RAW, cutOff: true }) });
  assert.deepEqual([cut.ok, cut.attempts], [false, 2]);
});
