// M4e amendment 25 POC — the real drafter's three tries; `questions` opens only on try 3 of 3. NOT the product.
// borrowed-from: fwdloop src/drafter.js@d9a21cc (schema, system prompt, forced tool call, per-round metering, revise message).
//
// Try 1 = the real drafter's schema and prompt, no questions. Try 2 = the real first revision (reds fed back), no questions.
// Try 3 = the real second revision PLUS the optional `questions` property, `notChecked`, and a prompt line; offered only
// when tries 1 and 2 both failed validateDeclaration. A question is kept only if its line is one try 2's reds named.
// No number appears in the prompt or schema description; the machine keeps 2. Every round is metered via Loop's
// onLlmResult. A `max_tokens` stop is truncation, never "no tool call".

import { Loop, HaltError } from 'bare-agent';
import { parseSignedText, unsignedAskTtls } from '../../src/signed-text.js';
import { validateDeclaration, checkGuardrailSums, guardrailWordsPerSection } from '../../src/declaration.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { WIRED_VERBS, wiredMenu } from '../../src/primitives.js';
import { readInputFacts } from '../../src/input-facts.js';
import { makeProvider, sumMeterings, ceilingCostUsd } from '../../src/provider.js';
import {
  buildDeclarationSchema, buildSystemPrompt, goalForLine, DRAFT_PROVIDER_OPTIONS, DRAFT_MAX_TOKENS, DRAFT_SKILLS,
  MAX_STRUCTURE_RETRIES, MAX_REVISIONS,
} from '../../src/drafter.js';

export { MAX_STRUCTURE_RETRIES };
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

/** Try 3 only. No digit and no number word anywhere in it (a test greps this). The machine, not the prompt, bounds the count. */
export const QUESTIONS_PROMPT = [
  'You may add "questions" to this reply. Ask only about a job line named in the refusals above, and only if that line cannot be drafted without the answer',
  '(an undefined size, format, destination, or what "done" means). Each question is {line, question}: "line" is the number of the job line it is about.',
  'If the refusals can be fixed without asking, fix them and leave "questions" out. Never ask about a trigger, cap, ask position or TTL, allow-list or send target (signed, not yours).',
  'Still emit the complete corrected declaration.',
].join('\n');

export const NOTCHECKED_PROMPT = [
  'notChecked (optional): a short list of things about the job that no check below will verify. These are the ONLY things fwdloop can check:',
  ...CHECKABLE.map((c) => `- ${c}`),
  'Anything the job asks for beyond those (tone, correctness of prose, completeness, matching a taste) is NOT checked: list it in "notChecked", a plain short phrase each. [] or leave out if nothing.',
].join('\n');

/** The real drafter's revise message (src/drafter.js reviseMessage). */
function reviseMessage(reds) {
  return 'The declaration you just emitted was REFUSED by the validator. Fix every one of these and call '
    + `${TOOL} again with the complete corrected declaration:\n${reds.map((r) => `- ${r}`).join('\n')}`;
}

/** The drafter's schema; `questions` and `notChecked` are optional additions, added only on try 3. Not in `required`. */
export function buildPocSchema(menu, { questions = false, notChecked = false } = {}) {
  const s = buildDeclarationSchema(menu);
  const extra = {};
  if (questions) {
    extra.questions = {
      type: 'array',
      items: {
        type: 'object',
        properties: { line: { type: 'integer' }, question: { type: 'string' } },
        required: ['line', 'question'],
      },
      description: 'questions the job cannot be drafted without; each names the job line it is about',
    };
  }
  if (notChecked) extra.notChecked = { type: 'array', items: { type: 'string' }, description: 'what the job asks for that no typed check verifies' };
  return { ...s, properties: { ...s.properties, ...extra } };
}

/**
 * Which job lines did these reds name? Reds name a line three ways: "line N" (also "ask at line N", "(line N)",
 * "guardrailClasses key \"N\""), "steps[i]" (mapped through that declaration's steps[i].fromLine), and "step N's check"
 * (1-based). A red naming none (a missing top-level key, an unknown key) names no line. Returns sorted real line numbers.
 */
export function linesNamedByReds(reds, declaration, lineNums) {
  const found = new Set();
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const stepLine = (i) => (isPlainObject(steps[i]) && Number.isInteger(steps[i].fromLine) ? steps[i].fromLine : null);
  for (const red of reds) {
    for (const m of red.matchAll(/\bline (\d+)\b/g)) found.add(Number(m[1]));
    for (const m of red.matchAll(/guardrailClasses key "(\d+)"|unjudgeable key "(\d+)"/g)) found.add(Number(m[1] ?? m[2]));
    for (const m of red.matchAll(/steps\[(\d+)\]/g)) { const n = stepLine(Number(m[1])); if (n !== null) found.add(n); }
    for (const m of red.matchAll(/\bstep (\d+)'s check/g)) { const n = stepLine(Number(m[1]) - 1); if (n !== null) found.add(n); }
  }
  return [...found].filter((n) => lineNums.includes(n)).sort((x, y) => x - y);
}

/**
 * amendment 25: a question is kept only if its line is one try 2's reds named; a question with no line, a blank
 * question, or a third question is dropped. Every drop is returned with its reason, for the log.
 */
export function normalizeQuestions(raw, failedLines) {
  const kept = [];
  const dropped = [];
  if (raw === undefined || raw === null) return { kept, dropped };
  if (!Array.isArray(raw)) return { kept, dropped: [{ reason: 'questions is not a list', raw }] };
  for (const q of raw) {
    const okShape = q && typeof q === 'object' && !Array.isArray(q);
    if (!okShape || !Number.isInteger(q.line)) { dropped.push({ reason: 'no line', raw: q }); continue; }
    if (!failedLines.includes(q.line)) { dropped.push({ reason: `line ${q.line} is not a line try 2's checks failed on`, raw: q }); continue; }
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
    questions: [], droppedQuestions: [], notChecked: null, passedTry1: null, passedTry2: null, tryReds: { 1: [], 2: [], 3: [] }, failedLines: [], triesRun: 0, declarationValid: false, reds: [], stop: 'pre-flight', stopReason: null,
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
  const baseSystem = buildSystemPrompt({ menu, lines, arbiter, factsInfo: facts.info });
  // Tries 1 and 2: the real drafter's schema and prompt, untouched. Try 3 only: questions + notChecked.
  const roundSetup = (tryNo) => (tryNo === 3
    ? { schema: buildPocSchema(menu, { questions: true, notChecked: true }), system: `${baseSystem}\n\n${NOTCHECKED_PROMPT}` }
    : { schema: buildPocSchema(menu), system: baseSystem });
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
  let tryNo = 1; // 1..3 = 1 first draft + MAX_REVISIONS revisions
  const tryReds = { 1: [], 2: [], 3: [] };
  const tryValid = { 1: null, 2: null, 3: null };
  let failedLines = [];
  let lastVerdict = null;
  const validate = (cap, offered) => {
    const { questions: rawQ, notChecked: rawNC, ...rest } = cap;
    // Where a property was not offered it is NOT stripped: a stray key reds as unknown, as in the real drafter.
    const declaration = offered ? { ...rest, inputFacts: facts.inputFacts } : { ...cap, inputFacts: facts.inputFacts };
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
    return { verdict, declaration, rawQ, rawNC };
  };
  for (;;) {
    const spent = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spent + roundCeiling > budgetUsd) { stop = 'budget'; break; }
    captured = undefined;
    const { schema, system } = roundSetup(tryNo);
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
    if (isPlainObject(captured)) {
      const v = validate(captured, tryNo === 3);
      tryValid[tryNo] = v.verdict.ok;
      tryReds[tryNo] = v.verdict.ok ? [] : [...v.verdict.reds];
      lastVerdict = v;
      if (v.verdict.ok || tryNo === 1 + MAX_REVISIONS) break;
      if (tryNo === 2) failedLines = linesNamedByReds(tryReds[2], v.declaration, lines.map((l) => l.n));
      tryNo += 1;
      userText = reviseMessage(tryReds[tryNo - 1]);
      if (tryNo === 3) userText += `\n\n${QUESTIONS_PROMPT}`;
      continue;
    }
    const malformed = provider?.lastMalformedToolCall ?? null;
    const why = result?.stopReason === 'max_tokens' ? 'truncated: the round hit the output cap with no completed tool call'
      : malformed ? `the tool call's arguments were not valid JSON (${malformed.error})`
        : 'no usable tool call (text instead of the tool)';
    if (structureRetries >= MAX_STRUCTURE_RETRIES) { stop = 'structure'; stopReason = why; break; }
    structureRetries += 1;
    userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
    if (tryReds[tryNo - 1]?.length) userText += `\n\nThe last declaration you emitted was still refused by the validator; keep fixing these too:\n${tryReds[tryNo - 1].map((r) => `- ${r}`).join('\n')}`;
    if (tryNo === 3) userText += `\n\n${QUESTIONS_PROMPT}`;
  }

  const m = sumMeterings(meterings);
  const out = {
    ...base, stop, stopReason, rounds: m.rounds, calls, tokens: m.tokens, costUsd: m.costUsd,
    spendComplete: unmetered === 0 && m.costUsd !== null, structureRetries, modelReturned: m.model,
  };
  const tries = {
    passedTry1: tryValid[1], passedTry2: tryValid[2], tryReds, failedLines,
  };
  // A stop (budget / provider-red / structure) is a broken call: no verdict is claimed past the last try that finished.
  if (stop !== null || !isPlainObject(captured)) {
    return { ...out, ...tries, stop: stop ?? 'structure', reds: [stopReason ?? 'no tool call'], declarationValid: false };
  }
  const { verdict, rawQ, rawNC } = lastVerdict;
  // Questions and notChecked are read only from try 3, the only round that offered them.
  const asked = tryNo === 3;
  const { kept, dropped } = asked ? normalizeQuestions(rawQ, failedLines) : { kept: [], dropped: [] };
  const notChecked = asked && Array.isArray(rawNC) ? rawNC.filter((x) => typeof x === 'string' && x.trim() !== '') : null;
  return {
    ...out, ...tries, stop: null, questions: kept, droppedQuestions: dropped, notChecked, triesRun: tryNo,
    declarationValid: verdict.ok, reds: verdict.ok ? [] : [...verdict.reds],
  };
}
