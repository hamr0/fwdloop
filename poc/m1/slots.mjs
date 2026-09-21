// M1 — the ASK SLOT mechanism. F10 (docs/logs/FINDINGS.md) measured the
// drafter giving job #1's line 2 ("if more than one customer matches, ask
// me, do not pick") a different number of human stops across runs — the
// same prose, sometimes an extra ask step, sometimes folded into another
// step. The leak (verified, not guessed): `checkpoint` sits in the
// drafter's own menu (poc/m0/catalogue.mjs:109, class "write", skill
// "core"), so nothing stops the drafter granting a pause on ANY step it
// drafts — see poc/m0/fixture-declaration-deepseek-1789376520136.json,
// where line 5 carries `["checkpoint"]`. Meanwhile poc/m0/runner.mjs
// inserts the ask MECHANICALLY at the signed "ask at line N" slot with NO
// grant check at all (runner.mjs:197 checkGrants's GRANT_REQUIREMENTS list
// never includes the ask stage; runner.mjs:603-630 checkpointAsk runs
// unconditionally). So the ask never needed the drafter's permission in the
// first place — a pause exists only where a human signed one.
//
// This module is the MECHANICAL shape check that proves that wiring holds
// on a given declaration: every signed ask line got exactly one hitl step
// and no step (signed or not) is smuggling a pause any other way. It is
// deliberately a SEPARATE check from validator.mjs's own send-lock logic
// (M0b) — that module proves the walkable chain; this one proves the ask
// slot grammar specifically, and is meant to run AFTER validator.validate()
// returns green (checking slot shape on a declaration that doesn't even
// walk is meaningless).
//
// The mechanical shape of a PAUSE (checkAskSlots' check (c), below) is a
// step that does nothing AND waits on a human: zero primitives AND
// close.class === "hitl" — never zero primitives alone. Fixed 2026-09-21
// after a live batch (poc/m1/out/slot-batch-slot-2026-09-21c/draft-
// {1,5,12}.json) reded 3/20 declarations on their DERIVE step (fromLine 3,
// close.class "green", primitives []), which is not a pause at all:
// poc/m0/catalogue.mjs's JOB1_NEEDS carries `{ need: 'match a customer,
// derive figures', own: true }` — fwdloop's own model round, by design no
// catalogue primitive, closed green by the MACHINE (validator.mjs), never a
// human. The original check (c) — "zero primitives alone" — was specified
// wrong; see poc/m1/slots.test.mjs's RED-FIRST test for the exact red it
// produced.
//
// borrowed-from (style only, never imported): validator.mjs's FIRST-RED-
// WINS strategy and its "never throw, always red" discipline for a
// malformed declaration.

import { parseArbiterGuardrails } from '../m0/validator.mjs';

/**
 * Every `ask at line <int>` line under the "Arbiter guardrails" heading, as
 * a SORTED, DEDUPED array of ints — unlike poc/m0/validator.mjs's
 * `parseArbiterSlots`, which keeps only the LAST `ask at` line it sees (one
 * ask slot per flow was M0b's whole world; M1 widens that to "however many
 * a human actually signs"). `parseArbiterSlots` itself is untouched — this
 * is a new, separate reader over the same arbiter-guardrail lines.
 *
 * A line that STARTS "ask at" but does not match the signed grammar
 * ("ask at line <int>") is never silently dropped: it is reported in
 * `errors`, naming the offending line, same discipline as
 * `parseArbiterSlots`'s own error path.
 *
 * Returns `{ lines, errors }`. `lines` is the ints found; `errors` is a
 * list of human-readable strings, each naming one malformed line.
 */
export function parseAskSlots(rawText) {
  const arbiterLines = parseArbiterGuardrails(rawText);
  const found = new Set();
  const errors = [];
  for (const line of arbiterLines) {
    const askMatch = /^ask at line (\d+)$/i.exec(line.trim());
    if (askMatch) {
      found.add(Number(askMatch[1]));
      continue;
    }
    if (/^ask at\b/i.test(line)) {
      errors.push(`arbiter guardrail "${line}" starts with "ask at" but does not match the signed `
        + 'grammar ("ask at line <int>") — never silently ignored');
    }
    // Any other arbiter line (a $ cap, "send at line N to <target>", etc.)
    // belongs to no ask slot and is left alone.
  }
  return { lines: [...found].sort((a, b) => a - b), errors };
}

/**
 * The mechanical shape check for the ask slot grammar over ONE declaration.
 * `askLines` is the SIGNED array of line numbers (from `parseAskSlots`,
 * never re-derived here from the declaration's own guardrails — the
 * declaration's `guardrails` text is the human's words, but which of its
 * lines are signed ask slots is a fact this function is TOLD, not one it
 * infers, so a caller can also check a declaration against slots signed
 * elsewhere).
 *
 * Never throws — a malformed declaration (non-array steps, a non-object
 * step) reds naming what's wrong, exactly like validator.mjs.
 *
 * First red wins, in this order:
 *   (a) for each signed line N: exactly one step with fromLine === N, and
 *       that step's close.class must be "hitl".
 *   (b) no step anywhere may grant "checkpoint" — that primitive belongs to
 *       the runner alone; a drafter that reaches for it is exactly F10's leak.
 *   (c) no step that is BOTH zero-primitive AND close.class "hitl" may sit
 *       at a line that is not a signed ask line. Zero primitives ALONE is
 *       not the mechanical shape of a pause: poc/m0/catalogue.mjs's
 *       JOB1_NEEDS carries `{ need: 'match a customer, derive figures',
 *       own: true }` — fwdloop's own model round, which by design takes no
 *       catalogue primitive and is closed "green" by the MACHINE, never a
 *       human (F-2026-09-21, 3/20 live drafts reded here on exactly that
 *       derive step before this fix). A pause is a step that does nothing
 *       AND waits on a human — zero primitives AND close.class "hitl" —
 *       and a pause anywhere but a signed slot is unsigned.
 */
export function checkAskSlots(declaration, askLines) {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    return { verdict: 'red', red: 'slot: declaration must be an object' };
  }
  if (!Array.isArray(declaration.steps)) {
    return { verdict: 'red', red: 'slot: declaration "steps" must be an array' };
  }
  const { steps } = declaration;
  for (let i = 0; i < steps.length; i += 1) {
    if (!steps[i] || typeof steps[i] !== 'object' || Array.isArray(steps[i])) {
      return { verdict: 'red', red: `slot: step ${i + 1} is not an object` };
    }
  }

  const lines = Array.isArray(askLines) ? askLines : [];

  // (a) — one hitl step per signed ask line, never 0, never 2+.
  for (const n of lines) {
    const matches = steps.filter((st) => st.fromLine === n);
    if (matches.length === 0) {
      return { verdict: 'red', red: `slot: ask at line ${n} has no step` };
    }
    if (matches.length >= 2) {
      return {
        verdict: 'red',
        red: `slot: ask at line ${n} has ${matches.length} steps bound to it — exactly 1 required`,
      };
    }
    const [step] = matches;
    const cls = step.close && typeof step.close === 'object' && !Array.isArray(step.close)
      ? step.close.class
      : undefined;
    if (cls !== 'hitl') {
      return {
        verdict: 'red',
        red: `slot: ask at line ${n} step's close.class is "${cls ?? '(none)'}" — must be "hitl"`,
      };
    }
  }

  // (b) — no step, anywhere, grants "checkpoint". The pause belongs to the
  // runner (poc/m0/runner.mjs's checkpointAsk, wired at the signed slot with
  // NO grant check) — never a primitive the drafter itself reaches for.
  for (let i = 0; i < steps.length; i += 1) {
    const primitives = Array.isArray(steps[i].primitives) ? steps[i].primitives : [];
    if (primitives.includes('checkpoint')) {
      return {
        verdict: 'red',
        red: `slot: step ${i + 1} (line ${steps[i].fromLine}) grants "checkpoint" — the pause belongs `
          + 'to the runner, never the drafter',
      };
    }
  }

  // (c) — a step that is BOTH zero-primitive AND close.class "hitl" is the
  // mechanical SHAPE of a pause (a step that does nothing and waits on a
  // human). One at a signed ask line is exactly what (a) already requires;
  // one anywhere else is an unsigned pause smuggled in without ever naming
  // "checkpoint". Zero primitives alone is NOT this shape — see this
  // function's header for JOB1_NEEDS' own, no-primitive derive step.
  const signedSet = new Set(lines);
  for (let i = 0; i < steps.length; i += 1) {
    const primitives = Array.isArray(steps[i].primitives) ? steps[i].primitives : [];
    const cls = steps[i].close && typeof steps[i].close === 'object' && !Array.isArray(steps[i].close)
      ? steps[i].close.class
      : undefined;
    if (primitives.length === 0 && cls === 'hitl' && !signedSet.has(steps[i].fromLine)) {
      return {
        verdict: 'red',
        red: `slot: step ${i + 1} (line ${steps[i].fromLine}) is a pause (no primitives, hitl) at an unsigned line`,
      };
    }
  }

  return { verdict: 'green' };
}
