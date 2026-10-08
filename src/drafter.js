// borrowed-from: fwdloop poc/m6a/schema.mjs + poc/m6a/draft.mjs@867c25b (M6a POC, bar met 20/20).
//
// M6a — the drafter. One forced tool call (`emit_declaration`, toolChoice by
// name) whose schema is derived from the wired menu (src/primitives.js
// wiredMenu, over src/catalogue.json) and src/declaration.js SHAPE_KEYS. The
// model's args, plus the harness's mechanical `inputFacts`, ARE the src
// declaration — no converter. validateDeclaration decides pass/fail, with the
// full catalogue and the WIRED_VERBS set, so an unwired verb reds by name.
//
// Rounds: 1 first draft + up to MAX_STRUCTURE_RETRIES when the round gave no
// usable tool call (malformed JSON, text instead, truncation) + up to
// MAX_REVISIONS when the validator reds (the reds are fed back verbatim).
// Every round is metered through Loop's onLlmResult; the tool body throws
// HaltError after capturing so no second (paid) "wrap-up" round happens.
// Unknown cost is never 0: sumMeterings gives null, and the budget check
// prices an unpriced round at the ceiling.

import { Loop, HaltError } from 'bare-agent';
import { parseSignedText, unsignedAskTtls } from './signed-text.js';
import { validateDeclaration, SHAPE_KEYS, checkGuardrailSums, guardrailWordsPerSection } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS, wiredMenu } from './primitives.js';
import { readInputFacts } from './input-facts.js';
import { makeProvider, sumMeterings, ceilingCostUsd, priceRecord } from './provider.js';
import { LIVE_PROVIDER_OPTIONS } from './model-step.js';
import { ConfigError } from './config.js';

export const MAX_STRUCTURE_RETRIES = 2;
export const MAX_REVISIONS = 2;
export const DRAFT_MAX_TOKENS = 16000;
export const DRAFT_SKILLS = Object.freeze(['core']);

export const CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

const SHAPE_PROPS = Object.freeze({
  maxWords: { type: 'integer', minimum: 1, description: "the whole output's word ceiling" },
  sections: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'required section headings, in order' },
  linesPerInvoice: { type: 'integer', minimum: 1, description: 'lines the output must carry per invoice' },
  mustCarry: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'named fields every line must carry' },
});

/** The forced tool's parameter schema. `menu` = wiredMenu(). */
export function buildDeclarationSchema(menu) {
  const shapeProps = {};
  for (const key of SHAPE_KEYS) {
    if (!SHAPE_PROPS[key]) throw new Error(`schema: SHAPE_KEYS gained "${key}" — add its type to SHAPE_PROPS`);
    shapeProps[key] = SHAPE_PROPS[key];
  }
  return {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            primitives: {
              type: 'array',
              items: { type: 'string', enum: menu.map((e) => e.verb) },
              description: 'verbs this step is granted, from the menu only; [] for a pure stop',
            },
            reads: { type: 'array', items: { type: 'string' }, description: 'artifact ids emitted by EARLIER steps only' },
            emits: { type: 'string', minLength: 1, description: 'the ONE new artifact id this step declares (unique)' },
            fromLine: { type: ['integer', 'null'], description: 'the ONE numbered job line this step serves' },
            picks: {
              type: 'object',
              additionalProperties: { type: 'array', items: { type: 'string' } },
              description: 'optional: source role -> heading names this step uses, each copied verbatim from that role\'s headings listed under Inputs; omit when the step names none',
            },
            close: {
              type: 'object',
              properties: {
                class: { type: 'string', enum: [...CLASSES], description: "MUST equal the class of fromLine's guardrail in guardrailClasses; hitl when that line has no guardrail" },
                shape: {
                  type: 'object',
                  properties: shapeProps,
                  additionalProperties: false,
                  description: `only when class is softgreen; keys limited to ${SHAPE_KEYS.join(', ')}`,
                },
              },
              required: ['class'],
              additionalProperties: false,
            },
          },
          required: ['primitives', 'reads', 'emits', 'fromLine', 'close'],
          additionalProperties: false,
        },
      },
      guardrailClasses: {
        type: 'object',
        additionalProperties: { type: 'string', enum: [...CLASSES] },
        description: 'one class per job line that HAS a guardrail, keyed by line number as a string',
      },
      unjudgeable: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'line number -> reason, only for a guardrail whose wording resisted judgment (its class stays hitl); {} if none',
      },
      refused: {
        type: 'array',
        items: {
          type: 'object',
          properties: { line: { type: 'integer' }, reason: { type: 'string', minLength: 1 } },
          required: ['line', 'reason'],
          additionalProperties: false,
        },
        description: 'job lines that cannot be served at all, with a reason; [] if none',
      },
    },
    required: ['steps', 'guardrailClasses', 'unjudgeable', 'refused'],
    additionalProperties: false,
  };
}

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
    '- Steps share one artifact space. Each step: primitives (verbs it needs, [] if none), reads (artifact ids emitted by an EARLIER step only), emits (ONE new unique artifact id), fromLine (the ONE job line it serves), close. The machine fills each step\'s goal with that signed line, verbatim — you never write a goal.',
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

/**
 * A step's goal = its signed line's text, exactly as parseSignedText's `lines` gives it: the words after
 * "N. " (trailing comma kept; on an ask line the mark is stripped, leaving the question). Continuation
 * lines do not exist in the grammar. A step naming no signed line gets a fixed placeholder, never model prose.
 */
export function goalForLine(fromLine, lines) {
  const line = Number.isInteger(fromLine) ? lines.find((l) => l.n === fromLine) : undefined;
  return line ? line.text : '(no signed line)';
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
 * `makeProviderFn` is a test seam: the live-provider factory (default `makeProvider`).
 * `onBook` (M4e piece 2a, scope 13): called right BEFORE each provider call (`inFlight: true`, the call counted in
 * `calls`) and right AFTER it (`inFlight: false`), with what is known so far, so the caller can book spend per call
 * and a draft killed between rounds still has its paid rounds on disk. It may throw before a call (nothing is
 * spent then and the draft stops); after a call it is the caller's to keep from throwing.
 *
 * @returns {Promise<{ok:boolean, declaration:object|null, reds:string[], rounds:number, calls:number, spendComplete:boolean,
 *   costUsd:number|null, modelReturned:string|null, modelId?:string, price?:object|null, tokens?:object|null, structureRetries:number, revisions:number, stop:string|null, log:object[]}>}
 */
export async function draft({
  proseText, slot = 'deepseek', model, provider: injected, rates: injectedRates, modelId: injectedModelId, env,
  budgetUsd = 0.10, skills = DRAFT_SKILLS, makeProviderFn = makeProvider, onBook,
}) {
  const fail = (reds, extra = {}) => ({
    ok: false, declaration: null, reds, rounds: 0, calls: 0, spendComplete: true, costUsd: 0, modelReturned: null, structureRetries: 0, revisions: 0, stop: 'pre-flight', log: [], ...extra,
  });

  // ---- $0 gates, before any provider is built -------------------------------
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return fail(parsed.reds.map((r) => `signed-text: ${r}`));
  const { lines, arbiter } = parsed;
  const ttlReds = unsignedAskTtls(arbiter);
  if (ttlReds.length) return fail(ttlReds);
  // M4e amendment 15 item 2: a guardrail that fights itself on words is red at $0, before any provider is built or called.
  const sumReds = checkGuardrailSums(lines);
  if (sumReds.length) return fail(sumReds);
  const menu = wiredMenu(skills);
  const facts = readInputFacts(arbiter.sources);
  if (!facts.ok) return fail(facts.reds);

  let { provider, rates, modelId } = { provider: injected, rates: injectedRates, modelId: injectedModelId };
  let prices = null; // the one price lookup's result (live provider only); the cap check below uses the SAME price
  if (provider == null) {
    try {
      ({
        provider, rates, modelId, prices = null,
      } = makeProviderFn(slot, { model, env, ...DRAFT_PROVIDER_OPTIONS }));
    } catch (err) {
      return fail([`${err instanceof ConfigError ? 'config' : 'key'}: ${err.message}`]);
    }
  }

  const schema = buildDeclarationSchema(menu);
  const system = buildSystemPrompt({ menu, lines, arbiter, factsInfo: facts.info });
  // Full catalogue + the wired set: an unwired verb reds "not wired" by name; an unsigned skill reds by skill.
  const cat = loadCatalogue();
  if (!cat.ok) return fail([`catalogue: ${cat.reds.join('; ')}`]);
  const validationCatalogue = cat.primitives;
  const roundCeiling = ceilingCostUsd(modelId, undefined, prices ? { prices } : {});
  // One round at its ceiling must fit the budget, or refuse at $0 before any provider call.
  if (roundCeiling > budgetUsd) {
    return fail([`budget: $${budgetUsd} is below one round's worst-case cost — the minimum budget is $${roundCeiling.toFixed(4)}`]);
  }

  const meterings = [];
  const log = [];
  let structureRetries = 0;
  let revisions = 0;
  let lastReds = [];
  let lastDecl = null;
  let userText = `Call ${TOOL} now.`;
  let nextKind = 'first'; // what the round about to run actually is
  let validatorReds = []; // the last validator refusal; a structure retry after a revision must not drop it
  let stop = null;
  let calls = 0; // provider calls made (a call that threw before metering is in `calls`, not in `rounds`)
  let unmetered = 0; // calls that failed with no metering: their cost is unknown

  for (;;) {
    // Budget: spend so far (an unpriced round counts at its ceiling) + one more
    // round at its ceiling must fit, or we stop here, booked.
    const spent = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spent + roundCeiling > budgetUsd) { stop = 'budget'; break; }

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
    calls += 1;
    const book = (inFlight) => onBook?.({
      inFlight, calls, unmetered, metered: sumMeterings(meterings), modelId, price: priceRecord(prices, rates),
    });
    book(true);
    try {
      result = await loop.run(
        [{ role: 'system', content: system }, { role: 'user', content: userText }],
        [tool],
        { maxTokens: DRAFT_MAX_TOKENS, toolChoice: { name: TOOL } },
      );
    } catch (err) {
      threw = err;
      if (roundEvents.length === 0) unmetered += 1;
    }
    book(false);
    const entry = { round: log.length + 1, kind: nextKind };

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
      nextKind = 'structure-retry';
      userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
      if (validatorReds.length) userText += `\n\nThe last declaration you emitted was still refused by the validator; keep fixing these too:\n${validatorReds.map((r) => `- ${r}`).join('\n')}`;
      continue;
    }

    const declaration = { .../** @type {object} */ (captured), inputFacts: facts.inputFacts };
    // M6a amendment 1 (F50): the goal is the signed line, set by the machine; whatever the model sent is overwritten.
    if (Array.isArray(declaration.steps)) {
      declaration.steps = declaration.steps.map((st) => (isPlainObject(st) ? { ...st, goal: goalForLine(st.fromLine, lines) } : st));
    }
    // M4e amendment 15 item 1: `wordsPerSection` is the guardrail's number, set by the machine. If the model sent one it is overwritten
    // (or dropped when the guardrail gives none), so it can never differ from the guardrail.
    if (Array.isArray(declaration.steps)) {
      declaration.steps = declaration.steps.map((st) => {
        if (!isPlainObject(st) || !isPlainObject(st.close) || !isPlainObject(st.close.shape)) return st;
        const { wordsPerSection: _drop, ...shape } = st.close.shape;
        const per = guardrailWordsPerSection(lines.find((l) => l.n === st.fromLine)?.guardrail);
        return { ...st, close: { ...st.close, shape: per === null ? shape : { ...shape, wordsPerSection: per } } };
      });
    }
    const verdict = validateDeclaration(declaration, {
      arbiter, lines, catalogue: validationCatalogue, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
    });
    lastDecl = declaration;
    if (verdict.ok) {
      entry.outcome = 'valid';
      log.push(entry);
      const m = sumMeterings(meterings);
      return {
        ok: true, declaration, reds: [], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries, revisions, stop: null, log,
      };
    }
    lastReds = [...verdict.reds];
    entry.outcome = `validator: ${verdict.reds.length} red(s)`;
    entry.reds = lastReds;
    log.push(entry);
    if (revisions >= MAX_REVISIONS) { stop = 'validator'; break; }
    revisions += 1;
    validatorReds = lastReds;
    nextKind = 'revision';
    userText = reviseMessage(lastReds);
  }

  const m = sumMeterings(meterings);
  // Runner convention: `costUsd` is the priced sum (null when ANY round is unpriced, so the CLI prints UNKNOWN,
  // never a bare number), and `spendComplete:false` marks a call that failed unmetered or a round left unpriced.
  return {
    ok: false, declaration: lastDecl, reds: lastReds, rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries, revisions, stop, log,
  };
}
