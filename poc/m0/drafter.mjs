// Part 1 — DRAFTER. One paid round per model. Give the model the PRIMITIVE
// catalogue (PRD §6 M0a, menu-is-inventory — every entry an existing
// implementation, catalogue.mjs) + the artifact-space/close-classing rules +
// hamr's steps.txt/prose.txt; it answers ONLY via `emit_declaration`. It
// authors ONLY `steps` (goal, primitives, reads, emits, close) — no step
// bodies, no plumbing, and NEVER an arbiter field (PRD §5/§6: trigger, cap,
// askTtlMs, egress, the signed skillset, and "done" are human-signed,
// inexpressible to the drafter). `skills` and `guardrails` on the final
// declaration are stitched in by THIS module from the signed grant and the
// human's own words, verbatim — never taken from the model's tool call, so
// even a model that tries to emit them is ignored, not merely discouraged.
//
// Usage:
//   SYNTHETIC_API_KEY="..." node poc/m0/drafter.mjs <model-id> [--slot synthetic|deepseek] [--prose] [--ungroundable] [--uncovered]
//   (live calls also require DRAFTER_LIVE=1 — see the CLI guard below)
//
// --ungroundable plants a line with NO groundable check at all (M0a negative
// scenario ii — must be refused via "refused", never given a proxy check).
// --uncovered plants a line WITH a groundable check but no guardrail that
// covers it (M0a negative scenario vi, "the uncovered-line plant") — it must
// land at close.class "hitl", never a green/softgreen the drafter invented
// coverage for.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { assertUnderGlobalCap, appendSpendRow, RUN_CAP_USD } from './spend.mjs';
import { makeProvider } from './provider.mjs';
import { menu } from './catalogue.mjs';
import { guardrailList } from './validator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');
const STEPS_PATH = join(__dirname, 'steps.txt');
const PROSE_PATH = join(__dirname, 'prose.txt');

/** The declaration's signed skillset for M0a's job #1. Real mail egress
 *  (catalogue.mjs's "mail-egress" skill: draftMail/sendMail) is explicitly
 *  out of scope here (PRD §6 M9) — job #1 is dry-run egress only, so the
 *  drafter is granted "core" and nothing else. */
export const DRAFTER_SKILLS = Object.freeze(['core']);

/** Fixed in code, not spec-authorable — the drafter's own output cap (F11:
 *  DeepSeek honours only the legacy `max_tokens`; provider.mjs's
 *  `legacyMaxTokens` per slot is what makes this actually bind). */
export const DRAFTER_MAX_TOKENS = 16000;

function primitiveMenuText() {
  return menu({ skills: DRAFTER_SKILLS })
    .map((e) => `- ${e.verb} (${e.component}, class: ${e.class}) — ${e.package}#${e.symbol}`)
    .join('\n');
}

const PRIMITIVE_MENU = `
Primitive catalogue (menu-is-inventory — a grant list, every entry an
existing implementation; a verb outside this list is a red at validation,
never invented):

${primitiveMenuText()}

There is no wiring layer. Steps share ONE artifact space. Each step you emit:
- "primitives": the verbs above it needs (may be empty for a step that only
  reasons over artifacts already read, e.g. matching a customer / deriving figures)
- "reads": artifact ids DECLARED BY AN EARLIER STEP ONLY — never itself, never
  a step that comes later
- "emits": exactly ONE new artifact id this step declares
You author no step bodies and no plumbing — only this declaration.

The guardrails below are a NUMBERED LIST. Your steps are a second list. You are
mapping one onto the other: every close points at a guardrail BY ITS NUMBER.
| guardrail | close it produces |
|---|---|
| "every number must point to the cell/formula it came from" | green — tracesTo that guardrail's number |
| a declared SHAPE the human wrote (e.g. "one line per invoice") | softgreen — tracesTo that guardrail's number |
| "ask me" / "check with me" / "nothing goes out before I accept" | hitl (an ask/send step), position as the human wrote it |

"tracesTo" is the NUMBER of one guardrail — an integer, nothing else. Do not
paraphrase a guardrail, do not quote one, do not invent a number that is not in
the list. A step whose check is covered by NO guardrail falls to hitl — NEVER
green, NEVER a softgreen shape you invented coverage for. Unsure = hitl, always.
A step you say nothing about is hitl too, so silence is safe and guessing is not.

Arbiter fields — YOU DO NOT EMIT THESE, EVER, under any field name: the
trigger, the $ cap, an ask/send step's POSITION in the sequence (guardrails
already state where; respect it, never restate or move it), the egress
allow-list or send target, the signed skillset, or what "done" means for the
whole flow. If a line asks for a stop somewhere, that is a hitl step — never
a restated cap or destination.

If a line cannot be expressed as a typed, cited artifact at all (e.g. it asks
for a subjective judgment with no groundable check whatsoever — not even a
human check), put it in "refused" with a one-line reason instead of
inventing a proxy check or a primitive that does not exist.
`.trim();

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'one line: what this step is for' },
    primitives: {
      type: 'array', items: { type: 'string' }, description: 'verbs granted in the catalogue above — never invented',
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
  // `close` is deliberately NOT required: a step the drafter says nothing
  // about is hitl (ruled 2026-09-10), so silence must be expressible rather
  // than forced into a guess.
  required: ['goal', 'primitives', 'reads', 'emits'],
};

const DECLARATION_SCHEMA = {
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

/**
 * Extract the guardrails block verbatim (the human's own words) from the
 * prose/steps text — everything after a "guardrails:" line (case-insensitive)
 * to the end of the text. Returns '' if no such marker exists — never
 * invents one. Pure function: this is the ONE place `declaration.guardrails`
 * comes from, so the validator's tracesTo matching is checkable against it.
 */
export function extractGuardrails(rawText) {
  const match = /guardrails:[ \t]*\r?\n([\s\S]*)$/i.exec(String(rawText ?? ''));
  return match ? match[1].trim() : '';
}

/**
 * Assemble the final declaration. `skills` and `guardrails` are ALWAYS the
 * harness-supplied values, NEVER read from the model's tool-call args — the
 * mechanical form of "the drafter does not author arbiter fields": even a
 * model that tries to emit its own `skills`/`guardrails` is ignored, not
 * merely discouraged by the prompt.
 */
export function assembleDeclaration(modelArgs, { skills = DRAFTER_SKILLS, guardrails = '' } = {}) {
  return {
    skills: [...skills],
    guardrails,
    steps: Array.isArray(modelArgs?.steps) ? modelArgs.steps : [],
    refused: Array.isArray(modelArgs?.refused) ? modelArgs.refused : [],
  };
}

const UNGROUNDABLE_LINE = 'rate how friendly the customer sounds';
const UNCOVERED_LINE = 'flag anything that looks unusual';

/**
 * Plant one extra job line BEFORE the "Guardrails:" marker — for negative
 * scenario (ii) (`UNGROUNDABLE_LINE`: no check at all is expressible, must
 * be refused) or (vi) (`UNCOVERED_LINE`: a real, groundable check with no
 * guardrail covering it, must land at hitl). Never touches the guardrails
 * block itself, so `extractGuardrails` on the result is unaffected.
 */
export function plantLine(rawText, line, { prose }) {
  return prose
    ? rawText.replace('\n\nGuardrails:', ` Also ${line}.\n\nGuardrails:`)
    : rawText.replace(/guardrails:/i, `7. ${line}\nguardrails:`);
}

export async function runDrafter(modelId, {
  ungroundable = false, uncovered = false, runLabel = 'drafter', slot = 'synthetic', prose = false,
  provider: injectedProvider, rates: injectedRates,
} = {}) {
  let provider = injectedProvider;
  let rates = injectedRates;
  let suffix = modelId.replace(/^hf:/, '');
  const live = injectedProvider == null;
  if (live) {
    assertUnderGlobalCap(SPEND_PATH);
    ({ provider, rates, suffix } = makeProvider(slot, { model: modelId }));
  }
  mkdirSync(OUT_DIR, { recursive: true });

  let stepsText = readFileSync(prose ? PROSE_PATH : STEPS_PATH, 'utf8');
  if (ungroundable) stepsText = plantLine(stepsText, UNGROUNDABLE_LINE, { prose });
  if (uncovered) stepsText = plantLine(stepsText, UNCOVERED_LINE, { prose });

  const guardrails = extractGuardrails(stepsText);

  let capturedArgs = null;
  let capturedText = null;
  const tools = [{
    name: 'emit_declaration',
    description: 'Emit the flow declaration over the granted primitive catalogue, or refuse a line you cannot ground at all.',
    parameters: DECLARATION_SCHEMA,
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
    { role: 'system', content: `You are the fwdloop drafter. You answer ONLY by calling emit_declaration — never plain text. ${PRIMITIVE_MENU}` },
    {
      role: 'user',
      content: `hamr's steps + guardrails for job #1:\n\n${stepsText}\n\n`
        + `The guardrails, numbered — "tracesTo" is one of these numbers:\n`
        + `${guardrailList(guardrails).map((g) => `${g.n}. ${g.text}`).join('\n')}\n\n`
        + 'Call emit_declaration now.',
    },
  ];

  const startedAt = Date.now();
  await loop.run(messages, tools, { maxTokens: DRAFTER_MAX_TOKENS });
  const wallMs = Date.now() - startedAt;

  const suffixMatch = metering?.model != null && metering.model.replace(/^hf:/, '') === suffix;
  const costUsd = metering?.costUsd ?? null;

  if (live) {
    appendSpendRow(SPEND_PATH, {
      runId: runLabel, step: 'draft', model: modelId, modelReturned: metering?.model ?? null,
      tokens: metering?.usage ?? null, costUsd, rateSource: metering?.rateSource ?? null, wallMs,
    });
    if (costUsd !== null && costUsd > RUN_CAP_USD) {
      console.error(`WARNING: draft round cost $${costUsd} exceeds the per-run $${RUN_CAP_USD} cap (informational only for M0's single-round draft)`);
    }
  }

  const declaration = capturedArgs != null ? assembleDeclaration(capturedArgs, { guardrails }) : null;

  const report = {
    modelRequested: modelId, modelReturned: metering?.model ?? null, suffixMatch,
    toolCalled: capturedArgs != null, declaration, textInstead: capturedArgs ? null : capturedText,
    usage: metering?.usage ?? null, costUsd, rateSource: metering?.rateSource ?? null, wallMs,
    ungroundable, uncovered,
  };
  return report;
}

// CLI entry point — live, opt-in ONLY (DRAFTER_LIVE=1), same discipline as
// scout.mjs: never runs under `npm test` (node --test never executes this
// block; no test file imports it), and a stray manual invocation without the
// flag refuses instead of silently spending money.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.DRAFTER_LIVE !== '1') {
    console.error('A live drafter round costs real money — set DRAFTER_LIVE=1 to run it. Refusing.');
    process.exit(1);
  }
  const modelId = process.argv[2];
  const ungroundable = process.argv.includes('--ungroundable');
  const uncovered = process.argv.includes('--uncovered');
  const prose = process.argv.includes('--prose');
  const slotIdx = process.argv.indexOf('--slot');
  const slot = slotIdx !== -1 ? process.argv[slotIdx + 1] : 'synthetic';
  if (!modelId) {
    console.error('usage: DRAFTER_LIVE=1 node poc/m0/drafter.mjs <model-id> [--slot synthetic|deepseek] [--prose] [--ungroundable] [--uncovered]');
    process.exit(1);
  }
  const shapeTag = prose ? 'prose' : 'steps';
  const tag = `${suffixOf(modelId).replace(/\//g, '_')}-${slot}-${shapeTag}${ungroundable ? '-ungroundable' : ''}${uncovered ? '-uncovered' : ''}`;
  const report = await runDrafter(modelId, {
    ungroundable, uncovered, prose, slot, runLabel: `drafter-${tag}`,
  });
  const outPath = join(OUT_DIR, `draft-${tag}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, declaration: '(see ' + outPath + ')' }, null, 2));
}

function suffixOf(modelId) { return modelId.replace(/^hf:/, ''); }
