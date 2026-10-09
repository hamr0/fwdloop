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

/** bareguard refuses a signed name or phrase past this many characters (rubric MAX_SIGNED_LEN). */
const MAX_ENTRY_CHARS = 1000;
const SIGN_AGAIN = 'and sign the job again';
const clipText = (t, n = 40) => (t.length > n ? `${t.slice(0, n)}...` : t);

/**
 * M4e amendment 23: the ONE function that turns "this step's check cannot be built" into a plain sentence. It reads the shape, never
 * bareguard's wording, so no `spec.` path or `checks[` index can reach a human. The steps are numbered by the job line they came from
 * ("line 3" elsewhere), so "step 3" is job line 3. What it throws away: the raw reason (kept apart as `detail`) and any second problem
 * in the same shape (the first one found is the one said). A shape it cannot classify gets the generic sentence.
 * @param {number|undefined} n the step's job line
 * @param {Record<string, any>} shape
 * @returns {string}
 */
export function unbuildableSay(n, shape) {
  const head = `This flow will not run: step ${n}'s`;
  const lists = [['sections', 'section name', 'section list'], ['mustCarry', 'required phrase', 'required-phrase list']];
  for (const [key, one, whole] of lists) {
    const list = shape[key];
    if (!Array.isArray(list)) continue;
    if (list.length === 0) return `${head} ${whole} is empty. Name at least one, or remove the list, ${SIGN_AGAIN}.`;
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      if (entry.trim() === '') return `${head} ${one} is blank. Fill it in or remove it, ${SIGN_AGAIN}.`;
      if (entry.length > MAX_ENTRY_CHARS) return `${head} ${one} "${clipText(entry)}" is ${entry.length} characters, and the most one may be is ${MAX_ENTRY_CHARS}. Shorten it ${SIGN_AGAIN}.`;
      if (key === 'sections' && entry.trim().endsWith(':')) return `${head} ${one} "${entry}" ends in ':'. Remove the ':' ${SIGN_AGAIN}.`;
    }
  }
  const noSections = !Array.isArray(shape.sections) || shape.sections.length === 0;
  if (shape.wordsPerSection !== undefined && noSections) return `${head} check sets a size for each section but names no sections. Name the sections or remove the size, ${SIGN_AGAIN}.`;
  if ((shape.linesPerInvoice === undefined) !== (shape.mustCarry === undefined)) {
    const have = shape.linesPerInvoice === undefined ? 'the words each invoice must carry' : 'the lines in each invoice';
    return `${head} invoice check has ${have} but not the other half. Add the missing half or remove this one, ${SIGN_AGAIN}.`;
  }
  return `This flow will not run: step ${n}'s check cannot be built. Draft the job again.`;
}

/**
 * M4e amendment 19 4: the first softgreen step whose check bareguard cannot build (a flow signed before amendment 18 may hold one), or null.
 * Built with the same `buildSoftgreenRubric` the close uses, so a step that passes here never crashes at its close for want of a check.
 * `why` is bareguard's raw reason, for the record only (amendment 23); `say` is the plain sentence.
 * @param {Record<string, any>} declaration `readFlow`'s declaration
 * @returns {{step: {emits: string, fromLine: number}, why: string, say: string}|null}
 */
export function findUnbuildableCheckStep(declaration) {
  for (const step of declaration.steps) {
    if (step.close?.class !== 'softgreen') continue;
    try {
      buildSoftgreenRubric(step.close.shape ?? {});
    } catch (err) {
      return { step, why: String(err.message).replace(/^invalid rubric: /, ''), say: unbuildableSay(step.fromLine, step.close.shape ?? {}) };
    }
  }
  return null;
}

/** The preflight refusal sentence for a check that cannot be built: plain words, never bareguard's (that is `found.why`). @param {{say: string}} found */
export function unbuildableRed(found) {
  return found.say;
}

/**
 * Can this flow run? `read` is `readFlow`'s result (a failed read — signature, tampering, missing files — is a refusal with its own reds).
 * @param {any} read
 * @returns {{ok: true} | {ok: false, red: string, detail?: string}} `detail` is the raw reason, for the record, never the sentence
 */
export function canFlowRun(read) {
  if (!read || read.ok !== true) return { ok: false, red: String(read?.reds?.[0] ?? 'the flow does not read') };
  const unwired = findUnwiredVerbStep(read.declaration);
  if (unwired) return { ok: false, red: unwiredRed(unwired) };
  const unbuildable = findUnbuildableCheckStep(read.declaration);
  if (unbuildable) return { ok: false, red: unbuildableRed(unbuildable), detail: unbuildable.why };
  return { ok: true };
}

/** The one sentence for a signed flow that will not run: the panel's run door (the POST /api/author/run 409) and Run again say the same words. The Signed list no longer shows a refused flow. @param {string} flow @param {string} red */
export function willNotRunSay(flow, red) {
  if (red.startsWith('This flow will not run:')) return red; // amendment 23: already a whole sentence
  return `"${flow}" will not run: ${red}`;
}
