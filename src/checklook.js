// borrowed-from: bareloop src/panel/jobplan.js@v0.61.0 (fc56e1f3) (kindOfCheck, splitNotChecked, NcRow)
// M19 S6 (docs/wiki/the-module-ladder.md, "M19" S6, section 3.7, amendment D): the words and the split every surface of the check-list look reads, written ONCE here.
// The card (src/cardlist.js), the Audit (src/auditchecks.js), the draft readout (src/authoring.js) and the page all take their kind word and their Not-checked split from these.
// What this throws away: a Not checked item's own quotes round a whole rule and the reason "you judge it at Accept" (the group title says it).

/** the group titles and the tail of the Not checked one (section 3.7, copied unchanged) */
export const LOOK = Object.freeze({
  checked: 'CHECKED', notChecked: 'NOT CHECKED', notCheckedTail: 'you judge these at Accept', suggested: 'SUGGESTED · add if you want it', everyLine: 'Every line',
});

/**
 * The kind word of a check row (hamr 2026-11-19, signed list look): `shape` = code checks the form of the items, `file` = code checks the files (a guard, a line's output-file floor), `truth` = every other check.
 * @param {{key?: string, shape?: true, fence?: true}} c @returns {'truth'|'shape'|'file'}
 */
export function kindOfCheck(c) {
  if (c.shape === true) return 'shape';
  if (c.fence === true || (typeof c.key === 'string' && c.key.startsWith('J.$guard.')) || (typeof c.key === 'string' && /^L\d+\.\$floor$/.test(c.key))) return 'file';
  return 'truth';
}

/**
 * A Not checked text `head — reason` split into the row and the reason behind "why"; the quotes round a rule go; "you judge it at Accept" is the group title's, not a reason.
 * @param {string} raw @returns {{text: string, why?: string}}
 */
export function splitNotChecked(raw) {
  const i = raw.indexOf(' — ');
  if (i < 0) return { text: raw };
  const text = raw.slice(0, i).replace(/^"([\s\S]*)"$/, '$1');
  const why = raw.slice(i + 3);
  return why === 'you judge it at Accept' ? { text } : { text, why };
}

/**
 * The Not checked rows of the look: each item split into row and reason, with its tag and the job line that owns it (0 = no one line: the item names no `line N:`).
 * fwd's own items name their line with the code-written prefix `line N: ` (src/blockassemble.js) and a `~` rule with `not checked · ` (the group title says it now).
 * @param {string[]} items @param {Record<string, string>} [by] @returns {{line: number, text: string, why?: string, by?: 'you'|'agent'|'default'}[]}
 */
export function ncRowsOf(items, by = {}) {
  return (Array.isArray(items) ? items : []).map((raw) => {
    const m = /^line (\d+): ([\s\S]*)$/.exec(raw);
    const body = (m ? m[2] : raw).replace(/^not checked · /, '');
    const tag = by[raw];
    return { line: m ? Number(m[1]) : 0, ...splitNotChecked(body), ...(tag === 'you' || tag === 'agent' || tag === 'default' ? { by: tag } : {}) };
  });
}
