// M0b Job #2 — the resume/JD job (Amendment B, docs/wiki/the-module-ladder.md
// ~108-119; ladder Amendment A for the redo edge, ~84-97). This is job #2's
// OWN fold, honestly hard-wired to job #2's shape — generalising a fold
// across arbitrary declarations is M2's job, not this one (see runner.mjs's
// own JOB1_FIXED_STAGE_LINES comment for the same discipline on job #1).
//
// NO drafter round here: there is no declaration with `steps`/`primitives`
// to bind against (that machinery — validate()/bindSteps()/checkGrants() in
// runner.mjs — is job #1-shaped, keyed to a drafted declaration's `fromLine`
// fields). This fold reads the human's PROSE directly and binds its own
// stages from it, by KIND, never by position:
//   - `ask`/`send` lines and the send target come from the SIGNED arbiter
//     slots (`parseArbiterSlots`, validator.mjs) — refused if either slot
//     is missing, exactly like runner.mjs's preflight.
//   - the $ cap comes from the arbiter's own "cap $X per run" line
//     (`parseArbiterGuardrails`) — refused if missing, or if it asks for
//     MORE than the signed ceiling `RUN_CAP_USD` (spend.mjs) — tighten-only.
//   - the COMPOSE line is the human's job line immediately BEFORE the ask
//     line (never a text match on the guardrail's wording — see F16/F17,
//     the whole reason the 1-for-1 line<->guardrail model exists).
//   - the two READ lines are every job line before the compose line, in
//     order (resume, then JD) — there must be exactly two, else refused
//     naming the count. This is deliberately non-positional: it holds
//     regardless of what line numbers the ask/send slots actually name, or
//     whether the human's numbering has gaps.
//
// hamr's real job #2 prose does not exist yet — he writes it himself, cold
// (Amendment B). `fixtures/job2.prose.example.txt` is a stand-in with the
// content this task's brief specified, named as an example so nobody
// mistakes it for the real thing later.
//
// Reused from runner.mjs/spend.mjs/provider.mjs/redo.mjs/validator.mjs
// (imported, never copied — see each import below); NOT reused:
// runner.mjs's `preflight`/`bindSteps`/`checkGrants`/`validate()`, all of
// which assume a drafted declaration this task explicitly has none of.

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Checkpoint } from 'bare-agent';
import {
  OUT_DIR, checkFreshRunDir, freezeInputs, checkSendDestination,
  runModelStepOnPrimitives, readFrozenText, sendViaPrimitive,
} from './runner.mjs';
import { checkStepHappened } from './mechanical.mjs';
import { assertUnderGlobalCap, RUN_CAP_USD } from './spend.mjs';
import {
  parseLines, parseArbiterSlots, parseArbiterGuardrails, validate,
} from './validator.mjs';
import { readDocxText } from './docx.mjs';
import { closeWordsAndSections } from './shape.mjs';
import { askWithRedo } from './redo.mjs';

const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');

/**
 * The declared softgreen shape for job #2's compose step. hamr's own cold
 * prose (`job2.prose.raw.txt`, verbatim): "...summary of work histry blurb,
 * professional skills, soft skills, 3 sections all under 600 words/200ish
 * each". His words win (Claim 2 evidence must be his words) — the sections
 * below are those three headings ("histry" corrected to "history" for the
 * heading text the model must emit), not the ladder's paraphrase this
 * constant used to carry. Signed data, a typed constant — NOT parsed from
 * the human's prose (see `job2.prose.raw.txt`, untouched). The prose's own
 * guardrail text on the compose line is there for the MODEL to read as an
 * instruction; this fold never regexes it to derive the check itself, same
 * discipline job #1's closeCompose/closeDerive already hold (the close's
 * numbers are code, not prose-mined). "200ish each" is guidance carried in
 * the prose to the model, not a check — a per-section word limit would be a
 * NEW check hamr has not signed.
 */
export const JOB2_SHAPE = Object.freeze({
  maxWords: 600,
  sections: Object.freeze(['summary of work history', 'professional skills', 'soft skills']),
});

const CAP_LINE_RE = /^cap\s+\$([0-9]+(?:\.[0-9]+)?)\s+per\s+run$/i;

// ---------------------------------------------------------------------------
// BINDING — by kind, never by position. See header for the rules.
// ---------------------------------------------------------------------------

/**
 * Bind job #2's stages from the raw prose text. Returns
 * `{ ok:true, arbiterSlots, capUsd, readLines:[resumeLine,jdLine], composeLine }`
 * or `{ ok:false, red }`. Never touches the filesystem or a model.
 */
export function bindJob2Stages(proseText) {
  const jobLines = parseLines(proseText);
  const { slots: arbiterSlots, errors: arbiterErrors } = parseArbiterSlots(proseText);
  if (arbiterErrors.length > 0) {
    return { ok: false, red: `bind: ${arbiterErrors[0]}` };
  }
  if (!arbiterSlots.ask || !arbiterSlots.send) {
    return { ok: false, red: 'bind: prose carries no signed ask/send arbiter slots — cannot bind job #2\'s fold to it' };
  }

  const composeLineNumber = arbiterSlots.ask.line - 1;
  const composeLine = jobLines.find((l) => l.n === composeLineNumber);
  if (!composeLine) {
    return {
      ok: false,
      red: `bind: no job line ${composeLineNumber} (immediately before the signed ask line ${arbiterSlots.ask.line}) to bind the compose step to`,
    };
  }

  const readLines = jobLines.filter((l) => l.n < composeLine.n).sort((a, b) => a.n - b.n);
  if (readLines.length !== 2) {
    return {
      ok: false,
      red: `bind: expected 2 read lines before the compose line (line ${composeLine.n}), found ${readLines.length}`,
    };
  }

  const arbiterLines = parseArbiterGuardrails(proseText);
  const capMatch = arbiterLines.map((l) => CAP_LINE_RE.exec(l.trim())).find(Boolean);
  if (!capMatch) {
    return { ok: false, red: 'bind: no "cap $X per run" arbiter guardrail found' };
  }
  const capUsd = Number(capMatch[1]);
  if (!(capUsd <= RUN_CAP_USD)) {
    return {
      ok: false,
      red: `bind: cap $${capUsd} exceeds the signed per-run ceiling $${RUN_CAP_USD} (tighten-only, never loosen)`,
    };
  }

  return {
    ok: true, arbiterSlots, capUsd, readLines, composeLine,
  };
}

/**
 * Full preflight, first-red-wins, $0, no model call: bind -> fresh run dir
 * -> freeze inputs -> send destination -> global spend cap. Mirrors
 * runner.mjs's `preflight` order for the same reasons, on job #2's own
 * binding instead of a drafted declaration's.
 */
export function preflightJob2(proseText, { runDir, sources, spendPath = SPEND_PATH }) {
  const bound = bindJob2Stages(proseText);
  if (!bound.ok) return bound;

  const freshRunDir = checkFreshRunDir(runDir);
  if (!freshRunDir.ok) return freshRunDir;

  const frozen = freezeInputs(runDir, sources);
  if (!frozen.ok) return frozen;

  const destination = checkSendDestination(bound.arbiterSlots.send.target);
  if (!destination.ok) return destination;

  try {
    assertUnderGlobalCap(spendPath);
  } catch (err) {
    return { ok: false, red: `cap: ${err.message}` };
  }

  return {
    ok: true, ...bound, inputsManifest: frozen.manifest, sendDir: destination.dir,
  };
}

// ---------------------------------------------------------------------------
// DECLARATION-DRIVEN BINDING (Claim 2 — the fold obeys the drafter's own
// declaration instead of guessing stages from position). `bindJob2Stages`
// above still does the LINE-LEVEL half from the prose alone (which line
// number is the compose line, the two read lines, the signed ask/send
// slots) — that fact does not change just because a declaration now exists.
// What follows is the NEW half: resolving each of those line numbers to the
// ONE step a DRAFTED declaration names via `fromLine`, and checking that
// step's grants — mirrors runner.mjs's `bindSteps`/`checkGrants` (M0b Part
// 2.1) exactly, on job #2's own five stage names instead of job #1's fixed
// JOB1_FIXED_STAGE_LINES.
// ---------------------------------------------------------------------------

/**
 * Resolve job #2's five stages from a drafted declaration's `fromLine`
 * fields, given the line numbers `bindJob2Stages` already worked out from
 * the prose. A line with 0 or 2+ steps bound to it refuses, naming the line
 * and the count — never picks one (same discipline as runner.mjs's
 * `bindSteps`).
 */
export function bindJob2DeclarationSteps(declaration, bound) {
  const lineByStage = {
    readResume: bound.readLines[0].n,
    readJd: bound.readLines[1].n,
    compose: bound.composeLine.n,
    ask: bound.arbiterSlots.ask.line,
    send: bound.arbiterSlots.send.line,
  };
  const stages = {};
  for (const [stage, lineNumber] of Object.entries(lineByStage)) {
    const matches = (declaration?.steps ?? []).filter((st) => st?.fromLine === lineNumber);
    if (matches.length !== 1) {
      return {
        ok: false,
        red: `bind: line ${lineNumber} (stage "${stage}") has ${matches.length} step(s) bound to it — exactly 1 required`,
      };
    }
    [stages[stage]] = matches;
  }
  return { ok: true, stages };
}

// Grants — job #2's own version of runner.mjs's GRANT_REQUIREMENTS/
// checkGrants: a stage may only run using primitives its bound step was
// actually granted, checked before any model round (the compose round is
// the only paid one, and it runs strictly after this). `compose` needs NO
// primitive grant — it is our own model round + declared-shape close, the
// same footing as job #1's "match a customer, derive figures" JOB1_NEEDS
// row (`own: true`, catalogue.mjs), never a catalogue primitive. `ask` uses
// Checkpoint with no grant check either, same as job #1: its POSITION is
// arbiter (the human-signed slot), never the drafter's primitive list to
// prove. Job #1's `checkGrants` never reds on an EXTRA grant beyond what's
// required (it only checks the required verbs are present) — this follows
// that precedent rather than adding a least-privilege "no extra grants"
// check job #1 itself does not enforce, so job #2 does not silently hold a
// stricter bar than job #1 for the same kind of step.
const JOB2_GRANT_REQUIREMENTS = Object.freeze([
  ['readResume', Object.freeze(['readDocx'])],
  ['readJd', Object.freeze(['read'])],
  ['send', Object.freeze(['write'])],
]);

export function checkJob2Grants(stages) {
  for (const [stage, verbs] of JOB2_GRANT_REQUIREMENTS) {
    const step = stages[stage];
    for (const verb of verbs) {
      if (!Array.isArray(step?.primitives) || !step.primitives.includes(verb)) {
        return {
          ok: false,
          red: `grants: step for line ${step?.fromLine} (stage "${stage}") is not granted "${verb}"`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Full DECLARATION-DRIVEN preflight — same order as `preflightJob2`
 * (bind lines -> fresh run dir -> freeze -> bind declaration steps -> grants
 * -> send destination -> global spend cap), mirroring runner.mjs's own
 * `preflight` ordering (validate -> freeze -> bind -> grants -> destination
 * -> cap) with job #2's line-level bind standing in for job #1's `validate`.
 */
export function preflightJob2FromDeclaration(declaration, proseText, { runDir, sources, spendPath = SPEND_PATH }) {
  // Mirrors runner.mjs's `preflight`: validate() first, $0, before anything
  // filesystem- or model-shaped even runs — proves the declaration's own
  // walkable chain (validator.mjs, unmodified for job #2, see its header)
  // before this function's job #2-specific binding/grants even start.
  const validated = validate(declaration);
  if (validated.verdict !== 'green') {
    return { ok: false, red: validated.red };
  }

  const bound = bindJob2Stages(proseText);
  if (!bound.ok) return bound;

  const freshRunDir = checkFreshRunDir(runDir);
  if (!freshRunDir.ok) return freshRunDir;

  const frozen = freezeInputs(runDir, sources);
  if (!frozen.ok) return frozen;

  const declBound = bindJob2DeclarationSteps(declaration, bound);
  if (!declBound.ok) return declBound;

  const granted = checkJob2Grants(declBound.stages);
  if (!granted.ok) return granted;

  const destination = checkSendDestination(bound.arbiterSlots.send.target);
  if (!destination.ok) return destination;

  try {
    assertUnderGlobalCap(spendPath);
  } catch (err) {
    return { ok: false, red: `cap: ${err.message}` };
  }

  return {
    ok: true, ...bound, stages: declBound.stages, inputsManifest: frozen.manifest, sendDir: destination.dir,
  };
}

// ---------------------------------------------------------------------------
// COMPOSE — the only paid step, wrapped in askWithRedo (Amendment A).
// ---------------------------------------------------------------------------

function buildComposeSystemPrompt({
  composeLine, reason, resumeText, jdText,
}) {
  let prompt = 'You are the fwdloop runner executing ONE step of job #2 (M0b Amendment B). '
    + `Step goal (verbatim, prose line ${composeLine.n}): ${composeLine.text}\n`
    + `Guardrail (verbatim): ${composeLine.guardrail}\n`;
  if (reason) {
    prompt += `The human rejected the previous attempt with this reason: ${reason}\n`;
  }
  prompt += `\nResume text:\n${resumeText}\n\nJob description text:\n${jdText}\n\n`
    + `Write the summary now as plain text with EXACTLY these three section headings, each on `
    + `its own line, in this order: "${JOB2_SHAPE.sections.join('", "')}". Stay under `
    + `${JOB2_SHAPE.maxWords} words total, counting every word including the headings. `
    + 'Answer ONLY by calling emit_summary.';
  return prompt;
}

/**
 * The default (real) compose attempt: one model round via
 * `runModelStepOnPrimitives` (runner.mjs's own metering/retry/ledger
 * machinery — not duplicated here), writing the reply to
 * `<runDir>/a3-summary.attempt<n>.md` and recording a `{stage:'compose',
 * attempt, args, reply}` entry via the caller's `record` (the single log.json
 * writer lives in `runJob2`, never a second one here).
 */
function makeDefaultModelStep({
  runId, slot, model, spendPath, runDir, composeLine, resumeText, jdText, record,
}) {
  return async function defaultComposeAttempt(n, reason) {
    const systemPrompt = buildComposeSystemPrompt({
      composeLine, reason, resumeText, jdText,
    });
    const result = await runModelStepOnPrimitives({
      runId,
      stepLabel: 'compose',
      slot,
      model,
      spendPath,
      systemPrompt,
      userContent: 'Call emit_summary now.',
      toolName: 'emit_summary',
      toolDescription: 'Report the resume/JD summary text (three sections, under 600 words).',
      toolSchema: {
        type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
      },
    });
    if (!result.ok) return { ok: false, red: result.red };

    const happened = checkStepHappened({ goal: 'compose: resume/JD summary', close: { class: 'softgreen' } }, result.args.text);
    if (happened.verdict === 'red') return { ok: false, red: happened.red };

    const artifactPath = join(runDir, `a3-summary.attempt${n}.md`);
    writeFileSync(artifactPath, result.args.text);
    record({
      stage: 'compose', attempt: n, args: result.args, reply: result.args.text,
    });
    return { ok: true, artifactPath, costUsd: result.metered.costUsd };
  };
}

/**
 * The default (real) `close` for `askWithRedo`: the $0 declared-shape check
 * (shape.mjs), against JOB2_SHAPE, never against text mined from the prose.
 */
function closeStage(artifactPath) {
  const text = readFileSync(artifactPath, 'utf8');
  return closeWordsAndSections(text, { maxWords: JOB2_SHAPE.maxWords, sections: JOB2_SHAPE.sections });
}

/**
 * The default (real) `ask` for `askWithRedo`, on `bare-agent`'s `Checkpoint`
 * — same ask.json/answer.json file protocol runner.mjs's `checkpointAsk`
 * uses, but NOT that function itself: `checkpointAsk`'s contract hard-reds a
 * `rerun` decision (Amendment A was explicitly out of its scope), which is
 * exactly the decision this fold must accept. The question text carries the
 * attempt number and artifact path so hamr can open it before answering.
 */
// An answer is consumed EXACTLY ONCE (F-review, job2 redo edge): each call to
// `defaultAskStep` (one per ask — including the re-ask `askWithRedo` issues
// for the SAME attempt after a reason-less rerun is refused) mints its own
// `askedAt` and, the moment it reads `answer.json`, renames it out of the way
// before returning — so the NEXT poll (next attempt, or a re-ask of this same
// attempt) can only ever see a file written after this ask started. Belt and
// braces: any `answer.json` whose own `answeredAt` predates this ask's
// `askedAt` is treated as stale even if it's sitting there fresh-looking
// (e.g. written between two asks by mistake) — quarantined the same way and
// logged to `auditPath` as `{kind:'stale-answer-ignored'}` rather than acted
// on. `checkFreshRunDir` (runner.mjs) already refuses a pre-existing
// `answer.json` at run START; this covers the mid-run case that check can't
// see.
function appendJsonl(auditPath, row) {
  mkdirSync(join(auditPath, '..'), { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify(row)}\n`);
}

function makeDefaultAskStep({
  runDir, runId, askTimeoutMs, auditPath,
}) {
  let askSeq = 0;
  return async function defaultAskStep(n, artifactPath) {
    mkdirSync(runDir, { recursive: true });
    const askPath = join(runDir, 'ask.json');
    const answerPath = join(runDir, 'answer.json');
    askSeq += 1;
    const seq = askSeq;
    const askedAtMs = Date.now();
    const askedAtIso = new Date(askedAtMs).toISOString();
    const state = { cancelled: false };
    const checkpoint = new Checkpoint({
      timeout: askTimeoutMs,
      send: async (q, context) => {
        writeFileSync(askPath, JSON.stringify({ question: q, evidence: context, askedAt: askedAtIso }, null, 2));
        process.stderr.write(`ASK OPEN (${runId}, attempt ${n}, expires in ${Math.round(askTimeoutMs / 1000)}s): ${q} — `
          + `answer with: node poc/m0/answer.mjs ${runId} accept (or rerun with a reason)\n`);
      },
      waitForReply: async () => {
        while (!state.cancelled) {
          if (existsSync(answerPath)) {
            let raw;
            try {
              raw = readFileSync(answerPath, 'utf8');
            } catch {
              // Vanished between existsSync and readFileSync (another reader
              // won the race) — keep polling for the next write.
              raw = null;
            }
            if (raw !== null) {
              let parsed = null;
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = null;
              }
              const answeredAtMs = parsed?.answeredAt ? Date.parse(parsed.answeredAt) : NaN;
              const isStale = Number.isFinite(answeredAtMs) && answeredAtMs < askedAtMs;
              if (isStale) {
                const stalePath = join(runDir, `answer.stale.attempt${n}.${seq}.${Date.now()}.json`);
                try {
                  renameSync(answerPath, stalePath);
                } catch {
                  // Already moved by a racing consumer — nothing to ignore.
                }
                if (auditPath) {
                  appendJsonl(auditPath, {
                    kind: 'stale-answer-ignored',
                    attempt: n,
                    askedAt: askedAtIso,
                    staleAnsweredAt: parsed?.answeredAt ?? null,
                    movedTo: stalePath,
                    at: new Date().toISOString(),
                    runDir,
                  });
                }
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => { setTimeout(r, 500); });
                // eslint-disable-next-line no-continue
                continue;
              }
              // Fresh reply — consume it once: rename it away BEFORE
              // returning, so a later poll (next attempt, or a re-ask of
              // this attempt) never reads it again.
              const consumedPath = join(runDir, `answer.attempt${n}.${seq}.consumed.json`);
              renameSync(answerPath, consumedPath);
              return raw;
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => { setTimeout(r, 500); });
        }
        return null;
      },
    });
    const question = `Attempt ${n} summary drafted — accept, or reject with a reason? Artifact: ${artifactPath}`;
    let raw;
    try {
      raw = await checkpoint.ask(question, { artifactPath, attempt: n });
    } catch (err) {
      if (err?.name === 'TimeoutError') {
        const e = new Error(`ask expired at compose attempt ${n}`);
        e.red = e.message;
        throw e;
      }
      throw err;
    } finally {
      state.cancelled = true;
    }
    const answer = JSON.parse(raw);
    return { decision: answer.decision, text: answer.text ?? null };
  };
}

/**
 * The default (real) send: re-checks the destination right before writing
 * (the runner's own send allow-list is job #1-shaped — mechanical.mjs's
 * `send()` — so this re-runs `checkSendDestination` a second time here,
 * per the brief, rather than reusing that job #1-only allow-list), then
 * writes through `sendViaPrimitive` (shell_write + the mechanical happened
 * check — not a second bespoke fs call).
 */
async function defaultSendStep(target, filename, content) {
  const destination = checkSendDestination(target);
  if (!destination.ok) return destination;
  return sendViaPrimitive(destination.dir, filename, content);
}

// ---------------------------------------------------------------------------
// THE FOLD.
// ---------------------------------------------------------------------------

export async function runJob2({
  prosePath, sources, runId, outDir, spendPath = SPEND_PATH, slot, model,
  redoCap = 3, modelStep, askStep, sendStep, askTimeoutMs = 120_000,
  declaration,
}) {
  const runDir = outDir ?? join(OUT_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  const proseText = readFileSync(prosePath, 'utf8');

  // `declaration` may be an already-parsed object (tests, programmatic
  // callers) or a path to a JSON file (the CLI's `--declaration <path>`) —
  // one accepted shape, resolved once, here. Either shape may itself be a
  // drafter REPORT (`{modelRequested, ..., declaration: {...}}`) rather than
  // a bare declaration — unwrap exactly like runner.mjs's CLI does
  // (`raw.declaration ?? raw`), so a report-wrapped file loads the same way
  // in both places.
  const declarationRaw = declaration === undefined
    ? null
    : (typeof declaration === 'string' ? JSON.parse(readFileSync(declaration, 'utf8')) : declaration);
  const declarationObj = declarationRaw != null ? (declarationRaw.declaration ?? declarationRaw) : declarationRaw;
  const bound = declarationObj != null ? 'declaration' : 'prose';

  const logEntries = [];
  const record = (entry) => { logEntries.push(entry); };
  const writeLog = () => writeFileSync(join(runDir, 'log.json'), JSON.stringify({ runId, stages: logEntries }, null, 2));
  const finish = (outcome, phase, red, extra = {}) => {
    writeLog();
    const result = {
      outcome, phase: phase ?? null, red: red ?? null, bound, ...extra,
    };
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  };

  // Claim 2 (PRD): with a declaration, the fold binds its stages from the
  // DRAFTER's own `fromLine`s and checks grants before any model round —
  // never guesses from position. Without one (prose-only path, `--no-drafter`),
  // stages bind by KIND from the prose alone, exactly as before this task.
  const pre = declarationObj != null
    ? preflightJob2FromDeclaration(declarationObj, proseText, { runDir, sources, spendPath })
    : preflightJob2(proseText, { runDir, sources, spendPath });
  if (!pre.ok) {
    record({ stage: 'preflight', outcome: 'red', red: pre.red, bound });
    return finish('red', 'preflight', pre.red);
  }
  record({ stage: 'preflight', outcome: 'green', bound });

  const { inputsManifest, arbiterSlots } = pre;
  const bySourceId = Object.fromEntries(inputsManifest.map((m) => [m.id, m]));

  // --- readResume ---
  const resumeRead = readDocxText(bySourceId.resume.frozen);
  if (!resumeRead.ok) {
    record({ stage: 'readResume', outcome: 'red', red: resumeRead.red });
    return finish('red', 'readResume', resumeRead.red);
  }
  const happenedResume = checkStepHappened({ goal: 'readResume', close: { class: 'green' } }, resumeRead.text);
  if (happenedResume.verdict === 'red') {
    record({ stage: 'readResume', outcome: 'red', red: happenedResume.red });
    return finish('red', 'readResume', happenedResume.red);
  }
  writeFileSync(join(runDir, 'a1-resume.txt'), resumeRead.text);
  record({ stage: 'readResume', outcome: 'green' });

  // --- readJd ---
  const jdRead = await readFrozenText(bySourceId.jd, {});
  if (!jdRead.ok) {
    record({ stage: 'readJd', outcome: 'red', red: jdRead.red });
    return finish('red', 'readJd', jdRead.red);
  }
  const happenedJd = checkStepHappened({ goal: 'readJd', close: { class: 'green' } }, jdRead.text);
  if (happenedJd.verdict === 'red') {
    record({ stage: 'readJd', outcome: 'red', red: happenedJd.red });
    return finish('red', 'readJd', happenedJd.red);
  }
  writeFileSync(join(runDir, 'a2-jd.txt'), jdRead.text);
  record({ stage: 'readJd', outcome: 'green' });

  // --- compose (the only paid step), inside the redo edge ---
  const auditPath = join(runDir, 'audit.jsonl');
  const resolvedModelStep = modelStep ?? makeDefaultModelStep({
    runId,
    slot,
    model,
    spendPath,
    runDir,
    composeLine: pre.composeLine,
    resumeText: resumeRead.text,
    jdText: jdRead.text,
    record,
  });
  const resolvedAskStep = askStep ?? makeDefaultAskStep({
    runDir, runId, askTimeoutMs, auditPath,
  });

  let redoResult;
  try {
    redoResult = await askWithRedo({
      runDir,
      stepName: 'compose',
      attempt: resolvedModelStep,
      ask: resolvedAskStep,
      close: closeStage,
      redoCap,
      auditPath,
    });
  } catch (err) {
    record({ stage: 'compose', outcome: 'red', red: err.red ?? err.message });
    return finish('red', 'compose', err.red ?? err.message);
  }
  if (!redoResult.ok) {
    record({ stage: 'compose', outcome: 'red', red: redoResult.red });
    return finish('red', 'compose', redoResult.red);
  }
  record({ stage: 'compose', outcome: 'green', attempts: redoResult.attempts });

  // --- send ---
  const acceptedText = readFileSync(redoResult.artifactPath, 'utf8');
  const resolvedSendStep = sendStep ?? defaultSendStep;
  const sendResult = await resolvedSendStep(arbiterSlots.send.target, `${runId}-summary.md`, acceptedText);
  if (!sendResult.ok) {
    record({ stage: 'send', outcome: 'red', red: sendResult.red });
    return finish('red', 'send', sendResult.red);
  }
  record({ stage: 'send', outcome: 'green', path: sendResult.path });

  writeLog();
  const result = {
    outcome: 'green',
    phase: null,
    bound,
    attempts: redoResult.attempts,
    costUsd: redoResult.costUsd,
    costUnknown: redoResult.costUnknown,
    sent: sendResult.path,
  };
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point.
//
// LIVE, opt-in only, never run under `npm test` — the full Claim-2 pipeline,
// draft for real then run the fold on the drafted declaration:
//
//   SCOUT_LIVE=1 node poc/m0/scout.mjs --job2 --resume <resume.docx> \
//     --jd <jd.md> > /tmp/facts.json   # $0, no model round — see scout.mjs
//
//   DRAFTER_LIVE=1 node poc/m0/drafter.mjs <model-id> --job2 \
//     --prose <prose.txt> --resume <resume.docx> --jd <jd.md> \
//     --slot deepseek   # one paid round; writes poc/m0/out/draft-*.json
//
//   # pull the "declaration" field out of that draft-*.json into its own
//   # file (e.g. with `jq .declaration`), then validate it ($0):
//   node -e "import('./poc/m0/validator.mjs').then(({validate}) => \
//     console.log(validate(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')))))" \
//     /tmp/declaration.json
//
//   node poc/m0/job2.mjs --prose <prose.txt> --resume <resume.docx> \
//     --jd <jd.md> --slot deepseek --declaration /tmp/declaration.json
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const prosePath = get('--prose');
  const resumePath = get('--resume');
  const jdPath = get('--jd');
  const slot = get('--slot');
  const model = get('--model');
  const runId = get('--run-id') ?? `job2-${slot}-${Date.now()}`;
  const askTimeoutMs = get('--ask-timeout-ms') !== undefined ? Number(get('--ask-timeout-ms')) : 120_000;
  const declarationPath = get('--declaration');
  const noDrafter = args.includes('--no-drafter');

  if (!prosePath || !resumePath || !jdPath || !['deepseek', 'synthetic'].includes(slot)) {
    console.error('usage: node poc/m0/job2.mjs --prose <path> --resume <docx> --jd <md> --slot deepseek|synthetic '
      + '[--model <id>] [--run-id <id>] [--ask-timeout-ms N] (--declaration <path.json> | --no-drafter)');
    process.exit(1);
  }
  // Claim 2 (PRD §go/no-go): a counting run must bind through the drafter's
  // own declaration, never guess stages from position — so the CLI REFUSES
  // to run without `--declaration` unless `--no-drafter` is passed
  // explicitly, naming the choice, rather than silently falling back to the
  // prose-only path (which stays available for tests and for this one
  // named opt-out).
  if (!declarationPath && !noDrafter) {
    console.error('refusing: no --declaration given — pass --declaration <path.json> (a drafted, validated job #2 '
      + 'declaration) or explicitly --no-drafter to run the prose-only binding (never the silent default).');
    process.exit(1);
  }

  console.log(`RUN_ID=${runId}`);
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId,
    slot,
    model,
    askTimeoutMs,
    declaration: declarationPath,
  });

  try {
    const manifest = JSON.parse(readFileSync(join(OUT_DIR, runId, 'inputs.json'), 'utf8'));
    for (const m of manifest) console.log(`FROZEN ${m.id}: sha256 ${m.sha256} (${m.frozen})`);
  } catch {
    // preflight refused before freezeInputs ever ran — nothing to print.
  }

  console.log(JSON.stringify({
    runId, outcome: result.outcome, phase: result.phase ?? null, red: result.red ?? null,
  }, null, 2));
  process.exit(result.outcome === 'green' ? 0 : 1);
}
