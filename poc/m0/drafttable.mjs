// The DRAFT TABLE — M0a's negotiation surface (PRD §3 "The draft table is the
// negotiation surface", RULED 2026-09-10 "Both lists are numbered, and the
// link is shown from both ends"). PURE rendering, $0, ZERO model calls, ZERO
// IO — same declaration in, byte-identical string out.
//
// borrowed-from (rule only, never imported): validator.mjs is the ONE writer
// for guardrail numbering (guardrailList), tracesTo resolution
// (resolveTracesTo), unmapped detection (unmappedGuardrails) and close
// normalisation (normalizeClose). This module never reimplements any of
// those — it only renders what they compute.
//
// Two joined tables, per the ruling:
//   GUARDRAILS — numbered as the human wrote them, each showing which step
//     (by number) proves it. A guardrail no step traced to is a BLANK
//     "proves" cell — never inferred, never an error (often an arbiter
//     field, e.g. job #1's ask position/accept/cap).
//   STEPS — numbered, each showing goal, close class, the guardrail NUMBER
//     that proves it, its primitives, and what it reads/emits. A step with
//     no guardrail (close.class 'hitl', including a MISSING close —
//     normalizeClose turns that into 'hitl' for display) shows "hitl", never
//     a red and never green-by-default.
//
// 80-column terminal safety: every rendered line is truncated (ASCII "..."
// only — no unicode ellipsis, no colour) rather than wrapped, so nothing
// overflows and nothing is silently dropped from the underlying data (only
// the rendering is shortened).

import {
  guardrailList, resolveTracesTo, unmappedGuardrails, normalizeClose,
} from './validator.mjs';
import { validate } from './validator.mjs';

const WIDTH = 80;

/** Truncate to `max` columns, ASCII "..." only (never a unicode ellipsis —
 *  CLAUDE.md's "no colour libraries — plain text only" extends to no
 *  non-ASCII decoration either). Never wraps; a long goal loses its tail. */
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

/** Step numbers (1-based, declaration order) whose close traces to guardrail
 *  number `n`. Delegates entirely to validator.mjs's resolveTracesTo — this
 *  is the ONE extra bit of joining the table needs (guardrail -> steps,
 *  the reverse direction from what resolveTracesTo gives per-step). */
function stepsProving(declaration, guardrailN) {
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const hits = [];
  steps.forEach((step, i) => {
    const close = normalizeClose(step?.close);
    if (close.class === 'hitl') return; // hitl needs no guardrail, ever
    const n = resolveTracesTo(close.tracesTo, declaration?.guardrails);
    if (n === guardrailN) hits.push(i + 1);
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
  // columns: "#" (3) + "proves" (sized to fit, never truncated) + gap(1) + text (rest)
  const numW = 3;
  // The "proves" cell is the join — the one thing this table exists to show —
  // so it is sized to its widest value and NEVER truncated. Truncating
  // "steps 1,4" to "step 1,..." hides the second half of the mapping, which is
  // exactly the information the human is reading the table for. The guardrail
  // TEXT gives up the width instead: it is the human's own words, so they
  // already know it, and it is printed in full a few lines above.
  const provesCells = new Map(
    list.map((g) => [g.n, unmapped.has(g.n) ? "" : formatProves(stepsProving(declaration, g.n))]),
  );
  const provesW = Math.max(
    'proves'.length,
    ...[...provesCells.values()].map((c) => c.length),
  );
  const textW = WIDTH - numW - 1 - provesW - 1;
  lines.push(`${padRight('#', numW)} ${padRight('proves', provesW)} text`);
  for (const g of list) {
    const provesText = provesCells.get(g.n) ?? '';
    lines.push(`${padRight(`${g.n}.`, numW)} ${padRight(provesText, provesW)} ${truncate(g.text, textW)}`);
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
    const close = normalizeClose(step?.close);
    const guardrailN = close.class === 'hitl' ? null : resolveTracesTo(close.tracesTo, declaration?.guardrails);
    const closeCell = close.class === 'hitl'
      ? 'hitl'
      : `${close.class}  (guardrail ${guardrailN !== null ? guardrailN : '?'})`;
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
    return ['', `VALIDATION: green`];
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
