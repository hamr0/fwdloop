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
//     guardrailClasses: { "<lineNumber>": 'green'|'softgreen'|'hitl' },
//     steps: [ { goal, primitives: string[], reads: string[], emits: string,
//                fromLine: number|null,
//                close: { class: 'green'|'softgreen'|'hitl', shape? } } ] }
//
// Tolerant of nothing: an unrecognised shape is a red, never a pass — this
// module never throws on a bad declaration, it reds on it.

import { ArtifactSpace, unwalkableReads } from './artifacts.mjs';
import { primitiveFor } from './catalogue.mjs';
//
// --- THE 1-FOR-1 LINE<->GUARDRAIL MODEL (RULED 2026-09-10, replaces the ---
// --- "trace to any guardrail by number" model, F16) -----------------------
//
// F16 measured a live drafter STRETCHING a broad guardrail — 3 runs of 3 —
// to justify a `green` close on a step that emitted no figures at all. It
// could do that because it was allowed to CHOOSE which guardrail a close
// pointed at, out of the whole numbered list. A half-built `#`-prefixed
// "generic rule" was tried to patch this and correctly ruled out: a rule
// stops being generic the moment it does not apply to every step, and the
// citation rule does not apply to the read/ask/send steps. Mostly-true is
// the loophole. The fix removes the CHOICE, not just the wording:
//
//   - The human's job description is a NUMBERED LIST of lines (`prose.txt`/
//     `steps.txt`). Beside each line the human may write ONE guardrail, or
//     leave it BLANK. Guardrail N belongs to line N and to nothing else —
//     there is no separate, independent guardrail numbering any more.
//   - A step declares `fromLine: N` — which of the human's lines it serves.
//     It does NOT choose a guardrail and does NOT pick a class from a menu.
//   - A step's close class is DERIVED from what the DRAFTER proposed for
//     line N's guardrail (`guardrailClasses[N]`, see below), never
//     authored by the step itself. A BLANK guardrail on line N means every
//     step with `fromLine: N` is `hitl` regardless of any proposal — the
//     same "silence is safe" rule as before, restated for lines instead of
//     a missing close. A step with NO `fromLine` at all is `hitl` too.
//   - Because a step can only ever derive from the ONE line it names, it
//     structurally cannot borrow a stronger guardrail from a different
//     line to justify a class its own line's guardrail does not produce —
//     the F16 stretch has nowhere to land.
//
// --- WHERE THE CLASS ITSELF COMES FROM (RULED 2026-09-10, fixes the ---
// --- regex-fitted `deriveClass` this module used to carry) ---------------
//
// A guardrail's class is no longer read off a regex written against job
// #1's exact wording (that regex passed only because the fixture used the
// strings it was written against — the moment a human phrased the same
// citation rule differently, "each figure must show its source cell", it
// silently fell through to hitl with nothing telling anyone the mapping had
// failed). That is fitting the fixture, forbidden by AGENT_RULES, and it
// contradicts the PRD's own "How a class is set": the drafter reads a
// guardrail and PROPOSES a class for it, the human confirms it at sign time.
//
// So the proposal is carried on the declaration itself, per guardrail (not
// per step, and not per goal-text): `guardrailClasses: { "2": "hitl", "3":
// "green", ... }`, keyed by the LINE NUMBER the guardrail belongs to — the
// same join key `fromLine` already uses everywhere else, so there is no
// second numbering scheme to keep in sync and no free-text matching (text
// matching is dead, PRD: "a whole-line match broke the moment the drafter
// re-punctuated the human's words"). The drafter (drafter.mjs) is the ONE
// place that produces this map, by reading each guardrail once, on its own
// merits — see drafter.mjs's `assembleDeclaration`. This module only
// RESOLVES a step's class from whatever proposal already sits on the
// declaration; it does not itself interpret guardrail text.
//
// Rules that must hold no matter where the proposal came from:
//   - A blank guardrail is ALWAYS hitl, even if some proposal happens to
//     exist under that line number (it can't, in practice — nothing ever
//     writes one for a blank line — but the check is unconditional so a
//     stray, unexplained entry can never smuggle a class onto silence).
//   - A guardrail with NO proposed class at all is hitl. Silence is safe.
//   - A guardrail with a proposed class that is NOT one of the three valid
//     classes is a RED, never normalised to hitl — an invented class is a
//     wrong answer, not silence, exactly like an invented `close.class`
//     already was.

/** One human-authored job line: `{ n, text, guardrail }`. `guardrail` is
 *  `''` when the human left it blank. `n` is the number the human wrote,
 *  used verbatim as the join key everywhere below — there is no
 *  resequencing, no independent guardrail numbering.
 *
 * Format (both prose.txt and steps.txt, one parser for both):
 *   "N. <line text>" starts a new line; an immediately-following
 *   "guardrail: <text>" (any leading whitespace, case-insensitive) attaches
 *   to that line. A line with no such follower has guardrail ''.
 *
 * An "Arbiter guardrails" heading (any case, e.g. "Arbiter guardrails
 * (belong to no line): ...") ends line-attachment for good: every
 * "guardrail:" line after it belongs to NO numbered line and is never
 * returned here — see `parseArbiterGuardrails` for those. This is the fix
 * for a cap (or a trigger, an ask TTL, an egress allow-list) landing on
 * whatever line happens to come last just because no job line was actually
 * about it.
 */
export function parseLines(rawText) {
  const lines = String(rawText ?? '').split(/\r?\n/);
  const out = [];
  let current = null;
  for (const raw of lines) {
    if (/^\s*arbiter guardrails\b/i.test(raw)) {
      current = null; // nothing after this heading may attach to a line
      continue;
    }
    const numbered = /^\s*(\d+)\.\s*(.*)$/.exec(raw);
    if (numbered) {
      current = { n: Number(numbered[1]), text: numbered[2].trim(), guardrail: '' };
      out.push(current);
      continue;
    }
    const guardrailLine = /^\s*guardrail:\s*(.*)$/i.exec(raw);
    if (guardrailLine && current && !current.guardrail) {
      current.guardrail = guardrailLine[1].trim();
    }
  }
  return out;
}

/**
 * The flow-level ARBITER guardrails — hamr's own words, but belonging to no
 * numbered line (today: the $ cap; the same slot holds the trigger, the ask
 * TTL and the egress allow-list once those are fixtured). These sit under an
 * "Arbiter guardrails" heading in the raw text and are never returned by
 * `parseLines`/`guardrailList`, so a `fromLine` can never resolve to one —
 * there is no line number for it to name. Returned as plain strings; this
 * module does no further interpretation of them (that is the arbiter's job,
 * not the validator's).
 */
export function parseArbiterGuardrails(rawText) {
  const lines = String(rawText ?? '').split(/\r?\n/);
  const out = [];
  let inArbiter = false;
  for (const raw of lines) {
    if (/^\s*arbiter guardrails\b/i.test(raw)) {
      inArbiter = true;
      continue;
    }
    if (!inArbiter) continue;
    const guardrailLine = /^\s*(?:-\s*)?guardrail:\s*(.*)$/i.exec(raw);
    if (guardrailLine) out.push(guardrailLine[1].trim());
  }
  return out;
}

/**
 * The guardrails as `[{ n, text }]`, n = THE LINE NUMBER it belongs to
 * (never resequenced — a blank line 1 means the list can start at 2). Only
 * lines with a non-blank guardrail appear here. This is the "GUARDRAILS"
 * side of the two mapping lists the draft table renders (PRD §3, "Both
 * lists are numbered, and the link is shown from both ends").
 */
export function guardrailList(rawText) {
  return parseLines(rawText)
    .filter((l) => l.guardrail.length > 0)
    .map((l) => ({ n: l.n, text: l.guardrail }));
}

const VALID_CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

/**
 * Resolve ONE line's class from the declaration's `guardrailClasses`
 * proposal map (keyed by line number, as a string). Never interprets
 * guardrail TEXT itself — that is the drafter's job, done once, per
 * guardrail, before this ever runs. Returns `{ ok: true, class }` or
 * `{ ok: false, error }`.
 *
 *   - blank guardrail -> hitl, unconditionally (silence is safe, and a
 *     blank line can never be strengthened by a stray proposal).
 *   - non-blank guardrail, no proposal for this line at all -> hitl
 *     (silence is safe here too — the drafter said nothing).
 *   - non-blank guardrail, proposal is one of the three valid classes ->
 *     that class.
 *   - non-blank guardrail, proposal is anything else -> a red: an invented
 *     class, never normalised to hitl.
 */
export function resolveGuardrailClass(line, guardrailClasses) {
  if (!line || !line.guardrail) {
    return { ok: true, class: 'hitl' };
  }
  const map = guardrailClasses && typeof guardrailClasses === 'object' && !Array.isArray(guardrailClasses)
    ? guardrailClasses
    : {};
  const key = String(line.n);
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    return { ok: true, class: 'hitl' };
  }
  const proposed = map[key];
  if (VALID_CLASSES.includes(proposed)) {
    return { ok: true, class: proposed };
  }
  return {
    ok: false,
    error: `guardrail ${line.n} was proposed class "${proposed}", which is not one of ${VALID_CLASSES.join(', ')} `
      + '(an invented proposal, never normalised to hitl)',
  };
}

/**
 * Resolve the class a step's OWN `fromLine` derives to, independent of
 * whatever the step itself claims. Returns `{ ok: true, class, line }` or
 * `{ ok: false, error }` when `fromLine` is malformed, names a line that
 * does not exist, or names a line whose proposed class is invalid (a red,
 * distinct from "no fromLine at all" / "no proposal at all", which are
 * silence and therefore hitl).
 */
export function deriveFromLine(fromLine, lines, guardrailClasses) {
  if (fromLine === null || fromLine === undefined) {
    return { ok: true, class: 'hitl', line: null };
  }
  if (!Number.isInteger(fromLine)) {
    return { ok: false, error: `fromLine "${fromLine}" must be an integer` };
  }
  const line = lines.find((l) => l.n === fromLine);
  if (!line) {
    return { ok: false, error: `fromLine ${fromLine} does not name any of the human's numbered lines` };
  }
  const resolved = resolveGuardrailClass(line, guardrailClasses);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  return { ok: true, class: resolved.class, line };
}

/**
 * The EFFECTIVE class the draft table (and anything else that only wants to
 * render, never to red) should show for a step — never throws, defaults to
 * 'hitl' on anything malformed. `validate()` below is stricter: it reds on
 * exactly the malformed cases this function papers over for display.
 */
export function effectiveClass(step, declaration) {
  const lines = parseLines(declaration?.guardrails);
  const resolved = deriveFromLine(step?.fromLine, lines, declaration?.guardrailClasses);
  return resolved.ok ? resolved.class : 'hitl';
}

/**
 * The EFFECTIVE class the draft table should show beside guardrail (line)
 * number `n` itself — never throws. Unlike `effectiveClass`, an invalid
 * proposal is surfaced as `'red'` here rather than papered over as hitl,
 * because this is exactly the thing PRD wants shown to the human before
 * they sign: a guardrail the drafter proposed nonsense for is not silence,
 * it is a wrong answer, and the table must not hide that behind "hitl".
 */
export function effectiveGuardrailClass(n, declaration) {
  const lines = parseLines(declaration?.guardrails);
  const line = lines.find((l) => l.n === n);
  if (!line) return 'hitl';
  const resolved = resolveGuardrailClass(line, declaration?.guardrailClasses);
  return resolved.ok ? resolved.class : 'red';
}

/**
 * The guardrail numbers (line numbers) NO STEP declared a `fromLine` for.
 * The PRD requires these be SURFACED in the draft table, never silently
 * dropped — a guardrail the human wrote that no step serves is often an
 * arbiter field (job #1's cap is exactly this) and is the human's to place.
 */
export function unmappedGuardrails(declaration) {
  const list = guardrailList(declaration?.guardrails);
  const claimed = new Set(
    (declaration?.steps ?? [])
      .map((st) => st?.fromLine)
      .filter((n) => Number.isInteger(n)),
  );
  return list.filter((g) => !claimed.has(g.n));
}

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
  if (declaration.guardrailClasses !== undefined && declaration.guardrailClasses !== null
      && (typeof declaration.guardrailClasses !== 'object' || Array.isArray(declaration.guardrailClasses))) {
    return { verdict: 'red', red: 'validator: declaration "guardrailClasses" must be an object keyed by line number' };
  }

  const skills = Array.isArray(declaration.skills) ? declaration.skills : [];
  const guardrails = typeof declaration.guardrails === 'string' ? declaration.guardrails : '';
  const lines = parseLines(guardrails);
  const guardrailClasses = declaration.guardrailClasses;

  // Every guardrail-bearing line's PROPOSED class must itself be valid,
  // independent of whether any step claims it yet — an invented proposal is
  // a red the human should see even on a guardrail nothing has traced to.
  for (const g of guardrailList(guardrails)) {
    const resolved = resolveGuardrailClass({ n: g.n, guardrail: g.text }, guardrailClasses);
    if (!resolved.ok) {
      return { verdict: 'red', red: `validator: ${resolved.error}` };
    }
  }

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
    // A close that is ABSENT is fine — the class is derived, not authored.
    // A close that is present but not an object is a wrong answer.
    if (step.close !== null && step.close !== undefined
        && (typeof step.close !== 'object' || Array.isArray(step.close))) {
      return { verdict: 'red', red: `validator: ${label} "close" must be an object` };
    }

    // Declare this step's own artifact BEFORE checking its reads.
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

    // Check 4 — fromLine, if present, must name a real line whose proposed
    // class (if any) is valid. A step with NO fromLine at all is silence and
    // falls to hitl (RULED 2026-09-10), never a red. A fromLine naming a
    // non-existent line, or a line whose proposed class is invented, IS a
    // red — that is not silence, it is a wrong reference or a wrong answer.
    const resolved = deriveFromLine(step.fromLine, lines, guardrailClasses);
    if (!resolved.ok) {
      return { verdict: 'red', red: `validator: ${label} ${resolved.error}` };
    }
    const derived = resolved.class;

    // Check 5 — a DECLARED class, if present, must be one of the three
    // (an invented class like "yellow" is a wrong answer, not silence, and
    // stays a red) AND must equal what the step's OWN fromLine derives to.
    // This is the structural fix for F16: a step cannot claim a class its
    // own guardrail does not produce, and it has no field left to point at
    // a DIFFERENT line's (possibly stronger) guardrail instead — fromLine is
    // the only join key there is, and it names exactly one guardrail.
    const declaredClass = step.close && step.close.class !== undefined && step.close.class !== null
      ? step.close.class
      : undefined;
    if (declaredClass !== undefined) {
      if (!VALID_CLASSES.includes(declaredClass)) {
        return {
          verdict: 'red',
          red: `validator: ${label} close.class "${declaredClass}" is not one of ${VALID_CLASSES.join(', ')}`,
        };
      }
      if (declaredClass !== derived) {
        const lineDesc = step.fromLine === null || step.fromLine === undefined
          ? 'no fromLine'
          : `fromLine ${step.fromLine}`;
        return {
          verdict: 'red',
          red: `validator: ${label} close.class "${declaredClass}" does not match "${derived}", `
            + `which is what ${lineDesc} derives to — a step cannot claim a class its own guardrail `
            + 'does not produce, and an uncovered or blank-guardrail line must fall to hitl',
        };
      }
    }
  }

  return { verdict: 'green', red: null };
}
