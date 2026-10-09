// M4e amendment 24 POC — the drafter plus optional `questions` and `notChecked`. NOT the product.
// borrowed-from: fwdloop src/drafter.js@d9a21cc (schema, system prompt, forced tool call, per-round metering).
//
// The schema and system prompt are built by src/drafter.js's own exports, so the baseline cannot drift;
// this file only ADDS: two optional properties, one prompt block, and the post-processing
// (normalizeQuestions). ONE round per job (plus at most MAX_STRUCTURE_RETRIES when the round gave no usable
// tool call); no validator revisions — the POC measures the first declaration. Every round is metered via
// Loop's onLlmResult. A `max_tokens` stop is truncation, never "no tool call".

import { Loop, HaltError } from 'bare-agent';
import { parseSignedText, unsignedAskTtls } from '../../src/signed-text.js';
import { validateDeclaration, checkGuardrailSums, guardrailWordsPerSection } from '../../src/declaration.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { WIRED_VERBS, wiredMenu } from '../../src/primitives.js';
import { readInputFacts } from '../../src/input-facts.js';
import { makeProvider, sumMeterings, ceilingCostUsd } from '../../src/provider.js';
import {
  buildDeclarationSchema, buildSystemPrompt, goalForLine, DRAFT_PROVIDER_OPTIONS, DRAFT_MAX_TOKENS, DRAFT_SKILLS,
} from '../../src/drafter.js';

export const MAX_STRUCTURE_RETRIES = 1;
export const MAX_QUESTIONS = 2;
const TOOL = 'emit_declaration';

/** What fwdloop's typed checks can really check (bareloop F174: give the model the real list, or "Not checked" is invented). */
export const CHECKABLE = [
  'green: a figure cites its source cell or formula',
  'softgreen: the output carries named section headings (sections), in order',
  'softgreen: a word ceiling for the whole output (maxWords) and per section (wordsPerSection)',
  'softgreen: a line count per invoice (linesPerInvoice) and fields every line must carry (mustCarry)',
  'softgreen: extra typed keys the human declared on the guardrail',
  'hitl: a human accepts or reviews at a signed ask — the machine checks only that the step happened',
];

export const QUESTIONS_PROMPT = [
  'Questions (optional, at most 2): add "questions" ONLY for something genuinely missing that you cannot draft a line without',
  '(an undefined size, format, destination, or what "done" means). Each question is {line, question}: "line" is the number of the job line it is about.',
  'Never ask to double-check what the job already says. Never ask about a trigger, cap, ask position or TTL, allow-list or send target (signed, not yours).',
  'A job that is fully specified gets NO questions: leave "questions" out. Still emit the complete declaration either way.',
  '',
  'notChecked (optional): a short list of things about the job that no check below will verify. These are the ONLY things fwdloop can check:',
  ...CHECKABLE.map((c) => `- ${c}`),
  'Anything the job asks for beyond those (tone, correctness of prose, completeness, matching a taste) is NOT checked: list it in "notChecked", one plain short phrase each. [] or leave out if nothing.',
].join('\n');

/** The drafter's schema plus the two optional properties. Not in `required`. */
export function buildPocSchema(menu) {
  const s = buildDeclarationSchema(menu);
  return {
    ...s,
    properties: {
      ...s.properties,
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { line: { type: 'integer' }, question: { type: 'string', minLength: 1 } },
          required: ['line', 'question'],
        },
        description: 'at most 2 questions the job cannot be drafted without; each names its job line',
      },
      notChecked: { type: 'array', items: { type: 'string' }, description: 'what the job asks for that no typed check verifies' },
    },
  };
}

/**
 * amendment 24 item 1: a question with no line, a line that does not exist, a blank question, or a third question
 * is dropped, and the drop is returned for the log. `lineNums` = the job's real line numbers.
 */
export function normalizeQuestions(raw, lineNums) {
  const kept = [];
  const dropped = [];
  if (raw === undefined || raw === null) return { kept, dropped };
  if (!Array.isArray(raw)) return { kept, dropped: [{ reason: 'questions is not a list', raw }] };
  for (const q of raw) {
    const okShape = q && typeof q === 'object' && !Array.isArray(q);
    if (!okShape || !Number.isInteger(q.line)) { dropped.push({ reason: 'no line', raw: q }); continue; }
    if (!lineNums.includes(q.line)) { dropped.push({ reason: `line ${q.line} does not exist`, raw: q }); continue; }
    if (typeof q.question !== 'string' || q.question.trim() === '') { dropped.push({ reason: 'blank question', raw: q }); continue; }
    if (kept.length >= MAX_QUESTIONS) { dropped.push({ reason: 'third question', raw: q }); continue; }
    kept.push({ line: q.line, question: q.question });
  }
  return { kept, dropped };
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/**
 * Draft one job once. Returns per-job evidence; never throws on a provider/model fault (that is `stop`).
 * `provider`/`rates`/`modelId` injectable for the $0 test. `budgetUsd` is a hard cap on THIS job.
 */
export async function draftWithQuestions({
  proseText, slot = 'deepseek', model, provider: injected, rates: injectedRates, modelId: injectedModelId, env,
  budgetUsd = 0.10, skills = DRAFT_SKILLS, makeProviderFn = makeProvider,
}) {
  const base = {
    questions: [], droppedQuestions: [], notChecked: null, declarationValid: false, reds: [], stop: 'pre-flight', stopReason: null,
    rounds: 0, calls: 0, tokens: null, costUsd: 0, spendComplete: true, structureRetries: 0, modelReturned: null,
  };
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return { ...base, reds: parsed.reds.map((r) => `signed-text: ${r}`) };
  const { lines, arbiter } = parsed;
  const pre = [...unsignedAskTtls(arbiter), ...checkGuardrailSums(lines)];
  if (pre.length) return { ...base, reds: pre };
  const facts = readInputFacts(arbiter.sources);
  if (!facts.ok) return { ...base, reds: facts.reds };

  let { provider, rates, modelId } = { provider: injected, rates: injectedRates, modelId: injectedModelId };
  if (provider == null) {
    try {
      ({ provider, rates, modelId } = makeProviderFn(slot, { model, env, ...DRAFT_PROVIDER_OPTIONS }));
    } catch (err) { return { ...base, reds: [`key: ${err.message}`] }; }
  }
  const menu = wiredMenu(skills);
  const schema = buildPocSchema(menu);
  const system = `${buildSystemPrompt({ menu, lines, arbiter, factsInfo: facts.info })}\n\n${QUESTIONS_PROMPT}`;
  const cat = loadCatalogue();
  if (!cat.ok) return { ...base, reds: [`catalogue: ${cat.reds.join('; ')}`] };
  const roundCeiling = ceilingCostUsd(modelId);
  if (roundCeiling > budgetUsd) return { ...base, reds: [`budget: below one round's worst-case cost $${roundCeiling.toFixed(4)}`] };

  const meterings = [];
  let calls = 0;
  let unmetered = 0;
  let structureRetries = 0;
  let userText = `Call ${TOOL} now.`;
  let stop = null;
  let stopReason = null;
  let captured;
  for (;;) {
    const spent = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spent + roundCeiling > budgetUsd) { stop = 'budget'; break; }
    captured = undefined;
    const tool = {
      name: TOOL,
      description: 'Emit the flow declaration over the granted primitives, or refuse lines you cannot serve.',
      parameters: schema,
      execute: async (args) => { captured = args; throw new HaltError('declaration captured', { rule: 'captured' }); },
    };
    const roundEvents = [];
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { roundEvents.push(ev); meterings.push(ev); } });
    calls += 1;
    let result;
    try {
      result = await loop.run(
        [{ role: 'system', content: system }, { role: 'user', content: userText }],
        [tool],
        { maxTokens: DRAFT_MAX_TOKENS, toolChoice: { name: TOOL } },
      );
    } catch (err) {
      if (roundEvents.length === 0) unmetered += 1;
      stop = 'provider-red'; stopReason = err.message; break;
    }
    stopReason = result?.stopReason ?? null;
    if (isPlainObject(captured)) break;
    const malformed = provider?.lastMalformedToolCall ?? null;
    const why = result?.stopReason === 'max_tokens' ? 'truncated: the round hit the output cap with no completed tool call'
      : malformed ? `the tool call's arguments were not valid JSON (${malformed.error})`
        : 'no usable tool call (text instead of the tool)';
    if (structureRetries >= MAX_STRUCTURE_RETRIES) { stop = 'structure'; stopReason = why; break; }
    structureRetries += 1;
    userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
  }

  const m = sumMeterings(meterings);
  const out = {
    ...base, stop, stopReason, rounds: m.rounds, calls, tokens: m.tokens, costUsd: m.costUsd,
    spendComplete: unmetered === 0 && m.costUsd !== null, structureRetries, modelReturned: m.model,
  };
  if (!isPlainObject(captured)) return { ...out, stop: stop ?? 'structure', reds: [stopReason ?? 'no tool call'] };

  const { questions: rawQ, notChecked: rawNC, ...rest } = captured;
  const { kept, dropped } = normalizeQuestions(rawQ, lines.map((l) => l.n));
  const notChecked = Array.isArray(rawNC) ? rawNC.filter((x) => typeof x === 'string' && x.trim() !== '') : null;

  // The same machine overwrites the real drafter makes, then the real validator.
  const declaration = { ...rest, inputFacts: facts.inputFacts };
  if (Array.isArray(declaration.steps)) {
    declaration.steps = declaration.steps.map((st) => {
      if (!isPlainObject(st)) return st;
      let next = { ...st, goal: goalForLine(st.fromLine, lines) };
      if (isPlainObject(next.close) && isPlainObject(next.close.shape)) {
        const { wordsPerSection: _drop, ...shape } = next.close.shape;
        const per = guardrailWordsPerSection(lines.find((l) => l.n === st.fromLine)?.guardrail);
        next = { ...next, close: { ...next.close, shape: per === null ? shape : { ...shape, wordsPerSection: per } } };
      }
      return next;
    });
  }
  const verdict = validateDeclaration(declaration, {
    arbiter, lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
  });
  return {
    ...out, stop: stop ?? null, questions: kept, droppedQuestions: dropped, notChecked,
    declarationValid: verdict.ok, reds: verdict.ok ? [] : [...verdict.reds],
  };
}
