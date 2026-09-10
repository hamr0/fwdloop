// The WALKABLE-CHAIN VALIDATOR — M0a's deterministic exit gate (PRD §6 M0a,
// verbatim): "a deterministic validator proves every artifact a step reads
// was declared by an earlier step and every primitive named exists in the
// catalogue and is unlocked by the skillset." $0, ZERO model calls, ever.
//
// borrowed-from (style only, never imported): close.mjs's gap-header
// convention (`<stage>: <what failed>`) and its FIRST-RED-WINS strategy —
// this validator returns on the first red it finds, in step order, exactly
// like closeCitations/closeCompose do over their own check lists.
//
// Declaration shape validated against (PRD §6 M0a "the signed artifact",
// the fields the drafter actually authors — arbiter fields like trigger/cap/
// askTtlMs/egress/provider are not this module's concern):
//   { skills: string[], guardrails: string,           // arbiter, verbatim
//     steps: [ { goal, primitives: string[], reads: string[], emits: string,
//                close: { class: 'green'|'softgreen'|'hitl', shape?, tracesTo? } } ] }
//
// Tolerant of nothing: an unrecognised shape is a red, never a pass — this
// module never throws on a bad declaration, it reds on it.

import { ArtifactSpace, unwalkableReads } from './artifacts.mjs';
import { primitiveFor } from './catalogue.mjs';

/**
 * Guardrails and steps are TWO MAPPING LISTS (RULED 2026-09-10). The guardrails
 * are a numbered list of the human's own bullets; a step's close points at one
 * BY ITS NUMBER. The number is the join key, not the text.
 *
 * This replaces text matching. Matching on text was fragile in both directions:
 * a substring match let a green close trace to a single letter (a fit-to-pass
 * surface), and a whole-line match broke the moment the drafter re-wrapped or
 * re-punctuated the human's words. A number cannot be partially right.
 *
 * It also makes the PRD's "a guardrail the drafter cannot map is surfaced in
 * the draft table" computable rather than aspirational — see unmappedGuardrails.
 */
function stripMarker(line) {
  return String(line ?? '').replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim();
}

/** The guardrails as `[{ n, text }]`, n 1-based in the order the human wrote them. */
export function guardrailList(guardrails) {
  return String(guardrails ?? '')
    .split(/\r?\n/)
    .map(stripMarker)
    .filter((l) => l.length > 0)
    .map((text, i) => ({ n: i + 1, text }));
}

/**
 * Resolve a step's `tracesTo` to a guardrail number, or null if it resolves to
 * nothing. A number is the contract. A string is accepted ONLY when it equals a
 * whole guardrail line — the human's own text, unaltered — and is resolved to
 * that line's number; it is a convenience for a hand-written declaration, never
 * a second matching rule.
 */
export function resolveTracesTo(tracesTo, guardrails) {
  const list = guardrailList(guardrails);
  if (typeof tracesTo === 'number' && Number.isInteger(tracesTo)) {
    return list.some((g) => g.n === tracesTo) ? tracesTo : null;
  }
  if (typeof tracesTo === 'string' && tracesTo.trim()) {
    const hit = list.find((g) => g.text === stripMarker(tracesTo));
    return hit ? hit.n : null;
  }
  return null;
}

/**
 * The guardrail numbers no step's close traced to. The PRD requires these be
 * SURFACED in the draft table, never silently dropped — a guardrail the human
 * wrote and the drafter could not map is the human's to place.
 */
export function unmappedGuardrails(declaration) {
  const list = guardrailList(declaration?.guardrails);
  const traced = new Set(
    (declaration?.steps ?? [])
      .map((st) => resolveTracesTo(st?.close?.tracesTo, declaration?.guardrails))
      .filter((n) => n !== null),
  );
  return list.filter((g) => !traced.has(g.n));
}

/**
 * EVERY STEP HAS A CLOSE, and a MISSING one IS hitl (RULED 2026-09-10) — not a
 * red. That is the same rule as "anything fitting no class falls to hitl",
 * applied to the case where the drafter said nothing at all: silence about how a
 * step is proven done means a person proves it.
 *
 * An INVENTED class is a different thing and stays a red. "yellow" is not
 * silence, it is a wrong answer, and normalising it to hitl would hide a drafter
 * that is making up machinery.
 */
export function normalizeClose(close) {
  if (close === null || close === undefined) return { class: 'hitl' };
  if (typeof close !== 'object') return close;
  if (close.class === null || close.class === undefined || close.class === '') {
    return { ...close, class: 'hitl' };
  }
  return close;
}

const VALID_CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

/**
 * Validate one declaration's walkable chain. Returns { verdict, red } —
 * 'green'/null on a clean pass, 'red'/<gap-style string> on the FIRST
 * failure found, walking steps in declared order (declaration order IS
 * step order, same invariant artifacts.mjs's ArtifactSpace relies on).
 */
export function validate(declaration) {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    return { verdict: 'red', red: 'validator: declaration must be an object' };
  }
  if (!Array.isArray(declaration.steps) || declaration.steps.length === 0) {
    return { verdict: 'red', red: 'validator: declaration must have a non-empty "steps" array' };
  }

  const skills = Array.isArray(declaration.skills) ? declaration.skills : [];
  const guardrails = typeof declaration.guardrails === 'string' ? declaration.guardrails : '';

  const space = new ArtifactSpace();

  for (let i = 0; i < declaration.steps.length; i += 1) {
    const step = declaration.steps[i];
    const label = `step ${i + 1}${step && typeof step.goal === 'string' && step.goal ? ` ("${step.goal}")` : ''}`;

    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return { verdict: 'red', red: `validator: ${label} is not an object` };
    }
    if (typeof step.emits !== 'string' || !step.emits) {
      return { verdict: 'red', red: `validator: ${label} has no valid "emits" artifact id` };
    }
    if (!Array.isArray(step.reads)) {
      return { verdict: 'red', red: `validator: ${label} "reads" must be an array of artifact ids` };
    }
    if (!Array.isArray(step.primitives)) {
      return { verdict: 'red', red: `validator: ${label} "primitives" must be an array of catalogue verbs` };
    }
    // A close that is ABSENT is hitl, handled by normalizeClose below. A close
    // that is present but not an object is a wrong answer, not silence.
    if (step.close !== null && step.close !== undefined
        && (typeof step.close !== 'object' || Array.isArray(step.close))) {
      return { verdict: 'red', red: `validator: ${label} "close" must be an object` };
    }

    // Declare this step's own artifact BEFORE checking its reads.
    // unwalkableReads treats an undeclared stepArtifactId as unwalkable for
    // every read (artifacts.mjs) — declaring first, in step order, is what
    // makes "declared before" mean anything.
    try {
      space.declare({ id: step.emits });
    } catch (err) {
      return { verdict: 'red', red: `validator: ${label} — ${err.message}` };
    }

    // Check 1 (negative scenario i) — every artifact this step reads was
    // declared by an EARLIER step. Delegates to artifacts.mjs; never reimplemented.
    const unwalkable = unwalkableReads(space, step.emits, step.reads);
    if (unwalkable.length > 0) {
      return {
        verdict: 'red',
        red: `validator: ${label} reads artifact "${unwalkable[0]}" that no earlier step declared`,
      };
    }

    // Checks 2+3 (negative scenarios iii, iv) — every primitive named exists
    // in the catalogue (never invented — rule (f) made mechanical) AND is
    // unlocked by the flow's signed skillset, even when it exists.
    for (const verb of step.primitives) {
      let entry;
      try {
        entry = primitiveFor(verb);
      } catch (err) {
        return { verdict: 'red', red: `validator: ${label} — ${err.message}` };
      }
      if (!skills.includes(entry.skill)) {
        return {
          verdict: 'red',
          red: `validator: ${label} primitive "${verb}" needs skill "${entry.skill}", which is not in the granted skillset (${skills.join(', ') || 'none'})`,
        };
      }
    }

    // Check 4 — EVERY step has a close, and a MISSING one IS hitl, not a red
    // (ruled 2026-09-10): silence about how a step is proven done means a
    // person proves it. An INVENTED class is not silence — it is a wrong
    // answer, and stays a red. Never green-by-default in either direction.
    const { class: cls, tracesTo } = normalizeClose(step.close);
    if (!VALID_CLASSES.includes(cls)) {
      return {
        verdict: 'red',
        red: `validator: ${label} close.class "${cls}" is not one of ${VALID_CLASSES.join(', ')}`,
      };
    }

    // Check 5 (negative scenario vi, "the uncovered-line plant") — a
    // green/softgreen close must trace to a guardrail phrase actually
    // present in the signed guardrails text. A close that doesn't is a red:
    // an uncovered line must land at hitl, never at a class the drafter
    // invented coverage for. hitl needs no guardrail — it IS the fallback.
    if (cls !== 'hitl') {
      if (resolveTracesTo(tracesTo, guardrails) === null) {
        return {
          verdict: 'red',
          red: `validator: ${label} close.class "${cls}" traces to "${tracesTo ?? '(absent)'}", which is not in the signed guardrails — an uncovered line must fall to hitl`,
        };
      }
    }
  }

  return { verdict: 'green', red: null };
}
