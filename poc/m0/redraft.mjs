// The ONE REDRAFT ROUND — PRD §3 "The draft table is the negotiation
// surface" / §3.5 "the drafter is multi-turn, and that is where the turns
// live": the human replies to the draft table in PROSE ("merge 3 and 4",
// "make step 5 my call"), the drafter redrafts, repeat; fire only on
// agreement, and agreement is the signature. This module is ONE such round:
// (previous declaration, human's prose reply) -> a new declaration + its
// table.
//
// Why a separate file rather than adding to drafter.mjs: drafter.mjs's job
// is THE FIRST draft, built from steps.txt/prose.txt on disk. A redraft
// starts from a declaration already in hand plus a human reply — a
// different input shape and a different prompt — and drafter.mjs is a
// committed, passing module this task must not modify. Keeping the second
// round in its own file means drafter.mjs's existing tests and behaviour are
// untouched, while every piece of shared machinery (the provider/loop
// pattern, DRAFTER_SKILLS, DRAFTER_MAX_TOKENS, and — load-bearing —
// assembleDeclaration's arbiter-field filter) is IMPORTED, never
// reimplemented. There is one filter for "the model may not author an
// arbiter field" and it lives in drafter.mjs; this module calls it, it does
// not grow a second copy.
//
// borrowed-from (style only, never imported): drafter.mjs's runDrafter — the
// injected provider/rates seam, the metering/spend bookkeeping, and the
// live-opt-in CLI guard, all mirrored here for the same reasons.
//
// RULES THAT MUST SURVIVE THE REDRAFT (the point of this module):
//   - Draft-time only. Nothing here takes effect; it produces a spec.
//   - The human's prose reply may NOT introduce arbiter fields. Enforced by
//     reusing assembleDeclaration verbatim — same mechanism the first draft
//     uses, not a second filter.
//   - The guardrails DO NOT CHANGE in a redraft. They are the human's signed
//     words; passed straight through from `previousDeclaration.guardrails`
//     to assembleDeclaration, never re-derived from the reply text and never
//     taken from the model's tool call. The redraft only re-maps STEPS onto
//     the SAME numbered guardrails.
//   - `skills` likewise carries over from `previousDeclaration.skills` (the
//     signed grant), never from the model or the reply.
//   - The result must still pass validate().

import { Loop } from 'bare-agent';
import { assertUnderGlobalCap, appendSpendRow, RUN_CAP_USD } from './spend.mjs';
import { makeProvider } from './provider.mjs';
import {
  DRAFTER_MAX_TOKENS, assembleDeclaration,
} from './drafter.mjs';
import { guardrailList } from './validator.mjs';
import { renderDraftTable } from './drafttable.mjs';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');

// Mirrors drafter.mjs's STEP_SCHEMA/DECLARATION_SCHEMA exactly (not exported
// there, so copied rather than imported — the SHAPE of the tool call, not
// the arbiter-field filtering rule, which stays imported). A redraft answers
// via the same tool contract as the first draft: steps + optional refused.
const STEP_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'one line: what this step is for' },
    primitives: {
      type: 'array', items: { type: 'string' }, description: 'verbs granted in the catalogue — never invented',
    },
    reads: {
      type: 'array', items: { type: 'string' }, description: 'artifact ids this step reads, each declared by an EARLIER step',
    },
    emits: { type: 'string', description: 'the one new artifact id this step declares' },
    close: {
      type: 'object',
      properties: {
        class: { type: 'string', enum: ['green', 'softgreen', 'hitl'] },
        shape: { type: 'object', description: 'softgreen only: the declared shape' },
        tracesTo: { type: 'integer', description: 'the NUMBER of the guardrail this close comes from; omit for hitl' },
      },
    },
  },
  required: ['goal', 'primitives', 'reads', 'emits'],
};

const REDRAFT_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: STEP_SCHEMA },
    refused: {
      type: 'array',
      items: {
        type: 'object',
        properties: { hamrLine: { type: 'string' }, reason: { type: 'string' } },
        required: ['hamrLine', 'reason'],
      },
    },
  },
  required: ['steps'],
};

function redraftPromptFor(previousDeclaration, humanReply) {
  const guardrails = previousDeclaration?.guardrails ?? '';
  const numbered = guardrailList(guardrails).map((g) => `${g.n}. ${g.text}`).join('\n');
  return `Here is the current draft table:\n\n${renderDraftTable(previousDeclaration)}\n\n`
    + `The guardrails are FIXED and numbered — do not restate, reword, add, or remove any of `
    + `them; "tracesTo" is one of these numbers:\n${numbered}\n\n`
    + `The human replied with this change, in their own words:\n"${humanReply}"\n\n`
    + 'Redraft the STEPS to satisfy the reply, re-mapping each close to the SAME numbered '
    + 'guardrails above. Do not emit a trigger, cap, askTtlMs, egress, skills, or guardrails — '
    + 'those are not yours to set, and will be ignored even if you emit them. '
    + 'Call emit_declaration now with the full, redrafted step list.';
}

/**
 * Run ONE redraft round: previous declaration + the human's prose reply ->
 * a new declaration (guardrails and skills carried over unchanged) + its
 * rendered draft table. `provider`/`rates` are injectable for offline tests
 * (no network); when omitted, the real provider is built through
 * provider.mjs's makeProvider, exactly like drafter.mjs.
 */
export async function runRedraft(modelId, previousDeclaration, humanReply, {
  runLabel = 'redraft', slot = 'synthetic', provider: injectedProvider, rates: injectedRates,
} = {}) {
  let provider = injectedProvider;
  let rates = injectedRates;
  const live = injectedProvider == null;
  if (live) {
    assertUnderGlobalCap(SPEND_PATH);
    ({ provider, rates } = makeProvider(slot, { model: modelId }));
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const guardrails = typeof previousDeclaration?.guardrails === 'string' ? previousDeclaration.guardrails : '';
  const skills = Array.isArray(previousDeclaration?.skills) ? previousDeclaration.skills : [];

  let capturedArgs = null;
  let capturedText = null;
  const tools = [{
    name: 'emit_declaration',
    description: 'Emit the REDRAFTED flow declaration over the same guardrails, or refuse a line you cannot ground at all.',
    parameters: REDRAFT_SCHEMA,
    execute: async (args) => { capturedArgs = args; return { ok: true }; },
  }];

  let metering = null;
  const loop = new Loop({
    provider,
    rates,
    onLlmResult: async (event) => { metering = event; },
    onText: async (t) => { capturedText = t; },
  });

  const messages = [
    {
      role: 'system',
      content: 'You are the fwdloop drafter, in a redraft round. You answer ONLY by calling '
        + 'emit_declaration — never plain text. The guardrails are fixed and already signed; '
        + 'you only re-map steps onto them.',
    },
    { role: 'user', content: redraftPromptFor(previousDeclaration, humanReply) },
  ];

  const startedAt = Date.now();
  await loop.run(messages, tools, { maxTokens: DRAFTER_MAX_TOKENS });
  const wallMs = Date.now() - startedAt;

  const costUsd = metering?.costUsd ?? null;
  if (live) {
    appendSpendRow(SPEND_PATH, {
      runId: runLabel, step: 'redraft', model: modelId, modelReturned: metering?.model ?? null,
      tokens: metering?.usage ?? null, costUsd, rateSource: metering?.rateSource ?? null, wallMs,
    });
    if (costUsd !== null && costUsd > RUN_CAP_USD) {
      console.error(`WARNING: redraft round cost $${costUsd} exceeds the per-run $${RUN_CAP_USD} cap (informational only)`);
    }
  }

  // assembleDeclaration is drafter.mjs's ONE filter for "skills/guardrails
  // are always the harness-supplied value, never the model's" — reused
  // verbatim so a redraft cannot smuggle a changed guardrail or skillset any
  // more than a first draft can.
  const declaration = capturedArgs != null ? assembleDeclaration(capturedArgs, { skills, guardrails }) : null;

  return {
    modelRequested: modelId,
    modelReturned: metering?.model ?? null,
    toolCalled: capturedArgs != null,
    declaration,
    table: declaration != null ? renderDraftTable(declaration) : null,
    textInstead: capturedArgs ? null : capturedText,
    usage: metering?.usage ?? null,
    costUsd,
    rateSource: metering?.rateSource ?? null,
    wallMs,
    humanReply,
  };
}

// CLI entry point — live, opt-in ONLY (REDRAFT_LIVE=1), same discipline as
// drafter.mjs and scout.mjs: never runs under `npm test`, and a stray manual
// invocation without the flag refuses instead of silently spending money.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.REDRAFT_LIVE !== '1') {
    console.error('A live redraft round costs real money — set REDRAFT_LIVE=1 to run it. Refusing.');
    process.exit(1);
  }
  console.error('usage: import { runRedraft } and pass a previous declaration + reply programmatically — there is no standalone fixture for a redraft round.');
  process.exit(1);
}
