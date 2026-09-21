// Tests for poc/m1/slot-batch.mjs — $0, zero network. Every test supplies
// its own `providerForDraft` (a fake, never `makeProvider`/a real OpenAI
// client) and its own `outDir` under node's tmp dir, so nothing here ever
// touches poc/m1/out or poc/m0/out's real ledgers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runSlotBatch, runOneDraft, ceilingCostUsd, outFilePaths, assertFreshTag, realFacts,
  renderSummaryLine, renderProgressLine, checkKeyPreflight, rescoreSlotBatch, rescoreFilePath,
  JOBS, prosePathForJob, M1_CAP_USD, defaultM1SpendPath, OUT_DIR, redactSecrets, secretsFromEnv,
} from './slot-batch.mjs';
import { parseAskSlots } from './slots.mjs';

const PROSE_TEXT = readFileSync(join(process.cwd(), 'poc', 'm0', 'prose.txt'), 'utf8');
const { lines: ASK_LINES } = parseAskSlots(PROSE_TEXT); // [5], the real signed slot
const REAL_FACTS = realFacts();

// ---------------------------------------------------------------------------
// job #2 / twoask fixtures — $0, zero network, same fakeProvider discipline.
// ---------------------------------------------------------------------------

// askLines for job2/twoask are never hard-coded here — runSlotBatch/rescoreSlotBatch derive
// them from parseAskSlots(proseText) internally (job2: [4], twoask: [2, 5]), same as job1.
const JOB2_PROSE_TEXT = readFileSync(join(process.cwd(), 'poc', 'm0', 'job2.prose.txt'), 'utf8');
const TWOASK_PROSE_TEXT = readFileSync(join(process.cwd(), 'poc', 'm1', 'fixtures', 'twoask.prose.txt'), 'utf8');

// Mirrors poc/m0/drafter.test.mjs's own JOB2_FACTS (scoutJob2's output shape) — a plain object,
// never a real resume/JD file (no in-repo fixture exists; see this task's own report).
const JOB2_FACTS = {
  resume: { kind: 'docx', paragraphs: 3, words: 20, firstLine: 'AMR HASSAN' },
  jd: { kind: 'markdown', words: 15, headings: ['Applied AI Architect'] },
};

// job #2's own well-behaved model steps (mirrors poc/m0/drafter.test.mjs's job2ModelSteps()),
// EXCEPT the ask step (line 4) grants NO primitive rather than 'checkpoint' — checkAskSlots'
// own rule (b) reds any step anywhere granting "checkpoint" (the pause belongs to the runner,
// never the drafter), so a declaration built to also pass the M1 slot check must never grant it.
function job2ConformingSteps() {
  return {
    guardrailClasses: { 3: 'softgreen', 4: 'hitl' },
    steps: [
      {
        goal: 'read the resume', primitives: ['readDocx'], reads: [], emits: 'r1', fromLine: 1,
      },
      {
        goal: 'read the job description', primitives: ['read'], reads: [], emits: 'r2', fromLine: 2,
      },
      {
        goal: 'compose the summary',
        primitives: [],
        reads: ['r1', 'r2'],
        emits: 'r3',
        fromLine: 3,
        close: { shape: { maxWords: 600, sections: ['summary of work history', 'professional skills', 'soft skills'] } },
      },
      {
        goal: 'check with me', primitives: [], reads: ['r3'], emits: 'r4', fromLine: 4,
      },
      {
        goal: 'send the accepted summary', primitives: ['write'], reads: ['r4'], emits: 'r5', fromLine: 5,
      },
    ],
  };
}

// twoask's own well-behaved steps: job #1's EXACT shape (poc/m0/prose.txt's job lines are
// byte-identical in the twoask fixture) — line 2's own "ask me, do not pick" guardrail already
// derives to hitl by default (no explicit proposal needed, same as line 5's), so job #1's
// existing conformingModelArgs() shape already carries a hitl step at BOTH signed ask lines
// (2 and 5) once twoask's signed slots are [2, 5] instead of job #1's own [5] alone.
function twoaskBothAsksSteps() {
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

// SAME shape, but with the line-2 step dropped entirely — one of twoask's two signed ask
// lines (2) now has NO step bound to it at all.
function twoaskMissingOneAskSteps() {
  const decl = twoaskBothAsksSteps();
  decl.steps = decl.steps.filter((s) => s.fromLine !== 2);
  return decl;
}

// `toolReply` is defined further down this file as a `function` declaration — hoisted, so this
// helper (itself also hoisted) can call it safely regardless of source order.
function fakeProviderFor(stepsArgs) {
  let n = 0;
  return {
    generate: async () => {
      n += 1;
      if (n === 1) return toolReply(stepsArgs);
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model',
      };
    },
  };
}

function tmpOutDir() {
  return mkdtempSync(join(tmpdir(), 'm1-slot-batch-'));
}

// A well-formed job #1 declaration (same shape as poc/m0/drafter.test.mjs's
// job1ModelSteps()) whose line-5 step is exactly what the slot grammar
// demands: fromLine 5, close.class hitl, no primitives. Unlike
// job1ModelSteps() itself, the "derive"/"compose" steps here carry a
// placeholder "read" grant rather than m0's legitimate empty-primitives
// shape (catalogue.mjs's JOB1_NEEDS: "match a customer, derive figures" is
// `own: true`, no primitive at all). This placeholder is no longer load-
// bearing for staying green under poc/m1/slots.mjs's check (c) — as of
// 2026-09-21, (c) only fires on a step that is BOTH zero-primitive AND
// close.class "hitl" (the mechanical shape of a pause), so the legitimate
// own:true derive shape (no primitive, close.class "green") is fine either
// way. Kept as-is (harmless, still a faithful stand-in for m0's real
// "read"-grant steps) rather than churned for its own sake.
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

function fakeNoToolCallProviderWithText(text) {
  return {
    generate: async () => ({
      text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 }, stopReason: 'stop', model: 'fake-model',
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

// ---------------------------------------------------------------------------
// --rescore mode — $0, re-scores SAVED drafts with the CURRENT validate()/
// checkAskSlots code, never re-drafts, never builds a provider, never
// touches the spend ledger, never overwrites the original .jsonl.
// ---------------------------------------------------------------------------

test('rescoreSlotBatch: re-scores each saved draft, writes a NEW dated file, and never touches the original jsonl', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'rescore-fixture', outDir);
  await runSlotBatch({
    grammar: 'slot', n: 2, tag: 'rescore-fixture', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  });
  const originalBefore = readFileSync(jsonlPath, 'utf8');

  const dateStr = '2026-09-21';
  const { records, summaryLine, outPath } = rescoreSlotBatch({
    grammar: 'slot', tag: 'rescore-fixture', outDir, proseText: PROSE_TEXT, writeLine: () => {}, dateStr,
  });

  assert.equal(records.length, 2);
  for (const r of records) {
    assert.equal(r.validator.verdict, 'green');
    assert.equal(r.slot.verdict, 'green');
  }
  assert.equal(summaryLine, 'RESCORE grammar=slot tag=rescore-fixture n=2 slotGreen=2 validatorGreen=2 bothGreen=2');
  assert.equal(outPath, rescoreFilePath('slot', 'rescore-fixture', outDir, dateStr));
  assert.ok(existsSync(outPath));
  assert.match(outPath, /\.rescore-2026-09-21\.jsonl$/);

  // the original .jsonl is byte-identical after the rescore — consumed evidence is never overwritten.
  assert.equal(readFileSync(jsonlPath, 'utf8'), originalBefore);

  // the rescore file itself holds one JSON line per draft.
  const rescoreLines = readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(rescoreLines.length, 2);
  assert.deepEqual(JSON.parse(rescoreLines[0]).slot, { verdict: 'green' });

  // sanity: the declaration files themselves were never touched either.
  assert.ok(existsSync(join(declDir, 'draft-1.json')));
  assert.ok(existsSync(join(declDir, 'draft-2.json')));
});

test('rescoreSlotBatch reflects the CURRENT slots.mjs code, not whatever scored the draft originally', async () => {
  // Simulate what a live batch actually wrote BEFORE the 2026-09-21 check-(c)
  // fix: a saved draft.json whose derive step (fromLine 3) is fwdloop's own,
  // no-primitive, "green"-close model round — the exact shape that reded
  // under the old check (c) but is fine under the current one.
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'rescore-oldbug', outDir);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(declDir, { recursive: true });
  writeFileSync(jsonlPath, `${JSON.stringify({ i: 1, grammar: 'slot' })}\n`);
  writeFileSync(join(declDir, 'draft-1.json'), JSON.stringify({
    steps: [
      { goal: 'read sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1 },
      { goal: 'read message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2 },
      {
        goal: 'derive', primitives: [], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3, close: { class: 'green' },
      },
      {
        goal: 'ask', primitives: [], reads: ['a3'], emits: 'a4', fromLine: 5, close: { class: 'hitl' },
      },
    ],
  }, null, 2));

  const { records } = rescoreSlotBatch({
    grammar: 'slot', tag: 'rescore-oldbug', outDir, proseText: PROSE_TEXT, writeLine: () => {}, dateStr: '2026-09-21',
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].slot.verdict, 'green', `expected green under the current check (c), got: ${JSON.stringify(records[0].slot)}`);
});

test('rescoreSlotBatch: a null (never-produced) declaration rescoures to null validator/slot, not a throw', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'rescore-null', outDir);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(declDir, { recursive: true });
  writeFileSync(jsonlPath, `${JSON.stringify({ i: 1, grammar: 'slot', stopReason: 'no-tool-call' })}\n`);
  writeFileSync(join(declDir, 'draft-1.json'), 'null');

  const { records } = rescoreSlotBatch({
    grammar: 'slot', tag: 'rescore-null', outDir, proseText: PROSE_TEXT, writeLine: () => {}, dateStr: '2026-09-21',
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].validator, null);
  assert.equal(records[0].slot, null);
});

test('rescoreSlotBatch refuses when the grammar+tag has no recorded jsonl at all', () => {
  const outDir = tmpOutDir();
  assert.throws(
    () => rescoreSlotBatch({ grammar: 'slot', tag: 'never-ran', outDir, proseText: PROSE_TEXT, writeLine: () => {} }),
    /not found — nothing recorded for grammar=slot tag=never-ran/,
  );
});

test('PROOF the test can fail: rescoreSlotBatch requires --tag, same discipline as the live batch', () => {
  const outDir = tmpOutDir();
  assert.throws(
    () => rescoreSlotBatch({ grammar: 'slot', tag: '', outDir, proseText: PROSE_TEXT, writeLine: () => {} }),
    /--tag is required/,
  );
});

// ---------------------------------------------------------------------------
// --job job1|job2|twoask (item 1 of this task's brief). job1 is the default
// (every test above never passes `job` at all) — these tests cover job2 and
// twoask, plus the unknown-job refusal shared by every job.
// ---------------------------------------------------------------------------

test('JOBS lists exactly job1, job2, twoask; prosePathForJob resolves each to a real file', () => {
  assert.deepEqual(JOBS, ['job1', 'job2', 'twoask']);
  for (const job of JOBS) {
    assert.ok(existsSync(prosePathForJob(job)), `prosePathForJob(${job}) must name a real file`);
  }
});

test('PROOF the test can fail: prosePathForJob refuses an unknown job, naming it', () => {
  assert.throws(() => prosePathForJob('nope'), /--job must be one of job1\|job2\|twoask, got "nope"/);
});

test('runSlotBatch --job job2: rows carry job, files land under job-specific names, slot check green', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'job2tag', outDir, 'job2');
  const { records, completed } = await runSlotBatch({
    grammar: 'slot', n: 2, tag: 'job2tag', job: 'job2', outDir,
    facts: JOB2_FACTS, proseText: JOB2_PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeProviderFor(job2ConformingSteps())),
    writeLine: () => {},
  });
  assert.equal(completed, true);
  assert.equal(records.length, 2);
  for (const r of records) {
    assert.equal(r.job, 'job2');
    assert.equal(r.toolCalled, true);
    assert.equal(r.slot.verdict, 'green', JSON.stringify(r.slot));
  }
  assert.ok(existsSync(jsonlPath));
  assert.match(jsonlPath, /slot-batch-slot-job2-job2tag\.jsonl$/);
  assert.ok(existsSync(join(declDir, 'draft-1.json')));
  assert.ok(existsSync(join(declDir, 'draft-2.json')));
  // job1's OWN naming (no "job2" segment) must never be touched by a job2 run.
  const { jsonlPath: job1ShapedPath } = outFilePaths('slot', 'job2tag', outDir);
  assert.equal(existsSync(job1ShapedPath), false);
});

test('PROOF the test can fail: a job2 declaration missing its signed ask step (line 4) reds the slot check', async () => {
  const outDir = tmpOutDir();
  const badSteps = job2ConformingSteps();
  badSteps.steps = badSteps.steps.filter((s) => s.fromLine !== 4);
  const { records } = await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'job2bad', job: 'job2', outDir,
    facts: JOB2_FACTS, proseText: JOB2_PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeProviderFor(badSteps)),
    writeLine: () => {},
  });
  assert.equal(records[0].slot.verdict, 'red');
  assert.match(records[0].slot.red, /ask at line 4 has no step/);
});

test('runSlotBatch --job twoask: a declaration binding BOTH signed ask lines (2 and 5) is slot green', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'twoasktag', outDir, 'twoask');
  const { records, completed } = await runSlotBatch({
    grammar: 'slot', n: 2, tag: 'twoasktag', job: 'twoask', outDir,
    facts: REAL_FACTS, proseText: TWOASK_PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeProviderFor(twoaskBothAsksSteps())),
    writeLine: () => {},
  });
  assert.equal(completed, true);
  for (const r of records) {
    assert.equal(r.job, 'twoask');
    assert.equal(r.slot.verdict, 'green', JSON.stringify(r.slot));
  }
  assert.match(jsonlPath, /slot-batch-slot-twoask-twoasktag\.jsonl$/);
  assert.ok(existsSync(declDir));
});

test('runSlotBatch --job twoask: a declaration binding only ONE of the two signed ask lines is a slot red naming the missing line', async () => {
  const outDir = tmpOutDir();
  const { records } = await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'twoaskmissing', job: 'twoask', outDir,
    facts: REAL_FACTS, proseText: TWOASK_PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeProviderFor(twoaskMissingOneAskSteps())),
    writeLine: () => {},
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].slot.verdict, 'red');
  assert.match(records[0].slot.red, /ask at line 2 has no step/);
});

test('PROOF the test can fail: the SAME missing-ask declaration against job1\'s OWN single ask slot (line 5 only) is slot green — the second slot is twoask-only', async () => {
  const record = await runOneDraft({
    i: 1, grammar: 'slot', job: 'job1', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeProviderFor(twoaskMissingOneAskSteps())),
  });
  assert.equal(record.slot.verdict, 'green', JSON.stringify(record.slot));
});

test('runSlotBatch: an unknown --job is refused at $0, before any ledger write', async () => {
  const outDir = tmpOutDir();
  await assert.rejects(
    () => runSlotBatch({
      grammar: 'slot', n: 1, tag: 'badjob', job: 'nope', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
      providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
    }),
    /--job must be one of job1\|job2\|twoask, got "nope"/,
  );
  assert.deepEqual(readdirSync(outDir), [], 'nothing must be written when --job is refused');
});

test('rescoreSlotBatch --job job2: rescores under the job2-shaped filename, using job2\'s own signed ask line', async () => {
  const outDir = tmpOutDir();
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'rescore-job2', job: 'job2', outDir,
    facts: JOB2_FACTS, proseText: JOB2_PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeProviderFor(job2ConformingSteps())),
    writeLine: () => {},
  });
  const dateStr = '2026-09-21';
  const { records, outPath } = rescoreSlotBatch({
    grammar: 'slot', tag: 'rescore-job2', job: 'job2', outDir, proseText: JOB2_PROSE_TEXT, writeLine: () => {}, dateStr,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].slot.verdict, 'green');
  assert.equal(outPath, rescoreFilePath('slot', 'rescore-job2', outDir, dateStr, 'job2'));
  assert.match(outPath, /slot-batch-slot-job2-rescore-job2\.rescore-2026-09-21\.jsonl$/);
});

// ---------------------------------------------------------------------------
// M1's own spend ledger/cap (item 2 of this task's brief) — separate from
// M0's poc/m0/out/spend.jsonl / $5 GLOBAL_CAP_USD, even though the number
// happens to match today.
// ---------------------------------------------------------------------------

test('M1_CAP_USD is 5.00 and defaultM1SpendPath resolves under poc/m1/out, never poc/m0/out', () => {
  assert.equal(M1_CAP_USD, 5.00);
  const path = defaultM1SpendPath();
  assert.equal(path, join(OUT_DIR, 'spend.jsonl'));
  assert.match(path, /poc[\\/]m1[\\/]out[\\/]spend\.jsonl$/);
  assert.doesNotMatch(path, /poc[\\/]m0[\\/]out/);
});

test('PROOF the test can fail: defaultM1SpendPath honours an explicit outDir override', () => {
  const path = defaultM1SpendPath('/tmp/somewhere-else');
  assert.equal(path, join('/tmp/somewhere-else', 'spend.jsonl'));
});

// ---------------------------------------------------------------------------
// F33/F34 — a draft with no declaration keeps what the model wrote. Before
// this fix, draft-<i>.json for EVERY no-declaration outcome (no-tool-call,
// provider-red, timeout) was the literal `null`, throwing away textInstead/
// usage/rounds/providerRedMessage that runOneDraft/the drafter report
// already carried. `null` is still legal on disk (old evidence) and must
// keep rescoring the same way.
// ---------------------------------------------------------------------------

test('no-tool-call draft file keeps declaration:null, the outcome, and the exact text (never the literal null)', async () => {
  const outDir = tmpOutDir();
  const { declDir, jsonlPath } = outFilePaths('slot', 'notool-file', outDir);
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'notool-file', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeNoToolCallProvider), writeLine: () => {},
  });
  const fileRaw = readFileSync(join(declDir, 'draft-1.json'), 'utf8');
  assert.notEqual(fileRaw.trim(), 'null', 'RED (pre-fix): draft-1.json is the literal null — the refused text is gone');
  const parsed = JSON.parse(fileRaw);
  assert.equal(parsed.declaration, null);
  assert.equal(parsed.outcome, 'no-tool-call');
  assert.equal(parsed.textInstead, 'I refuse.');
  assert.ok(parsed.usage);
  assert.ok(Number.isInteger(parsed.rounds));

  const row = JSON.parse(readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim())[0]);
  assert.equal(row.hasTextInstead, true);
  assert.ok(!('declaration' in row));
});

test('provider-red draft file keeps outcome:provider-red and the provider message; cost stays at the ceiling, never 0/null', async () => {
  const outDir = tmpOutDir();
  const { declDir, jsonlPath } = outFilePaths('slot', 'red-file', outDir);
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'red-file', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider('read ECONNRESET')), writeLine: () => {},
  });
  const parsed = JSON.parse(readFileSync(join(declDir, 'draft-1.json'), 'utf8'));
  assert.equal(parsed.declaration, null);
  assert.equal(parsed.outcome, 'provider-red');
  assert.equal(parsed.providerRedMessage, 'read ECONNRESET');
  assert.ok(!('textInstead' in parsed));

  const row = JSON.parse(readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim())[0]);
  assert.equal(row.costUnknown, false);
  assert.ok(row.costUsd > 0);
  assert.equal(row.hasTextInstead, false);
});

test('timeout draft file keeps outcome:timeout and never hangs the test', async () => {
  const outDir = tmpOutDir();
  const { declDir } = outFilePaths('slot', 'timeout-file', outDir);
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'timeout-file', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeHangingProvider), deadlineMs: 20, writeLine: () => {},
  });
  const parsed = JSON.parse(readFileSync(join(declDir, 'draft-1.json'), 'utf8'));
  assert.equal(parsed.declaration, null);
  assert.equal(parsed.outcome, 'timeout');
  assert.ok(typeof parsed.wallMs === 'number' && parsed.wallMs >= 0);
});

test('a draft WITH a declaration writes the declaration byte-for-byte unchanged from before this fix (unwrapped, no outcome wrapper)', async () => {
  const outDir = tmpOutDir();
  const { declDir } = outFilePaths('slot', 'green-file', outDir);
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider),
  });
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'green-file', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider), writeLine: () => {},
  });
  const fileRaw = readFileSync(join(declDir, 'draft-1.json'), 'utf8');
  assert.equal(fileRaw, JSON.stringify(record.declaration, null, 2));
  const parsed = JSON.parse(fileRaw);
  assert.ok(!('outcome' in parsed), 'a real declaration must never be wrapped in the no-declaration shape');
});

test('--rescore treats a no-declaration wrapper object exactly like a legacy bare null, and never overwrites either', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'rescore-mixed', outDir);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(declDir, { recursive: true });
  writeFileSync(jsonlPath, [
    { i: 1, grammar: 'slot' },
    { i: 2, grammar: 'slot' },
    { i: 3, grammar: 'slot' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // A real ASSEMBLED declaration (assembleDeclaration's own shape — "skills"/derived "close"
  // included), same as what a live draft actually writes to disk.
  const realDeclarationRecord = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(fakeConformingProvider),
  });
  // 1: legacy bare null (old evidence, must keep working).
  writeFileSync(join(declDir, 'draft-1.json'), 'null');
  // 2: new no-declaration wrapper object.
  writeFileSync(join(declDir, 'draft-2.json'), JSON.stringify({
    declaration: null, outcome: 'no-tool-call', textInstead: 'nope', usage: { inputTokens: 1, outputTokens: 1 }, rounds: 1, wallMs: 5,
  }, null, 2));
  // 3: a real declaration.
  writeFileSync(join(declDir, 'draft-3.json'), JSON.stringify(realDeclarationRecord.declaration, null, 2));

  const before1 = readFileSync(join(declDir, 'draft-1.json'), 'utf8');
  const before2 = readFileSync(join(declDir, 'draft-2.json'), 'utf8');
  const before3 = readFileSync(join(declDir, 'draft-3.json'), 'utf8');

  const { records } = rescoreSlotBatch({
    grammar: 'slot', tag: 'rescore-mixed', outDir, proseText: PROSE_TEXT, writeLine: () => {}, dateStr: '2026-09-21',
  });

  assert.equal(records.length, 3);
  assert.equal(records[0].validator, null, 'legacy bare null');
  assert.equal(records[0].slot, null);
  assert.equal(records[1].validator, null, 'new no-declaration wrapper');
  assert.equal(records[1].slot, null);
  assert.equal(records[2].validator.verdict, 'green', 'real declaration still scores');
  assert.equal(records[2].slot.verdict, 'green');

  // nothing on disk was overwritten.
  assert.equal(readFileSync(join(declDir, 'draft-1.json'), 'utf8'), before1);
  assert.equal(readFileSync(join(declDir, 'draft-2.json'), 'utf8'), before2);
  assert.equal(readFileSync(join(declDir, 'draft-3.json'), 'utf8'), before3);
});

test('PROOF the test can fail: a no-declaration wrapper is never mistaken for a real declaration by validate()', async () => {
  const outDir = tmpOutDir();
  const { jsonlPath, declDir } = outFilePaths('slot', 'rescore-wrapper-only', outDir);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(declDir, { recursive: true });
  writeFileSync(jsonlPath, `${JSON.stringify({ i: 1, grammar: 'slot' })}\n`);
  writeFileSync(join(declDir, 'draft-1.json'), JSON.stringify({ declaration: null, outcome: 'unknown', wallMs: 1 }, null, 2));
  const { records } = rescoreSlotBatch({
    grammar: 'slot', tag: 'rescore-wrapper-only', outDir, proseText: PROSE_TEXT, writeLine: () => {}, dateStr: '2026-09-21',
  });
  assert.equal(records[0].validator, null);
  assert.equal(records[0].slot, null);
});

// ---------------------------------------------------------------------------
// Secret redaction — a real provider (or model) can echo the presented key
// back in its own response text (OpenAI-style 401 bodies do exactly this).
// "our code never puts the header in a message" is not the same claim as
// "the message can never contain the key" — the PROVIDER'S OWN response
// body is external text this script does not control. `redactSecrets` is
// the mechanism: a literal split/join replacement (never a RegExp built
// from input) applied at the one point each field becomes persisted state.
// ---------------------------------------------------------------------------

test('redactSecrets: replaces every occurrence of each secret with the fixed literal [redacted-key]', () => {
  const text = 'key=SECRET12345 and again SECRET12345 done';
  assert.equal(redactSecrets(text, ['SECRET12345']), 'key=[redacted-key] and again [redacted-key] done');
});

test('redactSecrets: handles two distinct secrets in the same text', () => {
  const text = 'a=AAAAAAAA1 b=BBBBBBBB2';
  assert.equal(redactSecrets(text, ['AAAAAAAA1', 'BBBBBBBB2']), 'a=[redacted-key] b=[redacted-key]');
});

test('redactSecrets: a "Bearer <key>" echo is redacted too — nothing more clever than literal replacement is needed', () => {
  const text = 'sent header Authorization: Bearer SECRETKEY1 to the provider';
  assert.equal(redactSecrets(text, ['SECRETKEY1']), 'sent header Authorization: Bearer [redacted-key] to the provider');
});

test('redactSecrets: a secret shorter than 8 characters is never redacted (an empty/short env var can never blank ordinary text)', () => {
  const text = 'the word cat appears here';
  assert.equal(redactSecrets(text, ['cat']), text);
});

test('redactSecrets: non-string input is returned unchanged', () => {
  assert.equal(redactSecrets(null, ['abcdefgh']), null);
  assert.equal(redactSecrets(undefined, ['abcdefgh']), undefined);
  const obj = { a: 1 };
  assert.equal(redactSecrets(obj, ['abcdefgh']), obj);
});

test('redactSecrets: an empty secrets list (the default) returns the text unchanged', () => {
  assert.equal(redactSecrets('hello world', []), 'hello world');
  assert.equal(redactSecrets('hello world'), 'hello world');
});

test('PROOF the test can fail: redactSecrets actually rewrites text containing the secret (sanity against a no-op stub)', () => {
  assert.notEqual(redactSecrets('contains ABCDEFGH12 here', ['ABCDEFGH12']), 'contains ABCDEFGH12 here');
});

test('a thrown provider error echoing the live key is redacted before it touches disk, in BOTH the artifact and the jsonl row', async () => {
  const outDir = tmpOutDir();
  const { declDir, jsonlPath } = outFilePaths('slot', 'secret-red', outDir);
  const secret = 'FAKE-SECRET-1234567890';
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'secret-red', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider(`Incorrect API key provided: ${secret}. You can find your key at https://example.invalid/keys.`)),
    writeLine: () => {},
    secrets: [secret],
  });
  const fileRaw = readFileSync(join(declDir, 'draft-1.json'), 'utf8');
  const jsonlRaw = readFileSync(jsonlPath, 'utf8');
  assert.ok(!fileRaw.includes(secret), `RED (pre-fix): the secret leaked into draft-1.json: ${fileRaw}`);
  assert.ok(!jsonlRaw.includes(secret), `RED (pre-fix): the secret leaked into the jsonl row: ${jsonlRaw}`);
  assert.ok(fileRaw.includes('[redacted-key]'), 'the artifact must carry the redaction marker');
  assert.ok(jsonlRaw.includes('[redacted-key]'), 'the jsonl row must carry the redaction marker too');
});

test('model text-instead output echoing the live key is redacted before it touches disk', async () => {
  const outDir = tmpOutDir();
  const { declDir } = outFilePaths('slot', 'secret-text', outDir);
  const secret = 'FAKE-SECRET-ABCDEFGH99';
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'secret-text', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeNoToolCallProviderWithText(`My key is ${secret}, sorry I can't call the tool.`)),
    writeLine: () => {},
    secrets: [secret],
  });
  const fileRaw = readFileSync(join(declDir, 'draft-1.json'), 'utf8');
  assert.ok(!fileRaw.includes(secret), `RED (pre-fix): the secret leaked into draft-1.json: ${fileRaw}`);
  assert.ok(fileRaw.includes('[redacted-key]'), 'the artifact must carry the redaction marker');
});

test('runOneDraft/runSlotBatch: default secrets=[] leaves messages byte-identical to before this fix (no regression)', async () => {
  const record = await runOneDraft({
    i: 1, grammar: 'slot', askLines: ASK_LINES, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider('read ECONNRESET')),
  });
  assert.equal(record.providerRedMessage, 'read ECONNRESET');
});

// ---------------------------------------------------------------------------
// secretsFromEnv — bare-agent's OWN provider trims the key before it ever
// goes on the wire (node_modules/bare-agent/src/provider-openai.js:74,
// `this.apiKey = options.apiKey?.trim()`), so a provider echo of the live
// key is the TRIMMED form. The CLI must never build `secrets` from the raw
// env value alone — a trailing newline/space (an un-`tr -d`'d `pass` entry)
// would then let a trimmed echo sail past `redactSecrets` untouched. One
// pure function, one call site (the CLI block), never a second builder.
// ---------------------------------------------------------------------------

test('secretsFromEnv: a trailing-newline env value yields the TRIMMED secret', () => {
  const secrets = secretsFromEnv('FAKE-SECRET-1234567890\n');
  assert.ok(secrets.includes('FAKE-SECRET-1234567890'), `expected the trimmed form in ${JSON.stringify(secrets)}`);
});

test('secretsFromEnv: when the raw value differs from its trim, BOTH forms are returned, trimmed first', () => {
  const secrets = secretsFromEnv('FAKE-SECRET-1234567890\n');
  assert.deepEqual(secrets, ['FAKE-SECRET-1234567890', 'FAKE-SECRET-1234567890\n']);
});

test('secretsFromEnv: a clean value with no leading/trailing whitespace returns just the one form (no duplicate)', () => {
  assert.deepEqual(secretsFromEnv('FAKE-SECRET-1234567890'), ['FAKE-SECRET-1234567890']);
});

test('secretsFromEnv: undefined, empty, and whitespace-only values all yield []', () => {
  assert.deepEqual(secretsFromEnv(undefined), []);
  assert.deepEqual(secretsFromEnv(''), []);
  assert.deepEqual(secretsFromEnv('   '), []);
});

test('PROOF the test can fail: secretsFromEnv does not return [] for a real, non-empty key', () => {
  assert.notDeepEqual(secretsFromEnv('FAKE-SECRET-1234567890'), []);
});

test('end to end: a provider echo of the TRIMMED key is caught even though the env value carried a trailing newline', async () => {
  const outDir = tmpOutDir();
  const { declDir, jsonlPath } = outFilePaths('slot', 'secret-untrimmed-env', outDir);
  const trimmedSecret = 'FAKE-SECRET-1234567890';
  const rawEnvValue = `${trimmedSecret}\n`; // an un-tr'd `pass` entry, exactly the live incident's shape
  await runSlotBatch({
    grammar: 'slot', n: 1, tag: 'secret-untrimmed-env', outDir, facts: REAL_FACTS, proseText: PROSE_TEXT,
    providerForDraft: providerForDraftOf(() => fakeThrowingProvider(`Incorrect API key provided: ${trimmedSecret}. See https://example.invalid/keys.`)),
    writeLine: () => {},
    secrets: secretsFromEnv(rawEnvValue),
  });
  const fileRaw = readFileSync(join(declDir, 'draft-1.json'), 'utf8');
  const jsonlRaw = readFileSync(jsonlPath, 'utf8');
  assert.ok(!fileRaw.includes(trimmedSecret), `RED (pre-fix, secrets: ['${rawEnvValue}'] built from the raw env value alone): the trimmed key leaked into draft-1.json: ${fileRaw}`);
  assert.ok(!jsonlRaw.includes(trimmedSecret), `RED (pre-fix, secrets: ['${rawEnvValue}'] built from the raw env value alone): the trimmed key leaked into the jsonl row: ${jsonlRaw}`);
  assert.ok(fileRaw.includes('[redacted-key]'));
  assert.ok(jsonlRaw.includes('[redacted-key]'));
});
