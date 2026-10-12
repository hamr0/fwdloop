// M4d amendment 10: the Chat card's list of what a draft really did. ONE function builds it (here), from the draft's own log.json and its
// declaration; the page only renders it. It sits outside the readout (never signed, never hashed).
//
// Each entry: { id, label, status: 'done' | 'failed', details: string[], reds?: string[], grey?: true, note?: true } (grey = an earlier try, drawn grey; note = a line with no ✓/✗). `reds` (plan checks and try lines) are the checker's raw
// refusals: the page turns each into its plain sentence (one function there). A step that didn't happen is not in the list.
// Throws away: the log's per-round tokens, the model's replies and the questions; only the facts named in the amendment are kept.
// Third outcomes: no log -> null (nothing to list); a cost that is null reads "cost unknown", an incomplete sum reads "at least $X", never 0.

const REBUILD_RE = /^declaration: steps\[(\d+)\]\.close\.shape cannot be built into a check — (.*)$/s;

function money(log) {
  if (typeof log.costUsd !== 'number') return 'cost unknown';
  return `${log.spendComplete === false ? 'at least ' : ''}$${log.costUsd.toFixed(4)}`;
}

/** Why a round did not give a plan: its validator reds (raw, as `reds`: the page's one translator makes them plain), else its outcome as a detail line. */
function reasonOf(entry) {
  if (Array.isArray(entry?.reds) && entry.reds.length > 0) return { details: [], reds: entry.reds.map(String) };
  const o = typeof entry?.outcome === 'string' ? entry.outcome : '';
  return { details: o === '' ? [] : [o.replace(/^structure: /, '')] };
}

/**
 * @param {{ log: any, declaration: any }} p `log` = the draft's log.json (parsed), `declaration` = declaration.json or declaration.rejected.json (parsed)
 * @returns {Array<{ id: string, label: string, status: 'done'|'failed', details: string[], reds?: string[], grey?: boolean, note?: boolean }> | null}
 */
export function draftStepList({ log, declaration }) {
  if (log === null || typeof log !== 'object') return null;
  const rounds = Array.isArray(log.log) ? log.log : [];
  /** @type {Array<{ id: string, label: string, status: 'done'|'failed', details: string[], reds?: string[], grey?: boolean, note?: boolean }>} */
  const out = [];

  const t = log.thinking;
  if (t && (t.asked === 'on' || t.asked === 'off') && typeof t.status === 'string') {
    if (t.status === 'applied') out.push({ id: 'thinking', label: `thinking ${t.asked}`, status: 'done', details: [] });
    else if (typeof t.say === 'string' && t.say !== '') out.push({ id: 'thinking', label: t.say, status: 'failed', details: [] });
  }

  if (Array.isArray(log.inputs) && log.inputs.length > 0) {
    out.push({ id: 'inputs', label: 'inputs', status: 'done', details: log.inputs.map((i) => `${i.role}: ${i.detail}`) });
  }

  // a plan came back (valid or refused by the checker) vs. a round that never gave one (provider red, cut off, budget)
  const gotPlan = rounds.some((e) => e.outcome === 'valid' || String(e.outcome).startsWith('validator'));
  const n = typeof log.rounds === 'number' ? log.rounds : 0;
  const who = typeof log.modelId === 'string' && log.modelId !== '' ? log.modelId : 'the drafter';
  const drafted = { id: 'drafted', label: `drafted with ${who}`, status: /** @type {'done'|'failed'} */ (gotPlan ? 'done' : 'failed'), details: [`${n} round${n === 1 ? '' : 's'} · ${money(log)}`] };
  if (!gotPlan) drafted.details.push(...(Array.isArray(log.reds) ? log.reds.map(String) : []));
  out.push(drafted);

  const reds = Array.isArray(log.reds) ? log.reds.map(String) : [];
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const rubricReds = [];
  const checkReds = [];
  for (const r of reds) {
    const m = REBUILD_RE.exec(r);
    if (m) rubricReds.push(`line ${steps[Number(m[1])]?.fromLine ?? '?'}: ${m[2]}`); else checkReds.push(r);
  }
  if (gotPlan) {
    out.push(log.ok === true
      ? { id: 'checks', label: 'plan checks', status: 'done', details: [] }
      : { id: 'checks', label: 'plan checks', status: 'failed', details: [], reds: checkReds });
  }

  if (log.ok === true) {
    const soft = steps.filter((s) => s?.close?.class === 'softgreen');
    if (soft.length > 0) out.push({ id: 'rubrics', label: 'rubrics', status: 'done', details: soft.map((s) => `line ${s.fromLine}: built`) });
  } else if (rubricReds.length > 0) {
    out.push({ id: 'rubrics', label: 'rubrics', status: 'failed', details: rubricReds });
  }

  // M4d am12: every try is its own line with its OWN result and reason, from try 1; shown only when a retry happened. The free retry
  // after a broken reply (a `structure-retry` round) keeps the number of the broken try: "try N again", never a new number.
  if (rounds.length > 1) {
    const lastPassed = rounds[rounds.length - 1].outcome === 'valid';
    let no = 0;
    const tries = rounds.map((e, i) => {
      const again = e.kind === 'structure-retry' && i > 0;
      if (!again) no += 1;
      const passed = e.outcome === 'valid';
      const last = i === rounds.length - 1;
      const brokenThenRetried = !passed && typeof e.outcome === 'string' && e.outcome.startsWith('structure: ') && rounds[i + 1]?.kind === 'structure-retry';
      const why = brokenThenRetried ? { details: ['the reply came back broken; one free retry'] } : passed ? { details: [] } : reasonOf(e);
      return { id: `try-${i + 1}`, label: again ? `try ${no} again` : `try ${no}`, status: /** @type {'done'|'failed'} */ (passed ? 'done' : 'failed'), grey: !(last && !passed), ...why };
    });
    if (lastPassed) out.push({ id: 'tries-note', label: 'Earlier tries were refused by the checks and fixed by the AI. Nothing for you to do.', status: 'done', details: [], note: true });
    out.push(...tries);
  }
  return out;
}
