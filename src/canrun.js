// M4e amendment 7 item 7: the ONE function that decides "can this flow run" — the panel's Signed flow list reads it, and the run's own
// preflight refusal says the same words. A flow the run would refuse at preflight (a signature that does not check out; a step granting a
// verb with no wired implementation) is not offered. Reads only; writes nothing. `WIRED_VERBS` stays the one list (src/primitives.js).
import { WIRED_VERBS } from './primitives.js';
import { buildSoftgreenRubric } from './closers.js';

/**
 * The first step granting a verb that has no wired implementation, or null. (A verb absent from the catalogue entirely is caught earlier,
 * at declaration validation inside `readFlow`.)
 * @param {Record<string, any>} declaration `readFlow`'s declaration
 * @returns {{step: {emits: string, fromLine: number}, verb: string}|null}
 */
export function findUnwiredVerbStep(declaration) {
  for (const step of declaration.steps) {
    for (const verb of step.primitives ?? []) {
      if (!WIRED_VERBS.has(verb)) return { step, verb };
    }
  }
  return null;
}

/** The preflight refusal sentence for an unwired verb, in the words the run's own preflight uses. @param {{step: {emits: string, fromLine: number}, verb: string}} found */
export function unwiredRed(found) {
  return `preflight: step "${found.step.emits}" (line ${found.step.fromLine}) grants verb "${found.verb}", which has no wired implementation`;
}

/**
 * M4e amendment 19 4: the first softgreen step whose check bareguard cannot build (a flow signed before amendment 18 may hold one), or null.
 * Built with the same `buildSoftgreenRubric` the close uses, so a step that passes here never crashes at its close for want of a check.
 * @param {Record<string, any>} declaration `readFlow`'s declaration
 * @returns {{step: {emits: string, fromLine: number}, why: string}|null}
 */
export function findUnbuildableCheckStep(declaration) {
  for (const step of declaration.steps) {
    if (step.close?.class !== 'softgreen') continue;
    try {
      buildSoftgreenRubric(step.close.shape ?? {});
    } catch (err) {
      return { step, why: String(err.message).replace(/^invalid rubric: /, '') };
    }
  }
  return null;
}

/** The preflight refusal sentence for a check that cannot be built. @param {{step: {emits: string, fromLine: number}, why: string}} found */
export function unbuildableRed(found) {
  return `preflight: step "${found.step.emits}" (line ${found.step.fromLine}) has a check that cannot be built — ${found.why}`;
}

/**
 * Can this flow run? `read` is `readFlow`'s result (a failed read — signature, tampering, missing files — is a refusal with its own reds).
 * @param {any} read
 * @returns {{ok: true} | {ok: false, red: string}}
 */
export function canFlowRun(read) {
  if (!read || read.ok !== true) return { ok: false, red: String(read?.reds?.[0] ?? 'the flow does not read') };
  const unwired = findUnwiredVerbStep(read.declaration);
  if (unwired) return { ok: false, red: unwiredRed(unwired) };
  const unbuildable = findUnbuildableCheckStep(read.declaration);
  if (unbuildable) return { ok: false, red: unbuildableRed(unbuildable) };
  return { ok: true };
}
