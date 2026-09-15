// Part 1 — DRAFTER. One paid round per model. Give the model the PRIMITIVE
// catalogue (PRD §6 M0a, menu-is-inventory — every entry an existing
// implementation, catalogue.mjs) + the artifact-space rules + hamr's
// steps.txt/prose.txt; it answers ONLY via `emit_declaration`. It authors
// `steps` (goal, primitives, reads, emits, fromLine, optional shape) — no
// step bodies, no plumbing, NO per-step close class (that is DERIVED, never
// chosen — see validator.mjs) — and NEVER an arbiter field (PRD §5/§6:
// trigger, cap, askTtlMs, egress, the signed skillset, and "done" are
// human-signed, inexpressible to the drafter). It ALSO proposes, once per
// guardrail (never per step, never by matching the guardrail's TEXT against
// a hardcoded pattern), the class that guardrail's own wording earns —
// `guardrailClasses`, keyed by the human's line number (RULED 2026-09-10,
// replaces a regex `deriveClass` fitted to job #1's exact phrasing; see
// validator.mjs's header for why that had to go). `skills` and `guardrails`
// on the final declaration are stitched in by THIS module from the signed
// grant and the human's own words, verbatim — never taken from the model's
// tool call, so even a model that tries to emit them is ignored, not merely
// discouraged.
//
// Usage:
//   SYNTHETIC_API_KEY="..." node poc/m0/drafter.mjs <model-id> [--slot synthetic|deepseek] [--prose] [--ungroundable] [--uncovered]
//   (live calls also require DRAFTER_LIVE=1 — see the CLI guard below)
//
// --ungroundable plants a line with NO groundable check at all (M0a negative
// scenario ii — must be refused via "refused", never given a proxy check).
// --uncovered plants a line WITH a groundable check but no guardrail that
// covers it (M0a negative scenario vi, "the uncovered-line plant") — a
// planted line has no guardrail beside it by construction (plantLine never
// attaches one), so any step naming it via `fromLine` derives to `hitl`
// automatically (validator.mjs's blank-guardrail rule) — never a
// green/softgreen the drafter invented coverage for.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import {
  assertUnderGlobalCap, appendSpendRow, sumMeterings, RUN_CAP_USD,
} from './spend.mjs';
import { makeProvider } from './provider.mjs';
import { menu } from './catalogue.mjs';
import { parseLines, deriveFromLine } from './validator.mjs';
import { classifyFacts, runScoutRound, scoutJob2 } from './scout.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');
const STEPS_PATH = join(__dirname, 'steps.txt');
const PROSE_PATH = join(__dirname, 'prose.txt');

/** The declaration's signed skillset for M0a's job #1. Real mail egress is
 *  explicitly out of scope here (PRD §6 M9) — job #1 is dry-run egress only
 *  (writes a file behind the allow-list + accept), so the drafter is granted
 *  "core" and nothing else. (mailproof, once catalogued under "mail-egress"
 *  for real egress, was removed at M0b as a wrong fit — no job used it —
 *  and real egress may return at M9 in a different role, scoped then.) */
export const DRAFTER_SKILLS = Object.freeze(['core']);

/** Fixed in code, not spec-authorable — the drafter's own output cap (F11:
 *  DeepSeek honours only the legacy `max_tokens`; provider.mjs's
 *  `legacyMaxTokens` per slot is what makes this actually bind). */
export const DRAFTER_MAX_TOKENS = 16000;

function primitiveMenuText() {
  return menu({ skills: DRAFTER_SKILLS })
    .map((e) => `- ${e.verb}: ${e.desc} (${e.component}, class: ${e.class}) — ${e.package}#${e.symbol}`)
    .join('\n');
}

function jobLinesText(rawText) {
  return parseLines(rawText)
    .map((l) => `${l.n}. ${l.text}${l.guardrail ? ` [guardrail: ${l.guardrail}]` : ' [no guardrail]'}`)
    .join('\n');
}

/**
 * The scout's grounded facts, rendered for the drafter's prompt (PRD §M0a
 * exit: "the scout's facts appear in the draft"). `realColumns` — the FULL
 * mechanical CSV header from scout.mjs's `lookFixtures` — is what the
 * drafter is told to pick "columns" values FROM; `columns` (the scout's own,
 * possibly-partial, reported subset) is shown as context only, never as the
 * list a declared column is checked against (that check is validator.mjs's
 * job, against `declaration.realColumns`, never this prose).
 */
function factsBlock(facts) {
  const realColumns = Array.isArray(facts?.csv?.realColumns) ? facts.csv.realColumns : [];
  const reportedColumns = Array.isArray(facts?.csv?.columns) ? facts.csv.columns : [];
  const lines = [
    'The scout already looked at the real inputs before you were called — these are grounded facts, never invented:',
    `- the CSV's real header, mechanically read (${realColumns.length} columns): ${realColumns.join(', ')}`,
    `- columns the scout's own survey reported (a subset of the above, context only): ${reportedColumns.join(', ') || '(none)'}`,
    `- CSV row count: ${facts?.csv?.rowCount ?? 0}`,
    `- message line count: ${Array.isArray(facts?.text?.lines) ? facts.text.lines.length : 0}`,
  ];
  if (facts?.customerMentioned) lines.push(`- customer mentioned in the message: ${facts.customerMentioned}`);
  if (facts?.notes) lines.push(`- scout notes: ${facts.notes}`);
  lines.push(
    '',
    'Each step may optionally declare "columns": the CSV column names it reads or writes, each one copied '
      + 'VERBATIM from the real header above — never invented, never scraped out of goal prose. A name not in '
      + 'that real header is a red at validation. Omit "columns" for a step that touches no CSV column.',
  );
  return lines.join('\n');
}

function primitiveMenuBlock(rawGuardrails) {
  return `
Primitive catalogue (menu-is-inventory — a grant list, every entry an
existing implementation; a verb outside this list is a red at validation,
never invented):

${primitiveMenuText()}

There is no wiring layer. Steps share ONE artifact space. Each step you emit:
- "primitives": the verbs above it needs (may be empty for a step that only
  reasons over artifacts already read, e.g. matching a customer / deriving figures)
- "reads": artifact ids DECLARED BY AN EARLIER STEP ONLY — never itself, never
  a step that comes later
- "emits": exactly ONE new artifact id this step declares
- "fromLine": the ONE number, from the numbered job lines below, that this
  step SERVES. This is the only thing you declare about how the step is
  proven done — you do NOT choose a close class yourself and you do NOT
  pick which guardrail applies to THIS step. Whatever guardrail sits beside
  that line (or its absence) is what the class is derived from — see
  "guardrailClasses" below, which is where YOU say what each guardrail's
  own wording earns, once, independent of any step. Omit "fromLine" for a
  step that serves no particular line (it will be hitl).
You author no step bodies and no plumbing — only this declaration.

You may optionally emit "close": { "shape": {...} } ONLY when the line you
name has a guardrail you proposed "softgreen" for below — this is the shape
itself, the human's own words made structured. Emit nothing else under
"close": no "class", no "tracesTo". Those do not exist any more — picking a
class from a menu of guardrails, PER STEP, is exactly the mistake this
format exists to prevent (a step could otherwise point at a STRONGER
guardrail than the one covering it). You cannot point at a different line's
guardrail: "fromLine" names exactly one line, and that line's own guardrail
is the only thing that can ever produce a class other than hitl for it.

"guardrailClasses": propose a class for EACH guardrail below that is not
"[no guardrail]" — read that guardrail's own wording, once, on its own
merits (never by matching it against some other guardrail's exact phrasing;
a same-meaning guardrail worded differently must still get the class its
meaning earns). Key it by the line number the guardrail belongs to (as a
string, e.g. "3"), value one of "green"/"softgreen"/"hitl":
  - the human wrote a rule that every figure must cite the cell or formula
    it came from -> "green"
  - the human declared a SHAPE the output must take (e.g. one line per
    invoice) -> "softgreen", and supply that shape via "close.shape" on
    whichever step(s) name that line
  - the human wrote an ask/accept/review gate, or anything you are not
    confident is a citation or a declared shape -> "hitl". When unsure,
    "hitl" — guessing green or softgreen you cannot justify is worse than
    saying nothing.
  - if a guardrail is itself an ARBITER field restated in prose (e.g. a $
    cap), propose "hitl" for it too — an arbiter field can never be claimed
    by a step's close, and "hitl" is the safe, unclaimable answer.

"unjudgeable": OPTIONAL, keyed the same way as "guardrailClasses" (line
number as a string). Use it when a guardrail line HAS wording but that
wording itself could not be turned into a green/softgreen check — you are
proposing "hitl" for it in "guardrailClasses" anyway (this never changes:
unjudgeable does not upgrade or downgrade the class, it only explains WHY),
but the human likely wants to reword the line, and should be told. Give a
one-line reason in your own words, e.g. "no cell or formula named — cannot
tell what would make this figure correct". Do NOT use this for a guardrail
that is legitimately an ask/accept/review gate — you DID judge that one; it
is meant to be hitl. Only use it when the words themselves resisted
judgment. Never key a blank line with it — a blank line already means the
human chose to check it by hand, which is not the same fact.

Do not propose a class for a blank ("[no guardrail]") line, and do not
invent line numbers that aren't in the list below. Flow-level arbiter
guardrails (a $ cap, a trigger, etc.) belong to NO line at all and never
appear in this numbered list — do not propose anything for them, and do not
try to attach a "fromLine" to one; there is no number that could ever name
one.

Arbiter fields — YOU DO NOT EMIT THESE, EVER, under any field name: the
trigger, the $ cap, an ask/send step's POSITION in the sequence (guardrails
already state where; respect it, never restate or move it), the egress
allow-list or send target, the signed skillset, or what "done" means for the
whole flow. The SEND STEP ITSELF IS NOT ARBITER (PRD: "the send step" is
listed as an ordinary step; F13: dry-run egress is the "write" primitive,
already in your catalogue above) — draft it exactly like any other step:
goal, "write" among its primitives, a fromLine, a close. Only its TARGET,
its egress allow-list, and its POSITION are arbiter and off-limits — never
refuse a send line on the theory that "sending is egress" in general; that
confuses the step (yours to draft) with its destination (never yours).

If a line cannot be expressed as a typed, cited artifact at all (e.g. it asks
for a subjective judgment with no groundable check whatsoever — not even a
human check), put it in "refused" with that line's NUMBER (the "line" field —
the same numbered job line, never guessed from the words of "hamrLine") plus
a one-line reason, instead of inventing a proxy check or a primitive that
does not exist.

The numbered job lines, each showing its guardrail or "[no guardrail]":
${jobLinesText(rawGuardrails)}
`.trim();
}

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'one line: what this step is for' },
    primitives: {
      type: 'array', items: { type: 'string' }, description: 'verbs granted in the catalogue above — never invented',
    },
    reads: {
      type: 'array', items: { type: 'string' }, description: 'artifact ids this step reads, each declared by an EARLIER step',
    },
    emits: { type: 'string', description: 'the one new artifact id this step declares' },
    columns: {
      type: 'array',
      items: { type: 'string' },
      description: 'CSV column names this step reads or writes, copied VERBATIM from the real header shown '
        + 'below — never invented, never scraped out of goal prose. Omit for a step that touches no CSV column.',
    },
    fromLine: {
      type: 'integer',
      description: 'the ONE numbered job line this step serves. Its close class is DERIVED from that line\'s guardrail — never chosen. Omit for a step that serves no particular line (hitl).',
    },
    close: {
      type: 'object',
      properties: {
        shape: { type: 'object', description: 'ONLY when fromLine\'s guardrail declares a shape (derives softgreen): the human\'s declared shape, structured. Omit otherwise — no "class", no "tracesTo".' },
      },
    },
  },
  // `fromLine` is deliberately NOT required: a step that serves no
  // particular line is hitl (silence is safe), so omitting it must be
  // expressible rather than forced into a guess.
  required: ['goal', 'primitives', 'reads', 'emits'],
};

const DECLARATION_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: STEP_SCHEMA },
    guardrailClasses: {
      type: 'object',
      description: 'one proposed class per NON-BLANK guardrail line, keyed by that line\'s number '
        + '(as a string) — "green"/"softgreen"/"hitl", read from the guardrail\'s own wording once, '
        + 'never per step and never by matching some other guardrail\'s exact phrasing.',
      additionalProperties: { type: 'string', enum: ['green', 'softgreen', 'hitl'] },
    },
    unjudgeable: {
      type: 'object',
      description: 'RULING 1: one reason per guardrail line whose WORDING (not its intent) resisted a '
        + 'green/softgreen check, keyed by line number (as a string) — the same join key as '
        + '"guardrailClasses". Never upgrades or downgrades the class (still "hitl" in guardrailClasses); '
        + 'only explains why. Never key a blank line.',
      additionalProperties: { type: 'string' },
    },
    refused: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hamrLine: { type: 'string', description: 'the human-readable job line being refused, your own words — never parsed for its number' },
          line: { type: 'integer', description: 'the exact numbered job line this refusal covers, e.g. 6 — the one mechanical join key, same role as a step\'s "fromLine"' },
          reason: { type: 'string' },
        },
        required: ['hamrLine', 'line', 'reason'],
      },
    },
  },
  required: ['steps', 'guardrailClasses'],
};

/**
 * The human's own words, verbatim — the numbered job lines and their
 * guardrails, exactly as written on disk (prose.txt / steps.txt, plus any
 * planted line). This is the ONE source `declaration.guardrails` comes from
 * and the ONE source every fromLine resolves against, so a fromLine can
 * never resolve against text that isn't what was actually signed.
 */
export function extractGuardrails(rawText) {
  return String(rawText ?? '').trim();
}

/**
 * Assemble the final declaration. `skills` and `guardrails` are ALWAYS the
 * harness-supplied values, NEVER read from the model's tool-call args — the
 * mechanical form of "the drafter does not author arbiter fields": even a
 * model that tries to emit its own `skills`/`guardrails` is ignored, not
 * merely discouraged by the prompt.
 *
 * `guardrailClasses` is built here too, per GUARDRAIL (not per step): the
 * model's proposal for a line wins when it named that line, else the
 * caller's `guardrailClasses` (a redraft's previous declaration, so an
 * unchanged guardrail keeps whatever class it already carried — the
 * guardrails themselves never change in a redraft, and neither should a
 * class nobody revisited) is carried over, else the line has no entry at
 * all — which resolveGuardrailClass (validator.mjs) treats as hitl, silence
 * being safe. A proposal for a BLANK line, or for a line number that is not
 * one of the human's numbered lines at all, is dropped outright: it can
 * never do anything (blank always forces hitl) and it can never be aimed at
 * a flow-level arbiter guardrail, which has no line number to receive it.
 * An invalid proposal (not green/softgreen/hitl) for a real guardrail-
 * bearing line is passed through UNCHANGED, never normalised — validator.mjs
 * reds on it rather than silently downgrading it to hitl, exactly as an
 * invented `close.class` already does.
 *
 * `unjudgeable` is built the same way, per guardrail (RULING 1, 2026-09-10):
 * the model's reason for a line wins when it named that line, else a
 * redraft's previous `unjudgeable` carries over, else the line has no entry
 * (meaning it was not flagged unjudgeable — silent, not distinguished from
 * "the drafter didn't say", which is fine: the class it derives to is what
 * matters, and this field only ever adds an explanation, never authority).
 * A proposal for a blank line, or for a line that is not one of the human's
 * numbered lines, is dropped outright — same reasoning as `guardrailClasses`.
 *
 * `refused` carries the same way too (Finding 4, 2026-09-12): a prior
 * refusal (`refused: baseRefused`, a redraft's previous declaration) SURVIVES
 * a round that neither re-refuses that line nor maps a step onto it — a
 * redraft that only touches OTHER lines must not silently un-refuse one it
 * never revisited (validator.mjs's check 6 would otherwise red the line as
 * dropped). Keyed on `refused[].line` (Finding 3's typed field), never
 * `hamrLine` text. The one exception: if THIS round's assembled steps now
 * claim that line via `fromLine`, the step wins and the stale refusal is
 * dropped — a line cannot be both served and refused at once, and a step the
 * model just drafted for it is the stronger, more current signal.
 *
 * Each step's `close` is RECOMPUTED here from its own `fromLine` against the
 * assembled `guardrailClasses` (validator.mjs's deriveFromLine — the one
 * writer for this, never reimplemented) — never taken from the model, even
 * if the model tries to emit a `class` or `tracesTo`. This is the
 * structural half of "the drafter does not choose a step's class": the tool
 * schema doesn't offer the field, and even if a model invents one anyway,
 * it is discarded here.
 */
export function assembleDeclaration(modelArgs, {
  skills = DRAFTER_SKILLS, guardrails = '', guardrailClasses: baseGuardrailClasses = {},
  unjudgeable: baseUnjudgeable = {}, realColumns = [], refused: baseRefused = [],
} = {}) {
  const lines = parseLines(guardrails);
  const guardrailBearingLines = lines.filter((l) => l.guardrail.length > 0);
  const proposedRaw = modelArgs?.guardrailClasses && typeof modelArgs.guardrailClasses === 'object'
    && !Array.isArray(modelArgs.guardrailClasses)
    ? modelArgs.guardrailClasses
    : {};
  const base = baseGuardrailClasses && typeof baseGuardrailClasses === 'object'
    && !Array.isArray(baseGuardrailClasses)
    ? baseGuardrailClasses
    : {};
  const guardrailClasses = {};
  for (const line of guardrailBearingLines) {
    const key = String(line.n);
    if (Object.prototype.hasOwnProperty.call(proposedRaw, key)) {
      guardrailClasses[key] = proposedRaw[key];
    } else if (Object.prototype.hasOwnProperty.call(base, key)) {
      guardrailClasses[key] = base[key];
    }
  }

  const proposedUnjudgeableRaw = modelArgs?.unjudgeable && typeof modelArgs.unjudgeable === 'object'
    && !Array.isArray(modelArgs.unjudgeable)
    ? modelArgs.unjudgeable
    : {};
  const baseUnjudgeableSafe = baseUnjudgeable && typeof baseUnjudgeable === 'object'
    && !Array.isArray(baseUnjudgeable)
    ? baseUnjudgeable
    : {};
  const unjudgeable = {};
  for (const line of guardrailBearingLines) {
    const key = String(line.n);
    if (Object.prototype.hasOwnProperty.call(proposedUnjudgeableRaw, key)) {
      unjudgeable[key] = proposedUnjudgeableRaw[key];
    } else if (Object.prototype.hasOwnProperty.call(baseUnjudgeableSafe, key)) {
      unjudgeable[key] = baseUnjudgeableSafe[key];
    }
  }

  const steps = Array.isArray(modelArgs?.steps)
    ? modelArgs.steps.map((step) => {
      const fromLine = Number.isInteger(step?.fromLine) ? step.fromLine : null;
      const resolved = deriveFromLine(fromLine, lines, guardrailClasses);
      const cls = resolved.ok ? resolved.class : 'hitl';
      const shape = step?.close && typeof step.close === 'object' && !Array.isArray(step.close)
        ? step.close.shape
        : undefined;
      const close = cls === 'softgreen' && shape !== undefined ? { class: cls, shape } : { class: cls };
      return {
        goal: step?.goal,
        primitives: Array.isArray(step?.primitives) ? step.primitives : [],
        reads: Array.isArray(step?.reads) ? step.reads : [],
        emits: step?.emits,
        columns: Array.isArray(step?.columns) ? step.columns : [],
        fromLine,
        close,
      };
    })
    : [];

  // Finding 4 (2026-09-12) — a prior refusal survives a round that neither
  // re-refuses that line nor maps a step onto it. `claimedLines` reads the
  // STEPS JUST ASSEMBLED above (their real, resolved `fromLine`s), never
  // modelArgs directly, so a step this round wins over a refusal carried
  // from an earlier one. Keyed on `refused[].line` throughout — never
  // `hamrLine` text (Finding 3).
  const modelRefused = Array.isArray(modelArgs?.refused) ? modelArgs.refused : [];
  const claimedLines = new Set(steps.map((st) => st.fromLine).filter((n) => Number.isInteger(n)));
  const modelRefusedLines = new Set(modelRefused.map((r) => r?.line).filter((n) => Number.isInteger(n)));
  const carriedRefused = (Array.isArray(baseRefused) ? baseRefused : [])
    .filter((r) => Number.isInteger(r?.line) && !claimedLines.has(r.line) && !modelRefusedLines.has(r.line));
  const refused = [...modelRefused, ...carriedRefused];

  return {
    skills: [...skills],
    guardrails,
    guardrailClasses,
    unjudgeable,
    // Harness-supplied, exactly like skills/guardrails — never taken from
    // modelArgs, so a model naming its own "realColumns" cannot smuggle a
    // fake listing for validator.mjs's column check to trust.
    realColumns: [...(Array.isArray(realColumns) ? realColumns : [])],
    steps,
    refused,
  };
}

const UNGROUNDABLE_LINE = 'rate how friendly the customer sounds';
// F16: the PRD's own example for negative vi ("flag anything that looks
// unusual") is SUBJECTIVE, so the drafter refuses it as ungroundable and
// negative vi never runs. This replacement is groundable two ways and has no
// guardrail beside it (plantLine never attaches one):
//   - the archive copy is the PRD's own mechanical "happened" check — a file
//     either exists at that path with non-zero bytes, or it does not;
//   - "are the overdue dates complete" is a fact about the real fixture, which
//     the scout already established: fixtures/ar-aging.csv's "Days overdue"
//     column is EMPTY in all 8 rows.
// Neither produces a cited figure, so the citation guardrail does not reach
// either — which is what makes the line uncovered rather than merely
// unmapped. Both must land at hitl.
const UNCOVERED_LINE = 'save a copy of the reply to poc/m0/out/archive/reply.txt '
  + 'and tell me whether the overdue dates on the sheet are complete';

/**
 * Plant one extra job line, numbered one past the highest line already in
 * `rawText` (negative scenario (ii) `UNGROUNDABLE_LINE`, or (vi)
 * `UNCOVERED_LINE`) — with NO guardrail beside it. Never touches any
 * existing line or guardrail, so parsing the result changes nothing about
 * what came before.
 */
export function plantLine(rawText, line) {
  const parsed = parseLines(rawText);
  const nextN = parsed.length > 0 ? Math.max(...parsed.map((l) => l.n)) + 1 : 1;
  const trimmed = String(rawText ?? '').replace(/\s+$/, '');
  return `${trimmed}\n${nextN}. ${line}\n`;
}

// RULING 1 live probe (2026-09-10): hamr's own canonical example of a
// guardrail whose WORDING resists a mechanical check — "rate how friendly
// the customer sounds" — used here as a GUARDRAIL (not, as `--ungroundable`
// above uses the same phrase, as a whole job line with no guardrail at all).
// This is a different negative scenario than `UNGROUNDABLE_LINE`: the job
// line itself is ordinary and groundable (a step can genuinely emit an
// artifact for it), only its guardrail resists judgment. The question this
// exists to answer live: does the drafter flag it `unjudgeable` with a
// reason (correct), or silently propose "hitl" in `guardrailClasses` with no
// `unjudgeable` entry — which the draft table renders IDENTICALLY to a
// guardrail the human left BLANK, exactly the silent-fall failure ruling 1
// exists to kill (see validator.mjs's header)?
const UNJUDGEABLE_GUARDRAIL_LINE = 'add a one-line note about how the reply reads';
const UNJUDGEABLE_GUARDRAIL_TEXT = 'rate how friendly the customer sounds';

/**
 * Plant one extra job line WITH a guardrail attached, numbered one past the
 * highest line already in `rawText` — same append-only discipline as
 * `plantLine`, never touching any existing line or guardrail.
 */
export function plantLineWithGuardrail(rawText, line, guardrail) {
  const parsed = parseLines(rawText);
  const nextN = parsed.length > 0 ? Math.max(...parsed.map((l) => l.n)) + 1 : 1;
  const trimmed = String(rawText ?? '').replace(/\s+$/, '');
  return `${trimmed}\n${nextN}. ${line}\n   guardrail: ${guardrail}\n`;
}

/**
 * THE PAID ROUND, shared by job #1's `runDrafter` and job #2's `draftJob2` —
 * the SAME `emit_declaration` tool call, the SAME `assembleDeclaration`
 * stitching, over WHATEVER `stepsText`/`factsText` the caller hands in. This
 * is the one writer for "call the model, capture its declaration args";
 * every job-specific concern (ABSENT-facts handling, which facts shape to
 * render, plant lines) stays in the caller, never duplicated here.
 */
async function runDeclarationRound(modelId, {
  stepsText, factsText, runLabel, slot, provider: injectedProvider, rates: injectedRates,
} = {}) {
  let provider = injectedProvider;
  let rates = injectedRates;
  let suffix = modelId.replace(/^hf:/, '');
  const live = injectedProvider == null;
  if (live) {
    assertUnderGlobalCap(SPEND_PATH);
    ({ provider, rates, suffix } = makeProvider(slot, { model: modelId }));
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const guardrails = extractGuardrails(stepsText);

  let capturedArgs = null;
  let capturedText = null;
  const tools = [{
    name: 'emit_declaration',
    description: 'Emit the flow declaration over the granted primitive catalogue, or refuse a line you cannot ground at all.',
    parameters: DECLARATION_SCHEMA,
    execute: async (args) => { capturedArgs = args; return { ok: true }; },
  }];

  // Every round, not just the last (F15).
  const meterings = [];
  const loop = new Loop({
    provider,
    rates,
    onLlmResult: async (event) => { meterings.push(event); },
    onText: async (t) => { capturedText = t; },
  });

  const messages = [
    {
      role: 'system',
      content: `You are the fwdloop drafter. You answer ONLY by calling emit_declaration — never plain text. `
        + `${primitiveMenuBlock(guardrails)}\n\n${factsText}`,
    },
    // The numbered job lines already appear once, in the system prompt (primitiveMenuBlock's own
    // "The numbered job lines..." block) — every "below" reference there points at that one copy.
    // A second, identical copy here duplicated the job lines every round for no reason.
    {
      role: 'user',
      content: 'Call emit_declaration now.',
    },
  ];

  const startedAt = Date.now();
  await loop.run(messages, tools, { maxTokens: DRAFTER_MAX_TOKENS });
  const wallMs = Date.now() - startedAt;

  const metered = sumMeterings(meterings);
  const suffixMatch = metered.model != null && metered.model.replace(/^hf:/, '') === suffix;
  const costUsd = metered.costUsd;

  if (live) {
    appendSpendRow(SPEND_PATH, {
      runId: runLabel, step: 'draft', model: modelId, modelReturned: metered.model,
      tokens: metered.tokens, costUsd, rounds: metered.rounds,
      rateSource: metered.rateSource, wallMs,
    });
    if (costUsd !== null && costUsd > RUN_CAP_USD) {
      console.error(`WARNING: draft round cost $${costUsd} exceeds the per-run $${RUN_CAP_USD} cap (informational only for M0's single-round draft)`);
    }
  }

  return {
    guardrails, capturedArgs, capturedText, metered, suffixMatch, costUsd, wallMs,
  };
}

export async function runDrafter(modelId, {
  ungroundable = false, uncovered = false, unjudgeableGuardrail = false,
  runLabel = 'drafter', slot = 'synthetic', prose = false,
  provider: injectedProvider, rates: injectedRates, facts,
} = {}) {
  // ABSENT handling (PRD's M0a exit gap, borrowed-from bareloop
  // authorflow.js:1408 in spirit): checked BEFORE any provider is built or
  // spend cap even consulted, so an ABSENT facts object costs exactly $0 —
  // not a flag on a draft, not a draft with a warning, a REFUSAL with a
  // named cause. See scout.mjs's `classifyFacts` for the named routes.
  const factsCheck = classifyFacts(facts);
  if (factsCheck.state === 'ABSENT') {
    return {
      modelRequested: modelId, modelReturned: null, suffixMatch: null,
      toolCalled: false, declaration: null, textInstead: null,
      usage: null, rounds: 0, costUsd: null, rateSource: null, wallMs: 0,
      ungroundable, uncovered, unjudgeableGuardrail,
      absent: { cause: factsCheck.cause, reason: factsCheck.reason },
    };
  }

  let stepsText = readFileSync(prose ? PROSE_PATH : STEPS_PATH, 'utf8');
  if (ungroundable) stepsText = plantLine(stepsText, UNGROUNDABLE_LINE);
  if (uncovered) stepsText = plantLine(stepsText, UNCOVERED_LINE);
  if (unjudgeableGuardrail) {
    stepsText = plantLineWithGuardrail(stepsText, UNJUDGEABLE_GUARDRAIL_LINE, UNJUDGEABLE_GUARDRAIL_TEXT);
  }

  const round = await runDeclarationRound(modelId, {
    stepsText, factsText: factsBlock(facts), runLabel, slot, provider: injectedProvider, rates: injectedRates,
  });

  const realColumns = Array.isArray(facts?.csv?.realColumns) ? facts.csv.realColumns : [];
  const declaration = round.capturedArgs != null
    ? assembleDeclaration(round.capturedArgs, { guardrails: round.guardrails, realColumns })
    : null;

  const report = {
    modelRequested: modelId, modelReturned: round.metered.model, suffixMatch: round.suffixMatch,
    toolCalled: round.capturedArgs != null, declaration, textInstead: round.capturedArgs ? null : round.capturedText,
    usage: round.metered.tokens, rounds: round.metered.rounds, costUsd: round.costUsd,
    rateSource: round.metered.rateSource, wallMs: round.wallMs,
    ungroundable, uncovered, unjudgeableGuardrail,
  };
  return report;
}

/**
 * Job #2's own facts block — kept separate from `factsBlock` (job #1's
 * CSV-shaped scout facts) rather than overloading one renderer to branch on
 * two unrelated shapes; each job renders its own scout's own facts.
 * `facts` is `scoutJob2`'s output shape (scout.mjs) — never the CSV/text
 * shape `groundFacts` produces. Neither file's body text is included (see
 * `scoutJob2`'s own header for why): the drafter picks primitives, it does
 * not compose.
 */
function job2FactsBlock(facts) {
  const headings = Array.isArray(facts?.jd?.headings) ? facts.jd.headings : [];
  const lines = [
    'The scout already looked at the real inputs before you were called — these are grounded facts, never invented:',
    `- resume: a .docx file, ${facts?.resume?.paragraphs ?? 0} paragraphs, ~${facts?.resume?.words ?? 0} words`,
    `- job description: a markdown file, ~${facts?.jd?.words ?? 0} words, headings: ${headings.join(', ') || '(none)'}`,
    '',
    'Neither file\'s body text is shown to you here — you pick PRIMITIVES from the catalogue to read them '
      + '(the resume is a .docx file: use "readDocx"; the job description is plain/markdown text: use "read"). '
      + 'You never compose the summary yourself; that is a later step outside this declaration. Omit "columns" '
      + 'for every step — job #2 has no CSV.',
  ];
  return lines.join('\n');
}

/**
 * Job #2's drafter invocation (M0b Amendment B / Claim 2 evidence): the
 * SAME paid `emit_declaration` round and the SAME `assembleDeclaration`
 * stitching as job #1's `runDrafter`, over job #2's own prose and scout
 * facts (`scoutJob2`'s output) instead of job #1's steps/prose files and
 * CSV-shaped facts. No `JOB1_NEEDS`-style table: the catalogue menu
 * (`primitiveMenuBlock`, unchanged) already carries `readDocx` under the
 * same "core" skill everything else here is granted, so nothing extra is
 * needed for the model to select it.
 *
 * ABSENT handling mirrors `runDrafter`'s (checked before any provider is
 * built, $0), but is NOT `classifyFacts` — that function's checks are
 * job #1's CSV-shaped facts (`facts.csv.columns` etc.) and would misread a
 * job #2 facts object entirely. This is the smallest job #2-shaped
 * equivalent, not a stretched reuse of a job #1 function.
 */
export async function draftJob2(modelId, {
  proseText, facts, runLabel = 'drafter-job2', slot = 'synthetic',
  provider: injectedProvider, rates: injectedRates,
} = {}) {
  if (!facts || typeof facts !== 'object' || !facts.resume || !facts.jd) {
    return {
      modelRequested: modelId, modelReturned: null, suffixMatch: null,
      toolCalled: false, declaration: null, textInstead: null,
      usage: null, rounds: 0, costUsd: null, rateSource: null, wallMs: 0,
      absent: {
        cause: 'missing',
        reason: 'no job #2 scout facts (resume/jd, scout.mjs\'s scoutJob2) were given to the drafter',
      },
    };
  }

  const round = await runDeclarationRound(modelId, {
    stepsText: proseText, factsText: job2FactsBlock(facts), runLabel, slot, provider: injectedProvider, rates: injectedRates,
  });

  const declaration = round.capturedArgs != null
    ? assembleDeclaration(round.capturedArgs, { guardrails: round.guardrails, realColumns: [] })
    : null;

  return {
    modelRequested: modelId, modelReturned: round.metered.model, suffixMatch: round.suffixMatch,
    toolCalled: round.capturedArgs != null, declaration, textInstead: round.capturedArgs ? null : round.capturedText,
    usage: round.metered.tokens, rounds: round.metered.rounds, costUsd: round.costUsd,
    rateSource: round.metered.rateSource, wallMs: round.wallMs,
  };
}

// CLI entry point — live, opt-in ONLY (DRAFTER_LIVE=1), same discipline as
// scout.mjs: never runs under `npm test` (node --test never executes this
// block; no test file imports it), and a stray manual invocation without the
// flag refuses instead of silently spending money.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.DRAFTER_LIVE !== '1') {
    console.error('A live drafter round costs real money — set DRAFTER_LIVE=1 to run it. Refusing.');
    process.exit(1);
  }
  if (process.argv.includes('--job2')) {
    const get = (flag) => {
      const i = process.argv.indexOf(flag);
      return i !== -1 ? process.argv[i + 1] : undefined;
    };
    const modelId = process.argv[2];
    const prosePath = get('--prose');
    const resumePath = get('--resume');
    const jdPath = get('--jd');
    const slotIdx = process.argv.indexOf('--slot');
    const slot = slotIdx !== -1 ? process.argv[slotIdx + 1] : 'synthetic';
    if (!modelId || !prosePath || !resumePath || !jdPath) {
      console.error('usage: DRAFTER_LIVE=1 node poc/m0/drafter.mjs <model-id> --job2 --prose <path> --resume <docx> --jd <md> [--slot synthetic|deepseek]');
      process.exit(1);
    }
    // Live path: scout -> drafter, job #2 shape (M0b Amendment B). scoutJob2 is $0
    // (no model round) so no separate opt-in gate is needed for it — see scout.mjs's CLI.
    const scoutReport = scoutJob2({ resumePath, jdPath });
    if (!scoutReport.ok) {
      console.error(JSON.stringify(scoutReport, null, 2));
      process.exit(1);
    }
    const proseText = readFileSync(prosePath, 'utf8');
    const tag = `${suffixOf(modelId).replace(/\//g, '_')}-${slot}-job2`;
    const report = await draftJob2(modelId, {
      proseText, facts: scoutReport.facts, slot, runLabel: `drafter-${tag}`,
    });
    const outPath = join(OUT_DIR, `draft-${tag}-${Date.now()}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, declaration: '(see ' + outPath + ')' }, null, 2));
    process.exit(0);
  }
  const modelId = process.argv[2];
  const ungroundable = process.argv.includes('--ungroundable');
  const uncovered = process.argv.includes('--uncovered');
  const unjudgeableGuardrail = process.argv.includes('--unjudgeable-guardrail');
  const prose = process.argv.includes('--prose');
  const slotIdx = process.argv.indexOf('--slot');
  const slot = slotIdx !== -1 ? process.argv[slotIdx + 1] : 'synthetic';
  if (!modelId) {
    console.error('usage: DRAFTER_LIVE=1 node poc/m0/drafter.mjs <model-id> [--slot synthetic|deepseek] [--prose] [--ungroundable] [--uncovered] [--unjudgeable-guardrail]');
    process.exit(1);
  }
  const shapeTag = prose ? 'prose' : 'steps';
  const tag = `${suffixOf(modelId).replace(/\//g, '_')}-${slot}-${shapeTag}${ungroundable ? '-ungroundable' : ''}${uncovered ? '-uncovered' : ''}${unjudgeableGuardrail ? '-unjudgeable-guardrail' : ''}`;
  // Live path: scout -> drafter (PRD §M0a exit). The scout's mechanical look
  // and its one bounded model round run first, on the SAME real fixtures;
  // its grounded facts (never the drafter's own guess) are what the drafter
  // gets handed below.
  const REPO_ROOT = join(__dirname, '..', '..');
  const csvPath = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
  const textPath = join(REPO_ROOT, 'fixtures', 'message.txt');
  const scoutReport = await runScoutRound(modelId, { slot, csvPath, textPath, runLabel: `scout-${tag}` });
  const report = await runDrafter(modelId, {
    ungroundable, uncovered, unjudgeableGuardrail, prose, slot, runLabel: `drafter-${tag}`, facts: scoutReport.facts,
  });
  // Timestamped: repeated stability runs of the SAME plant/model/slot must
  // never overwrite each other's evidence.
  const outPath = join(OUT_DIR, `draft-${tag}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, declaration: '(see ' + outPath + ')' }, null, 2));
}

function suffixOf(modelId) { return modelId.replace(/^hf:/, ''); }
