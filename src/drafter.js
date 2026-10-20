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
import { capTooSmallText, usdText } from './draftspend.js';
import { parseSignedText, unsignedAskTtls } from './signed-text.js';
import { validateDeclaration, SHAPE_KEYS, checkGuardrailSums, guardrailWordsPerSection } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS, wiredMenu } from './primitives.js';
import { readInputFacts } from './input-facts.js';
import { freezePage } from './runner.js';
import { removeFrozenPages } from './flow.js';
import { lookAtPage, pageInfoLines } from './pagelook.js';
import { leftRuleLine } from './pagedropwords.js';
import { MAP_SYSTEM, mapPrompt } from './pagemap.js';
import { askableFromLook, tooManyAsksText, MAX_LOOK_ASKS } from './pageask.js';
import { lineRules } from './pagebits.js';
import path from 'node:path';
import { isCellsPath } from './closers.js';
import {
  makeProvider, ModelRefusal, sumMeterings, ceilingCostUsd, priceRecord,
} from './provider.js';
import { LIVE_PROVIDER_OPTIONS } from './model-step.js';
import { ConfigError } from './config.js';
import { thinkingSay, worstThinkingStatus } from './thinking.js';

export const MAX_STRUCTURE_RETRIES = 2;
export const MAX_REVISIONS = 2;
export const DRAFT_MAX_TOKENS = 16000;
export const DRAFT_SKILLS = Object.freeze(['core']);

export const CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

/** The whole-output-ceiling rule, told once to the drafter (schema and prompt use this string). Amendment 29; no number words (am25). */
export const WHOLE_OUTPUT_CEILING_RULE = "use the guardrail's ceiling for the whole output";

/** M10 am7 item 1: the facts of a green step that cites quotes from a web page (`close.cited`); the same fields src/citedcheck.js checks. */
const CITED_PROP = Object.freeze({
  type: 'object',
  description: 'only on a green step that checks quotes from a web page input: the facts every result must hold. Omit on any other step',
  properties: {
    source: { type: 'string', description: "the role of the web page input the quotes come from (also in the step's reads)" },
    facts: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      description: 'one fact per thing a result must hold; at most 10',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'letters and spaces only, no digits' },
          shape: { type: 'string', enum: ['money', 'number', 'date', 'time', 'phrase', 'text'] },
          unit: { type: ['string', 'array'], items: { type: 'string' }, description: 'money only: the words the page writes after the amount, copied from the page' },
          currency: { type: ['string', 'array'], items: { type: 'string' }, description: 'money only: $, € or £' },
          phrase: { type: 'string', description: 'phrase only: the fixed words every result must say, copied from the page' },
          anchor: { type: 'string', description: 'the label right before the value, picked from the kept labels listed under Inputs; never typed' },
          until: { type: 'string', description: 'text only: the words that close the value' },
          rule: {
            type: 'object',
            description: 'under (lt, lte), over (gt, gte) or between: only a number that is in the person\'s own words on the job line',
            properties: { op: { type: 'string', enum: ['lt', 'lte', 'gt', 'gte', 'between'] }, value: {}, lo: {}, hi: {} },
            required: ['op'],
            additionalProperties: false,
          },
        },
        required: ['name', 'shape'],
        additionalProperties: false,
      },
    },
    count: {
      type: 'object',
      description: 'how many results the job line asks for ("List 3" is min 3, max 3)',
      properties: { min: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1 } },
      additionalProperties: false,
    },
  },
  required: ['source', 'facts'],
  additionalProperties: false,
});

const SHAPE_PROPS = Object.freeze({
  maxWords: { type: 'integer', minimum: 1, description: `the whole output's word ceiling; ${WHOLE_OUTPUT_CEILING_RULE}` },
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
            reads: { type: 'array', items: { type: 'string' }, description: 'artifact ids emitted by EARLIER steps only (an ask step lists the earlier output to be checked FIRST), or the role of a CSV input (a step whose line has a green guardrail must list a CSV input role here)' },
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
                cited: CITED_PROP,
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

// ---- M4e amendments 24 + 25: questions (try 3 only) and "not checked" (every try) ---------------------------------
// borrowed-from: fwdloop poc/am24-questions/draft.mjs@dda0e0f (prompts, linesNamedByReds, normalizeQuestions), adjusted to the product drafter.
export const MAX_QUESTIONS = 2;

/** What fwdloop's typed checks can really check (bareloop F174: give the model the real list, or "Not checked" is invented). */
export const CHECKABLE = Object.freeze([
  'green: a figure cites its source cell or formula',
  'softgreen: the output carries named section headings (sections), in order',
  `softgreen: a word ceiling for the whole output (maxWords; ${WHOLE_OUTPUT_CEILING_RULE}) and per section (wordsPerSection)`,
  'softgreen: a line count per invoice (linesPerInvoice) and fields every line must carry (mustCarry)',
  'hitl: a human accepts or reviews at a signed ask — the machine checks only that the step happened',
]);

/** Offered on EVERY try (it is information, not asking). */
export const NOTCHECKED_PROMPT = [
  'notChecked (optional): a short list of things about the job that no check below will verify. These are the ONLY things fwdloop can check:',
  ...CHECKABLE.map((c) => `- ${c}`),
  'Anything the job asks for beyond those (tone, correctness of prose, completeness, matching a taste) is NOT checked: list it in "notChecked", a plain short phrase each. [] or leave out if nothing.',
].join('\n');

/** Try 3 only, and only after tries 1 and 2 both failed validation. No digit and no number word anywhere (a test greps this): the machine, not the prompt, bounds the count. */
export const QUESTIONS_PROMPT = [
  'You may add "questions" to this reply. Ask only about a job line named in the refusals above, and only if that line cannot be drafted without the answer',
  '(an undefined size, format, destination, or what "done" means). Each question is {line, question}: "line" is the number of the job line it is about.',
  'If the refusals can be fixed without asking, fix them and leave "questions" out. Never ask about a trigger, cap, ask position or TTL, allow-list or send target (signed, not yours).',
  'Still emit the complete corrected declaration.',
].join('\n');

/** The declaration schema plus the optional `notChecked` (every try) and, on try 3 only, `questions`. Neither is in `required`. */
export function buildRoundSchema(menu, { questions = false } = {}) {
  const s = buildDeclarationSchema(menu);
  const extra = { notChecked: { type: 'array', items: { type: 'string' }, description: 'what the job asks for that no typed check verifies' } };
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
 * Amendment 25: a question is kept only if its line is one try 2's reds named; no line, a blank question or a third question is
 * dropped. Every drop comes back with its reason, for the draft's log. Returns {kept, dropped}.
 */
export function normalizeQuestions(raw, failedLines) {
  const kept = [];
  const dropped = [];
  if (raw === undefined || raw === null) return { kept, dropped };
  if (!Array.isArray(raw)) return { kept, dropped: [{ reason: 'questions is not a list', raw }] };
  for (const q of raw) {
    if (!isPlainObject(q) || !Number.isInteger(q.line)) { dropped.push({ reason: 'no line', raw: q }); continue; }
    if (!failedLines.includes(q.line)) { dropped.push({ reason: `line ${q.line} is not a line try 2's checks failed on`, raw: q }); continue; }
    if (typeof q.question !== 'string' || q.question.trim() === '') { dropped.push({ reason: 'blank question', raw: q }); continue; }
    if (kept.length >= MAX_QUESTIONS) { dropped.push({ reason: 'third question', raw: q }); continue; }
    kept.push({ line: q.line, question: q.question.trim() });
  }
  return { kept, dropped };
}

/** `notChecked` as the model sent it: non-blank strings only, trimmed. Anything else is an empty list. */
function cleanNotChecked(raw) {
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
}

function jobLinesText(lines, asks) {
  const askLines = new Set(asks.map((a) => a.line));
  return lines
    .map((l) => `${l.n}. ${l.text}${askLines.has(l.n) ? ' [SIGNED ASK — a human stop]' : ''}`
      + `${l.guardrail ? ` [guardrail: ${l.guardrail}]` : ' [no guardrail]'}`)
    .join('\n');
}

/** M4d amendment 8: the green step must read an input with cells, so the drafter is told the rule and which inputs have cells.
 *  M10 am7: and when the job signs a web page, how a green step checks quotes from it - every rule below is one the validator enforces at $0. */
function greenReadRule(sources) {
  const csvRoles = (sources ?? []).filter((s) => s.kind === 'file' && isCellsPath(s.path)).map((s) => s.role);
  const pageRoles = (sources ?? []).filter((s) => s.kind === 'page').map((s) => s.role);
  const rule = '- A step whose line has a "green" guardrail must list the CSV input\'s role in its reads (for example reads: ["aging"]), because only an input with cells can be cited; a text output of an earlier step has no cells. A green step that reads only other steps is refused.';
  const out = [csvRoles.length
    ? `${rule} CSV inputs in this job: ${csvRoles.join(', ')}.`
    : `${rule} This job signs no CSV input, so a guardrail that needs cited cells cannot be classed green here: class it "hitl"${pageRoles.length ? ' (unless it is about a web page, below)' : ''}.`];
  if (pageRoles.length) {
    out.push(
      `- Web page inputs in this job: ${pageRoles.join(', ')}. A step whose line asks for things found on a web page, and whose guardrail is about them, is "green" and checks quotes: it lists the page's role in its reads and carries close.cited = {source, facts, count}. close.cited is for a green step only.`,
      '- close.cited.count is how many results the line asks for ("List 3" is {min: 3, max: 3}). close.cited.facts is one fact per thing every result must hold, at most 10; a fact name is letters and spaces only (no digit).',
      '- Fact shapes: money takes unit or currency, rule, anchor; number, date and time take rule, anchor; text takes anchor and until (until needs an anchor); phrase takes only phrase (fixed words every result must say). Never put a field on a shape that does not take it.',
      '- A label (anchor, until) is PICKED from the kept labels listed under Inputs for that page, never typed. A phrase, a unit or a currency is copied from the page words listed there. A word listed as Not checked or dropped can never be used.',
      '- A place listed under Inputs as "place phrases" must have EVERY one of its phrases as its own phrase fact (one fact per phrase, the phrase word for word). A place name alone does not tell a result that leaves the other way.',
      '- A fact\'s rule (under, over, between) may only use a number that is in the person\'s own words on that job line (the line or its guardrail). Never make a number up; leave the rule out if the person gave none.',
      '- A label or a phrase that sits in each result must appear on the page at least as many times as close.cited.count.min, or the line is refused.',
    );
  }
  return out;
}

/** M7 piece 6 (signed scope item 1): a granted verb ships WITH the line that says when to reach for it, or the
 *  model keeps using the familiar one. Only these three get a line; each only when it is on the menu. No number
 *  (the tool itself tells a step its size limit). Borrowed in spirit from bareloop src/tools.js@dc06660 strategyFor. */
const WHEN_TO_USE = Object.freeze({
  compress: '- Use compress when a step only needs what a function IS (its signature and doc) rather than how it works: it returns the head without the body, far cheaper than reading the file. Code only.',
  stash: '- Use stash to park a bulky intermediate result under an id instead of carrying it from step to step; it lasts this run only and each parked item has a size limit.',
  peek: '- Use peek to look at the start and end of something parked with stash without loading all of it.',
});

/** @param {Array<{verb: string}>} menu */
function whenToUse(menu) {
  const on = new Set(menu.map((e) => e.verb));
  return Object.entries(WHEN_TO_USE).filter(([verb]) => on.has(verb)).map(([, line]) => line);
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
    ...(whenToUse(menu).length ? ['When to use them:', ...whenToUse(menu), ''] : []),
    'Rules:',
    '- Steps share one artifact space. Each step: primitives (verbs it needs, [] if none), reads (artifact ids emitted by an EARLIER step, or the role of a CSV input listed under Inputs), emits (ONE new unique artifact id), fromLine (the ONE job line it serves), close. The machine fills each step\'s goal with that signed line, verbatim — you never write a goal.',
    '- Every numbered job line must be served by a step (fromLine = that line) or listed in "refused" with a reason.',
    '- guardrailClasses: for each job line that HAS a guardrail, classify its wording once: "green" (every figure must cite its source cell), "softgreen" (the human declared a SHAPE the output must take), "hitl" (an ask/accept/review gate, or anything you are not sure of). When unsure, "hitl".',
    '- close.class MUST equal the class of the guardrail on that step\'s fromLine (guardrailClasses[fromLine]); a line with no guardrail is "hitl". A step cannot claim a class its own line does not earn.',
    ...greenReadRule(arbiter.sources),
    '- close.shape only on a softgreen step; it is the human\'s declared shape in structured form.',
    '- A step whose check reads its reply (softgreen) answers in its reply text and is never granted `write`, `edit` or any other write-class verb; only the send step at the end writes files out.',
    `- Signed ask line(s): ${askLines.length ? askLines.join(', ') : 'none'}. For each, emit EXACTLY ONE step: fromLine = that line, close.class "hitl", primitives []. It is a stop only — never grant a primitive on it, and never emit a pause at any other line.`,
    `- Signed send line(s): ${sendLines.length ? sendLines.join(', ') : 'none'}. That step is drafted like any other: grant the write primitive and read the artifact of the ask step that comes before it. Its target and position are signed, not yours.`,
    '- An ask step must read the output of an earlier step, the thing you are asked to check: its FIRST read is what the human sees at the ask (for example reads: ["bucket_assignment"], the nearest earlier step\'s emits). An ask that reads nothing, or reads something no earlier step makes, is refused. Reading is not a grant: the ask still grants no primitive.',
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

/**
 * Draft one declaration. `provider`/`rates`/`modelId` may be injected (tests,
 * the batch); otherwise a live provider is built from `slot` (throws on a bad
 * key — the batch preflights first). The draft's hard cap is the cap signed in the prose (M4d am13); `priorSpend(ceilingUsd)` (am16) is what this job's earlier drafting already spent, so every round must fit what is LEFT of the cap.
 * `makeProviderFn` is a test seam: the live-provider factory (default `makeProvider`).
 * `onBook` (M4e piece 2a, scope 13): called right BEFORE each provider call (`inFlight: true`, the call counted in
 * `calls`) and right AFTER it (`inFlight: false`), with what is known so far, so the caller can book spend per call
 * and a draft killed between rounds still has its paid rounds on disk. It may throw before a call (nothing is
 * spent then and the draft stops); after a call it is the caller's to keep from throwing.
 *
 * @returns {Promise<{ok:boolean, declaration:object|null, reds:string[], rounds:number, calls:number, spendComplete:boolean,
 *   costUsd:number|null, modelReturned:string|null, modelId?:string, price?:object|null, tokens?:object|null, structureRetries:number, revisions:number, stop:string|null, log:object[],
 *   questions?:{line:number, question:string}[], droppedQuestions?:object[], notChecked?:string[], thinking?:{asked:string, status:string|null, say:string|null}, inputs?:{role:string, detail:string}[],
 *   look?:{facts:any[], dropped:any[]}, pageLooks?:{role:string, address:string, sha256:string, bytes:number, frozen:string, attempts:number, mapping:any}[]}>}
 * `look` / `pageLooks` (M10 item 3) are there when the job signs a web page: the kept facts (with their `reading`, the input a later ask reads), every drop, and per page its address, sha256 and the AI's map. Each drop is also a line in `notChecked`.
 */
export async function draft({
  proseText, slot, model, provider: injected, rates: injectedRates, modelId: injectedModelId, env,
  priorSpend = /** @type {((ceilingUsd: number) => number)|null} */ (null), skills = DRAFT_SKILLS, makeProviderFn = makeProvider, onBook, offerQuestions = true, draftThinking = /** @type {'on'|'off'} */ ('off'),
  draftDir = /** @type {string|null} */ (null), fetchPage = undefined, leftRules = /** @type {{line: number, rule: number}[]} */ ([]),
}) {
  // What was asked of thinking and the WORST status bareagent reported across the rounds (the page says it loudly unless 'applied'). Read from the round log, the one record.
  const thinkingOf = () => {
    const status = worstThinkingStatus(log.map((e) => e.thinkingStatus));
    return { asked: draftThinking, status, say: thinkingSay(status) };
  };
  const fail = (reds, extra = {}) => ({
    ok: false, declaration: null, reds, rounds: 0, calls: 0, spendComplete: true, costUsd: 0, modelReturned: null, structureRetries: 0, revisions: 0, stop: 'pre-flight', log: [], ...extra,
  });

  // ---- $0 gates, before any provider is built -------------------------------
  // `draftThinking` ('on'|'off', M4d am6 item 7 / am7: the Chat tick-box, per job) is an intent only: turning thinking on or off on the wire is bareagent's (am7 item 3).
  if (draftThinking !== 'on' && draftThinking !== 'off') return fail([`config: draftThinking must be on | off, got ${JSON.stringify(draftThinking)}`]);
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return fail(parsed.reds.map((r) => `signed-text: ${r}`));
  const { lines, arbiter } = parsed;
  const ttlReds = unsignedAskTtls(arbiter);
  if (ttlReds.length) return fail(ttlReds);
  // M4e amendment 15 item 2: a guardrail that fights itself on words is red at $0, before any provider is built or called.
  const sumReds = checkGuardrailSums(lines);
  if (sumReds.length) return fail(sumReds);
  const menu = wiredMenu(skills);
  // The file inputs are read first, at $0, before a provider is built (a page input is fetched only after the price and cap gates, below).
  const fileFacts = readInputFacts((arbiter.sources ?? []).filter((s) => s.kind !== 'page'));
  if (!fileFacts.ok) return fail(fileFacts.reds);

  let { provider, rates, modelId } = { provider: injected, rates: injectedRates, modelId: injectedModelId };
  let prices = null; // the one price lookup's result (live provider only); the cap check below uses the SAME price
  if (provider == null) {
    try {
      ({
        provider, rates, modelId, prices = null,
      } = makeProviderFn(slot, { model, env, ...LIVE_PROVIDER_OPTIONS }));
    } catch (err) {
      return fail([err instanceof ModelRefusal ? err.message : `${err instanceof ConfigError ? 'config' : 'key'}: ${err.message}`]);
    }
  }

  const lineNums = lines.map((l) => l.n);
  // Full catalogue + the wired set: an unwired verb reds "not wired" by name; an unsigned skill reds by skill.
  const cat = loadCatalogue();
  if (!cat.ok) return fail([`catalogue: ${cat.reds.join('; ')}`]);
  const validationCatalogue = cat.primitives;
  // The hold: the picked model's own Settings prices (or the rates a test injected) times the token bounds - never a table.
  if (!rates) return fail(['price: this round has no price to hold - tick a model in Settings > Providers with both prices first']);
  const roundCeiling = ceilingCostUsd(rates);
  // M4d am13: the draft is capped by the card's Cap $ (the cap signed in the prose), the same number the run is capped at.
  // One round at its ceiling must fit that cap, or refuse at $0 before any provider call.
  // M4d am16 item 2: against the remaining money, not the whole cap. Spend by earlier drafts of this job (a revise, the redraft after answers) is taken off first.
  const priorUsd = typeof priorSpend === 'function' ? priorSpend(roundCeiling) : 0;
  const budgetUsd = arbiter.capUsd - priorUsd;
  /** the refusal when one round held at `ceiling` does not fit what is left of the cap (the drafter's own words, one place) */
  const tooSmall = (ceiling) => (priorUsd > 0
    ? `Cap ${usdText(arbiter.capUsd)} less ${usdText(priorUsd)} already spent on drafting leaves ${usdText(Math.max(0, budgetUsd))}, below one drafting round's worst case for ${modelId}, $${ceiling.toFixed(4)}. Raise Cap $ or pick another model.`
    : capTooSmallText('drafting', arbiter.capUsd, ceiling, modelId));
  if (roundCeiling > budgetUsd) return fail([tooSmall(roundCeiling)]);

  const meterings = [];
  const log = [];
  let calls = 0; // provider calls made (a call that threw before metering is in `calls`, not in `rounds`)
  let unmetered = 0; // calls that failed with no metering: their cost is unknown
  const book = (inFlight) => onBook?.({
    inFlight, calls, unmetered, metered: sumMeterings(meterings), modelId, price: priceRecord(prices, rates),
  });

  // M10 item 1: a web page input is fetched once and frozen into the DRAFT folder (the drafting copy). A run freezes its own copy at its own start
  // (`freezeInputs`), so a run is never checked against this one. Only now, after the $0 price and cap gates: a draft refused for money fetches nothing.
  const pageSources = (arbiter.sources ?? []).filter((s) => s.kind === 'page');
  /** @type {Record<string, {text: string, entry: {id: string, source: string, frozen: string, sha256: string, bytes: number}}>} */
  const pages = {};
  if (pageSources.length) {
    if (typeof draftDir !== 'string' || draftDir === '') return fail(['draft: a web page input needs a folder to keep its drafting copy']);
    for (const s of pageSources) {
      const fr = await freezePage(draftDir, s.role, s.path, { fetchPage });
      if (!fr.ok) { removeFrozenPages(draftDir, Object.values(pages).map((pg) => pg.entry.frozen)); return fail([fr.red]); }
      pages[s.role] = { text: fr.text, entry: fr.entry };
    }
  }
  const facts = readInputFacts(arbiter.sources, { pages });
  if (!facts.ok) { removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((pg) => pg.entry.frozen)); return fail(facts.reds); }

  // M10 item 3: ONE map call per page input names the page's own words; code keeps what the saved page proves. Every round goes through the
  // same metering and book as a drafting round, so a pre-send throw from the book stops here with nothing spent.
  /** @type {{facts: any[], dropped: any[]}} */
  const look = { facts: [], dropped: [] };
  /** @type {string[]} */
  const pageNotChecked = [];
  /** @type {any[]} */
  const pageLooks = [];
  const pageExtras = pageSources.length ? { look, pageLooks } : {};
  let mapCut = null;
  const jobLines = lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) }));
  const pageInfo = [];
  for (const s of pageSources) {
    const pg = pages[s.role];
    // The hold of the map call is sized from its own prompt (the saved page is in it): one that cannot fit what is left of the cap is refused here, at $0.
    const mapCeiling = ceilingCostUsd(rates, mapPrompt({ jobLines, label: s.role, text: pg.text }).length + MAP_SYSTEM.length);
    const spentBefore = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spentBefore + mapCeiling > budgetUsd) {
      if (meterings.length === 0 && calls === 0) { removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((q) => q.entry.frozen)); return fail([tooSmall(mapCeiling)]); }
    }
    const callModel = async (content, attempt) => {
      const spentSoFar = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
      if (spentSoFar + ceilingCostUsd(rates, content.length + MAP_SYSTEM.length) > budgetUsd) { mapCut = 'budget'; return { error: 'the draft budget is spent' }; }
      const roundEvents = [];
      const mapLoop = new Loop({ provider, rates, onLlmResult: async (ev) => { roundEvents.push(ev); meterings.push(ev); } });
      calls += 1;
      book(true);
      let res;
      let threw = null;
      try {
        res = await mapLoop.run([{ role: 'system', content: MAP_SYSTEM }, { role: 'user', content }], [], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: attempt === 1 ? draftThinking : 'on' });
      } catch (err) {
        threw = err;
        if (roundEvents.length === 0) unmetered += 1;
      }
      book(false);
      const entry = { round: log.length + 1, kind: 'page-map' };
      if (res?.thinkingApplied !== undefined) entry.thinkingApplied = res.thinkingApplied;
      if (res?.thinkingStatus !== undefined) entry.thinkingStatus = res.thinkingStatus;
      if (threw) { entry.outcome = `provider-red: ${threw.message}`; log.push(entry); mapCut = 'provider-red'; return { error: threw.message }; }
      const cutOff = res?.stopReason === 'max_tokens';
      entry.outcome = cutOff ? 'truncated' : 'answered';
      log.push(entry);
      if (res?.error && !cutOff) return { error: String(res.error) };
      return { text: res?.text ?? '', cutOff };
    };
    const got = await lookAtPage({ label: s.role, text: pg.text, jobLines, callModel });
    if (!got.ok) {
      const m = sumMeterings(meterings);
      return {
        ok: false, declaration: null, reds: [got.reason], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries: 0, revisions: 0, stop: mapCut ?? 'page-map', log, thinking: thinkingOf(), inputs: facts.list, questions: [], droppedQuestions: [], notChecked: [], ...pageExtras,
      };
    }
    // A rule the person left Not checked ("drop it", asked earlier) is served by no fact, whatever this look found for it.
    const keptFacts = got.look.facts.filter((f) => !leftRules.some((l) => l.line === f.line && l.rule === f.forRule));
    look.facts.push(...keptFacts);
    look.dropped.push(...got.look.dropped);
    for (const l of got.notChecked) if (!pageNotChecked.includes(l)) pageNotChecked.push(l);
    pageLooks.push({
      role: s.role, address: s.path, sha256: pg.entry.sha256, bytes: pg.entry.bytes, frozen: path.basename(pg.entry.frozen), attempts: got.attempts, mapping: got.mapping,
    });
    pageInfo.push(...pageInfoLines({
      label: s.role, address: s.path, chars: pg.text.length, look: { ...got.look, facts: keptFacts }, notChecked: got.notChecked,
    }));
  }
  // The rules the person left Not checked: one drop each (the one table writes the words), told to the drafter too, so it never claims them.
  if (pageSources.length) {
    /** @type {any[]} */
    const left = [];
    for (const l of leftRules) {
      const jl = jobLines.find((x) => x.n === l.line);
      const text = jl === undefined ? undefined : lineRules(jl)[l.rule - 1];
      if (text !== undefined && !left.some((d) => d.line === l.line && d.rule === l.rule)) left.push({ line: l.line, rule: l.rule, fact: text, reason: 'person-left', source: 'person' });
    }
    if (left.length) {
      look.dropped.push(...left);
      const lines = left.map((d) => leftRuleLine(d.fact));
      for (const x of lines) if (!pageNotChecked.includes(x)) pageNotChecked.push(x);
      pageInfo.push('  You chose to leave these Not checked; never claim them as checked:', ...lines.map((x) => `  - ${x}`));
    }
  }
  // M10 piece 3 (item 4, am1, am2): CODE decides the early asks from the look, after the one map call and BEFORE any drafting round. A signed ask line's own
  // guardrail is a human stop, not a page check, so it is not asked. More than MAX_LOOK_ASKS is a job to rewrite: nothing is asked, nothing more is spent.
  // The redraft after the answers (offerQuestions false) never asks.
  if (pageSources.length && offerQuestions) {
    const askLines = new Set(arbiter.asks.map((a) => a.line));
    const asks = askableFromLook(look, jobLines.filter((l) => !askLines.has(l.n)));
    if (asks.length > 0) {
      const m = sumMeterings(meterings);
      const spent = m.costUsd === null || unmetered > 0 ? (m.costUsd === null ? 'unknown' : `at least ${usdText(m.costUsd)}`) : usdText(m.costUsd);
      const tooMany = asks.length > MAX_LOOK_ASKS;
      if (tooMany) removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((q) => q.entry.frozen)); // a refused draft keeps no page copy
      return {
        ok: false, declaration: null, reds: tooMany ? [`${tooManyAsksText(asks)} Spent so far: ${spent}.`] : [], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries: 0, revisions: 0, stop: tooMany ? 'look-asks-too-many' : 'look-asks', log, thinking: thinkingOf(), inputs: facts.list,
        questions: tooMany ? [] : asks.map((a) => ({
          line: a.line, question: a.question, source: a.source, ask: a.ask, ruleNo: a.rule, ruleText: a.ruleText, proposal: a.reading ?? null,
        })),
        droppedQuestions: [], notChecked: pageNotChecked, ...pageExtras,
      };
    }
  }
  // The page lines go on the drafter's list of inputs: the first line of a page's block replaces the plain line readInputFacts wrote for it.
  const factsInfo = pageSources.length ? [...facts.info.filter((l) => !pageSources.some((s) => l.startsWith(`- ${s.role}: a web page`))), ...pageInfo] : facts.info;

  // `notChecked` is offered on every try (information, not asking); `questions` only on try 3 (below).
  const baseSystem = buildSystemPrompt({ menu, lines, arbiter, factsInfo });
  const system = `${baseSystem}\n\n${NOTCHECKED_PROMPT}`;
  let structureRetries = 0;
  let revisions = 0;
  let lastReds = [];
  let lastDecl = null;
  let userText = `Call ${TOOL} now.`;
  let nextKind = 'first'; // what the round about to run actually is
  let validatorReds = []; // the last validator refusal; a structure retry after a revision must not drop it
  let stop = null;
  let failedLines = []; // the job lines try 2's reds named: a question is kept only about one of these (amendment 25)
  /** @type {{questions:{line:number, question:string}[], droppedQuestions:object[], notChecked:string[]}} */
  let extras = { questions: [], droppedQuestions: [], notChecked: pageNotChecked }; // from the round that produced `lastDecl`, never an earlier one

  for (;;) {
    // Budget: spend so far (an unpriced round counts at its ceiling) + one more
    // round at its ceiling must fit, or we stop here, booked.
    const spent = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spent + roundCeiling > budgetUsd) { stop = 'budget'; break; }

    // assigned inside the tool's execute callback, which TS cannot see
    /** @type {any} */
    let captured;
    // Amendment 25: a lock is a mechanism. Only try 3 of 3, and only when tries 1 and 2 BOTH failed validation (`revisions` counts the
    // validator's refusals fed back), gets the `questions` property; the redraft after an answer passes offerQuestions:false and never does.
    const askOpen = offerQuestions && revisions === MAX_REVISIONS;
    const schema = buildRoundSchema(menu, { questions: askOpen });
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
    book(true);
    try {
      result = await loop.run(
        [{ role: 'system', content: system }, { role: 'user', content: userText }],
        [tool],
        // M4d am4: thinking 'on' forces no tool (provider default 'auto'; a text reply goes to the structure retry); 'off' forces it.
        // M4d am7 item 3: `thinkingMode` is bareagent's switch ('on' | 'off'); we send no raw `thinking` field anywhere.
        { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: draftThinking, ...(draftThinking === 'on' ? {} : { toolChoice: { name: TOOL } }) },
      );
    } catch (err) {
      threw = err;
      if (roundEvents.length === 0) unmetered += 1;
    }
    book(false);
    const entry = { round: log.length + 1, kind: nextKind };

    if (result?.thinkingApplied !== undefined) entry.thinkingApplied = result.thinkingApplied; // bareagent's verdict on this round: true | false | null
    if (result?.thinkingStatus !== undefined) entry.thinkingStatus = result.thinkingStatus; // 'applied' | 'unsupported' | 'ignored' | 'unknown' (bare-agent >= 0.52)

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
      // M4d am3 A3: a round cut off at the output cap before tries 1 and 2 are spent is a FAILED TRY, advancing the same counter a
      // validator red does, so the try-3 question can open. A cut-off names no line, so then every job line may be asked about.
      if (result?.stopReason === 'max_tokens' && revisions < MAX_REVISIONS) {
        revisions += 1;
        nextKind = 'revision';
        userText = `Your last reply was cut off at the output limit before a complete tool call. Call ${TOOL} now with a complete, valid JSON declaration.`;
        if (validatorReds.length) userText += `\n\nThe last declaration you emitted was still refused by the validator; keep fixing these too:\n${validatorReds.map((r) => `- ${r}`).join('\n')}`;
        if (offerQuestions && revisions === MAX_REVISIONS) {
          failedLines = lineNums;
          userText += `\n\n${QUESTIONS_PROMPT}`;
        }
        continue;
      }
      if (structureRetries >= MAX_STRUCTURE_RETRIES) { stop = 'structure'; break; }
      structureRetries += 1;
      nextKind = 'structure-retry';
      userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
      if (validatorReds.length) userText += `\n\nThe last declaration you emitted was still refused by the validator; keep fixing these too:\n${validatorReds.map((r) => `- ${r}`).join('\n')}`;
      if (askOpen) userText += `\n\n${QUESTIONS_PROMPT}`;
      continue;
    }

    // `notChecked` was offered on every try, so it is information and never reaches the validator. `questions` is stripped only where it was
    // offered; sent when not offered it stays, and the validator reds it as an unknown key (a stray key, never a silent pass).
    const { questions: rawQuestions, notChecked: rawNotChecked, ...captureRest } = /** @type {Record<string, any>} */ (captured);
    /** @type {Record<string, any>} */
    const declaration = { ...(askOpen ? captureRest : { ...captureRest, ...(rawQuestions === undefined ? {} : { questions: rawQuestions }) }), inputFacts: facts.inputFacts };
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
      // M10 am7 item 1: the words of every cited fact are proved on the drafting copy of the page, against what the page-word map kept
      pageWords: { texts: Object.fromEntries(Object.entries(pages).map(([role, pg]) => [role, pg.text])), look: pageSources.length ? { facts: look.facts, dropped: look.dropped } : null },
    });
    lastDecl = declaration;
    const asked = askOpen ? normalizeQuestions(rawQuestions, failedLines) : { kept: [], dropped: [] };
    extras = { questions: asked.kept, droppedQuestions: asked.dropped, notChecked: [...pageNotChecked, ...cleanNotChecked(rawNotChecked).filter((x) => !pageNotChecked.includes(x))] };
    if (asked.dropped.length) entry.droppedQuestions = asked.dropped;
    if (verdict.ok) {
      entry.outcome = 'valid';
      log.push(entry);
      const m = sumMeterings(meterings);
      return {
        ok: true, declaration, reds: [], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries, revisions, stop: null, log, thinking: thinkingOf(), inputs: facts.list, ...extras, ...pageExtras,
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
    if (offerQuestions && revisions === MAX_REVISIONS) {
      failedLines = linesNamedByReds(lastReds, declaration, lineNums);
      userText += `\n\n${QUESTIONS_PROMPT}`;
    }
  }

  const m = sumMeterings(meterings);
  // Runner convention: `costUsd` is the priced sum (null when ANY round is unpriced, so the CLI prints UNKNOWN,
  // never a bare number), and `spendComplete:false` marks a call that failed unmetered or a round left unpriced.
  return {
    ok: false, declaration: lastDecl, reds: lastReds, rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries, revisions, stop, log, thinking: thinkingOf(), inputs: facts.list, ...extras, ...pageExtras,
  };
}
