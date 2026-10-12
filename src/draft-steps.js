// M4d amendment 15: the Chat card's list of what a draft really did, as PROGRESS only. ONE function builds it (here), from the draft's own log.json and
// its declaration; the page only renders it. It sits outside the readout (never signed, never hashed).
//
// One line per step: { id, label, status: 'done' | 'failed', details: [] } where the label is the step's name with its facts joined by " · ". No detail
// lines, folds, try lines or raw checker text. A draft that ends red has one plain reason on its plan-checks line and, when the plain words say what
// to do, one `checks-fix` line (`note: true`: no ✓/✗) under it. The try-by-try history is `triesOf` (the Audit Draft group reads the same function).
// Throws away: the log's per-round tokens, the model's replies, the questions, and every try but the count of refused ones.
// Third outcomes: no log -> null (nothing to list); a cost that is null reads "cost unknown", an incomplete sum reads "at least $X", never 0.

import { plainPlanCheck } from './plain-checks.js';

const REBUILD_RE = /^declaration: steps\[(\d+)\]\.close\.shape cannot be built into a check — (.*)$/s;

function money(log) {
  if (typeof log.costUsd !== 'number') return 'cost unknown';
  return `${log.spendComplete === false ? 'at least ' : ''}$${log.costUsd.toFixed(4)}`;
}

/**
 * The tries of a draft, one per round, oldest first. The free retry after a broken reply (a `structure-retry` round) keeps the number of the try it
 * retries: "try N again", never a new number. `reds` are the checker's raw refusals; `outcome` is a non-validator round's plain words, `rawOutcome` its own raw words.
 * @param {any[]} rounds the draft's log.json `log`
 * @returns {Array<{ label: string, passed: boolean, reds: string[], outcome: string, rawOutcome: string, again: boolean }>}
 */
export function triesOf(rounds) {
  let no = 0;
  return (Array.isArray(rounds) ? rounds : []).map((e, i, all) => {
    const again = e?.kind === 'structure-retry' && i > 0;
    if (!again) no += 1;
    const passed = e?.outcome === 'valid';
    const outcome = typeof e?.outcome === 'string' ? e.outcome.replace(/^structure: /, '') : '';
    const brokenThenRetried = !passed && String(e?.outcome).startsWith('structure: ') && all[i + 1]?.kind === 'structure-retry';
    return {
      label: again ? `try ${no} again` : `try ${no}`,
      passed,
      reds: Array.isArray(e?.reds) ? e.reds.map(String) : [],
      outcome: brokenThenRetried ? 'the reply came back broken; one free retry' : outcome,
      rawOutcome: outcome,
      again,
    };
  });
}

/**
 * @param {{ log: any, declaration: any }} p `log` = the draft's log.json (parsed), `declaration` = declaration.json or declaration.rejected.json (parsed)
 * @returns {Array<{ id: string, label: string, status: 'done'|'failed', details: string[], note?: boolean }> | null}
 */
export function draftStepList({ log, declaration }) {
  if (log === null || typeof log !== 'object') return null;
  const rounds = Array.isArray(log.log) ? log.log : [];
  /** @type {Array<{ id: string, label: string, status: 'done'|'failed', details: string[], note?: boolean }>} */
  const out = [];

  const t = log.thinking;
  if (t && (t.asked === 'on' || t.asked === 'off') && typeof t.status === 'string') {
    if (t.status === 'applied') out.push({ id: 'thinking', label: `thinking ${t.asked}`, status: 'done', details: [] });
    else if (typeof t.say === 'string' && t.say !== '') out.push({ id: 'thinking', label: t.say, status: 'failed', details: [] });
  }

  if (Array.isArray(log.inputs) && log.inputs.length > 0) {
    out.push({ id: 'inputs', label: ['inputs', ...log.inputs.map((i) => `${i.role}: ${i.detail}`)].join(' · '), status: 'done', details: [] });
  }

  // a plan came back (valid or refused by the checker) vs. a round that never gave one (provider red, cut off, budget)
  const gotPlan = rounds.some((e) => e.outcome === 'valid' || String(e.outcome).startsWith('validator'));
  const n = typeof log.rounds === 'number' ? log.rounds : 0;
  const who = typeof log.modelId === 'string' && log.modelId !== '' ? log.modelId : 'the drafter';
  const reds = Array.isArray(log.reds) ? log.reds.map(String) : [];
  const facts = ['drafted', who, `${n} round${n === 1 ? '' : 's'}`, money(log)];
  if (!gotPlan && reds.length > 0) facts.push(reds[0]); // no plan at all (provider red, cut off): its own words, there is no checker text
  out.push({ id: 'drafted', label: facts.join(' · '), status: /** @type {'done'|'failed'} */ (gotPlan ? 'done' : 'failed'), details: [] });

  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const rubricReds = [];
  const checkReds = [];
  for (const r of reds) {
    const m = REBUILD_RE.exec(r);
    if (m) rubricReds.push(`line ${steps[Number(m[1])]?.fromLine ?? '?'}: ${m[2]}`); else checkReds.push(r);
  }
  if (gotPlan) {
    if (log.ok === true) {
      // N = the number of the try that passed, minus one (a free retry after a broken reply keeps its try's number)
      const tries = triesOf(rounds);
      const fixedAfter = tries.length > 0 && tries[tries.length - 1].passed ? tries.filter((x) => !x.again).length - 1 : 0;
      out.push({ id: 'checks', label: fixedAfter > 0 ? `plan checks · fixed by the AI after ${fixedAfter} ${fixedAfter === 1 ? 'try' : 'tries'}` : 'plan checks', status: 'done', details: [] });
    } else {
      // one plain reason, and the fix words when the plain sentence has any: the first refusal that has a fix, else the first
      const plain = checkReds.map(plainPlanCheck);
      const pick = plain.find((p) => p.fix !== null) ?? plain[0];
      out.push({ id: 'checks', label: pick ? `plan checks · ${pick.reason}` : 'plan checks', status: 'failed', details: [] });
      if (pick?.fix) out.push({ id: 'checks-fix', label: `Fix: ${pick.fix}`, status: 'done', details: [], note: true });
    }
  }

  if (log.ok === true) {
    const soft = steps.filter((s) => s?.close?.class === 'softgreen');
    if (soft.length > 0) out.push({ id: 'rubrics', label: ['rubrics', ...soft.map((s) => `line ${s.fromLine}`)].join(' · '), status: 'done', details: [] });
  } else if (rubricReds.length > 0) {
    out.push({ id: 'rubrics', label: ['rubrics', ...rubricReds].join(' · '), status: 'failed', details: [] });
  }

  return out;
}
