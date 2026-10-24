// M8 item 5a: the DRAFTER is handed the learnings hints (docs/wiki/the-module-ladder.md "M8" item 5a, am1). $0: a fake provider, scratch homes (mkdtemp, cleaned up).
// The ledger rows come from real cards folded by the real ledger code (test/m8-learn-fixtures.js); where a row is edited the test says so.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir } from '../src/authoring.js';
import { hintsForRun, writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger, renderHints, HINT_HEADER, HINT_CHARS_MAX } from '../src/learn.js';
import { LEARNINGS_FILE } from '../src/flowmodel.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { cardsOf } from './m8-learn-fixtures.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply, textReply,
} from './drafter-fixture.mjs';

const DAY = 86_400_000;
const NOW = new Date();
const built = cardsOf('ms2c0ls7');
const tmp = (/** @type {string} */ p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m8-5a-${p}-`));
process.env.FWDLOOP_CONFIG_HOME = tmp('home'); // a test process never reaches the real ~/.config/fwdloop; each test passes its own home to the ledger writer
const fx = job2Fixture(); // ONE prose for every draft, so two prompts are comparable byte for byte

/** a row of the real card, edited (the edit is the point of the test that calls this) */
const row = (/** @type {any} */ over) => ({
  ...countLedger(emptyLedger(), {
    runid: 'r0', cards: built.cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW,
  }).rows[0],
  lastSeen: NOW.toISOString(), // the fixture's own card is from July; the age is the thing under test, so it is set here
  ...over,
});

/** a scratch config home with the ledger rows given and `learningHints` as given; the draft reads it through FWDLOOP_CONFIG_HOME */
function home(/** @type {boolean|null} */ on, /** @type {any[]|null} */ rows) {
  const h = tmp('cfg');
  if (on !== null) writeFileSync(path.join(h, 'config.json'), JSON.stringify({ learningHints: on }));
  if (rows) writeLedger({ ...emptyLedger(), rows }, h);
  return h;
}

async function draftIn(/** @type {string} */ h, replies = [toolReply(validArgs())], extra = {}) {
  process.env.FWDLOOP_CONFIG_HOME = h;
  const p = fakeProvider(replies);
  const work = tmp('draft');
  const dir = path.join(work, 'draft');
  const r = await draftToDir({
    proseFile: (() => { const f = path.join(work, 'prose.txt'); writeFileSync(f, fx.prose); return f; })(), dir, root: path.join(work, 'flows'), name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {}, ...extra,
  });
  return { r, p, dir, sys: p.calls.map((c) => c.messages.find((m) => m.role === 'system').content) };
}
const record = (/** @type {string} */ dir) => JSON.parse(readFileSync(path.join(dir, LEARNINGS_FILE), 'utf8'));
/** what the ledger renders for the draft's own job (the expected block), through the same copied function */
const expected = (/** @type {string} */ h) => hintsForRun({ home: h, spec: { job: 'job2', inputs: [{ value: fx.resume }] }, specHash: null, now: NOW });

test('ON with a matching row: the exact text is in the drafter system prompt and in the record', async () => {
  const h = home(true, [row({})]);
  const want = expected(h);
  assert.ok(want && want.text.startsWith(HINT_HEADER));
  const { r, sys, dir } = await draftIn(h);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.ok(sys[0].endsWith(`\n\n${want.text}`), 'appended last, after the drafter prompt');
  assert.deepEqual(record(dir), { phase: 'draft', text: want.text, ids: want.ids, chars: want.text.length });
});

test('OFF (absent, false) and ON with nothing readable: the prompt is byte-identical, and there is no record', async () => {
  const base = await draftIn(home(null, null));
  assert.equal(base.r.ok, true);
  assert.ok(!base.sys[0].includes(HINT_HEADER));
  for (const h of [home(null, [row({})]), home(false, [row({})]), home(true, null), home(true, [])]) {
    const x = await draftIn(h);
    assert.equal(x.sys[0], base.sys[0]);
    assert.equal(existsSync(path.join(x.dir, LEARNINGS_FILE)), false, 'no record when nothing was handed');
    assert.equal(existsSync(path.join(x.dir, 'learn-error.jsonl')), false);
  }
});

test('a row older than 56 days is not handed; one 55 days old is', async () => {
  const old = await draftIn(home(true, [row({ lastSeen: new Date(NOW.getTime() - 57 * DAY).toISOString() })]));
  assert.ok(!old.sys[0].includes(HINT_HEADER));
  assert.equal(existsSync(path.join(old.dir, LEARNINGS_FILE)), false);
  const fresh = await draftIn(home(true, [row({ lastSeen: new Date(NOW.getTime() - 55 * DAY).toISOString() })]));
  assert.ok(fresh.sys[0].includes(HINT_HEADER));
});

test('another workflow\'s row is not handed; it is handed only by climbing (this place)', async () => {
  const other = await draftIn(home(true, [row({ workflow: 'job9', place: '/somewhere/else' })]));
  assert.ok(!other.sys[0].includes(HINT_HEADER), 'a lone row of another job on another place');
  // the row plus two hidden siblings of the same lesson in other jobs on THIS place: the lesson climbs to the place level
  const sib = (/** @type {number} */ n) => row({ id: `sib${n}`, runIds: [], workflow: `wf${n}`, place: fx.resume });
  const climbed = await draftIn(home(true, [row({ workflow: 'job9', place: fx.resume }), sib(1), sib(2)]));
  assert.ok(climbed.sys[0].includes(HINT_HEADER), 'climbed to this place');
  assert.match(record(climbed.dir).text, /\[this place, seen/);
});

test('at most 2,000 characters, whole hints only', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => row({ id: `row${i}`, sample: { ...built.cards[0], check: `chk-${i}` }, runIds: [`r${i}`] }));
  const h = home(true, rows);
  const { sys, dir } = await draftIn(h);
  const rec = record(dir);
  assert.ok(rec.chars <= HINT_CHARS_MAX && rec.chars > 1000, `chars ${rec.chars}`);
  assert.ok(rec.ids.length < 60, 'some hints did not fit and were left out whole');
  assert.ok(sys[0].endsWith(rec.text));
});

test('revise rounds, structure retries and the redraft after answers get the SAME block', async () => {
  const h = home(true, [row({})]);
  const bad = validArgs();
  bad.steps[0].primitives = ['no-such-verb'];
  const { r, sys, p, dir } = await draftIn(h, [toolReply(bad), textReply('sure'), toolReply(validArgs())]);
  assert.ok(p.calls.length >= 3, `calls ${p.calls.length}`);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.ok(sys.every((s) => s === sys[0]) && sys[0].includes(HINT_HEADER), 'every round: one system prompt, with the block');
  assert.equal(record(dir).text, expected(h)?.text);
  // the redraft after answers is another draft call (noQuestions): it is handed the block too
  const re = await draftIn(h, [toolReply(validArgs())], { noQuestions: true });
  assert.ok(re.sys[0].includes(expected(h)?.text ?? 'x'));
});

test('a step request never carries the block (5b is not built)', async () => {
  const h = home(true, [row({})]);
  process.env.FWDLOOP_CONFIG_HOME = h;
  const calls = [];
  const provider = {
    async generate(messages, tools, options) { calls.push(JSON.stringify({ messages, tools: tools.map((t) => t.name), options })); return { text: 'ok', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'stop', model: MODEL }; },
  };
  const step = makeLiveModelStep({ spendPath: path.join(tmp('step'), 'spend.jsonl'), provider, rates: RATES, modelId: MODEL });
  await step({ goal: 'write a summary', reads: [], prior: [] }, {}, { class: 'hitl', thinkingMode: 'on' });
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((c) => !c.includes(HINT_HEADER) && !c.includes(expected(h).ids[0])));
});

test('a ledger error hands nothing, records why, and does not fail the draft', async () => {
  const base = await draftIn(home(null, null));
  const h = home(true, null);
  mkdirSync(path.join(h, 'learn'), { recursive: true });
  writeFileSync(path.join(h, 'learn', 'ledger.json'), '{ not json');
  const x = await draftIn(h);
  assert.equal(x.r.ok, true, JSON.stringify(x.r.reds));
  assert.equal(x.sys[0], base.sys[0]);
  const rec = record(x.dir);
  assert.deepEqual({ ...rec, error: undefined }, { phase: 'draft', text: '', ids: [], chars: 0, error: undefined });
  assert.match(rec.error, /not readable JSON/);
  assert.equal(existsSync(path.join(x.dir, 'learn-error.jsonl')), false, 'no separate file for a drafter failure');
  const { readLearningsRecord } = await import('../src/flowmodel.js');
  assert.equal(readLearningsRecord(x.dir), null, 'an error record is "handed nothing": the Audit box stays hidden');
  assert.equal(readFileSync(path.join(h, 'learn', 'ledger.json'), 'utf8'), '{ not json', 'the bad ledger is not reset');
});

test('the record is write-once', async () => {
  const { dir } = await draftIn(home(true, [row({})]));
  const { writeLearningsRecord } = await import('../src/flowmodel.js');
  assert.throws(() => writeLearningsRecord(dir, { text: 'x', ids: [] }), /EEXIST/);
});
