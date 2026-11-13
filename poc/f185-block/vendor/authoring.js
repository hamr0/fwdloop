// borrowed-from: bareloop src/authoring.js@v0.56.0 (3383cce)
// THE AUTHORING SURFACE — close-authoring v1, module M2 (design record
// 2026-08-07, FROZEN; gate-2 POC closed 2026-08-08).
//
// M1 owns what a stage DOES. This module owns what a declaration may SAY, and
// whether a given declaration said it legally. Three things live here and they
// belong together because they are one contract read from three sides:
//
//   1. THE KIND CATALOGUE — the entire vocabulary an authoring call has. It
//      parameterises kinds whose implementations we own; a script body, a shell
//      fragment and a new kind are not rejected late, they are INEXPRESSIBLE
//      (D2/D3, the `check-passes(name)` move). `judged-floor` and
//      `human-confirms` are LOCKED MENU ENTRIES: declaring one is a distinct
//      `locked-kind` red at VALIDATION, before any tokens, carrying counted
//      demand (the LOCKED_VERDICTS pattern, src/job.js:520). `harness-loop` is
//      ABSENT — no entry at all, so declaring it is an unknown-kind typo, which
//      is the honest reading of a kind that is out of v1 (gate 1, Result 2).
//
//   2. THE TYPES GENRE — the one genre v1 admits (D13). Its template is FROZEN
//      TEXT, byte-identical to the prereg's addendum 3, and its two guard
//      batteries are OURS. D5 is the load-bearing decision of the whole design:
//      the close carries guards the user did not ask for and cannot remove,
//      because the stage that forecloses the easy win is exactly the stage an
//      LLM asked "what would done look like" will not write well (F87 + the RSI
//      rubric-close gotcha). Gate-2 round 1 measured the failure mode precisely:
//      the guard-stripped arm DID invent a guard-SHAPED stage — with 2 of its 4
//      patterns dead letters and both live suppression channels of that patient
//      missed. The shape is cheap; the battery is what was paid for.
//
//      Round 3 added the two residues addendum 6 hands to this build, and both
//      are OURS TO INJECT, never model-filled:
//        - guard SCOPE. The suppression scan covers EVERY changed file of the
//          genre's extensions. Round 3's arm A narrowed it to the two target
//          files, which reads stricter and is not: a suppression added in a NEW
//          helper file walks straight through a target-file filter.
//        - genre ENV. `MYPYPATH` on a Python patient is the Result-5 fact no
//          user could supply and no model found (round 2 authored `src`, which
//          is wrong). It is expressed HERE as genre data and applied by the flow
//          (M3); a declaration that authors it itself is a red.
//
//   3. THE DECLARATION VALIDATOR — the first of D9's three mechanical gates.
//      Schema, kinds, params, the F84 one-population law, F49's static regex
//      reject, the D5 guard equality, and hamr's listing rule: every path the
//      model wrote down must SELECT from the real seed listing. Round 2's arm A
//      invented `src/alertEmail.js` from the user's prose ("the alert email
//      one") and silently reclassified 15 real errors into the wrong
//      population. A path is not a judgment call — it either names something in
//      the tree or it does not.
//
// What this module deliberately does NOT do:
//   - it never judges QUALITY. Nothing here asks whether the close is a GOOD
//     close; D9's other two gates (the precheck and the seed-verdict read) plus
//     the user's signature do that, and no LLM validates another LLM's close.
//   - it never enforces the genre's stage SKELETON. The template states it to
//     the author; a close with no work stage is caught by the seed-verdict read
//     (nothing red at seed = nothing to do), which is where round 2's arm B
//     died. A validator that demanded named stages would be authoring them.
//   - it never inspects command ARGS for paths. hamr's rule enumerates path
//     PARAMS; an arg list carries flags, module names and config paths, and a
//     `path-not-in-listing` red on `--strict` would be nonsense. The named
//     consequence, not smoothed: an invented path can still ride in `args`, and
//     the seed-verdict read is what catches it (it did, in round 2).
//
// One spelling of everything shared: `normalizeParser` and `regexGroups` are
// M1's, imported, never re-spelled — the validator and the executor must agree
// on what a parser MEANS or the one that grades is the one nobody validated.
// `hasNestedQuantifier` and `globToPrefix` are the shipped primitives from
// src/validate.js for the same reason (F49 is monotonic-only doctrine and the
// detector is never touched from here; globToPrefix's collapse order is fence
// territory, F9).
//
// NOTE for M4 wiring: nothing here is exported from src/index.js yet. M1
// flagged a `runClose` naming collision between the kind executor and
// src/ralph.js; the public surface is settled once at M4, not piecemeal.

import { normalizeParser, MAX_JUDGED_PATHS, JUDGED_FLOOR_KIND } from './kinds.js';
import { JUDGE_RULE_IDS, validateCard } from './judged.js';
import { rubricStepShapeReds, checkRubricParts, checkRubricRules } from './rubricstep.js';
import { isObj, isNonEmptyString, hasNestedQuantifier, globToPrefix } from './validate.js';

/** @typedef {{code: string, path: string, detail: string, [k: string]: any}} Red */
/** @typedef {{required: readonly string[], optional: readonly string[], pathParams: readonly string[], locked?: true, verdictClass: string, shape: string, asserts: string}} KindSpec */

// ── 0. THE VERDICT CLASSES ───────────────────────────────────────────────────
//
// The user's own answer (PRD v1.57 §1, restoring the 2026-07-21 radio and
// superseding D4): is your *done* machine-checkable, does it need judgment, or
// does it need a person. It is a CLOSED SET handed over enumerated, never a
// prose rule about what a legal answer would look like.
//
// TWO COPIES, PINNED BY THE SUITE RATHER THAN IMPORTED. `src/job.js` owns the
// same menu as the spec's radio (`VERDICT_TYPES`) and imports this module
// transitively (job → declaredclose → authoring), so importing it back would
// close a cycle and hand this module a TDZ-undefined constant at load. The suite
// asserts the two lists are identical, which is the same treatment
// `CATALOGUE_LIVE_KINDS` and the executor's `LIVE_KINDS` already get.

/** the whole menu, in ascending order of what it takes to render the verdict */
export const VERDICT_CLASSES = Object.freeze(['green', 'soft-green', 'hitl']);
/** declared-but-locked: selecting one is COUNTED demand, never an admission.
 * `hitl` LEFT this list at N4 slice 1 and `soft-green` at softgreen module 3
 * (see `src/job.js`'s twin, `LOCKED_VERDICTS`, which moved in the same commit) —
 * the judged floor its lock was waiting on is built, wired and calibrated.
 *
 * EMPTY is a true statement about a closed menu, not F59's absent-as-empty: the
 * mechanism is read at call time from this constant, so re-locking a class is
 * one edit and every counted refusal comes back with it. */
/** @type {readonly string[]} */
export const LOCKED_CLASSES = Object.freeze([]);
/** the classes v1 actually builds */
export const LIVE_CLASSES = Object.freeze(VERDICT_CLASSES.filter((c) => !LOCKED_CLASSES.includes(c)));

/** OFF THE MENU, but still built — a THIRD state, distinct from both lists above
 * (PRD item 31.1, hamr 2026-09-09: *"retire hitl from list, keep its code"*, and
 * *"if it's not on menu, you can't reach it, from menu"*).
 *
 * `hitl` was retired by ruling at v1.71 and the class moved to fwdloop (PRD item
 * 29), but no constant was ever updated, so `runInterview` still returned
 * `ok:true` for a hitl pick — an authorable job for a class this product no
 * longer closes.
 *
 * Why this is NOT `LOCKED_CLASSES`. Locked means INEXPRESSIBLE: no guard battery
 * exists, so `validateCloseDecl` cannot check the close and must refuse
 * (`src/declaredclose.js:306`). hitl's battery, question set, composition rule and
 * runtime all exist and are tested — locking it would make every one of them
 * unreachable, which is not "keeping the code", it is abandoning it in place with
 * its tests deleted. So the split is:
 *
 *   LOCKED_CLASSES   — no battery. Cannot be validated, cannot run. (empty today)
 *   UNLISTED_CLASSES — battery exists, validates and RUNS. Just never OFFERED.
 *   LIVE_CLASSES     — everything the system can validate and run (locked removed).
 *
 * Read by the AUTHORING surface only (`runInterview`, `authorClose`'s precheck).
 * The spec validator, the close validator and the runtime deliberately do NOT
 * read it: a hitl spec that already exists still validates and still runs, which
 * is what keeps the code alive and under test. Nothing can AUTHOR a new one.
 * @type {readonly string[]} */
export const UNLISTED_CLASSES = Object.freeze(['hitl']);

/** what the authoring interview actually OFFERS: live, minus unlisted. This is
 * "the menu" in hamr's sentence, and it is the only list an authoring refusal
 * should ever name. */
export const MENU_CLASSES = Object.freeze(LIVE_CLASSES.filter((c) => !UNLISTED_CLASSES.includes(c)));

/** the hierarchy as a comparable number. `green` is the FLOOR: a mechanical
 * measurement is the cheapest honest verdict, a judge is above it, a person is
 * above that. Read by the ceiling rule and by nothing else. */
const CLASS_RANK = Object.freeze({ green: 0, 'soft-green': 1, hitl: 2 });

/**
 * THE CEILING (hamr, 2026-08-08, *"yes to both, go"*): the picked class is a
 * PROMISE, and this is what the composition actually demands.
 *
 * Every kind carries the class of verdict it can honestly render, so a
 * declaration's ceiling is the HIGHEST class any of its stages needs. A pick
 * below that ceiling is a silent UPGRADE — a judgment ruler running under a
 * green promise, which is exactly the fake-hard verdict `CLASS_BY_CLOSE` and
 * `CLASS_BY_VERDICT` exist to stop, defeated from ABOVE by never letting the
 * illegal pair be formed.
 *
 * NO LONGER INERT: `human-confirms` (N4 slice 1) and `judged-floor` (softgreen
 * module 2) are both live and both above green, so a green declaration naming
 * one is a real red rather than a hypothetical. `classMenu` below is the other
 * half of the same rule, applied one step earlier — the composer is never handed
 * a kind this would refuse.
 *
 * A kind the catalogue does not know contributes NOTHING — it already carries an
 * `unknown-kind` red, and guessing a class for it would be deriving the promise
 * from a typo. A catalogue entry with no class at all THROWS: the catalogue is
 * OURS, and failing loudly beats weighing a kind whose honesty nobody stated.
 * @param {any} declaration
 * @param {Record<string, KindSpec>} [catalogue]
 * @returns {{class: string, kind: string, stage: string|null, locked: boolean}|null}
 */
export function closeCeiling(declaration, catalogue = KIND_CATALOGUE) {
  const stages = Array.isArray(declaration?.stages) ? declaration.stages : [];
  /** @type {{class: string, kind: string, stage: string|null, locked: boolean}|null} */
  let top = null;
  for (const s of stages) {
    if (!isObj(s) || !isNonEmptyString(s.kind)) continue;
    const spec = catalogue[s.kind];
    if (!spec) continue;
    if (!Object.hasOwn(CLASS_RANK, spec.verdictClass)) {
      throw new Error(`[authoring] catalogue kind "${s.kind}" declares no verdict class — every kind states the class `
        + `of verdict it can honestly render (one of ${VERDICT_CLASSES.join(', ')})`);
    }
    if (top === null || CLASS_RANK[spec.verdictClass] > CLASS_RANK[top.class]) {
      top = {
        class: spec.verdictClass,
        kind: s.kind,
        stage: isNonEmptyString(s.name) ? s.name : null,
        locked: spec.locked === true,
      };
    }
  }
  return top;
}

/**
 * THE MENU A JOB OF THIS CLASS MAY EXPRESS — the ceiling rule, moved one step
 * EARLIER, to the moment the composer is handed its vocabulary.
 *
 * `closeCeiling` refuses an above-ceiling kind AFTER a paid call has composed a
 * declaration around it. That is a late red for an illegal pick the composer was
 * shown in its own catalogue and its own tool schema — and the standing rule is
 * the opposite: wherever only a closed set can satisfy a field, hand over the
 * enumerated set, so the illegal value is INEXPRESSIBLE rather than rejected
 * after the fact (the `check-passes(name)` model). A green job is therefore never
 * shown `judged-floor` or `human-confirms` at all.
 *
 * ONLY THE MENU NARROWS. The VALIDATOR keeps the whole catalogue, deliberately:
 * a model that names a kind it was never offered must be told which RULE it
 * broke (`class-ceiling`), not that the kind does not exist (`unknown-kind`) —
 * one is the truth and the other invites it to invent a spelling.
 *
 * `null` means UNFILTERED and exists for callers inspecting the catalogue itself
 * (the schema/coverage suite). Every composing call site passes the user's own
 * picked class; `authorPrompt` already throws without one.
 * @param {string|null} verdictType
 * @param {Record<string, KindSpec>} [catalogue]
 * @returns {string[]} kind names at or below the picked class, in catalogue order
 */
export function classMenu(verdictType, catalogue = KIND_CATALOGUE) {
  const names = Object.keys(catalogue);
  if (verdictType === null || verdictType === undefined) return names;
  const picked = String(verdictType);
  if (!Object.hasOwn(CLASS_RANK, picked)) {
    throw new Error(`[authoring] no verdict class "${picked}" — the menu a composer may be handed is keyed by the `
      + `class the user picked, one of ${VERDICT_CLASSES.join(', ')}, and guessing one would compose under a promise `
      + 'nobody made');
  }
  return names.filter((k) => {
    const spec = catalogue[k];
    if (!spec || !Object.hasOwn(CLASS_RANK, spec.verdictClass)) {
      throw new Error(`[authoring] catalogue kind "${k}" declares no verdict class — every kind states the class of `
        + `verdict it can honestly render (one of ${VERDICT_CLASSES.join(', ')})`);
    }
    return CLASS_RANK[spec.verdictClass] <= CLASS_RANK[picked];
  });
}

// ── 1. THE KIND CATALOGUE ────────────────────────────────────────────────────

/**
 * The whole vocabulary, as DATA. `shape` and `asserts` are the strings the
 * authoring prompt renders (M3) — the prompt and this validator must judge the
 * same facts, so they read one catalogue rather than two (the drift class
 * SECRET_PATTERNS exists to prevent, one layer up).
 *
 * `pathParams` names every param that carries a repository path, in dotted
 * form. It is data rather than a switch so hamr's listing rule reaches a new
 * path-bearing param the day one is added, instead of the day someone
 * remembers to widen a condition.
 *
 * `verdictClass` is the class of verdict this kind can HONESTLY render, and it
 * is what makes the user's pick a promise the composer must keep (PRD v1.57 §1).
 * Every live kind is `green` — a command's measurement is the truth — so the
 * ceiling rule is inert in v1 by construction; the two locked kinds carry the
 * classes they belong to so the rule is already correct the day one goes live.
 *
 * Optionality is read off the prereg §5 table, with ONE deliberate divergence
 * from the gate-2 POC validator, named because it reverses a POC behaviour:
 * `pattern-absent-in-diff.scope` is OPTIONAL here and the guard ships without
 * it. Under addendum 6 the guard's scope is GENRE property and the answer is
 * "every changed file of these extensions" — an absent scope is exactly that
 * (M1's `inScope` admits everything when no scope object is present). The POC
 * required it, and required it filled, which is how round 3's arm A came to
 * narrow the scan and call it stricter.
 * @type {Record<string, KindSpec>}
 */
export const KIND_CATALOGUE = Object.freeze({
  'command-exit': Object.freeze({
    verdictClass: 'green',
    required: Object.freeze(['cmd', 'args', 'expectExit']),
    optional: Object.freeze(['timeoutMs', 'env']),
    pathParams: Object.freeze([]),
    shape: 'cmd: string, args: string[], expectExit: integer, timeoutMs?: integer, env?: {NAME: value}',
    asserts: 'run cmd/args in the repository; the exit code must equal expectExit.',
  }),
  'count-not-worse': Object.freeze({
    verdictClass: 'green',
    required: Object.freeze(['cmd', 'args', 'parser', 'scope', 'direction', 'baseline']),
    optional: Object.freeze(['timeoutMs', 'env']),
    pathParams: Object.freeze(['scope.includePrefixes', 'scope.excludePrefixes']),
    shape: 'cmd: string, args: string[], '
      + 'parser: {terms: [{lineMatch: regex-string, capture?: integer, sign: 1 | -1, '
      + 'aggregate: "first" | "sum", region: "whole-output" | {anchor: regex-string, capture: integer}}]} '
      + '— or the short form {lineMatch: regex-string, capture?: integer}, '
      + 'scope: {includePrefixes?: string[], excludePrefixes?: string[]}, '
      + 'direction: "lower-is-better" | "higher-is-better", baseline: "seed" | 0, timeoutMs?: integer, env?: {NAME: value}',
    asserts: 'run cmd/args; read a NUMBER out of the output with parser, keep only what scope selects, and '
      + 'require that number to be not-worse than baseline in the stated direction. baseline "seed" is the same '
      + 'number taken from this run\'s own starting point, measured every run; baseline 0 is literally zero. '
      + 'You never write a number you measured yourself — you write the rule. '
      + 'If the tool exits NON-ZERO and its output matches none of your parser\'s terms, the stage stops as a broken '
      + 'instrument rather than recording zero: a crashed checker reporting nothing is unknown, not clean. Name a '
      + 'tool that prints its count on a clean run.',
  }),
  'pattern-absent-in-diff': Object.freeze({
    verdictClass: 'green',
    required: Object.freeze(['patterns', 'extensions']),
    optional: Object.freeze(['scope']),
    pathParams: Object.freeze(['scope.includePrefixes', 'scope.excludePrefixes']),
    shape: 'patterns: [{id: string, regex: regex-string}], extensions: string[], '
      + 'scope?: {includePrefixes?: string[], excludePrefixes?: string[]}',
    asserts: 'none of the patterns may appear in any line this run ADDED, across every file this run changed '
      + 'with one of the named extensions.',
  }),
  'files-changed': Object.freeze({
    verdictClass: 'green',
    required: Object.freeze(['allowPrefixes', 'requireNonEmpty']),
    optional: Object.freeze([]),
    pathParams: Object.freeze(['allowPrefixes']),
    shape: 'allowPrefixes: string[], requireNonEmpty: true',
    asserts: 'the set of files this run changed must be non-empty and must lie wholly inside allowPrefixes.',
  }),
  // LIVE at softgreen module 2, and the only kind that BUYS its measurement: a
  // pinned toolless judge extracts facts WITH QUOTES from each named artifact and
  // an arbiter-owned rulebook renders the verdict over them (src/judged.js). The
  // judge never says whether anything passed — a model asked "did this pass?" is
  // a model that can be argued with, and bareguard's A/B measured that
  // `judgeLocate` is not injectable where `judgeVerdict` is.
  //
  // `card` is the signer's own rubric, compiled to ENUMERATED items: `rule`
  // SELECTS from the rulebook we implement, so a rule we do not own is
  // inexpressible rather than rejected late, and `text` is the signer's words —
  // what a red is explained WITH, never what a red is decided BY. `paths` names
  // the AUTHORITATIVE artifacts, selected from the seed listing like every other
  // path, never the worker's summary of what it did.
  //
  // No `timeoutMs` and no `env`: this kind spawns nothing. Its own bounds are the
  // arbiter's (the retry ladder and the artifact ceiling live in src/kinds.js),
  // because a declaration that could widen them is a declaration that can spend.
  'judged-floor': Object.freeze({
    verdictClass: 'soft-green',
    required: Object.freeze(['card', 'paths']),
    optional: Object.freeze([]),
    pathParams: Object.freeze(['paths']),
    shape: `card: {items: [{rule: ${JUDGE_RULE_IDS.join('|')}, text: string}]}, paths: string[] (at most ${MAX_JUDGED_PATHS})`,
    asserts: 'a pinned judge extracts facts and VERBATIM quotes from each named artifact, and an arbiter-owned rulebook '
      + 'renders pass/fail per card item over those facts — first red wins, and anything it cannot be sure of is a red. '
      + 'Name one card line per thing you actually look for, in the order you look for them, and name the real files the '
      + 'work lands in. It is never offered to the agent as an in-run check.',
  }),
  // PART 1a (docs/product/ITEM33-BUILD.md, "Addendum 2026-10-12"): the rubric job on LOCAL FILES. One stage per numbered job
  // line, reading the one file that line leaves behind (output/steps/N.json). It measures nothing with a command and buys
  // nothing: bareguard's rubric primitive grades the file against the person's own counted limits and quotes. It exists only in
  // the text genre's menu (`catalogueForLang`) — a code job never sees it. `parts` is the person's constraints on the line,
  // each SORTED by the drafter into a class; only `countable` parts become checks, and the validator reds the rest in plain
  // words (`checkRubricParts`), so no signed stage carries a part this build cannot run.
  'rubric-step': Object.freeze({
    verdictClass: 'green',
    required: Object.freeze(['step', 'parts']),
    optional: Object.freeze([]),
    pathParams: Object.freeze([]),
    shape: 'step: integer (the job line number), parts: [{text: string, class: "countable" | "fact" | "judged" | "guard" | "none", '
      + 'check?: "cited" | "minClaims" | "maxClaims", value?: integer, '
      + 'source?: string (an input label), domains?: string[], rules?: integer[], '
      + 'fact parts: facts?: [{name, shape: "money"|"number"|"date"|"time"|"phrase"|"text", unit?|currency? (each one value or a list; money names at least one), phrase?, anchor?, until?, '
      + 'rule?: {op, value | lo+hi}, aiProposal?: boolean}], count?: {min?, max?}}]',
    asserts: 'the file output/<step>.json under output/steps/ exists, is a JSON object, and its "text" is present and within the '
      + 'limits the person asked for. Write ONE rubric-step stage per numbered job line (step = that line number, fromLine = [that line]). '
      + 'In "parts" list each constraint the person put on that line, in their own words, and SORT it: "countable" when a machine can '
      + 'quote it (word, section, line, list-item and phrase counts are never yours: code adds the ones the person picked) or '
      + 'when claims must be backed by a quote from a named input (check cited, source = the input label), or when a number of '
      + 'quoted claims is asked for (minClaims / maxClaims with value and source: it counts the claims listed under that input); '
      + 'a line that FINDS, LISTS or LOOKS UP something gets ONE part of class "fact" instead (source = the input label, '
      + 'facts = the required facts, count = how many results): its step file holds only filled facts and no free text, so '
      + 'give such a line no word, section or claim-count parts; list in "rules" the number of every ~ rule a part carries out; '
      + '"judged" when only reading '
      + 'it could decide; "guard" for a rule about web sources (domains); "none" when you cannot sort it. Never turn a part you cannot '
      + 'count or quote into a countable one by guessing a number.',
  }),
  // LIVE at N4 slice 1, and the ONLY kind that does not measure anything: it
  // does not RUN, it PAUSES the run and hands the tree to a person (ruling 1).
  // `ask` is the whole parameter surface — no cmd, no timeoutMs, no env — so a
  // human stage cannot spawn, cannot be env-capable, and cannot be given a
  // second job. `offer` is never one of its fields either: ruling 5's law is a
  // LAW, checked by the validator, not a knob the composer sets.
  'human-confirms': Object.freeze({
    verdictClass: 'hitl',
    required: Object.freeze(['ask']),
    optional: Object.freeze([]),
    pathParams: Object.freeze([]),
    shape: 'ask: string',
    asserts: 'a PERSON renders this verdict, at the end of the run, and nothing about it is measured. Write `ask` as '
      + 'the plain question they answer while looking at the finished result. It is always the LAST stage, it is '
      + 'never offered to the agent as an in-run check, and every part of the job a command can decide belongs in a '
      + 'mechanical stage before it.',
  }),
});

/**
 * Which kinds can carry an environment at all, read off the CATALOGUE rather
 * than a hand-kept list. ONE spelling, because two consumers must agree
 * EXACTLY: `applyGenreEnv` injects the genre's variable into these stages and
 * nowhere else, and the validator's completeness rule demands it on these
 * stages and nowhere else. A second copy that drifted either way is a hole —
 * stages injected but unchecked, or stages checked for what nothing injects.
 * @param {string} kind @param {Record<string, KindSpec>} [catalogue]
 */
export function envCapableKind(kind, catalogue = KIND_CATALOGUE) {
  const spec = catalogue[kind];
  return !!spec && !spec.locked && [...spec.required, ...spec.optional].includes('env');
}

export const CATALOGUE_KINDS = Object.freeze(Object.keys(KIND_CATALOGUE));
export const LOCKED_KINDS = Object.freeze(CATALOGUE_KINDS.filter((k) => KIND_CATALOGUE[k].locked));
/** the catalogue's live half — asserted EQUAL to the executor's own LIVE_KINDS
 * by the suite, both directions: a kind the catalogue offers and the executor
 * cannot run is a close that stops at runtime, and a kind the executor runs
 * that the catalogue never names is a capability nothing can reach. */
export const CATALOGUE_LIVE_KINDS = Object.freeze(CATALOGUE_KINDS.filter((k) => !KIND_CATALOGUE[k].locked));

/**
 * The catalogue a close of this language may use. A rubric job on local files (`RUBRIC_LANG`) sees only
 * {@link RUBRIC_LANG_KINDS}; every code language sees the whole catalogue MINUS the rubric-only kinds, so a code job's
 * composer, schema and validator can never reach for a stage that reads step files. One filter, both directions.
 * @param {string|null|undefined} lang
 * @param {Record<string, KindSpec>} [catalogue]
 * @returns {Record<string, KindSpec>}
 */
export function catalogueForLang(lang, catalogue = KIND_CATALOGUE) {
  const keep = lang === RUBRIC_LANG
    ? (/** @type {string} */ k) => RUBRIC_LANG_KINDS.includes(k)
    : (/** @type {string} */ k) => !RUBRIC_ONLY_KINDS.includes(k);
  return Object.freeze(Object.fromEntries(Object.entries(catalogue).filter(([k]) => keep(k))));
}

export const DIRECTIONS = Object.freeze(['lower-is-better', 'higher-is-better']);
/** D12: the close stores the COUNTING RULE, never the number. "seed" is measured
 * at this run's own seed every run; 0 is literally zero. A frozen constant (the
 * hand-written closes' `SEED_ERRORS 63`) is exactly what this menu retires. */
export const BASELINES = Object.freeze(['seed', 0]);
/** a runaway stage list is a red, not a bill — the sibling of M1's MAX_TERMS */
export const MAX_STAGES = 12;

const NAME_RE = /^[a-z][a-z0-9-]{1,48}$/;

/**
 * THE DENY FLOOR under a declared command (hamr's ruling, PRD v1.57 §3: *"there
 * should be a floor of all dangerous things… straight out block… no one wants
 * `rm -rf` allowed either ways"*).
 *
 * Four families, and each one is here for a different reason:
 *   - SHELL INTERPRETERS. A shell runs anything, so admitting one makes every
 *     other entry decoration — the D3 line ("the danger is in the ACTIONS, not
 *     the SYNTAX") reappearing at the close's own spawn.
 *   - DESTRUCTIVE / SYSTEM commands. The `rm -rf` class the ruling names, plus
 *     the machine-level siblings (`dd`, the `mkfs` FAMILY, shutdown/reboot) and
 *     privilege escalation.
 *   - FETCH-AND-RUN vectors (`curl`, `wget`). A close that downloads its own
 *     instrument is a close nobody signed.
 *   - INDIRECTION (`env`, `eval`, `exec`, `xargs`). They run a program the
 *     declaration never names, which defeats every entry above by construction.
 *
 * It is a FLOOR, and MONOTONIC: names are only ever ADDED, never removed or
 * narrowed (the F49 precedent — closing a false negative is the allowed
 * direction; chasing a false positive is not). A legitimate runner refused here
 * is fixed by declaring the runner, never by shrinking the floor.
 *
 * It is NOT A SANDBOX, and nothing here claims to be one. The local-trust model
 * of v1.41 stands intact and its limitations are written out in PRD v1.57 §3:
 * close children keep the operator's OS user, network egress and file access;
 * `args` are not inspected (`node -e <anything>` is reachable and always was);
 * resource use is bounded by liveness checks, not quotas. The floor narrows
 * blast radius; it does not promise containment.
 */
export const DENIED_COMMANDS = Object.freeze([
  // shell interpreters
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish',
  // destructive / system
  'rm', 'rmdir', 'dd', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff',
  'sudo', 'su', 'chmod', 'chown', 'kill', 'killall', 'pkill',
  // fetch-and-run
  'curl', 'wget',
  // indirection — a program the declaration never named
  'env', 'eval', 'exec', 'xargs',
]);

/**
 * The floor's decision for one declared `cmd`, as a reason or null.
 *
 * NORMALISATION FIRST, because that is where the dodge lives: `/usr/bin/rm`
 * carries the same program as `rm` and only a basename read taken AFTER
 * splitting the path can see it. Case is folded for the same reason.
 *
 * A cmd naming a program OUTSIDE the repository — an absolute path, or one that
 * climbs out with `..` — is refused whatever its basename says. Two reasons, and
 * both are the fail-safe direction: the validator has no repository in hand at
 * every call site (the job validator judges a signed spec with no tree), so
 * "outside" cannot be decided per-machine; and a machine-absolute path inside a
 * SIGNED artefact grades a different machine than the one it was signed on.
 * @param {string} cmd @returns {string|null}
 */
export function deniedCommandReason(cmd) {
  const raw = String(cmd ?? '').trim();
  if (raw === '') return null; // shape is the schema walk's business, not the floor's
  const segments = raw.split(/[\\/]/);
  // `/^[a-zA-Z]:/` is the DRIVE-ABSOLUTE spelling, and it is here because
  // `scopeContained` (src/validate.js) already counts it as an escape: two
  // path-escape readings in one codebase that disagree are two instruments, and
  // this was the one that let `C:\Windows\System32\evil.bat` through to the
  // basename floor, which had never heard of it. MONOTONIC — this only ever adds
  // a rejection, which is the direction F49's precedent licenses.
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[a-zA-Z]:/.test(raw) || segments.includes('..')) {
    return `"${raw}" names a program outside the repository — a declared close runs the patient's own tools, `
      + 'reached relatively or through the project\'s runner, never an absolute path (which grades a different '
      + 'machine than the one that signed it)';
  }
  const base = /** @type {string} */ (segments.at(-1)).toLowerCase();
  const denied = DENIED_COMMANDS.includes(base) || base.startsWith('mkfs.');
  if (!denied) return null;
  return `"${raw}" resolves to "${base}", which is on the deny floor — shells, destructive and system commands, `
    + 'fetch-and-run vectors and program indirection are blocked outright (PRD v1.57 §3). A close names the '
    + 'patient\'s own instrument; it never names a program that can undo the patient';
}

// ── 2. THE TYPES GENRE ───────────────────────────────────────────────────────

/**
 * THE TYPES GENRE TEMPLATE — six policy points, VERBATIM against
 * `docs/product/ITEM33-BUILD.md`'s own frozen block (PRD item 33 M3 piece 4,
 * D6 = A ruling, 2026-09-14). This SUPERSEDES the original prereg-frozen
 * version (`docs/logs/2026-08-08-close-authoring-gate2-poc-prereg.md`,
 * addendum 3, the closed record — never edited): that version stated the
 * WORK-stage skeleton (typecheck, typecheck-outside, tests-kept,
 * suite-green) and the checker's STRICT form as UNCONDITIONAL law, which
 * conflicted with ruling 6's "a genre never adds a check the goal did not
 * ask for" — run mtv8jihy's unasked `tsc --strict` stage is the case this
 * cures. Composing those stages/strictness only for a CONFIRMED check
 * (never a code matcher over prose, same reasoning as the no-shell law) is
 * enforced here, in the prompt; the GUARDS (changed-from-seed,
 * no-suppressions) are enforced separately and structurally
 * (`classGuards` + `validateDeclaration`'s `guards-absent` red), so making
 * the WORK stages conditional here changes nothing about their own
 * always-on status. The suite reads the SIGNED block and compares BYTES, so
 * a paraphrase here fails the build rather than quietly changing what every
 * future close is authored against. It deliberately carries no
 * repo-specific command, path, env value or regex: round 2 measured that
 * stating the LAW still leaves the model to find the VALUE, and that is the
 * axis the build must keep live.
 */
export const TYPES_GENRE_TEMPLATE = `1. The STRICT form of the language's type checker is used only when a confirmed check — or,
   absent a confirm turn, the goal and interview answers — asks for strict typing; otherwise the
   checker runs at whatever strictness the repo's own scripts already use.
2. Tools are invoked so their binaries actually resolve — through the project's own package
   runner or language module runner, never a bare binary name.
3. The WORK stages — typecheck (error count IN the target scope, baseline 0, lower-is-better),
   typecheck-outside (error count OUTSIDE the target scope, baseline measured at seed, a
   ceiling — required whenever a typecheck stage is scoped to a subset of the tree), tests-kept
   (a floor on tests that actually EXECUTED, baseline at seed, higher-is-better; a skipped or
   deselected test did not run and must not count), and suite-green (the suite exits clean AND
   reports zero failing tests — two assertions) — are composed ONLY for the checks a confirmed
   plan asked for (or, absent a confirm turn, the goal and interview answers). The GUARDS —
   changed-from-seed and no-suppressions — are composed always, first-red-wins:
   changed-from-seed before every WORK stage, no-suppressions last.
4. One population per stage — two structurally different counts never share a stage.
5. The checker must judge the PATIENT's own tree: if imports could resolve to an installed or
   editable copy elsewhere, the environment is set so they resolve inside the patient.
6. A number the tool did not report is unknown, never zero.`;

export const GENRE_LANGUAGES = Object.freeze(['js', 'python']);

/**
 * PART 1a: the "language" of a RUBRIC job on local text files. It is not a code language and carries no suppression
 * battery, no environment and no instruments — it only lets such a close declare which genre-shaped guards apply to it
 * (`classGuards`) without pretending the file is JavaScript. `GENRE_LANGUAGES` stays the code-language menu (it is what a
 * repo job's language detection and the confirm turn offer); this is the one extra value a close may DECLARE.
 */
export const RUBRIC_LANG = 'text';
/** the genre label a close over local text files carries (`closeDecl.genre`); the code languages' is `TYPES_GENRE.name`. Never the other's. */
export const TEXT_GENRE = 'TEXT';
/** @param {unknown} lang @returns {string} the genre a close of this language is authored under */
export function genreForLang(lang) { return lang === RUBRIC_LANG ? TEXT_GENRE : TYPES_GENRE.name; }
/** every `closeDecl.lang` a close may declare: the code languages plus the rubric-files one */
export const DECLARABLE_LANGUAGES = Object.freeze([...GENRE_LANGUAGES, RUBRIC_LANG]);
/** the kinds that exist only for a rubric job on local files — a code job's menu, schema and validator never offer them */
export const RUBRIC_ONLY_KINDS = Object.freeze(['rubric-step']);
/** the whole kind menu of a rubric job on local files: the one machine guard that applies to a file tree, plus its own stage */
export const RUBRIC_LANG_KINDS = Object.freeze(['files-changed', 'rubric-step']);
/** the rubric-files language's data, all declared-empty (never an absent field that would read as "not looked into", F59) */
const TEXT_LANGUAGE = Object.freeze({
  suppressions: Object.freeze([]), extensions: Object.freeze([]), env: Object.freeze([]), instruments: Object.freeze([]),
});

/**
 * The js `any` suppression pattern's regex, ONE spelling: the TYPES js battery
 * below composes it into the signed guard, and `anySuppressionWarning` keys on
 * it, so the warning and the guard cannot drift. The guard scans every ADDED
 * line, comments included, so plain prose like ", any" trips it.
 */
const JS_ANY_REGEX = '(?:[{<|(\\[:,]|\\bas)\\s*any\\b|\\bany\\[\\]';

/** The worker-facing line that rides with the js `any` guard (run mv13ery3). */
export const ANY_SUPPRESSION_WARNING = '\nThe no-suppressions check also reads comments: never write the word any right after a comma, colon, bracket, brace, < or | '
  + "(e.g. ', any', ': any', '(any'), even in plain English — write 'every', start the clause differently, or put it in backticks.";

/**
 * The warning line for a job whose ACTUAL stages carry the js `any` pattern, else
 * ''. Derived from the stages' patterns (never goal prose), so a job without the
 * guard is told nothing about it.
 * @param {any[]|null|undefined} stages
 * @returns {string}
 */
export function anySuppressionWarning(stages) {
  const has = Array.isArray(stages) && stages.some((s) => isObj(s) && s.kind === 'pattern-absent-in-diff'
    && isObj(s.params) && Array.isArray(s.params.patterns)
    && s.params.patterns.some((/** @type {any} */ q) => isObj(q) && q.regex === JS_ANY_REGEX));
  return has ? ANY_SUPPRESSION_WARNING : '';
}

/**
 * THE GENRE, as data. The suppression batteries are the hand-written closes'
 * own `SUPPRESSIONS` tables (`scripts/u-pulselog-close.mjs:35`,
 * `scripts/u-spawner-close.mjs:34`) — operator-owned genre knowledge, minted by
 * paying for live runs. `unknown` is deliberately NOT a JS suppression and not
 * a Python one: it forces narrowing at the use site, which is real typing work.
 *
 * `env` is the addendum-6 residue expressed as data. Python's `MYPYPATH` is
 * load-bearing and was found by probe, never by reading: the aurora patient sets
 * `explicit_package_bases`, so without it a sibling import falls through to an
 * editable install pointing at a DIFFERENT checkout and a cross-module fix is
 * graded against unedited source. It moves no seed number, which is why no
 * seed-verdict read can ever catch its absence — the only place it can live is
 * here, in genre data, injected by the flow.
 */
export const TYPES_GENRE = Object.freeze({
  name: 'TYPES',
  template: TYPES_GENRE_TEMPLATE,
  languages: Object.freeze({
    js: Object.freeze({
      suppressions: Object.freeze([
        Object.freeze({ id: 'ts-ignore', regex: '@ts-ignore' }),
        Object.freeze({ id: 'ts-expect-error', regex: '@ts-expect-error' }),
        Object.freeze({ id: 'ts-nocheck', regex: '@ts-nocheck' }),
        Object.freeze({ id: 'eslint-disable', regex: 'eslint-disable' }),
        Object.freeze({ id: 'any', regex: JS_ANY_REGEX }),
        Object.freeze({ id: 'any-star', regex: '@\\w+\\s*\\{\\s*[*?]\\s*\\}' }),
        Object.freeze({ id: 'cast', regex: '@type\\s*\\{.*\\}\\s*\\*\\/\\s*\\(' }),
      ]),
      extensions: Object.freeze(['.js', '.mjs', '.cjs']),
      /** no import-resolution hazard on this runner — an EMPTY list, declared,
       * never an absent field that would read as "not looked into" (F59) */
      env: Object.freeze([]),
      instruments: Object.freeze([
        Object.freeze({
          id: 'tsc-error-line',
          what: 'one type error, as the TypeScript checker prints it',
          lineMatch: 'error TS\\d+',
          capture: null,
          // REAL, from the captured `npm run typecheck -- --strict` of the pulselog
          // patient (2026-08-09): 67 error lines, every one in this shape.
          example: 'src/backup.js(21,19): error TS7006: Parameter \'now\' implicitly has an \'any\' type.',
          why: 'tsc prints a DIFFERENT shape on a terminal (`src/backup.js:21:19 - error TS7006:`) than through a '
            + 'pipe, and a close only ever reads the piped one. Run msmbpjk6 composed the terminal shape: it matched '
            + '0 of 67 real error lines while the tool exited 2, so the stage read a crashed instrument. This pattern '
            + 'is anchored on the CODE, not on the path spelling, so it reads both shapes and cannot lose that flip.',
        }),
        // ── node --test, the SAME pipe-vs-terminal trap, MEASURED ──────────────
        //
        // PROVENANCE, two independent halves.
        //
        // (1) REAL CAPTURED OUTPUT. The mailproof job-#2 battery's own spines carry
        // whole `npm test` → `node --test` captures inside their `close-precheck`
        // gap: `bareloop-patients/mailproof-job2-bareloop/battery-P1-mrm7gk25.jsonl`
        // (`# tests 317` / `# pass 312` / `# fail 5`, five `not ok` lines) and
        // `battery-P2-mrm7gk25.jsonl` (`# pass 316` / `# fail 1`). Nothing there was
        // written to match a pattern — it is what the runner printed down the close's
        // pipe, months before this table existed.
        //
        // (2) A SHIPPED, LIVE-FIRED SPELLING. `jobs/pulselog-author-types.json`
        // already grades `^# pass (\d+)$` and `^# fail (\d+)$` (stages `tests-kept`
        // and `test-suite-zero-failures`), and run msoc6t8v graded green through it.
        // The table is not minting a new ruler; it is HANDING OVER the one the tree
        // already grades with, the way the tsc term does.
        //
        // WHY IT IS THE TSC TRAP AGAIN, measured on this machine (node v22.22.2,
        // one test file, identical args, 2026-08-13): through a PIPE the runner
        // prints TAP — `TAP version 13`, `# pass 1`, `not ok 2 - b`; on a real pty it
        // prints the spec reporter — `ℹ pass 1`, no `#`, no TAP at all. A close only
        // ever reads the piped half, and a pattern composed against the pretty half
        // matches nothing while the suite runs fine. Exactly what cost run msmbpjk6
        // its authoring pass on tsc, waiting behind a second tool.
        Object.freeze({
          id: 'node-test-total-count',
          what: 'how many tests the runner EXECUTED, off the TAP summary',
          lineMatch: '^# tests (\\d+)$',
          capture: 1,
          example: '# tests 317',
          why: 'the EXECUTED count is the honest denominator: a passed-count floor is satisfiable by a suite that '
            + 'stopped running, so a stage asking "is the suite still whole?" counts this, not passes. Anchored '
            + 'both ends because the runner prefixes ordinary chatter with the same `# ` (`# Subtest: <name>`), and '
            + 'an unanchored `# tests` would count test NAMES.',
        }),
        Object.freeze({
          id: 'node-test-pass-count',
          what: 'how many tests passed, off the TAP summary',
          lineMatch: '^# pass (\\d+)$',
          capture: 1,
          example: '# pass 316',
          why: 'the spelling `jobs/pulselog-author-types.json` already grades with, green through run msoc6t8v. '
            + 'The runner prints this line on a green run too, so a zero here is a REPORTED zero.',
        }),
        Object.freeze({
          id: 'node-test-fail-count',
          what: 'how many tests failed, off the TAP summary',
          lineMatch: '^# fail (\\d+)$',
          capture: 1,
          example: '# fail 1',
          why: 'this runner prints every counter on every run — a fully green suite still prints `# fail 0` '
            + '(measured), so reading the figure cannot confuse "no failures" with "never reported". Its pytest '
            + 'counterpart has no such guarantee, which is why python has no fail-COUNT term.',
        }),
        Object.freeze({
          id: 'node-test-failed-line',
          what: 'one failing test, as the TAP reporter names it',
          lineMatch: '^not ok \\d+ ',
          capture: null,
          example: 'not ok 7 - edit-renotify: a non-participant edit, and edits on a pending event, ping no one',
          why: 'one line per failing test, so it TALLIES and no match is a genuine counted zero. The trailing '
            + 'space and the `^` both carry weight: every passing test prints `ok 7 - …`, and without the anchor '
            + 'each of those would count as a failure.',
        }),
      ]),
    }),
    python: Object.freeze({
      suppressions: Object.freeze([
        Object.freeze({ id: 'ignore', regex: '#\\s*type:\\s*ignore' }),
        Object.freeze({ id: 'any', regex: '\\bAny\\b' }),
        Object.freeze({ id: 'cast', regex: '\\bcast\\s*\\(' }),
        Object.freeze({ id: 'noqa', regex: '#\\s*noqa' }),
        Object.freeze({ id: 'mypy-disable', regex: '#\\s*mypy:\\s*disable' }),
      ]),
      extensions: Object.freeze(['.py']),
      env: Object.freeze([
        Object.freeze({
          name: 'MYPYPATH',
          from: 'sourcePrefixes',
          join: ':',
          why: 'mypy must name the PATIENT\'s modules: without it a sibling import resolves through an editable '
            + 'install to a different checkout, and a cross-module fix is graded against unedited source (Result 5, '
            + 'found by probe). It moves no seed number, so no seed-verdict read can see its absence.',
        }),
      ]),
      instruments: Object.freeze([
        Object.freeze({
          id: 'mypy-error-line',
          what: 'one type error, as mypy prints it',
          lineMatch: ' error: ',
          capture: null,
          // REAL, from a live aurora run's own spine
          // (bareloop-patients/aurora-u-bareloop/u-ms2c0ls7.jsonl).
          example: 'packages/spawner/src/aurora_spawner/timeout_policy.py:89: error: Statement is unreachable  [unreachable]',
          why: 'the operator\'s own hand-written close reads mypy this way (scripts/u-spawner-close.mjs:133), minted '
            + 'by paid live runs. It is anchored on the SEVERITY word, not on the path spelling, so a relative or '
            + 'absolute path, a package prefix or a config-driven root all read the same.',
        }),
        // ── pytest, from the aurora battery's own captured runs ────────────────
        //
        // PROVENANCE: six `close-precheck` gaps in
        // `bareloop-patients/aurora-soar-bareloop/battery-A{1..4}-*.jsonl` carry the
        // whole captured pytest run of the aurora patient (pytest 9.1.1, python
        // 3.14.6, the patient's own `pytest.ini` addopts, which include `-ra`) —
        // 2,690-odd tests, the `short test summary info` section and the final counts
        // line. Real, uncrafted, paid for.
        //
        // WHAT IS NOT ANCHORED, and why. Every archived counts line arrives padded
        // with `=` on both sides, and the padding WIDTH is terminal-derived: the
        // archived long line gets exactly one `=` per side, a short local run gets
        // twenty-five (measured, pytest 9.0.2, 2026-08-13). Under `-q` the padding is
        // absent entirely. So the term anchors on the WORD and its number, never on
        // the decoration — the same discipline as anchoring tsc on the code rather
        // than the path.
        Object.freeze({
          id: 'pytest-pass-count',
          what: 'how many tests passed, off pytest\'s final counts line',
          lineMatch: '(\\d+) passed',
          capture: 1,
          example: '= 1 failed, 2690 passed, 3 skipped, 18 deselected, 1775 warnings in 326.12s (0:05:26) =',
          why: 'the ONE segment of this line pytest prints whether the run was green or red, so it is the only '
            + 'count on it that can be read as a figure without risking "never reported". The other segments '
            + '(failed, skipped, deselected) are omitted when their count is zero — a green run prints just '
            + '`1 passed in 0.04s` (measured) — so a term reading THOSE would go silent exactly when the news is '
            + 'good, and a silent figure term is a broken instrument, not a zero.',
        }),
        Object.freeze({
          id: 'pytest-failed-line',
          what: 'one failing test, as pytest\'s short summary names it',
          lineMatch: '^FAILED ',
          capture: null,
          example: 'FAILED packages/soar/tests/test_agent_registry_deprecation.py::TestAgentRegistryDeprecation::test_registry_and_discovery_equivalent_results',
          why: 'this is how you count pytest FAILURES: exactly one line per failing test (measured under both `-ra` '
            + 'and `-q`), so it TALLIES and no match at all is a legitimate counted zero rather than an unreported '
            + 'number. It needs pytest\'s short summary section, which the patient\'s own config must not suppress.',
        }),
      ]),
    }),
  }),
});

/** @param {string} lang */
function language(lang) {
  if (lang === RUBRIC_LANG) return /** @type {any} */ (TEXT_LANGUAGE);
  const l = TYPES_GENRE.languages[/** @type {'js'|'python'} */ (lang)];
  // An unknown language THROWS rather than returning an empty battery: a genre
  // we have not admitted must not read as "this genre needs no guards" (F59's
  // shape — `{}` meaning "the scout did not complete", never "no facts needed").
  if (!l) throw new Error(`no TYPES genre data for language "${lang}" — one of ${GENRE_LANGUAGES.join(', ')}`);
  return l;
}

/**
 * THE GUARD BATTERY, KEYED BY VERDICT CLASS (hamr's ruling, PRD v1.57 §2).
 *
 * D5's battery was genre-keyed data. Under class-keyed interviews it has no
 * genre to hang from, and the ruling gives it the same home the interview took:
 * **the battery attaches to the verdict class the user picked** — not to a
 * problem-genre label, and not per catalogue KIND.
 *
 * WHY THE CLASS. What a battery is FOR is the class of dishonesty the class of
 * VERDICT admits. A green job is a job whose *done* is claimed to be
 * machine-checkable, so it carries the green battery whatever problem it came
 * from — that is the anti-suppression obligation the F87 genre earned, and it
 * must not travel with a label the interview no longer asks for.
 *
 * ATTACHMENT POINT vs CONTENTS, and the split is the whole implementation:
 *   - the battery's STRUCTURE and its un-removability key off the CLASS. That
 *     is this table: which guards exist, what they assert, which slot is the
 *     model's (`fill`), and which params are ours.
 *   - the battery's CONTENTS fill in at COMPOSITION (`compose`), because a
 *     suppression pattern, a file extension and a checker's escape hatch belong
 *     to the TOOL the declaration names, and nothing before composition knows
 *     that tool. `classGuards` resolves them from the language data below.
 *
 * A LOCKED class carries `guards: null`, not `[]`. Absent is never empty (F59):
 * `[]` would read as "this class needs no guards", which is exactly the sentence
 * D5 exists to make unsayable. Nothing ever reaches it — admission refuses a
 * locked class before its battery is asked for — and `classGuards` throws rather
 * than hand back nothing if anything ever does.
 * @type {Record<string, {locked: boolean, guards: readonly any[]|null}>}
 */
/** THE MECHANICAL BATTERY — the two guards a machine can always render, named
 * once because TWO classes carry exactly them (OPEN-1's ruling below). It is
 * shared by reference and never mutated: `classGuards` deep-copies before it
 * hands anything back, so one battery cannot be weakened through another class. */
const MECHANICAL_GUARDS = Object.freeze([
  Object.freeze({
    name: 'changed-from-seed',
    kind: 'files-changed',
    params: Object.freeze({ requireNonEmpty: true }),
    compose: Object.freeze([]),
    fill: Object.freeze(['allowPrefixes']),
  }),
  Object.freeze({
    name: 'no-suppressions',
    kind: 'pattern-absent-in-diff',
    // NO scope: the scan covers every changed file of these extensions. A
    // narrowing here is the round-3 arm A defect and is a red, not a taste.
    params: Object.freeze({}),
    compose: Object.freeze(['patterns', 'extensions']),
    fill: Object.freeze([]),
  }),
]);

export const CLASS_BATTERIES = Object.freeze({
  green: Object.freeze({ locked: false, guards: MECHANICAL_GUARDS }),
  // RULING 4 (hamr, 2026-08-18, selected): **softgreen INHERITS green's
  // battery** — the same precedent hitl was built on. A softgreen job is a green
  // job's agent-authored plan under the same arbiter with one judged stage at the
  // end; the mandatory guards are about what the WORKER may not do, and nothing
  // about a judged final stage relaxes any of them. It is the SAME OBJECT rather
  // than a second spelling of the same prose: a fix to green's battery must flow
  // here with no second edit, and `classGuards` deep-copies on the way out so
  // sharing cannot become weakening.
  'soft-green': Object.freeze({ locked: false, guards: MECHANICAL_GUARDS }),
  // OPEN-1, RULED (hamr, in-turn, 2026-08-13): **hitl inherits the green
  // mechanical guards and adds nothing a human stage cannot see.** D5 makes the
  // battery mandatory, shown-and-fixed and un-removable, and PRD v1.57 §2 keys it
  // to the CLASS; the mechanical-first composition law makes every hitl close
  // mostly mechanical anyway, so the green battery is the right FLOOR. A guard a
  // person cannot verify by looking would be a guard nobody checks — the one
  // thing D5 exists to make unsayable.
  hitl: Object.freeze({ locked: false, guards: MECHANICAL_GUARDS }),
});

/**
 * How each COMPOSED param resolves from the tool the declaration names. One
 * entry per composable param name, so a battery that grows a slot fails loudly
 * here rather than shipping an unresolved one.
 * @type {Record<string, (l: any) => any>}
 */
const COMPOSE_FROM_TOOL = Object.freeze({
  patterns: (/** @type {any} */ l) => l.suppressions.map((/** @type {any} */ p) => ({ ...p })),
  extensions: (/** @type {any} */ l) => [...l.extensions],
});

/**
 * The picked class's mandatory guards, FULLY ENUMERATED (D13 forward-compat
 * point 3: an omittable-with-a-default field is the omitted-`tools` shape, where
 * widening changes what runs without changing what was signed — so the guards
 * are stored spelled out, and the hash is taken over the resolved form).
 *
 * `fill` names the ONLY slot the model supplies. `changed-from-seed`'s
 * allowPrefixes is the job's own target scope and cannot be ours; everything
 * else — including `no-suppressions`' absent scope — is.
 *
 * AN EMPTY BATTERY IS IMPOSSIBLE for a known class and a known language, and
 * that is enforced rather than asserted: an unknown class, a locked class, an
 * unknown language, a battery that resolved to nothing, and a composed param
 * that resolved to nothing all THROW. F59's shape at the load-bearing decision
 * of the design — a suppression scan with no patterns reads clean exactly like
 * one that scanned correctly, and it lands in a SIGNED artefact.
 *
 * Returns a fresh deep copy each call: a frozen constant handed to a caller that
 * edits it is one shared battery away from a silently weakened guard.
 * @param {{verdictType: string, lang: string}} o
 * @returns {{name: string, kind: string, params: Record<string, any>, compose: string[], fill: string[]}[]}
 */
export function classGuards({ verdictType, lang }) {
  const battery = Object.hasOwn(CLASS_BATTERIES, String(verdictType)) ? CLASS_BATTERIES[String(verdictType)] : null;
  if (!battery) {
    throw new Error(`no guard battery for verdict class "${verdictType}" — one of ${VERDICT_CLASSES.join(', ')}`);
  }
  if (battery.locked || battery.guards === null) {
    throw new Error(`the "${verdictType}" guard battery is LOCKED — that class is declared-but-locked in v1 and `
      + 'admission refuses it before any battery is built; a locked class must never resolve to an empty one');
  }
  const l = language(lang);
  // PART 1a: a rubric job on local TEXT files keeps every guard a machine can render over a file tree (`changed-from-seed`:
  // something changed, and only inside the fence) and drops only the guards COMPOSED from a code language's tool data — a
  // suppression scan over source code has nothing to scan in a text file, and composing it from no data would be the
  // empty-guard hazard the throw below exists for. Only the soft-green battery has a text form.
  if (lang === RUBRIC_LANG && String(verdictType) !== 'soft-green') {
    throw new Error(`the "${RUBRIC_LANG}" genre is the rubric-files one: it carries a battery for soft-green only, not "${verdictType}"`);
  }
  const batteryGuards = lang === RUBRIC_LANG ? battery.guards.filter((g) => g.compose.length === 0) : battery.guards;
  const guards = batteryGuards.map((g) => {
    /** @type {Record<string, any>} */
    const params = structuredClone(g.params);
    for (const p of g.compose) {
      const resolve = COMPOSE_FROM_TOOL[p];
      if (!resolve) throw new Error(`the "${g.name}" guard composes "${p}", which nothing knows how to resolve from a tool`);
      const value = resolve(l);
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`the "${g.name}" guard's "${p}" resolved EMPTY for language "${lang}" — a guard that checks `
          + 'nothing reads clean exactly like one that checked correctly, and this one is about to be signed');
      }
      params[p] = value;
    }
    return { name: g.name, kind: g.kind, params, compose: [...g.compose], fill: [...g.fill] };
  });
  if (guards.length === 0) {
    throw new Error(`the "${verdictType}" battery resolved to NO guards — D5 is the load-bearing decision of this `
      + 'design and an empty battery is never a legal answer');
  }
  return guards;
}

/**
 * The genre's environment for this patient — ours to inject at execution (M3),
 * never model-authored. An entry with no value produces NO VARIABLE: an empty
 * `MYPYPATH` is not the same instruction as an unset one, and shipping `''`
 * would silently change how mypy resolves.
 * @param {string} lang
 * @param {{sourcePrefixes?: string[]}} [o]
 * @returns {Record<string, string>}
 */
export function genreEnv(lang, { sourcePrefixes = [] } = {}) {
  const l = language(lang);
  /** @type {Record<string, string>} */
  const env = {};
  for (const spec of l.env) {
    const parts = (spec.from === 'sourcePrefixes' ? sourcePrefixes : []).filter(isNonEmptyString);
    if (parts.length) env[spec.name] = parts.join(spec.join);
  }
  return env;
}

/** The names the genre OWNS — the validator refuses a declaration that authors
 * one of them, because ownership is only real if it is mechanical.
 * @param {string} lang @returns {string[]} */
export function genreOwnedEnvNames(lang) {
  return language(lang).env.map((/** @type {any} */ e) => e.name);
}

/**
 * HOW THE GENRE'S OWN TOOLS PRINT — genre property, like the suppression battery
 * and like `MYPYPATH`, and for the same reason: it is a FACT ABOUT AN INSTRUMENT
 * WE ALREADY OWN, not a composition choice. Seven hand-written closes read tsc
 * with the identical `/error TS\d+/` (`scripts/u-pulselog-close.mjs:122`,
 * `u-bareguard-close.mjs:123`, `u-bareagent-close.mjs:123`,
 * `u-baremobile-close.mjs:122`, `u-litectx-close.mjs:140`, `types-close.mjs:190`,
 * `types-check.mjs:60`) and one reads mypy with `' error: '`
 * (`u-spawner-close.mjs:133`) — the same provenance the SUPPRESSIONS table has:
 * operator knowledge minted by paying for live runs.
 *
 * WHY IT BECAME GENRE DATA (run msmbpjk6, 2026-08-09, $0.43). Left to the model,
 * the parser for a known tool is a DRAFT-TIME LOTTERY on a fact nobody needed to
 * guess: that run composed tsc's TTY-only pretty shape
 * (`^\S+\.js:\d+:\d+ - error TS\d+:`), which matched 0 of the 67 real error lines
 * the piped run actually printed, while the tool exited 2. The gates held — the
 * stage read as a crashed instrument and signing was refused, correctly — but the
 * refusal cost a whole authoring run to learn something the tree already knew. An
 * earlier run (mslwbkz7) happened to roll the right shape. A coin-flip on an
 * owned fact is not a capability question.
 *
 * WHAT THIS IS NOT: it does not close the parser. A stage counting something we
 * have NOT measured still writes its own pattern, and that remains a real gap —
 * named, not smoothed. This table is where a measured instrument fact lands, one
 * at a time, with its provenance.
 *
 * THE TEST-COUNT FACTS (2026-08-13) landed under exactly that rule, and closed
 * two of the three gaps the paragraph above used to name by hand: the executed
 * count and the failure line, for both runners, are now measured facts rather
 * than draft-time lotteries. Provenance rides on each entry.
 *
 * WHAT STAYED OUT, deliberately, because no evidence covers it:
 *  - a pytest FAIL-COUNT figure. A green pytest run omits the segment entirely
 *    (`1 passed in 0.04s`), so a figure term over it reports "never reported" on
 *    precisely the runs that went well. Failures are counted with the `^FAILED `
 *    tally instead, where no match IS zero.
 *  - a pytest EXECUTED count. `collected N items` is printed under `-ra` and NOT
 *    under `-q` (measured both ways), so no single spelling survives the modes a
 *    patient may configure; a stage needing it still composes its own and says so.
 *
 * Returns a fresh copy per call, for the reason `classGuards` does: a frozen
 * constant handed to a caller that edits it is one shared table away from a
 * silently changed ruler.
 * @param {string} lang
 * @returns {{id: string, what: string, lineMatch: string, capture: number|null, example: string, why: string}[]}
 */
export function genreInstruments(lang) {
  const instruments = language(lang).instruments ?? [];
  // F59's shape at a table that feeds a RULER: an empty list would read as "this
  // language's tools need no stated format", which is exactly the sentence that
  // put the pretty-format regex into a signed-close candidate.
  if (!instruments.length) {
    throw new Error(`no known-instrument formats for language "${lang}" — a language the genre admits states how its `
      + 'own checker prints, or the model is back to guessing a fact we already own');
  }
  return instruments.map((/** @type {any} */ i) => ({ ...i }));
}

/**
 * GROUNDING for a RECORDED genre environment — the provenance half of the
 * owned-env rule, and the reason the by-value comparison is worth anything.
 *
 * The value check proves the envelope's `genreEnv` and the stage's `params.env`
 * AGREE. Both copies live in the same hand-editable spec, so agreement is
 * something a forger gets for free: a spec carrying
 * `MYPYPATH=/tmp/attacker-stubs` in both places is perfectly self-consistent and
 * would point the checker at a tree nobody signed. Agreement is not provenance.
 *
 * What a forger does NOT own is the repository at the seed. Every value the
 * arbiter can build is `genreEnv`'s join of `sourcePrefixes`, and those prefixes
 * were already filtered against the seed listing before the join — so each
 * ELEMENT of a genuine value is a path the listing SELECTS, exactly like hamr's
 * listing rule for a declared path. Grounding therefore accepts precisely what
 * `applyGenreEnv` produces and refuses everything else, without needing a second
 * spelling of what "ours" means.
 *
 * Element-wise, never whole-value: a joined list is as strong as its weakest
 * element, and one real prefix must not launder the rest. A root spelling is
 * ungrounded here rather than waved through the way `checkPaths` waves it —
 * `genreEnv` filters those out before joining, so the arbiter can never produce
 * one, and a validator that admits what its own producer cannot emit is a gap.
 *
 * Callers that hold a listing only; the deferred job-spec gate cannot run this
 * and does not pretend to (see `validateCloseDecl`).
 * @param {string} lang
 * @param {Record<string, string>} recorded what the envelope claims the arbiter injected
 * @param {string[]} listing repo-relative paths at the seed
 * @returns {{name: string, value: string, element: string, resolved: string}[]} one row per ungrounded element
 */
export function ungroundedGenreEnv(lang, recorded, listing) {
  const idx = indexListing((Array.isArray(listing) ? listing : []).filter(isNonEmptyString));
  /** @type {{name: string, value: string, element: string, resolved: string}[]} */
  const out = [];
  // driven by the GENRE's own specs, not by the recorded keys: the join is genre
  // knowledge, and a key the genre does not own is the envelope's red, not this
  // function's business
  for (const spec of language(lang).env) {
    const value = recorded?.[spec.name];
    if (!isNonEmptyString(value)) continue; // shape is the envelope's own check
    for (const element of String(value).split(spec.join)) {
      const resolved = normPrefix(element);
      if (!isRoot(resolved) && (idx.files.has(resolved) || idx.dirs.has(resolved))) continue;
      out.push({ name: spec.name, value, element, resolved });
    }
  }
  return out;
}

// ── 3. THE DECLARATION VALIDATOR ─────────────────────────────────────────────

/** one prefix spelling, the SHIPPED one — `globToPrefix`'s collapse order is
 * fence territory (F9) and is never re-spelled here. `''`, `'.'` and `'/'` all
 * mean the repository root. */
const normPrefix = (/** @type {string} */ p) => globToPrefix(String(p)).replace(/^\.\//, '');
const isRoot = (/** @type {string} */ p) => p === '' || p === '.' || p === '/';

/**
 * The seed listing, indexed once: the files that exist, and every directory
 * that contains one. A path SELECTS when it is one of them.
 * @param {string[]} listing
 */
function indexListing(listing) {
  const files = new Set(listing.map((f) => normPrefix(f)).filter((f) => f !== ''));
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const f of files) {
    const segs = f.split('/');
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
  }
  return { files, dirs };
}

/**
 * Is this a SCOPED job? Mechanically, from the GENRE'S OWN containment guard
 * against the REAL listing — never from the operator's reading of the interview,
 * and never from whichever `files-changed` stage happens to come first.
 *
 * WHICH STAGE IS READ IS LOAD-BEARING. The candidate set is the genre's guards,
 * matched BY NAME (the guard battery's own `changed-from-seed`), because that is
 * the one stage `checkGuards` pins byte-for-byte with `allowPrefixes` as its only
 * model-filled slot — so its prefixes ARE the job's declared target scope. Read
 * first-of-kind instead and a declaration carrying a legally-shaped decoy
 * `files-changed` stage (`allowPrefixes: ['.']`) DECLARED EARLIER reads as
 * whole-tree, and the F84 one-population law switches itself off silently: the
 * count stages stop having to say which population they count. Measured, not
 * imagined — with the decoy the whole declaration validated with zero reds.
 *
 * The guard NAMES come from the caller's own `guards` array rather than a literal
 * here: one spelling, and a genre that renames or adds a containment guard is
 * covered the day it lands instead of the day someone remembers this function.
 * No guards in hand means no derivation — `guards-absent` is already a red, and
 * guessing the job's scope from an unpinned stage is exactly what this fixes.
 *
 * A whole-tree job is genuinely unscoped — there is nothing outside — and the
 * law must not red it (template rule 3 says the outside ceiling is omitted
 * exactly there).
 * @param {any} declaration @param {{files: Set<string>, dirs: Set<string>}} idx
 * @param {any[]|null} guards the picked class's injected guards (`classGuards`)
 */
function scopeOfJob(declaration, idx, guards) {
  const stages = Array.isArray(declaration?.stages) ? declaration.stages : [];
  const scopeGuards = (Array.isArray(guards) ? guards : [])
    .filter((g) => isObj(g) && g.kind === 'files-changed' && isNonEmptyString(g.name));
  for (const g of scopeGuards) {
    const s = stages.find((/** @type {any} */ x) => isObj(x) && x.name === g.name && x.kind === 'files-changed');
    if (!s) continue;
    const pre = s?.params?.allowPrefixes;
    if (!Array.isArray(pre) || pre.length === 0 || !pre.every(isNonEmptyString)) continue;
    const norm = pre.map(normPrefix);
    if (norm.some(isRoot)) continue; // this guard covers the whole tree
    const uncovered = [...idx.files].some((f) => !norm.some((p) => f === p || f.startsWith(`${p}/`)));
    if (uncovered) return { scoped: true, via: `${s.name}.allowPrefixes` };
  }
  return { scoped: false, via: null };
}

/**
 * Which of a judged stage's paths lie OUTSIDE the job's write fence? One owner of the rule "a check must be
 * free to edit every file it can report on", called from every door that validates a declaration. It uses
 * the shipped fence spelling (`globToPrefix`, the same containment reading plan.js's `insideFence` has) and
 * returns `[]` when there is no fence to compare against or the paths are not a string list (shape is the
 * schema walk's business).
 * @param {unknown} paths @param {string[]|null|undefined} writeScope
 * @returns {string[]}
 */
export function judgedOutsideFence(paths, writeScope) {
  if (!Array.isArray(writeScope) || writeScope.length === 0 || !Array.isArray(paths)) return [];
  const fence = writeScope.filter(isNonEmptyString).map(globToPrefix);
  if (fence.length === 0) return [];
  return paths.filter(isNonEmptyString).filter((raw) => {
    const n = normPrefix(raw);
    return !fence.some((f) => f === '.' || n === f || n.startsWith(`${f}/`));
  });
}

/**
 * Kinds a declaration may carry AT MOST ONCE, as data beside the catalogue.
 *
 * `files-changed` is the whole list and the reason is the catalogue's own
 * semantics, not taste. The kind asserts "every changed file lies inside
 * allowPrefixes"; two of them assert it twice, and stages are ANDed, so the
 * effective constraint is the INTERSECTION of the two prefix sets — which is
 * itself a prefix set, and is therefore already expressible as one stage's
 * `allowPrefixes`. A second containment stage adds no reach whatsoever, so
 * refusing it costs the author nothing.
 *
 * What it does cost to admit is measurable: a second `files-changed` stage is a
 * second answer to "what is this job's scope", which is the ambiguity
 * `scopeOfJob` had to be pinned to the guard to survive. This is the same shape
 * as `count-not-worse`'s `duplicate-population` rule — one population is one
 * stage — applied to the one population that decides whether the law fires at
 * all.
 */
const AT_MOST_ONCE_KINDS = Object.freeze(['files-changed', 'human-confirms', 'judged-floor']);

/** why each at-most-once kind is at most once, in the author's own terms. A map
 * rather than a chain of conditionals: a kind added to the list above with no
 * reason here is a red nobody can act on, and this fails loudly instead.
 * @type {Record<string, (label: string, owner: string) => string>} */
const AT_MOST_ONCE_REASON = Object.freeze({
  'files-changed': (label, owner) => `stage "${label}" is a second files-changed stage — "${owner}" already declares `
    + 'which files this job may change. Stages are ANDed, so two of them mean the intersection of two prefix sets, '
    + 'which is itself a prefix set and already says the same thing in one stage; what a second one does add is a '
    + 'second answer to what this job\'s scope IS',
  'human-confirms': (label, owner) => `stage "${label}" is a second human-confirms stage — "${owner}" already asks the `
    + 'person. One signer, one judge (ruling 4), asked ONCE at the end: a second door is a second verdict, and the run '
    + 'has no way to say which of them was the one it stopped for',
  // softgreen module 3. The judged floor is the close's ONE judged ruler: two of
  // them are two bars for one verdict class, each buying its own paid calls, and
  // first-red-wins means the second only ever runs when the first was satisfied —
  // so its only reachable effect is to spend money re-judging a tree that already
  // cleared the bar the signer signed. One card, one calibration set, one ruler.
  'judged-floor': (label, owner) => `stage "${label}" is a second judged-floor stage — "${owner}" is already this `
    + 'close\'s judged ruler. One card and one calibration set decide one bar: a second judged stage is a second bar '
    + 'for the same verdict, and it buys its own paid calls to re-judge a tree the first one already passed',
});

/** the kinds NO ONE runs as an in-run ruler — ruling 5's law, as data. A
 * declaration that offers one is a red rather than a normalization: the signer
 * must not read one thing and have the runner store another. */
export const NEVER_OFFERED_KINDS = Object.freeze(['human-confirms', 'judged-floor']);

/** @param {any} v */
const strArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);

/** read a dotted param path off a params object, or undefined @param {any} p @param {string} dotted */
function readPath(p, dotted) {
  let node = p;
  for (const seg of dotted.split('.')) {
    if (!isObj(node)) return undefined;
    node = node[seg];
  }
  return node;
}

/**
 * Validate an authored close DECLARATION. Never throws on model output — every
 * failure is a named red, in the shipped `{ok, reds, <parsed>}` shape, and the
 * parsed value is the RESOLVED declaration (every short-form parser expanded),
 * because that is the form the executor runs and the signature covers.
 *
 * `listing`, `guards` and `envOwned` are REQUIRED, and their absence is a red
 * rather than a skipped check — all three guard the SAME failure: a validator
 * that silently stops checking when handed nothing to check against reports a
 * clean declaration it never examined. v1 only admits a job with a runnable
 * patient and a git seed (D13), so the listing always exists, and D5's guards
 * exist by construction. `envOwned` is separated into absent-vs-empty for
 * F59's reason exactly: `[]` is a genre that owns no variables (JS), and
 * `undefined` is a caller that never asked — the two must not read alike.
 *
 * The CATALOGUE is ours, not model input: a malformed one is a bareloop bug and
 * is allowed to throw, because failing loudly beats a validator that quietly
 * stops enforcing a rule it was configured out of.
 *
 * `deferListing: true` is the ONE way to run without a listing, and it must be
 * spelled literally. It exists for exactly one caller — the job-spec validator,
 * which judges a signed `closeDecl` with no repository in hand — and it does NOT
 * make the listing optional: it moves that half of the gate to the runner, which
 * re-validates GROUNDED against the real seed before any stage runs. Two checks
 * ride on the listing and both are named here rather than discovered later: the
 * path rule (a path SELECTS or it does not exist), and the SCOPED-job derivation
 * that arms the F84 one-population law. With the listing deferred, neither
 * fires, and `grounded: false` on the result is how a caller knows.
 *
 * `verdictType` is REQUIRED for the same reason: it is the PROMISE the ceiling
 * rule checks the composition against, and a validator with no pick in hand
 * cannot check it. Absent or unknown is `class-absent`, naming the closed set.
 *
 * @param {any} declaration the parsed model output
 * @param {{catalogue?: Record<string, KindSpec>, listing?: string[]|null,
 *   guards?: {name: string, kind: string, params: Record<string, any>, fill: string[]}[]|null,
 *   envOwned?: string[]|null, envInjected?: Record<string, string>|null, deferListing?: boolean,
 *   verdictType?: string|null, writeScope?: string[]|null, jobLines?: {n: number}[]|null, inputLabels?: string[]|null}} [opts]
 *   `inputLabels` — the labels of the person's inputs (Part 1a). Present, a rubric-step `cited` part must name one of them.
 *   `jobLines` — the person's numbered job lines (P7). Present, every stage must name the line it serves and every
 *     line needs a stage or a refusal ({@link checkJobLines}); absent (every spec that predates the job block), the
 *     rule is not run.
 *   `writeScope` — the job's signed write fence. Every path a judged stage judges must sit inside it
 *     ({@link judgedOutsideFence}); absent, the rule is not run (the plain-folder deferral has no fence).
 *   `listing` — repo-relative paths at the seed (`git ls-tree -r --name-only`).
 *   `guards` — the picked class's injected guards (`classGuards`).
 *   `verdictType` — the class the USER picked (`VERDICT_CLASSES`).
 *   `envOwned` — env names the genre injects (`genreOwnedEnvNames`), `[]` when it owns none.
 *   `envInjected` — the env the ARBITER itself injected (`genreEnv`'s output), for a
 *     POST-injection re-validation. Omitted is the PRE-injection form: every owned name
 *     is the model's and reds. Supplied, an owned name is accepted only when its value is
 *     EXACTLY the injected one — a wrong value is the model's guess or corruption.
 *   `deferListing` — literally `true` to run the tree-independent half only.
 * @returns {{ok: boolean, reds: Red[], declaration: any, grounded: boolean,
 *   scoped: {scoped: boolean, via: string|null},
 *   ceiling: {class: string, kind: string, stage: string|null, locked: boolean}|null}}
 */
export function validateDeclaration(declaration, opts = {}) {
  const {
    catalogue = KIND_CATALOGUE, listing = null, guards = null, envOwned = null, envInjected = null,
    verdictType = null, writeScope = null, jobLines = null, inputLabels = null,
  } = opts;
  const deferListing = opts.deferListing === true;
  /** @type {Red[]} */
  const reds = [];
  /** @type {(code: string, path: string, detail: string, extra?: object) => void} */
  const red = (code, path, detail, extra = {}) => { reds.push({ code, path, detail, ...extra }); };

  const lockedKinds = Object.keys(catalogue).filter((k) => catalogue[k].locked);
  const kindNames = Object.keys(catalogue).join(' | ');

  const haveListing = Array.isArray(listing) && listing.length > 0 && listing.every(isNonEmptyString);
  if (!haveListing && !deferListing) {
    red('listing-absent', 'listing', 'a non-empty seed file listing (git ls-tree -r --name-only <seed>) — '
      + 'without it nothing can tell a real path from an invented one, and a validator that skips that check '
      + 'reports a declaration it never examined');
  }
  if (haveListing && deferListing) {
    red('listing-conflict', 'listing', 'deferListing was declared AND a listing was supplied — a caller that both '
      + 'defers the tree-grounded half and hands over a tree does not know which gate it is running');
  }
  const idx = indexListing(haveListing ? /** @type {string[]} */ (listing) : []);

  const haveGuards = Array.isArray(guards) && guards.length > 0;
  if (!haveGuards) {
    red('guards-absent', 'guards', 'the picked class\'s mandatory guards (classGuards) — D5 is the load-bearing '
      + 'decision of this design and it cannot be validated away by handing the validator nothing to check against');
  }

  // THE PICK, and it is required for the same reason the guards are: it is the
  // promise the ceiling rule measures the composition against, and a validator
  // handed no pick reports a promise it never checked. A closed set, handed over
  // enumerated — never a prose rule about what a legal class would look like.
  const picked = VERDICT_CLASSES.includes(String(verdictType)) ? String(verdictType) : null;
  if (picked === null) {
    red('class-absent', 'verdictType', `the verdict class the user picked — one of ${VERDICT_CLASSES.join(' | ')}. `
      + 'It is what a composition promises to stay at or below, and nothing derives it from the declaration');
  }

  // absent is not empty: `[]` is a genre that owns no environment (JS), and a
  // caller that never asked is a caller whose declarations are unchecked on the
  // axis round 2's arm B failed (F59's distinction, in the shape it bites here)
  const owned = Array.isArray(envOwned) ? envOwned : null;
  if (owned === null) {
    red('env-ownership-absent', 'envOwned', 'the env names this genre injects (genreOwnedEnvNames) — pass [] for a '
      + 'genre that owns none; omitting it leaves a model-authored MYPYPATH-class variable unexamined');
  }
  // The arbiter's OWN injection, when this is a POST-injection re-validation.
  // ABSENT (the default) is the PRE-injection form the authoring loop validates,
  // where every owned name is the model's and reds — so the loop's gate keeps
  // exactly the behaviour it had, and only a caller that can state what the
  // arbiter injected gets to have it accepted.
  const injected = isObj(envInjected) ? /** @type {Record<string, string>} */ (envInjected) : {};

  if (!isObj(declaration)) {
    red('invalid-value', '', 'the declaration is an object carrying an ordered stages array');
    return { ok: false, reds, declaration: null, grounded: haveListing, scoped: { scoped: false, via: null }, ceiling: null };
  }
  // NOTES, checked HERE rather than only at the signing gate. The field is the
  // model's own ("anything you could not express"), it travels verbatim into the
  // signed `closeDecl`, and `validateCloseDecl` refuses an empty one — so a rule
  // that lives only there is a rule the authoring loop cannot feed back: the run
  // pays for a close, accepts it, and dies at signing on a defect the model was
  // never shown. One spelling of the rule, at the gate that can still revise it.
  if (declaration.notes !== undefined
      && !(Array.isArray(declaration.notes) && declaration.notes.every(isNonEmptyString))) {
    red('invalid-value', 'notes', 'an array of non-empty strings — what the author could not express, kept with '
      + 'the artefact it is about');
  }

  const stages = declaration.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    red('missing-field', 'stages', 'a non-empty ORDERED array of stages — they run in the order you declare them');
    return { ok: false, reds, declaration: null, grounded: haveListing, scoped: { scoped: false, via: null }, ceiling: null };
  }
  if (stages.length > MAX_STAGES) {
    red('invalid-value', 'stages', `${stages.length} stages exceeds the ceiling of ${MAX_STAGES}`);
  }

  const scoped = scopeOfJob(declaration, idx, guards);
  // Computed over the WHOLE declaration and REPORTED whatever it says, so a
  // composition that sits BELOW the pick is visible rather than silent — the
  // other half of the ruling ("never a silent downgrade"). Only EXCEEDING it is
  // a red, and that red is raised per offending stage inside the loop.
  const ceiling = closeCeiling(declaration, catalogue);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Map<string, string>} population key → the stage that already owns it */
  const populations = new Map();
  /** @type {Map<string, string>} at-most-once kind → the stage that already owns it */
  const kindOwners = new Map();

  stages.forEach((/** @type {any} */ s, i) => {
    const at = `stages[${i}]`;
    if (!isObj(s)) { red('invalid-value', at, 'a stage is an object {name, kind, params}'); return; }

    if (!isNonEmptyString(s.name)) red('missing-field', `${at}.name`, 'a non-empty stage name');
    else if (!NAME_RE.test(s.name)) red('invalid-value', `${at}.name`, `"${s.name}" is not a lowercase-hyphenated slug`);
    else if (seen.has(s.name)) {
      red('duplicate-name', `${at}.name`, `stage name "${s.name}" is declared twice — two stages under one name are `
        + 'one trend series over two populations (F84)');
    } else seen.add(s.name);
    const label = isNonEmptyString(s.name) ? s.name : at;

    if (!isNonEmptyString(s.kind)) { red('missing-field', `${at}.kind`, `a kind: ${kindNames}`); return; }
    if (lockedKinds.includes(s.kind)) {
      // A DISTINCT red carrying counted demand. `verb`/`lib` are the structured
      // fields the ledger keys admission on, never prose, and `lib` is stamped
      // HERE at the emit site (the typed-lib rule): a locked KIND is demand
      // against bareloop's own catalogue, and filing it against a bare-suite
      // package is the BA-2 misattribution that rule exists to prevent.
      red('locked-kind', `${at}.kind`, `"${s.kind}" is a named but LOCKED kind — declaring it is recorded demand, `
        + 'never an admission; it does not run in v1', { kind: s.kind, verb: s.kind, lib: 'bareloop', stage: label });
      return;
    }
    const spec = catalogue[s.kind];
    if (!spec) {
      red('unknown-kind', `${at}.kind`, `"${s.kind}" is not in the catalogue — kinds: ${kindNames}`, { kind: s.kind });
      return;
    }
    // THE CEILING (PRD v1.57 §1): composition may only use kinds AT OR BELOW the
    // picked class. A LOCKED kind never reaches here — it already carries its own
    // counted-demand red and returned — so a kind refused as unavailable is never
    // ALSO redded for its class: one problem, one red, in one vocabulary.
    if (picked !== null && CLASS_RANK[spec.verdictClass] > CLASS_RANK[picked]) {
      red('class-ceiling', `${at}.kind`, `stage "${label}" uses "${s.kind}", which can only render a `
        + `${spec.verdictClass} verdict, and this job is declared ${picked}. The class the user picked is a PROMISE: a `
        + 'composition may use kinds at or below it and never above it, because a judgment ruler running under a '
        + 'machine-checkable promise is a fake-hard verdict — refused here rather than upgraded silently',
      { kind: s.kind, stage: label, kindClass: spec.verdictClass, picked });
    }
    if (AT_MOST_ONCE_KINDS.includes(s.kind)) {
      const owner = kindOwners.get(s.kind);
      if (owner !== undefined) {
        const why = AT_MOST_ONCE_REASON[s.kind];
        if (!why) {
          throw new Error(`[authoring] "${s.kind}" is declared at-most-once with no stated reason — a red the author `
            + 'cannot act on is worse than no rule');
        }
        red('duplicate-kind', `${at}.kind`, why(label, owner), { kind: s.kind, stage: label, twin: owner });
      } else kindOwners.set(s.kind, label);
    }

    // A judged stage may only judge what the run can fix: a path outside the write fence is a
    // finding the worker can never act on (run mv13ery3: bin/pulselog.js, fence src/**).
    if (s.kind === JUDGED_FLOOR_KIND && isObj(s.params)) {
      const outside = judgedOutsideFence(s.params.paths, writeScope);
      if (outside.length > 0) {
        red('judged-outside-write-scope', `${at}.params.paths`, `stage "${label}" judges ${outside.join(', ')}, but the `
          + `job may only edit ${writeScope?.join(', ')}. A check that reports on a file the run is fenced out of can `
          + 'never be satisfied — every finding on it is one the worker cannot fix. Name files inside the write fence',
        { stage: label, outside, fence: (writeScope ?? []).map(globToPrefix) });
      }
    }

    // ── RULING 5, AS LAW: judged and human stages are `offer: false`, and the
    // law is checked rather than applied. `checkMenu` filters `offer !== false`,
    // so a declaration that says nothing is silent about a rule the runner
    // enforces anyway (`declaredStages` stamps it) — that part is the arbiter's
    // own bookkeeping. What must never happen is a declaration that says
    // something ELSE: `offer: true` on a human stage is the composer asking to
    // use a person as an in-run ruler, and a silent normalization would leave
    // the signer reading one thing while the runner stored another.
    if (NEVER_OFFERED_KINDS.includes(s.kind) && Object.hasOwn(s, 'offer') && s.offer !== false) {
      red('human-stage-offered', `${at}.offer`, `stage "${label}" is a ${s.kind} stage and offers itself as an in-run `
        + 'check. A person (or a paid judge) is never an in-run ruler (ruling 5): the agent may never use one to '
        + 'decide a step, and this is refused rather than quietly rewritten to offer: false',
      { kind: s.kind, stage: label });
    }
    // ── THE COMPOSITION LAW's ordering half (2026-08-07: *mechanical first,
    // judge minimal, human LAST*), enforced where it is cheap. First-red-wins
    // means anything after the human stage never runs — so a human stage in the
    // middle silently deletes the mechanical stages behind it AND empties the
    // evidence package ruling 2 requires the person to be shown.
    if (s.kind === 'human-confirms' && i !== stages.length - 1) {
      red('human-stage-not-last', `${at}.kind`, `stage "${label}" asks a person and is not the LAST stage. The close `
        + 'is first-red-wins, so every stage after this one would never run: the person would be shown an incomplete '
        + 'evidence package and the mechanical stages behind them would be silently deleted (the composition law: '
        + 'mechanical first, human last)', { kind: s.kind, stage: label, at: i, last: stages.length - 1 });
    }
    // ── THE SAME LAW's judged half (design record 2026-08-17 §4.5: *mechanical
    // stages FIRST, the judged stage AFTER, first-red-wins*). The human rule is
    // stated as "last" because a person is the top of the hierarchy; the judged
    // rule is stated as "after the mechanical ones", because a human stage may
    // legally follow it — mechanical → judge → person is the full composition.
    //
    // What it costs to admit is the same both ways round: first-red-wins means a
    // judged stage in front of a mechanical one BUYS PAID CALLS to grade a tree
    // the free stages would have refused for nothing — and if the judge passes it
    // the mechanical red still lands, so the money bought no verdict either.
    // A SECOND judged stage is NOT this red (it is `duplicate-kind`, emitted
    // above): one problem, one red, in one vocabulary.
    if (s.kind === JUDGED_FLOOR_KIND) {
      const behind = stages.slice(i + 1).filter((/** @type {any} */ x) => isObj(x) && isNonEmptyString(x.kind)
        && catalogue[x.kind] && CLASS_RANK[catalogue[x.kind].verdictClass] < CLASS_RANK['soft-green']);
      if (behind.length) {
        red('judged-stage-order', `${at}.kind`, `stage "${label}" is judged and runs BEFORE the mechanical `
          + `stage${behind.length > 1 ? 's' : ''} ${behind.map((/** @type {any} */ x) => `"${x.name}"`).join(', ')}. `
          + 'The close is first-red-wins and a judged stage buys a paid call per artifact: put every stage a command '
          + 'can decide in front of it, so the free rulers shield the expensive one (the composition law: mechanical '
          + 'first, judge after)',
        { kind: s.kind, stage: label, at: i, behind: behind.map((/** @type {any} */ x) => x.name) });
      }
    }

    const p = s.params;
    if (!isObj(p)) { red('missing-field', `${at}.params`, `an object carrying: ${spec.required.join(', ')}`); return; }
    for (const k of spec.required) {
      if (!Object.hasOwn(p, k) || p[k] === null || p[k] === undefined) {
        red('missing-field', `${at}.params.${k}`, `${s.kind} requires ${k} (${spec.shape})`);
      }
    }
    for (const k of Object.keys(p)) {
      if (!spec.required.includes(k) && !spec.optional.includes(k)) {
        red('invalid-value', `${at}.params.${k}`, `"${k}" is not a parameter of ${s.kind} — the catalogue is the `
          + 'only source of parameter names');
      }
    }

    checkKind({ kind: s.kind, params: p, at, red, scoped, label, populations, envOwned: owned ?? [], envInjected: injected });
    checkEnvComplete({ params: p, at, red, kind: s.kind, catalogue, envInjected: injected });
    checkPaths({ spec, params: p, at, red, idx, haveListing });
  });

  if (haveGuards) checkGuards({ declaration, guards: /** @type {any[]} */ (guards), red });
  checkJobLines({ declaration, stages, jobLines, guards: haveGuards ? /** @type {any[]} */ (guards) : [], red });
  // PART 1a (R11): the sorting rules for the rubric-step stages — plain-words reds, judged and web parts refused in this build
  // keep-both: the record of the person's picks (code writes it, the signed spec carries it) is what lets a countable part sit beside a fact
  checkPickRecord(declaration.picks, red);
  checkRubricParts(stages, { inputLabels, red, picks: Array.isArray(declaration.picks) ? declaration.picks : null });
  // PART 1b (RF16, RF17): every ~ rule is a check or Not checked; the AI's own numbers are marked and a time range is a range
  checkRubricRules(stages, { jobLines, refused: declaration.refused, red });

  const ok = reds.length === 0;
  return { ok, reds, declaration: ok ? normalizeDeclaration(declaration) : null, grounded: haveListing, scoped, ceiling };
}

/**
 * keep-both: the SHAPE of the record of the person's picks, `picks: [{line, part}]` (code writes it from the settled picks, `applyPicks`; the signed close carries it;
 * `checkRubricParts` reads it). A bad entry is a plain red, never a crash.
 * @param {unknown} picks @param {(c: string, p: string, d: string, e?: object) => void} red
 */
function checkPickRecord(picks, red) {
  if (picks === undefined) return;
  if (!Array.isArray(picks)) { red('invalid-value', 'picks', 'an array of {line, part} - the person\'s picked checks, written by code'); return; }
  picks.forEach((/** @type {any} */ e, /** @type {number} */ j) => {
    if (!isObj(e) || !Number.isInteger(e.line) || !isObj(e.part) || e.part.class !== 'countable') {
      red('invalid-value', `picks[${j}]`, '{line, part}: a job line number and the picked countable part');
    }
  });
}

/**
 * P7 rules 1-3 of the job block, at $0, in the gate that can still revise: every `fromLine` is a non-empty, duplicate-free array of real job line numbers (one check may serve several lines);
 * every numbered job line has at least one stage OR a refusal reason in `refused` (a note in `notes` does NOT cover a
 * line); a mandatory guard carries no `fromLine` (its object stays the genre's own) and names the lines it already covers in the separate `guardLines`. The SHAPE of `fromLine` / `refused` is checked
 * whenever they appear; the coverage half runs only when the person's `jobLines` were handed in.
 * @param {{declaration: any, stages: any[], jobLines: {n: number}[]|null|undefined,
 *   guards: {name: string}[], red: (c: string, p: string, d: string, e?: object) => void}} o
 */
function checkJobLines({ declaration, stages, jobLines, guards, red }) {
  const known = Array.isArray(jobLines) && jobLines.length > 0 ? jobLines.map((l) => l.n) : null;
  const guardNames = new Set(guards.map((g) => g.name));
  /** @type {Set<number>} */
  const served = new Set();
  stages.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    if (!isObj(s)) return;
    const at = `stages[${i}].fromLine`;
    const label = isNonEmptyString(s.name) ? s.name : `stages[${i}]`;
    const guard = isNonEmptyString(s.name) && guardNames.has(s.name);
    if (Object.hasOwn(s, 'fromLine')) {
      if (guard) {
        red('invalid-value', at, `stage "${label}" is a mandatory guard and carries no fromLine — to say it covers a job line, list it in "guardLines" as {"guard": "${label}", "lines": [N]}`);
      } else if (!Array.isArray(s.fromLine) || s.fromLine.length === 0 || !s.fromLine.every((/** @type {any} */ x) => Number.isInteger(x) && x >= 1)) {
        red('invalid-value', at, `stage "${label}" has fromLine ${JSON.stringify(s.fromLine)} — a non-empty array of job line numbers, e.g. [1] or [1, 3]`);
      } else if (new Set(s.fromLine).size !== s.fromLine.length) {
        red('invalid-value', at, `stage "${label}" lists a job line twice in fromLine ${JSON.stringify(s.fromLine)}`);
      } else if (known !== null && s.fromLine.some((/** @type {number} */ x) => !known.includes(x))) {
        red('invalid-value', at, `stage "${label}" has fromLine ${JSON.stringify(s.fromLine)}, but the job has lines ${known.join(', ')} only`);
      } else for (const x of s.fromLine) served.add(x);
    } else if (known !== null && !guard) {
      red('missing-field', at, `stage "${label}" does not say which job lines it serves — give it fromLine: [N, ...] (${known.join(', ')}); `
        + 'only a mandatory guard carries none');
    }
  });
  // a mandatory guard says which job lines its always-on check already covers, beside the stage (the guard's own object stays
  // byte-identical to the genre's): `guardLines: [{guard, lines: [N, ...]}]`. It counts as coverage for those lines, nothing more.
  if (declaration.guardLines !== undefined) {
    if (!Array.isArray(declaration.guardLines)) {
      red('invalid-value', 'guardLines', 'an array of {guard, lines} — which job lines each always-on guard already covers, e.g. [{"guard": "<a mandatory guard name>", "lines": [2]}]');
    } else {
      /** @type {Set<string>} */
      const seenGuards = new Set();
      declaration.guardLines.forEach((/** @type {any} */ g, /** @type {number} */ j) => {
        const at = `guardLines[${j}]`;
        if (!isObj(g) || !isNonEmptyString(g.guard) || !Array.isArray(g.lines) || g.lines.length === 0
            || !g.lines.every((/** @type {any} */ x) => Number.isInteger(x) && x >= 1)) {
          red('invalid-value', at, '{guard, lines}: the name of a mandatory guard and a non-empty array of job line numbers, e.g. {"guard": "<a mandatory guard name>", "lines": [2]}');
        } else if (!guardNames.has(g.guard)) {
          red('invalid-value', `${at}.guard`, `"${g.guard}" is not a mandatory guard${guardNames.size ? ` — the always-on guards are ${[...guardNames].join(', ')}` : ''}`);
        } else if (seenGuards.has(g.guard)) {
          red('invalid-value', `${at}.guard`, `guard "${g.guard}" is listed twice in guardLines — give it one entry with all its lines`);
        } else if (new Set(g.lines).size !== g.lines.length) {
          red('invalid-value', `${at}.lines`, `guard "${g.guard}" lists a job line twice in ${JSON.stringify(g.lines)}`);
        } else if (known !== null && g.lines.some((/** @type {number} */ x) => !known.includes(x))) {
          red('invalid-value', `${at}.lines`, `guard "${g.guard}" has lines ${JSON.stringify(g.lines)}, but the job has lines ${known.join(', ')} only`);
        } else {
          seenGuards.add(g.guard);
          for (const x of g.lines) served.add(x);
        }
      });
    }
  }
  /** @type {Set<number>} */
  const refused = new Set();
  if (declaration.refused !== undefined) {
    if (!Array.isArray(declaration.refused)) {
      red('invalid-value', 'refused', 'an array of {line, rule?, reason} — the job lines (or one ~ rule of a line) no stage can check, each with a reason');
    } else {
      declaration.refused.forEach((/** @type {any} */ r, /** @type {number} */ j) => {
        const at = `refused[${j}]`;
        if (!isObj(r) || !Number.isInteger(r.line) || r.line < 1 || !isNonEmptyString(r.reason) || (Object.hasOwn(r, 'rule') && !(Number.isInteger(r.rule) && r.rule >= 1))) {
          red('invalid-value', at, '{line, rule?, reason}: a job line number, optionally the number of one of its ~ rules, and a plain-words reason');
        } else if (known !== null && !known.includes(r.line)) {
          red('invalid-value', `${at}.line`, `refused line ${r.line}, but the job has lines ${known.join(', ')} only`);
        } else if (!Object.hasOwn(r, 'rule')) refused.add(r.line);
      });
    }
  }
  if (known !== null) {
    for (const n of known) {
      if (!served.has(n) && !refused.has(n)) {
        red('job-line-uncovered', 'stages', `job line ${n} has no stage and no refusal. Give it a stage whose fromLine lists ${n}, or list `
          + `it in "refused" as {"line": ${n}, "reason": "..."} — a note does not cover a line`, { line: n });
      }
    }
  }
}

/**
 * COMPLETENESS — the deletion half of the owned-env rule, and the half a
 * by-VALUE comparison structurally cannot cover.
 *
 * `genre-owned-env` catches a CHANGED variable: a value that is not the one the
 * arbiter builds. Nothing caught a DELETED one. Drop the key from a stage — or
 * drop `params.env` outright — and there is no value left to compare, so a
 * hand-edited spec validates clean and mypy resolves through an editable install
 * to a DIFFERENT checkout while the close reports a number. That is the Result-5
 * hazard exactly, arriving through the one door the value check leaves open, and
 * it is silent by construction: the variable moves no number the close can see.
 *
 * So an injection is a fact about EVERY stage the injector touches, not about
 * the stages that happen to still carry it. The set is read from the same
 * catalogue predicate `applyGenreEnv` injects by (`envCapableKind`), so the rule
 * can never demand a variable on a stage nothing would inject into, nor let one
 * off a stage that was injected.
 *
 * Runs only on a POST-injection re-validation: with nothing recorded there is
 * nothing to be complete about, and the authoring loop must not ask the model
 * for the variable it is forbidden to author.
 * @param {{params: any, at: string, red: (c: string, p: string, d: string, e?: object) => void,
 *   kind: string, catalogue: Record<string, KindSpec>, envInjected: Record<string, string>}} o
 */
function checkEnvComplete({ params: p, at, red, kind, catalogue, envInjected }) {
  const names = Object.keys(envInjected);
  if (names.length === 0 || !envCapableKind(kind, catalogue)) return;
  // a malformed `env` already has its own shape red; saying it twice in two
  // vocabularies tells the reader there are two problems
  if (Object.hasOwn(p, 'env') && !isObj(p.env)) return;
  for (const name of names) {
    if (isObj(p.env) && Object.hasOwn(p.env, name)) continue;
    red('genre-env-missing', `${at}.params.env.${name}`, `${name} is recorded as the genre's own injection and this `
      + 'stage spawns a process, so it must carry it — the arbiter injects into every env-capable stage, and a stage '
      + 'that comes back without it grades whatever the ambient environment resolves to, silently and with no number '
      + 'that moves', { name, expected: envInjected[name] });
  }
}

/**
 * The per-kind parameter checks, plus the two halves of the one-population law.
 * @param {{kind: string, params: any, at: string, red: (c: string, p: string, d: string, e?: object) => void,
 *   scoped: {scoped: boolean, via: string|null}, label: string, populations: Map<string, string>,
 *   envOwned: string[], envInjected: Record<string, string>}} o
 */
function checkKind({ kind, params: p, at, red, scoped, label, populations, envOwned, envInjected }) {
  /** F49 — the static nested-quantifier reject, at the gate, before the pattern
   * ever runs. MEASURED: `(a+)+$` did not finish on a 33-char body in 120s, so
   * input-bounding is theatre and a static reject is not. The detector itself is
   * never touched from here (monotonic-only doctrine). */
  const regex = (/** @type {any} */ v, /** @type {string} */ path) => {
    if (!isNonEmptyString(v)) { red('invalid-value', path, 'a regular expression, as a string'); return; }
    if (hasNestedQuantifier(v)) {
      red('invalid-value', path, `/${v}/ carries a nested quantifier — rejected statically (F49); rewrite it without one`);
      return;
    }
    try { new RegExp(v); } catch (e) {
      red('invalid-value', path, `/${v}/ is not a valid regular expression: ${String(/** @type {any} */ (e)?.message ?? e)}`);
    }
  };
  const command = () => {
    if (!isNonEmptyString(p.cmd)) red('invalid-value', `${at}.params.cmd`, 'a non-empty executable name');
    else {
      // THE DENY FLOOR (PRD v1.57 §3), at the validation gate, before any token
      // and before any spawn. A FLOOR, not a sandbox — see DENIED_COMMANDS.
      const denied = deniedCommandReason(p.cmd);
      if (denied) red('cmd-denied', `${at}.params.cmd`, denied, { cmd: p.cmd });
    }
    if (Object.hasOwn(p, 'args') && !(Array.isArray(p.args) && p.args.every((/** @type {any} */ x) => typeof x === 'string'))) {
      red('invalid-value', `${at}.params.args`, 'an array of strings (may be empty)');
    }
    if (Object.hasOwn(p, 'timeoutMs') && !(Number.isInteger(p.timeoutMs) && p.timeoutMs > 0)) {
      red('invalid-value', `${at}.params.timeoutMs`, 'a positive integer');
    }
    if (Object.hasOwn(p, 'env')) {
      if (!(isObj(p.env) && Object.values(p.env).every((v) => typeof v === 'string'))) {
        red('invalid-value', `${at}.params.env`, 'an object of string values');
      } else {
        for (const name of Object.keys(p.env)) {
          if (!envOwned.includes(name)) continue;
          // The arbiter's OWN injection reaches this check on every re-validation
          // after the flow applied it (M3's applyGenreEnv), so the split is by
          // VALUE and never by presence — exactly how `checkGuards` tells a genre
          // guard from a weakened copy. Presence-flagging here would red the
          // arbiter's own artefact and no python close could be signed, validated
          // or run.
          const injected = Object.hasOwn(envInjected, name);
          if (injected && p.env[name] === envInjected[name]) continue;
          // Round 2's arm B authored MYPYPATH itself and authored it WRONG; the
          // flow sets it from genre data. A value that is not the one the arbiter
          // builds is the model's guess or a corrupted artefact, either way a red.
          red('genre-owned-env', `${at}.params.env.${name}`, injected
            ? `${name} is the genre's own variable and its value is fixed by the genre, not by the declaration: `
              + `expected ${JSON.stringify(envInjected[name])}, declared ${JSON.stringify(p.env[name])}`
            : `${name} is set by the genre, not by the declaration — this is a fact the interview cannot supply `
              + 'and the repository does not state',
          { name, ...(injected ? { expected: envInjected[name], declared: p.env[name] } : {}) });
        }
      }
    }
  };
  /** the one-population law's first half (F84): a count over a scoped job must
   * say WHICH population it counts, or an in-scope 29 and an outside 4 land in
   * one trend series and a run that swapped walls reads as converging. */
  const populationNamed = (/** @type {string} */ path) => {
    const sc = p.scope;
    if (!isObj(sc)) { red('missing-field', path, 'a scope object naming this stage\'s population'); return; }
    const inc = Object.hasOwn(sc, 'includePrefixes') ? sc.includePrefixes : null;
    const exc = Object.hasOwn(sc, 'excludePrefixes') ? sc.excludePrefixes : null;
    if (inc !== null && !strArray(inc)) red('invalid-value', `${path}.includePrefixes`, 'a non-empty array of path prefixes');
    if (exc !== null && !strArray(exc)) red('invalid-value', `${path}.excludePrefixes`, 'a non-empty array of path prefixes');
    for (const k of Object.keys(sc)) {
      if (k !== 'includePrefixes' && k !== 'excludePrefixes') red('invalid-value', `${path}.${k}`, 'a scope takes includePrefixes and excludePrefixes only');
    }
    if (inc === null && exc === null && scoped.scoped) {
      red('one-population', path, `stage "${label}" counts over a scoped job (${scoped.via}) with no include/exclude `
        + 'filter — that mixes the job\'s own population with everything else under one stage name, and the two land '
        + 'in one trend series (F84)', { rule: 'unnamed-population', stage: label });
    }
  };

  switch (kind) {
    case 'command-exit':
      command();
      if (!Number.isInteger(p.expectExit)) red('invalid-value', `${at}.params.expectExit`, 'an integer exit code');
      break;
    case 'count-not-worse': {
      command();
      // ONE normalisation, the EXECUTOR's own (src/kinds.js). Short form and long
      // form both land here, so the validator and the grader can never disagree
      // about what a parser means.
      const norm = normalizeParser(p.parser, `${at}.params.parser`);
      for (const r of norm.reds) red(r.code, r.path, r.detail);
      for (const t of norm.terms ?? []) {
        regex(t.lineMatch, `${at}.params.parser (lineMatch /${t.lineMatch}/)`);
        // a region anchor runs over the whole output, so it is exactly as
        // exposed to F49 as lineMatch is
        if (isObj(t.region)) regex(t.region.anchor, `${at}.params.parser (region anchor /${t.region.anchor}/)`);
      }
      if (!DIRECTIONS.includes(p.direction)) red('invalid-value', `${at}.params.direction`, `one of ${DIRECTIONS.join(' | ')}`);
      if (!BASELINES.includes(p.baseline)) {
        red('invalid-value', `${at}.params.baseline`, `one of ${BASELINES.map((b) => JSON.stringify(b)).join(' | ')} — `
          + 'the close stores the counting rule, never a number you measured (D12)');
      }
      populationNamed(`${at}.params.scope`);
      // the law's second half: the SAME command, parser and scope declared twice
      // is one population measured twice, wearing two stage names
      if (norm.ok) {
        const key = JSON.stringify([p.cmd, p.args ?? [], norm.terms, canonicalScope(p.scope)]);
        const owner = populations.get(key);
        if (owner !== undefined) {
          red('one-population', `${at}.params`, `stage "${label}" measures the same population as "${owner}" — same `
            + 'command, same parser, same scope. One population is one stage (F84); two names over one number are two '
            + 'trend series that can never disagree', { rule: 'duplicate-population', stage: label, twin: owner });
        } else populations.set(key, label);
      }
      break;
    }
    case 'pattern-absent-in-diff':
      if (!Array.isArray(p.patterns) || p.patterns.length === 0) {
        red('invalid-value', `${at}.params.patterns`, 'a non-empty array of {id, regex}');
      } else {
        p.patterns.forEach((/** @type {any} */ q, /** @type {number} */ j) => {
          if (!isObj(q)) { red('invalid-value', `${at}.params.patterns[${j}]`, '{id, regex}'); return; }
          if (!isNonEmptyString(q.id)) red('invalid-value', `${at}.params.patterns[${j}].id`, 'a non-empty id');
          regex(q.regex, `${at}.params.patterns[${j}].regex`);
        });
      }
      if (!strArray(p.extensions)) red('invalid-value', `${at}.params.extensions`, 'a non-empty array of file extensions');
      // scope is OPTIONAL here and absent on the genre guard: the scan covers
      // every changed file of these extensions. When a declaration does carry
      // one it is still shape-checked — but a missing scope is not a red.
      if (Object.hasOwn(p, 'scope')) populationNamed(`${at}.params.scope`);
      break;
    case 'files-changed':
      if (!strArray(p.allowPrefixes)) red('invalid-value', `${at}.params.allowPrefixes`, 'a non-empty array of path prefixes');
      if (p.requireNonEmpty !== true) red('invalid-value', `${at}.params.requireNonEmpty`, 'literally true');
      break;
    case 'rubric-step':
      for (const r of rubricStepShapeReds(p, `${at}.params`)) red(r.code, r.path, r.detail);
      break;
    case 'human-confirms':
      // the whole surface: the question the signer answers. It is shown to a
      // person verbatim, so an empty one is a bare "approve?" — ruling 2's
      // named failure mode, refused here rather than rendered.
      if (!isNonEmptyString(p.ask)) {
        red('invalid-value', `${at}.params.ask`, 'the plain question the signer answers while looking at the finished '
          + 'result — a human stage with nothing to ask is the bare "approve?" ruling 2 forbids');
      }
      break;
    case 'judged-floor': {
      // ONE spelling of what a card is, the JUDGE's own (`validateCard`, src/judged.js) —
      // the same rule `normalizeParser` follows: the validator and the grader must agree
      // about what a card MEANS, or the one that grades is the one nobody validated.
      const cv = validateCard(p.card);
      for (const detail of cv.reds) red('invalid-value', `${at}.params.card`, detail);
      // the artifact list. The listing rule (`checkPaths`) judges whether each element
      // EXISTS; this judges the shape and the bill — one paid call per artifact, so an
      // unbounded list is a bill rather than a red (the MAX_TERMS sibling).
      if (!strArray(p.paths)) {
        red('invalid-value', `${at}.params.paths`, 'a non-empty array of repository-relative files to judge — the '
          + 'AUTHORITATIVE artifacts, read off the seed listing, never the worker\'s summary of what it did');
      } else if (new Set(p.paths.map(String)).size !== p.paths.length) {
        // one artifact is one population, and a list naming it twice buys two paid
        // calls over identical bytes — deduplicating it silently would leave the
        // signer reading one list while the runner spent on another
        red('invalid-value', `${at}.params.paths`, 'the same artifact is named twice — one artifact is one population, '
          + 'and a duplicate buys a second paid call over identical bytes');
      } else if (p.paths.length > MAX_JUDGED_PATHS) {
        red('bounds', `${at}.params.paths`, `${p.paths.length} artifacts exceeds the ceiling of ${MAX_JUDGED_PATHS} — a `
          + 'judged stage buys one call per artifact, and the ceiling is the arbiter\'s, not the declaration\'s');
      }
      break;
    }
    default:
      red('unknown-kind', `${at}.kind`, `"${kind}" is in the catalogue but has no checker`, { kind });
  }
}

/** the scope as a comparable value — key order must not decide whether two
 * stages count the same population @param {any} sc */
function canonicalScope(sc) {
  if (!isObj(sc)) return null;
  const norm = (/** @type {any} */ v) => (Array.isArray(v) ? [...v].map(normPrefix).sort() : null);
  return { include: norm(sc.includePrefixes), exclude: norm(sc.excludePrefixes) };
}

/**
 * HAMR'S LISTING RULE: every path-like param must SELECT from the seed listing.
 * A path matching nothing is a distinct red, never a judgment call — round 2's
 * arm A derived `src/alertEmail.js` from the user's prose and reclassified 15
 * real errors into the wrong population, and no amount of reading the
 * declaration would have caught it.
 *
 * A trailing-slash (or `/**`) spelling ASSERTS a directory, so it must name one;
 * a bare path may name either. The repository root, however spelled, always
 * selects — it names the whole tree, which exists.
 * @param {{spec: KindSpec, params: any, at: string,
 *   red: (c: string, p: string, d: string, e?: object) => void,
 *   idx: {files: Set<string>, dirs: Set<string>}, haveListing: boolean}} o
 */
function checkPaths({ spec, params: p, at, red, idx, haveListing }) {
  if (!haveListing) return; // already redded once, at the top; not twice per path
  for (const dotted of spec.pathParams) {
    const value = readPath(p, dotted);
    if (!Array.isArray(value)) continue; // shape is the schema walk's business
    value.forEach((raw, i) => {
      if (!isNonEmptyString(raw)) return;
      const wantsDir = /(?:\/|\/\*\*?)$/.test(raw.trim());
      const norm = normPrefix(raw);
      if (isRoot(norm)) return;
      const path = `${at}.params.${dotted}[${i}]`;
      const isFile = idx.files.has(norm);
      const isDir = idx.dirs.has(norm);
      if (isDir) return;
      if (isFile && wantsDir) {
        red('path-not-in-listing', path, `"${raw}" is spelled as a directory but the seed tree says ${norm} is a file`,
          { declared: raw, resolved: norm, found: 'file', wanted: 'directory' });
        return;
      }
      if (isFile) return;
      red('path-not-in-listing', path, `"${raw}" matches nothing in the seed tree${nearby(norm, idx)} — a path is `
        + 'read off the repository, never derived from what a file sounds like it should be called',
        { declared: raw, resolved: norm, found: null, wanted: wantsDir ? 'directory' : 'any' });
    });
  }
}

/** the mechanical half of the gap: what DOES exist beside the invented path.
 * Named items, counts, capped — never a paragraph (F38/F39).
 * @param {string} norm @param {{files: Set<string>, dirs: Set<string>}} idx */
function nearby(norm, idx) {
  const parent = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
  const under = [...idx.files, ...idx.dirs]
    .filter((f) => (parent === '' ? !f.includes('/') : f.startsWith(`${parent}/`) && !f.slice(parent.length + 1).includes('/')))
    .sort();
  if (under.length === 0) return '';
  const shown = under.slice(0, 8);
  const tail = under.length > shown.length ? `, and ${under.length - shown.length} more` : '';
  return ` (under ${parent === '' ? 'the repository root' : parent} the seed tree has: ${shown.join(', ')}${tail})`;
}

/**
 * THE D5 LINE. Every injected guard must be PRESENT, of the right kind, and
 * byte-equal to the genre's own parameters. Only the guard's declared `fill`
 * slots are the model's, and a parameter the guard does not carry at all is a
 * NARROWING — which is how round 3's arm A scoped the suppression scan to two
 * files and made a weaker guard look stricter.
 * @param {{declaration: any, guards: any[], red: (c: string, p: string, d: string, e?: object) => void}} o
 */
function checkGuards({ declaration, guards, red }) {
  const stages = Array.isArray(declaration?.stages) ? declaration.stages : [];
  for (const g of guards) {
    const i = stages.findIndex((/** @type {any} */ s) => isObj(s) && s.name === g.name);
    if (i === -1) {
      red('guard-missing', 'stages', `the genre's "${g.name}" guard is not in the declaration — mandatory guards are `
        + 'shown to the user and cannot be removed (D5)', { guard: g.name, kind: g.kind });
      continue;
    }
    const s = stages[i];
    const at = `stages[${i}]`;
    if (s.kind !== g.kind) {
      red('guard-weakened', `${at}.kind`, `the "${g.name}" guard is a ${g.kind}; this declares ${String(s.kind)}`,
        { guard: g.name, param: 'kind' });
      continue;
    }
    const params = isObj(s.params) ? s.params : {};
    for (const [k, want] of Object.entries(g.params)) {
      if (!deepEqual(params[k], want)) {
        red('guard-weakened', `${at}.params.${k}`, `the "${g.name}" guard's ${k} is genre property and is fixed: `
          + `expected ${JSON.stringify(want)}`, { guard: g.name, param: k, expected: want, declared: params[k] });
      }
    }
    for (const k of Object.keys(params)) {
      if (Object.hasOwn(g.params, k) || g.fill.includes(k)) continue;
      red('guard-weakened', `${at}.params.${k}`, `the "${g.name}" guard does not take ${k} — adding one narrows what `
        + 'the guard covers, and a guard that covers less is not a stricter guard', { guard: g.name, param: k, declared: params[k] });
    }
  }
}

/** structural equality over plain JSON data (the shapes a declaration carries)
 * @param {any} a @param {any} b */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * The declaration the EXECUTOR sees and the SIGNATURE covers: every
 * `count-not-worse` parser resolved to `{terms: [...]}`, so the short form stops
 * existing at this boundary and there is exactly one shape downstream (D13
 * forward-compat point 3 — the hash is taken over the RESOLVED form, or an
 * omittable-with-a-default field changes what runs without changing what was
 * signed).
 *
 * A parser that would not normalise is left VERBATIM: it already carries a red,
 * and rewriting it would hide what the model actually wrote.
 * @param {any} declaration
 */
export function normalizeDeclaration(declaration) {
  if (!isObj(declaration) || !Array.isArray(declaration.stages)) return declaration;
  const out = structuredClone(declaration);
  for (const s of out.stages) {
    if (!isObj(s) || s.kind !== 'count-not-worse' || !isObj(s.params)) continue;
    const n = normalizeParser(s.params.parser, 'parser');
    if (n.ok) s.params.parser = { terms: n.terms };
  }
  return out;
}
