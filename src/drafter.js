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
import { validateDeclaration, checkGuardrailSums, checkSendLineGuardrail } from './declaration.js';
import { readEveryStep } from './whole-job.js';
import {
  RECOGNISE_SYSTEM, RECOGNISE_SCHEMA, RECOGNISE_TOOL, SUGGEST_SYSTEM as ACTION_SUGGEST_SYSTEM, SUGGEST_SCHEMA as ACTION_SUGGEST_SCHEMA, SUGGEST_TOOL as ACTION_SUGGEST_TOOL,
  jobListing, recognisedIsLast, cleanSuggestion, suggestionQuestion, withoutSend,
} from './action-line.js';
import { loadCatalogue } from './catalogue.js';
import { findMcpPlanRed } from './canrun.js';
import { WIRED_VERBS, wiredMenu } from './primitives.js';
import { ticketSourcesOf, ticketFactsLines, mcpFactsLines, ticketSchemaParts, ticketReds, userMcpServers } from './ticket-draft.js';
import { readInputFacts } from './input-facts.js';
import { freezePage } from './runner.js';
import { removeFrozenPages } from './flow.js';
import { lookAtPage, pageInfoLines } from './pagelook.js';
import { lookAtSheet, sheetPrompt } from './sheetlook.js';
import { lookAtShape, SHAPE_SYSTEM, SHAPE_CALL_LABEL } from './shapelook.js';
import { buildShapes } from './shapebuild.js';
import { leftRuleLine, dropRows, dropLine } from './pagedropwords.js';
import {
  offerRules, rowsFromAnswer, retentionOf, SUGGEST_SYSTEM, SUGGEST_TOOL, SUGGEST_SCHEMA, suggestUserText, codeScope,
} from './checkpick.js';
// M16 (docs/wiki/the-module-ladder.md, "M16"): the check block's turns, wired beside the declaration path
import { blockJobLines } from './blocklines.js';
import { setUpBlock, ticketLeaveOut, pickEdits, ledgerEdits, repairedEditsReadable, editRecord, renderRejectBlock, buildFaultWords, isBuildFault } from './blockdraft.js';
import { assembleFromBlock, closeUnbuiltSheetSteps } from './blockassemble.js';
import { cardOfBlock, cardOfPlanBlock } from './cardlist.js';
import { ledgerRowsOf } from './checkrows.js';
import { questionsOfBlock } from './blockasks.js';
import { NOTE_KIND, NOTE_TOOL, NOTE_SYSTEM, NOTE_SCHEMA, notePrompt, noteAnswers } from './noteask.js';
import { ledgerRecord, LEDGER_SYSTEM, LEDGER_SCHEMA, LEDGER_TOOL, ledgerUserText } from './checklist.js';
import { ROW_EDIT_SYSTEM, ROW_EDIT_REVISE, rowEditUserText, rowEditChannel, editsOf, ticketFilterBlock } from './rowedit.js';
import { matchRecord, entriesFromAnswers, columnEntries, columnsOnLines } from './pickrecord.js';
import { MAP_SYSTEM, mapPrompt } from './pagemap.js';
import { tooManyAsksText, MAX_LOOK_ASKS } from './pageask.js';
import { lineRules } from './pagebits.js';
import { isCountGuardrail } from './declaration.js';
import path from 'node:path';
import { isCellsPath } from './closers.js';
import { parseCsv, sheetTable } from './csv.js';
import { sheetSuggestProp, sheetOfferRules, agreedColumnWords } from './sheetoffer.js';
import { uncoveredRules, csvRolesOf } from './sheetblock.js';
import { withSheetRows, withSheetCard } from './sheetrows.js';
import { buildSheetChecks, unbuiltSheetLines } from './sheetbuild.js';
import { TICKET_FIELDS, ticketRuleField, proposalReds, withTicketRows } from './ticketrows.js';
import {
  makeProvider, ModelRefusal, sumMeterings, ceilingCostUsd, priceRecord,
} from './provider.js';
import { LIVE_PROVIDER_OPTIONS } from './model-step.js';
import { ConfigError } from './config.js';
import { thinkingSay, worstThinkingStatus } from './thinking.js';
import { repairTrailingBraces } from './jsonbrace.js';

export const MAX_STRUCTURE_RETRIES = 2;
export const MAX_REVISIONS = 2;
export const DRAFT_MAX_TOKENS = 16000;
export const DRAFT_SKILLS = Object.freeze(['core']);

export const CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

/** The whole-output-ceiling rule, told once to the drafter (schema and prompt use this string). Amendment 29; no number words (am25). */
export const WHOLE_OUTPUT_CEILING_RULE = "use the guardrail's ceiling for the whole output";

/** @param {any[]|undefined} sources @returns {string[]} the roles of the document inputs (.docx / .md / .txt) */
export const docRolesOf = (sources) => (sources ?? []).filter((s) => s.kind === 'file' && DOC_EXTS.some((x) => String(s.path).toLowerCase().endsWith(x))).map((s) => s.role);

/** the document inputs a quote can come from (M10 piece 5, item 2) */
const DOC_EXTS = Object.freeze(['.docx', '.md', '.txt']);

/** M10 am8 item 2: the column lock of a green step that reads a CSV input (`close.columns`): the exact header(s) its values come from. */
const COLUMNS_PROP = Object.freeze({
  type: 'array',
  minItems: 1,
  maxItems: 10,
  description: "only on a green step that reads a CSV input: the exact column names (the sheet's header) its values come from. Omit on any other step",
  items: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'the role of the CSV input (also in the step\'s reads)' },
      column: { type: 'string', description: "the column's name, copied exactly from the sheet's header" },
    },
    required: ['source', 'column'],
    additionalProperties: false,
  },
});

/**
 * The forced tool's parameter schema. `menu` = wiredMenu(). M17 am2: the AI is offered no `close.sheet` (it suggests sheet checks on the row-edit reply, src/rowedit.js; code builds them, src/sheetbuild.js).
 * M13 piece 4: `ticket` = `{flowType, tools}` for MCP (generic) and Tickets; then a step may carry `mcpTools` (an enum of the job's tools) and, for Tickets, the tool carries `ticketFilter` and `ticketWatch` (src/ticket-draft.js). The job's `mcp` block and `flowType` are set by code, never offered.
 * M16 item 5: the AI is offered no `close.cited` (the list owns the facts; code builds them from its rows).
 * @param {any[]} menu @param {{ticket?: {flowType: 'mcp'|'tickets', tools: string[]}}} [o]
 */
export function buildDeclarationSchema(menu, { ticket } = {}) {
  const ticketParts = ticket ? ticketSchemaParts(ticket) : null;
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
            ...(ticketParts ? ticketParts.step : {}),
            reads: { type: 'array', items: { type: 'string' }, description: 'artifact ids emitted by EARLIER steps only (an ask step lists the earlier output to be checked FIRST), or the role of a CSV input (a step whose line has a green guardrail must list a CSV input role here); never a .docx/.md/.txt input role unless the step quotes it (close.cited.source), otherwise grant read/readDocx instead' },
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
                columns: COLUMNS_PROP,
              },
              required: ['class'],
              additionalProperties: false,
            },
          },
          required: ['primitives', 'reads', 'emits', 'fromLine', 'close'],
          additionalProperties: false,
        },
      },
      ...(ticketParts ? ticketParts.top : {}),
      guardrailClasses: {
        type: 'object',
        additionalProperties: { type: 'string', enum: [...CLASSES] },
        description: 'one class per job line that HAS a guardrail, keyed by line number as a string',
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
    required: ['steps', 'guardrailClasses', 'refused'],
    additionalProperties: false,
  };
}

const TOOL = 'emit_declaration';

// ---- M4e amendments 24 + 25: questions (try 3 only); the AI's own "not checked" notes are gone (M17 am4, C1) ---------------------------------
// borrowed-from: fwdloop poc/am24-questions/draft.mjs@dda0e0f (prompts, linesNamedByReds, normalizeQuestions), adjusted to the product drafter.
export const MAX_QUESTIONS = 2;

/** Try 3 only, and only after tries 1 and 2 both failed validation. No digit and no number word anywhere (a test greps this): the machine, not the prompt, bounds the count. */
export const QUESTIONS_PROMPT = [
  'You may add "questions" to this reply. Ask only about a job line named in the refusals above, and only if that line cannot be drafted without the answer',
  '(an undefined size, format, destination, or what "done" means). Each question is {line, question}: "line" is the number of the job line it is about.',
  'If the refusals can be fixed without asking, fix them and leave "questions" out. Never ask about a trigger, cap, ask position or TTL, allow-list or send target (signed, not yours).',
  'Still emit the complete corrected declaration.',
].join('\n');

/** The declaration schema plus, on try 3 only, `questions` (not in `required`). */
/** @param {any[]} menu @param {{questions?: boolean, ticket?: {flowType: 'mcp'|'tickets', tools: string[]}}} [o] */
export function buildRoundSchema(menu, { questions = false, ticket = undefined } = {}) {
  const s = buildDeclarationSchema(menu, { ticket });
  /** @type {Record<string, any>} */
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

// M10 am27 (1): at draft time a count guardrail is hidden from the AI (the page look and the drafter); code keeps the ORIGINAL rule numbers and text.
// M16 S5: not on a line the check block is given (`all`): its count rules are shown like any other (am27 (1) is replaced for the lines of the list)
const shownRules = (/** @type {string} */ guardrail, all = false) => lineRules({ rule: guardrail }).filter((r) => all || !isCountGuardrail(r)).join('; ');

/**
 * The job lines as the page look may see them (no count rule), and `toOriginal`, which takes a look fact's / dropped entry's visible rule number back to the guardrail's own number.
 * @param {{n: number, text: string, rule?: string}[]} jobLines @param {Set<number>} [shown] lines whose count rules the look may see (M16: the block's lines)
 */
export function hideCounts(jobLines, shown = /** @type {Set<number>} */ (new Set())) {
  // M16 item 5: the lines the check block is given show their count rules to the look (`shown`); every other line is as before
  const seenLines = jobLines.map((l) => { const kept = lineRules(l).filter((r) => shown.has(l.n) || !isCountGuardrail(r)); return { n: l.n, text: l.text, ...(kept.length ? { rule: kept.join('; ') } : {}) }; });
  const ruleMap = (/** @type {number} */ line, /** @type {number|undefined} */ vis) => {
    if (vis === undefined || shown.has(line)) return vis;
    const orig = lineRules(jobLines.find((x) => x.n === line)).map((r, i) => ({ r, no: i + 1 })).filter((x) => !isCountGuardrail(x.r));
    return orig[vis - 1]?.no ?? vis;
  };
  const toOriginal = (/** @type {any} */ f) => (f.forRule !== undefined ? { ...f, forRule: ruleMap(f.line, f.forRule) } : f.rule !== undefined ? { ...f, rule: ruleMap(f.line, f.rule) } : f);
  return { seenLines, toOriginal };
}

function jobLinesText(lines, asks, blockLines = /** @type {Set<number>} */ (new Set())) {
  const askLines = new Set(asks.map((a) => a.line));
  return lines
    .map((l) => `${l.n}. ${l.text}${askLines.has(l.n) ? ' [SIGNED ASK — a human stop]' : ''}`
      + `${l.guardrail && shownRules(l.guardrail, blockLines.has(l.n)) ? ` [guardrail: ${shownRules(l.guardrail, blockLines.has(l.n))}]` : ' [no guardrail]'}`)
    .join('\n');
}

/** M4d amendment 8: the green step must read an input with cells, so the drafter is told the rule and which inputs have cells.
 *  M10 am7: and when the job signs a web page, how a green step checks quotes from it - every rule below is one the validator enforces at $0. */
function greenReadRule(sources) {
  const csvRoles = (sources ?? []).filter((s) => s.kind === 'file' && isCellsPath(s.path)).map((s) => s.role);
  // M10 piece 5 (item 2): a quote in a doc - a .docx / .md / .txt input is quoted the way a page is
  const docRoles = docRolesOf(sources);
  const rule = '- A step whose line has a "green" guardrail must list the CSV input\'s role in its reads (for example reads: ["aging"]), because only an input with cells can be checked against its sheet; a text output of an earlier step has no cells. A green step that reads only other steps is refused.';
  const out = [csvRoles.length
    ? `${rule} CSV inputs in this job: ${csvRoles.join(', ')}. close.columns = [{source, column}] names the exact column(s) of the CSV header that the step's values come from. Where the Inputs list says a line "is column 'X'", that line's step must name that column. A step that has close.sheet is not held to close.columns by a word that merely matches a header (such as a bucket name); but when a line carries a rule "use the column 'X' for ...", at least one of that line's close.sheet checks must use that column. Leave close.columns out when the line names no column.`
    : `${rule} This job signs no CSV input, so a guardrail that needs a sheet check cannot be classed green here: class it "hitl".`];
  // M16 S5: the check block builds the quote checks of its lines; the drafter is told nothing of close.cited and offers none
  if (docRoles.length) out.push(`- A document input (${docRoles.join(', ')}) is never listed in reads. A step that needs the document is granted "read" ("readDocx" for a .docx) and reads it by its role through that tool; its reads stay empty or hold only earlier outputs.`);
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

export function buildSystemPrompt({ menu, lines, arbiter, factsInfo, blockLines = /** @type {Set<number>} */ (new Set()) }) {
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
    '- guardrailClasses: for each job line that HAS a guardrail, classify its wording once: "green" (every figure must be checkable against its source: a sheet figure by the bareguard checks of the sheet), "softgreen" (the human declared a SHAPE the output must take), "hitl" (an ask/accept/review gate, or anything you are not sure of). When unsure, "hitl".',
    '- close.class MUST equal the class of the guardrail on that step\'s fromLine (guardrailClasses[fromLine]); a line with no guardrail is "hitl". A step cannot claim a class its own line does not earn.',
    ...greenReadRule(arbiter.sources),
    '- You write no check. A shape guardrail (a word count, a list size, headings) is settled before you draft: the human picks each check from a list and code puts the picked checks in the plan, so there is no close.shape for you to write. Still answer close.class and guardrailClasses as above; code sets the class of a line whose guardrail it settled from what the human picked.',
    '- The send line (the job\'s action: its last line, when it writes out everything before it) ships the output of the step right before it; it has no guardrail and no check of its own.',
    '- A step whose check reads its reply (softgreen) answers in its reply text and is never granted `write`, `edit` or any other write-class verb; only the send step at the end writes files out.',
    `- Signed ask line(s): ${askLines.length ? askLines.join(', ') : 'none'}. For each, emit EXACTLY ONE step: fromLine = that line, close.class "hitl", primitives []. It is a stop only — never grant a primitive on it, and never emit a pause at any other line.`,
    `- Signed send line(s): ${sendLines.length ? sendLines.join(', ') : 'none'}. That step is drafted like any other: grant the write primitive and read the artifact of the step that comes right before it. Its target and position are signed, not yours.`,
    '- An ask step must read the output of an earlier step, the thing you are asked to check: its FIRST read is what the human sees at the ask (for example reads: ["bucket_assignment"], the nearest earlier step\'s emits). An ask that reads nothing, or reads something no earlier step makes, is refused. Reading is not a grant: the ask still grants no primitive.',
    ...(sendLines.length ? [] : ['- Nothing hitl may come after the last signed ask except the send step.']),
    '- You never author a trigger, cap, ask position or TTL, allow-list, send target, or what "done" means.',
    '',
    'Inputs, mechanically read (facts, not guesses):',
    ...(factsInfo.length ? factsInfo : ['- (none)']),
    '',
    'The numbered job lines:',
    jobLinesText(lines, arbiter.asks, blockLines),
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
 *   questions?:{line:number, question:string}[], proseText?:string, action?:{line:number, by?:'agent'|'you', dropped?:true}|null, droppedQuestions?:object[], notChecked?:string[], thinking?:{asked:string, status:string|null, say:string|null}, inputs?:{role:string, detail:string}[],
 *   checkCard?:ReturnType<typeof cardOfPlanBlock>, sheetBuilt?:Awaited<ReturnType<typeof buildSheetChecks>>, notCheckedBy?:Record<string,'you'|'agent'|'default'>, look?:{facts:any[], dropped:any[]}, pageLooks?:{role:string, address:string, sha256:string, bytes:number, frozen:string, attempts:number, mapping:any}[], sheetLooks?:any[], box?:string}>}
 * `learnHints` (M8 item 5a): the earlier runs' notes block (src/learnstore.js hintsForRun), appended to the drafter's system prompt; null = nothing.
 * `look` / `pageLooks` (M10 item 3) are there when the job signs a web page: the kept facts (with their `reading`, the input a later ask reads), every drop, and per page its address, sha256 and the AI's map. Each drop is also a line in `notChecked`.
 */
export async function draft({
  proseText, slot, model, provider: injected, rates: injectedRates, modelId: injectedModelId, env,
  priorSpend = /** @type {((ceilingUsd: number) => number)|null} */ (null), skills = DRAFT_SKILLS, makeProviderFn = makeProvider, onBook, offerQuestions = true, draftThinking = /** @type {'on'|'off'} */ ('off'),
  draftDir = /** @type {string|null} */ (null), fetchPage = undefined, leftRules = /** @type {{line: number, rule: number}[]} */ ([]), columnAnswers = /** @type {{line: number, word: string, column: string}[]} */ ([]), carriedColumns = /** @type {any[]} */ ([]), onColumns = /** @type {(rec: any[]) => void} */ (() => {}),
  checkPicks = /** @type {import('./checkpick.js').Pick[]} */ ([]),
  // M10 am17/am18: the picks of the plan this one follows (src/pickrecord.js entries), and a callback that is handed this draft's record (kept + newly answered) for the one writer
  carriedPicks = /** @type {import('./pickrecord.js').Entry[]} */ ([]), carriedChoices = /** @type {any[]|null} */ (null), carriedSheetDropped = /** @type {any[]} */ ([]), onSheetDropped = /** @type {(rec: any[]) => void} */ (() => {}), carriedShapeDropped = /** @type {any[]} */ ([]), onShapeDropped = /** @type {(rec: any[]) => void} */ (() => {}), onChoices = /** @type {(rec: any[]) => void} */ (() => {}), onPickRecord = /** @type {((r: {picks: import('./pickrecord.js').Entry[], kept: {line: number, rule: number, ruleText: string, check: Record<string, any>|null}[]}) => void)|null} */ (null),
  learnHints = /** @type {{text: string, ids: string[]}|null} */ (null),
  mcpServers = /** @type {string[]|undefined} */ (undefined),
  // M13 piece 4: the job's flow type and its MCP pick (`mcpPickFor`: `{ok, server, tools}`), both set by code from the card; the drafter is told them, never asked for them
  flowType = /** @type {'plain'|'mcp'|'tickets'} */ ('plain'), mcp = /** @type {any} */ (null),
  // M13 am11: what the prose's send line is. null = the prose file is the truth (a hand-written send line); 'check' = the card's tentative send on the last line: the AI answers whether
  // it is the action; 'known' = the person agreed or typed the last line (no question)
  actionMode = /** @type {null|'check'|'known'} */ (null),
}) {
  // What was asked of thinking and the WORST status bareagent reported across the rounds (the page says it loudly unless 'applied'). Read from the round log, the one record.
  const thinkingOf = () => {
    const status = worstThinkingStatus(log.map((e) => e.thinkingStatus));
    return { asked: draftThinking, status, say: thinkingSay(status) };
  };
  const fail = (reds, extra = /** @type {{box?: string}} */ ({})) => ({
    ok: false, declaration: null, reds, rounds: 0, calls: 0, spendComplete: true, costUsd: 0, modelReturned: null, structureRetries: 0, revisions: 0, stop: 'pre-flight', log: [], ...extra,
  });

  // ---- $0 gates, before any provider is built -------------------------------
  // `draftThinking` ('on'|'off', M4d am6 item 7 / am7: the Chat tick-box, per job) is an intent only: turning thinking on or off on the wire is bareagent's (am7 item 3).
  if (draftThinking !== 'on' && draftThinking !== 'off') return fail([`config: draftThinking must be on | off, got ${JSON.stringify(draftThinking)}`]);
  if (actionMode !== null && actionMode !== 'check' && actionMode !== 'known') return fail([`config: actionMode must be check | known, got ${JSON.stringify(actionMode)}`]);
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return fail(parsed.reds.map((r) => `signed-text: ${r}`), { box: 'job' });
  const { lines } = parsed;
  let { arbiter } = parsed;
  const ttlReds = unsignedAskTtls(arbiter);
  if (ttlReds.length) return fail(ttlReds, { box: 'job' });
  // M4e amendment 15 item 2: a guardrail that fights itself on words is red at $0, before any provider is built or called.
  const sumReds = checkGuardrailSums(lines);
  if (sumReds.length) return fail(sumReds, { box: 'job' });
  // M10 amendment 14 item 1: a guardrail on the send line is refused at $0 (the card says it first; a prose file straight to `fwdloop draft` is caught here).
  // M13 am11: with an actionMode the send is the card's tentative one; the refusal is made after the AI says whether the last line is the action (below)
  const sendReds = actionMode === null ? checkSendLineGuardrail(lines, arbiter) : [];
  if (sendReds.length) return fail(sendReds, { box: 'job' });
  const menu = wiredMenu(skills);
  // The file inputs are read first, at $0, before a provider is built (a page input is fetched only after the price and cap gates, below).
  const fileFacts = readInputFacts((arbiter.sources ?? []).filter((s) => s.kind !== 'page'));
  if (!fileFacts.ok) return fail(fileFacts.reds, { box: 'inputs' });
  // M13 piece 4: with flow type Tickets, a GitHub issues list is a ticket role, not a page: never fetched at draft; the drafter is told it exists and may suggest a label filter.
  // The job's flow type and MCP (server + every tool of its newest OK check) come from the card; the refusals are at $0, before any provider is built.
  const ticketSources = flowType === 'tickets' ? ticketSourcesOf(arbiter.sources) : [];
  const servers = flowType === 'plain' ? [] : (mcpServers ?? userMcpServers());
  const flowReds = ticketReds({ flowType, ticketSources, pick: mcp, servers });
  // M19 am14b: the Tickets list address is an Inputs line; every other flow red is about the picked MCP
  if (flowReds.length) return fail(flowReds, { box: flowType === 'tickets' && ticketSources.length === 0 ? 'inputs' : 'mcp' });

  let { provider, rates, modelId } = { provider: injected, rates: injectedRates, modelId: injectedModelId };
  let prices = null; // the one price lookup's result (live provider only); the cap check below uses the SAME price
  if (provider == null) {
    try {
      ({
        provider, rates, modelId, prices = null,
      } = makeProviderFn(slot, { model, env, ...LIVE_PROVIDER_OPTIONS }));
    } catch (err) {
      return fail([err instanceof ModelRefusal ? err.message : `${err instanceof ConfigError ? 'config' : 'key'}: ${err.message}`], { box: 'model' });
    }
  }

  const lineNums = lines.map((l) => l.n);
  // Full catalogue + the wired set: an unwired verb reds "not wired" by name; an unsigned skill reds by skill.
  const cat = loadCatalogue();
  if (!cat.ok) return fail([`catalogue: ${cat.reds.join('; ')}`]);
  const validationCatalogue = cat.primitives;
  // The hold: the picked model's own Settings prices (or the rates a test injected) times the token bounds - never a table.
  if (!rates) return fail(['price: this round has no price to hold - tick a model in Settings > Providers with both prices first'], { box: 'model' });
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
  if (roundCeiling > budgetUsd) return fail([tooSmall(roundCeiling)], { box: 'capUsd' });

  const meterings = [];
  const log = [];
  let calls = 0; // provider calls made (a call that threw before metering is in `calls`, not in `rounds`)
  let unmetered = 0; // calls that failed with no metering: their cost is unknown
  const book = (inFlight) => onBook?.({
    inFlight, calls, unmetered, metered: sumMeterings(meterings), modelId, price: priceRecord(prices, rates),
    // M20 am1 item 5: the result so far, in log.json's shape, for the step lines (src/draftspend.js makeStepWriter)
    partial: () => { const m = sumMeterings(meterings); return { ok: false, reds: [], rounds: m.rounds, modelId, costUsd: m.costUsd, spendComplete: unmetered === 0 && m.costUsd !== null, thinking: thinkingOf(), inputs: facts.list, log }; },
  });

  /** the result of a draft that stops before any drafting round with what it spent so far (a provider red, the budget); one literal for every such stop */
  const earlyStop = (/** @type {string[]} */ reds, /** @type {string} */ why) => {
    const m = sumMeterings(meterings);
    return withAction({
      ok: false, declaration: null, reds, rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries: 0, revisions: 0, stop: why, log, thinking: thinkingOf(), inputs: facts.list, questions: [], droppedQuestions: [], notChecked: [], ...pageExtras,
    });
  };

  // M10 item 1: a web page input is fetched once and frozen into the DRAFT folder (the drafting copy). A run freezes its own copy at its own start
  // (`freezeInputs`), so a run is never checked against this one. Only now, after the $0 price and cap gates: a draft refused for money fetches nothing.
  const pageSources = (arbiter.sources ?? []).filter((s) => s.kind === 'page' && !ticketSources.includes(s));
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
  const facts = readInputFacts((arbiter.sources ?? []).filter((s) => !ticketSources.includes(s)), { pages });
  if (!facts.ok) { removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((pg) => pg.entry.frozen)); return fail(facts.reds); }

  // M10 item 3: ONE map call per page input names the page's own words; code keeps what the saved page proves. Every round goes through the
  // same metering and book as a drafting round, so a pre-send throw from the book stops here with nothing spent.
  /** @type {{facts: any[], dropped: any[]}} */
  const look = { facts: [], dropped: [] };
  /** @type {string[]} */
  const pageNotChecked = [];
  /** @type {any[]} */
  const pageLooks = [];
  /** @type {Record<string, any>} */
  const pageExtras = pageSources.length ? { look, pageLooks } : {};
  /**
   * ONE forced-tool turn, for every turn that is an answer in one typed call (the suggest call, the ledger call, the row-edit turn): the hold against what is left of the cap, Loop's metering of the round,
   * the book before and after, the tool that captures the arguments and halts (no wrap-up round), thinking off (on cannot combine with a forced call), the raw answer kept when the call failed.
   * `repair` (M4d am39): a malformed reply that is a complete object plus trailing `}` is repaired, and used only when `usable(value)` says the caller can read it.
   * Returns `{early}` (a provider red or the budget: the draft's own stop) or `{args, entry}` (`args` null = no usable call in any attempt; `entry` is the last round's log entry).
   * @param {{kind: string, system: string, messages: {role: string, content: string}[], tool: {name: string, description: string, schema: any}, attempts?: number, repair?: boolean, usable?: (v: any) => boolean}} o
   */
  const forcedTurn = async ({ kind, system: sys, messages, tool: spec, attempts = 2, repair = false, usable = () => true }) => {
    /** @type {any} */
    let entry = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const spentBefore = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
      if (spentBefore + ceilingCostUsd(rates, sys.length + messages.reduce((n, m) => n + m.content.length, 0) + JSON.stringify(spec.schema).length) > budgetUsd) {
        if (meterings.length === 0 && calls === 0) { removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((q) => q.entry.frozen)); return { early: fail([tooSmall(roundCeiling)], { box: 'capUsd' }) }; }
        return { early: earlyStop(['the draft budget is spent'], 'budget') };
      }
      /** @type {any} */
      let captured;
      const roundEvents = [];
      const tool = { name: spec.name, description: spec.description, parameters: spec.schema, execute: async (/** @type {any} */ a) => { captured = a; throw new HaltError(`${kind} captured`, { rule: 'captured' }); } };
      const forcedLoop = new Loop({ provider, rates, onLlmResult: async (ev) => { roundEvents.push(ev); meterings.push(ev); } });
      calls += 1;
      book(true);
      let res;
      let threw = null;
      try {
        res = await forcedLoop.run([{ role: 'system', content: sys }, ...messages], [tool], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: 'off', toolChoice: { name: spec.name } });
      } catch (err) {
        threw = err;
        if (roundEvents.length === 0) unmetered += 1;
      }
      book(false);
      entry = /** @type {Record<string, any>} */ ({ round: log.length + 1, kind });
      if (res?.thinkingApplied !== undefined) entry.thinkingApplied = res.thinkingApplied;
      if (res?.thinkingStatus !== undefined) entry.thinkingStatus = res.thinkingStatus;
      if (threw && !(isPlainObject(captured) && threw instanceof HaltError)) {
        entry.outcome = `provider-red: ${threw.message}`;
        log.push(entry);
        return { early: earlyStop([`provider-red: ${threw.message}`], 'provider-red') };
      }
      if (!isPlainObject(captured)) {
        // the raw answer is kept (log.json), the cut-off said out loud
        const malformed = provider?.lastMalformedToolCall ?? null;
        entry.outcome = res?.stopReason === 'max_tokens' ? 'structure: truncated: the round hit the output cap with no completed tool call' : 'structure: no usable tool call (text instead of the tool)';
        if (typeof malformed?.rawArguments === 'string') entry.rawArguments = malformed.rawArguments;
        else if (typeof res?.text === 'string' && res.text !== '') entry.rawText = res.text;
        // M4d am39: only a malformed-JSON round (never a cut-off, never text) whose answer is a complete object plus trailing `}` is repaired
        const fixed = repair && malformed && res?.stopReason !== 'max_tokens' ? repairTrailingBraces(malformed.rawArguments) : null;
        if (fixed) {
          const ok = usable(fixed.value);
          entry.braceRepair = { dropped: fixed.dropped, used: ok };
          if (ok) { entry.outcome = 'answered'; entry.args = fixed.value; log.push(entry); return { args: fixed.value, entry }; }
        }
        log.push(entry);
        continue;
      }
      entry.outcome = 'answered';
      entry.args = captured;
      log.push(entry);
      return { args: captured, entry };
    }
    return { args: null, entry };
  };

  // M13 am11 rules 1 and 2: the job's last line is the action. The AI answers ONE question (record_action); code checks the answer is the LAST line (never an Ask). With none, and the
  // person's answer not yet given, the AI suggests one line and the question carries the signed words. Nothing is added to the job without the person's answer.
  /** the result with what the AI decided about the action: the prose as kept (the send line stays or is taken out) and the action line, or null */
  // M13 am11b: the ONE writer of the log's `action`: { line, by } (who picked: 'agent' = the AI, 'you' = an Agree or typed line), (an old log may hold a `dropped` record; nothing reads it); null when none
  /** @type {null|{line: number, by?: 'agent'|'you'}} */
  let actionRec = null;
  const withAction = (/** @type {any} */ r) => ({ ...r, proseText, action: actionRec ?? (arbiter.sends.length === 1 ? { line: arbiter.sends[0].line } : null) });
  /** @type {null|{line: number, question: string, source: 'look', ask: 'action', ruleNo: undefined, ruleText: string, reading: string, counted: false}} */
  let actionAsk = null;
  if (actionMode !== null && arbiter.sends.length === 1 && arbiter.sends[0].line === lines.length) {
    const last = lines[lines.length - 1];
    const signedAsks = new Set(arbiter.asks.map((a) => a.line));
    let keep = actionMode === 'known';
    if (actionMode === 'check' && !signedAsks.has(last.n)) {
      const rec = await forcedTurn({
        kind: 'action-recognise', system: RECOGNISE_SYSTEM, messages: [{ role: 'user', content: jobListing(lines, signedAsks, String(arbiter.sends[0].target.path)) }],
        tool: { name: RECOGNISE_TOOL, description: 'Say which last step writes or sends everything before it, or none.', schema: RECOGNISE_SCHEMA },
      });
      if (rec.early) return rec.early;
      keep = recognisedIsLast(rec.args, last.n, false);
    }
    if (keep) {
      const reds = checkSendLineGuardrail(lines, arbiter);
      if (reds.length) return earlyStop(reds, 'action');
      actionRec = { line: last.n, by: actionMode === 'known' ? 'you' : 'agent' };
    } else {
      if (actionMode === 'check' && offerQuestions) {
        const sg = await forcedTurn({
          kind: 'action-suggest', system: ACTION_SUGGEST_SYSTEM, messages: [{ role: 'user', content: jobListing(lines, signedAsks, String(arbiter.sends[0].target.path)) }],
          tool: { name: ACTION_SUGGEST_TOOL, description: 'Suggest one last step that writes or sends everything before it.', schema: ACTION_SUGGEST_SCHEMA },
        });
        if (sg.early) return sg.early;
        const suggested = cleanSuggestion(sg.args);
        if (suggested !== null) actionAsk = { line: last.n, question: suggestionQuestion(suggested), source: 'look', ask: 'action', ruleNo: undefined, ruleText: '', reading: suggested, counted: false };
      }
      proseText = withoutSend(proseText);
      const again = parseSignedText(proseText);
      if (!again.ok) return fail(again.reds.map((r) => `signed-text: ${r}`));
      arbiter = again.arbiter;
    }
  }
  let mapCut = null;
  const jobLines = lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) }));
  // M10 am27 (1): the page look sees only the non-count rules; `toOriginal` takes a visible rule number back to the original one
  // M16: the page look sees the count rules of every line the block takes (not an ask or send line; a job with a CSV or a .docx keeps them all hidden, as the sheet path owns its lines)
  const askOrSend = new Set([...arbiter.asks.map((a) => a.line), ...arbiter.sends.map((x) => x.line)]);
  const sheetPath = (arbiter.sources ?? []).some((s) => s.kind === 'file' && (isCellsPath(s.path) || String(s.path).toLowerCase().endsWith('.docx')));
  const { seenLines, toOriginal } = hideCounts(jobLines, !sheetPath ? new Set(lineNums.filter((n) => !askOrSend.has(n))) : new Set());
  const pageInfo = [];
  /** one map call (a page's or a sheet's): its hold, its metering and its book are the drafting round's own (the `kind` names it in the round log) */
  const makeCallModel = (kind, system = MAP_SYSTEM) => async (content, attempt) => {
    const spentSoFar = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spentSoFar + ceilingCostUsd(rates, content.length + system.length) > budgetUsd) { mapCut = 'budget'; return { error: 'the draft budget is spent', budget: true }; }
    const roundEvents = [];
    const mapLoop = new Loop({ provider, rates, onLlmResult: async (ev) => { roundEvents.push(ev); meterings.push(ev); } });
    calls += 1;
    book(true);
    let res;
    let threw = null;
    try {
      res = await mapLoop.run([{ role: 'system', content: system }, { role: 'user', content }], [], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: attempt === 1 ? draftThinking : 'on' });
    } catch (err) {
      threw = err;
      if (roundEvents.length === 0) unmetered += 1;
    }
    book(false);
    const entry = { round: log.length + 1, kind };
    if (res?.thinkingApplied !== undefined) entry.thinkingApplied = res.thinkingApplied;
    if (res?.thinkingStatus !== undefined) entry.thinkingStatus = res.thinkingStatus;
    if (threw) { entry.outcome = `provider-red: ${threw.message}`; log.push(entry); mapCut = 'provider-red'; return { error: threw.message, threw }; }
    const cutOff = res?.stopReason === 'max_tokens';
    entry.outcome = cutOff ? 'truncated' : 'answered';
    if (kind === SHAPE_CALL_LABEL && typeof res?.text === 'string' && res.text !== '') entry.rawText = res.text;
    log.push(entry);
    if (res?.error && !cutOff) return { error: String(res.error) };
    return { text: res?.text ?? '', cutOff };
  };
  for (const s of pageSources) {
    const pg = pages[s.role];
    // The hold of the map call is sized from its own prompt (the saved page is in it): one that cannot fit what is left of the cap is refused here, at $0.
    const mapCeiling = ceilingCostUsd(rates, mapPrompt({ jobLines: seenLines, label: s.role, text: pg.text }).length + MAP_SYSTEM.length);
    const spentBefore = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    if (spentBefore + mapCeiling > budgetUsd) {
      if (meterings.length === 0 && calls === 0) { removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((q) => q.entry.frozen)); return fail([tooSmall(mapCeiling)], { box: 'capUsd' }); }
    }
    const callModel = makeCallModel('page-map');
    const got0 = await lookAtPage({ label: s.role, text: pg.text, jobLines: seenLines, callModel });
    const got = got0.ok ? { ...got0, look: { ...got0.look, facts: got0.look.facts.map(toOriginal), dropped: got0.look.dropped.map(toOriginal) } } : got0;
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
      pageInfo.push('  You chose to leave these Not checked; never claim them as checked:', ...lines.map((x) => `  - ${x}`));
    }
  }
  // M10 piece 5 (item 7): ONE sheet call per CSV input names the job's own word for each `~` rule; code keeps a word only if it is a real column and finds the column
  // to offer when it is not (src/sheetlook.js). Only when a non-ask job line carries a `~` rule: a CSV job without one is unchanged (no extra call). A signed ask
  // line's own guardrail is a human stop, not a sheet check, so it is not sent. Every round goes through the same hold, metering and book as the page's.
  const askLines = new Set(arbiter.asks.map((a) => a.line));
  const sheetJobLines = jobLines.filter((l) => !askLines.has(l.n));
  // am8 item 3: a .docx's headings stand where a sheet's columns do (a word that is no heading is Not checked, nothing is asked)
  const docxRoles = (arbiter.sources ?? []).filter((s) => s.kind === 'file' && String(s.path).toLowerCase().endsWith('.docx') && Array.isArray(facts.inputFacts[s.role])).map((s) => s.role);
  const sheetRoles = sheetJobLines.some((l) => lineRules(l).length > 0) ? [...Object.keys(facts.sheets ?? {}), ...docxRoles] : [];
  /** @type {any[]} */
  // M17 ruling 2: the columns the person agreed for a word (just now, or kept in the record from the last draft, tied to the line's words); such a word is never asked or declined again, and is told to the AI
  const effColumns = [...columnAnswers, ...columnsOnLines(carriedColumns, lines).filter((c) => !columnAnswers.some((f) => f.line === c.line && f.word.toLowerCase() === c.word.toLowerCase()))];
  onColumns(columnEntries(lines, effColumns));
  const sheetAsks = [];
  /** @type {any[]} */
  const sheetFacts = [];
  /** @type {any[]} */
  const sheetLooks = [];
  for (const role of sheetRoles) {
    const headings = docxRoles.includes(role) ? facts.inputFacts[role] : undefined;
    const text = headings === undefined ? facts.sheets[role] : '';
    const spentBefore = meterings.reduce((sum, ev) => sum + (ev.costUsd ?? roundCeiling), 0);
    const hold = ceilingCostUsd(rates, sheetPrompt({ jobLines: sheetJobLines, label: role, text, headings }).length + MAP_SYSTEM.length);
    if (spentBefore + hold > budgetUsd && meterings.length === 0 && calls === 0) { removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((q) => q.entry.frozen)); return fail([tooSmall(hold)], { box: 'capUsd' }); }
    const got = await lookAtSheet({ label: role, text, headings, jobLines: sheetJobLines, callModel: makeCallModel('sheet-map') });
    if (!got.ok) {
      const m = sumMeterings(meterings);
      return {
        ok: false, declaration: null, reds: [got.reason], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries: 0, revisions: 0, stop: mapCut ?? 'page-map', log, thinking: thinkingOf(), inputs: facts.list, questions: [], droppedQuestions: [], notChecked: [], ...pageExtras,
      };
    }
    // The redraft after the answers never asks: an offer the person's words did not take is Not checked, with that reason (never dropped silently).
    const asksNow = got.asks.filter((a) => !effColumns.some((c) => c.line === a.line && c.word.toLowerCase() === a.word.toLowerCase()));
    const declined = offerQuestions ? [] : asksNow.map((a) => ({ line: a.line, ...(a.rule === null ? {} : { rule: a.rule }), fact: a.word, reason: 'column-declined', other: `"${a.column}"`, source: role }));
    const dropped = [...got.dropped, ...declined];
    sheetAsks.push(...asksNow); // asked only when the asks block below is open (offerQuestions)
    sheetFacts.push(...got.facts);
    sheetLooks.push({ role, attempts: got.attempts, facts: got.facts, asks: asksNow.map((a) => ({ line: a.line, rule: a.rule, word: a.word, column: a.column })), dropped });
    const lost = dropRows(dropped).map((row) => dropLine(row, jobLines, lineRules));
    for (const l of lost) if (!pageNotChecked.includes(l)) pageNotChecked.push(l);
    pageInfo.push(
      ...(got.facts.length ? [`  Code matched the job's words to the ${headings === undefined ? 'columns' : 'headings'} of "${role}": ${got.facts.map((f) => `line ${f.line}${f.forRule === undefined ? '' : ` rule ${f.forRule}`} is ${headings === undefined ? 'column' : 'heading'} '${f.column}'`).join('; ')}`] : []),
      ...(lost.length ? [`  Code could not make these a check on "${role}", so they are Not checked; never claim them as checked:`, ...lost.map((l) => `  - ${l}`)] : []),
    );
  }
  if (sheetLooks.length) pageExtras.sheetLooks = sheetLooks; // kept beside the page looks (src/authoring.js writes both into page-look.json)
  // M10 am16 (1): ONE suggestion call, only when a guardrail on a step line is one this call settles (scope by code, src/checkpick.js). It suggests a check from bareguard's own list
  // per guardrail, or none; code keeps what passes keep-or-drop. The call is metered, held and booked as a drafting round (the same `meterings`). The redraft after the answers
  // (offerQuestions false) makes no call: it settles every rule against the person's picks instead.
  // a rule a kept page or sheet fact already serves (the look tied it: line + rule number) is settled by that fact and is not asked here
  const shapeEverywhere = offerRules(lines, arbiter, [...look.facts, ...sheetFacts]);
  // M16 S1: the lines the block is given (step lines; a sheet line the sheet look tied to a column stays on the sheet path, R6). Their rules go to the block; every other shape rule keeps today's path.
  // a job with a CSV input: a line with a rule that is not a count belongs to the sheet path even when the sheet look tied none of its words (its sheet checks are the drafter's, M10b, which the list leaves as they are; the declaration is not there yet to say it)
  const csvRuleLines = Object.keys(facts.sheets ?? {}).length ? jobLines.filter((l) => !askLines.has(l.n) && lineRules(l).some((r) => !isCountGuardrail(r))).map((l) => l.n) : [];
  const blockPlan = blockJobLines(proseText, undefined, [...new Set([...sheetFacts.filter((f) => f.forRule !== undefined), ...sheetAsks, ...sheetLooks.flatMap((l) => l.dropped)].map((x) => x.line)), ...csvRuleLines]);
  if (blockPlan && !blockPlan.ok) return fail(blockPlan.reds.map((r) => `signed-text: ${r}`));
  const blockLineNums = new Set(blockPlan ? blockPlan.jobLines.map((l) => l.n) : []);
  // M19 S3: the sheet lines (a CSV input and a line with `~` rules that the list's own rows do not take) are the check block's too: it holds their rules and their sheet checks (src/checkblock.js `setSheet`), the AI names a sheet line by its job number
  const sheetTables = Object.keys(facts.sheets ?? {}).length ? Object.fromEntries(Object.entries(facts.sheets).map(([role, t]) => [role, sheetTable(parseCsv(t))])) : undefined;
  const sheetRoleList = sheetTables ? Object.keys(sheetTables) : [];
  const sendLines = new Set(arbiter.sends.map((x) => x.line));
  const sheetLineNums = sheetRoleList.length > 0 ? jobLines.filter((l) => !askLines.has(l.n) && !sendLines.has(l.n) && !blockLineNums.has(l.n) && lineRules(l).length > 0).map((l) => l.n) : [];
  const sheetTurn = sheetLineNums.length > 0;
  // M17 am4 (A3, B5): the list is the one place a shape rule is asked and picked; a line the list is not given (a sheet line) has no pick path of its own
  const allShape = shapeEverywhere.filter((r) => blockLineNums.has(r.line));
  // M10 am17/am18: a guardrail whose pick is kept from the last draft skips the suggestion call and the asks; only the rest is suggested and asked. The model never sees a pick.
  const carried = matchRecord(carriedPicks, lines, allShape);
  const keptView = carried.kept.map((k) => ({ line: k.line, rule: k.rule, ruleText: k.entry.ruleText, check: k.entry.check, left: k.entry.left }));
  onPickRecord?.({ picks: carried.kept.map((k) => k.entry), kept: keptView });
  const askRules = carried.askRules;
  /** the block (M16 S1): the person's rules, the look, the picks kept and just answered, reconciled once */
  /** @type {import('./checkblock.js').CheckBlock|null} */
  let block = null;
  if (blockPlan?.ok) {
    const inBlock = (/** @type {{line: number}} */ x) => blockLineNums.has(x.line);
    const sheetBlockLines = sheetTurn ? (() => { const all = blockJobLines(proseText); return all.ok ? all.jobLines.filter((l) => sheetLineNums.includes(l.n)) : []; })() : [];
    // the page look is about the page inputs: its facts and drops on a sheet line are not rows of the block
    const notSheet = (/** @type {{line: number}} */ x) => !sheetLineNums.includes(x.line);
    block = setUpBlock({
      texts: { ...(facts.docs ?? {}), ...Object.fromEntries(Object.entries(pages).map(([role, pg]) => [role, pg.text])) }, jobLines: [...blockPlan.jobLines, ...sheetBlockLines].sort((a, b) => a.n - b.n), look: { facts: look.facts.filter(notSheet), dropped: look.dropped.filter(notSheet) },
      kept: { picks: carried.picks.filter(inBlock), left: carried.left.filter(inBlock), askRules: carried.askRules.filter(inBlock) },
      fresh: { picks: checkPicks.filter(inBlock), left: leftRules.filter(inBlock) }, asks: offerQuestions, countScope: (t) => codeScope(arbiter.sources, t) === 'in', leaveOut: ticketLeaveOut(flowType, blockPlan.jobLines), sheetLines: sheetLineNums,
    });
  }
  if (askRules.length && offerQuestions) {
    const content = suggestUserText(lines, askRules);
    const got = await forcedTurn({ kind: 'check-suggest', system: SUGGEST_SYSTEM, messages: [{ role: 'user', content }], tool: { name: SUGGEST_TOOL, description: 'Suggest one check (or none) per guardrail.', schema: SUGGEST_SCHEMA } });
    if (got.early) return got.early;
    const sugRows = rowsFromAnswer(askRules, got.args);
    // M16 S2 (R1): a kept check is a `pick` edit of the block, before any asks
    if (block) { block.applyDelta({ label: 'pre:check-suggest', pre: true, edits: pickEdits(sugRows, blockLineNums) }); block.reconcile(); }
  }
  if (block && blockPlan?.ok && blockPlan.jobLines.length > 0 && Object.keys(block.texts).length > 0) {
    const texts = block.texts;
    // the ledger-suggest call, after the pick call and before the asks (bareloop authorjob.js@v0.56.0 order, R3): extra `!` checks the inputs support, as `add` edits
    const lg = await forcedTurn({ kind: 'ledger-suggest', system: LEDGER_SYSTEM, messages: [{ role: 'user', content: ledgerUserText(blockPlan.jobLines, texts) }], tool: { name: LEDGER_TOOL, description: 'Deliver the extra checks the inputs support (or an empty list). Call this exactly once.', schema: LEDGER_SCHEMA } });
    if (lg.early) return lg.early;
    block.applyDelta({ label: 'pre:ledger-suggest', pre: true, edits: ledgerEdits(lg.args?.extra) });
    block.reconcile();
  }
  // borrowed-from: bareloop src/authorjob.js@v0.56.0 (3383cce)
  // a Revise keeps the last draft's Drop/Add choices (the suggestions exist now); code still judges every one when the list is reconciled
  if (block && Array.isArray(carriedChoices)) { block.carryChoices(carriedChoices); onChoices(block.choicesRecord()); block.reconcile(); }
  /** the questions of the block, merged below with the sheet's and the look's own, under one cap (M16 S3) */
  const blockAsks = block && offerQuestions ? questionsOfBlock(block) : [];
  if (block) pageExtras.checkRows = ledgerRecord(/** @type {any} */ (block.rows.filter((r) => !block.isSheetLine(r.line))));
  // M10 piece 3 (item 4, am1, am2): CODE decides the early asks from the look, after the one map call and BEFORE any drafting round. A signed ask line's own
  // guardrail is a human stop, not a page check, so it is not asked. More than MAX_LOOK_ASKS is a job to rewrite: nothing is asked, nothing more is spent.
  // The redraft after the answers (offerQuestions false) never asks. A sheet's offers are reading asks: they come first with the page's, in line order.
  if ((sheetAsks.length || blockAsks.length || actionAsk !== null) && offerQuestions) {
    // M17 am4 (A1): a question comes from the list (questionsOfBlock) or is the sheet's column offer (M17 am1 1(a)); no question is asked outside the list
    const lookAsks = [...[...sheetAsks, ...blockAsks.filter((a) => a.ask === 'reading')].sort((a, b) => a.line - b.line)];
    // am16 (3): a shape guardrail's ask follows, in line order. (5): a proposal is not an ask under am1; only a `can't check` ask counts toward the cap (the 4th stops drafting at $0).
    const blockShape = blockAsks.filter((a) => a.ask === 'check');
    const asks = [...lookAsks, ...blockShape, ...(actionAsk === null ? [] : [actionAsk])];
    if (asks.length > 0) {
      const m = sumMeterings(meterings);
      const spent = m.costUsd === null || unmetered > 0 ? (m.costUsd === null ? 'unknown' : `at least ${usdText(m.costUsd)}`) : usdText(m.costUsd);
      const counted = [...lookAsks, ...blockShape.filter((a) => a.counted).map((a) => ({ ...a, reading: "I can't check this" }))];
      const tooMany = counted.length > MAX_LOOK_ASKS;
      if (tooMany && pageSources.length) removeFrozenPages(/** @type {string} */ (draftDir), Object.values(pages).map((q) => q.entry.frozen)); // a refused draft keeps no page copy
      return withAction({
        ok: false, declaration: null, reds: tooMany ? [`${tooManyAsksText(counted)} Spent so far: ${spent}.`] : [], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries: 0, revisions: 0, stop: tooMany ? 'look-asks-too-many' : 'look-asks', log, thinking: thinkingOf(), inputs: facts.list,
        questions: tooMany ? [] : asks.map((a) => ({
          line: a.line, question: a.question, source: a.source, ask: a.ask, ruleNo: 'rule' in a ? a.rule : undefined, ruleText: a.ruleText, proposal: a.reading ?? null, ...('check' in a && a.check ? { check: a.check } : {}), ...('columns' in a && Array.isArray(a.columns) ? { columns: a.columns, readings: /** @type {any} */ (a).readings } : {}),
        })),
        droppedQuestions: [], notChecked: pageNotChecked, ...pageExtras,
      });
    }
  }
  // the record this draft hands on: what it kept plus what the person just answered (numbered on this card)
  onPickRecord?.({ picks: [...carried.kept.map((k) => k.entry), ...entriesFromAnswers(lines, allShape, checkPicks, leftRules)], kept: keptView });
  // borrowed-from: bareloop src/authorjob.js@v0.61.0 (fc56e1f3) (:788-813, the shape look after the page look, the sheet look, the asks and the person's answers)
  // SHAPE JOBS: the shape look is asked ONLY about the `~` rules still Not checked once every truth check, the answers and the asks are settled (`shapeCandidates`, code decides). No candidate = no call, and the draft is byte-identical.
  // The AI only suggests; code builds or refuses each field (src/shapebuild.js). A look that fails, is unreadable or is capped never stops the draft: its spend stays booked, one draft-log line says so, and it goes on without a shape.
  if (block && blockPlan?.ok) {
    const left = block.shapeCandidates();
    if (left.length > 0) {
      const lineNums = [...new Set(left.map((x) => x.line))].sort((a, b) => a - b);
      const got = await lookAtShape({
        texts: block.texts, jobLines: blockPlan.jobLines, lineNums, left: lineNums.map((n) => ({ line: n, rules: left.filter((x) => x.line === n).map((x) => x.rule) })), ceilingUsd: arbiter.capUsd,
        callModel: makeCallModel(SHAPE_CALL_LABEL, SHAPE_SYSTEM),
      });
      if (!got.ok) log.push({ round: log.length + 1, kind: 'shape-skipped', reason: got.reason, line: `the shape look did not complete: ${got.reason}; going on without a shape` });
      else if (got.shapes.length > 0) {
        block.setShape(buildShapes({ lines: blockPlan.jobLines.filter((l) => lineRules(l).length > 0 && !block.isSheetLine(l.n)), labels: block.labels, suggestions: got.shapes }));
        block.carryShapeDropped(carriedShapeDropped);
      }
      block.reconcile();
    }
  }
  // M16 S2 + S4: the AI's two helpers send edits to the list, then the row-edit turn; code judges every edit alone (src/checkblock.js). The declaration path below runs as before (S5 assembles from the rows).
  // a line with nothing to check (no `~` rule of the person's, no input text for a `!` row to be built from) has no list to edit: no turn is paid for it (M16 item 2, "every job line with checks")
  // M10b piece 3: the drafting copy's table of each CSV input (`sheetTables`, above) - the header the AI may pick from in its suggestions, the table bareguard's build and sign-time tests run over
  /** M17 am2: the sheet checks the AI suggested on the row-edit reply (typed, each with its job line); code builds or refuses each (src/sheetbuild.js) @type {any[]} */
  let sheetSuggested = [];
  /** @type {Awaited<ReturnType<typeof buildSheetChecks>>|null} */
  let sheetBuilt = null;
  /** M17 am6: the Tickets filter and watch the AI suggested as an edit of the list: the last legal value of each, and what was refused (code proves each, src/ticketrows.js) @type {{ticketFilter?: any, ticketWatch?: any, refused: Record<string, string>}} */
  const ticketProposal = { refused: {} };
  const ticketRuleOnJob = flowType === 'tickets' && blockPlan?.ok === true && blockPlan.jobLines.some((l) => (l.rules ?? []).some((t) => ticketRuleField(t) !== null));
  if (block && blockPlan?.ok && (blockPlan.jobLines.length > 0 || sheetTurn) && (Object.keys(block.texts).length > 0 || block.rows.some((r) => r.kind === 'rule') || ticketRuleOnJob || sheetTurn)) {
    // M17 am2: with a CSV input the turn also shows the sheet lines and the sheets; the sheet checks come back as typed suggestions
    const texts = { ...block.texts, ...(facts.sheets ?? {}) };
    const shownLines = sheetTurn ? jobLines.filter((l) => blockLineNums.has(l.n) || sheetLineNums.includes(l.n)) : blockPlan.jobLines;
    // the row-edit turn (bareloop ROW_EDIT_SYSTEM / rowEditUserText as copied): a revise only when an edit was refused, at most MAX_REVISIONS; a refused edit costs the others nothing
    const lookReport = pageSources.length ? { prose: [], notFound: [], facts: look.facts, dropped: look.dropped } : null;
    /** @type {{role: string, content: string}[]} */
    let turn = [{ role: 'user', content: rowEditUserText({ jobLines: shownLines, look: lookReport, texts }) + (flowType === 'tickets' ? `\n\n${ticketFilterBlock()}` : '') + (sheetTurn ? `\n\nTHE SHEET CHECKS\n${sheetOfferRules(sheetRoleList, sheetLineNums).join('\n')}${effColumns.length ? `\n${effColumns.map((c) => agreedColumnWords(c)).join('\n')}` : ''}` : '') }];
    const channel = rowEditChannel(flowType === 'tickets', sheetTurn ? sheetSuggestProp(sheetTables ?? {}, sheetLineNums) : null).tool({ calls: [] });
    for (let rev = 0; ; rev += 1) {
      const got = await forcedTurn({
        kind: rev === 0 ? 'row-edit' : 'row-edit-revision', system: ROW_EDIT_SYSTEM, messages: turn, tool: { name: channel.name, description: channel.description, schema: channel.parameters },
        attempts: 1 + MAX_STRUCTURE_RETRIES, repair: true, usable: repairedEditsReadable,
      });
      if (got.early) return got.early;
      if (got.args === null) return earlyStop([String(got.entry?.outcome ?? 'structure').replace(/^structure: /, '')], 'structure');
      for (const f of TICKET_FIELDS) {
        if (flowType !== 'tickets' || got.args[f] === undefined) continue;
        const reds = proposalReds(f, got.args[f]);
        if (reds.length === 0) { ticketProposal[f] = got.args[f]; delete ticketProposal.refused[f]; } else ticketProposal.refused[f] = reds[0];
      }
      if (sheetTurn && Array.isArray(got.args.sheetChecks)) sheetSuggested = got.args.sheetChecks.filter((/** @type {any} */ x) => x && typeof x === 'object' && !Array.isArray(x));
      const rec = block.applyDelta({ label: `row-edit-${rev + 1}`, edits: editsOf(got.args) });
      block.reconcile();
      got.entry.edits = editRecord(rec);
      const refused = rec.edits.filter((e) => e.accepted !== true);
      if (refused.length === 0 || rev >= MAX_REVISIONS) break;
      turn = [...turn, { role: 'assistant', content: JSON.stringify(got.args) }, { role: 'user', content: `${renderRejectBlock(refused.map((e) => `edit ${String(e?.op)}: ${String(e.refusedBecause)}`))}\n\n${ROW_EDIT_REVISE}` }];
    }
    // M19 S3 (bareloop's order): the sheet checks code built from the reply's suggestions become the block's own rows after the AI's edits; a Revise keeps a Drop of the very same check
    if (sheetTurn && sheetTables) {
      sheetBuilt = await buildSheetChecks({ lines: lines.filter((l) => sheetLineNums.includes(l.n)), tables: sheetTables, suggestions: sheetSuggested });
      block.setSheet(sheetBuilt);
      block.carrySheetDropped(carriedSheetDropped);
      onSheetDropped(block.sheetDroppedRecord());
      pageExtras.sheetBuilt = sheetBuilt;
    }
    // shape jobs: a Revise keeps a Drop of the very same shape field (the block's own record, beside the sheet's)
    if (carriedShapeDropped.length) block.carryShapeDropped(carriedShapeDropped);
    onShapeDropped(block.shapeDroppedRecord());
    pageExtras.checkRows = ledgerRecord(/** @type {any} */ (block.rows.filter((r) => !block.isSheetLine(r.line))));
  }
  // M17 am1 1(e): the note question, ONE forced turn, only when a line of the list is facts-only after the AI's edits (src/noteask.js). The typed answer goes to the block; code decides what it means.
  // The answers ride the turn's log entry (`notes`), the one place the replay (src/planrebuild.js) reads them from, a failed turn included.
  if (block && blockPlan?.ok) {
    const asked = block.factOnlyLines();
    if (asked.length > 0) {
      const askedLines = blockPlan.jobLines.filter((l) => asked.includes(l.n)).map((l) => ({ n: l.n, text: l.text }));
      const nq = await forcedTurn({ kind: NOTE_KIND, system: NOTE_SYSTEM, messages: [{ role: 'user', content: notePrompt(askedLines) }], tool: { name: NOTE_TOOL, description: 'Say, for each line, whether it also asks for written words.', schema: NOTE_SCHEMA } });
      if (nq.early) return nq.early;
      const answers = noteAnswers(asked, nq.args, askedLines);
      nq.entry.notes = answers;
      block.setNotes(answers);
      pageExtras.checkRows = ledgerRecord(/** @type {any} */ (block.rows.filter((r) => !block.isSheetLine(r.line))));
    }
  }
  // The page lines go on the drafter's list of inputs: the first line of a page's block replaces the plain line readInputFacts wrote for it.
  const factsBase = pageInfo.length ? [...facts.info.filter((l) => !pageSources.some((s) => l.startsWith(`- ${s.role}: a web page`))), ...pageInfo] : facts.info;
  const factsInfo = [...factsBase, ...ticketSources.flatMap((s) => ticketFactsLines(s.role)), ...(flowType === 'mcp' ? mcpFactsLines(mcp.server, mcp.tools) : [])];

  // `questions` only on try 3 (below).
  const baseSystem = buildSystemPrompt({ menu, lines, arbiter, factsInfo, blockLines: blockLineNums });
  // M8 item 5a: the earlier runs' notes go on the DRAFTER's system prompt only (F81's B arm), the one `system` every round of this draft uses (revise and structure retries too).
  // Absent or empty: the prompt is byte-identical to what it was.
  const system = `${baseSystem}${learnHints?.text ? `\n\n${learnHints.text}` : ''}`;
  let structureRetries = 0;
  let revisions = 0;
  let lastReds = [];
  let lastDecl = null;
  let userText = `Call ${TOOL} now.`;
  let nextKind = 'first'; // what the round about to run actually is
  let validatorReds = []; // the last validator refusal; a structure retry after a revision must not drop it
  let stop = null;
  let failedLines = []; // the job lines try 2's reds named: a question is kept only about one of these (amendment 25)
  /** @type {{questions:{line:number, question:string}[], droppedQuestions:object[], notChecked:string[], notCheckedBy?: Record<string, 'you'|'agent'|'default'>}} */
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
    const schema = buildRoundSchema(menu, { questions: askOpen, ticket: flowType === 'plain' ? undefined : { flowType, tools: mcp.tools } });
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

    // M4d am39: a structure failure is handled by one function, so a brace repair that the validator then refuses takes the very same path.
    const structureFailure = (/** @type {string} */ why) => {
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
        return 'continue';
      }
      if (structureRetries >= MAX_STRUCTURE_RETRIES) { stop = 'structure'; return 'break'; }
      structureRetries += 1;
      nextKind = 'structure-retry';
      userText = `Your last reply was not a usable tool call (${why}). Call ${TOOL} now with a complete, valid JSON declaration.`;
      if (validatorReds.length) userText += `\n\nThe last declaration you emitted was still refused by the validator; keep fixing these too:\n${validatorReds.map((r) => `- ${r}`).join('\n')}`;
      if (askOpen) userText += `\n\n${QUESTIONS_PROMPT}`;
      return 'continue';
    };
    /** @type {string | null} the structure reason, kept while a brace-repaired answer waits for the validator */
    let braceWhy = null;
    if (!isPlainObject(captured)) {
      const malformed = provider?.lastMalformedToolCall ?? null;
      const why = result?.stopReason === 'max_tokens' ? 'truncated: the round hit the output cap with no completed tool call'
        : malformed ? `the tool call's arguments were not valid JSON (${malformed.error})`
          : 'no usable tool call (text instead of the tool)';
      // the raw answer is kept (log.json): the unparseable arguments as sent, else the model's text
      if (typeof malformed?.rawArguments === 'string') entry.rawArguments = malformed.rawArguments;
      else if (typeof result?.text === 'string' && result.text !== '') entry.rawText = result.text;
      // M4d am39: only a malformed-JSON round (never a cut-off, never text) whose answer is a complete object plus trailing `}` is repaired
      const fixed = malformed && result?.stopReason !== 'max_tokens' ? repairTrailingBraces(malformed.rawArguments) : null;
      if (!fixed) {
        const next = structureFailure(why);
        if (next === 'break') break;
        continue;
      }
      captured = fixed.value;
      braceWhy = why;
      entry.braceRepair = { dropped: fixed.dropped, used: true };
    }

    // `notChecked` is offered on no try (M17 am4, C1): whatever the model sends for it is dropped here. `questions` is stripped only where it was
    // offered; sent when not offered it stays, and the validator reds it as an unknown key (a stray key, never a silent pass).
    const { questions: rawQuestions, notChecked: _aiNotes, ...captureRest } = /** @type {Record<string, any>} */ (captured);
    /** @type {Record<string, any>} */
    const declaration = { ...(askOpen ? captureRest : { ...captureRest, ...(rawQuestions === undefined ? {} : { questions: rawQuestions }) }), inputFacts: facts.inputFacts };
    // M13 piece 4: the flow type and the job's MCP (server + every tool of the newest OK check, R1) are set by code; whatever the model sent for them is overwritten.
    declaration.flowType = flowType;
    if (flowType === 'plain') delete declaration.mcp;
    else declaration.mcp = { server: mcp.server, tools: [...mcp.tools] };
    // M17 am6: the Tickets filter and watch are checks on the list. A draft that carries one is refused (a red naming the field, $0); code writes each from the value the AI suggested on the list,
    // proved by src/ticketrows.js, and only when a rule of that kind is on the job
    const carriedTicketFields = TICKET_FIELDS.filter((f) => Object.hasOwn(captureRest, f));
    for (const f of TICKET_FIELDS) delete declaration[f];
    if (flowType === 'tickets') {
      const kinds = new Set(lines.flatMap((l) => (typeof l.guardrail === 'string' ? l.guardrail.split('; ') : []).map((t) => ticketRuleField(t.trim()))));
      for (const f of TICKET_FIELDS) if (kinds.has(f) && ticketProposal[f] !== undefined) declaration[f] = ticketProposal[f];
    }
    // M6a amendment 1 (F50): the goal is the signed line, set by the machine; whatever the model sent is overwritten.
    if (Array.isArray(declaration.steps)) {
      declaration.steps = declaration.steps.map((st) => (isPlainObject(st) ? { ...st, goal: goalForLine(st.fromLine, lines) } : st));
    }
    // M13 am9 item 4: the last Ask before the action reads every step; code sets it, whatever the model sent
    if (Array.isArray(declaration.steps)) declaration.steps = readEveryStep(declaration.steps, arbiter);
    // M10 am16 (4): the drafter writes no check. Whatever `close.shape` it sent (the schema offers none) is dropped here; a check reaches the plan only from the list's built rows (assembleFromBlock).
    delete declaration.unjudgeable; // M17 am4 (C8): the hidden can't-judge record is gone; a line's Not checked reasons are the list's rows
    delete declaration.pickedLines; // the record of picked fact lines is code's too (assembleFromBlock)
    if (Array.isArray(declaration.steps)) {
      declaration.steps = declaration.steps.map((st) => {
        if (!isPlainObject(st) || !isPlainObject(st.close) || (st.close.shape === undefined && st.close.picked === undefined)) return st;
        // M10 am22 (3): `close.picked` is code's from the list (assembleFromBlock, next); one the drafter sent is dropped here too
        const { shape: _drop, picked: _dropPicked, ...close } = st.close;
        return { ...st, close };
      });
    }
    // M16 S6: the checks of the block's lines are the block's built parts; whatever the AI wrote for them is gone, and the list that proves it is signed with the plan
    delete declaration.checkList;
    // M17 am2 item 2: the AI writes no sheet check: a declaration that carries `close.sheet` is refused (a red naming the field, no check run). The checks are the block's own (M19 S3: `setSheet`, from the row-edit reply's
    // suggestions, which code refused or built on bareguard, src/sheetbuild.js); the assembly below writes them into the step that reads the sheet
    let carriedSheet = false;
    if (sheetTables) {
      declaration.steps = (Array.isArray(declaration.steps) ? declaration.steps : []).map((/** @type {any} */ st) => {
        if (!isPlainObject(st) || !isPlainObject(st.close)) return st;
        const { sheet: carried, ...close } = st.close;
        if (carried !== undefined) carriedSheet = true;
        return { ...st, close };
      });
    }
    let assembled = null;
    if (block && blockPlan?.ok) {
      assembled = assembleFromBlock({ declaration, block, lines, lineSet: blockLineNums, askLines, sheetRoles: sheetRoleList });
      Object.assign(declaration, assembled.declaration);
      if (assembled.declaration.pickedLines === undefined) delete declaration.pickedLines;
    }
    /** @type {ReturnType<typeof closeUnbuiltSheetSteps>|null} */
    let sheetHitl = null;
    if (sheetTables) {
      // a suggestion for a line with no green step that reads a sheet has nowhere to go (recorded, as before)
      const placedLines = new Set((Array.isArray(declaration.steps) ? declaration.steps : []).filter((/** @type {any} */ st) => isPlainObject(st) && isPlainObject(st.close) && st.close.class === 'green' && Array.isArray(st.reads) && st.reads.some((/** @type {string} */ r) => sheetRoleList.includes(r))).map((/** @type {any} */ st) => st.fromLine));
      const unplaced = sheetSuggested.filter((x) => !placedLines.has(x.line)).map((x) => ({ line: x.line, helper: 'line', why: `line ${String(x.line)} has no green step that reads a sheet` }));
      // M17 am5 / P5: a sheet step the builder built no check for is closed here (its class is the assembly's decision), its rules Not checked below
      const closed = closeUnbuiltSheetSteps(declaration, unbuiltSheetLines({ declaration, lines, roles: sheetRoleList, notChecked: sheetBuilt?.notChecked ?? {} }));
      Object.assign(declaration, closed.declaration);
      sheetHitl = closed;
      if ((sheetBuilt?.refused.length ?? 0) > 0 || unplaced.length) entry.sheetRefused = [...unplaced, ...(sheetBuilt?.refused ?? [])];
    }
    // M16 am4 (2): a sheet line's checks are rows on the same list (the block holds them, src/checkblock.js; src/sheetrows.js reads them as rows)
    let sheetOnList = null;
    /** @type {ReturnType<typeof withTicketRows>['tickets']|null} */
    let ticketOnList = null;
    if (block && flowType === 'tickets') { const w = withTicketRows({ declaration, lines }); ticketOnList = w.tickets; if (w.tickets.signed.length) Object.assign(declaration, { checkList: w.declaration.checkList }); }
    if (block) { const w = withSheetRows({ declaration, lines, csvRoles: csvRolesOf(arbiter) }); sheetOnList = w.sheet; if (w.sheet.signed.length) Object.assign(declaration, { checkList: w.declaration.checkList }); }
    // M10 am27 (4): what the drafter wrote vs what the final plan keeps, per job line (record only); drafted = the declaration as sent, before any code change
    entry.retention = retentionOf(captured, declaration, jobLines, [...(assembled ? declaration.steps.filter((/** @type {any} */ st) => Array.isArray(st?.close?.picked) || Array.isArray(st?.close?.shape?.picked)).map((/** @type {any} */ st) => st.fromLine) : [])]);
    // M10b piece 4: `covers` (which ~ rules a check verifies) stays on the check and is signed; the validator checks it, the plan card shows it
    // M16: a look fact the list did not build (a Suggested `!` row, a Not-checked one) is not in the plan, so the words gate does not hold the plan to it (R2c asks every place phrase of the facts the plan checks)
    const inPlan = block ? new Set(block.rows.filter((r) => r.state === 'built').flatMap((r) => (r.factNames ?? []).map((/** @type {string} */ nm) => `${r.line}:${nm}`))) : null;
    const planLookFacts = inPlan ? look.facts.filter((f) => !blockLineNums.has(f.line) || inPlan.has(`${f.line}:${f.name}`)) : look.facts;
    const verdict1 = validateDeclaration(declaration, {
      arbiter, lines, catalogue: validationCatalogue, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
      // M10 am7 item 1: the words of every cited fact are proved on the drafting copy of the page, against what the page-word map kept
      sheetWords: sheetTables ? { headers: Object.fromEntries(Object.entries(sheetTables).map(([role, t]) => [role, t.header])), facts: sheetFacts.filter((f) => f.shape === 'column' && !(sheetHitl?.lines ?? []).includes(f.line)), tables: sheetTables } : undefined,
      pageWords: { texts: { ...(facts.docs ?? {}), ...Object.fromEntries(Object.entries(pages).map(([role, pg]) => [role, pg.text])) }, look: pageSources.length ? { facts: planLookFacts, dropped: look.dropped } : null, docs: docRolesOf(arbiter.sources) },
    });
    // M13 piece 4 (F105 rewritten): a generic MCP job whose steps call none of its tools is fed back like any validator red (the run would refuse it at $0, by the same sentence)
    // M4d am39: a brace-repaired answer the validator finds an unknown key in is not used; the round is a structure failure, as today
    if (braceWhy !== null && !verdict1.ok && verdict1.reds.some((r) => /unknown key/.test(r))) {
      entry.braceRepair = { ...entry.braceRepair, used: false };
      delete entry.retention;
      const next = structureFailure(braceWhy);
      if (next === 'break') break;
      continue;
    }
    const planRed = verdict1.ok ? findMcpPlanRed(declaration) : null;
    const carriedRed = carriedTicketFields.length ? `declaration: the draft carries ${carriedTicketFields.map((f) => `"${f}"`).join(' and ')}, which code sets from the check on the list. Remove the field from the draft` : carriedSheet ? 'declaration: the draft carries "close.sheet", which code builds from the checks suggested on the list. Remove the field from the draft' : null;
    const verdict = carriedRed ? { ok: false, reds: [carriedRed] } : planRed ? { ok: false, reds: [planRed] } : verdict1;
    lastDecl = declaration;
    const asked = askOpen ? normalizeQuestions(rawQuestions, failedLines) : { kept: [], dropped: [] };
    const uncovered = [...uncoveredRules(declaration, jobLines, Object.keys(facts.sheets ?? {}), sheetBuilt ?? undefined), ...(sheetHitl?.lost ?? [])];
    // the tag of a note no row tells: any note code writes is [default]; a row's own tag wins
    // M17 am2 / am4: a sheet look's column drop of a word inside a `~` rule never makes a Not checked line of its own. A rule a check row holds shows nowhere here; a rule none holds shows ONCE, with the build's reason
    // (`uncovered`). A drop of a prose word is no rule and stays.
    const ruleKey = (/** @type {string} */ t) => t.split(' \u2014 ')[0];
    const sheetRuleKeys = new Set(jobLines.filter((l) => sheetLineNums.includes(l.n)).flatMap((l) => lineRules(l).map((r) => `line ${l.n}: "${r}"`)));
    const lookNotChecked = pageNotChecked.filter((t) => !sheetRuleKeys.has(ruleKey(t)));
    /** @type {Record<string, 'you'|'agent'|'default'>} */
    const noteBy = Object.fromEntries([...lookNotChecked, ...uncovered].map((t) => [t, 'default']));
    const ticketNotChecked = (ticketOnList?.notChecked ?? []).map((t) => `not checked · "${t.rule}" — ${t.reason}`);
    for (const t of ticketNotChecked) noteBy[t] = 'you';
    extras = { questions: asked.kept, droppedQuestions: asked.dropped, notChecked: [...new Set([...lookNotChecked, ...(assembled ? assembled.notChecked : []), ...ticketNotChecked, ...uncovered])], ...(assembled ? { notCheckedBy: { ...noteBy, ...assembled.notCheckedBy } } : {}) };
    if (asked.dropped.length) entry.droppedQuestions = asked.dropped;
    // the declaration the model sent, as parsed, before any code overwrite (log.json keeps it per try)
    entry.args = captured;
    // M16 S7: a red on a check the BLOCK built is a fault of the build, not of the job: the draft stops in plain words, the AI is never asked to fix it (R2); reds on steps, reads, asks, send stay a revise
    const faults = !verdict.ok && assembled ? /** @type {string[]} */ (/** @type {any} */ (verdict).reds).filter((r) => isBuildFault(r, linesNamedByReds([r], declaration, lineNums).filter((n) => assembled.built.has(n)))) : [];
    if (faults.length) {
      entry.outcome = 'plan-red';
      entry.reds = [.../** @type {any} */ (verdict).reds];
      log.push(entry);
      lastReds = [buildFaultWords(faults)];
      stop = 'plan-red';
      break;
    }
    if (verdict.ok) {
      entry.outcome = 'valid';
      log.push(entry);
      // M19 am8 item 1, am9 item 5: the draft's ledger rows, one per Not checked row, in its own log (no new file); a row's words are the build's name for it
      if (block) log.push(...ledgerRowsOf(declaration, lines, Object.fromEntries(block.rows.filter((r) => r.kind !== 'rule').map((r) => [r.key, r.name ? [r.name] : r.words ?? []]))));
      const m = sumMeterings(meterings);
      return withAction({
        ok: true, declaration, reds: [], rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries, revisions, stop: null, log, thinking: thinkingOf(), inputs: facts.list, ...extras, ...pageExtras, ...(block ? { checkCard: (() => { const c = sheetOnList ? withSheetCard(cardOfBlock(block), sheetOnList) : cardOfBlock(block); return cardOfPlanBlock(block, ticketOnList?.card.length ? withSheetCard(c, { card: ticketOnList.card }) : c, { declaration, lines, csvRoles: csvRolesOf(arbiter), log }); })() } : {}),
      });
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
  return withAction({
    ok: false, declaration: lastDecl, reds: lastReds, rounds: m.rounds, calls, spendComplete: unmetered === 0 && m.costUsd !== null, costUsd: m.costUsd, modelReturned: m.model, modelId, price: priceRecord(prices, rates), tokens: m.tokens, structureRetries, revisions, stop, log, thinking: thinkingOf(), inputs: facts.list, ...extras, ...pageExtras,
  });
}
