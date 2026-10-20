// M10 item 1 (drafting copy) + item 3 (the source's own words) at the drafter: a `page:` source is fetched and frozen into the draft folder, one
// map call names the page's own words, code keeps what the page proves, every drop is a Not-checked line the drafter is told. Fake provider, local
// page server / injected fetch, $0, no internet. Each forced red is named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { freezeInputs } from '../src/runner.js';
import { fetchPageText } from '../src/pagefetch.js';
import { MAP_UNREADABLE } from '../src/pagemap.js';
import { startPageServer, fakeConnect } from './fixtures/m10-page-server.mjs';
import {
  RATES, MODEL, fakeProvider, textReply,
} from './drafter-fixture.mjs';
import { PAGE, raw } from './fixtures/m10-map/load.mjs';

const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const prose = (address = ADDRESS) => `1. List 3 flights from Amsterdam to London,
   guardrail: under $150; not a red-eye; nonstop
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${address}
`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m10draft-'));
const mapReply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const fetcher = (text = PAGE) => { const seen = []; const f = async (url) => { seen.push(url); return { ok: true, text, url }; }; f.seen = seen; return f; };
// offerQuestions:false: these tests are about the drafting round after the look; the look's asks (piece 3) are in test/m10-draft-asks.test.js
const run = (provider, extra = {}) => draft({
  proseText: prose(), provider, rates: RATES, modelId: MODEL, draftDir: path.join(tmp(), 'pages'), fetchPage: fetcher(), offerQuestions: false, ...extra,
});

test('the page is fetched and frozen into the draft folder, and the drafter is given its text facts', async () => {
  const draftDir = path.join(tmp(), 'pages');
  const fp = fetcher();
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p, { draftDir, fetchPage: fp });
  assert.deepEqual(fp.seen, [ADDRESS]);
  assert.equal(readFileSync(path.join(draftDir, 'flights.txt'), 'utf8'), PAGE);
  assert.equal(r.pageLooks[0].sha256, sha(PAGE));
  assert.equal(r.pageLooks[0].role, 'flights');
  // call 1 is the map call, with the frozen text in it and no tool; call 2 is the drafter, whose system prompt carries the page's checked words
  assert.deepEqual(p.calls[0].tools, []);
  assert.ok(p.calls[0].messages.at(-1).content.includes('PAGE TEXT (the input "flights")'));
  assert.ok(p.calls[0].messages.at(-1).content.includes(PAGE));
  assert.equal(p.calls[1].tools[0], 'emit_declaration');
  const sys = p.calls[1].messages[0].content;
  assert.match(sys, /- flights: a web page/);
  assert.match(sys, /price.*"From"/s);
  assert.match(sys, /Code could not make these a check/);
});

test('every map round is metered into the draft: rounds and cost count it, the book is called around it', async () => {
  const books = [];
  const p = fakeProvider([mapReply(raw(3)), textReply()]);
  const r = await run(p, { onBook: (b) => books.push([b.inFlight, b.calls]) });
  assert.equal(r.rounds, p.calls.length);
  assert.ok(r.costUsd > 0);
  assert.deepEqual(books.slice(0, 2), [[true, 1], [false, 1]], 'the map call is booked before and after, as any drafter call is');
  assert.equal(r.spendComplete, true);
  assert.equal(r.log[0].kind, 'page-map');
});

test('a pre-send throw from the book stops before the map call: no provider call, nothing metered', async () => {
  const p = fakeProvider([mapReply(raw(3))]);
  const draftDir = path.join(tmp(), 'pages');
  await assert.rejects(run(p, { draftDir, onBook: ({ inFlight }) => { if (inFlight) throw new Error('draft: cannot book the spend before the call'); } }), /cannot book/);
  assert.equal(p.calls.length, 0);
  assert.equal(existsSync(path.join(draftDir, 'flights.txt')), true, 'it was the MAP call that was refused: the page was already frozen');
});

test('the kept facts carry what a later ask will read: the reading, the source, the line and rule they serve', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]));
  const price = r.look.facts.find((f) => f.name === 'price');
  assert.deepEqual(price.reading, { op: 'lt', value: 150 });
  assert.equal(price.source, 'flights');
  assert.deepEqual([price.line, price.forRule], [1, 1]);
  const time = r.look.facts.find((f) => f.name === 'departure time');
  assert.deepEqual(time.reading, { op: 'between', lo: '05:00', hi: '23:59' });
});

test('every drop is a Not-checked line in the result, from the one table, and the drafter is told it', async () => {
  const p = fakeProvider([mapReply(raw(2)), textReply()]);
  const r = await run(p);
  assert.ok(r.look.dropped.length > 0);
  assert.ok(r.notChecked.includes('line 1: "not a red-eye" — "0 stops" is not written on the page.') || r.notChecked.some((l) => l.includes('"0 stops" is not written on the page.')), r.notChecked.join('\n'));
  const sys = p.calls[1].messages[0].content;
  for (const l of r.notChecked.filter((x) => x.startsWith('line 1:'))) assert.ok(sys.includes(l), `the drafter was not told: ${l}`);
});

test('an empty page stops drafting at $0 with the plain reason; no model call, no copy kept', async () => {
  const srv = await startPageServer({ '/empty': { body: '' } });
  try {
    const draftDir = path.join(tmp(), 'pages');
    const p = fakeProvider([mapReply(raw(3))]);
    const fetchPage = (url) => fetchPageText(url, { connect: fakeConnect().connect, idleMs: 5, idleTimeoutMs: 40, timeoutMs: 5000, closeWaitMs: 50 });
    const r = await draft({ proseText: prose(`${srv.base}/empty`), provider: p, rates: RATES, modelId: MODEL, draftDir, fetchPage });
    assert.equal(r.ok, false);
    assert.equal(r.stop, 'pre-flight');
    assert.equal(r.costUsd, 0);
    assert.match(r.reds.join(' '), /input "flights": .*no text/);
    assert.equal(p.calls.length, 0);
    assert.equal(existsSync(path.join(draftDir, 'flights.txt')), false);
  } finally { await srv.close(); }
});

test('a page that blocks us stops drafting at $0 and names the input; nothing is worked around', async () => {
  const p = fakeProvider([mapReply(raw(3))]);
  const r = await run(p, { fetchPage: async () => ({ ok: false, error: 'the site answered 403 (blocked)' }) });
  assert.equal(r.stop, 'pre-flight');
  assert.match(r.reds.join(' '), /input "flights": the site answered 403/);
  assert.equal(p.calls.length, 0);
});

test('an unpriced model is refused before the page is fetched: nothing leaves the machine', async () => {
  const fp = fetcher();
  const p = fakeProvider([mapReply(raw(3))]);
  const r = await run(p, { rates: null, fetchPage: fp });
  assert.equal(r.stop, 'pre-flight');
  assert.match(r.reds.join(' '), /price/);
  assert.deepEqual(fp.seen, []);
  assert.equal(p.calls.length, 0);
});

test('a map answer unreadable twice stops with the plain words; both rounds are metered, no drafting round is paid', async () => {
  const p = fakeProvider([mapReply('not json'), mapReply('{"facts": 3}')]);
  const r = await run(p);
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'page-map');
  assert.deepEqual(r.reds, [MAP_UNREADABLE]);
  assert.equal(p.calls.length, 2);
  assert.equal(r.rounds, 2);
  assert.ok(r.costUsd > 0);
});

test('an answer cut off at the output cap is unreadable, never "no tool call"', async () => {
  const cut = { ...mapReply(raw(3)), stopReason: 'max_tokens' };
  const p = fakeProvider([cut, cut]);
  const r = await run(p);
  assert.equal(r.stop, 'page-map');
  assert.equal(p.calls.length, 2);
});

test('thinking follows the draft\'s intent on the map call, and the call has no forced tool', async () => {
  for (const mode of ['off', 'on']) {
    const p = fakeProvider([mapReply(raw(3)), textReply()]);
    await run(p, { draftThinking: mode });
    assert.equal(p.calls[0].options.thinkingMode, mode);
    assert.equal(p.calls[0].options.toolChoice, undefined);
    assert.equal(p.calls[0].options.maxTokens, 16000);
  }
});

test('the drafting copy is never a run\'s copy: a run freezes its own page, and a changed page is the run\'s sha, not the draft\'s', async () => {
  const draftDir = path.join(tmp(), 'pages');
  await run(fakeProvider([mapReply(raw(3)), textReply()]), { draftDir });
  const changed = `${PAGE}\nPrices changed since drafting.\n`;
  const runDir = tmp();
  const fr = await freezeInputs(runDir, [{ id: 'flights', path: ADDRESS }], { fetchPage: fetcher(changed) });
  assert.equal(fr.ok, true);
  const e = fr.manifest[0];
  assert.notEqual(path.dirname(e.frozen), draftDir);
  assert.equal(e.sha256, sha(changed));
  assert.notEqual(e.sha256, sha(readFileSync(path.join(draftDir, 'flights.txt'), 'utf8')));
});

test('draftToDir keeps the drafting copy and the page look beside the draft; the map round is in the booked spend; not-checked.json holds the code lines', async () => {
  const { draftToDir, PAGES_DIR, PAGE_LOOK_FILE } = await import('../src/authoring.js');
  const work = tmp();
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, prose());
  const dir = path.join(work, 'draft');
  const p = fakeProvider([mapReply(raw(2)), textReply()]);
  const r = await draftToDir({
    proseFile, dir, root: path.join(work, 'flows'), name: 'flightsjob', provider: p, rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY', fetchPage: fetcher(),
  });
  assert.equal(r.wrote, true, JSON.stringify(r.reds));
  assert.equal(readFileSync(path.join(dir, PAGES_DIR, 'flights.txt'), 'utf8'), PAGE);
  const look = JSON.parse(readFileSync(path.join(dir, PAGE_LOOK_FILE), 'utf8'));
  assert.equal(look.pages[0].sha256, sha(PAGE));
  assert.ok(look.look.facts.length > 0 && look.look.dropped.length > 0);
  const nc = JSON.parse(readFileSync(path.join(dir, 'not-checked.json'), 'utf8')).notChecked;
  assert.ok(nc.some((l) => l.includes('"0 stops" is not written on the page.')), nc.join('\n'));
  const rows = readFileSync(path.join(dir, 'spend.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].rounds, p.calls.length, 'the booked row counts the map round');
  assert.ok(!existsSync(path.join(dir, 'spec.hash')), 'a red draft is not signable');
});

// ---- follow-ups: pre-send throw, thinking per try, big pages, leftover folder -------------------------------------------------------------
test('a ValidationError thrown before the send is booked as one unmetered call (held at the ceiling, spend not complete), never silently uncounted', async () => {
  const books = [];
  const p = fakeProvider([mapReply(raw(3))]);
  p.generate = async () => { const e = new Error('messages: too long'); e.name = 'ValidationError'; throw e; };
  const r = await run(p, { onBook: (b) => books.push(b) });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'provider-red');
  assert.equal(r.spendComplete, false, 'the call may have been billed: not complete');
  assert.equal(r.calls, 1);
  assert.equal(books.at(-1).unmetered, 1, 'the book sees the call, unmetered, so the ceiling is held for it');
  assert.equal(r.log[0].kind, 'page-map');
});

test('thinking per try (M4d am25): try 1 off, the retry on; the ticked hatch forces on for both', async () => {
  const bad = mapReply('not json');
  const p = fakeProvider([bad, mapReply(raw(3)), textReply()]);
  await run(p, { draftThinking: 'off' });
  assert.deepEqual([p.calls[0].options.thinkingMode, p.calls[1].options.thinkingMode], ['off', 'on']);
  const q = fakeProvider([bad, mapReply(raw(3)), textReply()]);
  await run(q, { draftThinking: 'on' });
  assert.deepEqual([q.calls[0].options.thinkingMode, q.calls[1].options.thinkingMode], ['on', 'on']);
  assert.equal(q.calls[0].options.toolChoice, undefined);
});

// a price at which the 32000-token floor fits the $0.25 cap ($0.18) but a 270k-token prompt ($1.35) does not
const DEAR = { in: 0.005, out: 0.0012 };

test('the map call is held at the size of its own prompt: a huge page that breaks the cap is refused at $0 with the cap words, nothing sent, no copy left', async () => {
  const huge = `${PAGE}\n${'x '.repeat(400_000)}`;
  const draftDir = path.join(tmp(), 'pages');
  const p = fakeProvider([mapReply(raw(3))]);
  const r = await run(p, { draftDir, fetchPage: fetcher(huge), rates: DEAR });
  assert.equal(r.stop, 'pre-flight');
  assert.equal(p.calls.length, 0);
  assert.equal(r.costUsd, 0);
  assert.match(r.reds.join(' '), /Cap \$0\.25/);
  assert.match(r.reds.join(' '), /Raise Cap/);
  assert.equal(existsSync(draftDir), false);
});

test('a normal page is not refused by the sized hold (the 32000-token floor still applies)', async () => {
  const r = await run(fakeProvider([mapReply(raw(3)), textReply()]), { rates: DEAR });
  assert.notEqual(r.stop, 'pre-flight');
});

test('a later page that cannot be fetched removes the copy an earlier page kept, and the folder', async () => {
  const draftDir = path.join(tmp(), 'pages');
  const two = prose().replace('guardrail: source flights', 'guardrail: source second = page:https://example.com/two\nguardrail: source flights');
  let n = 0;
  const fetchPage = async (url) => { n += 1; return n === 1 ? { ok: true, text: PAGE, url } : { ok: false, error: 'the site answered 403 (blocked)' }; };
  const r = await draft({ proseText: two, provider: fakeProvider([mapReply(raw(3))]), rates: RATES, modelId: MODEL, draftDir, fetchPage });
  assert.equal(r.stop, 'pre-flight');
  assert.match(r.reds.join(' '), /input "flights"|input "second"/);
  assert.equal(existsSync(draftDir), false);
});
