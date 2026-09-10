// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider (a plain object satisfying bare-agent's
// `Provider.generate(messages, tools, options)` interface), never a real
// OpenAIProvider. A live probe exists only behind `SCOUT_LIVE=1` in
// scout.mjs's own CLI block, never here and never in the default `npm test`
// path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseCsv } from './csv.mjs';
import { menu } from './catalogue.mjs';
import {
  SCOUT_MENU, SCOUT_ROUND_BOUND, SCOUT_MAX_TOKENS,
  lookFixtures, groundFacts, makeReportFactsTool, runScoutRound,
} from './scout.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CSV_PATH = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
const TEXT_PATH = join(REPO_ROOT, 'fixtures', 'message.txt');

// ---------------------------------------------------------------------------
// Negative #5 — write/store primitives are ABSENT from the scout's menu, not
// merely refused. Mirrors catalogue.test.mjs's own negative #5, but asserts
// it at THE SCOUT'S OWN call site (SCOUT_MENU), which is the thing that could
// regress if scout.mjs ever swapped `menu({classes:['read']})` for `menu()`.
// ---------------------------------------------------------------------------

test('negative #5: SCOUT_MENU has no write-class or store-class verb — absence, not refusal', () => {
  const verbs = SCOUT_MENU.map((e) => e.verb);
  assert.ok(verbs.length > 0, 'sanity: the scout menu is not accidentally empty');
  assert.ok(!verbs.includes('write'));
  assert.ok(!verbs.includes('edit'));
  assert.ok(!verbs.includes('checkpoint'));
  assert.ok(!verbs.includes('draftMail'));
  assert.ok(!verbs.includes('sendMail'));
  assert.ok(!verbs.includes('stash'));
  assert.ok(!verbs.includes('remember'));
  assert.ok(!verbs.includes('forget'));
  for (const entry of SCOUT_MENU) assert.equal(entry.class, 'read');
});

test('PROOF the test can fail: an unfiltered catalogue menu DOES include write/store verbs (sanity on the fixture, not the code under test)', () => {
  const verbs = menu().map((e) => e.verb);
  assert.ok(verbs.includes('write'));
  assert.ok(verbs.includes('stash'));
});

// ---------------------------------------------------------------------------
// Round bound — fixed in code, not spec-authorable. Enforced by
// makeReportFactsTool's execute(), not merely documented.
// ---------------------------------------------------------------------------

test('SCOUT_ROUND_BOUND is 1 — one look, no revision', () => {
  assert.equal(SCOUT_ROUND_BOUND, 1);
});

test('the round bound actually binds: a second report_facts call throws', async () => {
  const { tool, getCallCount } = makeReportFactsTool();
  await tool.execute({ csvColumns: ['Customer'] });
  assert.equal(getCallCount(), 1);
  await assert.rejects(
    () => tool.execute({ csvColumns: ['Customer'] }),
    /scout round bound exceeded \(1\)/,
  );
});

// ---------------------------------------------------------------------------
// The mechanical look — $0, deterministic, the real fixtures.
// ---------------------------------------------------------------------------

test('lookFixtures reads the REAL fixtures — header and lines are not invented', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realParsed = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  assert.deepEqual(csvArtifact.header, realParsed.header);
  assert.equal(csvArtifact.rows.length, realParsed.rows.length);
  const realLines = readFileSync(TEXT_PATH, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  assert.deepEqual(textArtifact.lines, realLines);
});

// ---------------------------------------------------------------------------
// Grounding — the M0a exit criterion: a reported column name must exist in
// the fixture, never be invented. Pure function, independently checked
// against a fresh parse of the real fixture (not the same call path as the
// code under test).
// ---------------------------------------------------------------------------

test('groundFacts drops an invented column and flags it — never silently trusted', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const rawFacts = { csvColumns: [...realHeader, 'TotallyInventedColumn'] };
  const facts = groundFacts(rawFacts, { csvArtifact, textArtifact });
  assert.deepEqual(facts.invented, ['TotallyInventedColumn']);
  assert.ok(!facts.csv.columns.includes('TotallyInventedColumn'));
  for (const col of facts.csv.columns) assert.ok(realHeader.includes(col), `"${col}" is not a real column`);
});

test('PROOF the test can fail: a real, unmodified column list passes through with nothing invented', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const facts = groundFacts({ csvColumns: realHeader }, { csvArtifact, textArtifact });
  assert.deepEqual(facts.invented, []);
  assert.deepEqual(facts.csv.columns.sort(), [...realHeader].sort());
});

test('groundFacts falls back to the mechanical truth when the model reports nothing usable — never empty, never invented', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const facts = groundFacts({}, { csvArtifact, textArtifact });
  assert.deepEqual(facts.csv.columns, csvArtifact.header);
  assert.deepEqual(facts.invented, []);
});

// ---------------------------------------------------------------------------
// F11 regression guard — the output cap must actually bind, never theatre.
// Two levels: (a) the baseline slot's provider really does carry
// legacyMaxTokens (same assertion style as provider.test.mjs's own F11 test);
// (b) the scout's own fixed SCOUT_MAX_TOKENS constant is what actually
// reaches the request options — proven via a fake provider that records what
// it was called with, so a future call site that hardcodes a different
// number, or lets a caller override it, goes red.
// ---------------------------------------------------------------------------

test('F11: the deepseek slot the scout runs against carries legacyMaxTokens — provider.mjs is the one writer', async () => {
  const { makeProvider } = await import('./provider.mjs');
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key-not-real';
  try {
    assert.equal(makeProvider('deepseek', { model: 'deepseek-v4-flash' }).provider.legacyMaxTokens, true);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
  }
});

// A well-behaved model calls the tool once, then finishes (no further tool
// calls) once it sees the tool result — exactly what drafter.mjs/runner.mjs's
// real rounds do in practice, and what makes ONE round the normal case. The
// fake mirrors that: `toolCallReply` is returned on the FIRST generate() call
// only; every call after that returns a plain finished stop with no tool
// calls, so a misbehaving model that tried to re-call would be visible as
// `calls.length > 1` rather than silently retried forever.
function fakeProvider(toolCallReply) {
  const calls = [];
  let n = 0;
  return {
    calls,
    generate: async (messages, tools, options) => {
      calls.push({ messages, tools, options });
      n += 1;
      if (n === 1) return toolCallReply;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model',
      };
    },
  };
}

test('the fixed SCOUT_MAX_TOKENS reaches the request options — no call site or caller can widen it', async () => {
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const provider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'report_facts', arguments: { csvColumns: realHeader } }],
    usage: { inputTokens: 50, outputTokens: 20 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  // bare-agent's Loop always needs one further generate() call to close out cleanly after a
  // tool call (it feeds the tool result back for the model's finishing turn) — same mechanics
  // drafter.mjs/runner.mjs already run on. What's fixed in code is that `report_facts` itself
  // can succeed only ONCE (see "the round bound actually binds" above); every generate() call
  // this produces still carries the same capped maxTokens, asserted on all of them below.
  assert.ok(provider.calls.length >= 1 && provider.calls.length <= 2, `expected 1-2 provider calls, got ${provider.calls.length}`);
  for (const call of provider.calls) assert.equal(call.options.maxTokens, SCOUT_MAX_TOKENS);
  assert.equal(report.toolCalled, true);
  assert.deepEqual(report.facts.csv.columns.sort(), [...realHeader].sort());
});

// ---------------------------------------------------------------------------
// End-to-end (still no network): fake provider hands back an invented column
// alongside real ones — proves the whole pipeline (menu absence + round bound
// + grounding) works together, not just each piece in isolation.
// ---------------------------------------------------------------------------

test('runScoutRound end-to-end with a fake provider: an invented column never survives to the final facts', async () => {
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const provider = fakeProvider({
    text: null,
    toolCalls: [{
      id: 't1', name: 'report_facts', arguments: { csvColumns: [...realHeader, 'MadeUpColumn'], customerMentioned: 'Northwind' },
    }],
    usage: { inputTokens: 60, outputTokens: 25 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  assert.deepEqual(report.facts.invented, ['MadeUpColumn']);
  assert.ok(!report.facts.csv.columns.includes('MadeUpColumn'));
  assert.equal(report.facts.customerMentioned, 'Northwind');
});

test('PROOF the test can fail: no tool call at all leaves toolCalled false and facts still grounded in the mechanical truth', async () => {
  const provider = fakeProvider({
    text: 'I cannot help with that.',
    toolCalls: [],
    usage: { inputTokens: 30, outputTokens: 10 },
    stopReason: 'stop',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(report.toolCalled, false);
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  assert.deepEqual(report.facts.csv.columns, realHeader);
});
