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
 * The signed guardrails split into whole lines, each stripped of its bullet or
 * number marker. `tracesTo` must equal ONE OF THESE, never merely appear inside
 * the text: a substring match is a fit-to-pass surface — a drafter could trace a
 * green close to a single letter and pass. A close traces to a guardrail the
 * human wrote, whole, or it falls to hitl.
 */
function stripMarker(line) {
  return String(line ?? '').replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim();
}

function guardrailLines(guardrails) {
  return String(guardrails ?? '')
    .split(/\r?\n/)
    .map(stripMarker)
    .filter((l) => l.length > 0);
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
    if (!step.close || typeof step.close !== 'object' || Array.isArray(step.close)) {
      return { verdict: 'red', red: `validator: ${label} has no "close"` };
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

    // Check 4 — close.class must be exactly one of green/softgreen/hitl.
    // Absent or anything else is a red — never green-by-default.
    const { class: cls, tracesTo } = step.close;
    if (!VALID_CLASSES.includes(cls)) {
      return {
        verdict: 'red',
        red: `validator: ${label} close.class "${cls ?? '(absent)'}" is not one of ${VALID_CLASSES.join(', ')}`,
      };
    }

    // Check 5 (negative scenario vi, "the uncovered-line plant") — a
    // green/softgreen close must trace to a guardrail phrase actually
    // present in the signed guardrails text. A close that doesn't is a red:
    // an uncovered line must land at hitl, never at a class the drafter
    // invented coverage for. hitl needs no guardrail — it IS the fallback.
    if (cls !== 'hitl') {
      if (typeof tracesTo !== 'string' || !tracesTo || !guardrailLines(guardrails).includes(stripMarker(tracesTo))) {
        return {
          verdict: 'red',
          red: `validator: ${label} close.class "${cls}" traces to "${tracesTo ?? '(absent)'}", which is not in the signed guardrails — an uncovered line must fall to hitl`,
        };
      }
    }
  }

  return { verdict: 'green', red: null };
}
