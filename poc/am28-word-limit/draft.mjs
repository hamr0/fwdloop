// M4e amendment 28/29 POC — one drafter round per job (plus ONE structure retry on a broken call) with the am29 wording. NOT the product.
// borrowed-from: src/drafter.js@43a9f77 (the real system prompt, schema, forced tool call, per-round metering, thinking disabled).
//
// src/drafter.js bakes the "smallest wins" sentence into module constants and has no override seam, so this file builds the
// round from the REAL exports (buildSystemPrompt, NOTCHECKED_PROMPT, buildRoundSchema, DRAFT_PROVIDER_OPTIONS) and replaces that
// ONE sentence with the am29 sentence in both the prompt and the schema. The model does NOT write wordsPerSection (code reads it from
// the guardrail, am15 item 1). Nothing in src changes. Each call is metered via Loop's onLlmResult.
// Retry rule copied from src/drafter.js (structure retry: same system prompt, a user message naming why the last reply was unusable);
// am29 signs ONE retry, where the real drafter's MAX_STRUCTURE_RETRIES is 2. A provider throw is not retried (as in the real drafter).

import { Loop, HaltError } from 'bare-agent';
import { parseSignedText, unsignedAskTtls } from '../../src/signed-text.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { wiredMenu } from '../../src/primitives.js';
import { readInputFacts } from '../../src/input-facts.js';
import { makeProvider, sumMeterings, ceilingCostUsd } from '../../src/provider.js';
import {
  buildRoundSchema, buildSystemPrompt, NOTCHECKED_PROMPT, WHOLE_OUTPUT_CEILING_RULE, DRAFT_PROVIDER_OPTIONS, DRAFT_MAX_TOKENS, DRAFT_SKILLS,
} from '../../src/drafter.js';

const TOOL = 'emit_declaration';
/** Signed in amendment 29: "use the guardrail's ceiling for the whole output". */
export const AM28_RULE = "use the guardrail's ceiling for the whole output";
export const POC_STRUCTURE_RETRIES = 1;

/** The real schema + system prompt. Since am29 landed in src/drafter.js the product carries the sentence itself, so there is no swap; throws if it is missing. */
export function am28Setup({ menu, lines, arbiter, factsInfo }) {
  const system = `${buildSystemPrompt({ menu, lines, arbiter, factsInfo })}\n\n${NOTCHECKED_PROMPT}`;
  const schema = buildRoundSchema(menu);
  if (WHOLE_OUTPUT_CEILING_RULE !== AM28_RULE || !JSON.stringify(schema).includes(AM28_RULE) || !system.includes(AM28_RULE)) {
    throw new Error('am28Setup: the product drafter does not carry the am29 sentence in both the prompt and the schema');
  }
  return { system, schema };
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
  let userText = `Call ${TOOL} now.`;
  let calls = 0;
  let result;
  let stop = null;
  let stopReason = null;
  let unmetered = 0;
  for (let attempt = 0; attempt <= POC_STRUCTURE_RETRIES; attempt += 1) {
    captured = undefined;
    calls += 1;
    const before = events.length;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await loop.run(
        [{ role: 'system', content: system }, { role: 'user', content: userText }],
        [tool],
        { maxTokens: DRAFT_MAX_TOKENS, toolChoice: { name: TOOL } },
      );
    } catch (err) { stop = 'provider-red'; stopReason = err.message; if (events.length === before) unmetered += 1; break; }
    if (events.length === before) unmetered += 1;
    if (captured && typeof captured === 'object' && !Array.isArray(captured)) break;
    const malformed = provider?.lastMalformedToolCall ?? null;
    const why = result?.stopReason === 'max_tokens' ? 'truncated: the round hit the output cap with no completed tool call'
      : malformed ? `the tool call's arguments were not valid JSON (${malformed.error})`
        : 'no usable tool call (text instead of the tool)';
    stop = 'structure'; stopReason = why;
    userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
  }
  const gotCall = captured && typeof captured === 'object' && !Array.isArray(captured);
  if (gotCall && stop === 'structure') { stop = null; stopReason = null; }
  const m = sumMeterings(events);
  const out = {
    ...base, stop, stopReason, rounds: m.rounds, calls, tokens: m.tokens, costUsd: unmetered ? null : m.costUsd,
    spendComplete: unmetered === 0 && m.costUsd !== null, modelReturned: m.model,
  };
  if (stop) return out;
  return { ...out, stop: null, steps: Array.isArray(captured.steps) ? captured.steps : [] };
}
