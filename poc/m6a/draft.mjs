// M6a POC — the drafter, src-shaped. NOT the product (the build rewrites it
// into src/).
//
// One forced tool call (`emit_declaration`, toolChoice by name) whose schema
// is derived from src/catalogue.json + src/declaration.js (schema.mjs). The
// model's args, plus the harness's mechanical `inputFacts`, ARE the src
// declaration — no converter. validateDeclaration decides pass/fail, with the
// WIRED-only catalogue as its catalogue, so an unwired verb reds by name.
//
// Rounds: 1 first draft + up to MAX_STRUCTURE_RETRIES when the round gave no
// usable tool call (malformed JSON, text instead, truncation) + up to
// MAX_REVISIONS when the validator reds (the reds are fed back verbatim).
// Every round is metered through Loop's onLlmResult; the tool body throws
// HaltError after capturing so no second (paid) "wrap-up" round happens.
// Unknown cost is never 0: sumMeterings gives null, and the budget check
// prices an unpriced round at the ceiling.

import { Loop, HaltError } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { validateDeclaration } from '../../src/declaration.js';
import { makeProvider, sumMeterings, ceilingCostUsd } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { wiredMenu, buildDeclarationSchema, readInputFacts } from './schema.mjs';

export const MAX_STRUCTURE_RETRIES = 2;
export const MAX_REVISIONS = 2;
export const DRAFT_MAX_TOKENS = 16000;
export const DRAFT_SKILLS = Object.freeze(['core']);
const TOOL = 'emit_declaration';

function jobLinesText(lines, asks) {
  const askLines = new Set(asks.map((a) => a.line));
  return lines
    .map((l) => `${l.n}. ${l.text}${askLines.has(l.n) ? ' [SIGNED ASK — a human stop]' : ''}`
      + `${l.guardrail ? ` [guardrail: ${l.guardrail}]` : ' [no guardrail]'}`)
    .join('\n');
}

export function buildSystemPrompt({ menu, lines, arbiter, factsInfo }) {
  const askLines = arbiter.asks.map((a) => a.line);
  const sendLines = arbiter.sends.map((s) => s.line);
  return [
    `You are the fwdloop drafter. Answer ONLY by calling ${TOOL} — never plain text. You author steps only.`,
    '',
    'Primitive menu (a grant list; a verb not listed does not exist):',
    ...menu.map((e) => `- ${e.verb}: ${e.desc} (class: ${e.class})`),
    '',
    'Rules:',
    '- Steps share one artifact space. Each step: goal, primitives (verbs it needs, [] if none), reads (artifact ids emitted by an EARLIER step only), emits (ONE new unique artifact id), fromLine (the ONE job line it serves), close.',
    '- Every numbered job line must be served by a step (fromLine = that line) or listed in "refused" with a reason.',
    '- guardrailClasses: for each job line that HAS a guardrail, classify its wording once: "green" (every figure must cite its source cell), "softgreen" (the human declared a SHAPE the output must take), "hitl" (an ask/accept/review gate, or anything you are not sure of). When unsure, "hitl".',
    '- close.class MUST equal the class of the guardrail on that step\'s fromLine (guardrailClasses[fromLine]); a line with no guardrail is "hitl". A step cannot claim a class its own line does not earn.',
    '- close.shape only on a softgreen step; it is the human\'s declared shape in structured form.',
    `- Signed ask line(s): ${askLines.length ? askLines.join(', ') : 'none'}. For each, emit EXACTLY ONE step: fromLine = that line, close.class "hitl", primitives []. It is a stop only — never grant a primitive on it, and never emit a pause at any other line.`,
    `- Signed send line(s): ${sendLines.length ? sendLines.join(', ') : 'none'}. That step is drafted like any other: grant the write primitive and read the artifact of the ask step that comes before it. Its target and position are signed, not yours.`,
    '- Nothing hitl may come after the last signed ask except the send step.',
    '- You never author a trigger, cap, ask position or TTL, allow-list, send target, or what "done" means.',
    '',
    'Inputs, mechanically read (facts, not guesses):',
    ...(factsInfo.length ? factsInfo : ['- (none)']),
    '',
    'The numbered job lines:',
    jobLinesText(lines, arbiter.asks),
  ].join('\n');
}

function reviseMessage(reds) {
  return 'The declaration you just emitted was REFUSED by the validator. Fix every one of these and call '
    + `${TOOL} again with the complete corrected declaration:\n${reds.map((r) => `- ${r}`).join('\n')}`;
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// F49: deepseek-flash 400s on a forced tool_choice in thinking mode; the drafter forces its tool, so disable thinking.
export const DRAFT_PROVIDER_OPTIONS = Object.freeze({ ...LIVE_PROVIDER_OPTIONS, thinking: Object.freeze({ type: 'disabled' }) });

/**
 * Draft one declaration. `provider`/`rates`/`modelId` may be injected (tests,
 * the batch); otherwise a live provider is built from `slot` (throws on a bad
 * key — the batch preflights first). `budgetUsd` is this draft's hard cap.
 *
 * @returns {Promise<{ok:boolean, declaration:object|null, reds:string[], rounds:number,
 *   costUsd:number|null, structureRetries:number, revisions:number, stop:string|null, log:object[]}>}
 */
export async function draft({
  proseText, slot = 'deepseek', model, provider: injected, rates: injectedRates, modelId: injectedModelId,
  budgetUsd = 0.10, skills = DRAFT_SKILLS,
}) {
  const fail = (reds, extra = {}) => ({
    ok: false, declaration: null, reds, rounds: 0, costUsd: 0, modelReturned: null, structureRetries: 0, revisions: 0, stop: 'pre-flight', log: [], ...extra,
  });

  // ---- $0 gates, before any provider is built -------------------------------
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return fail(parsed.reds.map((r) => `signed-text: ${r}`));
  const { lines, arbiter } = parsed;
  const menu = wiredMenu(skills);
  const facts = readInputFacts(arbiter.sources);
  if (!facts.ok) return fail(facts.reds);

  let { provider, rates, modelId } = { provider: injected, rates: injectedRates, modelId: injectedModelId };
  if (provider == null) {
    try {
      ({ provider, rates, modelId } = makeProvider(slot, { model, ...DRAFT_PROVIDER_OPTIONS }));
    } catch (err) {
      return fail([`key: ${err.message}`]);
    }
  }

  const schema = buildDeclarationSchema(menu);
  const system = buildSystemPrompt({ menu, lines, arbiter, factsInfo: facts.info });
  const validationCatalogue = menu; // wired + signed-skill only: an unwired verb is "not in the catalogue"
  const roundCeiling = ceilingCostUsd(modelId);

  const meterings = [];
  const log = [];
  let structureRetries = 0;
  let revisions = 0;
  let lastReds = [];
  let lastDecl = null;
  let userText = `Call ${TOOL} now.`;
  let stop = null;

  for (;;) {
    // Budget: spend so far (an unpriced round counts at its ceiling) + one more
    // round at its ceiling must fit, or we stop here, booked.
    const spent = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spent + roundCeiling > budgetUsd && meterings.length > 0) { stop = 'budget'; break; }

    let captured;
    const tool = {
      name: TOOL,
      description: 'Emit the flow declaration over the granted primitives, or refuse lines you cannot serve.',
      parameters: schema,
      execute: async (args) => { captured = args; throw new HaltError('declaration captured', { rule: 'captured' }); },
    };
    const roundEvents = [];
    const loop = new Loop({
      provider, rates, onLlmResult: async (ev) => { roundEvents.push(ev); meterings.push(ev); },
    });
    let result;
    let threw = null;
    try {
      result = await loop.run(
        [{ role: 'system', content: system }, { role: 'user', content: userText }],
        [tool],
        { maxTokens: DRAFT_MAX_TOKENS, toolChoice: { name: TOOL } },
      );
    } catch (err) {
      threw = err;
    }
    const entry = { round: log.length + 1, kind: revisions + structureRetries === 0 ? 'first' : (lastDecl ? 'revision' : 'structure-retry') };

    if (threw) {
      entry.outcome = `provider-red: ${threw.message}`;
      log.push(entry);
      stop = 'provider-red';
      lastReds = [`provider-red: ${threw.message}`];
      break;
    }

    if (!isPlainObject(captured)) {
      const malformed = provider?.lastMalformedToolCall ?? null;
      const why = result?.stopReason === 'max_tokens' ? 'truncated: the round hit the output cap with no completed tool call'
        : malformed ? `the tool call's arguments were not valid JSON (${malformed.error})`
          : 'no usable tool call (text instead of the tool)';
      entry.outcome = `structure: ${why}`;
      log.push(entry);
      lastReds = [why];
      if (structureRetries >= MAX_STRUCTURE_RETRIES) { stop = 'structure'; break; }
      structureRetries += 1;
      userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
      continue;
    }

    const declaration = { ...captured, inputFacts: facts.inputFacts };
    const verdict = validateDeclaration(declaration, { arbiter, lines, catalogue: validationCatalogue });
    lastDecl = declaration;
    if (verdict.ok) {
      entry.outcome = 'valid';
      log.push(entry);
      const m = sumMeterings(meterings);
      return {
        ok: true, declaration, reds: [], rounds: m.rounds, costUsd: m.costUsd, modelReturned: m.model, structureRetries, revisions, stop: null, log,
      };
    }
    lastReds = [...verdict.reds];
    entry.outcome = `validator: ${verdict.reds.length} red(s)`;
    entry.reds = lastReds;
    log.push(entry);
    if (revisions >= MAX_REVISIONS) { stop = 'validator'; break; }
    revisions += 1;
    userText = reviseMessage(lastReds);
  }

  const m = sumMeterings(meterings);
  return {
    ok: false, declaration: lastDecl, reds: lastReds, rounds: m.rounds, costUsd: m.costUsd, modelReturned: m.model, structureRetries, revisions, stop, log,
  };
}
