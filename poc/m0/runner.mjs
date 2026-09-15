// Part 2 — RUNNER. Executes a drafter declaration as a fold over steps (PRD
// §5 "Run = a fold over steps"). Each step runs in a FRESH Loop/messages
// array carrying only its goal line + the prior steps' compact artifacts —
// never a shared transcript. Mechanical steps (`gather`/`ask`/`send`) use
// mechanical.mjs, zero model calls. Model steps (`derive`/`compose`) call
// the model with ONE tool whose input schema is the citation schema plus
// the step's own output fields; close.mjs is the $0 deterministic close
// that decides green/red — first red wins, ends the run.
//
// Standing rules for every model round (M0 continuation brief, 2026-09-08):
//   - maxTokens 16000 always.
//   - stopReason 'max_tokens' (bare-agent's neutral name for OpenAI's raw
//     `finish_reason: 'length'`, see provider-stop-reason.js) -> red
//     "truncated: <outputTokens> tokens, no tool call". Never "no tool call"
//     alone — that phrase is reserved for a FINISHED round with no call.
//   - A FINISHED round (stopReason != 'max_tokens') with no tool call:
//     retry once; twice in a row on the SAME step is a STOP-AND-REPORT
//     condition, not a red the runner can quietly resolve.
//   - Provider 502/503/524 (or any retryable transport error): one retry,
//     then red "provider-red: <message>".
//   - Never tool_choice, never patch node_modules, never widen close.mjs to
//     turn a red green.
//
// Usage:
//   SYNTHETIC_API_KEY="$(pass show amr/synthetic_api | head -1)" \
//     node poc/m0/runner.mjs <model-id> --plant a|b|c|d [--run-id <id>] [--ask-timeout-ms N]

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync, accessSync, constants as fsConstants,
} from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Loop, Checkpoint } from 'bare-agent';
import { OpenAI } from 'bare-agent/providers';
import { createShellTools } from 'bare-agent/tools';
import {
  gather, ask, send, checkStepHappened,
} from './mechanical.mjs';
import {
  closeDerive, closeCompose, closeCustomerMatch, hashFile, matchingCustomers,
} from './close.mjs';
import { parseCsv } from './csv.mjs';
import {
  assertUnderGlobalCap, appendSpendRow, sumMeterings, RUN_CAP_USD,
} from './spend.mjs';
import { resolveModelRate, makeProvider } from './provider.mjs';
import { validate, parseArbiterSlots } from './validator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');
const SYNTHETIC_BASE_URL = 'https://api.synthetic.new/openai/v1';
export const BUSINESS_DATE = '2026-06-01'; // the run's explicit "as of today" — never the wall clock (PRD §5).

/** A model round that finished (stopReason != 'max_tokens') but emitted no tool call, twice on the same step. */
export class StopAndReportError extends Error {
  constructor(message) { super(message); this.name = 'StopAndReportError'; }
}

// ---------------------------------------------------------------------------
// Artifact rendering — compact, inline content for a model round (never a
// transcript). CSV rows carry row numbers + column letters; text carries
// line numbers, matching the runner brief exactly.
// ---------------------------------------------------------------------------

export function renderCsvArtifact(artifact) {
  const header = artifact.header.map((name, i) => `${String.fromCharCode(65 + i)}=${name}`).join(' ');
  const lines = artifact.rows.map((r) => {
    const cells = Object.entries(r.cells).map(([col, val]) => `${col}=${val}`).join(' ');
    return `Row ${r.rowNumber}: ${cells}`;
  });
  return `CSV artifact "${artifact.id}" (sha256 ${artifact.sha256}). Header: ${header}\n${lines.join('\n')}`;
}

export function renderTextArtifact(artifact) {
  const lines = artifact.lines.map((l, i) => `Line ${i + 1}: ${l}`);
  return `Text artifact "${artifact.id}" (sha256 ${artifact.sha256}).\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Citation schema (PRD §5) — one JSON Schema object reused across every
// model tool's `citations` field. Not JSON Schema $ref (bare-agent passes
// tool.parameters straight through as a plain object); shared by reference.
// ---------------------------------------------------------------------------

const CITATION_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'short id, e.g. c1' },
    value: { description: 'REQUIRED for copied and derived forms (omit only for a text-evidence/quote citation): the number, date (YYYY-MM-DD), or exact text' },
    asStated: { type: 'string', description: 'copied form only: the value as it literally appears' },
    formula: { type: 'string', enum: ['sum', 'count', 'min', 'max', 'sub', 'daysBetween'], description: 'derived form only' },
    inputs: { type: 'array', items: { type: 'string' }, description: 'derived form only: citation ids the formula runs over' },
    quote: { type: 'string', description: 'text-evidence form only: verbatim substring of the pointed line' },
    source: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['csv', 'text'] },
        artifact: { type: 'string' },
        row: { type: 'number' },
        col: { type: 'string' },
        cell: { type: 'string', description: 'csv only, e.g. E2' },
        line: { type: 'number', description: 'text only, 1-based' },
      },
      required: ['kind', 'artifact'],
    },
  },
  required: ['id'],
};

const CLOSED_GRAMMAR_NOTE = 'Closed formula grammar: sum, count, min, max, sub, daysBetween — no expression '
  + 'evaluation. A COPIED figure needs value (the number/date/text — REQUIRED, not just asStated) + '
  + 'source.cell (csv) or source.quote+source.line (text). A DERIVED figure needs value + formula + inputs '
  + '(citation ids already in your own citations array) — no source. A TEXT-EVIDENCE citation needs quote + '
  + 'source.line, no value. Every citation MUST be exactly one of these three forms — never mix value with '
  + 'quote, never omit value from a copied or derived citation. Numbers compare stripped of commas/$; dates '
  + 'compare as ISO strings; a quote must be a verbatim substring of the pointed line.';

// ---------------------------------------------------------------------------
// M0b PART 2.1 — PREFLIGHT (2026-09-13). Everything below runs at $0, before
// any model call: load -> validate() (Part 1's send lock included) -> freeze
// inputs -> bind steps to declaration lines -> check grants -> check the
// send destination -> assertUnderGlobalCap. Every function here returns
// { ok: true, ... } or { ok: false, red } — never throws — mirroring
// validate()'s own contract, so a caller can chain checks without a
// try/catch per step. This is the NEW declaration-driven path; it does not
// yet replace runDeclaration below (the F5 bespoke fold) — that replacement
// is 2.2/2.3's job, landing in later commits.
// ---------------------------------------------------------------------------

/**
 * Freeze — copy each named source into `<runDir>/inputs/`, hash the FROZEN
 * copy (never the original again after this), and write `inputs.json`.
 * Every later read must read the frozen copy only (PRD: "both fixtures are
 * frozen and hashed at job start and every step reads the frozen copy").
 * `sources` is `[{ id, path }]`. An unreadable source refuses by name.
 */
export function freezeInputs(runDir, sources) {
  const inputsDir = join(runDir, 'inputs');
  mkdirSync(inputsDir, { recursive: true });
  const manifest = [];
  for (const { id, path: sourcePath } of sources) {
    if (!existsSync(sourcePath)) {
      return { ok: false, red: `freeze: input "${id}" is unreadable at ${sourcePath}` };
    }
    const frozenPath = join(inputsDir, `${id}${extname(sourcePath)}`);
    copyFileSync(sourcePath, frozenPath);
    const sha256 = hashFile(frozenPath);
    const { size: bytes } = statSync(frozenPath);
    manifest.push({ id, source: sourcePath, frozen: frozenPath, sha256, bytes });
  }
  writeFileSync(join(runDir, 'inputs.json'), JSON.stringify(manifest, null, 2));
  return { ok: true, manifest };
}

// job #1's fold stages, each bound to exactly ONE of the human's numbered
// lines (PRD/M0b brief): sheet read = line 1, message read + customer match
// = line 2, derive = line 3, compose = line 4. The ask/send stages bind to
// whatever line the SIGNED arbiter slots name (validator.mjs's
// parseArbiterSlots) — never hard-coded to 5/6 a second time, one writer.
const JOB1_FIXED_STAGE_LINES = Object.freeze({
  sheetRead: 1, messageMatch: 2, derive: 3, compose: 4,
});

/**
 * Bind — find the ONE step each stage's line names. A line with 0 steps or
 * 2+ steps refuses, naming the line and the count (never picks one).
 */
export function bindSteps(declaration, arbiterSlots) {
  const lineByStage = {
    ...JOB1_FIXED_STAGE_LINES,
    ask: arbiterSlots?.ask?.line,
    send: arbiterSlots?.send?.line,
  };
  const stages = {};
  for (const [stage, lineNumber] of Object.entries(lineByStage)) {
    if (!Number.isInteger(lineNumber)) {
      return { ok: false, red: `bind: no signed line number for stage "${stage}"` };
    }
    const matches = (declaration.steps ?? []).filter((st) => st.fromLine === lineNumber);
    if (matches.length !== 1) {
      return {
        ok: false,
        red: `bind: line ${lineNumber} (stage "${stage}") has ${matches.length} step(s) bound to it — exactly 1 required`,
      };
    }
    stages[stage] = matches[0];
  }
  return { ok: true, stages };
}

// Grants — a stage may only call a primitive its bound step was granted.
// The ask stage uses Checkpoint with NO grant check: its position is
// arbiter (the human signed it), never the drafter's primitive list to prove.
const GRANT_REQUIREMENTS = Object.freeze([
  ['sheetRead', Object.freeze(['addressCells'])],
  ['messageMatch', Object.freeze(['read'])],
  ['send', Object.freeze(['write'])],
]);

export function checkGrants(stages) {
  for (const [stage, verbs] of GRANT_REQUIREMENTS) {
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

/** Destination — the send slot's target directory must exist and be writable. */
export function checkSendDestination(target) {
  const match = /^file:(.+)$/.exec(target ?? '');
  if (!match) {
    return { ok: false, red: `destination: send target "${target}" is not a "file:<path>" target` };
  }
  const dir = join(REPO_ROOT, match[1]);
  try {
    accessSync(dir, fsConstants.W_OK);
  } catch (err) {
    return { ok: false, red: `destination: send target directory "${dir}" is not writable (${err.code})` };
  }
  return { ok: true, dir };
}

/**
 * Fresh run dir (FIX 3, 2026-09-13 live run): a run dir that already holds
 * `ask.json` or `answer.json` from an EARLIER run is a stale-answer hazard —
 * a new run reusing that `--run-id` would have `checkpointAsk` see the old
 * `answer.json` and treat it as an instant accept, sending something the
 * human never actually saw THIS run. Refuses at $0, before freeze — never
 * silently proceeds, never deletes or edits the offending file.
 */
export function checkFreshRunDir(runDir) {
  for (const file of ['ask.json', 'answer.json']) {
    if (existsSync(join(runDir, file))) {
      return {
        ok: false,
        red: `preflight: run dir ${runDir} already holds ${file} from an earlier run — use a new --run-id`,
      };
    }
  }
  return { ok: true };
}

/**
 * The full preflight, in the brief's order: validate() (Part 1's send lock
 * included) -> freeze -> bind -> grants -> destination -> global spend cap.
 * First red wins, exactly like validate() itself. Never calls a model, never
 * appends a spend row — every check here is read-only against the
 * declaration, the filesystem and the existing spend ledger.
 */
export function preflight(declaration, { runDir, sources, spendPath = SPEND_PATH } = {}) {
  const validated = validate(declaration);
  if (validated.verdict !== 'green') {
    return { ok: false, red: validated.red };
  }

  const { slots: arbiterSlots, errors } = parseArbiterSlots(declaration.guardrails);
  if (errors.length > 0) {
    return { ok: false, red: `preflight: ${errors[0]}` };
  }
  if (!arbiterSlots.ask || !arbiterSlots.send) {
    return { ok: false, red: 'preflight: declaration carries no signed ask/send arbiter slots — cannot bind a primitive-driven run to it' };
  }

  const freshRunDir = checkFreshRunDir(runDir);
  if (!freshRunDir.ok) return freshRunDir;

  const frozen = freezeInputs(runDir, sources);
  if (!frozen.ok) return frozen;

  const bound = bindSteps(declaration, arbiterSlots);
  if (!bound.ok) return bound;

  const granted = checkGrants(bound.stages);
  if (!granted.ok) return granted;

  const destination = checkSendDestination(arbiterSlots.send.target);
  if (!destination.ok) return destination;

  try {
    assertUnderGlobalCap(spendPath);
  } catch (err) {
    return { ok: false, red: `cap: ${err.message}` };
  }

  return {
    ok: true, stages: bound.stages, inputsManifest: frozen.manifest, arbiterSlots, sendDir: destination.dir,
  };
}

/**
 * The primitive-driven run's entry point. `modelStep`/`askStep`/`sendStep`
 * are injected (defaulting to the real primitive-backed functions below) so
 * a test can run the REAL fold — preflight, binding, both derive stages,
 * compose, the ask, the send — at $0 with a stub model and a stub ask, per
 * M0b Part 2.3. On any preflight refusal, modelStep is never called and no
 * spend row is appended (proven in the 2.1 tests above).
 */
export async function runOnPrimitives({
  declaration, runId, outDir, sources, spendPath = SPEND_PATH, plant = 'd',
  slot, model, askTimeoutMs = 120_000,
  modelStep = runModelStepOnPrimitives, askStep = checkpointAsk, sendStep = sendViaPrimitive,
}) {
  const runDir = outDir ?? join(OUT_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  // Plant (c): the ambiguous-customer fixture is generated BEFORE freezing,
  // so its own bytes (not the clean fixture's) are what gets frozen and
  // hashed — the ambiguity is real input, never a check-time special case.
  let effectiveSources = sources;
  if (plant === 'c') {
    const sheetSource = sources.find((s) => s.id === 'sheet');
    const plantedPath = generatePlantCCsv(sheetSource.path, join(runDir, 'ar-aging.plant-c.csv'));
    effectiveSources = sources.map((s) => (s.id === 'sheet' ? { ...s, path: plantedPath } : s));
  }

  const pre = preflight(declaration, { runDir, sources: effectiveSources, spendPath });
  if (!pre.ok) {
    return { outcome: 'red', red: pre.red, phase: 'preflight' };
  }
  const { stages, inputsManifest, sendDir } = pre;
  const bySourceId = Object.fromEntries(inputsManifest.map((m) => [m.id, m]));

  const log = { runId, plant, stages: {} };
  const record = (stage, outcome, extra = {}) => { log.stages[stage] = { outcome, ...extra }; };

  // Everything below runs inside one closure so `result` below is the SAME object every branch
  // returns (red at any stage, paused-ask-*, complete) — the single writer for `<runDir>/log.json`
  // sits right after this closure, once, rather than at each of its ~15 internal returns (F28's
  // gap: a red run kept nothing but the red string, so a compose bracket miss could never be told
  // apart from closeCompose misreading a label).
  const result = await (async () => {
  // --- sheetRead (line 1) ---
  const csvArtifact = await readFrozenCsv(stages.sheetRead.emits, bySourceId.sheet);
  if (!csvArtifact.ok) { record('sheetRead', 'red', { red: csvArtifact.red }); return { outcome: 'red', red: csvArtifact.red, phase: 'sheetRead', log }; }
  record('sheetRead', 'green');
  const artifacts = { [stages.sheetRead.emits]: csvArtifact };

  // --- messageMatch (line 2): mechanical read, then a model step for the match itself ---
  const messageArtifact = await readFrozenTextArtifact('message-raw', bySourceId.message);
  if (!messageArtifact.ok) { record('messageMatch', 'red', { red: messageArtifact.red }); return { outcome: 'red', red: messageArtifact.red, phase: 'messageMatch', log }; }
  artifacts['message-raw'] = messageArtifact;

  const derive1SystemPrompt = `You are the fwdloop runner executing ONE step of a signed declaration. `
    + `Step goal: match the customer named in the message to the row(s) in the sheet whose Customer cell `
    + `names them. ${CLOSED_GRAMMAR_NOTE} A name match is a QUOTE citation (verbatim substring of the `
    + `message line) plus a COPIED citation for EVERY Customer cell that matches — if more than one row `
    + `could match, cite ALL of them and list ALL their citation ids in "matches"; do not pick one. `
    + `businessDate is ${BUSINESS_DATE} (never use today's real date). Answer ONLY by calling emit_customer_match.`;
  const derive1User = `${renderCsvArtifact(csvArtifact)}\n\n${renderTextArtifact(messageArtifact)}\n\n`
    + `Call emit_customer_match now.`;

  const derive1 = await modelStep({
    runId, stepLabel: 'messageMatch', slot, model, spendPath,
    systemPrompt: derive1SystemPrompt, userContent: derive1User,
    toolName: 'emit_customer_match',
    toolDescription: 'Report the quote + matching Customer cell citation(s) for the message.',
    toolSchema: {
      type: 'object',
      properties: {
        citations: { type: 'array', items: CITATION_ITEM_SCHEMA },
        matches: { type: 'array', items: { type: 'string' }, description: 'citation ids of the matching Customer cell(s)' },
      },
      required: ['citations', 'matches'],
    },
  });
  if (!derive1.ok) { record('messageMatch', 'red', { red: derive1.red, args: null }); return { outcome: 'red', red: derive1.red, phase: 'messageMatch', log }; }

  const happened1 = checkStepHappened({ goal: 'messageMatch', close: { class: 'green' } }, derive1.args.citations);
  if (happened1.verdict === 'red') { record('messageMatch', 'red', { red: happened1.red, args: derive1.args }); return { outcome: 'red', red: happened1.red, phase: 'messageMatch', log }; }

  const close1 = closeCustomerMatch(derive1.args, artifacts, stages.sheetRead.emits);
  if (close1.verdict === 'red') { record('messageMatch', 'red', { red: close1.red, args: derive1.args }); return { outcome: 'red', red: close1.red, phase: 'messageMatch', log }; }

  if (close1.ambiguous) {
    // PRD §5 / plant c: two rows matching is an ask, never a pick — route here instead of derive.
    const question = `More than one customer matches: ${close1.groundTruthMatches.join(', ')}. Which one?`;
    const evidence = { citations: derive1.args.citations, groundTruthMatches: close1.groundTruthMatches };
    const askResult = await askStep(question, evidence, { outDir: runDir, timeoutMs: askTimeoutMs, runId });
    record('messageMatch', askResult.ok && askResult.accepted ? 'paused-ask-answered' : 'red', { red: askResult.red ?? null, args: derive1.args });
    return {
      outcome: askResult.ok && askResult.accepted ? 'paused-ask-answered' : 'red',
      red: askResult.ok ? (askResult.accepted ? null : 'run stopped at the customer-ambiguity ask') : askResult.red,
      phase: 'messageMatch-ambiguous',
      log,
    };
  }
  record('messageMatch', 'green', { args: derive1.args });

  const customer = close1.matchedCustomer;
  const customerRows = csvArtifact.rows.filter((r) => r.byName.Customer === customer);
  artifacts[stages.messageMatch.emits] = { id: stages.messageMatch.emits, kind: 'derived', citations: derive1.args.citations };

  // --- derive (line 3) ---
  const derive2SystemPrompt = `You are the fwdloop runner executing ONE step of a signed declaration. `
    + `Step goal: for customer "${customer}" (rows already matched — do not re-derive the match), list every `
    + `open invoice's Invoice # as a COPIED citation (value = the Invoice # cell's text, e.g. "INV-1009") AND `
    + `its Amount as a separate COPIED citation, a "total_owed" DERIVED citation (formula sum, inputs = every `
    + `Amount citation id), an "earliest_due" citation naming the row whose Due date is earliest (copy that `
    + `cell — the closed grammar's min/max compare numbers, not dates, so express earliest-due as a copied `
    + `citation on the correct cell, not a formula), and a "count_overdue" DERIVED citation (formula count, `
    + `inputs = one daysBetween DERIVED citation per invoice whose due date is overdue, i.e. `
    + `daysBetween(due date, businessDate) > 0 — businessDate is ${BUSINESS_DATE}, put every invoice's `
    + `daysBetween citation in your citations array regardless, but only the OVERDUE ones' ids in count_overdue's `
    + `inputs). A daysBetween citation takes EXACTLY ONE input: the due-date citation id. businessDate is `
    + `IMPLICIT — it is never cited, never given its own citation, and never a second daysBetween input; it is `
    + `not part of any artifact, so there is nothing to cite it against. ${CLOSED_GRAMMAR_NOTE} Return `
    + `output.fields = {"total_owed": "<citation id>", `
    + `"earliest_due": "<citation id>", "count_overdue": "<citation id>"}. Answer ONLY by calling emit_derive.`;
  const derive2User = `${renderCsvArtifact(csvArtifact)}\n\nMatched customer: ${customer}. Their rows: `
    + `${customerRows.map((r) => `row ${r.rowNumber} (${r.byName['Invoice #']})`).join(', ')}.\n\n`
    + `Call emit_derive now.`;

  const derive2 = await modelStep({
    runId, stepLabel: 'derive', slot, model, spendPath,
    systemPrompt: derive2SystemPrompt, userContent: derive2User,
    toolName: 'emit_derive',
    toolDescription: 'Report the invoices/total/earliest-due/overdue-count citations for the matched customer.',
    toolSchema: {
      type: 'object',
      properties: {
        citations: { type: 'array', items: CITATION_ITEM_SCHEMA },
        fields: {
          type: 'object',
          properties: {
            total_owed: { type: 'string' }, earliest_due: { type: 'string' }, count_overdue: { type: 'string' },
          },
          required: ['total_owed', 'earliest_due', 'count_overdue'],
        },
      },
      required: ['citations', 'fields'],
    },
  });
  if (!derive2.ok) { record('derive', 'red', { red: derive2.red, args: null }); return { outcome: 'red', red: derive2.red, phase: 'derive', log }; }

  const happened2 = checkStepHappened({ goal: 'derive', close: { class: 'green' } }, derive2.args.citations);
  if (happened2.verdict === 'red') { record('derive', 'red', { red: happened2.red, args: derive2.args }); return { outcome: 'red', red: happened2.red, phase: 'derive', log }; }

  // Plants a/b mutate the model's OUTPUT before the close, never the check (existing applyPlant,
  // unchanged — F5's plants a/b must still red on primitives, per this brief's negative i).
  const derive2ArgsForClose = applyPlant(plant, 'derive2', derive2.args);
  const close2 = closeDerive(derive2ArgsForClose, artifacts, BUSINESS_DATE);
  if (close2.verdict === 'red') { record('derive', 'red', { red: close2.red, args: derive2.args }); return { outcome: 'red', red: close2.red, phase: 'derive', log }; }
  record('derive', 'green', { args: derive2.args });
  artifacts[stages.derive.emits] = { id: stages.derive.emits, kind: 'derived', ...derive2ArgsForClose };

  // --- compose (line 4) ---
  const composeSystemPrompt = `You are the fwdloop runner executing ONE step of a signed declaration. `
    + `Step goal: write a short reply, one line per invoice, to the message "${messageArtifact.lines[0]}". `
    + `Every figure in the text must be a citation bracket like [c3] placed with NOTHING between the number and `
    + `the bracket — e.g. "12[c7] days overdue" or "12 [c7] days overdue", never "12 days [c7]" (the bracket `
    + `must sit immediately after the number itself, not after trailing words) — no bare (uncited) numbers `
    + `anywhere in the text, including list markers: never write "Invoice 1:", "Invoice 2:" etc as a bare `
    + `ordinal — use the invoice number instead. EVERY invoice number you write (e.g. "INV-1009") is exactly `
    + `as much a citation as a figure: it MUST carry its own bracket immediately after it, e.g. "INV-1009[c2]", `
    + `citing the SAME COPIED Invoice # citation "Prior citations" gives you for that row — never invent an `
    + `invoice number and never write one with no bracket. A plain digit or identifier `
    + `with no citation bracket is read as an uncited figure regardless of what it's labelling. Your citations `
    + `array MUST include EVERY citation object from `
    + `"Prior citations" below VERBATIM AND UNCHANGED, in full — do not drop any, even ones you don't bracket `
    + `directly in the text (a formula citation like count/sum/daysBetween needs every citation id in its own `
    + `"inputs" to ALSO be present in the array, or the evidence check cannot resolve it) — plus anything new `
    + `you need. ${CLOSED_GRAMMAR_NOTE} Answer ONLY by calling emit_compose.`;
  const composeUser = `Prior citations for ${customer}:\n${JSON.stringify(derive2.args.citations, null, 2)}\n\n`
    + `Fields: ${JSON.stringify(derive2.args.fields)}\n\nCall emit_compose now.`;

  const compose = await modelStep({
    runId, stepLabel: 'compose', slot, model, spendPath,
    systemPrompt: composeSystemPrompt, userContent: composeUser,
    toolName: 'emit_compose',
    toolDescription: 'Report the reply text with every figure in a citation bracket.',
    toolSchema: {
      type: 'object',
      properties: {
        citations: { type: 'array', items: CITATION_ITEM_SCHEMA },
        text: { type: 'string' },
      },
      required: ['citations', 'text'],
    },
  });
  if (!compose.ok) { record('compose', 'red', { red: compose.red, args: null }); return { outcome: 'red', red: compose.red, phase: 'compose', log }; }

  const happened3 = checkStepHappened({ goal: 'compose', close: { class: 'softgreen' } }, compose.args.text);
  if (happened3.verdict === 'red') { record('compose', 'red', { red: happened3.red, args: compose.args }); return { outcome: 'red', red: happened3.red, phase: 'compose', log }; }

  // Plant e (NEW, F7 green-by-omission): strip the total/earliest-due FIGURES and their citation
  // brackets from the composed text before the close — mutating the model's OUTPUT, never the
  // check, exactly like plants a/b above.
  const composeTextForClose = plant === 'e'
    ? applyPlantE(compose.args.text, derive2ArgsForClose.fields)
    : compose.args.text;
  const close3 = closeCompose(
    { ...compose.args, text: composeTextForClose }, artifacts, BUSINESS_DATE, derive2ArgsForClose.fields, derive2ArgsForClose.citations,
  );
  if (close3.verdict === 'red') { record('compose', 'red', { red: close3.red, plantApplied: plant === 'e' ? 'e' : null, args: compose.args }); return { outcome: 'red', red: close3.red, phase: 'compose', log }; }
  record('compose', 'green', { args: compose.args });

  // --- ask (the signed ask slot line) ---
  const finalAskResult = await askStep('Reply drafted — ok to send?', { text: compose.args.text }, { outDir: runDir, timeoutMs: askTimeoutMs, runId });
  if (!finalAskResult.ok) { record('ask', 'red', { red: finalAskResult.red }); return { outcome: 'red', red: finalAskResult.red, phase: 'ask', log }; }
  if (!finalAskResult.accepted) { record('ask', 'red', { red: 'ask not accepted' }); return { outcome: 'red', red: 'ask not accepted', phase: 'ask', log }; }
  record('ask', 'green');

  // --- send (the signed send slot line) ---
  const sendResult = await sendStep(sendDir, `${runId}-sent.txt`, compose.args.text);
  if (!sendResult.ok) { record('send', 'red', { red: sendResult.red }); return { outcome: 'red', red: sendResult.red, phase: 'send', log }; }
  record('send', 'green');

  return {
    outcome: 'complete', deliveryId: sendResult.path, log,
  };
  })();

  // Single writer for the debug log (F28): every outcome above returns through `result` here,
  // so this is the ONE place `<runDir>/log.json` is written, on every outcome (red at any stage,
  // paused-ask-*, complete). `runDir` was mkdir'd during preflight above, so it always exists by
  // this point — a preflight refusal returns before `log`/`result` even exist and never reaches
  // here, which is the one case this debug log does not cover.
  writeFileSync(join(runDir, 'log.json'), JSON.stringify({
    runId, outcome: result.outcome, phase: result.phase ?? null, red: result.red ?? null, stages: log.stages,
  }, null, 2));

  return result;
}

// ---------------------------------------------------------------------------
// M0b PART 2.2 — PRIMITIVES DO THE I/O (2026-09-13). Every read, ask and
// write below goes through a real baresuite primitive — never a second,
// bespoke fs call standing in for one. The model is never handed these
// tools directly (PRD-signed decision, M0b brief: "inside a step the LLM is
// the wiring" — tools-in-the-loop would add rounds and variance F5 never
// had); the RUNNER calls each tool's own `execute` directly.
// ---------------------------------------------------------------------------

const { tools: SHELL_TOOLS } = createShellTools();
const shellTool = (name) => {
  const found = SHELL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`M0b primitives: bare-agent/tools does not export a "${name}" tool`);
  return found;
};

/**
 * Read a frozen input through `shell_read` (never a second `readFileSync`
 * standing in for it) and prove the bytes that came back are the SAME bytes
 * `freezeInputs` hashed — never trust a read that silently truncated.
 * `frozenEntry` is one row of `freezeInputs`'s manifest ({ frozen, sha256 }).
 * Red, naming the file, when: the re-hash mismatches, OR the text carries
 * bare-agent's own `[truncated: … more bytes not shown]` notice (a
 * truncated read must never be parsed as though it were a complete row).
 */
export async function readFrozenText(frozenEntry, { maxBytes } = {}) {
  const text = await shellTool('shell_read').execute({ path: frozenEntry.frozen, maxBytes });
  if (/\[truncated: \d+ more bytes not shown\]/.test(text)) {
    return { ok: false, red: `read: "${frozenEntry.frozen}" was truncated by shell_read — never parsed as a complete row` };
  }
  const actualSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  if (actualSha256 !== frozenEntry.sha256) {
    return {
      ok: false,
      red: `read: "${frozenEntry.frozen}" re-hashed to ${actualSha256}, the frozen manifest recorded ${frozenEntry.sha256} — the bytes read do not match what was frozen`,
    };
  }
  return { ok: true, text };
}

/** A frozen CSV, read through shell_read then parsed via `addressCells`'s own `parseCsv` — the artifact id is the bound step's `emits`, never a hand-picked "a1"/"a2". */
export async function readFrozenCsv(emitsId, frozenEntry, opts) {
  const read = await readFrozenText(frozenEntry, opts);
  if (!read.ok) return read;
  const { header, rows } = parseCsv(read.text);
  return {
    ok: true, id: emitsId, kind: 'csv', path: frozenEntry.frozen, sha256: frozenEntry.sha256, header, rows,
  };
}

/** A frozen text file, read through shell_read — same id-and-hash discipline as `readFrozenCsv`. */
export async function readFrozenTextArtifact(emitsId, frozenEntry, opts) {
  const read = await readFrozenText(frozenEntry, opts);
  if (!read.ok) return read;
  const lines = read.text.split(/\r?\n/).filter((l) => l.length > 0);
  return {
    ok: true, id: emitsId, kind: 'text', path: frozenEntry.frozen, sha256: frozenEntry.sha256, lines,
  };
}

/**
 * The ask stage, on `bare-agent`'s `Checkpoint` — never a hand-rolled poll
 * loop a second time. `send` writes `ask.json`, `waitForReply` polls
 * `answer.json`, the SAME file protocol `mechanical.mjs`'s `ask()` and
 * `answer.mjs` already use (one writer for the file shape; Checkpoint is
 * the new caller). A `TimeoutError` reds "ask expired". `answer.decision`
 * of anything but `'accept'`/`'reject'` — in particular a redo/`rerun`
 * request — reds naming it: the redo edge is Amendment A, explicitly OUT of
 * this brief's scope, never silently implemented here.
 */
export async function checkpointAsk(question, evidence, {
  outDir, timeoutMs = 120_000, pollMs = 500, runId,
  writeLine = (line) => { process.stderr.write(`${line}\n`); },
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const askPath = join(outDir, 'ask.json');
  const answerPath = join(outDir, 'answer.json');
  // `cancelled` stops the poll loop the instant checkpoint.ask() settles (timeout OR answer) —
  // without it, a TIMED-OUT ask's waitForReply keeps scheduling setTimeout forever in the
  // background (a live timer node --test will wait on), hanging the whole process after every
  // test has otherwise finished.
  const state = { cancelled: false };
  const checkpoint = new Checkpoint({
    timeout: timeoutMs,
    send: async (q, context) => {
      writeFileSync(askPath, JSON.stringify({ question: q, evidence: context, askedAt: new Date().toISOString() }, null, 2));
      // Hamr's first two live asks both expired: checkpointAsk wrote ask.json and polled in
      // silence, so a human in another terminal had no way to know a run was waiting on them.
      // `writeLine` is injectable (never a global console spy) so a test can prove this without
      // capturing real stderr.
      writeLine(`ASK OPEN (${runId}, expires in ${Math.round(timeoutMs / 1000)}s): ${q} — `
        + `answer with: node poc/m0/answer.mjs ${runId} accept`);
    },
    waitForReply: async () => {
      while (!state.cancelled) {
        if (existsSync(answerPath)) return readFileSync(answerPath, 'utf8');
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return null;
    },
  });
  let raw;
  try {
    raw = await checkpoint.ask(question, evidence);
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, red: 'ask expired' };
    throw err;
  } finally {
    state.cancelled = true;
  }
  const answer = JSON.parse(raw);
  // answer.mjs's real protocol: decision is 'accept' or 'rerun' — there is
  // no 'reject' today. 'rerun' is the redo edge (Amendment A), explicitly
  // OUT of this brief's scope — reds naming it rather than silently
  // implementing a redo, and never treated as a plain refusal either.
  if (answer.decision === 'accept') return { ok: true, accepted: true, answer };
  if (answer.decision === 'rerun') {
    return { ok: false, red: 'ask: a "rerun" decision is Amendment A\'s redo edge, out of this brief\'s scope — not handled' };
  }
  return { ok: false, red: `ask: unrecognised decision "${answer.decision}"` };
}

/**
 * The send stage, on `shell_write` (never `writeFileSync` standing in for
 * it a second time). Only ever called after an accept THIS run. The
 * "happened" effect check reads the bytes ACTUALLY on disk afterwards —
 * never the in-memory content handed in — so a write that silently
 * truncates to 0 bytes reds here, not upstream.
 */
export async function sendViaPrimitive(dir, filename, content) {
  const path = join(dir, filename);
  await shellTool('shell_write').execute({ path, content });
  const bytes = readFileSync(path);
  const happened = checkStepHappened({ goal: 'send: deliver reply', close: { class: 'hitl' } }, bytes);
  if (happened.verdict === 'red') return { ok: false, red: happened.red, path };
  return { ok: true, path, bytes: bytes.byteLength };
}

/**
 * One model round on a provider SLOT (never a hand-rolled `new OpenAI(...)`
 * a second time — `makeProvider` is the one writer, brief 2.2). Meters
 * EVERY round via `sumMeterings` (F15's fix, applied here — the OLD
 * `runModelStep` below still carries the F15 bug: `metering = event`,
 * last-round-only) and writes one spend row with `rounds`, `modelReturned`,
 * `modelMatch` (via `appendSpendRow`'s own `classifyModelId` stamp).
 *
 * `provider`/`rates`/`modelId` are injectable (same pattern as
 * drafter.mjs's `runDrafter`) so a test can prove this function's own
 * retry/metering/spend-row wiring at $0 with a fake provider — never a
 * live model call. Production and the CLI always omit them, which builds
 * the real provider through `makeProvider(slot, ...)`, the one writer.
 *
 * Standing round rules (ported from the OLD `runModelStep` below, 2026-09-13
 * fix — this function had DROPPED them, which meant a live provider error
 * would throw straight out of `runOnPrimitives`, crash the run, and write NO
 * spend row at all): bare-agent's `Loop` defaults `throwOnError: true`
 * (`node_modules/bare-agent/src/loop.js` ~line 831), so `loop.run()` really
 * does throw the raw provider error — this is not a result-field surface.
 *   1. A retryable transport error (`err.retryable === true` or status
 *      502/503/524) on attempt 1 -> retry once. A second failure -> red
 *      `provider-red: <message>`.
 *   2. EVERY failed attempt appends a spend row carrying the error text.
 *      `costUsd` is `null` unless partial meterings arrived before the
 *      throw (a round can complete, get priced, and THEN a later round in
 *      the same `loop.run()` call throws — `onLlmResult` already captured
 *      the priced one) — sum those and keep the row's cost real; never the
 *      OLD code's "$0 asserted" shortcut, which F5 retired for exactly this
 *      reason (a request that left the machine has an UNKNOWN cost, and
 *      unknown is never rendered as 0).
 *   3. A FINISHED round (stopReason != 'max_tokens') with no tool call ->
 *      retry once. Twice in a row -> red naming the step, quoting the text.
 *   4. `stopReason === 'max_tokens'` -> immediate red, never retried.
 *   5. This function never throws for a model failure — always
 *      `{ ok: false, red }` — so `runOnPrimitives` never throws either.
 */
// F27 (2026-09-14): DeepSeek's `chat/completions` sent HTTP 200 + headers + one byte, then
// nothing — a "zombie stream". `timeoutMs`'s BA-18 idle bound resets on any socket byte, so it
// never trips on this shape; only CloudFront's own ~900s edge close ended it. `deadlineMs` is
// bare-agent's BA-19 TOTAL wall-clock ceiling, which does not reset on socket activity: 240s <
// 300s idle bound, so a hung request reds in 4 minutes, not 15. On trip it rejects with
// `code: 'EDEADLINE', retryable: false` — the `transportRetryable` check below is deliberately
// false for that code, so it is NOT retried (a retry would spend up to another full deadline on
// a request that has already proven it will never answer). Frozen + exported so the revert-proof
// test can assert on the live call's actual config, not a copy of these numbers.
export const LIVE_PROVIDER_OPTIONS = Object.freeze({ timeoutMs: 300_000, deadlineMs: 240_000 });

export async function runModelStepOnPrimitives({
  runId, stepLabel, slot, model, spendPath = SPEND_PATH, systemPrompt, userContent, toolName, toolDescription, toolSchema,
  provider: injectedProvider, rates: injectedRates, modelId: injectedModelId,
}) {
  const live = injectedProvider == null;
  let provider = injectedProvider;
  let rates = injectedRates;
  let modelId = injectedModelId;
  if (live) {
    assertUnderGlobalCap(spendPath);
    ({ provider, rates, modelId } = makeProvider(slot, { model, ...LIVE_PROVIDER_OPTIONS }));
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  let noToolCallStreak = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let capturedArgs = null;
    const tools = [{
      name: toolName,
      description: toolDescription,
      parameters: toolSchema,
      execute: async (args) => { capturedArgs = args; return { ok: true }; },
    }];
    const meterings = [];
    const loop = new Loop({ provider, rates, onLlmResult: async (event) => { meterings.push(event); } });

    const startedAt = Date.now();
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await loop.run(messages, tools, { maxTokens: 16000 });
    } catch (err) {
      const wallMs = Date.now() - startedAt;
      const transportRetryable = err?.retryable === true
        || err?.status === 502 || err?.status === 503 || err?.status === 524;
      // Rule 2 (corrected 2026-09-13): EVERY failed attempt gets a row — never skipped. `costUsd`
      // is ALWAYS null on a caught error: even when round 1 was priced for real, a LATER round in
      // the same attempt throwing means THAT round's request left the machine with an unknown
      // cost, and a known partial passed off as the attempt's cost understates spend — exactly
      // what sumMeterings' own doc forbids ("never a partial sum passed off as complete"). A
      // priced-looking row would also let assertUnderGlobalCap wave it through, which is wrong:
      // an attempt with any unpriced round must block further spend until a human reconciles it
      // (F5's rule), same as any other unknown-cost row. The known part (if any) is kept
      // separately in `knownPartialUsd` — informational, never fed to the cap.
      const partial = sumMeterings(meterings);
      appendSpendRow(spendPath, {
        runId, step: stepLabel, model: modelId, modelReturned: partial.model,
        tokens: partial.tokens, costUsd: null, knownPartialUsd: partial.costUsd, rounds: partial.rounds,
        rateSource: partial.rateSource, wallMs, error: err.message,
      });
      if (transportRetryable && attempt === 1) continue; // one retry, then red
      return { ok: false, red: `provider-red: ${err.message}` };
    }
    const wallMs = Date.now() - startedAt;

    // Written regardless of live/injected (unlike makeProvider/assertUnderGlobalCap above, which
    // only run live): a stub round still represents "a model round happened" for test purposes,
    // and the brief's own test ("a stub emitting 2 rounds -> the row sums both") reads this row
    // back. A test always supplies its own temp spendPath, so this never touches the real ledger.
    const metered = sumMeterings(meterings);
    appendSpendRow(spendPath, {
      runId, step: stepLabel, model: modelId, modelReturned: metered.model,
      tokens: metered.tokens, costUsd: metered.costUsd, rounds: metered.rounds,
      rateSource: metered.rateSource, wallMs, stopReason: result.stopReason ?? null,
    });

    if (result.stopReason === 'max_tokens') {
      // Rule 4: never retried — a truncated round is deterministic (the step needs fewer output
      // tokens or a bigger cap), not a transient fault a retry could fix.
      return { ok: false, red: `truncated: ${metered.tokens?.outputTokens ?? '?'} tokens, no tool call` };
    }

    if (capturedArgs == null) {
      noToolCallStreak += 1;
      // F28: `loop.run()`'s return is a fixed field set — it does not forward a round's
      // `malformedToolCall` extra field — so the ONE channel back is the provider instance itself
      // (`MalformedToolCallTolerantOpenAI` stashes it on `this`, reset every `generate()` call).
      // Reading it here, right after this attempt's `loop.run()`, tells "the model's arguments
      // were not valid JSON" apart from "the model just returned text" without changing the
      // retry-once-then-red shape below.
      const malformed = provider?.lastMalformedToolCall ?? null;
      if (noToolCallStreak >= 2) {
        if (malformed) {
          return {
            ok: false,
            red: `${stepLabel}: the tool call's arguments were not valid JSON twice in a row `
              + `(${malformed.error}); raw: ${malformed.rawArguments}`,
          };
        }
        return {
          ok: false,
          red: `${stepLabel}: a FINISHED round (stopReason=${result.stopReason}) returned text instead of the `
            + `tool twice in a row. Text: ${JSON.stringify(result.text)}`,
        };
      }
      continue; // retry once
    }

    return {
      ok: true, args: capturedArgs, metered, wallMs, stopReason: result.stopReason,
    };
  }
  // Unreachable under the 3-attempt ceiling given the logic above, but keep the contract explicit
  // (rule 5: never throw for a model failure).
  return { ok: false, red: `${stepLabel}: exhausted retries without a clean result` };
}

// ---------------------------------------------------------------------------
// One model round: fresh Loop, fresh messages, ONE tool. Retries per the
// standing rules above. Returns { args, metering, wallMs } or throws
// StopAndReportError / an Error carrying a `.red` gap string.
// ---------------------------------------------------------------------------

async function runModelStep({
  runId, stepLabel, modelId, apiKey, rates, systemPrompt, userContent, toolName, toolDescription, toolSchema,
}) {
  // timeoutMs bounds a silent/never-answering socket (BA-18). Without it explicitly set, a raw
  // socket-level failure (observed live: "read ETIMEDOUT" after 3045006ms — three million ms, well
  // past any sane wait) can hang far longer than the provider's documented 600000ms default appears
  // to actually enforce for this baseUrl. 300s is the orchestrator's ruling for M0's hard per-round cap.
  const provider = new OpenAI({ apiKey, model: modelId, baseUrl: SYNTHETIC_BASE_URL, timeoutMs: 300_000 });
  let noToolCallStreak = 0;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assertUnderGlobalCap(SPEND_PATH);

    let capturedArgs = null;
    const tools = [{
      name: toolName,
      description: toolDescription,
      parameters: toolSchema,
      execute: async (args) => { capturedArgs = args; return { ok: true }; },
    }];
    let metering = null;
    const loop = new Loop({ provider, rates, onLlmResult: async (event) => { metering = event; } });
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const startedAt = Date.now();
    let result;
    try {
      result = await loop.run(messages, tools, { maxTokens: 16000 });
    } catch (err) {
      const transportRetryable = err?.retryable === true
        || err?.status === 502 || err?.status === 503 || err?.status === 524;
      // A pre-response transport failure (connection reset, gateway timeout) never reached a
      // completed generation, so it carries no billed usage — logging it as costUsd:null would
      // trip spend.mjs's "unknown is never rendered as 0" guard and permanently block ALL further
      // spend for the rest of the session over a $0 event. Log costUsd:0 with a note explaining
      // why 0 is asserted (not defaulted), not null. On the FIRST such failure, retry once
      // silently without logging at all — nothing happened yet worth an audit row.
      if (transportRetryable && attempt === 1) continue; // one retry, then red
      appendSpendRow(SPEND_PATH, {
        runId, step: stepLabel, model: modelId, modelReturned: null, tokens: null,
        costUsd: transportRetryable ? 0 : null, rateSource: null, wallMs: Date.now() - startedAt,
        error: err.message,
        note: transportRetryable
          ? 'pre-response transport failure (no completion reached) — $0 asserted, not defaulted'
          : undefined,
      });
      const e = new Error(`provider-red: ${err.message}`);
      e.red = `provider-red: ${err.message}`;
      throw e;
    }
    const wallMs = Date.now() - startedAt;

    appendSpendRow(SPEND_PATH, {
      runId, step: stepLabel, model: modelId, modelReturned: metering?.model ?? null,
      tokens: metering?.usage ?? null, costUsd: metering?.costUsd ?? null,
      rateSource: metering?.rateSource ?? null, wallMs, stopReason: result.stopReason ?? null,
    });
    if (metering?.costUsd != null && metering.costUsd > RUN_CAP_USD) {
      console.error(`WARNING: ${stepLabel} round cost $${metering.costUsd} exceeds the per-run $${RUN_CAP_USD} cap`);
    }

    if (result.stopReason === 'max_tokens') {
      const e = new Error(`truncated: ${metering?.usage?.outputTokens ?? '?'} tokens, no tool call`);
      e.red = `truncated: ${metering?.usage?.outputTokens ?? '?'} tokens, no tool call`;
      throw e;
    }

    if (capturedArgs == null) {
      noToolCallStreak += 1;
      if (noToolCallStreak >= 2) {
        throw new StopAndReportError(
          `${stepLabel}: a FINISHED round (stopReason=${result.stopReason}) returned text instead of the `
          + `tool twice in a row. Text: ${JSON.stringify(result.text)}`,
        );
      }
      continue; // retry once
    }

    return { args: capturedArgs, metering, wallMs, stopReason: result.stopReason, attempt };
  }
  // Unreachable under the 3-attempt ceiling given the logic above, but keep the contract explicit.
  throw new StopAndReportError(`${stepLabel}: exhausted retries without a clean result`);
}

// ---------------------------------------------------------------------------
// Plant (c) fixture generation — from the fixture, never hand-edited
// (fixtures/README.md). Preserves the source file's CRLF line endings.
// ---------------------------------------------------------------------------

export function generatePlantCCsv(sourcePath, destPath) {
  const raw = readFileSync(sourcePath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const extraRow = 'Northwind Supplies,INV-1050,2026-06-01,2026-07-01,300,,,,,,';
  const withNewline = raw.endsWith(eol) ? raw : raw + eol;
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, withNewline + extraRow + eol);
  return destPath;
}

// ---------------------------------------------------------------------------
// Plant application — mutates the CAPTURED model output before the close,
// never the check (brief: "never the check"). Returns a new object; the
// original `args` from the model round is kept untouched in the run log.
// ---------------------------------------------------------------------------

export function applyPlant(plant, stepName, args) {
  if (!args || typeof args !== 'object') return args;
  const mutated = JSON.parse(JSON.stringify(args));
  if (plant === 'a' && stepName === 'derive2') {
    const sumCitation = (mutated.citations ?? []).find((c) => c.formula === 'sum');
    if (sumCitation) sumCitation.value = 5850;
  }
  if (plant === 'b' && stepName === 'derive2') {
    const e2 = (mutated.citations ?? []).find((c) => c.source?.cell === 'E2');
    if (e2) e2.value = 4300;
  }
  return mutated;
}

/**
 * Plant e (NEW, M0b Part 2.3, F7 green-by-omission) — strip the total_owed
 * and earliest_due FIGURES and their citation brackets out of the composed
 * TEXT before the close (never the check, never the citations array itself
 * — only the rendered words a human would read). This is the same class F7
 * found live in gpt-oss-120b's output: a reply that answers truthfully but
 * incompletely, omitting a field job #1's own line 3 declared. Matches
 * ONLY the exact citation id closeCompose's own `declaredFields` names —
 * it does not attempt to detect a re-cited duplicate value under a
 * different id (closeCompose's own completeness check already tolerates
 * that legitimately; this plant is not trying to defeat that leniency, it
 * is reproducing the omission F7 actually saw).
 */
export function applyPlantE(text, declaredFields) {
  if (typeof text !== 'string' || !declaredFields) return text;
  let mutated = text;
  for (const field of ['total_owed', 'earliest_due']) {
    const id = declaredFields[field];
    if (!id) continue;
    const bracketPattern = new RegExp(`(?:\\d{4}-\\d{2}-\\d{2}|[\\d,]+(?:\\.\\d+)?)\\s*\\[${id}\\]`, 'g');
    mutated = mutated.replace(bracketPattern, '');
  }
  return mutated;
}

// ---------------------------------------------------------------------------
// The fold. Loads a declaration (drafter output), runs gather -> derive#1 ->
// [ask if ambiguous] -> derive#2 -> compose -> ask -> send.
// ---------------------------------------------------------------------------

export async function runDeclaration({
  modelId, plant, runId, askTimeoutMs = 120_000, csvPath: csvPathOverride, apiKeyOverride,
  // Injected for tests only, so the fold-level happened() wiring can be proven with a $0 stub
  // instead of a live model call — production and the CLI always get the real runModelStep.
  modelStep = runModelStep,
  // Same, for send: lets a test force a 0-byte write through the real fold, so the send effect
  // check below can be proven to fail. Production and the CLI always get the real send.
  sendFn = send,
}) {
  const apiKey = apiKeyOverride ?? process.env.SYNTHETIC_API_KEY;
  if (!apiKey) throw new Error('SYNTHETIC_API_KEY is not set');
  // resolveModelRate (provider.mjs) is the ONE writer for this lookup — never a second
  // hand-rolled suffix-strip + table-lookup here.
  const { suffix, rates } = resolveModelRate(modelId);

  mkdirSync(OUT_DIR, { recursive: true });
  const outDir = join(OUT_DIR, runId);
  mkdirSync(outDir, { recursive: true });

  const log = { runId, modelId, plant, businessDate: BUSINESS_DATE, steps: [], findings: [] };
  const writeResult = (outcome, extra = {}) => {
    const result = { runId, modelId, plant, outcome, ...extra, log };
    writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  };

  // --- gather ---
  let csvSourcePath = csvPathOverride ?? join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
  if (plant === 'c' && !csvPathOverride) {
    csvSourcePath = generatePlantCCsv(
      join(REPO_ROOT, 'fixtures', 'ar-aging.csv'),
      join(outDir, 'ar-aging.plant-c.csv'),
    );
  }
  const messagePath = join(REPO_ROOT, 'fixtures', 'message.txt');

  const csvArtifact = { ...gather('a1', csvSourcePath, 'csv') };
  const messageArtifact = { ...gather('a2', messagePath, 'text') };
  log.steps.push({ step: 'gather', artifacts: ['a1', 'a2'] });
  const artifacts = { a1: csvArtifact, a2: messageArtifact };

  const provider = suffix; // for spend rows
  const modelSpendCtx = { modelId, apiKey, rates };

  // --- derive #1: customer match ---
  const derive1SystemPrompt = `You are the fwdloop runner executing ONE step of a signed declaration. `
    + `Step goal: match the customer named in the message to the row(s) in the sheet whose Customer cell `
    + `names them. ${CLOSED_GRAMMAR_NOTE} A name match is a QUOTE citation (verbatim substring of the `
    + `message line) plus a COPIED citation for EVERY Customer cell that matches — if more than one row `
    + `could match, cite ALL of them and list ALL their citation ids in "matches"; do not pick one. `
    + `businessDate is ${BUSINESS_DATE} (never use today's real date). Answer ONLY by calling emit_customer_match.`;
  const derive1User = `${renderCsvArtifact(csvArtifact)}\n\n${renderTextArtifact(messageArtifact)}\n\n`
    + `Call emit_customer_match now.`;

  let derive1;
  try {
    derive1 = await modelStep({
      runId, stepLabel: 'derive1', modelId, apiKey, rates,
      systemPrompt: derive1SystemPrompt, userContent: derive1User,
      toolName: 'emit_customer_match',
      toolDescription: 'Report the quote + matching Customer cell citation(s) for the message.',
      toolSchema: {
        type: 'object',
        properties: {
          citations: { type: 'array', items: CITATION_ITEM_SCHEMA },
          matches: { type: 'array', items: { type: 'string' }, description: 'citation ids of the matching Customer cell(s)' },
        },
        required: ['citations', 'matches'],
      },
    });
  } catch (err) {
    if (err instanceof StopAndReportError) throw err;
    log.steps.push({ step: 'derive1', outcome: 'red', red: err.red ?? err.message });
    return writeResult('red', { red: err.red ?? err.message });
  }

  // Bytes before meaning (ruling 3): derive1's artifact is its citations list — the evidence it
  // produced. Not the whole args object: happened() looks at the top level only, and an object is
  // never empty to it, so `{citations: [], matches: []}` would pass. closeCustomerMatch already reds
  // on empty citations, so this catches nothing new here; it is wired so every derive checks alike.
  const happened1 = checkStepHappened({ goal: 'derive1: customer match', close: { class: 'green' } }, derive1.args.citations);
  if (happened1.verdict === 'red') {
    log.steps.push({ step: 'derive1', outcome: 'red', red: happened1.red });
    return writeResult('red', { red: happened1.red });
  }

  const close1 = closeCustomerMatch(derive1.args, artifacts, 'a1');
  log.steps.push({
    step: 'derive1', outcome: close1.verdict, red: close1.red, ambiguous: close1.ambiguous,
    groundTruthMatches: close1.groundTruthMatches, args: derive1.args, wallMs: derive1.wallMs,
  });
  if (close1.verdict === 'red') return writeResult('red', { red: close1.red });

  if (close1.ambiguous) {
    // PRD §5: two rows matching is an ask, never a pick — route here instead of derive #2.
    const question = `More than one customer matches: ${close1.groundTruthMatches.join(', ')}. Which one?`;
    const evidence = { citations: derive1.args.citations, groundTruthMatches: close1.groundTruthMatches };
    const askResult = await ask(runId, question, evidence, { outDir, timeoutMs: askTimeoutMs });
    log.steps.push({ step: 'ask-ambiguous', outcome: askResult.verdict, red: askResult.red ?? null, answer: askResult.answer });
    return writeResult(askResult.verdict === 'green' ? 'paused-ask-answered' : 'red', {
      red: askResult.red ?? 'run stopped at the customer-ambiguity ask',
    });
  }

  const customer = close1.matchedCustomer;
  const customerRows = csvArtifact.rows.filter((r) => r.byName.Customer === customer);

  // --- derive #2: invoices, total, earliest due, count overdue ---
  const derive2SystemPrompt = `You are the fwdloop runner executing ONE step of a signed declaration. `
    + `Step goal: for customer "${customer}" (rows already matched — do not re-derive the match), list every `
    + `open invoice's Amount as a COPIED citation, a "total_owed" DERIVED citation (formula sum, inputs = every `
    + `Amount citation id), an "earliest_due" citation naming the row whose Due date is earliest (copy that `
    + `cell — the closed grammar's min/max compare numbers, not dates, so express earliest-due as a copied `
    + `citation on the correct cell, not a formula), and a "count_overdue" DERIVED citation (formula count, `
    + `inputs = one daysBetween DERIVED citation per invoice whose due date is overdue, i.e. `
    + `daysBetween(due date, businessDate) > 0 — businessDate is ${BUSINESS_DATE}, put every invoice's `
    + `daysBetween citation in your citations array regardless, but only the OVERDUE ones' ids in count_overdue's `
    + `inputs). A daysBetween citation takes EXACTLY ONE input: the due-date citation id. businessDate is `
    + `IMPLICIT — it is never cited, never given its own citation, and never a second daysBetween input; it is `
    + `not part of any artifact, so there is nothing to cite it against. ${CLOSED_GRAMMAR_NOTE} Return `
    + `output.fields = {"total_owed": "<citation id>", `
    + `"earliest_due": "<citation id>", "count_overdue": "<citation id>"}. Answer ONLY by calling emit_derive.`;
  const derive2User = `${renderCsvArtifact(csvArtifact)}\n\nMatched customer: ${customer}. Their rows: `
    + `${customerRows.map((r) => `row ${r.rowNumber} (${r.byName['Invoice #']})`).join(', ')}.\n\n`
    + `Call emit_derive now.`;

  let derive2;
  try {
    derive2 = await modelStep({
      runId, stepLabel: 'derive2', modelId, apiKey, rates,
      systemPrompt: derive2SystemPrompt, userContent: derive2User,
      toolName: 'emit_derive',
      toolDescription: 'Report the invoices/total/earliest-due/overdue-count citations for the matched customer.',
      toolSchema: {
        type: 'object',
        properties: {
          citations: { type: 'array', items: CITATION_ITEM_SCHEMA },
          fields: {
            type: 'object',
            properties: {
              total_owed: { type: 'string' }, earliest_due: { type: 'string' }, count_overdue: { type: 'string' },
            },
            required: ['total_owed', 'earliest_due', 'count_overdue'],
          },
        },
        required: ['citations', 'fields'],
      },
    });
  } catch (err) {
    if (err instanceof StopAndReportError) throw err;
    log.steps.push({ step: 'derive2', outcome: 'red', red: err.red ?? err.message });
    return writeResult('red', { red: err.red ?? err.message });
  }

  // Bytes before meaning (ruling 3): derive2's artifact is its citations list, checked on the
  // model's own output before any plant touches it. closeDerive GREENS `{citations: [], fields: {}}`
  // (measured 2026-09-10) — this is the hole. Same top-level reason as derive1 for not checking args.
  const happened2 = checkStepHappened({ goal: 'derive2: invoices, total, due, overdue', close: { class: 'green' } }, derive2.args.citations);
  if (happened2.verdict === 'red') {
    log.steps.push({ step: 'derive2', outcome: 'red', red: happened2.red });
    return writeResult('red', { red: happened2.red });
  }

  const derive2ArgsForClose = applyPlant(plant, 'derive2', derive2.args);
  const close2 = closeDerive(derive2ArgsForClose, artifacts, BUSINESS_DATE);
  log.steps.push({
    step: 'derive2', outcome: close2.verdict, red: close2.red, plantApplied: plant === 'a' || plant === 'b' ? plant : null,
    argsBeforePlant: derive2.args, argsAfterPlant: derive2ArgsForClose, wallMs: derive2.wallMs,
  });
  if (close2.verdict === 'red') return writeResult('red', { red: close2.red });

  log.findings.push(
    'earliest_due is expressed as a copied citation (points at the correct due-date cell), not a derived '
    + 'min citation: close.mjs\'s min/max formula recomputes over Number(citation.value), and an ISO date '
    + 'string is not a number, so min over date citations cannot be independently recomputed by the close. '
    + 'The closed grammar has no date-aware min — this is a grammar gap, logged per the brief\'s instruction '
    + '("do not extend it: mark the figure as a FINDING"), not fixed.',
  );
  log.findings.push(
    'count_overdue\'s close only recomputes that inputs.length equals the stated count (the "count" formula '
    + 'has no filter primitive) — it does not independently verify the model selected the correct SET of '
    + 'overdue invoices, only that each individual daysBetween citation it chose to include recomputes '
    + 'correctly and the count of however many it included matches. A model could in principle count the '
    + 'wrong invoices and still pass if the count happens to match. Logged as a grammar gap, not fixed.',
  );

  // --- compose ---
  const composeSystemPrompt = `You are the fwdloop runner executing ONE step of a signed declaration. `
    + `Step goal: write a short reply, one line per invoice, to the message "${messageArtifact.lines[0]}". `
    + `Every figure in the text must be a citation bracket like [c3] placed with NOTHING between the number and `
    + `the bracket — e.g. "12[c7] days overdue" or "12 [c7] days overdue", never "12 days [c7]" (the bracket `
    + `must sit immediately after the number itself, not after trailing words) — no bare (uncited) numbers `
    + `anywhere in the text, including list markers: never write "Invoice 1:", "Invoice 2:" etc as a bare `
    + `ordinal — use the invoice number (e.g. "INV-1021:") or an unnumbered bullet instead, since a plain digit `
    + `with no citation bracket is read as an uncited figure regardless of what it's labelling. Your citations `
    + `array MUST include EVERY citation object from `
    + `"Prior citations" below VERBATIM AND UNCHANGED, in full — do not drop any, even ones you don't bracket `
    + `directly in the text (a formula citation like count/sum/daysBetween needs every citation id in its own `
    + `"inputs" to ALSO be present in the array, or the evidence check cannot resolve it) — plus anything new `
    + `you need. ${CLOSED_GRAMMAR_NOTE} Answer ONLY by calling emit_compose.`;
  const composeUser = `Prior citations for ${customer}:\n${JSON.stringify(derive2.args.citations, null, 2)}\n\n`
    + `Fields: ${JSON.stringify(derive2.args.fields)}\n\nCall emit_compose now.`;

  let compose;
  try {
    compose = await modelStep({
      runId, stepLabel: 'compose', modelId, apiKey, rates,
      systemPrompt: composeSystemPrompt, userContent: composeUser,
      toolName: 'emit_compose',
      toolDescription: 'Report the reply text with every figure in a citation bracket.',
      toolSchema: {
        type: 'object',
        properties: {
          citations: { type: 'array', items: CITATION_ITEM_SCHEMA },
          text: { type: 'string' },
        },
        required: ['citations', 'text'],
      },
    });
  } catch (err) {
    if (err instanceof StopAndReportError) throw err;
    log.steps.push({ step: 'compose', outcome: 'red', red: err.red ?? err.message });
    return writeResult('red', { red: err.red ?? err.message });
  }

  // Bytes before meaning (ruling 3): compose's artifact is the reply text itself — an empty string
  // means nothing was composed, and must red as "happened" before closeCompose's citation-bracket and
  // completeness checks ever run, so the red names the right cause ("nothing came out", not "brackets
  // missing" or "a declared field went uncited" — closeCompose's completeness check is silent on an
  // empty string with no declaredFields, which is exactly the measured hole).
  const happened3 = checkStepHappened({ goal: 'compose: reply text', close: { class: 'softgreen' } }, compose.args.text);
  if (happened3.verdict === 'red') {
    log.steps.push({ step: 'compose', outcome: 'red', red: happened3.red });
    return writeResult('red', { red: happened3.red });
  }

  const close3 = closeCompose(
    compose.args, artifacts, BUSINESS_DATE, derive2ArgsForClose.fields, derive2ArgsForClose.citations,
  );
  log.steps.push({ step: 'compose', outcome: close3.verdict, red: close3.red, args: compose.args, wallMs: compose.wallMs });
  if (close3.verdict === 'red') return writeResult('red', { red: close3.red });

  // --- ask (the arbiter-placed ask; PRD §5 "nothing goes out before I accept") ---
  const finalAskResult = await ask(runId, 'Reply drafted — ok to send?', { text: compose.args.text }, { outDir, timeoutMs: askTimeoutMs });
  log.steps.push({ step: 'ask', outcome: finalAskResult.verdict, red: finalAskResult.red ?? null, answer: finalAskResult.answer });
  if (finalAskResult.verdict !== 'green') {
    return writeResult('red', { red: finalAskResult.red ?? 'ask not accepted' });
  }

  // --- send ---
  // M0b Part 1: send() no longer hard-codes its allow-list (mechanical.mjs)
  // — this bespoke fold is job #1-shaped and about to be replaced by the
  // declaration-driven runner (M0b Part 2), so it passes the one target job
  // #1's own signed slot names rather than duplicating a second copy.
  const sendResult = sendFn(runId, 'file:poc/m0/out', compose.args.text, {
    acceptedThisRun: true, outDir, allowedTargets: ['file:poc/m0/out'],
  });
  // Bytes before meaning (ruling 3), and the one hamr cares about most ("no 0kb output"): send's real
  // artifact is the bytes ACTUALLY on disk after the write — not the in-memory string that was handed
  // to send() — so this stats the file that send() just produced, not compose.args.text again. A write
  // that silently truncates to 0 bytes must red here and never be logged green.
  const sentBytes = readFileSync(sendResult.deliveryId);
  const happenedSend = checkStepHappened({ goal: 'send: deliver reply', close: { class: 'hitl' } }, sentBytes);
  if (happenedSend.verdict === 'red') {
    log.steps.push({
      step: 'send', outcome: 'red', red: happenedSend.red, deliveryId: sendResult.deliveryId,
    });
    return writeResult('red', { red: happenedSend.red });
  }
  log.steps.push({ step: 'send', outcome: 'green', deliveryId: sendResult.deliveryId });
  return writeResult('complete', { deliveryId: sendResult.deliveryId });
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const declarationIdx = process.argv.indexOf('--declaration');

  if (declarationIdx !== -1) {
    // M0b Part 2 CLI shape (brief): node poc/m0/runner.mjs --declaration <draft.json>
    //   --slot deepseek|synthetic [--model <id>] --plant a|b|c|d|e [--run-id <id>] [--ask-timeout-ms N]
    const declarationPath = process.argv[declarationIdx + 1];
    const slotIdx = process.argv.indexOf('--slot');
    const slot = slotIdx !== -1 ? process.argv[slotIdx + 1] : null;
    const modelIdx = process.argv.indexOf('--model');
    const model = modelIdx !== -1 ? process.argv[modelIdx + 1] : undefined;
    const plantIdx = process.argv.indexOf('--plant');
    const plant = plantIdx !== -1 ? process.argv[plantIdx + 1] : null;
    const runIdIdx = process.argv.indexOf('--run-id');
    const runId = runIdIdx !== -1 ? process.argv[runIdIdx + 1] : `m0b-${slot}-plant-${plant}-${Date.now()}`;
    const askTimeoutIdx = process.argv.indexOf('--ask-timeout-ms');
    const askTimeoutMs = askTimeoutIdx !== -1 ? Number(process.argv[askTimeoutIdx + 1]) : 120_000;

    if (!declarationPath || !['deepseek', 'synthetic'].includes(slot) || !['a', 'b', 'c', 'd', 'e'].includes(plant)) {
      console.error('usage: node poc/m0/runner.mjs --declaration <draft.json> --slot deepseek|synthetic '
        + '[--model <id>] --plant a|b|c|d|e [--run-id <id>] [--ask-timeout-ms N]');
      process.exit(1);
    }

    const raw = JSON.parse(readFileSync(declarationPath, 'utf8'));
    const declaration = raw.declaration ?? raw;
    const sources = [
      { id: 'sheet', path: join(REPO_ROOT, 'fixtures', 'ar-aging.csv') },
      { id: 'message', path: join(REPO_ROOT, 'fixtures', 'message.txt') },
    ];

    console.log(`RUN_ID=${runId}`);
    const result = await runOnPrimitives({
      declaration, runId, sources, plant, slot, model, askTimeoutMs,
    });
    console.log(JSON.stringify({
      runId, outcome: result.outcome, phase: result.phase ?? null, red: result.red ?? null,
    }, null, 2));
    process.exit(result.outcome === 'complete' || result.outcome === 'paused-ask-answered' ? 0 : 1);
  }

  // OLD CLI (F5 bespoke fold, pre-M0b-Part-2) — untouched, kept for the existing job#1-hand-wired
  // path until a decision is made to retire it (see the M0b Part 2.3 commit / report).
  const modelId = process.argv[2];
  const plantIdx = process.argv.indexOf('--plant');
  const plant = plantIdx !== -1 ? process.argv[plantIdx + 1] : null;
  const runIdIdx = process.argv.indexOf('--run-id');
  const runId = runIdIdx !== -1 ? process.argv[runIdIdx + 1] : `m0-${modelId.replace(/^hf:/, '').replace(/\//g, '_')}-plant-${plant}-${Date.now()}`;
  const askTimeoutIdx = process.argv.indexOf('--ask-timeout-ms');
  const askTimeoutMs = askTimeoutIdx !== -1 ? Number(process.argv[askTimeoutIdx + 1]) : 120_000;

  if (!modelId || !['a', 'b', 'c', 'd'].includes(plant)) {
    console.error('usage: node poc/m0/runner.mjs <model-id> --plant a|b|c|d [--run-id <id>] [--ask-timeout-ms N]');
    process.exit(1);
  }

  console.log(`RUN_ID=${runId}`);
  try {
    const result = await runDeclaration({ modelId, plant, runId, askTimeoutMs });
    console.log(JSON.stringify({ runId, outcome: result.outcome, red: result.red ?? null }, null, 2));
    process.exit(result.outcome === 'complete' || result.outcome === 'paused-ask-answered' ? 0 : 1);
  } catch (err) {
    if (err instanceof StopAndReportError) {
      console.error(`STOP-AND-REPORT: ${err.message}`);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  }
}
