// POC: does bare-agent's OpenAI provider actually talk to synthetic.new, and does its metering
// payload (onLlmResult) carry real cost + usage? Only shown via raw curl so far — this is the
// bare-agent-mediated version. Not M0. No abstractions beyond what's needed to answer the question.
//
// Usage:
//   SYNTHETIC_API_KEY="$(pass show amr/synthetic_api | head -1)" node poc/probe-synthetic.mjs hf:zai-org/GLM-5.2
//   SYNTHETIC_API_KEY="$(pass show amr/synthetic_api | head -1)" node poc/probe-synthetic.mjs hf:moonshotai/Kimi-K3
//
// Exits non-zero if the tool wasn't called, usage is null, or rateSource !== 'caller'.

import { Loop } from 'bare-agent';
import { OpenAI } from 'bare-agent/providers';

const modelRequested = process.argv[2];
if (!modelRequested) {
  console.error('usage: node poc/probe-synthetic.mjs <model-id>');
  process.exit(1);
}

const apiKey = process.env.SYNTHETIC_API_KEY;
if (!apiKey) {
  console.error('SYNTHETIC_API_KEY is not set. Load it in the same shell line, e.g.:');
  console.error('  SYNTHETIC_API_KEY="$(pass show amr/synthetic_api | head -1)" node poc/probe-synthetic.mjs <model>');
  process.exit(1);
}

// List-rate ceilings, USD per 1K tokens, entered by hand on 2026-09-08 from synthetic.new's pricing
// page — these are caller-supplied rates (rateSource:'caller'), not bare-agent's built-in guesstimate.
// Keyed on the model id SUFFIX (the response echoes the model WITHOUT the "hf:" prefix).
const RATES_BY_SUFFIX = {
  'zai-org/GLM-5.2': { in: 0.0006, out: 0.0022 },
  'moonshotai/Kimi-K3': { in: 0.0006, out: 0.0025 },
};

const suffix = modelRequested.replace(/^hf:/, '');
const rates = RATES_BY_SUFFIX[suffix];
if (!rates) {
  console.error(`No hand-entered rate for model suffix '${suffix}'. Known: ${Object.keys(RATES_BY_SUFFIX).join(', ')}`);
  process.exit(1);
}

const provider = new OpenAI({
  apiKey,
  model: modelRequested,
  baseUrl: 'https://api.synthetic.new/openai/v1',
});

// loop.run()'s returned `toolCalls` field is always [] (verified against src/loop.js — every `return`
// hardcodes `toolCalls: []`; the live list only exists mid-run). Capture the real call via the
// tool's own `execute` closure instead of trusting that field.
let capturedToolArgs = null;
const tools = [{
  name: 'emit_figure',
  description: 'report the figure you were asked for',
  parameters: {
    type: 'object',
    properties: {
      value: { type: 'number' },
      cell: { type: 'string' },
      asStated: { type: 'string' },
    },
    required: ['value', 'cell', 'asStated'],
  },
  execute: async (args) => { capturedToolArgs = args; return args; },
}];

let metering = null;
const loop = new Loop({
  provider,
  rates,
  onLlmResult: async (event) => { metering = event; },
});

const messages = [
  { role: 'system', content: 'You answer only by calling emit_figure.' },
  {
    role: 'user',
    content: 'Row 2 of the sheet is: Northwind Trading,INV-1021,2026-05-10,2026-06-09,4200. '
      + 'Column E is Amount. Report the Amount with its cell.',
  },
];

const startedAt = Date.now();
const result = await loop.run(messages, tools, { maxTokens: 200 });
const wallMs = Date.now() - startedAt;

// `model` is not on loop.run()'s return value (only on the per-round onLlmResult payload) — use that.
const modelReturned = metering?.model || null;
const suffixMatch = modelReturned != null && modelReturned.replace(/^hf:/, '') === suffix;

const usage = metering?.usage
  ? {
      in: metering.usage.inputTokens ?? null,
      out: metering.usage.outputTokens ?? null,
      cacheRead: metering.usage.cacheReadTokens ?? null,
    }
  : null;

const report = {
  model_requested: modelRequested,
  model_returned: modelReturned,
  suffix_match: suffixMatch,
  tool_called: capturedToolArgs != null,
  tool_args: capturedToolArgs,
  usage,
  cost_usd: metering?.costUsd ?? null,
  rateSource: metering?.rateSource ?? null,
  wall_ms: wallMs,
};

console.log(JSON.stringify(report));

if (!report.tool_called || report.usage === null || report.rateSource !== 'caller') {
  process.exit(1);
}
