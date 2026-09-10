// The DRAFT TABLE — M0a's negotiation surface (PRD §3 "The draft table is the
// negotiation surface", RULED 2026-09-10 "Both lists are numbered, and the
// link is shown from both ends"). PURE rendering, $0, ZERO model calls, ZERO
// IO — same declaration in, byte-identical string out.
//
// borrowed-from (rule only, never imported): validator.mjs is the ONE writer
// for line/guardrail parsing (parseLines), guardrail numbering
// (guardrailList), close derivation (deriveFromLine/effectiveClass), the
// per-guardrail class the drafter proposed (effectiveGuardrailClass) and
// unmapped detection (unmappedGuardrails). This module never reimplements
// any of those — it only renders what they compute.
//
// Two joined tables, per the ruling — now joined by `fromLine` (the STRICT
// 1-FOR-1 line<->guardrail model, RULED 2026-09-10, replacing "trace to any
// guardrail by number"; see validator.mjs's header for why):
//   GUARDRAILS — numbered by the human's own line numbers, each showing the
//     PROPOSED class (what the drafter read that guardrail's own wording
//     as, RULED 2026-09-10 — this is now the thing the human reviews before
//     signing, not a hardcoded pattern match) and which step (by number)
//     proves it. A guardrail no step traced to is a BLANK "proves" cell —
//     never inferred, never an error (often an arbiter field; the flow's
//     own $ cap and similar never even appear here — see
//     parseArbiterGuardrails).
//   STEPS — numbered, each showing goal, DERIVED close class, the line
//     number it serves (`fromLine`), its primitives, and what it reads/
//     emits. A step with no fromLine, or one naming a blank-guardrail line,
//     shows "hitl", never a red and never green-by-default.
//
// 80-column terminal safety: every rendered line is truncated (ASCII "..."
// only — no unicode ellipsis, no colour) rather than wrapped, so nothing
// overflows and nothing is silently dropped from the underlying data (only
// the rendering is shortened).

import {
  guardrailList, unmappedGuardrails, effectiveClass, effectiveGuardrailClass, validate,
} from './validator.mjs';

const WIDTH = 80;

/**
 * The steps a guardrail proves, as one cell: "step 4" or "steps 1,4". Plural
 * because a guardrail proving several steps is the normal case — job #1's
 * citation guardrail proves every derive step there is.
 */
export function formatProves(steps) {
  if (!steps || steps.length === 0) return '';
  return `${steps.length === 1 ? 'step' : 'steps'} ${steps.join(',')}`;
}

export function truncate(value, max) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return `${s.slice(0, max - 3)}...`;
}

function padRight(value, width) {
  const s = String(value ?? '');
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

function rule(char = '-') {
  return char.repeat(WIDTH);
}

/** Step numbers (1-based, declaration order) whose `fromLine` names
 *  guardrail (line) number `n` AND whose derived class isn't hitl — hitl
 *  needs no guardrail, ever, so it never counts as "proving" one. Delegates
 *  entirely to validator.mjs's effectiveClass — this is the ONE extra bit of
 *  joining the table needs (guardrail -> steps, the reverse direction from
 *  what `fromLine` gives per-step). */
function stepsProving(declaration, guardrailN) {
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const hits = [];
  steps.forEach((step, i) => {
    if (step?.fromLine !== guardrailN) return;
    if (effectiveClass(step, declaration) === 'hitl') return;
    hits.push(i + 1);
  });
  return hits;
}

function renderGuardrails(declaration) {
  const list = guardrailList(declaration?.guardrails);
  const unmapped = new Set(unmappedGuardrails(declaration).map((g) => g.n));
  const lines = ['GUARDRAILS', rule()];
  if (list.length === 0) {
    lines.push('(none)');
    return lines;
  }
  // columns: "#" (3) + "class" (sized to fit) + "proves" (sized to fit,
  // never truncated) + gap(1) + text (rest)
  const numW = 3;
  // The per-guardrail PROPOSED class (RULED 2026-09-10 — this is now what
  // the human reviews before signing, replacing a hardcoded text pattern
  // that only ever matched job #1's own wording). Never truncated: it is a
  // short, fixed vocabulary (green/softgreen/hitl/red) and hiding half of
  // it ("softgr...") is worse than giving up a column's width for it.
  const classCells = new Map(list.map((g) => [g.n, effectiveGuardrailClass(g.n, declaration)]));
  const classW = Math.max('class'.length, ...[...classCells.values()].map((c) => c.length));
  // The "proves" cell is the join — the one thing this table exists to show —
  // so it is sized to its widest value and NEVER truncated. Truncating
  // "steps 1,4" to "step 1,..." hides the second half of the mapping, which is
  // exactly the information the human is reading the table for. The guardrail
  // TEXT gives up the width instead: it is the human's own words, so they
  // already know it, and it is printed in full a few lines above.
  const provesCells = new Map(
    list.map((g) => [g.n, unmapped.has(g.n) ? '' : formatProves(stepsProving(declaration, g.n))]),
  );
  const provesW = Math.max(
    'proves'.length,
    ...[...provesCells.values()].map((c) => c.length),
  );
  const textW = WIDTH - numW - 1 - classW - 1 - provesW - 1;
  lines.push(`${padRight('#', numW)} ${padRight('class', classW)} ${padRight('proves', provesW)} text`);
  for (const g of list) {
    const classText = classCells.get(g.n) ?? '';
    const provesText = provesCells.get(g.n) ?? '';
    lines.push(
      `${padRight(`${g.n}.`, numW)} ${padRight(classText, classW)} ${padRight(provesText, provesW)} ${truncate(g.text, textW)}`,
    );
  }
  return lines;
}

function renderSteps(declaration) {
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const lines = ['STEPS', rule()];
  if (steps.length === 0) {
    lines.push('(none)');
    return lines;
  }
  steps.forEach((step, i) => {
    const n = i + 1;
    const cls = effectiveClass(step, declaration);
    const closeCell = cls === 'hitl'
      ? 'hitl'
      : `${cls}  (guardrail ${step?.fromLine})`;
    const goal = truncate(step?.goal ?? '(no goal)', WIDTH - 4);
    const primitives = Array.isArray(step?.primitives) && step.primitives.length > 0
      ? step.primitives.join(', ')
      : '(none)';
    const reads = Array.isArray(step?.reads) && step.reads.length > 0 ? step.reads.join(', ') : '(none)';
    const emits = typeof step?.emits === 'string' && step.emits ? step.emits : '(none)';

    lines.push(`${n}. ${goal}`);
    lines.push(truncate(`   close:      ${closeCell}`, WIDTH));
    lines.push(truncate(`   primitives: ${primitives}`, WIDTH));
    lines.push(truncate(`   reads:      ${reads}  ->  emits: ${emits}`, WIDTH));
    if (n < steps.length) lines.push('');
  });
  return lines;
}

function renderRefused(declaration) {
  const refused = Array.isArray(declaration?.refused) ? declaration.refused : [];
  if (refused.length === 0) return [];
  const lines = ['', 'REFUSED', rule()];
  refused.forEach((r, i) => {
    lines.push(truncate(`${i + 1}. ${r?.hamrLine ?? '(no line)'}`, WIDTH));
    lines.push(truncate(`   reason: ${r?.reason ?? '(no reason given)'}`, WIDTH));
  });
  return lines;
}

function renderValidation(declaration) {
  const result = validate(declaration);
  if (result.verdict === 'green') {
    return ['', 'VALIDATION: green'];
  }
  return ['', 'VALIDATION: red', truncate(result.red ?? '(no detail)', WIDTH)];
}

/**
 * Render a declaration as the draft table — the negotiation surface a human
 * reads in one pass. Pure: no model call, no IO, no network. Deterministic:
 * the same declaration renders to a byte-identical string every time.
 */
export function renderDraftTable(declaration) {
  const sections = [
    ...renderGuardrails(declaration),
    '',
    ...renderSteps(declaration),
    ...renderRefused(declaration),
    ...renderValidation(declaration),
  ];
  return sections.join('\n');
}
