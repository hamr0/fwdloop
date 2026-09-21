// Tests for poc/m1/slot-batch.mjs — $0, zero network. Every test supplies
// its own `providerForDraft` (a fake, never `makeProvider`/a real OpenAI
// client) and its own `outDir` under node's tmp dir, so nothing here ever
// touches poc/m1/out or poc/m0/out's real ledgers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runSlotBatch, runOneDraft, ceilingCostUsd, outFilePaths, assertFreshTag, realFacts,
  renderSummaryLine, renderProgressLine, checkKeyPreflight,
} from './slot-batch.mjs';
import { parseAskSlots } from './slots.mjs';

const PROSE_TEXT = readFileSync(join(process.cwd(), 'poc', 'm0', 'prose.txt'), 'utf8');
const { lines: ASK_LINES } = parseAskSlots(PROSE_TEXT); // [5], the real signed slot
const REAL_FACTS = realFacts();

function tmpOutDir() {
  return mkdtempSync(join(tmpdir(), 'm1-slot-batch-'));
}

// A well-formed job #1 declaration (same shape as poc/m0/drafter.test.mjs's
// job1ModelSteps()) whose line-5 step is exactly what the slot grammar
// demands: fromLine 5, close.class hitl, no primitives. Unlike
// job1ModelSteps() itself, the "derive"/"compose" steps here carry a
// placeholder "read" grant rather than m0's legitimate empty-primitives
// shape (catalogue.mjs's JOB1_NEEDS: "match a customer, derive figures" is
// `own: true`, no primitive at all) — poc/m1/slots.mjs's check (c) treats
// ANY zero-primitive step at an unsigned line as the mechanical shape of an
// unsigned pause, by design (see its own header), so a fixture meant to
// stay green under it must not carry that otherwise-legitimate shape.
function conformingModelArgs() {
  return {
    guardrailClasses: {
      2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl',
    },
    steps: [
      {
        goal: 'read the sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1,
      },
      {
        goal: 'read the message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2,
      },
      {
        goal: 'match customer, derive totals', primitives: ['read'], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3,
      },
      {
        goal: 'compose reply', primitives: ['read'], reads: ['a3'], emits: 'a4', fromLine: 4, close: { shape: { linesPerInvoice: 1, mustCarry: ['total'] } },
      },
      {
        goal: 'check with me', primitives: [], reads: ['a4'], emits: 'a5', fromLine: 5,
      },
      {
        goal: 'send (dry-run egress)', primitives: ['write'], reads: ['a5'], emits: 'a6', fromLine: 6,
      },
    ],
  };
}

function toolReply(args) {
  return {
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_declaration', arguments: args }],
    usage: { inputTokens: 200, outputTokens: 150 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  };
}

function fakeConformingProvider() {
  let n = 0;
  return {
    generate: async () => {
      n += 1;
      if (n === 1) return toolReply(conformingModelArgs());
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model',
      };
    },
  };
}

function fakeNoToolCallProvider() {
  return {
    generate: async () => ({
      text: 'I refuse.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 }, stopReason: 'stop', model: 'fake-model',
    }),
  };
}

function fakeHangingProvider() {
  return { generate: () => new Promise(() => {}) }; // never resolves — forces the deadline race
}

function fakeThrowingProvider(message = 'connection reset') {
  return { generate: async () => { throw new Error(message); } };
}

function fakeThrowingProviderErr(err) {
  return { generate: async () => { throw err; } };
}

function providerForDraftOf(makeFakeProvider) {
  return () => ({ provider: makeFakeProvider(), rates: { in: 0.0003, out: 0.0012 }, modelId: 'fake-model' });
}

// ---------------------------------------------------------------------------
// ceilingCostUsd — re-exported from poc/m0/spend.mjs (one writer for the
// ceiling; this script no longer keeps its own local copy). Never 0, never
// null; bounded by spend.mjs's CEILING_OUTPUT_TOKENS/CEILING_INPUT_TOKENS.
// ---------------------------------------------------------------------------

test('ceilingCostUsd is a positive, non-zero number for a known model', () => {
  const cost = ceilingCostUsd('deepseek-flash');
  assert.equal(typeof cost, 'number');
  assert.ok(cost > 0);
});

test('PROOF the test can fail: an unknown model still prices positive — the ceiling never hides a bug behind 0', () => {
  assert.ok(ceilingCostUsd('some-model-never-seen-before') > 0);
});

// ---------------------------------------------------------------------------
// File / tag discipline
// ---------------------------------------------------------------------------

test('assertFreshTag: a missing or empty file never refuses', () => {
  const outDir = tmpOutDir();
  const { jsonlPath } = outFilePaths('slot', 'freshtag', outDir);
  assert.doesNotThrow(() => assertFreshTag(jsonlPath));
});

test('runSlotBatch refuses to start against a tag that already has ≥1 recorded line', async () => {
  const outDir = tmpOutDir();
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'reuse', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  });
  await assert.rejects(
    () => runSlotBatch({
      grammar: 'slot', n: 1, tag: 'reuse', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
      providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
    }),
    /already has 1 result\(s\)/,
  );
});

test('PROOF the test can fail: a DIFFERENT tag against the same grammar is never refused', async () => {
  const outDir = tmpOutDir();
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'a', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  });
  await assert.doesNotReject(() => runSlotBatch({
    grammar: 'slot', n: 1, tag: 'b', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  }));
});

// ---------------------------------------------------------------------------
// runOneDraft — the per-draft record shape
// ---------------------------------------------------------------------------

test('runOneDraft: a conforming declaration under slotGrammar records validator green, slot green, and full meter fields', async () => {
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider),
  });
  assert.equal(record.toolCalled, true);
  assert.equal(record.stopReason, 'tool-called');
  assert.deepEqual(record.validator, { verdict: 'green', red: null });
  assert.deepEqual(record.slot, { verdict: 'green' });
  assert.equal(record.stepCount, 6);
  assert.equal(record.hitlSteps, 4); // lines 1 (blank), 2 (ask-me guardrail -> hitl), 5 (ask), 6 (blank)
  assert.equal(record.checkpointGrants, 0);
  assert.equal(record.zeroPrimitiveSteps, 1); // "check with me" (line 5), the signed ask step
  assert.equal(record.costUnknown, false);
  assert.ok(typeof record.costUsd === 'number' && record.costUsd >= 0);
  assert.equal(record.modelRequested, 'fake-model');
  assert.equal(record.modelReturned, 'fake-model');
  assert.equal(record.modelMatch, 'match');
});

test('PROOF the test can fail: the legacy grammar (checkpoint still on the menu) lets a drafted checkpoint grant show up in checkpointGrants', async () => {
  const withCheckpoint = conformingModelArgs();
  withCheckpoint.steps.find((s) => s.fromLine === 5).primitives = ['checkpoint'];
  const provider = { generate: (() => { let n = 0; return async () => { n += 1; return n === 1 ? toolReply(withCheckpoint) : { text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model' }; }; })() };
  const record = await runOneDraft({
    i: 1, grammar: 'legacy', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: () => ({ provider, rates: { in: 0.0003, out: 0.0012 }, modelId: 'fake-model' }),
  });
  assert.equal(record.checkpointGrants, 1);
  assert.equal(record.slot.verdict, 'red');
  assert.match(record.slot.red, /grants "checkpoint"/);
});

test('runOneDraft: no tool call records stopReason "no-tool-call" and null validator/slot', async () => {
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeNoToolCallProvider),
  });
  assert.equal(record.toolCalled, false);
  assert.equal(record.stopReason, 'no-tool-call');
  assert.equal(record.validator, null);
  assert.equal(record.slot, null);
  assert.equal(record.stepCount, 0);
});

// ---------------------------------------------------------------------------
// The 240s hard deadline — a hung round is priced at the ceiling, never 0/null
// ---------------------------------------------------------------------------

test('runOneDraft: a round that never returns is timed out and priced at the ceiling, never 0 or null', async () => {
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeHangingProvider), deadlineMs: 20,
  });
  assert.equal(record.stopReason, 'timeout');
  assert.equal(record.toolCalled, false);
  assert.equal(record.costUnknown, false, 'a timeout is priced at the ceiling — bounded, not unknown');
  assert.ok(record.costUsd > 0);
});

// ---------------------------------------------------------------------------
// Provider errors — hamr's ruling, 2026-09-21: no session starts at $0 or
// unknown pricing. EVERY thrown error, whatever its shape (a header-value
// validation throw that never left the machine, a DNS failure, a refused
// connection, or a genuine mid-response ECONNRESET), is priced at the
// CEILING now — never 0, never null. This closes the exact hole a3cf07f's
// isClientSideThrow $0 branch reopened (a "client-side" throw priced at
// literal $0 is its own kind of "unknown cost rendered as 0": the row LOOKS
// priced but the number is fabricated, not measured or bounded against
// what a round could really cost) and the hole a genuinely-unknown-cost
// null row left (poc/m0/out/spend.jsonl's own live null row, which this
// fix must make priceable at read time without editing the ledger).
// ---------------------------------------------------------------------------

test('runOneDraft: a thrown provider error (crash-after-send, e.g. ECONNRESET) is priced at the ceiling, estimated, never $0 or null', async () => {
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider('ECONNRESET')),
  });
  assert.equal(record.stopReason, 'provider-red');
  assert.equal(record.costUnknown, false);
  assert.ok(record.costUsd > 0);
  assert.equal(record.estimated, true);
});

test('runOneDraft: a header-validation throw (request never left the machine) is ALSO priced at the ceiling, never a fabricated $0', async () => {
  const err = new TypeError('Invalid character in header content ["Authorization"]');
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProviderErr(err)),
  });
  assert.equal(record.stopReason, 'provider-red');
  assert.equal(record.costUnknown, false);
  assert.ok(record.costUsd > 0);
  assert.equal(record.estimated, true);
});

test('runOneDraft: ENOTFOUND (DNS failure before any response) is ALSO priced at the ceiling, never $0', async () => {
  const err = new Error('getaddrinfo ENOTFOUND api.deepseek.com');
  err.code = 'ENOTFOUND';
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProviderErr(err)),
  });
  assert.equal(record.costUnknown, false);
  assert.ok(record.costUsd > 0);
  assert.equal(record.estimated, true);
});

test('PROOF the test can fail: every thrown-error record carries the SAME ceiling cost for the same model, not a coincidentally-different number', async () => {
  const a = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider('ECONNRESET')),
  });
  const b = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProviderErr(new TypeError('Invalid character in header content'))),
  });
  assert.equal(a.costUsd, b.costUsd);
});

// ---------------------------------------------------------------------------
// runSlotBatch — summary counts, early stop on 2 consecutive provider reds
// ---------------------------------------------------------------------------

test('runSlotBatch: summary counts slotGreen/validatorGreen/noToolCall/timeouts correctly over a mixed run', async () => {
  const outDir = tmpOutDir();
  const drafts = [fakeConformingProvider, fakeConformingProvider, fakeNoToolCallProvider];
  let idx = 0;
  const providerForDraft = () => {
    const make = drafts[idx];
    idx += 1;
    return { provider: make(), rates: { in: 0.0003, out: 0.0012 }, modelId: 'fake-model' };
  };
  const { records, summaryLine, completed } = await runSlotBatch({
    grammar: 'slot', n: 3, tag: 'mixed', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft, writeLine: () => {},
  });
  assert.equal(completed, true);
  assert.equal(records.length, 3);
  assert.equal(summaryLine, 'SUMMARY grammar=slot n=3 slotGreen=2 validatorGreen=2 noToolCall=1 timeouts=0 costUsd=' + records.reduce((s, r) => s + r.costUsd, 0).toFixed(6));
});

test('PROOF the test can fail: an all-green run reports noToolCall=0, not a nonzero placeholder', async () => {
  const outDir = tmpOutDir();
  const { records, summaryLine } = await runSlotBatch({
    grammar: 'slot', n: 2, tag: 'allgreen', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  });
  assert.equal(records.length, 2);
  assert.match(summaryLine, /noToolCall=0/);
  assert.match(summaryLine, /slotGreen=2/);
});

test('runSlotBatch: stops after 2 consecutive provider reds and reports completed=false', async () => {
  const outDir = tmpOutDir();
  const { records, completed } = await runSlotBatch({
    grammar: 'slot', n: 5, tag: 'reds', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider('down')), writeLine: () => {},
  });
  assert.equal(records.length, 2, 'must stop exactly at the 2nd consecutive red, never burn through all 5');
  assert.ok(records.every((r) => r.stopReason === 'provider-red'));
  assert.equal(completed, false);
});

test('PROOF the test can fail: a single provider red followed by a clean draft never stops the batch', async () => {
  const outDir = tmpOutDir();
  const drafts = [() => fakeThrowingProvider('blip'), fakeConformingProvider, fakeConformingProvider];
  let idx = 0;
  const providerForDraft = () => {
    const make = drafts[idx];
    idx += 1;
    return { provider: make(), rates: { in: 0.0003, out: 0.0012 }, modelId: 'fake-model' };
  };
  const { records, completed } = await runSlotBatch({
    grammar: 'slot', n: 3, tag: 'onered', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft, writeLine: () => {},
  });
  assert.equal(records.length, 3);
  assert.equal(completed, true);
});

// ---------------------------------------------------------------------------
// Output discipline — jsonl + per-draft declaration files land on disk
// ---------------------------------------------------------------------------

test('runSlotBatch writes one jsonl line and one declaration file per draft', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'files', outDir);
  await runSlotBatch({
    grammar: 'slot', n: 2, tag: 'files', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  });
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const row = JSON.parse(line);
    assert.equal(typeof row.i, 'number');
    assert.ok(!('declaration' in row), 'the jsonl row must never carry the full declaration — that lives in its own file');
  }
  assert.ok(existsSync(join(declDir, 'draft-1.json')));
  assert.ok(existsSync(join(declDir, 'draft-2.json')));
});

// ---------------------------------------------------------------------------
// Progress line rendering — never prints anything that could be a key
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Key preflight — $0, before any draft round or ledger write. Live failure
// (2026-09-21): a two-line `pass` entry exported DEEPSEEK_API_KEY with a
// trailing newline; makeProvider's own `if (!apiKey) throw` never catches
// this (a newline-terminated string is still truthy), so this must be
// checked separately, before the loop, never printing the key's value.
// ---------------------------------------------------------------------------

test('checkKeyPreflight: an unset key is refused, naming the variable', () => {
  const result = checkKeyPreflight('deepseek', {});
  assert.equal(result.ok, false);
  assert.match(result.message, /DEEPSEEK_API_KEY/);
  assert.match(result.message, /not set/);
});

test('checkKeyPreflight: an empty-string key is refused, naming the variable', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: '' });
  assert.equal(result.ok, false);
  assert.match(result.message, /DEEPSEEK_API_KEY/);
});

test('checkKeyPreflight: a key with a trailing newline (two-line pass entry) is refused, naming the defect, never the value', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: 'sk-realkeyvalue\n' });
  assert.equal(result.ok, false);
  assert.match(result.message, /DEEPSEEK_API_KEY/);
  assert.match(result.message, /newline/);
  assert.doesNotMatch(result.message, /sk-realkeyvalue/);
});

test('checkKeyPreflight: a clean single-line key passes', () => {
  const result = checkKeyPreflight('deepseek', { DEEPSEEK_API_KEY: 'sk-realkeyvalue' });
  assert.equal(result.ok, true);
});

test('PROOF the test can fail: a key with an internal space is also refused', () => {
  const result = checkKeyPreflight('synthetic', { SYNTHETIC_API_KEY: 'sk-has space' });
  assert.equal(result.ok, false);
  assert.match(result.message, /SYNTHETIC_API_KEY/);
});

test('renderProgressLine never includes a provider rates object or a raw key-shaped string', () => {
  const record = {
    i: 1, grammar: 'slot', toolCalled: true, stopReason: 'tool-called', validator: { verdict: 'green' }, slot: { verdict: 'green' }, costUsd: 0.001234, wallMs: 1200,
  };
  const line = renderProgressLine(record, 5);
  assert.match(line, /^draft 1\/5/);
  assert.doesNotMatch(line, /sk-|Bearer /);
});
