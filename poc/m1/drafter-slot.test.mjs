// M1 — proves poc/m0/drafter.mjs's ADDITIVE `slotGrammar`/`askLines` option
// (item 2 of the M1 brief): with slotGrammar the menu text sent to the model
// has no "checkpoint" and a "SIGNED ASK SLOTS" block names the signed line;
// without it (the default, byte-identical to before this option existed),
// "checkpoint" is present and no such block appears at all. Written BEFORE
// the option exists in drafter.mjs — the slotGrammar-true assertions below
// are the RED this file starts at (checkpoint would still be present, no
// block would appear, because the option is a no-op until drafter.mjs is
// edited); the default-path assertions are already true today and stay true.
//
// $0, zero network — same fakeProvider/toolReply discipline as
// poc/m0/drafter.test.mjs (not imported from there; that file exports
// neither helper, so this is a second, small copy of the same shape, kept
// local to this file only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDrafter } from '../m0/drafter.mjs';
import { lookFixtures, groundFacts } from '../m0/scout.mjs';
import { parseAskSlots } from './slots.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CSV_PATH = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
const TEXT_PATH = join(REPO_ROOT, 'fixtures', 'message.txt');
const GOLDEN_PROMPT_PATH = join(__dirname, 'fixtures', 'default-prompt-golden.txt');

function realFacts() {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  return groundFacts({ csvColumns: csvArtifact.header }, { csvArtifact, textArtifact });
}
const REAL_FACTS = realFacts();

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

function toolReply(args) {
  return {
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_declaration', arguments: args }],
    usage: { inputTokens: 200, outputTokens: 150 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  };
}

// prose.txt's real, signed "ask at line 5" (poc/m0/prose.txt), read through
// the same parser the batch script uses — never a hand-typed [5] here.
const PROSE_TEXT = readFileSync(join(REPO_ROOT, 'poc', 'm0', 'prose.txt'), 'utf8');
const { lines: ASK_LINES } = parseAskSlots(PROSE_TEXT);

function systemPromptOf(provider) {
  return provider.calls[0].messages.find((m) => m.role === 'system').content;
}

test('slotGrammar=false (default): the menu text includes "checkpoint" and carries no SIGNED ASK SLOTS block', async () => {
  const provider = fakeProvider(toolReply({ steps: [], guardrailClasses: {} }));
  await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 }, facts: REAL_FACTS });
  const content = systemPromptOf(provider);
  assert.match(content, /- checkpoint:/, 'default menu must still offer "checkpoint" — nothing changes without opting in');
  assert.doesNotMatch(content, /SIGNED ASK SLOTS/);
});

test('slotGrammar=false (default): the assembled prompt is byte-identical to the golden snapshot captured before this option existed', async () => {
  const provider = fakeProvider(toolReply({ steps: [], guardrailClasses: {} }));
  await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 }, facts: REAL_FACTS });
  const content = systemPromptOf(provider);
  const golden = readFileSync(GOLDEN_PROMPT_PATH, 'utf8');
  assert.equal(content, golden, 'the default path must never change one byte of the prompt/menu text this option was added beside');
});

test('slotGrammar=true: the menu text excludes "checkpoint" and the SIGNED ASK SLOTS block names the signed line', async () => {
  const provider = fakeProvider(toolReply({ steps: [], guardrailClasses: {} }));
  const report = await runDrafter('fake-model', {
    prose: true, provider, rates: { in: 0, out: 0 }, facts: REAL_FACTS, slotGrammar: true, askLines: ASK_LINES,
  });
  assert.equal(report.toolCalled, true, 'a real askLines array must let the round actually run, never refuse');
  const content = systemPromptOf(provider);
  assert.doesNotMatch(content, /- checkpoint:/, 'slotGrammar must strip "checkpoint" from the menu the model is shown');
  assert.match(content, /SIGNED ASK SLOTS: line\(s\) 5\./, 'the block must name the real signed ask line, 5');
  // 2026-09-21: the refusal sentence must name "hitl" — a zero-primitive
  // step at an unsigned line is only a refused pause when it ALSO waits on
  // a human (poc/m1/slots.mjs check (c)); JOB1_NEEDS' own, no-primitive
  // derive step is neither a pause nor refused.
  assert.match(
    content,
    /A step with no primitives that waits on a human \(hitl\) at an unsigned line is refused\./,
    'the refusal sentence must match slots.mjs check (c)\'s actual, hitl-qualified rule',
  );
});

test('PROOF the test can fail: a plain runDrafter call (no slotGrammar) still shows "checkpoint" even when askLines is passed', async () => {
  const provider = fakeProvider(toolReply({ steps: [], guardrailClasses: {} }));
  await runDrafter('fake-model', {
    prose: true, provider, rates: { in: 0, out: 0 }, facts: REAL_FACTS, askLines: ASK_LINES, // slotGrammar omitted -> false
  });
  const content = systemPromptOf(provider);
  assert.match(content, /- checkpoint:/, 'askLines alone, without slotGrammar:true, must change nothing');
  assert.doesNotMatch(content, /SIGNED ASK SLOTS/);
});

test('slotGrammar=true with no askLines refuses at $0 — never drafts without signed slots', async () => {
  const provider = fakeProvider(toolReply({ steps: [], guardrailClasses: {} }));
  const report = await runDrafter('fake-model', {
    prose: true, provider, rates: { in: 0, out: 0 }, facts: REAL_FACTS, slotGrammar: true, // askLines omitted
  });
  assert.equal(report.toolCalled, false);
  assert.equal(provider.calls.length, 0, 'the provider must never be called at all — this refusal costs exactly $0');
  assert.equal(report.costUsd, null);
});

test('slotGrammar=true with an empty askLines array also refuses — empty is not signed', async () => {
  const provider = fakeProvider(toolReply({ steps: [], guardrailClasses: {} }));
  const report = await runDrafter('fake-model', {
    prose: true, provider, rates: { in: 0, out: 0 }, facts: REAL_FACTS, slotGrammar: true, askLines: [],
  });
  assert.equal(report.toolCalled, false);
  assert.equal(provider.calls.length, 0);
});
