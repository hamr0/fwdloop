// M10 am27 (2): code repairs of the two mechanical plan mistakes F169 found in 13 of 20 F168 drafts. Each repair is returned as a line of text and logged on the draft
// entry (`repaired`), so it is visible. Neither repair grants a primitive, changes a class, or writes a check.
// (1) a green step whose `close.cited.source` is a declared source role the step does not read: the role is added to its `reads`.
// (2) an `unjudgeable` entry for a line whose guardrailClasses says green: the entry is dropped and the line stays green.
// Throws away: the `unjudgeable` reason text of a dropped entry (kept only inside the `repaired` line).
/**
 * @param {any} declaration the drafter's declaration (not changed) @param {{sources?: {role?: string, kind?: string}[]}} arbiter
 * @returns {{declaration: any, repaired: string[]}}
 */
export function repairDeclaration(declaration, arbiter) {
  const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isRec(declaration)) return { declaration, repaired: [] };
  /** @type {string[]} */
  const repaired = [];
  const roles = new Set((arbiter?.sources ?? []).filter((s) => typeof s?.role === 'string').map((s) => /** @type {string} */ (s.role)));
  let out = declaration;
  if (Array.isArray(declaration.steps)) {
    out = {
      ...out,
      steps: declaration.steps.map((/** @type {any} */ st, /** @type {number} */ i) => {
        const src = isRec(st) && isRec(st.close) && st.close.class === 'green' && isRec(st.close.cited) ? st.close.cited.source : undefined;
        if (typeof src !== 'string' || !roles.has(src) || !Array.isArray(st.reads) || st.reads.includes(src)) return st;
        repaired.push(`steps[${i}].reads: added "${src}" (its cited check reads it)`);
        return { ...st, reads: [...st.reads, src] };
      }),
    };
  }
  if (isRec(declaration.unjudgeable) && isRec(declaration.guardrailClasses)) {
    const un = { ...declaration.unjudgeable };
    for (const key of Object.keys(un)) {
      if (declaration.guardrailClasses[key] !== 'green') continue;
      repaired.push(`unjudgeable: dropped the entry for line ${key} (its class is green; reason was: ${String(un[key]).slice(0, 160)})`);
      delete un[key];
    }
    out = { ...out, unjudgeable: un };
  }
  return { declaration: repaired.length ? out : declaration, repaired };
}
