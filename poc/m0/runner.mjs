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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { OpenAI } from 'bare-agent/providers';
import { gather, ask, send } from './mechanical.mjs';
import {
  closeDerive, closeCompose, closeCustomerMatch, hashFile, matchingCustomers,
} from './close.mjs';
import { assertUnderGlobalCap, appendSpendRow, RATES_BY_SUFFIX, RUN_CAP_USD } from './spend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(__dirname, 'out');
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
// One model round: fresh Loop, fresh messages, ONE tool. Retries per the
// standing rules above. Returns { args, metering, wallMs } or throws
// StopAndReportError / an Error carrying a `.red` gap string.
// ---------------------------------------------------------------------------

async function runModelStep({
  runId, stepLabel, modelId, apiKey, rates, systemPrompt, userContent, toolName, toolDescription, toolSchema,
}) {
  const provider = new OpenAI({ apiKey, model: modelId, baseUrl: SYNTHETIC_BASE_URL });
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

// ---------------------------------------------------------------------------
// The fold. Loads a declaration (drafter output), runs gather -> derive#1 ->
// [ask if ambiguous] -> derive#2 -> compose -> ask -> send.
// ---------------------------------------------------------------------------

export async function runDeclaration({
  modelId, plant, runId, askTimeoutMs = 120_000, csvPath: csvPathOverride, apiKeyOverride,
}) {
  const apiKey = apiKeyOverride ?? process.env.SYNTHETIC_API_KEY;
  if (!apiKey) throw new Error('SYNTHETIC_API_KEY is not set');
  const suffix = modelId.replace(/^hf:/, '');
  const rates = RATES_BY_SUFFIX[suffix];
  if (!rates) throw new Error(`no hand-entered rate for model suffix "${suffix}"`);

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
    derive1 = await runModelStep({
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
    derive2 = await runModelStep({
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
    compose = await runModelStep({
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

  const close3 = closeCompose(compose.args, artifacts, BUSINESS_DATE);
  log.steps.push({ step: 'compose', outcome: close3.verdict, red: close3.red, args: compose.args, wallMs: compose.wallMs });
  if (close3.verdict === 'red') return writeResult('red', { red: close3.red });

  // --- ask (the arbiter-placed ask; PRD §5 "nothing goes out before I accept") ---
  const finalAskResult = await ask(runId, 'Reply drafted — ok to send?', { text: compose.args.text }, { outDir, timeoutMs: askTimeoutMs });
  log.steps.push({ step: 'ask', outcome: finalAskResult.verdict, red: finalAskResult.red ?? null, answer: finalAskResult.answer });
  if (finalAskResult.verdict !== 'green') {
    return writeResult('red', { red: finalAskResult.red ?? 'ask not accepted' });
  }

  // --- send ---
  const sendResult = send(runId, 'file:poc/m0/out', compose.args.text, { acceptedThisRun: true, outDir });
  log.steps.push({ step: 'send', outcome: 'green', deliveryId: sendResult.deliveryId });
  return writeResult('complete', { deliveryId: sendResult.deliveryId });
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
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
