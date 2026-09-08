// Part 1 — DRAFTER. One paid round per model. Give the model the step-kind
// menu (PRD §5) + the citation schema + hamr's steps.txt; it answers ONLY via
// `emit_declaration`. It may merge/split hamr's steps but must NOT emit the
// cap, an ask's position, or the send target — those are arbiter fields
// (PRD §5: "trigger, cap, askTtlMs, egress, and every ask step's position
// are arbiter fields: human-authored, inexpressible to the drafter").
//
// Usage: SYNTHETIC_API_KEY="..." node poc/m0/drafter.mjs <model-id> [--ungroundable]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { OpenAI } from 'bare-agent/providers';
import { assertUnderGlobalCap, appendSpendRow, RATES_BY_SUFFIX, RUN_CAP_USD } from './spend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');
const STEPS_PATH = join(__dirname, 'steps.txt');

const STEP_KIND_MENU = `
Step kinds (menu, frozen — anything else is a red at validation):

| kind | does | effect check (always) | grounding close (where prose) |
|---|---|---|---|
| gather | read inbox / sheet / doc / url -> typed artifact | artifact non-empty, source hash recorded | - |
| derive | compute, match, verify from artifacts | output non-empty | every figure cites a source; cited == stated |
| compose | summary / mail draft from artifacts | output > 0 bytes, shape valid | every claim cites; no uncited figure |
| ask | render question + evidence, PAUSE | disposition recorded with exact words | - |
| send | egress: mail / chat / file | delivery id / file path captured | target in signed allow-list; prior ask accept this run |
| remember | write facts to memory (supersede by id) | row count or hash changed | schema valid | (unused in this job)

Citation schema, three forms:
// copied figure — one pointer, one value
{ "id": "c1", "value": 25690, "asStated": "25,690.00",
  "source": { "kind": "csv", "artifact": "a3", "row": 2, "col": "Balance", "cell": "G2" } }
// derived figure — a formula over cited inputs; the close recomputes it
{ "id": "c4", "value": 1750, "formula": "sum", "inputs": ["c1", "c2", "c3"] }
// text evidence — a quote that must appear verbatim at the pointer
{ "id": "c7", "quote": "Acme", "source": { "kind": "text", "artifact": "a1", "line": 1 } }

Closed formula grammar: sum, count, min, max, sub, daysBetween. No expression evaluation.
A quote must be a verbatim substring of the pointed line. A name match between a message and
a sheet is a quote citation + the row's cell; if more than one row could match, that step must
be flagged (never picked) — the runner decides ambiguity mechanically, you only report it.

Arbiter fields — YOU DO NOT EMIT THESE, EVER: the cap ($ limit), an ask step's position in the
sequence (guardrails already state where the human wants to be asked — respect it, don't
restate or move it), the send target/destination. If hamr's steps ask you to put a stop
somewhere, put an "ask" step there — but never invent or restate a $ cap or a send target as a
declaration field.

If a hamr step cannot be expressed as a typed, cited artifact under this schema (e.g. it asks
for a subjective judgment with no verifiable ground truth), you MUST refuse it via
"refuse_step" with a one-line reason, instead of inventing a proxy check.
`.trim();

const DECLARATION_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['gather', 'derive', 'compose', 'ask', 'send', 'remember'] },
          goal: { type: 'string', description: 'one line' },
          inputs: { type: 'array', items: { type: 'string' }, description: 'artifact ids this step reads' },
          figures: { type: 'array', items: { type: 'string' }, description: 'for derive/compose: figure ids this step will emit' },
        },
        required: ['kind', 'goal', 'inputs'],
      },
    },
    refused: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hamrStepText: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['hamrStepText', 'reason'],
      },
    },
  },
  required: ['steps'],
};

export async function runDrafter(modelId, { ungroundable = false, runLabel = 'drafter' } = {}) {
  const apiKey = process.env.SYNTHETIC_API_KEY;
  if (!apiKey) throw new Error('SYNTHETIC_API_KEY is not set');

  const suffix = modelId.replace(/^hf:/, '');
  const rates = RATES_BY_SUFFIX[suffix];
  if (!rates) throw new Error(`no hand-entered rate for model suffix "${suffix}"`);

  assertUnderGlobalCap(SPEND_PATH);
  mkdirSync(OUT_DIR, { recursive: true });

  let stepsText = readFileSync(STEPS_PATH, 'utf8');
  if (ungroundable) {
    stepsText = stepsText.replace(
      'guardrails:',
      '7. rate how friendly the customer sounds\nguardrails:',
    );
  }

  const provider = new OpenAI({ apiKey, model: modelId, baseUrl: 'https://api.synthetic.new/openai/v1' });

  let capturedArgs = null;
  let capturedText = null;
  const tools = [{
    name: 'emit_declaration',
    description: 'Emit the flow declaration over the fixed step-kind menu, or refuse a step you cannot ground.',
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
    { role: 'system', content: `You are the fwdloop drafter. You answer ONLY by calling emit_declaration — never plain text. ${STEP_KIND_MENU}` },
    { role: 'user', content: `hamr's steps + guardrails for job #1:\n\n${stepsText}\n\nCall emit_declaration now.` },
  ];

  const startedAt = Date.now();
  await loop.run(messages, tools, { maxTokens: 4000 });
  const wallMs = Date.now() - startedAt;

  const suffixMatch = metering?.model != null && metering.model.replace(/^hf:/, '') === suffix;
  const costUsd = metering?.costUsd ?? null;

  appendSpendRow(SPEND_PATH, {
    runId: runLabel, step: 'draft', model: modelId, modelReturned: metering?.model ?? null,
    tokens: metering?.usage ?? null, costUsd, rateSource: metering?.rateSource ?? null, wallMs,
  });

  if (costUsd !== null && costUsd > RUN_CAP_USD) {
    console.error(`WARNING: draft round cost $${costUsd} exceeds the per-run $${RUN_CAP_USD} cap (informational only for M0's single-round draft)`);
  }

  const report = {
    modelRequested: modelId, modelReturned: metering?.model ?? null, suffixMatch,
    toolCalled: capturedArgs != null, declaration: capturedArgs, textInstead: capturedArgs ? null : capturedText,
    usage: metering?.usage ?? null, costUsd, rateSource: metering?.rateSource ?? null, wallMs,
    ungroundable,
  };
  return report;
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  const modelId = process.argv[2];
  const ungroundable = process.argv.includes('--ungroundable');
  if (!modelId) {
    console.error('usage: node poc/m0/drafter.mjs <model-id> [--ungroundable]');
    process.exit(1);
  }
  const report = await runDrafter(modelId, { ungroundable, runLabel: `drafter-${suffixOf(modelId)}${ungroundable ? '-ungroundable' : ''}` });
  const outPath = join(OUT_DIR, `draft-${suffixOf(modelId).replace(/\//g, '_')}${ungroundable ? '-ungroundable' : ''}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, declaration: '(see ' + outPath + ')' }, null, 2));
}

function suffixOf(modelId) { return modelId.replace(/^hf:/, ''); }
