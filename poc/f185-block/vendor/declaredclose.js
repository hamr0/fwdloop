// borrowed-from: bareloop src/declaredclose.js@v0.56.0 (3383cce)
// THE RUNTIME BRIDGE — close-authoring v1, module M4a (design record
// 2026-08-07 D8/D9/D12/D13; gate-2 POC closed 2026-08-08).
//
// M1 runs a DECLARATION. The arbiter's shell (`src/ralph.js`) runs an ARGV. This
// module is the one place those two shapes meet, and it exists because of the
// integration decision M4 had to make in the open:
//
//   A declared close is carried by a NEW spec field (`closeDecl`) and executed by
//   M1's own kind executor. It is never COMPILED DOWN to command stages.
//
// The rejected alternative is the one that looks cheaper: render each declared
// stage as a shell one-liner and let the existing `close[]` path run it. That
// would turn owned kinds back into authored shell strings — the exact thing D3
// makes inexpressible ("the danger is in the ACTIONS, not the SYNTAX"), and the
// exact thing the whole rung exists to remove. A declaration whose meaning is a
// generated `sh -c` is a script with extra steps, and the arbiter would be
// judging text nobody validated. So: two executors, one CONTRACT, and the
// contract is what this file holds still.
//
// WHAT "one contract" MEANS, concretely — every one of these is a behaviour the
// command path already had and the declared path must not lose:
//
//   * FIRST RED WINS, and the deciding stage NAMES itself. A stage after the
//     first red never runs, so a later green cannot mask an earlier failure.
//   * THE FORBIDDEN ZONE (`CLOSE_FAULTS`). A stage that rendered no judgment is
//     NOT a verdict: it routes by its own typed fault (`STOP_FAULTS`, stamped in
//     M1 at the site that observed it) into the arbiter's four rows, so a
//     timeout still offers "raise the close timeout" and a spawn failure still
//     offers "fix the close". Pooling them would erase exactly the decision
//     information the escalation carries.
//   * THE GAP HEADER. `close stage "<name>" failed:` — the SAME spelling, from
//     `stageGap` in ralph.js, because `src/trend.js` parses it to bucket a grade
//     per stage. A second spelling here is the two-transforms class (F9) on the
//     instrument that decides whether a human tops a run up.
//   * THE GAP OUTPUT CONTRACT: every line prefixed, trims announced (M1 owns
//     that), and the whole thing SCRUBBED at this boundary through the one
//     `SECRET_PATTERNS` inventory — M1 deliberately does not scrub, the caller
//     does, and this is the caller.
//   * THE CHECK MENU derives from stage NAMES exactly as before (`checkMenu` in
//     src/job.js reads `name`/`offer`/`needs` and nothing else), so
//     `check-passes(name)` reaches a declared stage with no change at all.
//
// TWO THINGS THIS BRIDGE ADDS, both because the declared executor knows more
// than an exit code does:
//
//   1. `gapKeep`. Every declared gap line carries a fixed PREFIX, so the anchored
//      pattern derived from it designates the stage's own failures — which is
//      what Layer R's red-set reads off `stagedClose.find(...).gapKeep`. It is
//      ours, derived mechanically from one constant, and never model-authored:
//      the declaration has no field for it.
//   2. A TREND VALUE. `count-not-worse` reports a real number, so the grade does
//      not have to be scraped back out of prose. It is donated ONLY for
//      `lower-is-better`, and the omission is the load-bearing half: trend.js
//      reads "improved" as `value < best`, so donating a higher-is-better floor
//      would read a DROPPING test count as convergence and recommend a top-up on
//      a dying run. That is the dangerous direction; a null is the honest one
//      (F6), and the stage position still travels.
//
// THE SEED (D8). HEAD at run start, READ and recorded, never typed and never
// stored in the signed spec — D12: the close stores the counting rule, never the
// number, so a baseline frozen at signing would judge run 5 against run 1's tree.
//
// SEED WORKTREES are scoped to ONE `runDeclaredStages` call unless a caller
// hands in a shared holder. Cost, measured against safety and stated rather than
// assumed: at most one checkout per close invocation (M1 shares it across that
// close's stages), and none at all while the tree is verifiably at seed —
// precheck and preflight therefore pay nothing. A run-scoped holder would pay
// once instead of once-per-invocation, but `runPlan` has a dozen return paths and
// a leaked worktree outlives the process that made it.

import { runStage, makeSeedTrees, STOP_FAULTS, EXIT_RED, JUDGED_FLOOR_KIND, judgedStages } from './kinds.js';
import {
  validateDeclaration, classGuards, genreOwnedEnvNames, ungroundedGenreEnv, DECLARABLE_LANGUAGES, TYPES_GENRE, catalogueForLang, KIND_CATALOGUE, TEXT_GENRE, genreForLang,
  VERDICT_CLASSES, LIVE_CLASSES, NEVER_OFFERED_KINDS,
} from './authoring.js';
// the calibration set's own gate lives beside the rulebook it is graded against
// (src/judged.js) — one opinion about what a judged floor's signed artifacts are
import { validateCalibrationSet } from './judged.js';
import { stageGap } from './ralph.js';
import { isObj, isNonEmptyString } from './validate.js';

/** @typedef {{code: string, path: string, detail: string, [k: string]: any}} Red */

/** The genres a `closeDecl` may name. v1 admits exactly one (D13) — a genre
 * classifier is designed the day there is a second genre to classify. */
export const DECLARED_GENRES = Object.freeze([TYPES_GENRE.name, TEXT_GENRE]);
/**
 * The exact field set of a `closeDecl` — anything else is a smuggle channel, the
 * same rule `STAGE_FIELDS` enforces on a command stage.
 *
 * `genreEnv` is the ARBITER's own record of what it injected (M3's
 * `applyGenreEnv`), and it is here because the injection has to survive being
 * re-read. The flow applies the genre's variable to every env-capable stage
 * AFTER the model's form passed; from then on every re-validation — signing
 * (`prepareSigning`), the job validator (`src/job.js`), the runner
 * (`src/planrun.js`) — sees that key sitting in `params.env` and cannot, from
 * the stage alone, tell our injection from a model-authored guess. Recording it
 * once, in the SIGNED envelope, is what makes the comparison an EQUALITY rather
 * than a presence flag (the same move `checkGuards` makes for guard params), and
 * it is why the model never gets to author it: `authorCloseForJob` composes this
 * field from the flow's own applied map, never from model output. Its keys are
 * constrained to the names the genre OWNS, so it can never become an environment
 * channel of its own.
 */
export const CLOSE_DECL_FIELDS = Object.freeze(['genre', 'lang', 'stages', 'notes', 'refused', 'guardLines', 'picks', 'list', 'genreEnv', 'calibration']);

/** the fields of a row of the one check list that the signed close carries (`closeDecl.list`); the row's own words are never signed */
export const SIGNED_ROW_FIELDS = Object.freeze(['line', 'key', 'from', 'by', 'kind', 'state', 'rule', 'part', 'reason', 'facts']);
/** the states a signed row may end in */
export const SIGNED_STATES = Object.freeze(['built', 'not-checked', 'dropped']);
const SIGNED_FROM = Object.freeze(['rule', 'pick', 'look', 'agent', 'default']);
const SIGNED_BY = Object.freeze(['you', 'agent', 'default']);
const SIGNED_KINDS = Object.freeze(['rule', 'fact', 'cited', 'count', 'phrase', 'numbers', 'floor']);

/** what a stored calibration set carries, ENUMERATED: the frozen cases and the judge
 * tier that graded them. Both are inside the spec, so `jobSpecHash` covers both — which
 * is the whole mechanism behind "a judge-model bump forces a full recalibration"
 * (src/judged.js, `resolveJudge`): the field moves, the hash moves, the signature dies,
 * and the re-sign re-runs the gate. Anything else in there is a field nobody reads. */
export const CALIBRATION_FIELDS = Object.freeze(['cases', 'judgeModel']);

/**
 * The prefix M1 puts on EVERY gap line of a declared stage (its `ctx.gapKeep`).
 * A literal, so the anchored pattern below is exact.
 */
export const DECLARED_GAP_PREFIX = 'close: ';
/** The `gapKeep` PATTERN for a declared stage, DERIVED from the prefix so the
 * two can never drift. Layer R's red-set and `boundGap`'s keep-block both read
 * it; because every declared line carries the prefix, it designates the stage's
 * whole judged output rather than a hand-picked slice of it. */
export const DECLARED_GAP_KEEP = `^${DECLARED_GAP_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;

/**
 * The close verdict word for a run WAITING on a person (N4 §1.3/§1.4). A
 * literal, exported, because three readers key on it — the runner's pause
 * branch, the ledger's excluded set, and the trend reader's blind rule — and
 * three hand-spelled copies of one terminal is how they come to disagree.
 *
 * It is not in `CLOSE_FAULTS` and must never be added: a fault says the close
 * could not render a verdict, and this says the close is not FINISHED rendering
 * one. The first escalates; the second is a checkpoint the operator returns to.
 */
export const HUMAN_PAUSE = 'human-pause';

/**
 * The RUN-level terminal names the hitl class mints one layer up from
 * `HUMAN_PAUSE` (N4 §1.3–§1.5): the checkpoint, and the honest refusal of the
 * operator's rerun input. Spelled once here, beside the close-verdict word they
 * translate, for the same reason `HUMAN_PAUSE` is — the emitters (`planrun.js`),
 * the ledger's excluded set, the resume reader (`reuse.js`), and the runner
 * script all key on them, and hand-spelled copies of one terminal is how they
 * come to disagree.
 *
 * There were three (2026-08-17): `hitl-cancel` was the signer's own terminal and
 * is DELETED with the door it belonged to. A person who does not want to carry on
 * now PAUSES — the same checkpoint, resumable, retired by the TTL if nobody comes
 * back — so nothing in this tree mints that name any more. The ledger keeps the
 * bare string in its excluded set so a spine written before this change still
 * reads as governance rather than as a capability gap; that is a READER's
 * backward compatibility, and deliberately not a constant a writer could reach.
 */
export const HITL_PAUSE = 'hitl-pause';
export const HITL_DECISION_RED = 'hitl-decision-red';

/**
 * The terminals above that leave the run WAITING ON A PERSON — as a list, minted
 * beside the names it holds so a reader keys on membership rather than on a
 * spelling, and a rename here travels to every reader for free.
 *
 * It is deliberately NOT `reuse.js`'s `CHECKPOINT_OUTCOMES`, which is the wider
 * RESUME list: every stop that left work on disk and an allowance unspent, money
 * and time included. Those are governance stops the reuse loop is meant to try
 * again under its remaining tries; this is the half no further attempt can
 * change, because the allowance still unspent is a human answer. `CHECKPOINT_OUTCOMES`
 * is composed FROM this list so the two can never disagree about which is which.
 *
 * `HITL_DECISION_RED` is not here: it is a verdict already rendered on the operator's
 * own input, not a question still open.
 */
export const HUMAN_CHECKPOINTS = Object.freeze([HITL_PAUSE]);

/** The verdict classes a DECLARED close may claim. Named as data so the job
 * validator reads one hierarchy table rather than hard-coding a class.
 *
 * `hard` is by CONSTRUCTION: every mechanical kind is a command whose measurement
 * is the truth. `hitl` joined it at N4 slice 1, and `soft` at softgreen module 3
 * — each only because its kind is genuinely LIVE (`human-confirms`, then
 * `judged-floor`): the widening and the kind go in one commit, or this table
 * admits a class the executor cannot render.
 *
 * `hitl` STAYS despite the class's retirement (PRD v1.71: the human stage moved
 * out of the close and became the review door at the end of every run). It is
 * kept because `jobs/litectx-maintainer.json` is a SIGNED spec carrying a hitl
 * declaration, and a signed spec is untouchable — dropping the spelling here
 * would invalidate a signature the operator already gave, which is a re-sign
 * nobody asked for. Retiring it is a separate, deliberate deletion.
 *
 * The direction that matters is unchanged. This says which class a declaration
 * MAY claim; `closeCeiling` says which class its stages actually NEED. A pick
 * below the ceiling is still the silent upgrade `class-ceiling` refuses. */
export const DECLARED_CLOSE_CLASSES = Object.freeze(['hard', 'soft', 'hitl']);

/** @param {any} job @returns {boolean} */
export function isDeclaredClose(job) {
  return isObj(job) && isObj(job.closeDecl) && Array.isArray(job.closeDecl.stages);
}

/**
 * The declaration's stages as the RUNNER's stage descriptors: the declared
 * `{name, kind, params}` plus the arbiter's own `gapKeep`.
 *
 * `offer` and `needs` pass through untouched when a declaration carries them
 * (v1's schema does not let one), so `checkMenu`'s derivation is unchanged.
 *
 * THE JUDGE TIER RIDES ALONG, and it rides as a STAMP for the same reason `offer`
 * does. The tier that graded this close's calibration set is a CLOSE-level fact
 * (`calibration.judgeModel`), and the stage that would buy a judge call is a STAGE;
 * `runStage` is handed stages and never the declaration they came out of. Rather than
 * plumb a second close-level channel down through every executor seam, the one place
 * that already turns a declaration into stages carries it across — and it carries it
 * from the SIGNED bytes, so a stage can never name a tier the signature does not.
 * `runJudgedFloor` refuses a mismatch; the absence of a stamp is the SPEC gate's
 * business (`validateCloseDecl` reds a set with no model), never a runtime fall-back.
 * @param {any} closeDecl
 * @returns {any[]|null} null when this is not a declaration
 */
export function declaredStages(closeDecl) {
  if (!isObj(closeDecl) || !Array.isArray(closeDecl.stages)) return null;
  const calibrationJudgeModel = isObj(closeDecl.calibration) && isNonEmptyString(closeDecl.calibration.judgeModel)
    ? closeDecl.calibration.judgeModel
    : null;
  return closeDecl.stages.map((s) => (isObj(s)
    // RULING 5, stamped by the ARBITER rather than trusted from the artefact:
    // a judged or human stage is `offer: false` BY LAW, so `checkMenu` can never
    // hand the agent `check-passes(<a person>)`. The validator refuses a
    // declaration that says anything else (`human-stage-offered`), so this is
    // never overwriting a signer-visible value — it is filling in a law the
    // declaration schema deliberately gives the composer no way to state.
    ? {
      ...s,
      gapKeep: DECLARED_GAP_KEEP,
      ...(NEVER_OFFERED_KINDS.includes(s.kind) ? { offer: false } : {}),
      ...(s.kind === JUDGED_FLOOR_KIND && calibrationJudgeModel !== null ? { calibrationJudgeModel } : {}),
    }
    : s));
}

// ── the spec-level gate ──────────────────────────────────────────────────────

/**
 * Validate a `closeDecl` as a JOB SPEC field: the envelope (genre, language,
 * notes) plus M2's full declaration validator underneath it.
 *
 * `listing` is what splits the two callers, and the split is deliberate:
 *   - the JOB VALIDATOR has no repository, so it passes nothing and gets
 *     `grounded: false` — every tree-independent rule runs, the path rule and
 *     the scoped-job derivation do not;
 *   - the RUNNER has the real seed, so it passes the real listing and gets
 *     `grounded: true`. It runs this BEFORE any stage and before any token, so
 *     the deferred half is proved rather than skipped.
 * A caller that passes neither a listing nor `deferListing` gets M2's
 * `listing-absent` red, unchanged: a validator handed nothing to check against
 * must refuse, never report a declaration it never examined.
 *
 * THREE checks now ride on the listing, not two: the path rule, the scoped-job
 * derivation, and the GROUNDING of a recorded `genreEnv` (a by-value comparison
 * between two copies inside one hand-editable spec proves they agree, never that
 * the arbiter wrote them — see `ungroundedGenreEnv`). All three are deferred at
 * the job-spec gate and all three are re-run GROUNDED by the runner before any
 * stage executes, so the deferral moves the check rather than dropping it. The
 * grounded gates are `prepareSigning`'s gate 1b — where the signature is minted,
 * so a forged env can never be signed in the first place — and `runPlan`'s
 * pre-flight, which catches a spec edited after signing.
 *
 * `verdictType` is the class the USER picked, and it is REQUIRED here because
 * the guard battery keys off it (PRD v1.57 §2): with no class in hand there is
 * no battery, and M2 would be handed nothing to check D5 against. It arrives
 * from the spec's sibling `verdictType` field on every caller — the job
 * validator, the signing gate and the runner all hold the whole spec.
 *
 * @param {any} closeDecl
 * @param {{at?: string, listing?: string[]|null, deferListing?: boolean,
 *   catalogue?: Record<string, any>, verdictType?: string|null, writeScope?: string[]|null, jobLines?: {n: number}[]|null,
 *   inputLabels?: string[]|null}} [opts]
 * @returns {{ok: boolean, reds: Red[], closeDecl: any, grounded: boolean,
 *   scoped: {scoped: boolean, via: string|null},
 *   ceiling: {class: string, kind: string, stage: string|null, locked: boolean}|null}}
 */
export function validateCloseDecl(closeDecl, opts = {}) {
  const { at = 'closeDecl', listing = null, catalogue, verdictType = null, writeScope = null, jobLines = null, inputLabels = null } = opts;
  const deferListing = opts.deferListing === true;
  /** @type {Red[]} */
  const reds = [];
  /** @type {(code: string, path: string, detail: string, extra?: object) => void} */
  const red = (code, path, detail, extra = {}) => { reds.push({ code, path, detail, ...extra }); };
  const bail = () => ({ ok: false, reds, closeDecl: null, grounded: false, scoped: { scoped: false, via: null }, ceiling: null });

  // THE PICKED CLASS, before anything else, because the battery hangs off it.
  // The path is the SPEC's own `verdictType` rather than a `closeDecl` child:
  // the class is the user's separate answer and this red must point at the field
  // they actually set, not at the artefact it invalidates.
  //
  // A locked class reds here as well as on job.js's counted `request-red`, and
  // that is two axes rather than one problem twice: one COUNTS the demand for
  // the class, this one says the close cannot be validated because the class it
  // was picked under has no battery. It is the same split `langOk` already
  // makes, and both bail for the same reason — a validator configured out of its
  // own rule reports a declaration it never examined.
  const picked = String(verdictType);
  if (!VERDICT_CLASSES.includes(picked)) {
    red('class-absent', 'verdictType', `the verdict class the user picked — one of ${VERDICT_CLASSES.join(' | ')}. `
      + 'It selects this close\'s mandatory guard battery, which has no default and is never inferred');
    return bail();
  }
  if (!LIVE_CLASSES.includes(picked)) {
    red('class-battery-locked', 'verdictType', `"${picked}" is declared-but-locked: v1 builds a guard battery for `
      + `${LIVE_CLASSES.join(', ')} only, and a close cannot be validated against a battery that does not exist — `
      + 'validating it against another class\'s guards would sign a close nobody checked');
    return bail();
  }

  if (!isObj(closeDecl)) {
    red('invalid-value', at, 'an authored close DECLARATION: { genre, lang, stages: [...] }');
    return bail();
  }
  for (const key of Object.keys(closeDecl)) {
    if (!CLOSE_DECL_FIELDS.includes(key)) {
      red('unknown-field', `${at}.${key}`, `not a closeDecl field (script bodies, seed refs and frozen thresholds all `
        + `land here); fields: ${CLOSE_DECL_FIELDS.join(', ')}`);
    }
  }
  // the signed copy of the one check list: an array of rows with exactly the signed fields (no words), each in its closed menu
  if (closeDecl.list !== undefined) {
    if (!Array.isArray(closeDecl.list)) red('invalid-value', `${at}.list`, 'the one check list as an array of rows: { line, key, from, by, kind, state, rule?, part?, reason? }');
    else {
      closeDecl.list.forEach((/** @type {any} */ row, /** @type {number} */ i) => {
        const w = `${at}.list[${i}]`;
        if (!isObj(row)) { red('invalid-value', w, 'a row: { line, key, from, by, kind, state, rule?, part?, reason? }'); return; }
        for (const k of Object.keys(row)) if (!SIGNED_ROW_FIELDS.includes(k)) red('unknown-field', `${w}.${k}`, `not a signed row field (the row's own words are never signed); fields: ${SIGNED_ROW_FIELDS.join(', ')}`);
        if (!Number.isInteger(row.line) || row.line < 1) red('invalid-value', `${w}.line`, 'the job line number');
        if (!isNonEmptyString(row.key)) red('invalid-value', `${w}.key`, 'the row key, a non-empty string');
        if (!SIGNED_FROM.includes(row.from)) red('invalid-value', `${w}.from`, `menu: ${SIGNED_FROM.join('|')}`);
        if (!SIGNED_BY.includes(row.by)) red('invalid-value', `${w}.by`, `menu: ${SIGNED_BY.join('|')}`);
        if (!SIGNED_KINDS.includes(row.kind)) red('invalid-value', `${w}.kind`, `menu: ${SIGNED_KINDS.join('|')}`);
        if (!SIGNED_STATES.includes(row.state)) red('invalid-value', `${w}.state`, `menu: ${SIGNED_STATES.join('|')}`);
        if (row.rule !== undefined && !Number.isInteger(row.rule)) red('invalid-value', `${w}.rule`, 'the ~ rule number');
        if (row.part !== undefined && !(isObj(row.part) && Number.isInteger(row.part.line) && Number.isInteger(row.part.part))) red('invalid-value', `${w}.part`, '{ line, part }: the job line and the index of the part that carries the row');
        if (row.reason !== undefined && typeof row.reason !== 'string') red('invalid-value', `${w}.reason`, 'plain words');
        if (row.facts !== undefined && !(Array.isArray(row.facts) && row.facts.every((/** @type {unknown} */ x) => typeof x === 'string'))) red('invalid-value', `${w}.facts`, 'the names of the facts the row built, an array of strings');
      });
    }
  }
  // PART 1a: a genre is bound to its language — code languages are TYPES, the rubric-files language is TEXT, and neither may
  // wear the other's label (`lang` is checked just below; an unknown lang reds there)
  if (!DECLARED_GENRES.includes(closeDecl.genre) || closeDecl.genre !== genreForLang(closeDecl.lang)) {
    red('invalid-value', `${at}.genre`, `menu: ${DECLARED_GENRES.join('|')} — a close's genre follows its language (${genreForLang(closeDecl.lang)} for "${String(closeDecl.lang)}"), `
      + 'and a genre with no guard battery must refuse rather than author a close without the guards it cannot supply');
  }
  const langOk = DECLARABLE_LANGUAGES.includes(closeDecl.lang);
  if (!langOk) {
    red('invalid-value', `${at}.lang`, `menu: ${DECLARABLE_LANGUAGES.join('|')} — the language selects the genre's guard `
      + 'battery and its environment, both of which are ours and neither of which has a default');
  }
  // `notes` is NOT checked here. It is M2's rule now (`validateDeclaration`),
  // for the reason the divergence caused: this gate runs at SIGNING, and a rule
  // that lives only at signing cannot be fed back as a revision — the run pays
  // for a close, the authoring loop accepts it, and the job dies on a defect the
  // model was never shown. One spelling, at the gate that can still revise, and
  // the red still arrives here with this gate's own `at` prefix. It rides the
  // `langOk` bail below like every other declaration-shape red: with no language
  // there is no declaration to validate at all.
  //
  // Without a language there is no guard battery and no owned-env list, so M2
  // would be handed nothing to check D5 against — and a validator configured out
  // of its own rule reports a declaration it never examined. Refuse here instead.
  if (!langOk) return bail();

  // The recorded injection (see CLOSE_DECL_FIELDS). Constrained to the names the
  // genre owns and to non-empty string values: an unowned name here would be an
  // environment channel wearing the arbiter's coat, and an empty value is not the
  // same instruction as an unset variable (`genreEnv` never ships one).
  const owned = genreOwnedEnvNames(closeDecl.lang);
  /** @type {Record<string, string>} */
  const envInjected = {};
  if (closeDecl.genreEnv !== undefined) {
    if (!isObj(closeDecl.genreEnv)) {
      red('invalid-value', `${at}.genreEnv`, 'the genre environment this close was authored under, as an object of '
        + 'non-empty string values — it records what the ARBITER injected, and nothing else belongs in it');
    } else {
      for (const [name, value] of Object.entries(closeDecl.genreEnv)) {
        if (!owned.includes(name)) {
          red('invalid-value', `${at}.genreEnv.${name}`, `the ${closeDecl.lang} genre does not own ${name} — this field `
            + `records the genre's own injection only (${owned.length ? owned.join(', ') : 'this genre owns none'}), `
            + 'never an environment of its own');
        } else if (!isNonEmptyString(value)) {
          red('invalid-value', `${at}.genreEnv`, `${name} is recorded with no value — an empty variable is not the same `
            + 'instruction as an unset one, and the genre never builds one');
        } else envInjected[name] = value;
      }
    }
  }
  // GROUNDED, wherever there is a tree to ground against. The by-VALUE check
  // above proves the envelope and the stage AGREE — and both copies sit in the
  // same hand-editable spec, so agreement is free to a forger: `genreEnv` and
  // `params.env` both reading `/tmp/attacker-stubs` is perfectly self-consistent
  // and grades a checkout nobody signed. The seed tree is the thing the forger
  // does not own, so every element of a recorded value must SELECT from the
  // listing — the same trick hamr's path rule already uses, and an exact fit for
  // what `applyGenreEnv` can produce (see `ungroundedGenreEnv`).
  //
  // It runs at both gates that hold a listing (`prepareSigning`'s grounded gate
  // 1b and the runner's pre-flight re-validation) and cannot run at the deferred
  // job-spec gate, which has no repository — that gate's deferral is already
  // stated above, and the runner re-validates GROUNDED before any stage runs, so
  // this is moved rather than skipped.
  if (Array.isArray(listing) && listing.length > 0) {
    for (const u of ungroundedGenreEnv(closeDecl.lang, envInjected, listing)) {
      red('genre-env-ungrounded', `${at}.genreEnv.${u.name}`, `${u.name} is recorded as the genre's own injection but `
        + `"${u.element}" matches nothing in the seed tree — the arbiter builds this value by joining source prefixes it `
        + 'already filtered against the listing, so a path the tree does not contain is not one it can have written',
      { name: u.name, element: u.element, resolved: u.resolved });
    }
  }

  const v = validateDeclaration(closeDecl, {
    // PART 1a: the kinds a close may use depend on its language — a rubric-files ("text") close sees its own two kinds, every
    // code close never sees a rubric-only one. A caller-supplied catalogue is narrowed the same way.
    catalogue: catalogueForLang(closeDecl.lang, catalogue ?? KIND_CATALOGUE),
    // BOTH are forwarded, always. Forwarding only one would hide the case M2
    // reds as `listing-conflict` — a caller that defers the tree-grounded half
    // AND hands over a tree does not know which gate it is running, and silently
    // honouring one of the two is how a signature ends up covering a check
    // nobody performed.
    listing,
    ...(deferListing ? { deferListing: true } : {}),
    guards: classGuards({ verdictType: picked, lang: closeDecl.lang }),
    verdictType: picked,
    writeScope,
    jobLines,
    inputLabels,
    envOwned: owned,
    // POST-injection: an owned name is accepted only when its value is EXACTLY
    // the recorded one. `{}` (nothing recorded) keeps the pre-injection rule, so
    // a declaration that authored the variable itself is still refused.
    envInjected,
  });
  for (const r of v.reds) reds.push({ ...r, path: r.path ? `${at}.${r.path}` : at });

  // ── THE FROZEN CALIBRATION SET (softgreen module 4, design §4.4). It rides
  // the closeDecl rather than a stage's params because it calibrates the RULER,
  // not one stage's parameters — and because it is read BEFORE any stage runs.
  //
  // WHAT IS CHECKED HERE is that a stored set is LEGAL: exactly the signed size,
  // both polarities present, itemized reds naming lines THIS close's card
  // actually carries. WHAT IS NOT is whether the pipe grades it correctly — that
  // is module 5's gate, it costs paid calls, and a validator cannot buy them.
  //
  // A set with NO judged stage to calibrate is its own red: the card lives on
  // the stage, so an orphan set is graded against nothing and would validate
  // clean forever. The reverse (a judged stage with no set) is deliberately NOT
  // redded here — making the set MANDATORY is the signing gate's call, and
  // module 5 owns it.
  if (closeDecl.calibration !== undefined) {
    const judged = judgedStages(closeDecl);
    if (!isObj(closeDecl.calibration)) {
      red('invalid-value', `${at}.calibration`, 'the frozen calibration set, as an object carrying `cases`');
    } else if (judged.length !== 1) {
      red('calibration-orphan', `${at}.calibration`, `this close carries a calibration set and ${judged.length} `
        + 'judged-floor stage(s). The set calibrates ONE judged ruler against ONE card — with no judged stage it is '
        + 'graded against nothing and would read clean forever, and with two there is no one card it belongs to',
      { judgedStages: judged.length });
    } else {
      for (const key of Object.keys(closeDecl.calibration)) {
        if (!CALIBRATION_FIELDS.includes(key)) red('invalid-value', `${at}.calibration.${key}`, `a calibration set carries ${CALIBRATION_FIELDS.map((f) => `\`${f}\``).join(' and ')} and nothing else`);
      }
      // WHICH TIER GRADED THIS SET, and it is REQUIRED rather than optional. A
      // stored set is only worth the judge that graded it (§4.2's safety argument
      // is BA-20's haiku-4.5 injection evidence and nothing else), so a set with
      // no model beside it is a set nobody can attribute — and the `CALIBRATION_FIELDS`
      // docstring's promise that a bump forces recalibration has nothing to fire
      // on. Required HERE and not at the stage, for the same reason the SET's own
      // presence is the signing gate's call and not this validator's: this gate
      // reads a stored artifact and says whether it is legal. The RUNTIME half —
      // refusing to grade when the stored tier is not the tier this run would buy
      // — is the judged stage's (`runJudgedFloor`), reached through the stamp
      // `declaredStages` puts on the stage.
      if (closeDecl.calibration.judgeModel === undefined) {
        red('missing-required', `${at}.calibration.judgeModel`, 'the judge tier this set was GRADED by — a calibration '
          + 'nobody can attribute to a model is a floor nobody can tell apart from a bumped one');
      } else if (!isNonEmptyString(closeDecl.calibration.judgeModel)) {
        red('invalid-value', `${at}.calibration.judgeModel`, 'the judge tier this set was graded by, as a non-empty string');
      }
      const cv = validateCalibrationSet(closeDecl.calibration.cases, { card: judged[0]?.params?.card ?? null });
      for (const r of cv.reds) reds.push({ ...r, path: r.path ? `${at}.${r.path}` : `${at}.calibration` });
    }
  }

  const ok = reds.length === 0;
  return {
    ok,
    reds,
    closeDecl: ok ? { ...closeDecl, stages: v.declaration.stages } : null,
    grounded: v.grounded,
    scoped: v.scoped,
    ceiling: v.ceiling,
  };
}

// ── the execution bridge ─────────────────────────────────────────────────────

/**
 * The genre's mandatory guard NAMES for a declaration — which stages are D5's
 * guards and which are the job's own work. The seed-verdict read (D9.3) needs
 * exactly this split: `changed-from-seed` is RED at its own seed by
 * construction, so counting it as work would let a close with nothing to do
 * pass the "something must be red at seed" gate.
 * The battery keys off the CLASS the user picked (PRD v1.57 §2), so the class
 * comes in beside the declaration. A class or a language with no battery hands
 * back `[]` — this reads a split, it does not enforce one, and every caller
 * reaches it only after `validateCloseDecl` has already refused both cases.
 * @param {any} closeDecl @param {string} verdictType @returns {string[]}
 */
export function guardNames(closeDecl, verdictType) {
  if (!isObj(closeDecl) || !DECLARABLE_LANGUAGES.includes(closeDecl.lang)) return [];
  if (!LIVE_CLASSES.includes(String(verdictType))) return [];
  return classGuards({ verdictType: String(verdictType), lang: closeDecl.lang }).map((g) => g.name);
}

/**
 * One declared stage's result, in the ARBITER's verdict vocabulary.
 *
 * `notes` is the DIAGNOSTIC channel, and it exists because M1's kinds announce
 * some things whichever way a stage lands: a declared env var that was dropped,
 * the scope filter's own arithmetic. A red carries those out inside its gap; a
 * green and an instrument stop had nowhere to put them and this function used to
 * compute the text and discard it. A green measured over a filtered population
 * is still a filtered number, and the operator reads why — checking the GREENS
 * is doctrine, and an audit trail that only survives a red cannot do it.
 *
 * It is `notes` and NOT `.gap`, deliberately. Every consumer downstream guards
 * with `if (gap)`, so a green carrying one would read as revision-worthy and a
 * stop carrying one would look like a verdict it never rendered. Nothing routes
 * on this field, nothing bounds on it, and no verdict moves because of it; it
 * rides the spine records that already spread the whole verdict
 * (`close-precheck`, `outer-close`, ralph's `close-verdict`).
 * @param {any} r an M1 `StageResult`
 * @param {(s: string) => string} redact
 * @returns {{verdict: string, notes?: string, gap?: string, detail?: string,
 *   exitCode?: number, judgedCount?: number, ask?: string|null}} `notes` is absent, never empty —
 *   a field that is always there says nothing; a RED carries its diagnostics
 *   inside `gap` and so has none of its own.
 */
function translate(r, redact) {
  const gapText = redact((r.gapLines ?? []).join('\n'));
  /** absent rather than empty: a field that is always there says nothing */
  const notes = gapText ? { notes: gapText } : {};
  if (r.verdict === 'green') return { verdict: 'satisfied', judgedCount: 1, ...notes };
  // THE PAUSE (N4 §1.3) — its own verdict word, and deliberately NOT one of the
  // three below. `satisfied` would mint a green nobody gave; `needs_revision`
  // would hand the fix worker a gap the person has not written yet; a
  // `CLOSE_FAULTS` word would file a working arbiter as a broken instrument.
  // No `gap` and no `judgedCount`: nothing was judged, and every consumer guards
  // with `if (gap)`.
  if (r.verdict === 'pause') return { verdict: HUMAN_PAUSE, ask: r.detail?.ask ?? null, ...notes };
  if (r.verdict === 'red') {
    return {
      verdict: 'needs_revision',
      // Never falsy: every consumer guards with `if (gap)`, and an empty red
      // would silently kill gap feedback, the after-red hooks and the stall
      // detector at once (the same rule `runClose` states for its own path).
      gap: gapText || `(stage "${r.stage}" rendered a red with no output)`,
      exitCode: r.exitCode ?? EXIT_RED,
      judgedCount: 1,
    };
  }
  // instrument-stop — NOT a verdict. The fault is a typed field stamped where the
  // fault was observed, never sniffed out of the stop's prose. `detail` is the
  // stop's own sentence; `notes` is the whole rendered output around it, which is
  // where a measurement's already-computed arithmetic lives (`stopped`'s own
  // `notes` argument) — the difference between hunting a parser bug and reading
  // the scope.
  return {
    verdict: r.detail?.fault ?? STOP_FAULTS.FAILED,
    detail: redact(String(r.detail?.stop ?? `stage "${r.stage}" rendered no judgment`)),
    ...notes,
  };
}

/**
 * Run a DECLARED close (or a check's chain out of one) and return `runClose`'s
 * verdict shape, so every consumer downstream — the precheck, ralph's judge, the
 * `CLOSE_FAULTS` routing, the trend reader, Layer R — is unchanged.
 *
 * The extras a declared close can honestly add ride alongside rather than
 * replacing anything: `declared: true` marks the shape, `value`/`baseline` carry
 * the deciding stage's own measurement, and `trendValue` is the ONE number the
 * trend reader may compare (see the header for why a higher-is-better stage
 * donates none).
 *
 * @param {any[]} stages declared stage descriptors, already validated
 * @param {(s: string) => string} [redact] the scrub, applied at THIS boundary
 * @param {{timeoutMs?: number, cwd?: string, seedRef?: string,
 *   seedTrees?: any, gapCap?: number, maxBuffer?: number, baselineMode?: 'auto'|'worktree',
 *   humanRuling?: {decision: string, text?: string|null}|null,
 *   judgeLoop?: ((o: {system: string}) => any)|null,
 *   judgeModel?: string|null,
 *   onJudgeCost?: ((c: any) => void)|null,
 *   onRubricEvidence?: ((e: any) => void)|null,
 *   callBounds?: (() => {timeoutMs?: number, deadlineMs?: number})|null}} [opts]
 * @returns {Promise<any>}
 */
export async function runDeclaredStages(stages, redact = (s) => s, opts = {}) {
  const {
    timeoutMs, cwd, seedRef, seedTrees: shared, gapCap, maxBuffer, baselineMode, humanRuling = null,
    judgeLoop = null, judgeModel = null, onJudgeCost = null, callBounds = null, onRubricEvidence = null,
  } = opts;
  if (!isNonEmptyString(cwd) || !isNonEmptyString(seedRef)) {
    // Refuse rather than guess. A declared close measures against a SEED; a
    // missing one is the close unable to run, not a red about the worker.
    return {
      verdict: STOP_FAULTS.FAILED,
      detail: 'a declared close needs both the repository it judges (cwd) and the seed it measures against (seedRef) — '
        + 'neither has a default, because a defaulted baseline grades a tree nobody chose',
      stage: null,
      stages: [],
      declared: true,
    };
  }
  const owned = !shared;
  const seedTrees = shared ?? makeSeedTrees();
  const textClose = stages.some((st) => st?.kind === 'rubric-step');
  /** @type {any} */
  const ctx = {
    workdir: cwd,
    seedRef,
    gapKeep: DECLARED_GAP_PREFIX,
    ...(timeoutMs !== undefined ? { timeoutMsDefault: timeoutMs } : {}),
    ...(gapCap !== undefined ? { gapCap } : {}),
    ...(maxBuffer !== undefined ? { maxBuffer } : {}),
    ...(baselineMode !== undefined ? { baselineMode } : {}),
    // the SIGNER's answer, when this close has a human stage and a leg is
    // carrying one. Absent (null) is the ordinary path AND the pause path — the
    // human stage reads the absence as "nobody has answered yet", which is the
    // whole of what a pause means.
    humanRuling,
    // THE PAID SEAM, THE IDENTITY and THE METER, all operator territory and all
    // absent on every mechanical close. A judged stage with no seam STOPS as a
    // wiring gap rather than falling back to some other model (M1 owns no
    // provider), and `judgeModel` is the seam's OTHER half (PRD item 32.1) —
    // WHICH model the seam drives, resolved by the caller (`resolveJudge`,
    // src/judged.js) and passed through untouched here, exactly as `judgeLoop`
    // is. `runStage` checks the identity before the seam, so a judged stage with
    // neither wired reports the identity gap, and one with only the seam missing
    // still names the judge it would have graded with. Every locate call the
    // seam buys is reported OUT through the meter so the run's ONE ledger can
    // see it — a close has cost $0 until this kind, and a budget must fund the
    // attempt PLUS its close.
    judgeLoop,
    judgeModel,
    onJudgeCost,
    // F152/PRD 30.4 — the SAME per-call time bounds every worker round already
    // carries (`callBounds()`, src/planrun.js:1518), so the judged stage's own
    // locate call cannot hang the process on a live silent endpoint. `null` is
    // the honest absence (an adopter/test that wires no clock through), never a
    // defaulted number invented here.
    callBounds,
    // REPORT-ONLY seam: what a rubric-step stage's cited checks read (bareguard `full.evidence`); the runner records it, nothing here reads it
    onRubricEvidence,
    seedTrees,
  };
  try {
    /** @type {any[]} */
    const ran = [];
    /** @type {any} */
    /** @type {any} */
    let last = textClose ? { verdict: 'satisfied' } : { verdict: 'satisfied', judgedCount: 1 };
    for (const st of stages) {
      const r = await runStage(st, ctx);
      const t = translate(r, redact);
      // PART 1a: `judgedCount` marks a judgment rendered by the close's judging kinds. A rubric-files (TEXT) close renders only
      // mechanical verdicts and runs no judge, so none of its records may claim one
      if (textClose) delete t.judgedCount;
      ran.push({
        name: st?.name ?? null,
        verdict: t.verdict,
        ...(t.exitCode !== undefined ? { exitCode: t.exitCode } : {}),
        ...(r.value !== null && r.value !== undefined ? { value: r.value } : {}),
        ...(r.baseline !== null && r.baseline !== undefined ? { baseline: r.baseline } : {}),
        // PER STAGE, because the summary below carries only the LAST translation:
        // an earlier green's announcement would otherwise be lost behind the
        // stage that decided.
        ...(t.notes !== undefined ? { notes: t.notes } : {}),
      });
      last = t;
      if (t.verdict !== 'satisfied') {
        return {
          ...t,
          stage: st?.name ?? null,
          stages: ran,
          declared: true,
          value: r.value ?? null,
          baseline: r.baseline ?? null,
          trendValue: trendValueOf(st, r),
          // the same header the command path writes, from the SAME function —
          // `src/trend.js` parses it to bucket the grade per stage
          ...(t.gap ? { gap: stageGap(/** @type {string} */ (st?.name), t.gap) } : {}),
        };
      }
    }
    return { ...last, stages: ran, declared: true, stage: undefined };
  } finally {
    if (owned) await seedTrees.cleanup();
  }
}

/**
 * The ONE number the trend reader may compare, and the omissions are the point.
 * `trend.js` reads improvement as `value < best`, so:
 *  - `lower-is-better` counts donate their value (a fault count falling IS
 *    convergence);
 *  - `higher-is-better` floors donate NOTHING. A test-count floor dropping is
 *    the run getting WORSE, and donating it would read as convergence and
 *    recommend a top-up on a dying run — the one direction trend.js names as
 *    dangerous. F6's answer applies: unknown, never a number that means the
 *    opposite of what it says.
 *  - a JUDGED stage (no measurement) donates its distinct red COUNT, always 'down';
 *  - any other stage with no measurement at all donates nothing, for the same reason.
 * The stage POSITION still travels either way, so "the run got further than it
 * ever had" is readable on every declared close.
 * @param {any} stage @param {any} r the M1 StageResult
 * @returns {number|null}
 */
function trendValueOf(stage, r) {
  if (typeof r?.value !== 'number' || !Number.isFinite(r.value)) {
    // a JUDGED stage has no measurement: its number is how many DISTINCT reds it itemizes
    // (F192 e), lower-is-better, compared to its best-so-far like any deterministic count
    return Number.isInteger(r?.detail?.redCount) ? r.detail.redCount : null;
  }
  return stage?.params?.direction === 'lower-is-better' ? r.value : null;
}

/**
 * The trend reader's input for ONE close verdict, whichever executor produced
 * it. A command close hands over its gap and `readGrade` scrapes stage and count
 * out of the text; a declared close already KNOWS both, so it says them instead
 * of round-tripping them through prose it would then have to parse back.
 *
 * Byte-identical to the previous call for a command close: `{ gap }`, with
 * `stage`/`value` left UNDEFINED so `trend.record` falls through to `readGrade`
 * exactly as before. Passing `stage: null` instead would silently disable that
 * fallback — undefined and null are different answers here.
 * @param {any} v a `runClose`-shaped verdict
 * @returns {{gap?: string, stage?: string|null, value?: number|null}}
 */
export function closeGrade(v) {
  if (v?.declared !== true) return { gap: v?.gap };
  return { gap: v.gap, stage: v.stage ?? null, value: v.trendValue ?? null };
}
