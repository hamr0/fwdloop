// M4e amendment 28 POC — ONE drafter round per job with the am28 wording. NOT the product.
// borrowed-from: src/drafter.js@43a9f77 (the real system prompt, schema, forced tool call, per-round metering, thinking disabled).
//
// src/drafter.js bakes the "smallest wins" sentence into module constants and has no override seam, so this file builds the
// round from the REAL exports (buildSystemPrompt, NOTCHECKED_PROMPT, buildRoundSchema, DRAFT_PROVIDER_OPTIONS) and replaces that
// ONE sentence with the am28 sentence in both the prompt and the schema. It also adds `wordsPerSection` to the shape schema (today
// the machine sets it; under am28 the model writes it). Nothing in src changes. Each call is metered via Loop's onLlmResult.

import { Loop, HaltError } from 'bare-agent';
import { parseSignedText, unsignedAskTtls } from '../../src/signed-text.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { wiredMenu } from '../../src/primitives.js';
import { readInputFacts } from '../../src/input-facts.js';
import { makeProvider, sumMeterings, ceilingCostUsd } from '../../src/provider.js';
import {
  buildRoundSchema, buildSystemPrompt, NOTCHECKED_PROMPT, SMALLEST_CEILING_RULE, DRAFT_PROVIDER_OPTIONS, DRAFT_MAX_TOKENS, DRAFT_SKILLS,
} from '../../src/drafter.js';

const TOOL = 'emit_declaration';
/** Signed in amendment 28: "use the guardrail's ceiling for the whole output, and its size for each section". */
export const AM28_RULE = "use the guardrail's ceiling for the whole output, and its size for each section";
const PER_SECTION_DESC = "the size of each section in words, exactly as the guardrail states it; leave it out when the guardrail gives no size for each section";

/** The real schema + system prompt, with the one sentence swapped. Throws if the swap did not happen (a silent no-op would void the POC). */
export function am28Setup({ menu, lines, arbiter, factsInfo }) {
  const system = `${buildSystemPrompt({ menu, lines, arbiter, factsInfo })}\n\n${NOTCHECKED_PROMPT}`;
  const schema = buildRoundSchema(menu);
  const shape = schema.properties.steps.items.properties.close.properties.shape;
  const swapped = JSON.parse(JSON.stringify(schema).replaceAll(SMALLEST_CEILING_RULE, AM28_RULE));
  const sshape = swapped.properties.steps.items.properties.close.properties.shape;
  sshape.properties = { ...sshape.properties, wordsPerSection: { type: 'integer', minimum: 1, description: PER_SECTION_DESC } };
  sshape.description = `${sshape.description}, wordsPerSection`;
  const sys = system.replaceAll(SMALLEST_CEILING_RULE, AM28_RULE);
  if (JSON.stringify(shape).includes(AM28_RULE) || !JSON.stringify(sshape).includes(AM28_RULE) || !sys.includes(AM28_RULE)
    || sys.includes(SMALLEST_CEILING_RULE) || JSON.stringify(swapped).includes(SMALLEST_CEILING_RULE)) {
    throw new Error('am28Setup: the wording swap did not land in both the prompt and the schema');
  }
  return { system: sys, schema: swapped };
}

/** Draft one job in one round. Never throws on a provider/model fault (that is `stop`). `provider`/`rates`/`modelId` injectable for the $0 test. */
export async function draftOnce({
  proseText, slot = 'deepseek', model, provider: injected, rates: injectedRates, modelId: injectedModelId, env, budgetUsd = 0.10, makeProviderFn = makeProvider,
}) {
  const base = { stop: 'pre-flight', stopReason: null, steps: null, rounds: 0, calls: 0, tokens: null, costUsd: 0, spendComplete: true, modelReturned: null };
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return { ...base, stopReason: `signed-text: ${parsed.reds.join('; ')}` };
  const { lines, arbiter } = parsed;
  const pre = unsignedAskTtls(arbiter);
  if (pre.length) return { ...base, stopReason: pre.join('; ') };
  const facts = readInputFacts(arbiter.sources);
  if (!facts.ok) return { ...base, stopReason: facts.reds.join('; ') };
  let { provider, rates, modelId } = { provider: injected, rates: injectedRates, modelId: injectedModelId };
  if (provider == null) {
    try { ({ provider, rates, modelId } = makeProviderFn(slot, { model, env, ...DRAFT_PROVIDER_OPTIONS })); } catch (err) { return { ...base, stopReason: `key: ${err.message}` }; }
  }
  const cat = loadCatalogue();
  if (!cat.ok) return { ...base, stopReason: `catalogue: ${cat.reds.join('; ')}` };
  const roundCeiling = ceilingCostUsd(modelId);
  if (roundCeiling > budgetUsd) return { ...base, stopReason: `budget: below one round's worst-case cost $${roundCeiling.toFixed(4)}` };

  const { system, schema } = am28Setup({ menu: wiredMenu(DRAFT_SKILLS), lines, arbiter, factsInfo: facts.info });
  let captured;
  const tool = {
    name: TOOL,
    description: 'Emit the flow declaration over the granted primitives, or refuse lines you cannot serve.',
    parameters: schema,
    execute: async (args) => { captured = args; throw new HaltError('declaration captured', { rule: 'captured' }); },
  };
  const events = [];
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
  let result;
  let stop = null;
  let stopReason = null;
  try {
    result = await loop.run(
      [{ role: 'system', content: system }, { role: 'user', content: `Call ${TOOL} now.` }],
      [tool],
      { maxTokens: DRAFT_MAX_TOKENS, toolChoice: { name: TOOL } },
    );
  } catch (err) { stop = 'provider-red'; stopReason = err.message; }
  const m = sumMeterings(events);
  const unmetered = events.length === 0 ? 1 : 0;
  const out = {
    ...base, stop, stopReason, rounds: m.rounds, calls: 1, tokens: m.tokens, costUsd: unmetered ? null : m.costUsd,
    spendComplete: unmetered === 0 && m.costUsd !== null, modelReturned: m.model,
  };
  if (stop) return out;
  if (!captured || typeof captured !== 'object' || Array.isArray(captured)) {
    const why = result?.stopReason === 'max_tokens' ? 'truncated: the round hit the output cap with no completed tool call' : 'no usable tool call';
    return { ...out, stop: 'structure', stopReason: why };
  }
  return { ...out, stop: null, steps: Array.isArray(captured.steps) ? captured.steps : [] };
}
