// ported-from: poc/m0/validator.mjs@288cb8a (parseLines/resolveGuardrailClass/
// deriveFromLine/validate — the walkable chain, the fromLine/class
// derivation, the listing rule, and THE SEND LOCK block around lines
// 573-634) and poc/m0/artifacts.mjs@deae3da (ArtifactSpace/unwalkableReads —
// the declared-before check) and poc/m1/slots.mjs@92313d7 (checkAskSlots —
// the ask slot mechanism, incl. the "a pause is zero primitives AND hitl"
// fix). Rewritten for the M1 schema, never imported — src must not import
// from poc (CLAUDE.md: "borrow, never import"; complete separation between
// poc/ and src/).
//
// The send lock is a mechanism, not wording (F21/F24: a lock is typed
// grants/checks, never prompt phrasing). Generalised from M0b's single ask
// slot / single send slot to M1's arrays (`arbiter.asks[]`,
// `arbiter.sends[]`, M1 scope item 3 widened to "however many a human
// signs"): every signed ask and send line is checked, not just the last one
// seen. Unlike M0, which hard-coded the verb "write", rule (d) below checks
// the CATALOGUE's `class` field for the primitive instead — the send lock
// should not be tied to one verb's name.
//
// M1 piece 3 (docs/wiki/the-module-ladder.md, "M1 — scope, exit,
// negative — SIGNED", scope item 2): "the drafter's half is a schema with
// no arbiter fields in it." This module validates `declaration.json`
// against that closed schema, given the ALREADY-PARSED `arbiter`/`lines`
// from `parseSignedText` (src/signed-text.js) — it never parses prose
// itself, and it never imports the catalogue: the caller passes it as
// data (piece 4 makes it a data file; piece 3 only takes it as a param).
//
// `inputFacts`/`picks` replace M0's old per-input listing fields — the
// harness-supplied mechanical listing for one input, generalised from "one
// spreadsheet header" to "one input per signed source role" (M1 §10, sources as typed
// arbiter lines). The listing rule itself (M0a exit criterion, F17) is
// unchanged in spirit: every name a step picks must appear verbatim in the
// real, harness-supplied listing for that role — never derived from goal
// prose, never skipped when it cannot be checked.
//
// No `new RegExp` anywhere in this file — a test in test/signed-text.test.js
// greps all of src/ for that, and it must keep passing with this file added.

/** @typedef {import('./types.js').Arbiter} Arbiter */
/** @typedef {import('./types.js').SignedLine} SignedLine */
/** @typedef {import('./types.js').CatalogueEntry} CatalogueEntry */
/** @typedef {import('./types.js').ValidateDeclarationResult} ValidateDeclarationResult */

/** Every top-level, step-level and close-level field this schema defines —
 *  kept in sync with the checks below so a mutation suite can assert it
 *  tested every one of them (same trick as ARBITER_FIELDS/SIGNATURE_FIELDS). */
export const DECLARATION_FIELDS = Object.freeze([
  // top level
  'steps',
  'guardrailClasses',
  'unjudgeable',
  'refused',
  'inputFacts',
  // step level
  'goal',
  'primitives',
  'reads',
  'emits',
  'fromLine',
  'close',
  'picks',
  // close level
  'class',
  'shape',
]);

const VALID_CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

// The arbiter's own vocabulary — refused at any depth in a declaration, in
// any position, because the drafter never authors these (CLAUDE.md hard
// line: "the agent authors steps; it never authors the trigger, the cap,
// an ask's position, an ask's TTL, the egress allow-list...").
const ARBITER_KEYS = Object.freeze(['cap', 'ask', 'ttl', 'send', 'source', 'trigger', 'skills']);

const TOP_LEVEL_ALLOWED = Object.freeze(['steps', 'guardrailClasses', 'unjudgeable', 'refused', 'inputFacts']);
const STEP_ALLOWED = Object.freeze(['goal', 'primitives', 'reads', 'emits', 'fromLine', 'close', 'picks']);
const CLOSE_ALLOWED = Object.freeze(['class', 'shape']);

/** @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Unknown-key + arbiter-key refusal for one object's OWN keys (not
 *  recursive) — arbiter words get their own, distinguishable red wording so
 *  it can never be mistaken for a plain unknown key. */
function checkOwnKeys(obj, allowed, path, reds) {
  for (const key of Object.keys(obj)) {
    if (ARBITER_KEYS.includes(key)) {
      reds.push(`declaration: arbiter field "${key}" at ${path}.${key} — the drafter cannot author it`);
    } else if (!allowed.includes(key)) {
      reds.push(`declaration: unknown key "${key}" at ${path}.${key}`);
    }
  }
}

/** Arbiter-key refusal recursively through `close.shape` — any depth, any
 *  key named after the arbiter's vocabulary, in an object or nested inside
 *  an array. Every OTHER key inside `shape` is free (the typed shape
 *  vocabulary is not signed yet, per M1 scope item 2). */
function scanShapeForArbiterKeys(value, path, reds) {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => scanShapeForArbiterKeys(entry, `${path}[${i}]`, reds));
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const childPath = `${path}.${key}`;
      if (ARBITER_KEYS.includes(key)) {
        reds.push(`declaration: arbiter field "${key}" at ${childPath} — the drafter cannot author it`);
      }
      scanShapeForArbiterKeys(value[key], childPath, reds);
    }
  }
}

/**
 * Resolve one line's class from `guardrailClasses`, exactly as
 * poc/m0/validator.mjs's `resolveGuardrailClass` does: blank guardrail is
 * always hitl; no proposal for a non-blank guardrail is hitl (silence is
 * safe); an invented proposal is a red, never normalised to hitl.
 * Returns `{ ok: true, class }` or `{ ok: false, error }`.
 */
function resolveGuardrailClass(line, guardrailClasses) {
  if (!line || !line.guardrail) {
    return { ok: true, class: 'hitl' };
  }
  const key = String(line.n);
  if (!Object.prototype.hasOwnProperty.call(guardrailClasses, key)) {
    return { ok: true, class: 'hitl' };
  }
  const proposed = guardrailClasses[key];
  if (VALID_CLASSES.includes(proposed)) {
    return { ok: true, class: proposed };
  }
  return {
    ok: false,
    error: `guardrailClasses line ${line.n} proposes class "${proposed}", which is not one of `
      + `${VALID_CLASSES.join(', ')} (an invented proposal, never normalised to hitl)`,
  };
}

/** Same shape as poc/m0/validator.mjs's `deriveFromLine`: a step with no
 *  `fromLine` is silence -> hitl; a malformed or non-existent `fromLine` is
 *  a red; otherwise the class derives from that line's guardrail proposal. */
function deriveFromLine(fromLine, lines, guardrailClasses) {
  if (fromLine === null || fromLine === undefined) {
    return { ok: true, class: 'hitl', line: null };
  }
  if (!Number.isInteger(fromLine)) {
    return { ok: false, error: `fromLine ${JSON.stringify(fromLine)} must be an integer` };
  }
  const line = lines.find((l) => l.n === fromLine);
  if (!line) {
    return { ok: false, error: `fromLine ${fromLine} does not name any of the signed numbered lines` };
  }
  const resolved = resolveGuardrailClass(line, guardrailClasses);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, class: resolved.class, line };
}

/**
 * Validate a drafter declaration against the M1 closed schema. `arbiter`
 * and `lines` are `parseSignedText`'s output; `catalogue` is a plain array
 * of `{ verb, skill, class }`. Never throws — a bad declaration, a bad
 * arbiter, a bad lines array, or a bad catalogue is a red, never an
 * exception.
 *
 * @param {unknown} declaration
 * @param {{ arbiter?: unknown, lines?: unknown, catalogue?: unknown }} [context]
 * @returns {ValidateDeclarationResult}
 */
export function validateDeclaration(declaration, context = {}) {
  const { arbiter, lines, catalogue } = context;
  const reds = [];

  if (!isPlainObject(declaration)) {
    return deepFreeze({ ok: false, reds: ['declaration: must be an object'] });
  }
  if (!isPlainObject(arbiter)) {
    reds.push('declaration: caller-supplied "arbiter" must be an object (parseSignedText output)');
  }
  if (!Array.isArray(lines)) {
    reds.push('declaration: caller-supplied "lines" must be an array (parseSignedText output)');
  }
  if (!Array.isArray(catalogue)) {
    reds.push('declaration: caller-supplied "catalogue" must be an array of {verb, skill, class}');
  }
  if (reds.length > 0) return deepFreeze({ ok: false, reds });

  const safeLines = /** @type {SignedLine[]} */ (lines);
  const safeArbiter = /** @type {Arbiter} */ (arbiter);
  const skills = Array.isArray(safeArbiter.skills) ? safeArbiter.skills : [];
  const sourceRoles = Array.isArray(safeArbiter.sources) ? safeArbiter.sources.map((s) => s?.role) : [];
  const asks = Array.isArray(safeArbiter.asks) ? safeArbiter.asks : [];
  const askLines = asks.map((a) => a.line);
  const sends = Array.isArray(safeArbiter.sends) ? safeArbiter.sends : [];
  const sendLines = sends.map((s) => s.line);

  const catalogueByVerb = new Map();
  for (const entry of /** @type {CatalogueEntry[]} */ (catalogue)) {
    if (entry && typeof entry.verb === 'string') catalogueByVerb.set(entry.verb, entry);
  }

  // --- top level: unknown / arbiter keys -----------------------------------
  checkOwnKeys(declaration, TOP_LEVEL_ALLOWED, 'declaration', reds);

  // --- steps: must be a non-empty array, or nothing else here is meaningful
  if (!Array.isArray(declaration.steps) || declaration.steps.length === 0) {
    reds.push('declaration: "steps" must be a non-empty array');
    return deepFreeze({ ok: false, reds });
  }
  const { steps } = declaration;

  // --- guardrailClasses (REQUIRED — the harness always writes it; empty {}
  // is fine, missing entirely is not) ------------------------------------
  let guardrailClasses = {};
  if (!Object.prototype.hasOwnProperty.call(declaration, 'guardrailClasses')) {
    reds.push('declaration: "guardrailClasses" is required (an object keyed by line number; {} is fine)');
  } else if (isPlainObject(declaration.guardrailClasses)) {
    guardrailClasses = declaration.guardrailClasses;
    for (const key of Object.keys(guardrailClasses)) {
      const n = Number(key);
      const line = Number.isInteger(n) ? safeLines.find((l) => l.n === n) : undefined;
      if (!line || !line.guardrail) {
        reds.push(`declaration: guardrailClasses key "${key}" does not name a signed line with a guardrail`);
        continue;
      }
      const value = guardrailClasses[key];
      if (!VALID_CLASSES.includes(value)) {
        reds.push(`declaration: guardrailClasses line ${key} value ${JSON.stringify(value)} is not one of ${VALID_CLASSES.join(', ')}`);
      }
    }
  } else {
    reds.push('declaration: "guardrailClasses" must be an object keyed by line number');
  }

  // --- unjudgeable (REQUIRED; {} is fine) ------------------------------------
  let unjudgeable = {};
  if (!Object.prototype.hasOwnProperty.call(declaration, 'unjudgeable')) {
    reds.push('declaration: "unjudgeable" is required (an object keyed by line number; {} is fine)');
  } else if (isPlainObject(declaration.unjudgeable)) {
    unjudgeable = declaration.unjudgeable;
    for (const [key, reason] of Object.entries(unjudgeable)) {
      const n = Number(key);
      if (!Number.isInteger(n)) {
        reds.push(`declaration: unjudgeable key "${key}" must be an integer line number`);
        continue;
      }
      if (typeof reason !== 'string' || reason.length === 0) {
        reds.push(`declaration: unjudgeable reason for line ${n} must be a non-empty string`);
        continue;
      }
      const line = safeLines.find((l) => l.n === n);
      if (!line || !line.guardrail) {
        reds.push(`declaration: unjudgeable names line ${n}, which has no guardrail to be unjudgeable about`);
        continue;
      }
      const proposed = isPlainObject(declaration.guardrailClasses) ? declaration.guardrailClasses[key] : undefined;
      if (proposed !== undefined && proposed !== 'hitl') {
        reds.push(`declaration: line ${n} is marked unjudgeable but guardrailClasses proposes "${proposed}" `
          + '— unjudgeable never upgrades or downgrades the class, it can only explain a hitl');
      }
    }
  } else {
    reds.push('declaration: "unjudgeable" must be an object keyed by line number');
  }

  // --- refused (REQUIRED; [] is fine) ----------------------------------------
  let refused = [];
  if (!Object.prototype.hasOwnProperty.call(declaration, 'refused')) {
    reds.push('declaration: "refused" is required (an array of {line, reason}; [] is fine)');
  } else if (Array.isArray(declaration.refused)) {
    refused = declaration.refused;
    refused.forEach((entry, i) => {
      if (!isPlainObject(entry)) {
        reds.push(`declaration: refused[${i}] must be an object {line, reason}`);
        return;
      }
      if (!Number.isInteger(entry.line)) {
        reds.push(`declaration: refused[${i}].line must be an integer line number`);
      } else if (!safeLines.some((l) => l.n === entry.line)) {
        reds.push(`declaration: refused[${i}].line ${entry.line} does not name any signed numbered line`);
      }
      if (typeof entry.reason !== 'string' || entry.reason.length === 0) {
        reds.push(`declaration: refused[${i}].reason must be a non-empty string`);
      }
    });
  } else {
    reds.push('declaration: "refused" must be an array of {line, reason}');
  }
  const refusedLines = new Set(refused.map((r) => r?.line).filter((n) => Number.isInteger(n)));

  // --- inputFacts (REQUIRED; {} is fine) -------------------------------------
  let inputFacts = {};
  if (!Object.prototype.hasOwnProperty.call(declaration, 'inputFacts')) {
    reds.push('declaration: "inputFacts" is required (an object keyed by source role; {} is fine)');
  } else if (isPlainObject(declaration.inputFacts)) {
    inputFacts = declaration.inputFacts;
    for (const [role, listing] of Object.entries(inputFacts)) {
      if (!sourceRoles.includes(role)) {
        reds.push(`declaration: inputFacts role "${role}" is not one of the signed source roles`);
      }
      if (!Array.isArray(listing) || listing.some((v) => typeof v !== 'string')) {
        reds.push(`declaration: inputFacts["${role}"] must be an array of strings`);
      }
    }
  } else {
    reds.push('declaration: "inputFacts" must be an object keyed by source role');
  }

  // --- steps ------------------------------------------------------------------
  const emitSeen = new Set();
  const declaredEmits = new Set();
  /** @type {Array<{ emits: string|null, effectiveClass: string, fromLine: number|null, primitives: string[], reads: string[] }>} */
  const stepInfo = [];

  steps.forEach((step, i) => {
    const label = `steps[${i}]`;
    if (!isPlainObject(step)) {
      reds.push(`declaration: ${label} must be an object`);
      stepInfo.push({
        emits: null, effectiveClass: 'hitl', fromLine: null, primitives: [], reads: [],
      });
      return;
    }

    checkOwnKeys(step, STEP_ALLOWED, `declaration.${label}`, reds);

    // goal
    if (typeof step.goal !== 'string' || step.goal.length === 0) {
      reds.push(`declaration: ${label}.goal must be a non-empty string`);
    }

    // primitives
    const primitives = Array.isArray(step.primitives) ? step.primitives : null;
    if (primitives === null) {
      reds.push(`declaration: ${label}.primitives must be an array of catalogue verbs`);
    } else {
      for (const verb of primitives) {
        const entry = typeof verb === 'string' ? catalogueByVerb.get(verb) : undefined;
        if (!entry) {
          reds.push(`declaration: ${label}.primitives names "${verb}", which is not in the catalogue`);
          continue;
        }
        if (!skills.includes(entry.skill)) {
          reds.push(`declaration: ${label}.primitives "${verb}" needs skill "${entry.skill}", which is not signed (skills: ${skills.join(', ') || 'none'})`);
        }
      }
    }

    // reads
    const reads = Array.isArray(step.reads) ? step.reads : null;
    if (reads === null) {
      reds.push(`declaration: ${label}.reads must be an array of artifact ids`);
    }

    // emits
    let emits = null;
    if (typeof step.emits !== 'string' || step.emits.length === 0) {
      reds.push(`declaration: ${label}.emits must be a non-empty string`);
    } else {
      emits = step.emits;
      if (emitSeen.has(emits)) {
        reds.push(`declaration: ${label}.emits "${emits}" is a duplicate — one writer per artifact`);
      }
      emitSeen.add(emits);
    }

    // walkable chain — every read must have been emitted by an EARLIER step
    if (reads !== null && emits !== null) {
      for (const readId of reads) {
        if (readId === emits || !declaredEmits.has(readId)) {
          reds.push(`declaration: ${label} reads artifact "${readId}" that no earlier step declared`);
        }
      }
    }
    if (emits !== null) declaredEmits.add(emits);

    // fromLine + class derivation — the key itself is required (value may be
    // null, meaning "no line"; the key being entirely absent is not the same
    // thing and is its own red).
    let effectiveClass = 'hitl';
    let fromLine = null;
    if (!Object.prototype.hasOwnProperty.call(step, 'fromLine')) {
      reds.push(`declaration: ${label}.fromLine is required (an integer naming a real line, or null)`);
    } else {
      fromLine = step.fromLine;
      if (fromLine !== null && typeof fromLine !== 'number') {
        reds.push(`declaration: ${label}.fromLine must be an integer or null`);
      } else {
        const resolved = deriveFromLine(fromLine, safeLines, guardrailClasses);
        if (!resolved.ok) {
          reds.push(`declaration: ${label} ${resolved.error}`);
        } else {
          effectiveClass = resolved.class;
        }
      }
    }

    // close
    if (step.close !== undefined && step.close !== null) {
      if (!isPlainObject(step.close)) {
        reds.push(`declaration: ${label}.close must be an object`);
      } else {
        checkOwnKeys(step.close, CLOSE_ALLOWED, `declaration.${label}.close`, reds);
        const declaredClass = step.close.class;
        if (declaredClass !== undefined) {
          if (!VALID_CLASSES.includes(declaredClass)) {
            reds.push(`declaration: ${label}.close.class ${JSON.stringify(declaredClass)} is not one of ${VALID_CLASSES.join(', ')}`);
          } else if (declaredClass !== effectiveClass) {
            reds.push(`declaration: ${label}.close.class "${declaredClass}" does not match "${effectiveClass}", `
              + 'which is what fromLine derives to — a step cannot claim a class its own guardrail does not produce');
          }
        }
        if (step.close.shape !== undefined && step.close.shape !== null) {
          if (!isPlainObject(step.close.shape)) {
            reds.push(`declaration: ${label}.close.shape must be an object`);
          } else {
            scanShapeForArbiterKeys(step.close.shape, `declaration.${label}.close.shape`, reds);
          }
        }
      }
    }

    // picks — the listing rule, generalised
    if (step.picks !== undefined) {
      if (!isPlainObject(step.picks)) {
        reds.push(`declaration: ${label}.picks must be an object keyed by source role`);
      } else {
        for (const [role, names] of Object.entries(step.picks)) {
          const listing = Object.prototype.hasOwnProperty.call(inputFacts, role) ? inputFacts[role] : undefined;
          if (listing === undefined) {
            reds.push(`declaration: ${label}.picks names role "${role}", which is missing from declaration.inputFacts`);
            continue;
          }
          if (!Array.isArray(names)) {
            reds.push(`declaration: ${label}.picks["${role}"] must be an array of strings`);
            continue;
          }
          for (const name of names) {
            if (typeof name !== 'string' || !listing.includes(name)) {
              reds.push(`declaration: ${label}.picks["${role}"] names "${name}" — invented name, not in `
                + `declaration.inputFacts["${role}"] (${listing.join(', ')})`);
            }
          }
        }
      }
    }

    stepInfo.push({
      emits,
      effectiveClass,
      fromLine: fromLine ?? null,
      primitives: primitives ?? [],
      reads: reads ?? [],
    });
  });

  // --- ask slots (ported from poc/m1/slots.mjs's checkAskSlots) --------------
  // (a) exactly one hitl step bound to each signed ask line.
  for (const n of askLines) {
    const matches = stepInfo.filter((st) => st.fromLine === n);
    if (matches.length === 0) {
      reds.push(`declaration: ask at line ${n} has no step bound to it`);
    } else if (matches.length >= 2) {
      reds.push(`declaration: ask at line ${n} has ${matches.length} steps bound to it — exactly 1 required`);
    } else if (matches[0].effectiveClass !== 'hitl') {
      reds.push(`declaration: ask at line ${n} step's effective class is "${matches[0].effectiveClass}" — must be "hitl"`);
    }
    // (a2) M1 amendment 3 item 4: a marked line is ONLY the stop — the one
    // step bound to it grants no primitive. Independent of (and collected
    // alongside) the class check above: a step can be both the wrong class
    // AND carrying work, and both reds should surface.
    if (matches.length === 1 && matches[0].primitives.length > 0) {
      const stepIdx = stepInfo.indexOf(matches[0]);
      reds.push(`declaration: ask at line ${n} (steps[${stepIdx}]) is a stop only — granting primitive(s) `
        + `[${matches[0].primitives.join(', ')}] is work, which belongs on its own line`);
    }
  }
  // (b) no step, anywhere, grants "checkpoint" — that belongs to the runner.
  stepInfo.forEach((st, i) => {
    if (st.primitives.includes('checkpoint')) {
      reds.push(`declaration: steps[${i}] (line ${st.fromLine}) grants "checkpoint" — the pause belongs to the runner, never the drafter`);
    }
  });
  // (c) no pause (zero primitives AND effective class hitl) at an unsigned line.
  const signedAskLines = new Set(askLines);
  stepInfo.forEach((st, i) => {
    const isSignedAskLine = st.fromLine !== null && signedAskLines.has(st.fromLine);
    if (st.primitives.length === 0 && st.effectiveClass === 'hitl' && !isSignedAskLine) {
      reds.push(`declaration: steps[${i}] (line ${st.fromLine}) is a pause (no primitives, hitl) at an unsigned line`);
    }
  });

  // --- THE SEND LOCK (ported from poc/m0/validator.mjs@288cb8a, the block
  // "THE SEND LOCK (M0b Part 1...)" around lines 573-634) — a mechanism, not
  // wording (F21/F24: a lock is typed grants, never wording). Generalised
  // from M0b's single ask/send slot to M1's arrays (`arbiter.asks[]`,
  // `arbiter.sends[]`): every signed slot is checked, not just the last one.
  //
  // (a) every signed ask/send line must be a real numbered line. Redundant
  // with what parseSignedText already guarantees on its own arbiter — this
  // validator does not trust its caller either, same discipline as the rest
  // of this file.
  const lineNumbers = new Set(safeLines.map((l) => l.n));
  for (const n of askLines) {
    if (!lineNumbers.has(n)) reds.push(`declaration: signed ask at line ${n} does not name a real numbered line`);
  }
  for (const n of sendLines) {
    if (!lineNumbers.has(n)) reds.push(`declaration: signed send at line ${n} does not name a real numbered line`);
  }

  // (b) a signed ask or send line can never be refused.
  for (const n of askLines) {
    if (refusedLines.has(n)) reds.push(`declaration: line ${n} is the signed ask slot and cannot be refused`);
  }
  for (const n of sendLines) {
    if (refusedLines.has(n)) reds.push(`declaration: line ${n} is the signed send slot and cannot be refused`);
  }

  // (c)-(e) — the send step itself: exactly one step bound to it, granted a
  // catalogue primitive of class "write" (not hard-coded to the verb
  // "write" itself, per the coordinator's note — a catalogue is exactly the
  // place that vocabulary belongs), and reading the `emits` of at least one
  // ask step at a strictly earlier signed ask line.
  for (const n of sendLines) {
    const matches = stepInfo.map((st, i) => ({ st, i })).filter((x) => x.st.fromLine === n);
    if (matches.length === 0) {
      reds.push(`declaration: send at line ${n} has no step bound to it`);
      continue;
    }
    if (matches.length >= 2) {
      reds.push(`declaration: send at line ${n} has ${matches.length} steps bound to it (steps[${matches.map((m) => m.i).join(', ')}]) — exactly 1 required`);
      continue;
    }
    const { st: sendStep, i: sendIdx } = matches[0];

    const hasWrite = sendStep.primitives.some((verb) => catalogueByVerb.get(verb)?.class === 'write');
    if (!hasWrite) {
      reds.push(`declaration: send at line ${n} (steps[${sendIdx}]) is not granted a catalogue primitive of class "write"`);
    }

    const earlierAskLines = askLines.filter((a) => a < n);
    if (earlierAskLines.length === 0) {
      reds.push(`declaration: send at line ${n} (steps[${sendIdx}]) has no signed ask at an earlier line to read from`);
    } else {
      const earlierAskEmits = earlierAskLines
        .map((a) => stepInfo.find((st) => st.fromLine === a))
        .filter((st) => st !== undefined)
        .map((st) => st.emits);
      const readsAnAsk = earlierAskEmits.some((emits) => emits !== null && sendStep.reads.includes(emits));
      if (!readsAnAsk) {
        reds.push(`declaration: send at line ${n} (steps[${sendIdx}]) does not read the emits of any earlier signed `
          + `ask step (asks at lines ${earlierAskLines.join(', ')})`);
      }
    }
  }

  // --- check 6: every numbered line must be served or refused, never dropped
  const claimedLines = new Set(stepInfo.map((st) => st.fromLine).filter((n) => Number.isInteger(n)));
  for (const line of safeLines) {
    if (!claimedLines.has(line.n) && !refusedLines.has(line.n)) {
      reds.push(`declaration: job line ${line.n} ("${line.text}") is neither served by any step's fromLine nor refused with a reason`);
    }
  }

  if (reds.length > 0) return deepFreeze({ ok: false, reds });

  const classes = {};
  stepInfo.forEach((st) => {
    if (st.emits !== null) classes[st.emits] = st.effectiveClass;
  });
  return deepFreeze({ ok: true, classes });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
