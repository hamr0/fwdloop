// borrowed-from: bareloop src/authorflow.js@v0.56.0 (3383cce)
// THE WRITING HALF — close-authoring v1, module M3b (design record 2026-08-07
// D3/D11/D12; gate-2 POC prereg addenda 5 and 6).
//
// M1 owns what a stage DOES. M2 owns what a declaration may SAY and whether one
// said it legally. This module is the part that gets a declaration out of a model
// and refuses to accept a bad one — the authoring call, the schema that bounds
// it, and the grounded revise loop that measures it against the real repository
// before anyone signs anything.
//
// ── THE ONE STRUCTURAL DECISION (hamr, 2026-08-08) ──────────────────────────
//
// The declaration is emitted through a SCHEMA-FORCED TOOL CALL, never parsed out
// of prose. Standing doctrine: *"text mode will NOT force JSON output; the
// structure-enforced alternative is tool mode."* The model answers by calling
// `declare_close`, whose input schema IS the declaration shape, and that schema
// is DERIVED from M2's catalogue — one source, never a second hand-written copy.
//
// This does NOT reopen D3 (*"the authoring call gets no tools at all"*). D3's
// subject is hamr's law — *"the danger is in the ACTIONS, not the SYNTAX"* — and
// `declare_close` takes no action: it has no fence to cross because it touches
// nothing, spawns nothing and reads nothing. It is the OUTPUT CHANNEL, in the
// place a fenced JSON block used to sit. The authoring call still has no repo
// tool, no shell, and no way to reach the tree; the scout (M3a) is where looking
// happens, and it is a different call with a different grant.
//
// TWO CONSEQUENCES, NAMED RATHER THAN SMOOTHED:
//
//   1. A LOCKED KIND IS INEXPRESSIBLE IN TOOL MODE. The schema carries one branch
//      per LIVE kind, so there is no way to spell `judged-floor` or
//      `human-confirms` — which is the `check-passes(name)` move applied one
//      level up (illegal becomes unsayable, not rejected late). The price is
//      real: M2's `locked-kind` red is bareloop's DEMAND COUNTER for its own
//      catalogue (D13 forward-compat point 2), and a demand that cannot be
//      spoken cannot be counted. On the tool path, locked-kind demand must come
//      from the INTERVIEW layer (D13's genre/verdict refusal, which is where a
//      user's "I want a person to sign this off" actually lands) or from the text
//      fallback below. This module counts what it can see and says so; it does
//      not pretend the channel is intact.
//
//   2. THE TEXT PATH SURVIVES ONLY AS A FALLBACK for a provider with no tool
//      mode. It is `structuredMode: 'text'`, it is marked everywhere it appears,
//      and it uses the ONE shipped parser (`extractArtifact`). It is not a
//      recovery path for a model that ignored the tool: that is an ARTIFACT-RED —
//      name the axis, retry under a bound, write nothing.
//
// ── THE GROUNDED LOOP (addendum 5, lever L2) ────────────────────────────────
//
// author → validate → run EVERY stage at the seed → feed the MEASURED results
// back → revise. Bounded at two revisions, early-stop when the model returns its
// declaration unchanged. The feedback is EXECUTION OUTPUT and nothing else: no
// model ever reviews another model's close (D9), because a model grading its own
// homework is the self-consistency trap the design already bans. The revise turn
// is exactly `measured block + one frozen instruction`, and `assertReviseTurn`
// is what makes that a fact instead of a promise.
//
// A validation red is fed back the same way and COUNTS as a revision — it is a
// measurement of the declaration, made by the validator. A malformed EMISSION is
// not: it is a transport fault, retried under its own bound, and it never eats
// the model's revision budget.
//
// ── WHAT THIS MODULE INJECTS, AND WHY IT IS NOT THE MODEL'S JOB ─────────────
//
// The genre's environment (addendum 6's second residue). `MYPYPATH` on a Python
// patient is the Result-5 fact no user can supply and no model found: round 2's
// arm B authored it itself and authored it WRONG. It is applied MECHANICALLY to
// every stage that spawns something, a model-authored copy is DROPPED and
// ANNOUNCED, and a genre variable this patient cannot supply is a RED — because
// it moves no seed number, so no seed-verdict read can ever catch its absence.
// The model is never handed its own injected copy back, or M2 would red it as
// `genre-owned-env` on the next turn for a variable the model did not write.
//
// F6 throughout: an unpriced call makes the TOTAL unknown, and unknown is null.
// No spine emission here — M4 wires events.

import { renderInputs } from './jobblock.js';
import { thinkingCallOptions } from './thinking.js';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { seedRead as runSeedReadStages, makeSeedTrees, AGGREGATES, SIGNS, MAX_TERMS, MAX_JUDGED_PATHS } from './kinds.js';
import { JUDGE_RULE_IDS } from './judged.js';
import {
  KIND_CATALOGUE, MAX_STAGES, DIRECTIONS, BASELINES,
  GENRE_LANGUAGES, RUBRIC_LANG, DECLARABLE_LANGUAGES, TYPES_GENRE_TEMPLATE, classGuards, genreEnv, genreOwnedEnvNames, genreInstruments,
  validateDeclaration, envCapableKind, classMenu, VERDICT_CLASSES, LIVE_CLASSES, MENU_CLASSES, catalogueForLang,
} from './authoring.js';
import { buildSeedListing, cleanEntry, SURVEY_CAUSES, AUTHOR_CALL_TIMEOUT_MS } from './authorscout.js';
import { extractArtifact, priceOf, scrubRaw, tallyCalls, capStop, callCasualty } from './text.js';
import { redactSecrets } from './validate.js';
import { ledgerRecord } from './checklist.js';
import { ROW_EDIT_REVISE, rowEditUserText, rowEditChannel, editsOf } from './rowedit.js';
import { REASON, CheckBlock } from './checkblock.js';
import { stepFileContract, inputLabelsOf, stepFileRel, readFrozenInputs, lineRules } from './rubricstep.js';
import { dropRows, dropLine } from './pagedropwords.js';
import { renderLookReport } from './inputlook.js';
import { checkDeclarationWords, labelListsFor } from './factwords.js';
import { ticketFilterReds, ticketFilterBlock, ticketPerRunFacts, TICKET_FILTER_SCHEMA_WORDS } from './ticketfilter.js';

const require = createRequire(import.meta.url);
const { Loop } = require('bare-agent');

/** @typedef {{code: string, path: string, detail: string, [k: string]: any}} Red */

// ── constants ────────────────────────────────────────────────────────────────

/** the output channel's name. It takes no action; it carries the answer. */
export const DECLARATION_TOOL_NAME = 'declare_close';
/** what the tool returns. The loop stops on delivery, so the model never reads it. */
export const DECLARATION_ACK = 'declaration received';
/** addendum 5: unlimited revising launders thrash as adaptation (v1.12's rule). */
export const MAX_REVISIONS = 2;
/** a malformed EMISSION is a transport fault, bounded on its own axis */
export const MAX_STRUCTURE_RETRIES = 2;
/** per-stage gap lines carried into a revise turn, trim announced (F28) */
export const REVISE_GAP_CAP = 15;
/** validator reds carried into a revise turn, trim announced (F28) */
export const REVISE_RED_CAP = 20;
/** F18 / F30 — caching on, and the 4096 provider default cannot hold a declaration */
export const AUTHOR_MAX_TOKENS = 32000;
/** the one slot the model fills on an injected guard */
export const FILL_MARKER = '<FILL IN>';

/** P7 item 5 (fwdloop am24/25): the most questions the MACHINE keeps from the try-3 drafter. The drafter is never told this number. PRD v1.107 Part 5b: three (hamr's ruling), shared with the code-forced early asks. */
export const MAX_QUESTIONS = 3;

/**
 * The model-visible words of the optional `questions` property — offered ONLY on the last drafting try and only after the
 * two before it both failed validation (a mechanism, never a wish: the schema carries it on that one call and nowhere
 * else). It lives in the property's description, so the frozen revise turn stays measurement-only. No digit and no number
 * word anywhere in it (a test greps this): the machine, not the prompt, bounds the count.
 */
export const QUESTIONS_DESCRIPTION = 'Optional. Add a question only if a refusal in the measured results names a job line that cannot be drafted '
  + 'without the person\'s answer (an undefined size, format, destination, or what "done" means). Each question is {line, question}: '
  + '"line" is the number of the job line it is about. If the refusals can be fixed without asking, fix them and leave this out. '
  + 'Never ask about a budget, a cap or a time limit (the person signs those). Still deliver the complete corrected declaration.';

/**
 * Which job lines did these validation reds name? A red names a line in its text ("job line N") or through the stage it
 * sits on (path `stages[i]…` → that stage's own `fromLine`; `refused[i]…` → that refusal's `line`). A red naming none (a
 * missing top-level key) names no line. Sorted real line numbers.
 * @param {Red[]} reds @param {any} declaration @param {number[]} lineNums
 * @returns {number[]}
 */
export function linesNamedByReds(reds, declaration, lineNums) {
  /** @type {Set<number>} */
  const found = new Set();
  const stages = Array.isArray(declaration?.stages) ? declaration.stages : [];
  const refused = Array.isArray(declaration?.refused) ? declaration.refused : [];
  for (const red of reds ?? []) {
    for (const m of String(red?.detail ?? '').matchAll(/\bjob line (\d+)\b/g)) found.add(Number(m[1]));
    const st = /^stages\[(\d+)\]/.exec(String(red?.path ?? ''));
    if (st && Array.isArray(stages[Number(st[1])]?.fromLine)) {
      for (const n of stages[Number(st[1])].fromLine) if (Number.isInteger(n)) found.add(n);
    }
    const gl = /^guardLines\[(\d+)\]/.exec(String(red?.path ?? ''));
    const guardLines = Array.isArray(declaration?.guardLines) ? declaration.guardLines : [];
    if (gl && Array.isArray(guardLines[Number(gl[1])]?.lines)) for (const n of guardLines[Number(gl[1])].lines) if (Number.isInteger(n)) found.add(n);
    const rf = /^refused\[(\d+)\]/.exec(String(red?.path ?? ''));
    if (rf && Number.isInteger(refused[Number(rf[1])]?.line)) found.add(refused[Number(rf[1])].line);
  }
  return [...found].filter((n) => lineNums.includes(n)).sort((a, b) => a - b);
}

/**
 * The machine's keep-or-drop of the try-3 questions. Kept only when its line is one the previous try's reds named and its
 * text is non-blank, at most {@link MAX_QUESTIONS}; every drop comes back with its reason, for the draft's log.
 * @param {any} raw @param {number[]} failedLines
 * @returns {{kept: {line: number, question: string, rule?: number, source?: string, ask?: 'reading'|'cant-check', reading?: string}[], dropped: {reason: string, raw: any}[]}}
 */
export function normalizeQuestions(raw, failedLines) {
  /** @type {{line: number, question: string, rule?: number, source?: string, ask?: 'reading'|'cant-check', reading?: string}[]} */
  const kept = [];
  /** @type {{reason: string, raw: any}[]} */
  const dropped = [];
  if (raw === undefined || raw === null) return { kept, dropped };
  if (!Array.isArray(raw)) return { kept, dropped: [{ reason: 'questions is not a list', raw }] };
  for (const q of raw) {
    if (!q || typeof q !== 'object' || !Number.isInteger(q.line)) { dropped.push({ reason: 'no line', raw: q }); continue; }
    if (!failedLines.includes(q.line)) { dropped.push({ reason: `line ${q.line} is not a line the previous try's checks failed on`, raw: q }); continue; }
    if (typeof q.question !== 'string' || q.question.trim() === '') { dropped.push({ reason: 'blank question', raw: q }); continue; }
    if (kept.length >= MAX_QUESTIONS) { dropped.push({ reason: 'beyond the machine\'s limit', raw: q }); continue; }
    kept.push({
      line: q.line, question: redactSecrets(q.question.trim()),
      // PRD v1.106 Part 5 Q3: a code-forced question (the early look ask) names the `~` rule it is about and says so; a model's question has neither
      ...(Number.isInteger(q.rule) ? { rule: q.rule } : {}), ...(typeof q.source === 'string' ? { source: q.source } : {}),
      // PRD v1.107 Part 5b: the kind of a code-forced ask, and (reading asks) the plain words `agree` writes as the `~` rule
      ...(q.ask === 'reading' || q.ask === 'cant-check' ? { ask: q.ask } : {}), ...(q.ask === 'reading' && typeof q.reading === 'string' ? { reading: redactSecrets(q.reading) } : {}),
    });
  }
  return { kept, dropped };
}

/**
 * Did this try FAIL THE SEED READ (hamr's ruling 2026-10-10, differing from fwdloop's validation-only rule)? It did when a work
 * stage instrument-stopped, or when no work stage is red on the repo as it is — the vacuous close ("nothing in the close fails
 * at all": it grades nothing). The mandatory guards (`guardNames`) are green at the seed by design and never count as work.
 * The job lines it names are the `fromLine`s of the stages the seed read named (the instrument-stopped ones, else every work
 * stage); if none of them maps to a real line, EVERY numbered job line counts.
 * @param {any[]} rows @param {any} declaration @param {string[]} guardNames @param {number[]} lineNums
 * @returns {{failed: boolean, lines: number[]}}
 */
export function seedReadFailure(rows, declaration, guardNames, lineNums) {
  const work = (Array.isArray(rows) ? rows : []).filter((r) => !guardNames.includes(r?.stage));
  const stopped = work.filter((r) => r?.verdict === 'instrument-stop');
  const vacuous = !work.some((r) => r?.verdict === 'red');
  if (stopped.length === 0 && !vacuous) return { failed: false, lines: [] };
  const named = new Set((stopped.length ? stopped : work).map((r) => r?.stage));
  /** @type {Set<number>} */
  const found = new Set();
  for (const st of Array.isArray(declaration?.stages) ? declaration.stages : []) {
    if (named.has(st?.name) && Array.isArray(st.fromLine)) for (const n of st.fromLine) if (Number.isInteger(n)) found.add(n);
  }
  const lines = [...found].filter((n) => lineNums.includes(n)).sort((a, b) => a - b);
  return { failed: true, lines: lines.length ? lines : [...lineNums] };
}

/** The honest truncation signal: bare-agent's Loop tags a round cut off at the output cap `error: 'truncated:max_tokens'`
 * with the neutral `stopReason: 'max_tokens'` (node_modules/bare-agent/src/loop.js, BA-6/BA-13).
 * @param {any} r */
export const isOutputCutOff = (r) => r?.error === 'truncated:max_tokens' || (Boolean(r?.error) && r?.stopReason === 'max_tokens');

/**
 * ONE red, scrubbed — the same spelling `prepareSigning` uses (src/authorjob.js),
 * and for the same reason: a validation red QUOTES what the model declared, and
 * these copies are persisted (`iterations[].validation`, this module's returned
 * `reds`) rather than only rendered.
 *
 * UNIFORM over every string-valued field, never a named list of them. `detail` is
 * only the loudest echo — `cmd-denied` quotes the command again as a structured
 * `cmd`, `path-not-in-listing` carries `declared`/`resolved`, and the next red to
 * learn a field would be missed by an allowlist written today. `redactSecrets`
 * returns a non-matching string byte-identical, so `code`/`path` pass through
 * unchanged and the uniform map costs them nothing.
 * @param {Red} r @returns {Red}
 */
const scrubRed = (r) => /** @type {any} */ (Object.fromEntries(
  Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? redactSecrets(v) : v]),
));

/**
 * THE FROZEN REVISE INSTRUCTION — gate-2 round 3's own text, byte for byte
 * (`scratch-gate2/author.mjs:63`, the turn that PASSED both arms). It is the only
 * prose a revise turn may carry, this constant is its only source, and the suite
 * asserts its bytes: an edit reds the suite and forces a decision rather than
 * quietly changing what every future close is corrected against.
 */
export const REVISE_INSTRUCTION = 'These are the measured results of running your close against the UNCHANGED repository (the seed). '
  + 'The work has not been done yet. Judge your own declaration against them: a work stage that is GREEN at '
  + 'seed is grading nothing; an instrument stop means the stage cannot run at all; a count far from what the '
  + 'interview describes means the instrument is measuring the wrong thing. Return the full corrected '
  + 'declaration, or return it unchanged if you believe it is correct.';

/**
 * The structure re-ask, per mode. DELIBERATELY NOT `REVISE_INSTRUCTION`: nothing
 * has been measured, there is no declaration to judge, and reusing the revise
 * text would tell a model to "judge its own declaration against them" when there
 * is no them.
 */
export const STRUCTURE_INSTRUCTION_TOOL = `Your reply did not deliver exactly one declaration through the ${DECLARATION_TOOL_NAME} tool. `
  + `Call ${DECLARATION_TOOL_NAME} exactly once, with the whole declaration as its arguments. Do not write the declaration as text.`;
export const STRUCTURE_INSTRUCTION_TEXT = 'Your reply could not be read as one JSON declaration. '
  + 'Reply with ONLY the JSON object, in a single fenced block, and nothing else.';

/**
 * THE UNIFIED INTAKE FORM (PRD item 33 M3 piece 3, `docs/product/ITEM33-BUILD.md`
 * "M3", and the 2026-09-10 signed ruling "The intake form (RULED)" in
 * `docs/product/PRD.md` item 33). Motivated by run `mtv8jihy` (F159): the OLD
 * five-question green set produced a rubric compiled onto doc-comment rules —
 * the wrong bar for what the person actually asked — because Q2 asked in prose
 * for a decision the machine can prove instead, and Q3/Q5 asked the same "what
 * must not go wrong" question twice from two directions.
 *
 * THE SAME SIX FIELDS FOR GREEN AND SOFT-GREEN, in the order a person sees them:
 *
 *   Source            replaces the read half of the old Q2 — MECHANICAL, proven
 *                      against the machine ($0), never typed as free prose.
 *   Destination        replaces the change half of the old Q2 (and, for a repo
 *                      source, IS the signed `writeScope` fence) — MECHANICAL,
 *                      same reason.
 *   Goal               the old Q1, unchanged: "What do you want done?"
 *   What success looks like   the old Q4, unchanged: a machine-countable check.
 *   Guardrails         the old Q3 ("must not change") and Q5 ("worse than
 *                      before") JOINED into one field — they were always one
 *                      decision answered twice, and Q5 already only mattered for
 *                      a repo source (the M3 confirm turn, not built in this
 *                      piece, is where the repo-only half of it gets asked again
 *                      if needed).
 *   Judge examples     soft-green only — the old Q7 verbatim ("one you'd pass and
 *                      one you'd fail, and say why"). The old Q6 ("what separates
 *                      a pass from a fail") is retired as its own question: the
 *                      "why" lines of a real pass/fail pair are what the rubric
 *                      card compiles from (`cardauthor.js`), and asking the
 *                      differentiator twice — once in the abstract, once against
 *                      a real example — is the same double-ask Q3/Q5 already were.
 *
 * SOURCE and DESTINATION ARE MECHANICAL FIELDS, not entries in the numbered
 * question record below: `runInterview`'s `answers` dict is what a close's
 * composer prompt quotes verbatim (Q<n>/A<n>), and quoting a machine-proven fact
 * back at the model as if a person had typed it would be the model reading a
 * fabricated conversation. Their WORDING still lives here (`SOURCE_FIELD`,
 * `DESTINATION_FIELD_REPO`, `DESTINATION_FIELD_PLAIN`, immediately below) so
 * `scripts/run-interview.mjs` prints library text and nothing of its own, exactly
 * as ruling 1 requires for the free-text questions.
 *
 * The free-text trio (soon quartet, soft-green only) IS numbered contiguously
 * from 1 — the number a person sees is the key their answer is filed under, and
 * that is what `questionsFor`/`requiredAnswersFor`/`QUESTION_SETS` still expose,
 * unchanged in shape, to every existing caller.
 */
export const SOURCE_FIELD = Object.freeze({
  id: 'source',
  kind: 'mechanical',
  label: 'Source',
  prompt: 'A local folder, subfolder or file, or one URL the machine can reach (no login, no setup).',
});

/** P7: the Inputs box's wording (replaces Source). Line 1 is the repo; lines 2+ are tracked files inside it. */
export const INPUTS_FIELD = Object.freeze({
  id: 'inputs',
  kind: 'mechanical',
  label: 'Inputs',
  prompt: 'What the job points at, one per line as `label: value`. Line 1 is the repo, as an absolute path\n'
    + '(e.g. `repo: /home/me/myrepo`). Lines 2 and on are files or folders inside that repo, repo-relative\n'
    + '(e.g. `spec: docs/spec.md`) — git must track them.',
});

/** P7: how to write "The job" (printed under its question by the CLI; the panel's box shows the same in its examples). */
export const JOB_BLOCK_HELP = Object.freeze([
  'One line per thing the job must do — each plain line gets a number. A line starting with `~` is a rule for the',
  'numbered line above it. For a rubric check, a `~ PASS: ...` and a `~ FAIL: ...` line are your examples.',
]);

/** Destination's wording when Source resolved to a git repo: the answer IS the
 * signed `writeScope` fence (ITEM33-BUILD.md M3 ruling 2). */
export const DESTINATION_FIELD_REPO = Object.freeze({
  id: 'destination',
  kind: 'mechanical',
  label: 'Destination',
  prompt: 'Which files the worker is allowed to WRITE — everything else is read-only.\n'
    + 'Patterns are relative to the repo root, comma-separated (e.g. `src/**`). The run works on a copy of the\n'
    + 'repo, so absolute paths are refused. The agent may narrow this and may never widen it.',
});

/** Destination's wording for every other kind of Source (a plain folder, a
 * file, a URL): a directory the run may write into, never a filename
 * (2026-09-12 Destination correction, PRD item 33). */
export const DESTINATION_FIELD_PLAIN = Object.freeze({
  id: 'destination',
  kind: 'mechanical',
  label: 'Destination',
  prompt: 'A LOCAL DIRECTORY the run may write into — never a filename. It may already exist. If it is the same\n'
    + 'directory as Source, changes are permitted there and nowhere else. Type an absolute path.',
});

/** @param {boolean} isRepo @returns {typeof DESTINATION_FIELD_REPO} */
export function destinationFieldFor(isRepo) { return isRepo ? DESTINATION_FIELD_REPO : DESTINATION_FIELD_PLAIN; }

/**
 * P7 (2026-10-10, docs/product/PANEL-BUILD.md): the old free-text trio (Goal, What success looks like, Guardrails) is ONE
 * answer now — "The job", the person's numbered lines with their `~` rules (src/jobblock.js renders it). What follows
 * is the history of the trio, kept because the numbering rule below still holds.
 *
 * THE FREE-TEXT SLOTS EVERY CLASS SHARES, numbered contiguously from 1. This is what `answers[1..3]` are
 * filed under for every class; soft-green appends a fourth
 * (`SOFTGREEN_QUESTIONS`) and hitl appends a different fourth
 * (`HITL_QUESTIONS`), each its own next number rather than a fixed one, so a
 * future trim of this trio renumbers instead of leaving a gap.
 *
 * THE TEXT IS THE SIGNED TABLE'S "Holds" COLUMN, VERBATIM (PRD item 33's
 * 2026-09-10 "The intake form (RULED)" ruling, `docs/product/PRD.md`) — not the
 * old worded questions ("What do you want done?", "How do you check today
 * whether it's working?", "...worse than before?"). Motivated by run `mtv8jihy`
 * (F159, `docs/wiki/FINDINGS.md`): a rulebook this prompt commit did not touch
 * still had to compile against a card built from a person's actual bar, and the
 * old wording never matched what got signed — this reshape (commit 1ac4d05)
 * trimmed the SET to three slots but left their PROSE unreconciled with the
 * table it was meant to realize. `FIELD_LABELS` (below) carries the matching
 * label for each key, so a caller wanting BOTH shows them together — see
 * `authorPrompt`'s interview block and `scripts/run-interview.mjs`.
 */
export const GREEN_QUESTIONS = Object.freeze({
  1: 'the job, as numbered lines — each line may carry the rules (~) the person wrote under it',
});

/**
 * The signed table's own label for each of {@link GREEN_QUESTIONS}' keys — "the
 * Field column", where {@link GREEN_QUESTIONS} is "the Holds column". Kept as a
 * SEPARATE map rather than folding the label into the question string itself:
 * every existing caller of `questionsFor`/`requiredAnswersFor`/`QUESTION_SETS`
 * (`src/authorjob.js`, `src/cardauthor.js`, `scripts/run-interview.mjs`) treats
 * a question as a plain string handed verbatim into a prompt or a `Q<n>. `
 * line, and folding a label in would change that shape for every one of them.
 * A caller that wants the label calls {@link labelsFor} exactly the way it
 * calls `questionsFor` — additive, nothing existing breaks.
 */
export const FIELD_LABELS = Object.freeze({
  1: 'The job',
});

/** The key Judge Examples and hitl's own question both prove out at: green holds
 * exactly one free-text slot (P7), so 2 is the next number for both the
 * soft-green and hitl extensions below — computed, never hardcoded twice. */
const NEXT_FREE_TEXT_KEY = Object.keys(GREEN_QUESTIONS).length + 1;

/** The soft-green quartet's own key for Judge Examples — exported so
 * `cardauthor.js` reads the SAME number this module files the answer under,
 * rather than a second, hand-typed "6"/"7". */
export const SOFTGREEN_JUDGE_EXAMPLES_KEY = NEXT_FREE_TEXT_KEY;

/** The Judge Examples question — the signed table's own Holds text, verbatim
 * ("one pass, one fail, and why"), not the old worded Q7 ("Give one example
 * you'd pass and one you'd fail, and say why."). Exported so `cardauthor.js`'s
 * prompt and this module's own `SOFTGREEN_QUESTIONS` render the identical
 * string; its label ("Judge examples") lives in `SOFTGREEN_FIELD_LABELS`. */
export const JUDGE_EXAMPLES_QUESTION = 'the PASS: and FAIL: examples the person wrote under their job lines, each with its line number';

/** {@link FIELD_LABELS} plus Judge Examples' own label, for the soft-green set. */
export const SOFTGREEN_FIELD_LABELS = Object.freeze({
  ...FIELD_LABELS,
  [SOFTGREEN_JUDGE_EXAMPLES_KEY]: 'Judge examples',
});

/**
 * THE SOFTGREEN SET — the green trio plus Judge Examples. A judged close needs
 * exactly this one more thing the green set cannot supply: a real pass/fail
 * pair in the person's own words, which module 4 (`cardauthor.js`) compiles
 * into the signed rubric card and the frozen calibration set. It rides in
 * `answers` and reaches the composer verbatim through the prompt's interview
 * block, exactly as every other free-text answer does — this module derives
 * nothing from it.
 */
export const SOFTGREEN_QUESTIONS = Object.freeze({
  ...GREEN_QUESTIONS,
  [SOFTGREEN_JUDGE_EXAMPLES_KEY]: JUDGE_EXAMPLES_QUESTION,
});

/**
 * THE HITL SET (N4 slice 1, kept in code only — never offered in the form or
 * anywhere customer-facing, PRD item 33 M3 ruling 8) — the green trio plus one.
 * `human-confirms` requires an `ask`, the question the signer answers at the
 * end of the run, and nothing else in the interview names it; without it the
 * composer would have to invent what a person is deciding. It is the green
 * set's next number, not a fixed one, so a green-side trim renumbers it too.
 */
export const HITL_QUESTIONS = Object.freeze({
  ...GREEN_QUESTIONS,
  [NEXT_FREE_TEXT_KEY]: 'When you look at the finished result yourself, what are you deciding?',
});

/**
 * The three sets, all LIVE as of softgreen module 3. The locked shape stays
 * spelled out in the readers below rather than deleted with the last locked
 * class: `questions: null` is ABSENT, never `{}` — an empty set would read as
 * "this class needs no questions", a different and false statement (F59's
 * distinction, at the interview layer) — and a locked class refuses at ADMISSION,
 * before its questions run, so the two readers throw rather than hand back
 * nothing. A fourth class arrives locked, and the machinery is here for it.
 * `labels` travels ALONGSIDE `questions`, one label per key that the signed
 * table names one for (PRD item 33 M3 piece 3's wording fix) — hitl's own
 * fourth question has no table row (it is never customer-facing, ruling 8) and
 * so carries none; a reader finding no label for a key falls back to showing
 * none, never a fabricated one.
 * @type {Record<string, {locked: boolean, questions: Record<string|number, string>|null, labels: Record<string|number, string>, required: readonly number[]|null}>}
 */
export const QUESTION_SETS = Object.freeze({
  green: Object.freeze({
    locked: false,
    questions: GREEN_QUESTIONS,
    labels: FIELD_LABELS,
    required: Object.freeze(Object.keys(GREEN_QUESTIONS).map(Number).sort((a, b) => a - b)),
  }),
  'soft-green': Object.freeze({
    locked: false,
    questions: SOFTGREEN_QUESTIONS,
    labels: SOFTGREEN_FIELD_LABELS,
    required: Object.freeze(Object.keys(SOFTGREEN_QUESTIONS).map(Number).sort((a, b) => a - b)),
  }),
  hitl: Object.freeze({
    locked: false,
    questions: HITL_QUESTIONS,
    labels: FIELD_LABELS,
    required: Object.freeze(Object.keys(HITL_QUESTIONS).map(Number).sort((a, b) => a - b)),
  }),
});

/**
 * WHERE GENRE UNDERSTANDING NOW LIVES: the plain statement the composer is fed —
 * *the user has this problem and declared it green/deterministic*. It is the
 * user's own answer travelling into the composition call, and the composer is
 * what turns it into stages over owned kinds.
 *
 * A locked class states NOTHING rather than something bland: a sentence here
 * would be a class this build can compose for, and it cannot.
 * @type {Record<string, string|null>}
 */
export const CLASS_STATEMENTS = Object.freeze({
  green: 'The person declared this job GREEN: their definition of done is MACHINE-CHECKABLE. A command has to be able '
    + 'to decide it — no judgement, no score, and no person in the loop. Every stage you compose is a mechanical '
    + 'measurement of this repository. If part of what they asked for cannot be measured that way, leave it out and '
    + 'say so in your notes rather than approximating it with a stage that means something else.',
  // softgreen module 3. Stated as an ORDER for the same reason hitl's is: the
  // close is first-red-wins, so the cheap mechanical stages shield the one stage
  // that spends money, and the judge is never the first filter. The last sentence
  // is the documented ceiling (§4.3) said to the composer in its own terms — the
  // judge only ever checks lines the card names, so an unstated expectation is
  // not a stricter judge, it is a line nobody wrote.
  'soft-green': 'The person declared this job SOFT-GREEN: part of what "done" means here needs JUDGEMENT — reading '
    + 'the result and deciding whether it is any good — and no command can render it. Compose the mechanical part '
    + 'first: everything about this repository a command can decide is still a mechanical stage, exactly as it would '
    + 'be for a green job. Then put ONE judged-floor stage AFTER them, carrying the few things the person said they '
    + 'actually look for and the real files the work lands in (files the job may EDIT, inside the write fence, '
    + 'because a finding on a file the run is fenced out of can never be fixed). A judged stage decides only the lines its card names, '
    + 'so name each thing they look for as its own line, and leave nothing to be inferred.',
  // N4 slice 1. The mechanical-first composition law is stated as an ORDER
  // because first-red-wins makes the order the mechanism: the cheap stages shield
  // the expensive one, and the person is never the first filter.
  hitl: 'The person declared this job HITL: a PERSON renders the final verdict, because their judgement is what '
    + '"done" means here. Compose the mechanical part first — everything about this repository a command can decide '
    + 'is still a mechanical stage, exactly as it would be for a green job — and put ONE human-confirms stage LAST, '
    + 'carrying the question they answer when they look at the result. Never make the person the first filter: a '
    + 'stage a command can render is never handed to them, and they are asked only once, at the end, about the part '
    + 'no command can hold.',
});

/** @param {string} verdictType @returns {{locked: boolean, questions: any, labels: any, required: any}} */
function questionSet(verdictType) {
  const set = Object.hasOwn(QUESTION_SETS, String(verdictType)) ? QUESTION_SETS[String(verdictType)] : null;
  if (!set) throw new Error(`no interview set for verdict class "${verdictType}" — one of ${VERDICT_CLASSES.join(', ')}`);
  if (set.locked || set.questions === null) {
    throw new Error(`the "${verdictType}" interview set is LOCKED — that class is declared-but-locked in v1 and `
      + 'admission refuses it before its questions are ever asked');
  }
  return set;
}

/** The frozen question set for a picked class. Throws on a locked or unknown
 * one: reaching here with either means admission did not refuse, which is a
 * bareloop bug, and failing loudly beats interviewing for a class we cannot run.
 * @param {string} verdictType */
export function questionsFor(verdictType) { return questionSet(verdictType).questions; }
/** The question numbers whose answer must be present for that class's interview
 * to be finished. @param {string} verdictType @returns {number[]} */
export function requiredAnswersFor(verdictType) { return [...questionSet(verdictType).required]; }
/** The signed table's label for each of that class's question keys (PRD item
 * 33's "The intake form (RULED)" ruling) — a key with no table row (hitl's own
 * fourth) is simply absent, never a fabricated label. Throws on the same locked
 * or unknown class {@link questionsFor} does, for the same reason.
 * @param {string} verdictType @returns {Record<string|number, string>} */
export function labelsFor(verdictType) { return questionSet(verdictType).labels; }

// ── CONFIRM TURN — person-facing wording (PRD item 33 M3 piece 4) ──────────
//
// These are the $0, no-provider half of the confirm turn (D7): asked before
// the scout ever runs, so a missing person at end of input stops at $0
// rather than after a paid call. FROZEN wording, exactly like SOURCE_FIELD
// and DESTINATION_FIELD_* above — a caller prints these verbatim, never
// rewords or reorders them.
//
// RETIRED (hamr's ruling, 2026-09-28): the old Q5 "worse than before" field
// and ask are gone — it was optional, and an EMPTY answer already meant
// "nothing beyond Guardrails", so it never earned its own turn. `worseThanBefore`
// downstream (confirmPrompt, `accepted.worseThanBefore`) is kept and always
// resolves to `''` — the same value an empty answer always produced — so
// nothing downstream needed to change shape, only the ask itself is gone.

/**
 * Asked ONLY when `src/detectlang.js`'s `detectLanguage` reports its
 * `ambiguous` outcome — two supported languages' manifests at the same
 * (nearest) directory level (M3 ruling 3, point 3). The candidate list is
 * NOT embedded here: it travels with the caller's own `ambiguous` result
 * (`langResult.candidates`), so this module never hand-types a second copy
 * of the supported-language set. An unsupported pick still goes through the
 * existing `language-unsupported` refusal — this field only offers a choice
 * among the candidates `detectLanguage` actually found.
 */
export const LANGUAGE_PICK_FIELD = Object.freeze({
  id: 'language',
  kind: 'mechanical',
  label: 'Language',
  prompt: 'This repo has more than one supported language\'s manifest at the same level. Which one is this job about?',
});

/**
 * F175's open half (docs/wiki/FINDINGS.md, run mu0voeo4), hamr's ruling
 * (2026-09-16): "Confirm" and "Type the goal yourself" may not bypass a
 * `questions` entry the model itself raised on the plan being accepted — the
 * person answers it inline, one question at a time, with NO extra model
 * call (the round cap and D3 are untouched). This is the `field` handed to
 * `ask({kind: 'answer', ...})` for each forced question — `question`,
 * `index` (1-based) and `total` ride alongside on the step itself, not on
 * this frozen constant, because they differ per question within one turn.
 */
export const ANSWER_QUESTION_FIELD = Object.freeze({
  id: 'answerQuestion',
  kind: 'mechanical',
  label: 'Answer',
  prompt: 'The plan raised a question it could not resolve on its own. Answer it before the plan can be signed '
    + '("Start over" or "Fix" are the ways out if you cannot answer it here).',
});

/**
 * THE CONFIRM TURN'S MENU — a structured CHOICE the person picks from after
 * each round, never free text matched against a pattern (ruling 6's "no
 * hand-authored check matcher" reasoning applies here too: the person's own
 * reply is read as one of these four keys, never parsed for intent).
 *   confirm     — sign the plan and the drafted goal sentence as shown.
 *   fix         — free text describing what to change; feeds round r+1, up
 *                 to the 2-round cap (ruling 5); after round 2 a "fix" is
 *                 passed to the composer verbatim and shown at signing as an
 *                 open question rather than spending a 3rd call (D3).
 *   type-goal   — the person's own sentence REPLACES the drafted goal,
 *                 verbatim (redacted); everything else in the plan stands.
 *   start-over  — abandon this confirm turn; the person reruns the
 *                 interview from the beginning (`confirm-restart`).
 * @type {Record<'confirm'|'fix'|'type-goal'|'start-over', string>}
 */
export const CONFIRM_MENU = Object.freeze({
  confirm: 'Confirm — sign this plan and goal as shown',
  fix: 'Fix — describe what to change',
  'type-goal': 'Type the goal sentence yourself',
  'start-over': 'Start over — rerun the interview from the beginning',
});

/**
 * PLAIN-ENGLISH lines for the guards `classGuards` can compose, keyed by
 * guard NAME — frozen beside {@link CONFIRM_MENU} because both are constants
 * the confirm turn shows a person verbatim. One entry per guard that exists
 * in `MECHANICAL_GUARDS` (`src/authoring.js`); {@link confirmProtections}
 * throws if a guard `classGuards` hands back has no line here, so a battery
 * that grows a guard fails loudly instead of showing a blank description.
 * @type {Record<string, string>}
 */
export const GUARD_DESCRIPTIONS = Object.freeze({
  'changed-from-seed': 'the run must actually change at least one file in scope — a close that reports done '
    + 'without touching anything is refused',
  'no-suppressions': 'the run may not silence a checker instead of fixing what it flags (things like @ts-ignore, '
    + 'eslint-disable, or # type: ignore) — none of those may appear in the diff',
});

/**
 * THE REAL PROTECTIONS a person is shown, and what {@link runConfirmTurn}
 * records as `accepted.protections` — fixes finding #1 from live run
 * mu0voeo4 (2026-09-14): the confirm turn used to show whatever prose the
 * MODEL invented for `protections`, and that run's model invented a
 * "behavior-preservation guard" this build cannot check — no kind in the
 * catalogue can verify runtime behaviour, and the author call's own note
 * elsewhere says outright that behaviour-preservation is not composed here.
 * This reads the SAME guards `classGuards` will actually compose into the
 * close — one source, never a second hand-typed list — rendered through the
 * frozen line in {@link GUARD_DESCRIPTIONS}, plus the write fence (a real,
 * signed fence — {@link writeScopeBlock}'s own subject) when one is set.
 * @param {{verdictType: string, lang: string, writeScope?: string[]|null, jobLines?: {n: number}[]|null}} o
 * @returns {string[]}
 */
export function confirmProtections({ verdictType, lang, writeScope = null, jobLines = null }) {
  const guards = classGuards({ verdictType, lang });
  const lines = guards.map((g) => {
    const desc = GUARD_DESCRIPTIONS[g.name];
    if (!desc) {
      throw new Error(`[authorflow] guard "${g.name}" has no line in GUARD_DESCRIPTIONS — every real guard shown to `
        + 'a person needs one, frozen beside CONFIRM_MENU');
    }
    return `${g.name} — ${desc}`;
  });
  if (Array.isArray(writeScope) && writeScope.length > 0) {
    lines.push(`write fence — the run may only change files matching: ${writeScope.join(', ')}`);
  }
  // PART 1a: a rubric job on local files always checks, for EVERY numbered line, that the line's file exists, is complete
  // JSON and has text — a fact of the close's shape (`rubric-step`), not a plan of the model's, so it is listed from code
  if (lang === RUBRIC_LANG && Array.isArray(jobLines)) {
    for (const l of jobLines) lines.push(`line ${l.n} file — ${stepFileRel(l.n)} must exist, be complete JSON, and carry text`);
  }
  return lines;
}

export const AUTHOR_SYSTEM = 'You compose the DEFINITION OF DONE for an automated job: a declaration over a fixed '
  + 'catalogue of stage kinds whose implementations already exist. You never write code, a script, a shell fragment, '
  + 'a new kind, or a new parameter name. You cannot read anything and you cannot run anything: everything you know '
  + 'about this repository is in the message you are given.';

// ── 1. THE SCHEMA, DERIVED FROM THE CATALOGUE ───────────────────────────────

/** `{includePrefixes?, excludePrefixes?}` — one definition, both kinds that take it */
const SCOPE_SCHEMA = Object.freeze({
  type: 'object',
  description: 'which population this stage counts. A path prefix, read off the seed listing.',
  properties: {
    includePrefixes: { type: 'array', minItems: 1, items: { type: 'string' } },
    excludePrefixes: { type: 'array', minItems: 1, items: { type: 'string' } },
  },
  additionalProperties: false,
});

/** the parser, in both legal forms. Enums come from M1's own exported constants. */
const PARSER_SCHEMA = Object.freeze({
  description: 'how to read ONE number out of the command output: the signed sum over terms of '
    + '(first | sum of that term\'s captures, inside that term\'s region).',
  oneOf: [
    {
      title: 'terms',
      type: 'object',
      properties: {
        terms: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_TERMS,
          items: {
            type: 'object',
            properties: {
              lineMatch: { type: 'string', description: 'a regular expression, applied line by line' },
              capture: { type: 'integer', minimum: 0, description: 'which capture group holds the number (default 1). A pattern with NO group tallies 1 per match.' },
              sign: { enum: [...SIGNS], description: '+1 adds this term, -1 subtracts it' },
              aggregate: { enum: [...AGGREGATES], description: '"sum" over nothing is a counted zero; "first" over nothing is UNKNOWN, and unknown is an instrument stop' },
              region: {
                oneOf: [
                  { const: 'whole-output' },
                  {
                    type: 'object',
                    properties: {
                      anchor: { type: 'string' },
                      capture: { type: 'integer', minimum: 0, description: '0 = the whole anchor match' },
                    },
                    required: ['anchor', 'capture'],
                    additionalProperties: false,
                  },
                ],
              },
            },
            required: ['lineMatch', 'sign', 'aggregate', 'region'],
            additionalProperties: false,
          },
        },
      },
      required: ['terms'],
      additionalProperties: false,
    },
    {
      title: 'short form',
      type: 'object',
      description: 'exactly one term with sign +1, aggregate "first", region "whole-output"',
      properties: {
        lineMatch: { type: 'string' },
        capture: { type: 'integer', minimum: 0 },
      },
      required: ['lineMatch'],
      additionalProperties: false,
    },
  ],
});

/**
 * ONE schema per PARAMETER NAME, composed into kinds by the catalogue's own
 * `required`/`optional` lists. Keyed by name rather than by kind on purpose: the
 * catalogue already decides which kind takes which parameter, and a per-kind
 * table would be a second place for that fact to live.
 *
 * What is genuinely NEW here is only the JSON TYPE of each leaf — the catalogue
 * states it as prose (`shape`) for the prompt, and nothing in the tree states it
 * as a schema. Everything a schema could DRIFT on — which kinds exist, which are
 * locked, which parameters each takes, which values an enum admits — is read
 * from M2 and M1, and {@link schemaCoverage} makes the remaining seam mechanical:
 * a catalogue that grows a parameter this table does not know about fails LOUDLY
 * at schema-build time rather than silently omitting it from what the model can
 * say.
 */
export const PARAM_SCHEMAS = Object.freeze({
  cmd: { type: 'string', description: 'the executable, invoked so its binary actually resolves' },
  args: { type: 'array', items: { type: 'string' } },
  expectExit: { type: 'integer' },
  timeoutMs: { type: 'integer', minimum: 1 },
  env: { type: 'object', additionalProperties: { type: 'string' } },
  parser: PARSER_SCHEMA,
  scope: SCOPE_SCHEMA,
  direction: { enum: [...DIRECTIONS] },
  baseline: {
    enum: [...BASELINES],
    description: '"seed" is the same number taken from this run\'s own starting point, measured every run; '
      + '0 is literally zero. You never write a number you measured yourself.',
  },
  patterns: {
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      properties: { id: { type: 'string' }, regex: { type: 'string' } },
      required: ['id', 'regex'],
      additionalProperties: false,
    },
  },
  extensions: { type: 'array', minItems: 1, items: { type: 'string' } },
  allowPrefixes: { type: 'array', minItems: 1, items: { type: 'string' } },
  requireNonEmpty: { const: true },
  // SOFTGREEN's two. `rule` is an ENUM off the judge's own rulebook — where only a
  // closed set can satisfy a field, the illegal value is made inexpressible rather
  // than rejected after the fact (`check-passes(name)`, again) — and `text` is the
  // only free string, carrying the signer's words so a red can be explained in them.
  card: {
    type: 'object',
    description: 'the rubric, as enumerated items: one line per thing the person actually looks for, in the order '
      + 'they look for them. The rule is SELECTED from the arbiter\'s own rulebook; the text is theirs.',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            rule: { enum: [...JUDGE_RULE_IDS], description: 'which owned rule this line asserts' },
            text: { type: 'string', minLength: 1, description: 'what this line means, in the person\'s own words' },
          },
          required: ['rule', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  paths: {
    type: 'array',
    minItems: 1,
    maxItems: MAX_JUDGED_PATHS,
    items: { type: 'string' },
    description: 'the AUTHORITATIVE artifacts to judge, repository-relative, read off the listing. One paid call each.',
  },
  step: { type: 'integer', minimum: 1, description: 'the number of the job line this stage serves; its file is output/steps/<step>.json' },
  parts: {
    type: 'array',
    description: 'every constraint the person put on that job line, in their own words, each SORTED: countable (a machine counts it, or a '
      + 'quote from a named input must back it), judged (only reading it could decide), guard (a rule about web sources), none (you cannot sort it)',
    items: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, description: 'the constraint, in the person\'s own words' },
        class: { enum: ['countable', 'fact', 'judged', 'guard', 'none'] },
        check: { enum: ['cited', 'minClaims', 'maxClaims'], description: 'countable only; minClaims / maxClaims count the claims listed under the input named in source' },
        value: { type: 'integer', minimum: 1, description: 'minClaims / maxClaims: the number of claims asked for' },
        source: { type: 'string', minLength: 1, description: 'cited: the label of the input a quote must come from' },
        domains: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'guard only: the web domains the rule is about' },
        rules: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'integer', minimum: 1 }, description: 'the number(s) of the job line\'s ~ rules this part carries out (1 = the first ~ rule under the line)' },
        facts: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description: 'fact only: the REQUIRED FACTS every result must hold, one per thing the person asked for (from the job line AND its ~ rules)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, description: 'what the fact is called: letters and spaces only, no digits' },
              shape: { enum: ['money', 'number', 'date', 'time', 'phrase', 'text'], description: 'money / number / date / time may carry a rule; phrase = fixed words the quote must contain; text = words the quote holds, as it writes them' },
              unit: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 1 } }], description: 'money: the words the input writes after the amount, copied verbatim - one, or a list of up to 10 (give unit, currency, or both)' },
              currency: { anyOf: [{ enum: ['$', '€', '£'] }, { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ['$', '€', '£'] } }], description: 'money: the symbol the input writes before the amount - one, or a list of up to 3 (give unit, currency, or both)' },
              phrase: { type: 'string', minLength: 1, description: 'phrase only: the fixed words, copied verbatim from the input' },
              anchor: { type: 'string', minLength: 1, description: 'a label copied VERBATIM from the input that sits right before the value (picks the right one when a result holds several)' },
              until: { type: 'string', minLength: 1, description: 'text with an anchor: the label copied VERBATIM that ends the value' },
              rule: {
                type: 'object',
                description: 'only when the person asked for a limit',
                properties: {
                  op: { enum: ['lt', 'lte', 'gt', 'gte', 'between'] },
                  value: { type: ['number', 'string'], description: 'a number for number/money; a string for date (YYYY-MM-DD) / time (HH:MM)' },
                  lo: { type: ['number', 'string'] },
                  hi: { type: ['number', 'string'] },
                },
                required: ['op'],
                additionalProperties: false,
              },
              aiProposal: { type: 'boolean', description: 'true when the rule\'s number is YOURS (made out of the person\'s words), not one the person wrote' },
              lang: { enum: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl'], description: 'date only: the language the input writes the month name in; leave it out for a date written 2026-10-26. Copy it from the look' },
              decimal: { enum: ['.', ','], description: 'number or money only: the mark the input writes before the decimals; leave it out for "." Copy it from the look' },
            },
            required: ['name', 'shape'],
            additionalProperties: false,
          },
        },
        count: {
          type: 'object',
          description: 'fact only: how many results the person asked for',
          properties: { min: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1 } },
          additionalProperties: false,
        },
      },
      required: ['text', 'class'],
      additionalProperties: false,
    },
  },
  ask: {
    type: 'string',
    minLength: 1,
    description: 'the plain question the person answers while looking at the finished result. They see it verbatim, '
      + 'so write what they are DECIDING — never a bare "approve?".',
  },
});

/**
 * The mechanical seam between the catalogue and the schema, read BOTH ways: a
 * catalogue parameter with no schema would be silently undeclarable, and a schema
 * entry the catalogue does not have is a second catalogue.
 * @param {Record<string, any>} [catalogue]
 * @returns {{ok: boolean, missing: string[], orphan: string[]}}
 */
export function schemaCoverage(catalogue = KIND_CATALOGUE) {
  /** @type {string[]} */ const missing = [];
  /** @type {Set<string>} */ const used = new Set();
  for (const [kind, spec] of Object.entries(catalogue)) {
    if (spec.locked) continue;
    for (const p of [...spec.required, ...spec.optional]) {
      used.add(p);
      if (!Object.hasOwn(PARAM_SCHEMAS, p)) missing.push(`${kind}.${p}`);
    }
  }
  const orphan = Object.keys(PARAM_SCHEMAS).filter((p) => !used.has(p));
  return { ok: missing.length === 0 && orphan.length === 0, missing, orphan };
}

/**
 * THE DECLARATION SCHEMA — the tool's input schema, and therefore the whole
 * shape a model can express.
 *
 * One `oneOf` branch per LIVE kind, each pinning its own `kind` as a const so a
 * parameter set cannot drift onto the wrong kind. A LOCKED kind gets no branch at
 * all: declaring one is inexpressible here rather than rejected afterwards (see
 * the header for what that costs).
 *
 * It enforces STRUCTURE, not LAW. The stage-name slug rule, the one-population
 * law, the listing rule, F49's regex reject and the D5 guard equality are M2's,
 * and they arrive as validation reds through the revise loop — a schema that
 * tried to restate them would be a second validator.
 *
 * `verdictType` narrows the branches to the kinds the picked class may express
 * (softgreen module 3, `classMenu`): a green job cannot SPELL `judged-floor`,
 * rather than spelling it and being told afterwards. COVERAGE is still computed
 * over the WHOLE catalogue — the class filter must never make a parameter look
 * orphaned and turn a menu narrowing into a catalogue-drift alarm.
 *
 * THROWS on a catalogue it cannot cover: a malformed catalogue is a bareloop bug,
 * and failing loudly beats emitting a schema that quietly cannot say something
 * the validator will then demand.
 * `questions` (P7 item 5, last drafting try only) adds the optional `questions` property; absent, the schema is byte-identical.
 * `kinds` (Part 1a) narrows the branches to the kinds a language may use (`catalogueForLang`) WITHOUT narrowing the coverage check,
 * which stays over the whole catalogue; null (the default) = no narrowing.
 * @param {Record<string, any>} [catalogue]
 * `ticket` (MCP + tickets piece 2) adds the optional top-level `ticketFilter` property for a job that reads tickets; absent, the schema is byte-identical.
 * @param {{verdictType?: string|null, questions?: boolean, kinds?: string[]|null, ticket?: boolean}} [o]
 */
export function declarationSchema(catalogue = KIND_CATALOGUE, { verdictType = null, questions = false, kinds = null, ticket = false } = {}) {
  const cov = schemaCoverage(catalogue);
  if (!cov.ok) {
    throw new Error('[authorflow] the declaration schema does not cover the catalogue — '
      + `missing: ${cov.missing.join(', ') || 'none'}; orphaned: ${cov.orphan.join(', ') || 'none'}`);
  }
  const menu = classMenu(verdictType, catalogue);
  const branches = Object.entries(catalogue)
    .filter(([kind, spec]) => !spec.locked && menu.includes(kind) && (kinds === null || kinds.includes(kind)))
    .map(([kind, spec]) => {
      /** @type {Record<string, any>} */
      const properties = {};
      for (const p of [...spec.required, ...spec.optional]) properties[p] = PARAM_SCHEMAS[/** @type {keyof typeof PARAM_SCHEMAS} */ (p)];
      return {
        title: kind,
        description: spec.asserts,
        type: 'object',
        properties: {
          name: { type: 'string', description: 'a unique lowercase-hyphenated slug saying what this stage asserts' },
          fromLine: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'integer', minimum: 1 }, description: 'the numbers of the job line(s) this stage checks, e.g. [1] or [1, 3] (absent on a mandatory guard)' },
          kind: { const: kind },
          params: { type: 'object', properties, required: [...spec.required], additionalProperties: false },
        },
        required: ['name', 'kind', 'params'],
        additionalProperties: false,
      };
    });

  return {
    type: 'object',
    properties: {
      stages: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_STAGES,
        description: 'the close, in FIRST-RED-WINS order — the first red ends the judgement',
        items: { oneOf: branches },
      },
      notes: {
        type: 'array',
        // minLength 1 for the standing reason: where only a closed set (here,
        // "a string that says something") can satisfy a field, the illegal value
        // is made INEXPRESSIBLE rather than rejected after the fact. The
        // validator reds an empty note either way — this stops it being written.
        items: { type: 'string', minLength: 1 },
        description: 'anything you could not express, or any fact you needed and did not have',
      },
      refused: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            line: { type: 'integer', minimum: 1, description: 'the number of a job line no stage checks' },
            rule: { type: 'integer', minimum: 1, description: 'optional: the number of ONE ~ rule of that line that nothing checks (the line itself still has a stage)' },
            reason: { type: 'string', minLength: 1, description: 'why, in plain words the person can read' },
          },
          required: ['line', 'reason'],
          additionalProperties: false,
        },
        description: 'job lines (or single ~ rules of a line) you could not turn into a check, each with a reason in the person\'s words — a note does not cover a line or a rule',
      },
      guardLines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            guard: { type: 'string', minLength: 1, description: 'the name of a mandatory guard stage' },
            lines: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'integer', minimum: 1 }, description: 'the number(s) of the job line(s) that guard already checks' },
          },
          required: ['guard', 'lines'],
          additionalProperties: false,
        },
        description: 'optional: which job lines the always-on guards already cover (a line whose every ask a mandatory guard checks needs no stage of its own)',
      },
      ...(ticket ? {
        ticketFilter: {
          type: 'object',
          properties: {
            priority: { type: 'array', items: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, description: 'priorities a ticket must have; only when a job line names them' },
            labels: { type: 'array', items: { type: 'string' }, description: 'label names, one of which a ticket must carry; only when a job line names them' },
          },
          additionalProperties: false,
          description: TICKET_FILTER_SCHEMA_WORDS,
        },
      } : {}),
      ...(questions ? {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { line: { type: 'integer', minimum: 1 }, question: { type: 'string', minLength: 1 } },
            required: ['line', 'question'],
          },
          description: QUESTIONS_DESCRIPTION,
        },
      } : {}),
    },
    required: ['stages'],
    additionalProperties: false,
  };
}

/**
 * The output channel. It records and acknowledges; it takes no action, which is
 * why handing it to a toolless authoring call does not reopen D3.
 * @param {{calls: any[]}} box
 * @param {{catalogue?: Record<string, any>, verdictType?: string|null, questions?: boolean, kinds?: string[]|null, ticket?: boolean}} [o]
 */
export function declarationTool(box, { catalogue = KIND_CATALOGUE, verdictType = null, questions = false, kinds = null, ticket = false } = {}) {
  return {
    name: DECLARATION_TOOL_NAME,
    description: 'Deliver the finished close. Call this exactly once, with the whole declaration as its arguments.',
    parameters: declarationSchema(catalogue, { verdictType, questions, kinds, ticket }),
    execute: async (/** @type {any} */ args) => { box.calls.push(args); return DECLARATION_ACK; },
  };
}

// ── 2. THE PROMPT ────────────────────────────────────────────────────────────

/**
 * The catalogue, as the authoring call sees it — rendered FROM the catalogue, so
 * the prompt and the validator judge one set of facts. `shape` and `asserts` are
 * M2's own strings.
 *
 * `verdictType` narrows it to the picked class's menu, exactly as it narrows the
 * schema — the prompt and the tool must offer ONE set of kinds, or the composer
 * reads about a kind it cannot call. A kind above the ceiling is omitted rather
 * than rendered as unavailable: a LOCKED row says "this does not run in v1",
 * which is a fact about the build; "not for your class" is a fact about a choice
 * the person already made, and printing it invites the composer to argue with it.
 * @param {Record<string, any>} [catalogue]
 * @param {{verdictType?: string|null}} [o]
 */
export function catalogueBlock(catalogue = KIND_CATALOGUE, { verdictType = null } = {}) {
  const menu = classMenu(verdictType, catalogue);
  const rows = Object.entries(catalogue).filter(([name]) => menu.includes(name)).map(([name, spec]) => (spec.locked
    ? `- ${name}  — LOCKED. Not available in v1; it will not run.`
    : `- ${name}\n    ${spec.shape}\n    required: ${spec.required.join(', ')}`
      + `${spec.optional.length ? `   optional: ${spec.optional.join(', ')}` : ''}\n    asserts: ${spec.asserts}`));
  return `THE KIND CATALOGUE — these are the only kinds that exist.
You parameterise kinds. You never write a script, a shell fragment, or a new kind.

${rows.join('\n')}

THE PARSER reads ONE number out of a command's output, as signed arithmetic over terms:

    value  =  the sum over terms of   sign x (first | sum of that term's matches, inside its region)

  lineMatch   a regular expression, applied to the output line by line.
  capture     which capture group holds the number (default 1). A pattern with NO capture group
              contributes 1 per match — that is how you TALLY occurrences instead of reading a
              figure the tool printed.
  aggregate   ${AGGREGATES.join(' | ')}. "sum" over nothing is a counted zero. "first" over nothing
              means the number was never reported, which is a broken instrument, not a zero.
  region      "whole-output", or {anchor, capture} to search only inside the part of the output the
              anchor locates. A region that cannot be located is a broken instrument.
  sign        ${SIGNS.join(' | ')}. Subtraction is how you exclude things that were reported but did
              not actually happen.

To count lines about one file or folder, keep lineMatch general (match the error line itself, e.g.
"error TS\\d+") and put the file or folder in scope.includePrefixes. Never put a file path inside
lineMatch or inside a region anchor: once that file is clean the command still fails on other files,
nothing matches, and the check stops as a broken instrument instead of reading zero.

    {"kind": "count-not-worse", "params": {"cmd": "npm", "args": ["run", "typecheck", "--", "--strict"],
      "parser": {"terms": [{"lineMatch": "error TS\\\\d+", "capture": null, "sign": 1, "aggregate": "sum", "region": "whole-output"}]},
      "scope": {"includePrefixes": ["src/target.js"]}, "direction": "lower-is-better", "baseline": 0}}`;
}

/**
 * HOW THE GENRE'S OWN TOOLS PRINT — rendered FROM `genreInstruments`, so the
 * pattern the author is handed and the pattern the tree already grades with are
 * one string.
 *
 * This block is the fix for run msmbpjk6: a parser for a tool WE OWN THE FACTS
 * ABOUT was left to the model to compose, and it composed tsc's terminal-only
 * shape against piped output — 0 matches on 67 real error lines. The delivery is
 * deliberately the MANDATORY-GUARD delivery, not advice: the pattern arrives
 * spelled out, marked genre property, with the real captured line beside it, in
 * the same register as the guard battery that arrives already parameterised.
 *
 * It states the MECHANISM (pipe, not a terminal) rather than only the answer,
 * because the same trap is waiting behind every tool that pretty-prints for a
 * human, and only some of them are in the table yet. That prediction has since
 * been paid off by measurement: `node --test` prints TAP down a pipe and the
 * spec reporter on a terminal, the identical flip, on a second tool.
 *
 * Each row also carries its `capture`, because a count term and a tally term are
 * read by DIFFERENT aggregates and the wrong pairing is a silent misreading, not
 * an error — `first` over a line the tool omits on a good run reports a broken
 * instrument. The block states that mapping once rather than per row.
 * @param {string} lang
 */
export function instrumentsBlock(lang) {
  const rows = genreInstruments(lang).map((i) => `- ${i.id} — ${i.what}\n`
    + `    lineMatch: ${i.lineMatch}\n`
    + `    capture: ${i.capture === null ? 'null' : i.capture}\n`
    + `    a REAL captured line: ${i.example}\n`
    + `    why this spelling: ${i.why}`);
  return `KNOWN INSTRUMENTS — how this genre's own tools PRINT, fixed by the genre, not yours to decide

A close captures output through a PIPE, never a terminal. Tools that pretty-print for a human
print something else entirely down a pipe, and the piped shape is the only one a close ever reads.
The patterns below are MEASURED against real captured output of this genre's tools.

Where a stage of yours counts one of these, use its lineMatch EXACTLY as written — a pattern you
compose yourself for one of these tools is a pattern for output that never arrives, and a term that
matches nothing does not report a small number, it reports a broken instrument.

Each row states its own capture, and that choice decides the aggregate:
  capture: null   the term TALLIES one per matching line. Use aggregate "sum" — over no matching
                  lines that is a legitimate counted zero.
  capture: <n>    the term reads the FIGURE the tool printed, out of that group. Use aggregate
                  "first" — and note that no match at all then means the tool never reported the
                  number, which is a broken instrument, never a zero. A count is listed this way
                  only where the tool prints the line even when the number is zero.

${rows.join('\n\n')}

This covers only the tools listed. For anything else, you still compose the pattern yourself from
the facts object — and say in your notes when you had to.`;
}

/** The three laws. Stated to the author; enforced, where checkable, by M2. */
export function lawsBlock() {
  return `THE LAWS YOUR DECLARATION MUST OBEY

1. ONE POPULATION PER STAGE.
   A stage name owns exactly one population of things being counted or checked. Two structurally
   different counts never share a stage name, because their results land in one trend series and a
   run that merely swapped one wall for another then reads as progress. Every counting stage over a
   job that touches only part of the tree must say WHICH population it counts: its scope carries
   includePrefixes or excludePrefixes. A scope object with neither names nothing.

2. FIRST RED WINS — order cheap before expensive.
   Stages run in the order you declare them and the first red ends the judgement. Put the cheap,
   fast, structural stages first so they shield the slow ones.

3. MECHANICAL FIRST.
   Every assertion that CAN be a command IS a command. Nothing is left to judgement, to prose, or to
   a person. If you cannot express something with the kinds above, leave it out and say so in your
   notes — do not approximate it with a stage that means something else.

4. EVERY PATH IS SELECTED, NEVER INVENTED.
   Any path you write down must appear in the seed file listing above. A file is not called what it
   sounds like it should be called.`;
}

/**
 * WHAT MAY CHANGE, AND WHAT IS ONLY READ — replaces the old Q2 (PRD item 33 M3
 * piece 3). Q2 used to ask the person, in prose, which files change and which
 * are read-only; that decision is now Destination, PROVEN against the
 * repository rather than typed (`docs/product/ITEM33-BUILD.md` "M3", ruling 2),
 * and for a repo source Destination's answer IS the signed `writeScope` fence.
 * This states that fact to the composer instead of letting it vanish along
 * with Q2 — the same "nothing the composer received before may silently
 * disappear" rule `applyGenreEnv` already keeps for a dropped env var.
 *
 * THROWS on an empty `writeScope`: Destination is a MANDATORY fence
 * (`run-interview.mjs` refuses an empty answer at capture), so a caller
 * reaching this with nothing to state is a bareloop wiring bug, not a job with
 * no fence — a composer told it may change everything guards nothing.
 * @param {string[]} writeScope
 */
export function writeScopeBlock(writeScope) {
  if (!Array.isArray(writeScope) || writeScope.length === 0) {
    throw new Error('[authorflow] writeScopeBlock needs a non-empty writeScope — Destination is the fence and a '
      + 'composer call with nothing to state is a bareloop wiring bug, not a job authored with no fence');
  }
  return `WHAT MAY CHANGE, AND WHAT IS ONLY READ\n\n`
    + 'The person\'s own Destination answer is a write fence, proven against the repository rather than typed as '
    + 'prose. You may only change files matching one of these patterns:\n\n'
    + `${writeScope.map((p) => `  - ${p}`).join('\n')}\n\n`
    + 'Everything else in the facts object and the listing below is READ-ONLY: you may look at it, and any command '
    + 'you run may read it, but no stage you declare may write, move or delete it.';
}

/**
 * THE CONFIRMED-PLAN BLOCK (PRD item 33 M3 piece 4) — present only when the
 * person already ran a confirm turn (`runConfirmTurn`'s `accepted`). States
 * the composition law as an ORDER over the ACCEPTED checks, exactly the
 * pattern {@link writeScopeBlock} already is for the fence: "compose these
 * checks and no other" rather than a code matcher over the goal prose
 * (ruling 6). Protections are restated as unchanged, never as checks to add.
 * Open questions the person's own fix rounds left unresolved (D3) are named
 * so the composer states them in notes rather than silently deciding them.
 * `notChecked` (fix #1, run mu0voeo4) is anything the person asked for that
 * no listed check can verify — shown so the composer names the gap in its
 * own notes rather than the plan quietly reading as if everything asked for
 * is covered.
 * `answeredQuestions` (F175's open half, run mu0voeo4, hamr's 2026-09-16
 * ruling) is every `Q:/A:` pair the person answered inline when a "Confirm"
 * or "Type the goal yourself" pick forced a raised question before
 * acceptance — BINDING, never re-decided by the composer, and a DIFFERENT
 * meaning from `openQuestions` (which means "could not resolve"): the two
 * never merge.
 * @param {{checks: string[], checkItems?: {text: string, fromLine: number[]|null}[], protections: string[], openQuestions?: string[], notChecked?: string[],
 *   answeredQuestions?: string[], goalOnly?: boolean}} confirmed
 */
export function confirmedBlock(confirmed) {
  const checks = confirmed.checks ?? [];
  const protections = confirmed.protections ?? [];
  const openQuestions = confirmed.openQuestions ?? [];
  const notChecked = confirmed.notChecked ?? [];
  const answeredQuestions = confirmed.answeredQuestions ?? [];
  // a rubric job's confirm turn plans the goal only (its checks are the list's): no check list and no "the person confirmed" text
  if (confirmed.goalOnly === true) {
    return 'ALWAYS-ON PROTECTIONS \u2014 already enforced by this run and unchanged by the job; never compose one of these as a check:\n\n'
      + `${protections.map((p) => `  - ${p}`).join('\n') || '  (none)'}\n`
      + (notChecked.length ? `\nTHESE WERE ASKED FOR, BUT NOTHING CHECKS THEM (state these in your notes):\n\n${notChecked.map((n) => `  - ${n}`).join('\n')}\n` : '')
      + (answeredQuestions.length ? `\nQUESTIONS THE PERSON ANSWERED \u2014 binding:\n\n${answeredQuestions.map((a) => `  - ${a}`).join('\n')}\n` : '')
      + (openQuestions.length ? `\nOPEN QUESTIONS (state these in your notes, never decide them silently):\n\n${openQuestions.map((q) => `  - ${q}`).join('\n')}\n` : '');
  }
  return 'THE CONFIRMED PLAN — the person already saw and confirmed this in the confirm turn\n\n'
    + 'Compose stages for these checks and no other — a genre never adds a check the goal did not ask for, and '
    + 'neither do you:\n\n'
    + `${(confirmed.checkItems?.length
      ? confirmed.checkItems.map((c) => `  - ${c.fromLine && c.fromLine.length ? `[line ${c.fromLine.join(', ')}] ` : ''}${c.text}`)
      : checks.map((c) => `  - ${c}`)).join('\n') || '  (none)'}\n\n`
    + 'These protections are already always-on and unchanged by this plan — never compose one of these as a check:\n\n'
    + `${protections.map((p) => `  - ${p}`).join('\n') || '  (none)'}\n\n`
    + (notChecked.length
      ? 'THE PERSON ASKED FOR THESE, BUT NOTHING CHECKS THEM (state these in your notes — never silently claim they '
        + `are covered):\n\n${notChecked.map((n) => `  - ${n}`).join('\n')}\n\n`
      : '')
    + (answeredQuestions.length
      ? `QUESTIONS THE PERSON ANSWERED — these answers are binding; compose to them, never re-decide them:\n\n${answeredQuestions.map((a) => `  - ${a}`).join('\n')}\n\n`
      : '')
    + (openQuestions.length
      ? `OPEN QUESTIONS the confirm turn could not resolve (state these in your notes, never decide them silently):\n\n${openQuestions.map((q) => `  - ${q}`).join('\n')}`
      : 'The confirm turn left no open questions.');
}

/**
 * P7: the job-line tagging order (model-facing, registered). Rule 1 of the job block: every stage the drafter writes
 * names the ONE numbered job line it serves, or the line is refused with a reason; the mandatory guards serve no line.
 * The $0 validator (validateDeclaration, `jobLines`) enforces it and the revise loop feeds a miss back.
 * @param {number} count how many numbered job lines the person wrote
 * @param {string[]} [guardNames] the mandatory guards' names; present = the block also tells how a line they already cover is covered
 */
export function jobLineTagBlock(count, guardNames = []) {
  return 'EVERY STAGE SERVES ONE JOB LINE\n\n'
    + `The person's job has ${count} numbered line${count === 1 ? '' : 's'} (the interview above). Tag every stage YOU write `
    + 'with "fromLine": [N, ...] — the number(s) of the job line(s) that stage checks (one stage may serve several lines, e.g. a judged stage that reads lines 1-3). A job line that no kind in the catalogue '
    + 'can check is not left out silently: list it in "refused" as {"line": N, "reason": "..."}, with a reason in plain '
    + 'words the person can read. Every numbered line needs at least one stage or one refusal — a note in "notes" does '
    + 'NOT cover a line. The mandatory guards serve no job line and carry NO "fromLine".'
    + (guardNames.length
      ? '\n\nA job line whose every ask the always-on checks (the mandatory guards) already do needs no stage of its own and no refusal: '
        + 'name the guard(s) that do it in "guardLines", beside "stages" — for example {"guardLines": [{"guard": "' + guardNames[0] + '", "lines": [N]}]}. '
        + 'Never write a second stage that repeats a guard, and keep "refused" for a line nothing can check.'
        + '\n\nTHE ALWAYS-ON CHECKS ALREADY EXIST in this close, in plain words: ' + guardNames.map((n) => n + ' (' + (GUARD_DESCRIPTIONS[n] ?? n) + ')').join('; ')
        + '; and the write fence (changes stay inside the write scope). They are already among the guard stages you were given — keep those exactly as given, and NEVER declare any of them again as a stage of your own — '
        + 'no second files-changed or scope stage, and no stage that adds scope or params to the suppression guard. A job line they already cover '
        + '(for example "Fix the cause in the source code under src/" with the rule "no suppression comments") is linked to them with "guardLines", '
        + 'not given a stage and not refused. Legal example for a two-line job whose line 1 is a test run and whose line 2 is covered by the guards: '
        + '{"stages": [{"name": "suite-green", "kind": "command-exit", "fromLine": [1], "params": {"cmd": "npm", "args": ["test"], "expectExit": 0}}], '
        + '"guardLines": [{"guard": "' + guardNames[0] + '", "lines": [2]}' + (guardNames[1] ? ', {"guard": "' + guardNames[1] + '", "lines": [2]}' : '') + ']} — '
        + 'line 2 has no stage of its own and is not refused.'
      : '');
}

/**
 * The whole authoring prompt, as one string.
 *
 * Two people fed this brief and neither of them is the model: a person who is not
 * a software engineer answered an interview, and a read-only survey produced the
 * facts. The prompt says so, because round 1 measured what happens when a model
 * treats a lay answer as a specification.
 *
 * `verdictType` is REQUIRED and has no default. It is the user's own answer and
 * the one thing that tells the composer what DONE is allowed to mean here; a
 * defaulted class would be the prompt answering a question the user was asked.
 *
 * `writeScope` carries what the old Q2 used to (PRD item 33 M3 piece 3): Q2 is
 * gone from the numbered interview, so what may change and what is read-only
 * reaches the composer through {@link writeScopeBlock} instead, fed from
 * Destination's own proven fence — never silently dropped.
 *
 * @param {{answers: Record<string|number, string>, questions?: Record<string|number, string>,
 *   facts: any, listingBlock: string, lang: string, verdictType: string,
 *   guards: {name: string, kind: string, params: Record<string, any>, fill: string[]}[],
 *   ownedEnvNames?: string[], mode?: 'tool'|'text', catalogue?: Record<string, any>|null,
 *   writeScope?: string[]|null,
 *   jobLines?: {n: number}[]|null, inputs?: {n: number, label: string, value: string}[]|null,
 *   confirmed?: {checks: string[], checkItems?: {text: string, fromLine: number[]|null}[], protections: string[], openQuestions?: string[], notChecked?: string[], answeredQuestions?: string[]}|null,
 *   labelLists?: string[]|null,
 * }} o
 */
export function authorPrompt({
  answers, questions = GREEN_QUESTIONS, facts, listingBlock, lang, verdictType, guards,
  ownedEnvNames = [], mode = 'tool', catalogue: catalogueIn = null, writeScope = null,
  // P7: the person's numbered job lines and the inputs they pointed at. ABSENT = byte-identical prompt (every caller
  // that predates the job block). Present: the drafter is told to tag every stage it writes with the line it serves.
  jobLines = null, inputs = null,
  // PRD item 33 M3 piece 4: ABSENT for every caller that predates the confirm
  // turn (or ran without `ask`) — byte-identical prompt, nothing added. Present
  // only when a confirm turn actually ran and the person accepted a plan.
  confirmed = null,
  // PART 1c: the label lists code made from the frozen inputs (src/labelscan.js `renderLabelList`); a label is picked from them
  labelLists = null,
}) {
  // PART 1a: a rubric job on the person's own local files has no repository, no genre template and no tool to measure with —
  // it gets its own brief (`rubricAuthorPrompt`), which still ends in the same declaration tool and the same guards
  // an absent catalogue is the language's own menu (`catalogueForLang`), so a code job's prompt never lists a rubric-only kind
  const catalogue = catalogueIn ?? catalogueForLang(lang);
  const statement = CLASS_STATEMENTS[String(verdictType)] ?? null;
  if (statement === null) {
    throw new Error(`[authorflow] the authoring prompt needs the verdict class the user picked, and "${verdictType}" `
      + `composes nothing here — v1 composes ${Object.entries(CLASS_STATEMENTS).filter(([, v]) => v).map(([k]) => k).join(', ')} only`);
  }
  // The signed table's own label for each key (PRD item 33 M3 piece 3's wording
  // fix), shown beside the question so the composer reads the same Field/Holds
  // pairing a person sees at the terminal. `verdictType` is already checked
  // against `CLASS_STATEMENTS` above and that set's keys are exactly
  // `QUESTION_SETS`'s, so `labelsFor` cannot throw here. A key with no label
  // (hitl's own fourth question has no signed-table row) is shown with none.
  const labels = labelsFor(String(verdictType));
  const interview = Object.entries(questions)
    .map(([n, q]) => `Q${n}${labels[n] ? ` (${labels[n]})` : ''}. ${q}\nA${n}. ${answers?.[n] ?? '(no answer given)'}`)
    .join('\n\n');

  const role = `You are composing the close for one job.

The close is what decides whether a run of this job came back DONE. It runs after the work is
finished, it is the only truth, and nothing else can overrule it. It is a list of STAGES. Each
stage names a kind from the catalogue below and fills that kind's parameters. Stages run in the
order you declare them.

Two people fed you this brief and neither of them is you:
 - the person who wants the job done answered an interview, below, in their own words. They are
   not a software engineer. They did not name commands, thresholds or patterns, and you must not
   assume they know what any of those would be;
 - a read-only survey of their repository produced the facts object, below. It is the only thing
   you know about the repository. If a fact you need is not in it, say so in your notes rather
   than inventing it.`;

  // The guards arrive FULLY PARAMETERISED — the battery and its scope are genre
  // property (addendum 6). Only a declared `fill` slot is the model's, and it is
  // marked. Round 3's arm A narrowed a guard's scan and called it stricter.
  const guardJson = guards.map((g) => ({
    name: g.name,
    kind: g.kind,
    params: { ...g.params, ...Object.fromEntries(g.fill.map((f) => [f, FILL_MARKER])) },
  }));

  const envLine = ownedEnvNames.length
    ? `\n\nThis job's genre sets ${ownedEnvNames.join(', ')} for you, from facts you were not given. `
      + 'Do not declare any of those variables yourself — a declaration that sets one is rejected.'
    : '';

  const output = mode === 'tool'
    ? `HOW TO ANSWER

Call the ${DECLARATION_TOOL_NAME} tool exactly once. Its arguments ARE the declaration: an ordered
"stages" array, plus "notes" for anything you could not express or any fact you needed and did not
have. Do not write the declaration as text.

Stage names are unique. Every parameter name comes from the catalogue and no other. No parameter is
left as a placeholder. You never write a threshold number you measured yourself, because you cannot
measure anything.`
    : `HOW TO ANSWER

A single JSON object and nothing else: an ordered "stages" array, plus "notes" for anything you
could not express or any fact you needed and did not have.

Stage names are unique. Every parameter name comes from the catalogue and no other. No parameter is
left as a placeholder. You never write a threshold number you measured yourself, because you cannot
measure anything.`;

  return [
    role,
    // WHERE GENRE UNDERSTANDING LIVES NOW (PRD v1.57 §2). The interview no longer
    // asks what KIND of job this is; the person answered what DONE means, and the
    // composer reads that plus the catalogue and works the rest out.
    `WHAT THE PERSON DECLARED "DONE" TO MEAN — their answer, not yours\n\n${statement}`,
    `THE INTERVIEW — the person's own words\n\n${interview}`
      + (inputs && inputs.length ? `\n\n${renderInputs(inputs)}` : ''),
    ...(jobLines && jobLines.length ? [jobLineTagBlock(jobLines.length, guards.map((g) => g.name))] : []),
    // Q2 IS GONE (PRD item 33 M3 piece 3) — what it used to carry (which files
    // change, which are read-only) is proven against the machine now, not typed,
    // and this is where that proof reaches the composer instead of vanishing.
    ...(writeScope && writeScope.length ? [writeScopeBlock(writeScope)] : []),
    ...(confirmed ? [confirmedBlock(confirmed)] : []),
    `THE FACTS OBJECT — from a read-only survey of the repository\n\n${JSON.stringify(facts, null, 2)}`
      + (listingBlock ? `\n\n${listingBlock}` : ''),
    // CLASS-SCOPED (softgreen module 3): the composer for a green job is never
    // shown a kind whose pick would red as `class-ceiling` after the call.
    catalogueBlock(catalogue, { verdictType }),
    lawsBlock(),
    `THE GENRE TEMPLATE — fixed by the job's genre (${lang}), not yours to decide\n\n`
      + 'This job\'s genre carries a fixed close SHAPE. The following policy is law for your declaration. It names\n'
      + 'no command, no path, no environment value and no pattern for this repository — finding those is your work,\n'
      + `from the facts object and the interview:\n\n${TYPES_GENRE_TEMPLATE}`,
    // The template deliberately names no regex for this repository — but the
    // shape a KNOWN tool prints is not "for this repository", it is a fact about
    // an instrument the genre already owns and already grades with. It sits here,
    // immediately after the policy that mandates the typecheck stage.
    instrumentsBlock(lang),
    'MANDATORY GUARDS — already placed and already parameterised\n\n'
      + 'This kind of job carries stages the person did not ask for. They are fixed by the job\'s genre and they are\n'
      + 'already in your declaration, with their pattern battery and extensions already filled in — those are genre\n'
      + `property and you may not change, drop, rename, or re-kind them. The ONLY thing you fill in is each\n`
      + `"${FILL_MARKER}" slot, from the facts object and the interview:\n\n${JSON.stringify(guardJson, null, 2)}\n\n`
      + 'Place them where the ordering law says they belong, and author the remaining stages around them.'
      + envLine,
    output,
  ].join('\n\n---\n\n');
}

/**
 * What a rubric job on local files means by DONE — the class statement of the text genre (Part 1a). It is stated as an order
 * about KINDS: every part of a job line is counted or checked against a quote, because nothing in this build judges.
 */
export const RUBRIC_FILES_STATEMENT = 'The person declared this job SOFT-GREEN and pointed it at their own text files: the work is writing '
  + 'about those files. This build has no judge, so every part of a job line must be one of three things. COUNTED: a limit on words, '
  + 'sections or lines of what is written. Or a REQUIRED FACT: something the line finds, lists or looks up, each answer quoted word for '
  + 'word from a named input and checked by its shape (money, number, date, time, phrase, text). Or BACKED BY A QUOTE: a claim that '
  + 'must carry words copied from a named input. '
  + 'Compose ONE rubric-step stage per numbered job line, after the mandatory guard, and name only limits the person actually '
  + 'asked for. A part you cannot express that way is not approximated by a stage that means something else.';

// ── 3. THE MEASURED BLOCKS ───────────────────────────────────────────────────

/** F6, at the rendering boundary: an absent number is unknown, never 0. */
const show = (/** @type {any} */ v) => (v === null || v === undefined ? 'unknown' : String(v));

/**
 * The seed read, as the model sees it: mechanical labels, no editorial. Per-stage
 * gap capped with the trim ANNOUNCED (F28 — a bound that eats the failure names
 * deletes exactly the mechanical detail that converts).
 *
 * SCRUBBED at the emission boundary. What this block renders is raw subprocess
 * output (gap lines, an instrument stop carrying a command's stderr) and it
 * becomes the next USER TURN sent to the provider — the surface most likely to
 * carry a real credential, crossing the network. It goes through the ONE shared
 * redactor, the same one `askDeclaration` puts the model's own text through and
 * the same one `declaredclose`/`authorjob` put these very fields through; never
 * a second inventory. Applied to the whole rendered block rather than one field,
 * so a line added here is scrubbed by construction.
 * @param {any[]} rows M1 `StageResult[]`
 * @param {{gapCap?: number}} [o]
 */
export function renderSeedReadBlock(rows, { gapCap = REVISE_GAP_CAP } = {}) {
  const lines = ['MEASURED SEED-READ — every stage of your declaration was executed against the repository at the seed:'];
  for (const r of rows ?? []) {
    lines.push('', `stage "${r.stage}" [${r.kind}]`);
    lines.push(`  verdict: ${r.verdict} · exit code: ${show(r.exitCode)}`);
    if (r.value !== null && r.value !== undefined) {
      lines.push(`  value: ${show(r.value)} · baseline: ${show(r.baseline)}`
        + `${r.baselineSource ? ` (baseline ${r.baselineSource})` : ''}`);
    }
    if (r.detail?.stop) lines.push(`  instrument-stop: ${r.detail.stop}`);
    const gap = r.gapLines ?? [];
    if (gap.length) {
      lines.push('  gap:');
      for (const g of gap.slice(0, gapCap)) lines.push(`    ${g}`);
      if (gap.length > gapCap) {
        lines.push(`    [gap trimmed: ${gap.length - gapCap} of ${gap.length} lines withheld — the cap is ${gapCap} per stage]`);
      }
    }
  }
  return redactSecrets(lines.join('\n'));
}

/**
 * The measured block when the declaration never reached execution. Both cases are
 * machine outputs of the pipeline, never editorial prose about the model's work.
 *
 * SCRUBBED at the emission boundary, for the SAME reason `renderSeedReadBlock`
 * is and through the SAME one redactor. The channel here is different and just
 * as real: a validation red QUOTES WHAT THE MODEL DECLARED, verbatim — the
 * genre-env branch echoes the expected and the declared value, the deny floor
 * echoes the whole `cmd`, the listing rule echoes the path — and this block
 * becomes the next USER TURN sent to the provider. A declared value shaped like
 * a credential crossed unmasked before this line existed. Applied to the whole
 * rendered block rather than one field, so a red added to the validator is
 * scrubbed by construction rather than by remembering.
 * @param {{kind: 'validation'|'artifact'|'edits', reds: (Red|string)[], cap?: number}} o
 */
export function renderRejectBlock({ kind, reds, cap = REVISE_RED_CAP }) {
  const head = kind === 'validation'
    ? 'MEASURED VALIDATION — your declaration was rejected by the validator before any stage could run:'
    : kind === 'edits'
      ? 'MEASURED EDITS — some of your edits were refused; each refusal is its own and your other edits stand:'
      : 'MEASURED PARSE — your reply could not be read as one declaration:';
  const rendered = (reds ?? []).map((r) => (typeof r === 'string' ? r : `${r.code} at ${r.path || '(root)'}: ${r.detail}${typeof r.hint === 'string' ? ` ${r.hint}` : ''}`));
  const shown = rendered.slice(0, cap);
  const tail = rendered.length > shown.length
    ? [`  [${rendered.length - shown.length} of ${rendered.length} reds withheld — the cap is ${cap}]`]
    : [];
  return redactSecrets([head, ...shown.map((r) => `  ${r}`), ...tail].join('\n'));
}

/** A revise turn is EXACTLY the measured block, a blank line, and the instruction. */
export function buildReviseTurn(/** @type {string} */ measuredBlock) {
  return `${measuredBlock}\n\n${REVISE_INSTRUCTION}`;
}

/**
 * The structural guarantee that no other prose can enter a revise turn. Without
 * it "the feedback is measurement only" is a promise; with it, it is a fact that
 * fails the build the day someone appends a helpful sentence.
 * @param {string} turn @param {string} measuredBlock
 */
export function assertReviseTurn(turn, measuredBlock) {
  if (!/^MEASURED (SEED-READ|VALIDATION|PARSE) —/.test(measuredBlock)) {
    throw new Error('REVISE DRIFT: the measured block does not open with a mechanical header');
  }
  if (turn !== `${measuredBlock}\n\n${REVISE_INSTRUCTION}`) {
    throw new Error('REVISE DRIFT: the turn is not measured-block + the frozen instruction, exactly');
  }
  return { ok: true, bytes: Buffer.byteLength(turn) };
}

// ── 4. THE GENRE'S ENVIRONMENT ───────────────────────────────────────────────

/** Which kinds can carry an environment at all — read off the catalogue, never a
 * list, and read through M2's OWN predicate rather than a second copy of it.
 * The validator's completeness rule demands the variable on exactly the stages
 * this injector puts it on, so the two must be one function: a drift either way
 * leaves stages injected-but-unchecked or checked-but-never-injected. */
const envCapable = envCapableKind;

/**
 * Apply the genre's environment to a declaration, mechanically.
 *
 * Three rules, and each one is a finding:
 *   - it lands on every stage that SPAWNS something (env-capable by the
 *     catalogue) and nowhere else — a stage that runs no process has no
 *     environment to set;
 *   - a model-authored copy of a genre-owned name is DROPPED and ANNOUNCED. M2's
 *     validator already reds that, so this is defence in depth — but the failure
 *     direction matters: silently keeping the model's guess is how round 2's arm
 *     B graded an unedited checkout;
 *   - a genre variable this patient cannot supply is a RED, not an omission. It
 *     moves no seed number, so no seed-verdict read can ever see it missing, and
 *     the artefact it would be missing from is SIGNED.
 *
 * The input declaration is never mutated: the model's own copy has to stay what
 * the model wrote, or the next turn's validator reds it for our injection.
 * @param {any} declaration
 * @param {string} lang
 * @param {{sourcePrefixes?: string[], catalogue?: Record<string, any>}} [o]
 * @returns {{declaration: any, applied: Record<string, string>, dropped: {stage: string, name: string}[],
 *   missing: string[], reds: Red[]}}
 */
export function applyGenreEnv(declaration, lang, { sourcePrefixes = [], catalogue = KIND_CATALOGUE } = {}) {
  const applied = genreEnv(lang, { sourcePrefixes });
  const owned = genreOwnedEnvNames(lang);
  const missing = owned.filter((n) => !Object.hasOwn(applied, n));
  /** @type {{stage: string, name: string}[]} */
  const dropped = [];
  /** @type {Red[]} */
  const reds = missing.map((name) => ({
    code: 'genre-env-unavailable',
    path: `genre.env.${name}`,
    detail: `the ${lang} genre owns ${name} and this patient supplies nothing to build it from — it is a fact `
      + 'the interview cannot give and the repository does not state, it moves no seed number, and a close signed '
      + 'without it grades a different checkout',
    name,
  }));

  const out = structuredClone(declaration);
  for (const s of out?.stages ?? []) {
    if (!s || typeof s !== 'object' || !envCapable(s.kind, catalogue)) continue;
    if (!s.params || typeof s.params !== 'object') continue;
    /** @type {Record<string, string>} */
    const env = { ...(s.params.env ?? {}) };
    const conflicts = owned.filter((n) => Object.hasOwn(env, n));
    // touch nothing when there is nothing to do: a declaration is a SIGNED
    // artefact, and rewriting a stage we had no reason to change makes the
    // signed form differ from what the model wrote for no stated reason
    if (conflicts.length === 0 && Object.keys(applied).length === 0) continue;
    for (const name of conflicts) { dropped.push({ stage: s.name, name }); delete env[name]; }
    Object.assign(env, applied);
    if (Object.keys(env).length) s.params.env = env;
    else delete s.params.env;
  }
  return { declaration: out, applied, dropped, missing, reds };
}

/**
 * The prefixes `genreEnv` JOINS into the genre's variable, resolved against the
 * real tree. Two filters, and the second one was paid for on a live patient.
 *
 * EXISTENCE (unchanged): a prefix that names nothing at the seed would build a
 * variable pointing at nothing, and the grounded validator refuses it anyway
 * (`ungroundedGenreEnv` checks every ELEMENT against the seed listing).
 *
 * IDENTITY (new): existence alone reads a SYMLINK and the directory behind it as
 * two prefixes. On aurora, 11 entries under `src` resolve into the per-package
 * `packages/<pkg>/src` trees, so the joined `MYPYPATH` named one tree twice
 * under two spellings and mypy died FATALLY — exit 2, "shadows library module",
 * zero output — which the close reads as a broken instrument on a perfectly
 * healthy patient. The realpath-deduped control produced the identical clean
 * reading as the known-good invocation.
 *
 * WHICH SPELLING SURVIVES is not cosmetic. The REAL path wins, because that is
 * the one the checker itself resolves to; the symlink spelling is kept only when
 * the real one cannot be used. And a spelling is only ever emitted when it
 * SELECTS from the seed listing, because the arbiter records this value in a
 * SIGNED envelope and re-validates it GROUNDED — a value the grounded validator
 * cannot select is one the arbiter must never build. So a link out of the
 * repository, or into a path git does not track, keeps its declared spelling
 * rather than becoming an absolute path nothing can ground.
 *
 * An unreadable candidate (a dangling link, a race) is NOT dropped: it passed the
 * existence filter against the listing, and silently losing a real prefix is the
 * Result-5 hazard in the other direction.
 * @param {{workdir: string, sourcePaths: any, seedFiles: string[]}} o
 * @returns {string[]}
 */
export function resolveSourcePrefixes({ workdir, sourcePaths, seedFiles }) {
  const files = Array.isArray(seedFiles) ? seedFiles : [];
  const listed = (/** @type {string} */ p) => p !== '' && files.some((f) => f === p || f.startsWith(`${p}/`));
  const candidates = (Array.isArray(sourcePaths) ? sourcePaths : []).map(cleanEntry).filter(listed);

  // the root's OWN realpath: a workdir reached through a link would otherwise
  // make every candidate look like it points outside the repository
  let root;
  try { root = realpathSync(String(workdir ?? '')); } catch { root = String(workdir ?? ''); }

  /** @type {Map<string, string>} realpath → the spelling that owns it */
  const byReal = new Map();
  for (const declared of candidates) {
    let real = null;
    try { real = realpathSync(join(root, declared)); } catch { real = null; }
    let spelling = declared;
    if (real !== null) {
      const rel = relative(root, real);
      // inside the repository, and something git tracks under it
      if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && listed(rel)) spelling = rel;
    }
    const key = real ?? join(root, declared);
    if (!byReal.has(key)) byReal.set(key, spelling);
  }
  return [...byReal.values()];
}

// ── 5. COST ──────────────────────────────────────────────────────────────────

/**
 * F6's shape: an unpriced call or round makes the TOTAL unknown, and unknown is
 * reported as null — never as the sum of the priced half wearing a complete coat.
 * `knownUsd` carries the priced half explicitly so nothing is hidden either way.
 *
 * IT IS ALSO THE RUN'S AUDIT OF WHAT WAS SAID, not only of what was spent. Every
 * `add` records the call's RAW output beside its price, through the one
 * scrubbed-persist helper — one list of calls, read two ways. That pairing is
 * structural rather than remembered: run mslhn707 metered a $0.053 scout call
 * and kept not one byte of what it returned, so the malformation that killed the
 * run could not be read afterwards. A cost entry with no raw beside it is that
 * run again.
 */
/**
 * @param {{ceilingUsd?: number|null,
 *   onCall?: (call: {label: string, costUsd: number|null, unpricedRounds: number, thinkingStatus?: string, raw?: string}) => void}} [o]
 *   `ceilingUsd` is the OPERATOR's ceiling; `null`/absent is UNBOUNDED.
 *   `onCall` is a REPORTING seam fired as each metered call lands — the shell's
 *   only chance to know what has been spent while the run is still alive. It is
 *   never consulted and never governs: `capStop` below is still the one
 *   predicate, still asked between calls, and still reads the same `entries`.
 *   `absorb` deliberately does NOT fire it: those calls were metered (and
 *   reported) by whoever made them, and reporting them twice would double the
 *   scout's spend in every reader downstream.
 */
export function makeCostBook({ ceilingUsd = null, onCall = () => {} } = {}) {
  /** @type {{label: string, costUsd: number|null, unpricedRounds: number}[]} */
  const entries = [];
  /** @type {ReturnType<typeof scrubRaw>[]} */
  const raws = [];
  return {
    /** @param {string} label @param {any} r a bare-agent run result @param {number} [attempt] */
    add(label, r, attempt = 1) {
      const call = { label, ...priceOf(r) };
      entries.push(call);
      const kept = scrubRaw({ label, attempt, text: r?.text, reason: r?.error ? String(r.error) : null });
      raws.push(kept);
      // bare-agent's per-run `thinkingStatus` ('applied' | 'unsupported' | 'ignored' | 'unknown') rides the REPORTING seam only —
      // never the stored entry, so the cost report and every persisted shape stay as they were; absent when thinkingMode was not sent.
      // R9 (Part B 4): the call's scrubbed answer rides the same seam (secret-masked and bounded by `scrubRaw`, the one mask owner), so the session's drafting log keeps what an
      // unusable draft try actually said; an empty answer (a tool-delivered reply) adds nothing
      onCall({ ...call, ...(kept.text === '' ? {} : { raw: kept.text }), ...(r?.thinkingStatus === undefined ? {} : { thinkingStatus: r.thinkingStatus }) });
      return entries.at(-1);
    },
    /** @param {{label: string, costUsd: number|null, unpricedRounds: number}[]} calls
     * @param {ReturnType<typeof scrubRaw>[]} [callRaws] */
    absorb(calls, callRaws) { for (const c of calls ?? []) entries.push({ ...c }); for (const w of callRaws ?? []) raws.push({ ...w }); },
    /** the persisted raws, in call order — the same order and the same labels as
     * `report().calls`, because both are readings of one list */
    raws() { return raws.map((w) => ({ ...w })); },
    report() {
      return { ...tallyCalls(entries), calls: entries.map((e) => ({ ...e })) };
    },
    /**
     * THE CEILING'S OWN READING, asked between metered calls. The book is the one
     * place this pipeline's spend accumulates, so it is the one place that can
     * answer honestly — and it answers through the shared predicate rather than a
     * second hand-spelled comparison (`src/text.js`, beside `priceOf`).
     * @returns {'cap-halt'|'pricing-red'|null}
     */
    capStop() { return capStop({ ceilingUsd, ...tallyCalls(entries) }); },
    /** what was set, stated — `null` is "nobody set one", which is UNBOUNDED and
     * a visible operator choice, never a defaulted number */
    ceilingUsd,
  };
}

/**
 * The default model boundary: one bare-agent Loop per call, with the declaration
 * tool wired to END the call the moment it is used. The tool is an OUTPUT
 * CHANNEL, not a step in a conversation, so the round that would acknowledge its
 * result has nothing left to say.
 *
 * MEASURED against the real Loop with a counting provider, both arms: stop-wired
 * = 1 provider round, $0.001; unwired = 2 rounds, $0.002. So the wiring halves
 * the round count of every authoring and revise call — that is the number, not
 * an estimate, and it is why tool mode does not cost double what text mode did.
 *
 * `cacheMessages` (F18) and `maxTokens` (F30) are not optional on this stack.
 * `rates` is the customer's own price for this provider's key row (USD per 1K, `ratesFor`);
 * absent = bare-agent's built-in guess, exactly as before.
 * `draftThinking` ('on' | 'off', the job's "Thinking on" tick spelled as a word; default 'off') adds the drafter's per-call thinking option via `thinkingCallOptions` (src/thinking.js, the one owner).
 * @param {any} provider @param {{system?: string, maxTokens?: number, rates?: {in: number, out: number}|null, draftThinking?: string}} [o]
 * @returns {(messages: any[], tools: any[], opts?: any) => Promise<any>}
 */
export function makeLoopGenerate(provider, { system = AUTHOR_SYSTEM, maxTokens = AUTHOR_MAX_TOKENS, rates = null, draftThinking = 'off' } = {}) {
  // the drafter's per-call options (src/thinking.js `thinkingCallOptions`, one owner); a bad mode throws HERE, at construction
  const callOptions = thinkingCallOptions(provider, draftThinking);
  return async (/** @type {any[]} */ messages, /** @type {any[]} */ tools, /** @type {any} */ opts = {}) => {
    const loop = new Loop({ provider, system, ...(rates ? { rates } : {}) });
    const wired = tools.map((t) => ({
      ...t,
      execute: async (/** @type {any} */ a) => { const r = await t.execute(a); loop.stop(); return r; },
    }));
    // F152/PRD 30.4 — the SAME idle bound `authorscout.js` reuses (this pipeline
    // has no wall clock of its own): a live endpoint that accepts and never
    // answers hangs the process forever otherwise. `...opts` still spreads AFTER
    // it, so a caller that ever needs a tighter number for one call may pass it —
    // tighten-only, and nothing does today.
    // F179 — bare-agent 0.43.0's OpenAIProvider/Ollama generate() no longer
    // throws on a malformed tool-call arguments string (BA-27): it returns the
    // round priced with `toolCalls: []` plus its own `malformedToolCall` marker,
    // which `Loop.run` surfaces unchanged on its return. No local shim needed.
    return loop.run(messages, wired, { cacheMessages: true, maxTokens, timeoutMs: AUTHOR_CALL_TIMEOUT_MS, ...callOptions, ...opts });
  };
}

// ── 6. THE FLOW ──────────────────────────────────────────────────────────────

/** key-order-insensitive structural identity, for the early stop @param {any} x */
function canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
}

/**
 * ONE structured ask, with the malformed-emission retry bounded on its OWN axis.
 * A reply that carries no artifact is an ARTIFACT-RED — name the axis, retry
 * under a cap, write nothing — and it never consumes a revision, because a
 * transport fault is not a defect in a close.
 *
 * THE CHANNEL IS A PARAMETER, and that is softgreen module 4's only change here:
 * the rubric card and the calibration set are a SECOND schema-forced emission
 * with the same failure modes, and a second ladder is a second place for the cap,
 * the reject block and the re-ask to drift. The declaration channel below is the
 * one this loop has always used, spelled out rather than inlined — nothing about
 * the authoring path's behaviour moves.
 * @param {{messages: any[], generate: Function, mode: 'tool'|'text', retries: number,
 *   label: string, book: ReturnType<typeof makeCostBook>,
 *   channel: {name: string, instruction: string, textPath?: string, tool: (box: {calls: any[]}) => any}}} o
 * @returns {Promise<{artifact: any, attempts: number, convo: any[], raw: string,
 *   providerError: string|null, red: Red|null, budget: 'cap-halt'|'pricing-red'|null, allCutOff?: boolean}>}
 */
export async function askStructured({ messages, generate, mode, retries, label, book, channel }) {
  /** @type {any[]} */
  const convo = [...messages];
  let attempts = 0;
  /** @type {Red|null} */
  let red = null;
  /** how many of this ask's attempts were cut off at the output cap (P7: all of them = a failed try for the question gate) */
  let cutOffs = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // THE CEILING, immediately before the paid call and nowhere else. Sited HERE
    // rather than in the revise loop because this is where every declaration call
    // is actually made: the author call, each revise, AND each malformed-emission
    // retry. The retry axis is the one that matters most — it fires exactly when
    // the model is malforming, which is the worst moment for a paid loop to be
    // unbounded. `attempts` is returned as-is so the caller can tell a cap that
    // tripped before this ask began (0) from one that cut a retry ladder short.
    const halt = book.capStop();
    if (halt) return { artifact: null, attempts, convo, raw: '', providerError: null, red: null, budget: halt };

    /** @type {{calls: any[]}} */
    const box = { calls: [] };
    // the tool's schema is CLASS-SCOPED, like the prompt's catalogue block: the
    // two must offer one set of kinds, or the composer reads about a kind it
    // cannot call — or worse, calls one the ceiling will refuse after we paid.
    const tools = mode === 'tool' ? [channel.tool(box)] : [];
    // F179/F180 — bare-agent 0.42.0's OpenAIProvider.generate used to THROW
    // mid-call (a raw SyntaxError off a malformed tool-call arguments string,
    // parsed with no try/catch) rather than resolve with `{error}` the way a
    // settled provider-shape casualty normally does; 0.43.0 fixed that class
    // upstream (BA-27), so `callCasualty` no longer admits a SyntaxError at
    // all (its branch was dead code and was removed). This try/catch stays
    // for the class it was ALSO built to cover: `callCasualty` is the SAME
    // predicate `authorscout.js`'s `settled` uses for its idle-timeout seam
    // (src/text.js, beside `priceOf`) — a HaltError or an unrecognised throw
    // re-raises unchanged; only an admitted casualty class lands here as the
    // same `{error}` shape the resolved-error path already books and returns
    // below.
    let r;
    try {
      r = await generate(convo, tools, {});
    } catch (e) {
      const reason = callCasualty(e);
      if (reason === null) throw e;
      attempts += 1;
      book.add(attempt === 0 ? label : `${label}#${attempt + 1}`, { error: reason }, attempts);
      return { artifact: null, attempts, convo, raw: '', providerError: reason, red: null, budget: null };
    }
    attempts += 1;
    book.add(attempt === 0 ? label : `${label}#${attempt + 1}`, r, attempts);
    const raw = redactSecrets(String(r?.text ?? ''));

    // ITEM 6 (P7, live session smv2bzdqmp0f8, 2026-10-10): a round cut off at the output cap is the MODEL's own overlong
    // answer, not a transport fault — it is a failed try on the same ladder as a malformed artifact (the spend is already
    // booked above). Only a real error (a throw, a provider/halt tag) stays provider-red.
    const cutOff = isOutputCutOff(r);
    if (cutOff) cutOffs += 1;
    if (r?.error && !cutOff) {
      return { artifact: null, attempts, convo, raw, providerError: String(r.error), red: null, budget: null };
    }

    if (cutOff) {
      red = {
        code: 'artifact-red',
        path: channel.name,
        detail: "the AI's answer was cut off at the output limit",
        axis: 'output-truncated',
      };
    } else if (mode === 'tool') {
      // F179 (2026-09-15 ruling) — retry, never repair. bare-agent 0.43.0
      // (BA-27) already priced this round on the real usage and returns it
      // with `toolCalls: []` plus its own `malformedToolCall` marker instead
      // of throwing; this ladder's EXISTING malformed-emission retry (below)
      // is the whole mechanism — no new cap, no second pricing path, nothing
      // here ever re-parses or edits the model's arguments. The raw malformed
      // string itself is never persisted, only the parser's own error
      // message, scrubbed like every other model-authored text on this trail.
      //
      // Checked BEFORE the `box.calls.length === 1` accept and REGARDLESS of
      // how many calls survived (0 or more — bare-agent's `parseToolCalls` is
      // itself all-or-nothing, BA-27, so a real provider always returns 0 on
      // a malformed round): before this fix, a two-call reply was ALWAYS the
      // 'multiple-declaration-tool-calls' red, never an accept, so a
      // malformed call riding alongside a valid one must not widen what this
      // ladder takes from a malformed reply. Nothing from a malformed reply
      // is ever accepted.
      if (r?.malformedToolCall) {
        red = {
          code: 'artifact-red',
          path: channel.name,
          detail: `the reply's ${channel.name} call arguments were not valid JSON `
            + `(${redactSecrets(String(r.malformedToolCall.error))}) — nothing is repaired; the call must be re-sent whole`,
          axis: 'malformed-tool-call-arguments',
        };
      } else if (box.calls.length === 1) {
        return { artifact: box.calls[0], attempts, convo, raw, providerError: null, red: null, budget: null };
      } else {
        red = {
          code: 'artifact-red',
          path: channel.name,
          detail: box.calls.length === 0
            ? `the reply delivered no ${channel.name} call — structure is enforced, prose is never parsed`
            : `the reply delivered ${box.calls.length} ${channel.name} calls; exactly one is expected`,
          axis: box.calls.length === 0 ? 'no-declaration-tool-call' : 'multiple-declaration-tool-calls',
        };
      }
    } else {
      // THE FALLBACK PATH — providers without tool mode only. The ONE shipped
      // parser, never a second one.
      const at = channel.textPath ?? channel.name;
      const { code, red: extractRed } = extractArtifact(raw);
      if (code) {
        try { return { artifact: JSON.parse(code), attempts, convo, raw, providerError: null, red: null, budget: null }; }
        catch (e) { red = { code: 'artifact-red', path: at, detail: `the ${at} did not parse as JSON: ${String(/** @type {any} */ (e)?.message ?? e)}`, axis: 'unparseable-json' }; }
      } else {
        red = { code: 'artifact-red', path: at, detail: `no artifact in the reply: ${extractRed}`, axis: 'no-artifact' };
      }
    }

    if (attempt < retries) {
      const block = renderRejectBlock({ kind: 'artifact', reds: [/** @type {Red} */ (red).detail] });
      // a cut-off reply is NOT replayed (it would re-bill the whole cap as input and teach nothing)
      convo.push({ role: 'assistant', content: (cutOff ? '' : raw.trim()) || '(the reply carried no text)' });
      convo.push({ role: 'user', content: `${block}\n\n${mode === 'tool' ? channel.instruction : STRUCTURE_INSTRUCTION_TEXT}` });
    }
  }
  return { artifact: null, attempts, convo, raw: '', providerError: null, red, budget: null, allCutOff: attempts > 0 && cutOffs === attempts };
}

/** THE DECLARATION CHANNEL — the one this loop has always used. Its schema is
 * CLASS-SCOPED, like the prompt's catalogue block: the two must offer one set of
 * kinds, or the composer reads about a kind it cannot call.
 * @param {{catalogue: Record<string, any>, verdictType: string, questions?: boolean, kinds?: string[]|null, ticket?: boolean}} o */
const declarationChannel = ({ catalogue, verdictType, questions = false, kinds = null, ticket = false }) => ({
  name: DECLARATION_TOOL_NAME,
  instruction: STRUCTURE_INSTRUCTION_TOOL,
  textPath: 'declaration',
  tool: (/** @type {{calls: any[]}} */ box) => declarationTool(box, { catalogue, verdictType, questions, kinds, ticket }),
});

/** The declaration ask, over the shared ladder. `declaration` is `artifact`
 * under this channel's own name — the flow below reads a declaration, not an
 * anonymous artifact, and one word for two things is how a reader loses which.
 * @param {{messages: any[], generate: Function, mode: 'tool'|'text', retries: number,
 *   label: string, book: ReturnType<typeof makeCostBook>, catalogue: Record<string, any>,
 *   verdictType: string, questions?: boolean, kinds?: string[]|null, ticket?: boolean}} o
 */
async function askDeclaration({ messages, generate, mode, retries, label, book, catalogue, verdictType, questions = false, kinds = null, ticket = false }) {
  const r = await askStructured({
    messages, generate, mode, retries, label, book, channel: declarationChannel({ catalogue, verdictType, questions, kinds, ticket }),
  });
  return { ...r, declaration: r.artifact };
}

// ── THE CONFIRM TURN (PRD item 33 M3 piece 4) ───────────────────────────────
//
// The confirm turn drafts a PLAN — checks it will compose, protections
// (always-on guards, never named in the goal), and one signed goal sentence —
// from the person's own free-text answers plus the read-only survey/listing
// the scout or seed-read already paid for, THEN shows it back and lets the
// person confirm, fix (up to the 2-round cap, ruling 5), type the goal
// themselves, or start over. No hand-authored matcher ever compares the goal
// against the checks (ruling 6) — the model states its own plan, in the
// model-facing prompt below, and the person is the one judgement that
// accepts it.

export const CONFIRM_TOOL_NAME = 'confirm_plan';

/** Acknowledgement text the confirm tool's `execute` returns — mirrors
 * {@link DECLARATION_ACK}'s role: an output channel that records and
 * acknowledges, takes no action, and ends the call the moment it fires
 * (`makeLoopGenerate` stops the loop on any tool execute). */
export const CONFIRM_ACK = 'plan received';

/** the confirm channel's own STRUCTURE_INSTRUCTION_TOOL analogue, shown after
 * a malformed reply so the retry names the ONE required shape rather than
 * repeating the whole system prompt */
export const CONFIRM_STRUCTURE_INSTRUCTION = `Your reply did not deliver exactly one plan through the ${CONFIRM_TOOL_NAME} tool. `
  + 'Call it exactly once, with the whole plan as its arguments: checks, one goal sentence, anything not covered '
  + 'by a check, and any genuinely missing questions.';

/** @type {Record<string, any>} */
const CONFIRM_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1 },
          fromLine: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'integer', minimum: 1 }, description: 'the number(s) of the numbered job line(s) this check is for, e.g. [1] or [1, 3]' },
        },
        required: ['text', 'fromLine'],
        additionalProperties: false,
      },
      description: 'the mechanical checks you plan to compose, each one traceable to the numbered job line it checks '
        + '(fromLine, an array: one check may serve several lines) — never a check invented beyond what the job lines and their rules asked for',
    },
    goal: {
      type: 'string',
      minLength: 1,
      description: 'ONE sentence naming every listed check (never a protection or guard — those are not yours to '
        + "name) — this becomes the signed job spec's goal",
    },
    notChecked: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'anything the person asked for (in the job lines, the rules under them, or '
        + 'worse-than-before answers) that none of your listed checks can verify — named plainly in the person\'s '
        + 'own words; an empty list means every ask is covered by a listed check',
    },
    questions: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'anything genuinely missing from the person\'s answers that you need to plan honestly — never '
        + 'asked to double-check something already answered',
    },
  },
  required: ['checks', 'goal', 'notChecked', 'questions'],
  additionalProperties: false,
});

/**
 * The confirm plan's checks as `{text, fromLine}` items. The schema asks for objects (P7: each check names the job line
 * it is for); a bare string (a text-mode reply, an older caller) reads as a check with no line.
 * @param {any} raw the plan's `checks`
 * @returns {{text: string, fromLine: number[]|null}[]}
 */
export function normalizeChecks(raw) {
  /** a fromLine as a non-empty, duplicate-free array of line numbers, else null (never a guess)
   * @param {any} v @returns {number[]|null} */
  const normLines = (v) => (Array.isArray(v) && v.length > 0 && v.every((x) => Number.isInteger(x) && x >= 1) ? [...new Set(v)] : null);
  return (Array.isArray(raw) ? raw : []).flatMap((/** @type {any} */ c) => {
    if (typeof c === 'string') return c.trim() ? [{ text: c, fromLine: null }] : [];
    if (c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim()) {
      return [{ text: c.text, fromLine: normLines(c.fromLine) }];
    }
    return [];
  });
}

/** The output channel. It records and acknowledges; it takes no action.
 * @param {{calls: any[]}} box */
export function confirmTool(box) {
  return {
    name: CONFIRM_TOOL_NAME,
    description: 'Deliver the drafted plan: the checks you will compose, one goal sentence, anything the person '
      + 'asked for that no check covers, and any genuinely missing questions. Call this exactly once.',
    parameters: CONFIRM_SCHEMA,
    execute: async (/** @type {any} */ args) => { box.calls.push(args); return CONFIRM_ACK; },
  };
}

/** THE CONFIRM CHANNEL — the one this turn uses, over the shared
 * {@link askStructured} ladder, exactly as {@link declarationChannel} is for
 * the authoring call. */
const confirmChannel = () => ({
  name: CONFIRM_TOOL_NAME,
  instruction: CONFIRM_STRUCTURE_INSTRUCTION,
  textPath: 'plan',
  tool: (/** @type {{calls: any[]}} */ box) => confirmTool(box),
});

/**
 * The confirm turn's system prompt (model-facing, registered — a commit
 * touching this needs Failure/Addresses/Corrects labels, `src/promptregisters.js`).
 * States ruling 6 ("a genre never adds a check the goal did not ask for") as
 * an ORDER to the model itself, the same register {@link AUTHOR_SYSTEM} and
 * {@link CLASS_STATEMENTS} already use, rather than a code matcher over prose.
 */
/**
 * What the confirm turn tells the model about a rubric job on local text files (model-facing, registered). The turn plans the goal only: the checks of the job are the one list's
 * (`src/checklist.js`), made before the draft, never this turn's.
 */
export const RUBRIC_CONFIRM_NOTE = 'THIS JOB HAS NO REPOSITORY. Its inputs are the person\'s own text files, and each numbered job line leaves ONE file the run writes. '
  + 'The checks of this job are made elsewhere: plan none. Send an empty checks list, an empty notChecked list and an empty questions list, '
  + 'and write ONE sentence saying what the job does, from the numbered job lines.';

export const CONFIRM_SYSTEM = 'You read what a NON-ENGINEER answered, plus a read-only survey or listing of their '
  + 'own repository, and draft a PLAN for a job\'s definition of done: the checks you plan to compose and one '
  + 'signed goal sentence. You never propose a check the numbered job lines (and the ~ rules written under them) did not ask for '
  + '— a genre never adds a check the goal did not ask for (run mtv8jihy drafted an unasked tsc --strict stage; '
  + 'that is exactly the mistake this order exists to prevent). Tag each check with "fromLine", an array of the number(s) of the '
  + 'numbered job line(s) it is for. The always-on guards (changed-from-seed, '
  + 'no-suppressions, and every mandatory guard) and the write fence are shown to the person by the SYSTEM, never '
  + 'by you: you never claim, name, or list a protection or guard of your own — that is not your call to state, and '
  + 'a protection is never a check and never named in the goal sentence. The goal sentence names every check you '
  + 'listed and nothing more. For anything the person asked for that none of your listed checks can verify, name it '
  + 'plainly in `notChecked`, in the person\'s own words — never omit a gap to make the plan look complete; '
  + 'over-reporting a gap is always the safe direction. Before you name anything in `notChecked`, check it against '
  + 'the ALREADY COVERED list shown to you in the message below (the real guards and write fence this run will '
  + 'apply) — anything already covered there never belongs in `notChecked`, even when the person asked for it in '
  + 'their own words (runs mu2bjmed and mu2qmept both wrongly claimed the no-suppressions guard and the write fence '
  + 'were missing when both were already enforced; check the list before writing the claim). Ask a question only '
  + 'where an answer is genuinely missing — never to double-check something already answered. You cannot read '
  + 'anything and you cannot run anything: everything you know is in the message you are given.';

/** the confirm turn's system prompt for a rubric job (model-facing, registered): a one-sentence goal, no check of its own */
export const CONFIRM_GOAL_SYSTEM = 'You read what a NON-ENGINEER answered, plus the numbered job lines and the inputs they pointed at, and write a one-sentence goal for the job. '
  + 'You never propose a check, a gap or a question: the checks of this job are made elsewhere. '
  + 'You cannot read anything and you cannot run anything: everything you know is in the message you are given.';

/** the confirm turn's system prompt for a job of this language: a rubric job's is the goal-only one @param {string} lang @returns {string} */
export const confirmSystemFor = (lang) => (lang === RUBRIC_LANG ? CONFIRM_GOAL_SYSTEM : CONFIRM_SYSTEM);

/**
 * The confirm turn's per-round prompt (model-facing, registered). Shows the
 * person's own answers with their labels (the signed table's Field/Holds
 * pairing, same as {@link authorPrompt}'s interview block), the survey or
 * listing already paid for, the write fence, the detected language, "worse
 * than before" when the person gave one (repo only), and — on a fix round —
 * what the person asked to change.
 * F183 (2026-09-16, ruling A, run mu2qmept): also carries the REAL,
 * code-derived `protections` list ({@link confirmProtections} — the same
 * guards the close will actually compose plus the real write fence, never a
 * second hand-typed list) as an ALREADY COVERED block, with the instruction
 * that anything on it never belongs in `notChecked`. Twice live (mu2bjmed,
 * mu2qmept) the model claimed a guard or the write fence was missing while
 * blind to what was actually enforced — this is the fix: show it the facts
 * before it drafts, never hand-write a matcher over its answer.
 * @param {{answers: Record<string|number, string>, questions: Record<string|number, string>,
 *   labels?: Record<string|number, string>, facts?: any, listing?: string|null,
 *   writeScope?: string[]|null, isRepo: boolean, lang: string, worseThanBefore?: string,
 *   fixText?: string|null, protections?: string[], inputs?: {n: number, label: string, value: string}[]|null, ticket?: boolean}} o
 */
export function confirmPrompt({ answers, questions, labels = {}, facts = null, listing = null, writeScope = null, isRepo, lang, worseThanBefore = '', fixText = null, protections = [], inputs = null, ticket = false }) {
  const lines = ['THE PERSON\'S OWN ANSWERS (a non-engineer; read exactly what they wrote, invent nothing beyond it):'];
  for (const k of Object.keys(questions)) {
    const label = labels[k] ? ` (${labels[k]})` : '';
    lines.push(`Q${k}${label}. ${questions[k]}`);
    lines.push(`A${k}. ${answers?.[k] ?? '(no answer)'}`);
  }
  if (inputs && inputs.length) lines.push('', renderInputs(inputs));
  if (isRepo && worseThanBefore) {
    lines.push('', `WORSE THAN BEFORE (a constraint the person named, repo jobs only): ${worseThanBefore}`);
  }
  lines.push('', `LANGUAGE: ${lang}`);
  // PART 1a: a rubric job on the person's own text files. The model is told what a check CAN be here, so that anything
  // needing judgement lands in `notChecked` instead of being promised as a check
  if (lang === RUBRIC_LANG) lines.push('', RUBRIC_CONFIRM_NOTE);
  // R10: the `~` rules code settles from the person's own picks are not yours to plan: a check for them is code's, a gap is code's Not checked row
  // MCP + tickets R5 (F285): a Tickets job's confirm turn is told the ticket is picked per run and a priority/label line is code's, so it never asks the person which ticket
  if (ticket) lines.push('', ticketPerRunFacts());
  if (writeScope) lines.push(`WRITE SCOPE (the fence — the run may write only here): ${writeScope.join(', ')}`);
  if (protections.length > 0) {
    lines.push(
      '',
      'ALREADY COVERED — these are real, always-on, and enforced by this run regardless of what you compose. '
        + 'Never list anything already covered here in `notChecked`, even if the person asked for it in their own '
        + 'words:',
      ...protections.map((p) => `  - ${p}`),
    );
  }
  if (facts) lines.push('', `READ-ONLY SURVEY:\n${JSON.stringify(facts)}`);
  if (listing) lines.push('', `SEED LISTING:\n${listing}`);
  if (fixText) lines.push('', `THE PERSON ASKED FOR A CHANGE: ${fixText}`, 'Revise the plan and resubmit.');
  return lines.join('\n');
}

/**
 * ONE confirm-turn round-trip: capStop, then one structured ask over the
 * confirm channel. Split out of {@link runConfirmTurn} only so the ceiling
 * check and the ask sit beside each other exactly once.
 * @param {{convo: any[], generate: Function, mode: 'tool'|'text', book: ReturnType<typeof makeCostBook>, label: string}} o
 * @returns {Promise<{plan: any, convo: any[], providerError: string|null, red: Red|null, budget: 'cap-halt'|'pricing-red'|null}>}
 */
async function askConfirmPlan({ convo, generate, mode, book, label }) {
  const halt = book.capStop();
  if (halt) return { plan: null, convo, providerError: null, red: null, budget: halt };
  const r = await askStructured({ messages: convo, generate, mode, retries: MAX_STRUCTURE_RETRIES, label, book, channel: confirmChannel() });
  return { plan: r.artifact, convo: r.convo, providerError: r.providerError, red: r.red, budget: r.budget };
}

/**
 * THE CONFIRM TURN: the $0 half (worse-than-before for a repo, a language
 * pick when `lang` carries `detectLanguage`'s own `ambiguous` shape), then up
 * to 2 PAID rounds (ruling 5) of draft → show → the person's menu pick
 * (ruling 5 addendum). `ask` is the ONE interactive seam — an async function
 * from a "what's being asked" descriptor to the person's answer, or `null`
 * meaning input ended (the same signal `scripts/run-interview.mjs`'s own
 * `nextLine()` already uses) — never a process exit here, because this is a
 * library function, not a script. A `null` at ANY ask stops the whole turn as
 * `confirm-abandoned`, spending nothing beyond whatever rounds already ran.
 *
 * D3's shape is enforced by the loop bound alone (`round <= 2`), never a
 * counter checked after the fact: a "fix" on round 2 returns immediately —
 * there is no 3rd call to make.
 *
 * @param {{verdictType: string, answers: Record<string|number, string>,
 *   questions: Record<string|number, string>, labels?: Record<string|number, string>,
 *   facts?: any, listing?: string|null, writeScope?: string[]|null, isRepo: boolean,
 *   lang: string|{kind: 'ambiguous', candidates: string[], dir: string},
 *   generate: Function, book: ReturnType<typeof makeCostBook>,
 *   ask: (step: {kind: string, [k: string]: any}) => Promise<string|null>,
 *   onPhase?: (phase: string, data?: any) => void, mode?: 'tool'|'text',
 *   worseThanBefore?: string, inputs?: {n: number, label: string, value: string}[]|null,
 *   jobLines?: {n: number}[]|null, ticket?: boolean, card?: {checkItems: {text: string, fromLine: number[], by: 'agent'|'you'|'default', key?: string}[], notChecked: string[], notCheckedBy?: Record<string, string>}|null, block?: CheckBlock|null, cardOf?: (() => any)|null}} o retired field (hamr's ruling 2026-09-28):
 *   `worseThanBefore` is never asked any more and defaults to `''` — a
 *   caller may still pass a string through (kept for a future, non-ask
 *   source of the same constraint), it just never comes from an ask() step.
 * @returns {Promise<{ok: boolean,
 *   stop: null|'cap-halt'|'pricing-red'|'provider-red'|'artifact-red'|'confirm-abandoned'|'confirm-restart',
 *   rounds: number,
 *   accepted: {goal: string, checks: string[], checkItems: {text: string, fromLine: number[]|null}[], protections: string[], lang: string,
 *     worseThanBefore: string, openQuestions: string[], notChecked: string[], answeredQuestions?: string[]}|null,
 *   reds: Red[], cost: any}>}
 */
export async function runConfirmTurn({
  verdictType, answers, questions, labels = {}, facts = null, listing = null, writeScope = null,
  isRepo, lang, generate, book, ask, onPhase = () => {}, mode = 'tool',
  // RETIRED ASK (hamr's ruling 2026-09-28): this turn never asks
  // "worseThanBefore" any more — an absent value always resolves to `''`,
  // byte-identical to what an empty answer always produced. A caller may
  // still pass a resolved string through (kept as a plain pass-through, not
  // an ask trigger).
  worseThanBefore: presetWorseThanBefore = '',
  // P7: the inputs the person pointed at; absent = the prompt is byte-identical
  inputs = null,
  // PART 1a: the numbered job lines, so a rubric job's per-line file protections are listed from code
  jobLines = null,
  // MCP + tickets R5 (F285): the job reads tickets; absent = the confirm prompt is byte-identical
  ticket = false,
  // a rubric job's check rows as the card readers read them (`cardOfClose` over `block.closeView()`): the card draws them, nothing else. SHOWN only: the accepted plan below never carries them
  card = null,
  // the live check block of a rubric job and the reader that draws its rows (`() => cardOfClose(...)`): the confirm card's Drop and Add are instant row edits ($0, no AI) through the block, and the card is redrawn from its rows
  block = null, cardOf = null,
}) {
  /** a rubric job's confirm turn plans the goal only (its checks are the list's) */
  const goalOnly = lang === RUBRIC_LANG;
  /** @typedef {null|'cap-halt'|'pricing-red'|'provider-red'|'artifact-red'|'confirm-abandoned'|'confirm-restart'} ConfirmStop */
  /** @returns {{ok: boolean, stop: ConfirmStop, rounds: number, accepted: null, reds: Red[], cost: any}} */
  const base = () => ({ ok: false, stop: null, rounds: 0, accepted: null, reds: [], cost: book.report() });
  /** @param {number} rounds @returns {{ok: boolean, stop: ConfirmStop, rounds: number, accepted: null, reds: Red[], cost: any}} */
  const abandon = (rounds) => ({ ...base(), stop: /** @type {ConfirmStop} */ ('confirm-abandoned'), rounds, cost: book.report() });

  // ── the $0 half, entirely before any token spends (D7) ────────────────────
  // no ask here any more — see the retirement note above.
  const worseThanBefore = typeof presetWorseThanBefore === 'string' ? presetWorseThanBefore : '';

  /** @type {string} */
  let resolvedLang = typeof lang === 'string' ? lang : '';
  if (lang && typeof lang === 'object' && lang.kind === 'ambiguous') {
    onPhase('confirm-language-pick', { candidates: lang.candidates });
    const pick = await ask({ kind: 'language', field: LANGUAGE_PICK_FIELD, candidates: lang.candidates });
    if (pick === null) return abandon(0);
    resolvedLang = String(pick);
  }

  // F183 (2026-09-16, ruling A): computed ONCE, before the model ever drafts,
  // from the same source {@link confirmProtections} always used — fed into
  // the prompt below so the model can check `notChecked` against it, and
  // reused (never recomputed) after the call so the shown, prompted, and
  // recorded protections are always the exact same list.
  const protections = confirmProtections({ verdictType, lang: resolvedLang, writeScope, jobLines });

  // ── up to 2 paid rounds (ruling 5) ─────────────────────────────────────────
  /** @type {string|null} */
  let fixText = null;
  /** F175: `accepted.openQuestions` carries the model's OWN `questions` from
   * the plan being ACCEPTED — never a prior, superseded round's — secret-
   * redacted like every other model/person string on this turn. `fixText`
   * (round 1's own "fix" text) is a SEPARATE mechanism that only feeds round
   * 2's redraft; it must never land in `openQuestions` on its own — round 2's
   * plan is the answer to it, and its own `questions` (if it still has any)
   * are what actually carries forward.
   * @param {any} plan @returns {string[]} */
  const questionsFromPlan = (plan) => (Array.isArray(plan?.questions) ? plan.questions : [])
    .map((/** @type {any} */ q) => redactSecrets(String(q)));
  /**
   * F175's open half (run mu0voeo4, hamr's 2026-09-16 ruling): "Confirm" and
   * "Type the goal yourself" may not bypass a `questions` entry the plan
   * being accepted raised — each is answered inline, in order, through the
   * SAME `ask` seam, with a new `kind: 'answer'` step (NO extra model call:
   * the round/D3 cap is untouched). A blank/whitespace answer is not an
   * answer and re-asks the SAME question; a `null` from `ask` abandons,
   * exactly like every other ask in this function. Returns the `Q:/A:`
   * pairs in order, or `null` to mean abandon.
   * @param {any} plan @returns {Promise<string[]|null>} */
  const forceAnsweredQuestions = async (plan) => {
    const qs = questionsFromPlan(plan);
    /** @type {string[]} */
    const answered = [];
    for (let i = 0; i < qs.length; i += 1) {
      const question = qs[i];
      for (;;) {
        const raw = await ask({ kind: 'answer', source: 'confirm', field: ANSWER_QUESTION_FIELD, question, index: i + 1, total: qs.length });
        if (raw === null) return null;
        const trimmed = redactSecrets(String(raw).trim());
        if (trimmed === '') continue; // blank is not an answer — re-ask the same question
        answered.push(`Q: ${question}\nA: ${trimmed}`);
        break;
      }
    }
    return answered;
  };
  let convo = [{
    role: 'user',
    content: confirmPrompt({
      answers, questions, labels, facts, listing, writeScope, isRepo, lang: resolvedLang, worseThanBefore, protections, inputs, ticket,
    }),
  }];

  for (let round = 1; round <= 2; round += 1) {
    if (fixText) {
      convo = [...convo, { role: 'user', content: confirmPrompt({
        answers, questions, labels, facts, listing, writeScope, isRepo, lang: resolvedLang, worseThanBefore, fixText, protections, inputs, ticket,
      }) }];
    }
    onPhase('confirm-round', { round });
    const label = round === 1 ? 'confirm' : `confirm#${round}`;
    const r = await askConfirmPlan({ convo, generate, mode, book, label });
    convo = r.convo;

    if (r.budget) return { ...base(), stop: r.budget, rounds: round - 1, cost: book.report() };
    if (r.providerError) return { ...base(), stop: /** @type {ConfirmStop} */ ('provider-red'), rounds: round, reds: [{ code: 'provider-red', path: label, detail: redactSecrets(r.providerError) }], cost: book.report() };
    if (!r.plan) return { ...base(), stop: /** @type {ConfirmStop} */ ('artifact-red'), rounds: round, reds: [/** @type {Red} */ (r.red)], cost: book.report() };

    // "Unpriced is never free" (F6): a plan can arrive structurally fine on a
    // call whose OWN cost came back unknown. Nothing downstream ever makes
    // another call to discover that (a "confirm" pick is the last call this
    // turn ever makes), so it is checked HERE, once, right after the call
    // that might have caused it — never silently accepted as a signable plan
    // whose ceiling can no longer be enforced.
    const postCallHalt = book.capStop();
    if (postCallHalt) return { ...base(), stop: postCallHalt, rounds: round, cost: book.report() };

    // THE REAL PROTECTIONS (fix #1, run mu0voeo4, 2026-09-14): never the
    // model's `protections` prose — the schema no longer even asks the model
    // for one — but the guards `classGuards` will actually compose, plus the
    // write fence. Computed once above (F183) and reused here unchanged, so
    // the list the model was prompted with is byte-identical to the list
    // shown at confirm-done and recorded on acceptance. `notChecked` is the
    // model's own honest gap list, carried through unchanged.
    // NO SILENT DROP (idea A core, spec 4.5): what the page rules removed is said HERE too, in the same words as the signed plan, before
    // drafting is paid for. The words come from the one table (src/pagedropwords.js).
    // a rubric job's turn keeps nothing but the goal of the model's plan: its checks, gaps and questions are the list's to make, so code discards any it sent
    if (goalOnly) r.plan = { ...r.plan, checks: [], notChecked: [], questions: [] };
    const notChecked = [...(r.plan.notChecked ?? [])];
    for (const row of dropRows(facts?.look?.dropped)) { const text = dropLine(row, jobLines, lineRules); if (!notChecked.includes(text)) notChecked.push(text); }
    const checkItems = normalizeChecks(r.plan.checks);
    r.plan = { ...r.plan, checks: checkItems.map((c) => c.text), checkItems };
    // the rows of the check block, drawn by the same readers as the signed card (hamr 2026-11-12: the confirm card showed no row the block had built); shown only, never accepted
    const planFor = (/** @type {any} */ c) => ({
      ...r.plan, ...(c === null ? {} : { checkItems: c.checkItems, checks: c.checkItems.map((/** @type {any} */ x) => x.text) }), protections, notChecked: c === null ? notChecked : [...new Set([...notChecked, ...c.notChecked])], ...(c?.notCheckedBy ? { notCheckedBy: c.notCheckedBy } : {}),
      signedFacts: (Array.isArray(facts?.look?.facts) ? facts.look.facts : []).map((/** @type {any} */ f) => String(f?.name)),
      ...(block !== null && cardOf !== null ? { suggested: block.suggestedView(), editable: true } : {}),
    });
    const plan = planFor(card);
    onPhase('confirm-done', { round, plan });
    // Drop and Add on the confirm card: a row edit through the block (the choice decides), reconciled, then the card is drawn again from the rows. $0: no model call is made here
    const edit = block !== null && cardOf !== null ? (/** @type {'drop'|'add'} */ op, /** @type {string} */ key) => {
      const res = block.rowChoice(key, op);
      return res.ok ? { ok: true, plan: planFor(cardOf()), choices: block.choicesRecord() } : res;
    } : null;
    const picked = await ask({ kind: 'menu', field: CONFIRM_MENU, plan, ...(edit ? { edit } : {}) });
    if (picked === null) return abandon(round);
    if (picked === 'start-over') return { ...base(), stop: /** @type {ConfirmStop} */ ('confirm-restart'), rounds: round, cost: book.report() };

    if (picked === 'confirm') {
      const answeredQuestions = await forceAnsweredQuestions(r.plan);
      if (answeredQuestions === null) return abandon(round);
      return {
        ok: true, stop: null, rounds: round,
        accepted: {
          goal: String(r.plan.goal ?? ''), checks: [...(r.plan.checks ?? [])], checkItems: [...(r.plan.checkItems ?? [])], protections: [...protections],
          lang: resolvedLang, worseThanBefore, ...(goalOnly ? { goalOnly: true } : {}),
          // every question forced above was answered in order, so what's left
          // unresolved is honestly empty — computed FROM questionsFromPlan
          // rather than a hardcoded `[]`, so this stays true if the forcing
          // design ever changes.
          openQuestions: questionsFromPlan(r.plan).slice(answeredQuestions.length),
          notChecked: [...notChecked], answeredQuestions,
        },
        reds: [], cost: book.report(),
      };
    }

    if (picked === 'type-goal') {
      const answeredQuestions = await forceAnsweredQuestions(r.plan);
      if (answeredQuestions === null) return abandon(round);
      const typed = await ask({ kind: 'goal' });
      if (typed === null) return abandon(round);
      return {
        ok: true, stop: null, rounds: round,
        accepted: {
          goal: redactSecrets(String(typed).trim()), checks: [...(r.plan.checks ?? [])], checkItems: [...(r.plan.checkItems ?? [])], protections: [...protections],
          lang: resolvedLang, worseThanBefore, ...(goalOnly ? { goalOnly: true } : {}),
          openQuestions: questionsFromPlan(r.plan).slice(answeredQuestions.length),
          notChecked: [...notChecked], answeredQuestions,
        },
        reds: [], cost: book.report(),
      };
    }

    // picked === 'fix'
    const fix = await ask({ kind: 'fix' });
    if (fix === null) return abandon(round);
    const redactedFix = redactSecrets(String(fix).trim());
    if (round === 2) {
      // D3: after round 2 a "fix" is passed to the composer verbatim (via
      // openQuestions, shown at signing) — there is no 3rd call. F175: the
      // MODEL's own questions from THIS round's plan come first, then the
      // person's still-pending fix text — order matters (model asked first,
      // person spoke last) and neither is dropped.
      return {
        ok: true, stop: null, rounds: round,
        accepted: {
          goal: String(r.plan.goal ?? ''), checks: [...(r.plan.checks ?? [])], checkItems: [...(r.plan.checkItems ?? [])], protections: [...protections],
          lang: resolvedLang, worseThanBefore, ...(goalOnly ? { goalOnly: true } : {}), openQuestions: [...questionsFromPlan(r.plan), redactedFix], notChecked: [...notChecked],
        },
        reds: [], cost: book.report(),
      };
    }
    fixText = redactedFix;
  }
  // unreachable: the loop above always returns by round 2 — kept only so a
  // future edit that breaks that invariant fails loudly rather than falling
  // through to `undefined`.
  throw new Error('[authorflow] runConfirmTurn fell through its 2-round cap without returning');
}

/**
 * THE AUTHORING FLOW.
 *
 * Everything cheap happens BEFORE any token is spent: an ABSENT survey, an
 * unreadable listing, an unsupported genre and a genre variable that cannot be
 * built are all $0 refusals, because a paid call that was always going to be
 * thrown away is a paid call nobody needed.
 *
 * The return is deliberately complete rather than tidy:
 *   - `ok` is true iff a declaration passed validation and was measured;
 *   - `declaration` is the LAST ACCEPTED one, genre-env injected — the exact form
 *     that will run and that the signature will cover; unless F176's fallback
 *     fired (see `fellBack`), in which case it is the newest SOUND accepted one
 *     instead — a "last accepted" close whose seed read instrument-stopped is
 *     never handed to a signer as though it were the best close this run found;
 *   - `fellBack` is `null` unless the fallback above fired, in which case it names
 *     `{from, to, brokenStages}` — which iteration was dropped, which one now
 *     stands, and which of the dropped one's stages instrument-stopped;
 *   - `reds` is what the LAST validated iteration said. `ok:true` with a non-empty
 *     `reds` means the final revision was rejected and the previous close stands:
 *     the rejection is reported, never hidden, and never silently shipped either;
 *   - `iterations` carries every intermediate declaration, validation, seed read
 *     and attempt count, because M4 emits them and a human signs against them;
 *   - `raws` carries what every model call actually SAID — the scout's attempts
 *     and the declaration's, scrubbed and bounded through the one persist
 *     helper, in the cost book's own order and under its own labels. It is
 *     present on EVERY path including the $0 preflight refusals, because the
 *     path that spends nothing more is exactly the one whose evidence used to
 *     vanish with the process.
 *
 * No spine emission here (M4 wires events).
 *
 * @param {{workdir: string, seedRef: string, lang: string, verdictType: string,
 *   answers: Record<string|number, string>, questions?: Record<string|number, string>,
 *   scout: {state: string, facts: any, reason?: string|null, cause?: string|null, calls?: any[], raws?: any[],
 *     budgetStop?: 'cap-halt'|'pricing-red'|null},
 *   listing?: {stop: string|null, files: string[]|null, block: string|null, meta: any}|null,
 *   generate: Function, seedReadFn?: Function, closeCtx?: any,
 *   ceilingUsd?: number|null,
 *   onPhase?: (phase: string, data?: any) => void,
 *   onCall?: (call: {label: string, costUsd: number|null, unpricedRounds: number, thinkingStatus?: string}) => void,
 *   maxRevisions?: number, structureRetries?: number,
 *   structuredMode?: 'tool'|'text', catalogue?: Record<string, any>, writeScope?: string[]|null,
 *   priorCalls?: {label: string, costUsd: number|null, unpricedRounds: number}[]|null,
 *   priorRaws?: any[]|null,
 *   jobLines?: {n: number, text: string}[]|null, inputs?: {n: number, label: string, value: string}[]|null,
 *   offerQuestions?: boolean, ticket?: boolean, block?: CheckBlock|null, editGenerate?: Function|null,
 *   confirmed?: {checks: string[], checkItems?: {text: string, fromLine: number[]|null}[], protections: string[], openQuestions?: string[], notChecked?: string[], answeredQuestions?: string[]}|null}} o
 */
export async function authorClose({
  workdir, seedRef, lang, verdictType,
  answers, questions = GREEN_QUESTIONS,
  // Q2 IS GONE from the numbered interview (PRD item 33 M3 piece 3) — this is
  // what carries its information into the prompt instead (`writeScopeBlock`).
  // Optional and defaulted to `null` so every caller that predates the reshape
  // still runs byte-identical; a REAL caller (`authorCloseForJob`) always
  // passes the repo's proven `writeScope`.
  writeScope = null,
  scout, listing = null,
  // PRD item 33 M3 piece 4: the confirm turn's own paid calls — absorbed
  // BESIDE the scout's, below, so the ONE ceiling this run advertised is the
  // one it enforces (the standing hard line's money form): a confirm turn
  // that already spent half the ceiling must not let the author call spend
  // as if it never happened. `null`/absent is every caller that ran no
  // confirm turn — byte-identical to today.
  priorCalls = null, priorRaws = null,
  // The confirm turn's ACCEPTED plan (`runConfirmTurn`'s `accepted`), fed
  // straight into `authorPrompt`'s `confirmedBlock`. `null` is every caller
  // that ran no confirm turn — the prompt is then byte-identical to today.
  confirmed = null,
  // P7: the person's numbered job lines and inputs (src/jobblock.js). ABSENT = every caller that predates the job block:
  // no tagging order in the prompt, and no coverage rule in the validator.
  jobLines = null, inputs = null,
  generate, seedReadFn = runSeedReadStages, closeCtx = {},
  ceilingUsd = null,
  // The two REPORTING seams, defaulted to nothing so every existing caller is
  // byte-identical. Neither is consulted: the revise ladder, the ceiling and the
  // seed read all run exactly as they did — the shell is merely told, while the
  // run is still alive, which of the up-to-15 silent minutes it is inside.
  onPhase = () => {}, onCall = () => {},
  maxRevisions = MAX_REVISIONS,
  structureRetries = MAX_STRUCTURE_RETRIES,
  structuredMode = 'tool',
  catalogue: catalogueIn = KIND_CATALOGUE,
  // P7 item 5 (fwdloop am25): OFF unless the caller can really ask the person (the panel). When on, ONLY the last of the
  // full drafting ladder (the author call plus both revisions), and only after the two before it both failed validation,
  // is offered the optional `questions` property — see `askOpen` below. Absent = byte-identical to today.
  offerQuestions = false,
  // MCP + tickets piece 2 (R5): the job reads tickets, so the drafter is told about the ticket filter, the schema offers the optional `ticketFilter` property and a proposal is
  // checked by the one reader (src/ticketfilter.js). ABSENT = every other job: prompt, schema and validation byte-identical.
  ticket = false,
  // the rubric job's CheckBlock (src/checkblock.js), built before the first try: the AI sends row edits, code builds every check and assembles the declaration from the rows. ABSENT = every other caller.
  block = null,
  // the row-edit turn's own model boundary (ROW_EDIT_SYSTEM); a test that replaces `generate` need not bring one
  editGenerate = null,
}) {
  // PART 1a: the menu this close may draw from — a rubric job on local files sees its own two kinds, a code job never sees
  // the rubric-only ones (`catalogueForLang`). Everything below (prompt, schema, validator, env) reads THIS one catalogue.
  const catalogue = catalogueForLang(lang, catalogueIn);
  // TIGHTEN-ONLY: a caller may lower the ceiling, never raise it — unlimited
  // revising launders thrash as adaptation (addendum 5). The floor is zero: one
  // authoring call with no revise round is a legal ask, and a garbage value is
  // the floor rather than a negative bound the loop never enters.
  const revisionCap = Math.max(0, Math.min(Math.trunc(Number(maxRevisions)) || 0, MAX_REVISIONS));
  // TIGHTEN-ONLY on the OTHER axis too, for the identical reason. `structureRetries`
  // buys provider calls exactly as `maxRevisions` does, and it rode straight through
  // to `askDeclaration` unclamped — a caller handing 50 got 50 paid malformed-emission
  // retries above a ceiling this module declares and the suite pins. No new number:
  // the bound is `MAX_STRUCTURE_RETRIES`, the constant already documented as the
  // ceiling. Floor 0, exactly as above: `askDeclaration` loops `attempt <= retries`,
  // so 0 is still ONE attempt with no retry — a legal tighter ask, not an absent one.
  const retryCap = Math.max(0, Math.min(Math.trunc(Number(structureRetries)) || 0, MAX_STRUCTURE_RETRIES));
  // THE OPERATOR'S CEILING — NO DEFAULT, and none is invented here. `null` means
  // nobody set one, which is UNBOUNDED: a defaulted cap is a silent second
  // ceiling, and the run path already paid for that lesson twice (`maxWallMs` has
  // no default for exactly this reason, and `shellCapUsd` left off judged against
  // a number nobody chose). An unbounded authoring run is legal; it is just never
  // an accident, which is why the driver PRINTS it.
  const book = makeCostBook({ ceilingUsd, onCall });
  // The scout's calls AND its raws, together. The raws matter most on the path
  // that spends nothing more: run mslhn707 refused at the $0 preflight below,
  // and the survey text that would have said WHY died with the process.
  book.absorb(scout?.calls ?? [], scout?.raws ?? []);
  book.absorb(priorCalls ?? [], priorRaws ?? []);
  /** @type {any} */
  const base = {
    ok: false, declaration: null, seedRead: null, iterations: [], reds: [], cost: book.report(),
    raws: book.raws(),
    facts: null, listing: null, genreEnv: null, finalFrom: null, stop: null, revisions: 0,
  };
  const refuse = (/** @type {Red[]} */ reds, /** @type {string} */ stop) => ({ ...base, reds, stop, cost: book.report(), raws: book.raws() });

  // ── $0 preflight ──────────────────────────────────────────────────────────
  // F59, in the shape that bites: `{}` is the scout not completing, never "no
  // special facts are needed". This one lands in a SIGNED artefact.
  if (scout?.state !== 'PRESENT' || !scout.facts || typeof scout.facts !== 'object'
      || Object.keys(scout.facts).length === 0) {
    // A SURVEY THE CEILING STOPPED IS NOT A SURVEY THAT FAILED. The scout carries
    // its own governance stop, and when it is set that is the honest name for why
    // the facts are missing — the same rule W-2 settled for the clock (a time-stop
    // is NAMED a time-stop). `scout-absent` sends the operator to the scout; a
    // cap-halt sends them to the number they set, which is the one that moves.
    if (scout?.budgetStop) {
      // A CONCURRENT CAUSE IS CONCEDED, NEVER DENIED. The ceiling can refuse the
      // reserved recovery round for a call that ALSO died on transport, and both
      // are then true at once. "not on anything it read" would deny the very
      // error the same sentence goes on to quote, and this red carries
      // `path: budgetUsd` — so the operator is steered to raise a ceiling into a
      // dead socket, which is the one lever that cannot repair it. The stop
      // itself does not move: the ceiling did bind, and naming the second cause
      // is attribution, not routing.
      //
      // The transport death is not the only second cause. The ceiling also
      // refuses the recovery round behind a SHORT/EMPTY reply, and the retry
      // behind an EMPTY/UNPARSEABLE one — every cause except NOT_FUNDED means a
      // real call produced the reason being quoted, so "not on anything it
      // read" is honest ONLY when no call was ever made.
      const alsoDied = scout?.cause === SURVEY_CAUSES.CALL_FAILED;
      const alsoIncomplete = !alsoDied && scout?.cause != null && scout.cause !== SURVEY_CAUSES.NOT_FUNDED;
      return refuse([{
        code: scout.budgetStop,
        path: 'budgetUsd',
        detail: alsoDied
          ? 'the authoring ceiling bound here AND the survey call itself failed — both are true, and raising the '
            + `ceiling will not repair the second: ${redactSecrets(String(scout.reason ?? ''))}`
          : alsoIncomplete
            ? 'the authoring ceiling bound here AND the survey came back incomplete — both are true: the ceiling '
              + `refused the round that could have repaired it: ${redactSecrets(String(scout.reason ?? ''))}`
            : `the survey stopped on the authoring ceiling, not on anything it read: ${redactSecrets(String(scout.reason ?? ''))}`,
      }], scout.budgetStop);
    }
    return refuse([{
      code: 'scout-absent',
      path: 'scout',
      // `scout.reason` is half survey bookkeeping and half the scout's own error
      // string (its `meta.error`), so provider prose reaches a KEPT red here —
      // scrubbed at the emission boundary like every other channel that quotes
      // something this module does not own
      detail: `the survey is ${scout?.state ?? 'missing'}${scout?.reason ? ` (${redactSecrets(scout.reason)})` : ''} — an absent facts `
        + 'object is never "no special facts are needed", and there is nothing to author from',
    }], 'precheck');
  }
  const facts = scout.facts;
  base.facts = facts;

  // THE PICKED CLASS, checked at $0 before the language: the battery attaches to
  // the CLASS (PRD v1.57 §2), so a class v1 does not build has no battery to
  // attach — and a close authored without the guards it cannot supply is exactly
  // what D5 exists to make impossible. `verb` rides as a structured field so the
  // caller can carry this to the counted admission path rather than re-deriving
  // the demand from prose.
  // MENU_CLASSES, not LIVE_CLASSES (PRD item 31.1): this is the AUTHORING path,
  // and the question it asks is "may a NEW close be drafted for this class",
  // never "can this class run". `hitl` answers no to the first and yes to the
  // second — it is unlisted, not locked, so `validateCloseDecl` still validates an
  // existing hitl close against its real battery and the runtime still executes it.
  if (!MENU_CLASSES.includes(String(verdictType))) {
    const known = VERDICT_CLASSES.includes(String(verdictType));
    const unlisted = LIVE_CLASSES.includes(String(verdictType));
    return refuse([{
      code: 'class-unsupported',
      path: 'verdictType',
      verb: String(verdictType),
      lib: 'bareloop',
      detail: unlisted
        ? `"${verdictType}" is built and still runs, but it is NOT ON THE AUTHORING MENU — this flow drafts `
          + `${MENU_CLASSES.join(', ')} only. Its class moved to fwdloop; an existing close of this class still `
          + 'validates and still executes, but no new one is drafted here'
        : known
          ? `"${verdictType}" is a named but LOCKED verdict class — v1 admits ${MENU_CLASSES.join(', ')} only, and a `
            + 'class with no guard battery must refuse rather than author a close without the guards it cannot supply'
          : `"${verdictType}" is not a verdict class — the menu is ${VERDICT_CLASSES.join(' | ')}, and nothing derives `
            + 'a class from the answers',
    }], 'precheck');
  }

  if (!DECLARABLE_LANGUAGES.includes(lang)) {
    return refuse([{
      code: 'genre-unsupported',
      path: 'lang',
      verb: 'genre-other',
      lib: 'bareloop',
      detail: `no TYPES genre data for language "${lang}" — one of ${GENRE_LANGUAGES.join(', ')}. A genre with no `
        + 'guard battery must refuse, never author a close without the guards it cannot supply',
    }], 'precheck');
  }

  const seeds = listing ?? await buildSeedListing({
    workdir, seedRef, sourcePaths: facts.sourcePaths, testPaths: facts.testPaths,
  });
  const seedFiles = Array.isArray(seeds.files) ? seeds.files : null;
  if (seeds.stop !== null || seedFiles === null || seedFiles.length === 0) {
    return refuse([{
      code: seeds.stop ? 'listing-unreadable' : 'listing-absent',
      path: 'listing',
      // `stop` is git's own stderr (kinds.js builds it from the subprocess);
      // scrubbed HERE, at the emission boundary, because this red LEAVES the flow
      // and is kept — M1 never scrubs, the caller does
      detail: seeds.stop != null
        ? redactSecrets(seeds.stop)
        : 'the seed listing is empty — without it nothing can tell a real path from an invented one',
    }], 'precheck');
  }
  base.facts = facts;
  base.listing = seeds;

  const guards = classGuards({ verdictType, lang });
  const ownedEnvNames = genreOwnedEnvNames(lang);
  // the source prefixes the genre's environment is built from, filtered against
  // the REAL tree — a prefix that names nothing would build a variable pointing
  // at nothing, and a symlink plus the directory behind it would name ONE tree
  // twice (see resolveSourcePrefixes: that is a FATAL mypy exit, not a warning)
  const sourcePrefixes = resolveSourcePrefixes({ workdir, sourcePaths: facts.sourcePaths, seedFiles });
  const envProbe = applyGenreEnv({ stages: [] }, lang, { sourcePrefixes, catalogue });
  base.genreEnv = { applied: envProbe.applied, owned: ownedEnvNames, missing: envProbe.missing, dropped: [] };
  if (envProbe.reds.length) return refuse(envProbe.reds, 'precheck');

  // ── the grounded loop ─────────────────────────────────────────────────────
  // PART 1c: a rubric job on files - the frozen input text the found-once check proves every word against, and the label lists code
  // made from it (a label is PICKED from them, never typed). null = not a files job, or the freeze could not be read here.
  /** @type {Record<string, string>|null} */
  let inputTexts = null;
  /** @type {string[]|null} */
  let labelLists = null;
  if (lang === RUBRIC_LANG && Array.isArray(inputs) && inputs.length > 0) {
    const frozen = await readFrozenInputs(workdir, inputs.map((i) => i.label));
    if (frozen.ok) { inputTexts = frozen.texts; labelLists = labelListsFor(frozen.texts, facts?.look ?? null); }
  }
  // every rubric job drafts through the check block (src/authorjob.js builds it, with the person's answers applied); a caller that brings none (a direct authorClose call) gets the block of the look alone, nobody to ask
  if (block === null && lang === RUBRIC_LANG && inputTexts !== null && Array.isArray(jobLines)) {
    block = new CheckBlock({ texts: inputTexts, labels: (inputs ?? []).map((/** @type {any} */ i) => i.label), asks: false });
    block.fromJob(jobLines);
    block.addLook(Array.isArray(facts?.look?.facts) ? facts.look.facts : [], Array.isArray(facts?.look?.dropped) ? facts.look.dropped : []);
    block.reconcile();
  }
  /** the row-edit turn replaces the drafter's declaration for a rubric job: the model boundary and the declaration code assembles from the block's rows */
  const rowEdits = block !== null && lang === RUBRIC_LANG;
  const draftGenerate = rowEdits && editGenerate ? editGenerate : generate;
  /** the declaration of a rubric job, assembled by code from the rows: the mandatory guards, then the block's stages (hamr 2026-11-12, ruling 6), the rule rows no check carries as `refused`, the picks code recorded */
  const assemble = () => {
    const c = /** @type {CheckBlock} */ (block).reconcile();
    /** @type {{line: number, rule?: number, reason: string}[]} */
    const refused = /** @type {CheckBlock} */ (block).rows.filter((r) => r.kind === 'rule' && r.state !== 'built').map((r) => ({ line: r.line, rule: r.rule, reason: String(r.reason ?? 'not checked') }));
    // a job line no check could be built for (no stage) is refused as a line, in code's plain words, so the draft gate sees it covered and the end check (hasBuiltCheck) can say "no check" in its own words
    for (const l of jobLines ?? []) if (!c.stages.some((/** @type {any} */ st) => Array.isArray(st.fromLine) && st.fromLine.includes(l.n))) refused.push({ line: l.n, reason: REASON.noRule });
    const picks = /** @type {CheckBlock} */ (block).picksOf(c);
    // a guard's one fill slot (`allowPrefixes`) is the signed write fence, the very value the old drafter was told to copy: for a rubric job the run writes only under output/
    const fence = Array.isArray(writeScope) && writeScope.length ? [...writeScope] : ['output/'];
    return { stages: [...guards.map((/** @type {any} */ g) => ({ name: g.name, kind: g.kind, params: { ...g.params, ...Object.fromEntries((g.fill ?? []).map((/** @type {string} */ f) => [f, fence])) } })), ...c.stages], ...(refused.length ? { refused } : {}), ...(picks.length ? { picks } : {}) };
  };
  const prompt = rowEdits
    ? rowEditUserText({ jobLines: jobLines ?? [], look: facts?.look ?? null, texts: inputTexts ?? {} }) + (ticket ? `\n\n${ticketFilterBlock()}` : '')
    : authorPrompt({
      answers, questions, facts, listingBlock: /** @type {string} */ (seeds.block),
      lang, verdictType, guards, ownedEnvNames, mode: structuredMode, catalogue, writeScope, confirmed, jobLines, inputs,
      labelLists,
    }) + (ticket ? `\n\n${ticketFilterBlock()}` : '');
  // the draft gate on one settled declaration: validation, then (PART 1c, rubric) code proves, at $0, that every label is PICKED from the input's own list and every word a fact depends
  // on is really in the source (white-space blind, once is enough). A word that is not found is a red naming the word and the input; the drafter revises like it does for any validation red.
  const checkDraft = (/** @type {any} */ d) => {
    let r = validateDeclaration(d, { catalogue, listing: seedFiles, guards, envOwned: ownedEnvNames, verdictType, writeScope, jobLines, inputLabels: inputLabelsOf(inputs) });
    if (r.ok && lang === RUBRIC_LANG) {
      const words = checkDeclarationWords(r.declaration, inputTexts, facts?.look ?? null);
      if (words.length > 0) r = { ...r, ok: false, reds: [...r.reds, ...words], declaration: null };
    }
    return r;
  };
  /** @type {any[]} */
  let messages = [{ role: 'user', content: prompt }];
  /** the drafter's PROPOSED ticket filter of the accepted iteration (a Tickets job only); the person signs it, the spec carries it, the close never does @type {any} */
  let acceptedTicketFilter;
  /** @type {any[]} */
  const iterations = [];
  /** @type {any} */
  let previous = null;
  /** @type {any} */
  let accepted = null;
  /** @type {any[]|null} */
  let acceptedSeedRead = null;
  /** @type {string|null} */
  let finalFrom = null;
  /** @type {{ok: boolean, reds: Red[]}|null} */
  let lastValidation = null;
  /** @type {Red[]} */
  let fatal = [];
  let stop = 'max-revisions';
  /** @type {{stage: string, name: string}[]} */
  let droppedEnv = [];
  // F176: every MEASURED iteration (validated + seed-read, never a
  // validation-rejected one), kept in call order, so a later revision that
  // broke what an earlier one got right can be detected and reverted rather
  // than silently kept because it happened to be last. Each entry carries its
  // OWN droppedEnv — the single `droppedEnv` variable above is overwritten by
  // every measured iteration and would mismatch a fallen-back iteration.
  /** @type {{label: string, declaration: any, seedRead: any[], droppedEnv: {stage: string, name: string}[]}[]} */
  const measuredIterations = [];
  /** a measured iteration is SOUND when none of its seed-read rows instrument-stopped
   * (hamr's ruling, 2026-09-14, option A) — a real red/green verdict is sound, a
   * broken instrument is not.
   * @param {any[]} rows @returns {boolean} */
  const isSoundMeasurement = (rows) => Array.isArray(rows) && rows.every((r) => r?.verdict !== 'instrument-stop');

  /**
   * THE GOVERNANCE STOP'S OWN RED. It names the CAP and the SPEND, because the
   * operator's next move is a NUMBER — resume-to-cap is the shipped lever (the
   * stop IS the checkpoint), and a stop that reports neither side of the
   * comparison cannot be acted on. It is a governance stop, never an error: the
   * partial artifacts stay exactly where they are, nothing retries, and nothing
   * about the close itself is being judged here.
   * @param {'cap-halt'|'pricing-red'} code
   * @returns {Red}
   */
  const capRed = (code) => {
    const c = book.report();
    const spent = `$${c.knownUsd.toFixed(6)} across ${c.calls.length} metered call(s)`;
    return code === 'pricing-red'
      ? {
        code,
        path: 'budgetUsd',
        detail: `the authoring ceiling cannot be enforced: ${c.nullCostCalls} unpriced call(s) and ${c.unpricedRounds} `
          + `unpriced round(s) make the total unknown, against a $${ceilingUsd} ceiling (${spent} is the KNOWN half). `
          + 'Unpriced is never free (F6) — a cap that cannot see the spend cannot govern it, so the run stops rather '
          + 'than spending against a floor that reads as exact.',
      }
      : {
        code,
        path: 'budgetUsd',
        detail: `the authoring ceiling is spent: ${spent} against a $${ceilingUsd} ceiling. The next call was never `
          + 'made — the cap binds BETWEEN calls, so nothing was cut off mid-flight and everything paid for is on '
          + 'disk. The stop IS the checkpoint: raise the ceiling and re-run, or read what is here and stop.',
      };
  };

  /** the job lines the PREVIOUS try's validation reds named — set only when the next try may ask (null = it may not) @type {number[]|null} */
  let questionLines = null;
  /** per try: null = it passed (validated AND was measured with a work stage red); else the job lines its failure named @type {({lines: number[]}|null)[]} */
  const tryFails = [];
  /** @type {{line: number, question: string}[]} */
  let askedQuestions = [];
  /** P7 item 5: may the try AFTER try `i` ask? Only the last try of a full ladder, and only when try 1 and try `i` both failed. */
  const nextTryMayAsk = (/** @type {number} */ i) => offerQuestions && revisionCap === MAX_REVISIONS && i === revisionCap - 1
    && Array.isArray(jobLines) && jobLines.length > 0 && Boolean(tryFails[0]) && Boolean(tryFails[1]);
  const seedTrees = makeSeedTrees();
  try {
    for (let i = 0; i <= revisionCap; i += 1) {
      const label = i === 0 ? 'author' : `revise-${i}`;
      // WHICH call, and how many the ladder may make. `of` is the ENFORCED cap
      // (`revisionCap`, already clamped tighten-only) rather than the constant —
      // a readout quoting a number the loop does not obey is a second
      // instrument, and this file's own history is what that costs.
      onPhase('author-call', { call: label, i, of: revisionCap });
      // P7 item 5: a mechanism, never a wish. Only the last try of the full ladder carries the property, and only when the
      // two before it both failed (validation or the seed read; `questionLines` is set at the end of the second one, below).
      const askOpen = questionLines !== null && i === revisionCap;
      const ask = rowEdits
        ? { ...(await askStructured({ messages, generate: draftGenerate, mode: structuredMode, retries: retryCap, label, book, channel: rowEditChannel(ticket) })), declaration: null }
        : await askDeclaration({ messages, generate, mode: structuredMode, retries: retryCap, label, book, catalogue: catalogueIn, kinds: Object.keys(catalogue), verdictType, questions: askOpen, ticket });
      if (rowEdits) ask.declaration = ask.artifact;
      messages = ask.convo;
      // `ticketFilter` is never part of the declaration (the close): taken out before validation, checked by its own reader below, and kept beside the declaration
      /** @type {any} */
      let proposedFilter;
      if (ticket && ask.declaration && typeof ask.declaration === 'object' && Object.hasOwn(ask.declaration, 'ticketFilter')) {
        const { ticketFilter: tf, ...restDecl } = ask.declaration;
        proposedFilter = tf;
        ask.declaration = restDecl;
      }
      /** @type {{reason: string, raw: any}[]} */
      let droppedQuestions = [];
      if (askOpen && ask.declaration && typeof ask.declaration === 'object' && Object.hasOwn(ask.declaration, 'questions')) {
        // `questions` is never part of the declaration: stripped before validation, kept only through the machine's filter
        const { questions: rawQuestions, ...rest } = ask.declaration;
        ask.declaration = rest;
        const nq = normalizeQuestions(rawQuestions, /** @type {number[]} */ (questionLines));
        askedQuestions = nq.kept;
        droppedQuestions = nq.dropped;
      }

      // The cap tripped BEFORE this ask made any call at all, so there is no
      // iteration to record: an iteration row for a call that never happened is
      // the blind-instrument class one field wide (`ralph` already pays for the
      // sibling of this — a governance stop narrated for a loop it never
      // entered). A ladder cut SHORT is the other case and falls through: those
      // calls did happen, so the row stays and the stop is read after it.
      if (ask.budget && ask.attempts === 0) {
        fatal = [capRed(ask.budget)];
        stop = ask.budget;
        break;
      }
      /** @type {any} */
      const iter = {
        call: label, attempts: ask.attempts, declaration: ask.declaration ?? null,
        artifactRed: ask.red ?? null, providerError: ask.providerError ?? null,
        validation: null, seedRead: null, reviseTurn: null,
        ...(askOpen ? { questionsOffered: true, questions: askedQuestions, droppedQuestions } : {}),
      };
      iterations.push(iter);

      // A retry ladder cut short by the cap. The money stop OUTRANKS the artifact
      // red that was in flight: the artifact red says the model malformed, the cap
      // says we stopped paying to find out — and only the second one is why the
      // loop ended. Reporting the first would send the operator to the model when
      // the fact is the wallet.
      if (ask.budget) {
        fatal = [capRed(ask.budget)];
        stop = ask.budget;
        break;
      }

      if (ask.providerError) {
        // a transport failure is a casualty, never evidence about the model — and
        // the transport's own prose (a proxy URL, an auth echo) is scrubbed on the
        // way into a red the caller keeps
        fatal = [{ code: 'provider-red', path: label, detail: redactSecrets(ask.providerError) }];
        stop = 'provider-red';
        break;
      }
      if (!ask.declaration) {
        // hamr's ruling 2026-10-10 (live session smv2k6bczlvk3): a try whose EVERY structure attempt was cut off at the output cap
        // is a FAILED try for the question gate. A cut-off names no line, so every numbered job line counts. The ladder goes on to
        // try 3 only when that gate can open (try 1 failed too); anywhere else it stops artifact-red as it always did.
        if (ask.allCutOff && i === revisionCap - 1) {
          const allLines = (jobLines ?? []).map((l) => l.n);
          tryFails[i] = { lines: allLines };
          iter.cutOff = true;
          if (nextTryMayAsk(i)) {
            questionLines = allLines.length ? allLines : null;
            onPhase('author-try-failed', { call: label, i, of: revisionCap, reds: [scrubRed(/** @type {Red} */ (ask.red))] });
            const block = renderRejectBlock({ kind: 'artifact', reds: [/** @type {Red} */ (ask.red).detail] });
            messages = [...ask.convo, { role: 'assistant', content: '(the reply carried no text)' },
              { role: 'user', content: `${block}\n\n${structuredMode === 'tool' ? STRUCTURE_INSTRUCTION_TOOL : STRUCTURE_INSTRUCTION_TEXT}` }];
            continue;
          }
        }
        fatal = [/** @type {Red} */ (ask.red)];
        stop = 'artifact-red';
        break;
      }
      // P7 item 5: the person is asked; nothing from this try is validated, measured or signable. The reds that opened the
      // asking stay as the record of why (`lastValidation`).
      if (askedQuestions.length) {
        stop = 'questions-open';
        break;
      }

      // early stop: an unchanged declaration has the previous iteration's
      // measurements by definition — re-executing it buys nothing and costs a
      // full close
      if (previous && canonical({ d: ask.declaration, f: proposedFilter ?? null }) === canonical(previous)) {
        iter.validation = '(identical declaration — see the previous iteration)';
        iter.seedRead = '(identical declaration — see the previous iteration)';
        stop = 'unchanged';
        break;
      }
      previous = { d: ask.declaration, f: proposedFilter ?? null };

      // a rubric job: ONE reply of row edits, each judged alone by the block; the declaration is assembled from the rows (a refused edit costs the others nothing)
      let pre = ask.declaration;
      /** @type {any[]} */
      let refusedEdits = [];
      if (rowEdits) {
        const rec = /** @type {CheckBlock} */ (block).applyDelta({ label, edits: editsOf(ask.declaration) });
        refusedEdits = rec.edits.filter((/** @type {any} */ e) => e.accepted !== true);
        pre = assemble();
        iter.edits = rec.edits.map((/** @type {any} */ e) => ({ op: e?.op, accepted: e.accepted === true, ...(e.accepted === true ? {} : { refusedBecause: e.refusedBecause }) }));
        onPhase('draft-ledger-try', { label, kept: rec.edits.length - refusedEdits.length, refused: refusedEdits.map((/** @type {any} */ e) => ({ op: String(e?.op), reason: String(e.refusedBecause) })) });
      }
      let v = checkDraft(pre);
      // a gate red on the code-built declaration is OUR bug (hamr 2026-11-12, ruling 3): the plan stops in plain words, the AI is never asked to fix it
      if (rowEdits && !v.ok) {
        fatal = [{ code: 'plan-red', path: 'closeDecl', detail: `The plan code built from your checks did not pass its own gate (${v.reds.slice(0, 2).map((/** @type {Red} */ r) => `${r.code} at ${r.path || '(root)'}: ${r.detail}`).join('; ')}). That is a fault in the build, not in your job: nothing was spent on a close.` }];
        stop = 'plan-red';
        iter.validation = { ok: false, reds: v.reds.map(scrubRed), scoped: v.scoped };
        lastValidation = { ok: false, reds: v.reds.map(scrubRed) };
        break;
      }
      // MCP + tickets piece 2: a proposed ticket filter is read by the ONE reader (src/ticketfilter.js); its reds carry a legal example and go back to the drafter like any red
      if (v.ok && ticket && proposedFilter !== undefined) {
        const fr = ticketFilterReds(proposedFilter);
        if (fr.length > 0) v = { ...v, ok: false, reds: [...v.reds, ...fr], declaration: null };
      }
      // SCRUBBED HERE, once, where the reds enter this module's records — the same
      // boundary rule `renderRejectBlock` already states, applied to the OTHER
      // channel they travel down. A validation red quotes what the model declared
      // verbatim (`cmd-denied` carries the whole `cmd`, the genre-env branch carries
      // the declared value, the listing rule carries the path), and these copies are
      // PERSISTED: they ride `iterations[].validation` and this function's returned
      // `reds` into `authored.json` and into the spine (`emit('job-red', …)`), which
      // is append-only — a record that captures a key captures it forever. The
      // model-facing render was masked and the persisted twin was not.
      const vReds = v.reds.map(scrubRed);
      iter.validation = { ok: v.ok, reds: vReds, scoped: v.scoped };
      lastValidation = { ok: v.ok, reds: vReds };

      /** @type {string} */
      let measured;
      let seedFailed = false;
      if (!v.ok) {
        // a validation red IS a measurement of the declaration, so it rides the
        // same channel and counts as a revision (addendum 5)
        measured = renderRejectBlock({ kind: 'validation', reds: vReds });
        tryFails[i] = { lines: linesNamedByReds(vReds, ask.declaration, (jobLines ?? []).map((l) => l.n)) };
        // WHY this try was refused, for the drafting log and the progress line (the reds are already scrubbed)
        onPhase('author-try-failed', { call: label, i, of: revisionCap, reds: vReds, declaration: ask.declaration });
      } else {
        // what gets MEASURED is what will RUN: the resolved declaration with the
        // genre's environment already injected
        const injected = applyGenreEnv(v.declaration, lang, { sourcePrefixes, catalogue });
        droppedEnv = injected.dropped;
        // `gapKeep` defaults to EMPTY rather than being left undefined: M1
        // prefixes every gap line with it verbatim, so an unset one prints the
        // word "undefined" on every failure line the model is asked to read
        // THE LONG ONE. Every stage of the declaration spawns a real toolchain
        // against the patient, so this single await is where a run spends
        // minutes saying nothing — the per-stage line below is the whole point,
        // and the block boundary is what makes it readable.
        const stageCount = injected.declaration?.stages?.length ?? null;
        onPhase('seed-read', { call: label, stages: stageCount });
        // `onStage` sits AFTER the `closeCtx` spread beside `workdir`/`seedRef`:
        // it is the runner's own reporting channel, not a knob a caller's close
        // context may quietly redirect.
        const rows = await seedReadFn(injected.declaration, {
          gapKeep: '', ...closeCtx, workdir, seedRef, seedTrees,
          onStage: (/** @type {any} */ row) => onPhase('stage', { call: label, ...row }),
        });
        onPhase('seed-read-done', { call: label, stages: stageCount });
        iter.seedRead = rows;
        accepted = injected.declaration;
        acceptedTicketFilter = proposedFilter;
        acceptedSeedRead = rows;
        finalFrom = label;
        measured = renderSeedReadBlock(rows);
        measuredIterations.push({ label, declaration: injected.declaration, seedRead: rows, droppedEnv: injected.dropped });
        const sf = seedReadFailure(rows, injected.declaration, guards.map((/** @type {any} */ g) => g.name), (jobLines ?? []).map((l) => l.n));
        tryFails[i] = sf.failed ? { lines: sf.lines } : null;
        seedFailed = sf.failed;
        if (sf.failed) {
          const guardNames = guards.map((/** @type {any} */ g) => g.name);
          const stoppedNames = [...new Set(rows.filter((/** @type {any} */ r) => !guardNames.includes(r?.stage) && r?.verdict === 'instrument-stop').map((/** @type {any} */ r) => String(r.stage)))];
          onPhase('author-try-failed', {
            call: label, i, of: revisionCap, declaration: ask.declaration,
            reason: stoppedNames.length
              ? `a check could not run at the starting point (${stoppedNames.join(', ')})`
              : 'no check was failing at the starting point, so none of them could tell a finished job from an unfinished one',
          });
        }
      }

      // hamr 2026-11-12 (ruling 3): a rubric job revises only when the last reply had refused edits OR the seed read failed; else the plan stands
      if (rowEdits && v.ok && refusedEdits.length === 0 && !seedFailed) { stop = 'settled'; break; }
      if (i === revisionCap) { stop = 'max-revisions'; break; }

      // P7 item 5: the NEXT try is the last of a full ladder, and this one AND the first both FAILED — either failed validation
      // or failed the seed read (a vacuous close; hamr's ruling 2026-10-10, differing from fwdloop's validation-only rule) — so
      // it may ask, about the lines THIS try's failure named. A try that passed (a confident guess) never opens asking.
      if (nextTryMayAsk(i)) {
        const second = tryFails[1];
        questionLines = second && second.lines.length ? second.lines : null;
      }

      if (rowEdits) {
        // the revise turn carries each refused edit's own reason, and the seed read when it failed, and nothing else
        const blocks = [];
        if (refusedEdits.length) blocks.push(renderRejectBlock({ kind: 'edits', reds: refusedEdits.map((/** @type {any} */ e) => `edit ${String(e?.op)}: ${String(e.refusedBecause)}`) }));
        blocks.push(v.ok ? (seedFailed ? measured : '') : measured);
        const editTurn = `${blocks.filter(Boolean).join('\n\n')}\n\n${ROW_EDIT_REVISE}`;
        iter.reviseTurn = { bytes: Buffer.byteLength(editTurn) };
        messages = [...messages, { role: 'assistant', content: ask.raw.trim() || '(the reply carried no text)' }, { role: 'user', content: editTurn }];
        continue;
      }
      const turn = buildReviseTurn(measured);
      // A TRIPWIRE, not behaviour: it can only fire once something else is
      // already broken, so it is the one guard in this module the mutation
      // battery cannot kill — removing it changes no output today. It is kept
      // deliberately, and what the suite pins instead is the invariant it
      // protects: the bytes leaving this loop are exactly
      // `buildReviseTurn(renderSeedReadBlock(rows))`, so a future edit that
      // appends one helpful sentence here reds the suite either way.
      assertReviseTurn(turn, measured);
      iter.reviseTurn = { bytes: Buffer.byteLength(turn) };
      messages = [...messages, { role: 'assistant', content: ask.raw.trim() || '(the reply carried no text)' }, { role: 'user', content: turn }];
    }
  } finally {
    await seedTrees.cleanup();
  }

  // F176 (hamr's ruling, 2026-09-14, option A): "kept the last accepted
  // revision" is not the same claim as "kept the best revision" — a revise
  // loop that only checks validity per round, never soundness ACROSS rounds,
  // can silently regress on its own last try. If the last MEASURED iteration
  // is not sound (an instrument-stop, not a real red/green verdict) and an
  // earlier measured iteration IS sound, fall back to the NEWEST sound one:
  // its declaration, its seedRead, its own finalFrom label, and its own
  // droppedEnv — never the module-level `droppedEnv`, which the unsound last
  // iteration already overwrote. `stop` itself is never changed: whatever
  // stopped the ladder still stopped it for the reason it stopped it, this
  // only changes WHICH close is reported as the one that stands. Said loudly,
  // never silently: `fellBack` names it and `onPhase` reports it as it
  // happens, so a caller emitting phases to a spine or a terminal cannot miss
  // it by reading only `declaration`/`seedRead`/`finalFrom`.
  /** @type {{from: string, to: string, brokenStages: string[]}|null} */
  let fellBack = null;
  if (measuredIterations.length && !rowEdits) {
    const last = measuredIterations[measuredIterations.length - 1];
    if (!isSoundMeasurement(last.seedRead)) {
      for (let k = measuredIterations.length - 2; k >= 0; k -= 1) {
        const candidate = measuredIterations[k];
        if (isSoundMeasurement(candidate.seedRead)) {
          const brokenStages = last.seedRead
            .filter((/** @type {any} */ r) => r?.verdict === 'instrument-stop')
            .map((/** @type {any} */ r) => r.stage);
          fellBack = { from: last.label, to: candidate.label, brokenStages };
          accepted = candidate.declaration;
          acceptedSeedRead = candidate.seedRead;
          finalFrom = candidate.label;
          droppedEnv = candidate.droppedEnv;
          onPhase('author-fallback', fellBack);
          break;
        }
      }
    }
  }

  // PRD v1.131 tick 7: ONE retention record when a rubric draft ends (accepted or stopped), counts only; the panel writes it into the drafting log. Read from the block's rows.
  if (rowEdits) {
    onPhase('draft-retention', { lines: /** @type {CheckBlock} */ (block).retention() });
    onPhase('draft-ledger', { rows: ledgerRecord(/** @type {any} */ (block).rows) });
  }

  const reds = fatal.length ? fatal : (lastValidation && !lastValidation.ok ? lastValidation.reds : []);
  return {
    // `ok` means A SIGNABLE CLOSE EXISTS, and nothing more. A dead socket on a
    // LATER revise call does not invalidate a close that was already validated
    // and already measured — a casualty is never evidence (F45), and throwing a
    // paid, measured close away over a transport fault is the wrong direction.
    // Why the loop ended is never hidden: `stop` names it and `reds` carries it.
    ok: accepted !== null,
    declaration: accepted,
    ...(ticket && acceptedTicketFilter !== undefined ? { ticketFilter: acceptedTicketFilter } : {}),
    seedRead: acceptedSeedRead,
    iterations,
    reds,
    cost: book.report(),
    // WHAT THE MODEL ACTUALLY SAID, every call of it, on the run's own audit
    // trail — the scout's attempts and the declaration's, in call order, under
    // the same labels the cost book meters. `iterations` records what each turn
    // MEANT (declaration, validation, seed read); this records what it SAID, and
    // a malformation is only ever visible in the second.
    raws: book.raws(),
    facts,
    listing: seeds,
    genreEnv: { ...base.genreEnv, dropped: droppedEnv },
    finalFrom,
    // F176: null on every path where the last measured iteration was itself
    // sound, or where no measured iteration exists — byte-identical to today.
    // Non-null names WHICH iteration was dropped, WHICH one now stands, and
    // WHICH stages broke on the dropped one, so this is never a silent swap.
    fellBack,
    stop,
    // P7 item 5: what the person is asked (empty on every other stop)
    questions: stop === 'questions-open' ? askedQuestions : [],
    // the one check list's final rows against the declaration that stands (the signed close carries them as `closeDecl.list`); null = no list
    ledger: rowEdits && accepted !== null ? /** @type {CheckBlock} */ (block).signedRows() : null,
    revisions: Math.max(0, iterations.length - 1),
  };
}
