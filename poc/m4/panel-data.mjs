#!/usr/bin/env node
// poc/m4/panel-data.mjs — M4a POC ($0, no network, no key).
//
// Riskiest assumption (docs/wiki/the-module-ladder.md, M4a "POC first"):
// fwdloop's own books hold everything the borrowed read-only screens need.
//
// This script never ships. It builds — from fwdloop's OWN readers where one
// exists (readFlow/loadCatalogue from src/index.js), and raw book reads
// where none does — the data every M4a screen needs for every real run on
// disk, and reports, per run x field: FILLED | EMPTY-WITH-WHY | GAP. It
// exits non-zero if any field is GAP or any value is invented (0/"unknown"
// standing in for missing data, per project rule "unknown cost is never
// rendered as 0").
//
// Field list is drawn from bareloop's borrowed panel (src/panel/server.js,
// src/panel/index.html — copied verbatim at a30bbef, see
// docs/wiki/the-module-ladder.md M4a item 1) and from bin/fwdloop's own
// `show`/`inbox` (the Inbox screen's stated source of truth), narrowed to
// what M4a's scope (ladder item 2) actually wires. Every field cites the
// bareloop file:line it is modelled on. Concepts dropped per hamr's ruling A
// (2026-09-26, "M4a screens: no per-round parts, no tool-call Audit rows, no
// judge") are listed separately as DROPPED, not enumerated as GAP.
//
// Usage:
//   node poc/m4/panel-data.mjs               # run the real POC over flows/*
//   node poc/m4/panel-data.mjs --plant        # negative self-test (see below)

import {
  existsSync, readdirSync, readFileSync, statSync, mkdirSync, rmSync, writeFileSync, cpSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow, loadCatalogue, readAskEvidence } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Raw book readers. fwdloop's src/books.js (M2 piece 1) is APPEND-ONLY — it
// exports appendAudit/appendHistory and nothing that reads either book back.
// No src/ module reads audit.jsonl, history.jsonl, spend.jsonl, log.json,
// ask.json, answer*.json, inputs.json or state.json either (grepped: only
// bin/fwdloop and src/runner.js parse these inline, ad hoc, for their own
// narrow purpose). So every read below is RAW — stated here once rather than
// per field.
// ---------------------------------------------------------------------------

function readJsonlRaw(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* malformed line: skip, don't crash */ }
  }
  return rows;
}

function readJsonRaw(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function listDirNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Result classification. A field's deriver returns one of these three
// shapes. `invented()` exists so a deriver can be CAUGHT reaching for a
// fake value (0, "unknown" standing in for missing data, a placeholder) —
// it throws, which the harness turns into a GAP naming the offending field,
// never a silently-passed fake.
// ---------------------------------------------------------------------------

function filled(value, book) {
  return { status: 'FILLED', value, book };
}
function emptyWithWhy(why) {
  if (typeof why !== 'string' || why.trim().length === 0) {
    throw new Error('emptyWithWhy() called with no reason — a field must state WHY it is empty, never just "empty"');
  }
  return { status: 'EMPTY-WITH-WHY', why };
}
function gap(why) {
  return { status: 'GAP', why };
}

/** Guard against the "invented value" failure mode explicitly named in the
 * ladder's POC bar: a deriver must never hand back 0 / "unknown" for a cost
 * or count it could not actually compute. Call this INSTEAD of writing the
 * fake value inline. */
function forbidInvented(fieldLabel, value) {
  if (value === 0 || value === 'unknown') {
    throw new Error(`INVENTED VALUE at ${fieldLabel}: a deriver tried to hand back ${JSON.stringify(value)} standing in for missing data — this is exactly what the POC bar forbids`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Glyph + cost-floor logic (M4a scope item 4, ladder lines 739-751). New
// logic — bareloop's deriveDeath (server.js) is spine/round-heuristic based
// and does not map onto fwdloop's park/resume model at all (fit-check §2,
// "died" row). This is the fwdloop-native version, built from state.json /
// ask.json / answer*.consumed.json / history.jsonl presence, exactly as the
// ladder spells it out.
// ---------------------------------------------------------------------------

function computeGlyph(ctx) {
  const { historyRow, askJson, consumedAnswerExists, hasStateJson } = ctx;

  if (historyRow) {
    if (historyRow.outcome === 'complete') return { glyph: '[✓]', label: 'passed' };
    if (historyRow.outcome === 'ask-expired' || historyRow.outcome === 'rerun') {
      return { glyph: '[✗]', label: `failed (${historyRow.outcome})` };
    }
    // not-done, or any other terminal-but-not-complete outcome.
    return { glyph: '[✗]', label: `failed (${historyRow.outcome ?? 'unknown outcome'})` };
  }

  // No history row. Per the ladder: a park NEVER writes a history row, and
  // answerAsk leaves ask.json in place until resume consumes the answer —
  // so "no history row" alone never means died.
  if (askJson && !consumedAnswerExists) {
    return { glyph: '[·]', label: 'waiting on you (parked, unanswered)' };
  }
  if (askJson && consumedAnswerExists) {
    // Answer file was consumed (renamed to answer.<askId>.consumed.json) but
    // no history row exists yet for THIS run — i.e. resume has not finished
    // (or never started). Per the ladder: shown in words, never the same
    // line as an unanswered ask, never [?].
    return { glyph: '[·]', label: 'answered, not resumed yet' };
  }
  if (hasStateJson && !askJson) {
    // Parked (state.json exists) but ask.json is gone and there's no
    // history row — an in-between shape none of our sample runs hit; name
    // it rather than guess.
    return { glyph: '[?]', label: 'running or died: unknown (parked state with no open ask and no history row)' };
  }
  // No history row, no ask.json, no state.json: the ladder's own open
  // question — resume.lock has no pid and nothing checks liveness, so a
  // crashed run and a live one look the same on disk.
  return { glyph: '[?]', label: 'running or died: unknown (resume.lock has no pid, no liveness check)' };
}

/** "at least $X" floor per ladder negative (iv) / project rule "unknown cost
 * is never rendered as 0". Only used when the book's OWN spendComplete says
 * the number is incomplete — never invented from nothing. */
function costDisplay(spentUsd, spendComplete) {
  if (typeof spentUsd !== 'number') {
    return gap('spentUsd field is not a number and spendComplete does not explain why');
  }
  if (spendComplete === false) {
    return filled(`at least $${spentUsd.toFixed(4)}`, 'history.jsonl (spentUsd, spendComplete:false)');
  }
  return filled(`$${spentUsd.toFixed(4)}`, 'history.jsonl (spentUsd)');
}

// ---------------------------------------------------------------------------
// Load a run's full context: every book fwdloop can hold for it, read once.
// ---------------------------------------------------------------------------

function loadRunContext(flowsRoot, flowName, runId, catalogue) {
  const flowDir = join(flowsRoot, flowName);
  const runDir = join(flowDir, 'runs', runId);

  const flowRead = readFlow({ root: flowsRoot, name: flowName, catalogue });

  const historyRows = readJsonlRaw(join(flowDir, 'history.jsonl')) ?? [];
  const historyRow = historyRows.find((r) => r && r.runId === runId) ?? null;

  const auditRows = readJsonlRaw(join(runDir, 'audit.jsonl')) ?? [];
  const spendRows = readJsonlRaw(join(runDir, 'spend.jsonl')) ?? [];
  const logJson = readJsonRaw(join(runDir, 'log.json'));
  const askJson = readJsonRaw(join(runDir, 'ask.json'));
  const stateJson = readJsonRaw(join(runDir, 'state.json'));
  const inputsJson = readJsonRaw(join(runDir, 'inputs.json'));

  let consumedAnswerExists = false;
  let consumedAnswer = null;
  if (existsSync(runDir)) {
    for (const name of readdirSync(runDir)) {
      if (/^answer\..*\.consumed\.json$/.test(name)) {
        consumedAnswerExists = true;
        consumedAnswer = readJsonRaw(join(runDir, name));
      }
    }
  }

  return {
    flowName,
    runId,
    flowDir,
    runDir,
    flowRead,
    historyRow,
    historyRows,
    auditRows,
    spendRows,
    logJson,
    askJson,
    stateJson,
    inputsJson,
    consumedAnswerExists,
    consumedAnswer,
    hasStateJson: stateJson !== null,
  };
}

// ---------------------------------------------------------------------------
// Field definitions, one array per screen. Each entry:
//   { screen, field, bareloopSource, deriver(ctx) -> {status,...} }
// ---------------------------------------------------------------------------

const FIELD_DEFS = [];

function def(screen, field, bareloopSource, deriver) {
  FIELD_DEFS.push({
    screen, field, bareloopSource, deriver,
  });
}

// --- Workflows / History (server.js summarizeRow:295-327, listRuns:348-357;
//     index.html chip toggle :337-338) — M4a scope item 2: "every flow under
//     --root, with its last run's glyph, cost and time" / "every run row
//     from history.jsonl". -------------------------------------------------

def('Workflows/History', 'runId', 'server.js:296 (summarizeRow row.runid)', (ctx) => filled(ctx.runId, `flows/${ctx.flowName}/runs/<dir name>`));

def('Workflows/History', 'flow (job)', 'server.js:296 (summarizeRow row.job)', (ctx) => filled(ctx.flowName, 'flow directory name'));

def('Workflows/History', 'glyph', 'server.js:320 (glyph: death.died ? \'?\' : glyphForOutcome(...))', (ctx) => {
  const g = computeGlyph(ctx);
  return filled(g.glyph, 'history.jsonl + ask.json + state.json + answer*.consumed.json presence (new logic, not bareloop\'s deriveDeath)');
});

def('Workflows/History', 'at (date)', 'server.js:296 (summarizeRow row.at)', (ctx) => {
  if (!ctx.historyRow) return emptyWithWhy('no history.jsonl row for this run yet (parked or died before a row was ever written)');
  return filled(ctx.historyRow.at, 'history.jsonl (at)');
});

def('Workflows/History', 'spend (cost)', 'server.js:325-326 (line.spend / "at least $X" for a died row)', (ctx) => {
  if (!ctx.historyRow) {
    // Died/parked-with-no-row: sum whatever priced rows spend.jsonl/audit.jsonl
    // already recorded — a REAL floor, never 0.
    const sum = ctx.spendRows.reduce((acc, r) => acc + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
    const anyPriced = ctx.spendRows.some((r) => typeof r.costUsd === 'number');
    if (!anyPriced) return emptyWithWhy('no history row and no priced spend.jsonl rows yet — nothing spent to floor');
    return filled(forbidInvented('Workflows.spend(floor)', `at least $${sum.toFixed(4)}`), 'spend.jsonl (costUsd, summed) — no history row yet, so this is a floor, not a total');
  }
  return costDisplay(ctx.historyRow.spentUsd, ctx.historyRow.spendComplete);
});

def('Workflows/History', 'wall (time)', 'server.js:326 (line.wall / floor)', (ctx) => {
  if (!ctx.historyRow) {
    const anyWall = ctx.spendRows.some((r) => typeof r.wallMs === 'number');
    if (!anyWall) return emptyWithWhy('no history row and no wallMs recorded yet');
    const sum = ctx.spendRows.reduce((acc, r) => acc + (typeof r.wallMs === 'number' ? r.wallMs : 0), 0);
    return filled(`at least ${sum}ms`, 'spend.jsonl (wallMs, summed) — floor, no history row yet');
  }
  if (typeof ctx.historyRow.wallMs !== 'number') return gap('history.jsonl row has no wallMs field');
  return filled(`${ctx.historyRow.wallMs}ms`, 'history.jsonl (wallMs)');
});

def('Workflows/History', 'outcome', 'server.js:497 (getRunDetail outcome)', (ctx) => {
  if (!ctx.historyRow) return emptyWithWhy('no history row (parked or died before completion)');
  return filled(ctx.historyRow.outcome, 'history.jsonl (outcome)');
});

def('Workflows/History', 'capUsd (budget)', 'server.js:391 (summary.budgetUsd)', (ctx) => {
  if (!ctx.historyRow) {
    if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
    return filled(ctx.flowRead.arbiter.capUsd, 'readFlow -> arbiter.capUsd (signed prose, not history — cap is per-flow, not per-run)');
  }
  return filled(ctx.historyRow.capUsd, 'history.jsonl (capUsd)');
});

// --- Run tab (server.js getRunDetail:370-562; index.html :359) — M4a scope
//     item 2: "the step map from declaration.steps, and step cards ->
//     attempts from audit.jsonl (verdict, gap, cost, model, strike) plus
//     what the model wrote from log.json." ---------------------------------

def('Run tab', 'step map (declaration.steps)', 'server.js:453-480 (steps = summary.steps.map(...))', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  const steps = ctx.flowRead.declaration.steps;
  if (!Array.isArray(steps) || steps.length === 0) return gap('declaration.json has no steps array');
  return filled(steps.map((s) => ({ emits: s.emits, goal: s.goal, primitives: s.primitives, closeClass: s.close?.class })), 'readFlow -> declaration.steps');
});

def('Run tab', 'attempts per step (verdict/gap/cost/model/strike)', 'server.js:456-471 (u.rounds/wallMs/spentUsd/... per step, from summary.steps)', (ctx) => {
  if (ctx.auditRows.length === 0) {
    if (ctx.historyRow || ctx.askJson) return gap('run has a history/ask record but audit.jsonl has zero rows — a run cannot reach an ask or complete with no attempts recorded');
    return emptyWithWhy('run has not started (no audit.jsonl rows yet)');
  }
  const byStep = {};
  for (const row of ctx.auditRows) {
    if (typeof row.usd !== 'number' && row.usd !== null) {
      return gap(`audit.jsonl row for step "${row.step}" attempt ${row.attempt} has a usd field that is neither a number nor null (${JSON.stringify(row.usd)}) — books.js's own checkCostField should have refused this at write time`);
    }
    if (row.usd === null && row.spendComplete !== false) {
      return gap(`audit.jsonl row for step "${row.step}" attempt ${row.attempt}: usd is null but spendComplete is not false — an unpriced attempt must say so`);
    }
    (byStep[row.step] ??= []).push({
      attempt: row.attempt, verdict: row.verdict, gap: row.gap, cost: row.usd, model: row.model, strike: row.strike, spendComplete: row.spendComplete,
    });
  }
  return filled(byStep, 'audit.jsonl (one row per step attempt, joined by "step")');
});

def('Run tab', 'what the model wrote (log.json)', 'server.js: n/a in bareloop (bareloop has no equivalent "model wrote this" field on getRunDetail; fwdloop\'s own log.json.attempts[].modelOutput / .artifacts is the closest analog)', (ctx) => {
  if (!ctx.logJson) {
    if (ctx.historyRow) return gap(`run "${ctx.runId}" completed (history row present) but log.json is missing`);
    return emptyWithWhy('run has not written log.json yet (parked before any step reached a close, or still running)');
  }
  const hasArtifacts = ctx.logJson.artifacts && Object.keys(ctx.logJson.artifacts).length > 0;
  const hasAttempts = Array.isArray(ctx.logJson.attempts) && ctx.logJson.attempts.length > 0;
  if (!hasArtifacts && !hasAttempts) return gap('log.json exists but has neither "artifacts" nor "attempts" — nothing to show as "what the model wrote"');
  return filled({ artifacts: ctx.logJson.artifacts ?? null, attempts: ctx.logJson.attempts ?? null }, 'log.json (artifacts / attempts)');
});

def('Run tab', 'glyph', 'server.js:508 (getRunDetail glyph)', (ctx) => filled(computeGlyph(ctx).glyph, 'same derivation as Workflows/History.glyph'));

def('Run tab', 'stopReason / red', 'server.js:502 (stopReason)', (ctx) => {
  if (ctx.logJson && typeof ctx.logJson.red === 'string' && ctx.logJson.red.length > 0) {
    return filled(ctx.logJson.red, 'log.json (red)');
  }
  const redRow = ctx.auditRows.find((r) => r.verdict === 'not-done' || r.verdict === 'red');
  if (redRow) return filled(redRow.gap, `audit.jsonl (step "${redRow.step}" attempt ${redRow.attempt}, gap)`);
  if (ctx.historyRow && ctx.historyRow.outcome === 'complete') return emptyWithWhy('run completed clean — there is no stop reason to show');
  return emptyWithWhy('run has not stopped on a red/not-done step (still parked, waiting, or clean so far)');
});

// --- Audit / logs (server.js getRunAudit:798-885; index.html :360) — M4a
//     scope item 2: "the raw audit rows, scoped to the one run, one row per
//     step attempt (audit.jsonl has no round-level or tool-call-level
//     rows)." -----------------------------------------------------------

def('Audit', 'raw rows (step, attempt, class, verdict, gap, usd, spendComplete, wallMs, model, modelMatch, strike)', 'server.js:798-885 (getRunAudit rows[]) — bareloop\'s per-round/per-call fields DROPPED, see DROPPED list', (ctx) => {
  if (ctx.auditRows.length === 0) return emptyWithWhy('audit.jsonl is empty or missing — run has not made an attempt yet');
  return filled(ctx.auditRows, 'audit.jsonl, verbatim, one row per attempt');
});

// --- Job (server.js getRunJob:1185-1333; index.html :361) — M4a scope
//     item 2: "the signed prose, the arbiter block (cap, asks with TTL,
//     redo cap, sends, sources), and the signature (who, when, hash)." ----

def('Job', 'signed prose (numbered lines + per-line guardrail)', 'server.js:1240ish (getRunJob description/goal, bareloop\'s spec.description) — fwdloop has no separate description field; prose IS it', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  return filled(ctx.flowRead.lines, 'readFlow -> parseSignedText -> lines[] (n, text, guardrail)');
});

def('Job', 'arbiter.capUsd', 'server.js:1200ish (getRunJob budgetUsd)', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  return filled(ctx.flowRead.arbiter.capUsd, 'readFlow -> arbiter.capUsd');
});

def('Job', 'arbiter.asks[] (line, ttlMs, question)', 'server.js: n/a directly (bareloop has no ask/TTL concept on the Job tab — fwdloop\'s own arbiter block, ladder M4a item 2 "asks with TTL")', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  const asks = ctx.flowRead.arbiter.asks;
  if (!Array.isArray(asks) || asks.length === 0) return emptyWithWhy('this flow has no signed ask: line');
  return filled(asks, 'readFlow -> arbiter.asks[]');
});

def('Job', 'arbiter.redoCap', 'server.js: n/a directly (fwdloop-only concept)', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  return filled(ctx.flowRead.arbiter.redoCap, 'readFlow -> arbiter.redoCap');
});

def('Job', 'arbiter.sends[] (line, target)', 'server.js: destination field (~1204, destDisplay())', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  const sends = ctx.flowRead.arbiter.sends;
  if (!Array.isArray(sends) || sends.length === 0) return emptyWithWhy('this flow has no signed send: line (nothing goes out)');
  return filled(sends, 'readFlow -> arbiter.sends[]');
});

def('Job', 'arbiter.sources[] (role, kind, path)', 'server.js: source field (~1198, sourceDisplay())', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  const sources = ctx.flowRead.arbiter.sources;
  if (!Array.isArray(sources) || sources.length === 0) return gap('arbiter has no sources[] — every job should name where its inputs come from');
  return filled(sources, 'readFlow -> arbiter.sources[]');
});

def('Job', 'signature (who, when, hash)', 'server.js: n/a directly (bareloop\'s resolved/resolvedFrom provenance chain DOES NOT apply — fwdloop always has exactly one signature.json, fit-check §2 "Job tab" row)', (ctx) => {
  if (!ctx.flowRead.ok) return gap(`readFlow refused: ${ctx.flowRead.reds?.join('; ')}`);
  const sig = ctx.flowRead.signature;
  if (!sig || typeof sig.signedBy !== 'string' || typeof sig.signedAt !== 'string' || typeof sig.flow !== 'string') {
    return gap('signature.json is missing signedBy/signedAt/flow (hash)');
  }
  return filled({ signedBy: sig.signedBy, signedAt: sig.signedAt, hash: sig.flow }, 'readFlow -> signature (signedBy, signedAt, flow=hash)');
});

// --- Inbox, read-only (bin/fwdloop cmdShow:337-373, cmdInbox:248-... ) —
//     M4a scope item 2: "open asks across all flows — question, time left,
//     and the evidence (the draft under review first, then each unjudged
//     artifact labelled by step), the same thing fwdloop show prints." ----

def('Inbox', 'question', 'bin/fwdloop:359 (process.stdout.write(`question: ${ask.question}`))', (ctx) => {
  if (!ctx.askJson) return emptyWithWhy('no ask.json — run has not reached a signed ask yet, or none was ever opened');
  if (typeof ctx.askJson.question !== 'string') return gap('ask.json has no "question" field');
  return filled(ctx.askJson.question, 'ask.json (question)');
});

def('Inbox', 'time left / expiresAt', 'bin/fwdloop:360 (expiresAt) + bin/fwdloop:277 (legacy: no askId/expiresAt shown as "legacy", never "open")', (ctx) => {
  if (!ctx.askJson) return emptyWithWhy('no ask.json — nothing to show a time-left for');
  if (typeof ctx.askJson.askId !== 'string' || typeof ctx.askJson.expiresAt !== 'string') {
    return emptyWithWhy('M2-era ask.json (no askId/expiresAt) — bin/fwdloop\'s own cmdInbox shows this as "legacy (not answerable)", never a time-left');
  }
  if (ctx.consumedAnswerExists) return emptyWithWhy('this ask has already been answered (a consumed answer file exists) — a live inbox would not list it as open at all');
  return filled(ctx.askJson.expiresAt, 'ask.json (expiresAt)');
});

// F47 fix: both fields below now go through the ONE shared reader,
// `readAskEvidence` (src/ask.js, re-exported from src/index.js), instead of
// reaching into ask.json's evidence shapes ad hoc — the same reader
// bin/fwdloop's cmdShow now uses. It normalises all three real shapes (M3,
// M2, none) and never returns "undefined"/""/0 for missing data; an
// unrecognised shape comes back as a named `why`, which this POC still
// reports as a real GAP (a books/reader gap, not an invented value).

def('Inbox', 'evidence: draft under review', 'src/ask.js readAskEvidence() + bin/fwdloop:354-360 (show)', (ctx) => {
  if (!ctx.askJson) return emptyWithWhy('no ask.json');
  const { draft, why } = readAskEvidence(ctx.askJson);
  if (draft) {
    return filled(draft.text.slice(0, 80) + (draft.text.length > 80 ? '…' : ''), 'ask.json (evidence, via readAskEvidence)');
  }
  // readAskEvidence names two distinct reasons for draft === null: the
  // pre-F45 "no evidence key at all" legacy park (a real, expected shape —
  // EMPTY-WITH-WHY), and an evidence key present but in a shape the reader
  // does not recognise (a real gap — GAP).
  if (why && why.startsWith('this ask was parked before evidence was recorded')) return emptyWithWhy(why);
  return gap(why ?? 'readAskEvidence returned no draft and no why — reader contract violated');
});

def('Inbox', 'evidence: each unjudged artifact, labelled by step', 'src/ask.js readAskEvidence() + bin/fwdloop:361-364 (show)', (ctx) => {
  if (!ctx.askJson) return emptyWithWhy('no ask.json');
  const { draft, unjudged, why } = readAskEvidence(ctx.askJson);
  if (!draft) {
    return why && why.startsWith('this ask was parked before evidence was recorded')
      ? emptyWithWhy(why)
      : gap(why ?? 'readAskEvidence returned no draft and no why — reader contract violated');
  }
  if (unjudged.length > 0) {
    return filled(unjudged.map((u) => ({ step: u.step, preview: u.text.slice(0, 60) })), 'ask.json (evidence, via readAskEvidence)');
  }
  return emptyWithWhy('no unjudged artifacts for this ask (M2-era evidence has no "unjudged" concept at all, or every prior step was already judged when this ask was written)');
});

// ---------------------------------------------------------------------------
// DROPPED — bareloop-only concepts, per hamr's ruling A (2026-09-26): no
// per-round parts, no tool-call-level Audit rows, no judge. Listed here,
// never enumerated as GAP, because M4a's own scope (ladder item 2) never
// asked for them.
// ---------------------------------------------------------------------------

const DROPPED = [
  {
    concept: 'parts[] / round-level detail (getRunRounds, server.js:928-1013ish)',
    reason: 'Ruling A: no per-round parts. fwdloop\'s audit.jsonl is one row per (step, attempt) — there is no round unit in the books at all (spend.jsonl records a "rounds" COUNT per step-invocation, never each round individually or labelled by phase). The ladder\'s own M4a text (line 677-679) already rules this one level coarser: one ordered list of STEP ATTEMPTS drives the map/cards/Audit, not rounds.',
  },
  {
    concept: 'Audit tab tool-call rows (path, decision, costUsd, tokens, durationMs per call — server.js getRunAudit rows[])',
    reason: 'Ruling A: no tool-call Audit rows. These come from a gate-audit tool-call sidecar bare-agent writes in bareloop; fwdloop has no equivalent per-call audit sidecar. audit.jsonl is step-attempt granularity only.',
  },
  {
    concept: 'judgeModel (server.js getRunDetail:388-395)',
    reason: 'Ruling A: no judge. fwdloop has no separate LLM-judge seam — a softgreen close is a mechanical shape check (src/closers.js), never a second model call to judge the first.',
  },
  {
    concept: 'scoutPlan / fixLoop / replans / timelineKind=\'iterations\' (server.js getRunDetail, plan-mode-only branches)',
    reason: 'bareloop-only: plan-mode / live scout-and-replan concepts. fwdloop has exactly one flow shape (linear, human-authored, signed steps) — there is no scout, no plan, no replan, no fix-loop stage to show.',
  },
  {
    concept: 'memoryCache (spine memory-cache record)',
    reason: 'bareloop-specific caching layer with no fwdloop analog.',
  },
  {
    concept: 'branch (git branch at run time)',
    reason: 'Not in M4a scope; fwdloop records no git branch per run anywhere in the books today. Cosmetic, not load-bearing — noted, not chased.',
  },
  {
    concept: 'resolved/resolvedFrom/note spec-provenance fallback chain (server.js getRunJob, bundle/jobs-dir/resolved-spec/job-start)',
    reason: 'bareloop resolves a job spec through a multi-source fallback chain; fwdloop always has exactly one signed declaration.json + signature.json per flow, so there is no "which spec resolved this" question to answer.',
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function discoverRuns(flowsRoot) {
  const runs = [];
  for (const flowName of listDirNames(flowsRoot)) {
    const runsDir = join(flowsRoot, flowName, 'runs');
    for (const runId of listDirNames(runsDir)) {
      runs.push({ flowName, runId });
    }
  }
  return runs;
}

function buildRow(ctx) {
  const results = {};
  for (const { screen, field, deriver } of FIELD_DEFS) {
    const key = `${screen} :: ${field}`;
    try {
      results[key] = deriver(ctx);
    } catch (err) {
      // A deriver that throws (including forbidInvented's own throw) is
      // itself the finding: report it as a GAP naming exactly what broke,
      // never let an exception crash the whole run silently.
      results[key] = gap(`deriver threw: ${err.message}`);
    }
  }
  return results;
}

function printReport(allRows) {
  let filledCount = 0;
  let emptyCount = 0;
  let gapCount = 0;
  const gaps = [];

  for (const { flowName, runId, results } of allRows) {
    console.log(`\n=== ${flowName}/runs/${runId} ===`);
    for (const [key, res] of Object.entries(results)) {
      if (res.status === 'FILLED') {
        filledCount += 1;
        const short = typeof res.value === 'string' ? res.value.slice(0, 70) : JSON.stringify(res.value).slice(0, 70);
        console.log(`  [FILLED]         ${key} <- ${res.book} :: ${short}`);
      } else if (res.status === 'EMPTY-WITH-WHY') {
        emptyCount += 1;
        console.log(`  [EMPTY-WITH-WHY] ${key} :: ${res.why}`);
      } else {
        gapCount += 1;
        console.log(`  [GAP]            ${key} :: ${res.why}`);
        gaps.push({ run: `${flowName}/${runId}`, field: key, why: res.why });
      }
    }
  }

  console.log(`\n--- summary ---`);
  console.log(`FILLED: ${filledCount}   EMPTY-WITH-WHY: ${emptyCount}   GAP: ${gapCount}`);
  console.log(`DROPPED (ruling A, not counted as GAP): ${DROPPED.length}`);
  for (const d of DROPPED) console.log(`  - ${d.concept}: ${d.reason}`);

  return { filledCount, emptyCount, gapCount, gaps };
}

function runReal() {
  const flowsRoot = join(REPO_ROOT, 'flows');
  const catRes = loadCatalogue();
  if (!catRes.ok) {
    console.error('FATAL: loadCatalogue() failed:', catRes.reds);
    process.exit(1);
  }
  const catalogue = catRes.primitives;

  const runs = discoverRuns(flowsRoot);
  if (runs.length === 0) {
    console.error('FATAL: no runs found under flows/*/runs/* — nothing to prove the POC against');
    process.exit(1);
  }

  const allRows = runs.map(({ flowName, runId }) => {
    const ctx = loadRunContext(flowsRoot, flowName, runId, catalogue);
    const glyph = computeGlyph(ctx);
    console.log(`glyph for ${flowName}/${runId}: ${glyph.glyph} (${glyph.label})`);
    return { flowName, runId, results: buildRow(ctx) };
  });

  const { gapCount, gaps } = printReport(allRows);

  if (gapCount > 0) {
    console.error(`\nPOC BAR NOT MET: ${gapCount} GAP field(s).`);
    for (const g of gaps) console.error(`  - ${g.run} :: ${g.field} :: ${g.why}`);
    process.exit(1);
  }
  console.log('\nPOC BAR MET: zero GAPs, every field FILLED or EMPTY-WITH-WHY.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Negative self-test (--plant): prove the harness CAN fail. Copies a real
// run into a scratch directory, blanks/removes a real book field, and
// confirms buildRow() reports GAP for it and the overall run would exit
// non-zero. This is the "test must be able to fail" pre-flight check
// (AGENT_RULES.md, Validate Before You Build).
// ---------------------------------------------------------------------------

function runPlant() {
  const flowsRoot = join(REPO_ROOT, 'flows');
  const plantRoot = join(__dirname, '.tmp-plant');
  rmSync(plantRoot, { recursive: true, force: true });
  mkdirSync(plantRoot, { recursive: true });

  // Copy job2-live-1 whole (small: prose/declaration/signature/history +
  // one run's books) so readFlow() and the raw readers see a REAL flow
  // shape, not a hand-built fixture.
  cpSync(join(flowsRoot, 'job2-live-1'), join(plantRoot, 'job2-live-1'), { recursive: true });

  const runDir = join(plantRoot, 'job2-live-1', 'runs', 'run-1');
  const auditPath = join(runDir, 'audit.jsonl');
  const rows = readJsonlRaw(auditPath);

  // PLANT: remove the "usd" field entirely from one real audit row (a book
  // field removed) — this is exactly the "cost" field the Run tab / Audit
  // screen need per step attempt.
  const plantedRows = rows.map((r, idx) => {
    if (idx !== 0) return r;
    const clone = { ...r };
    delete clone.usd;
    return clone;
  });
  writeFileSync(auditPath, plantedRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const catRes = loadCatalogue();
  const catalogue = catRes.primitives;
  const ctx = loadRunContext(plantRoot, 'job2-live-1', 'run-1', catalogue);
  const results = buildRow(ctx);

  const attemptsKey = 'Run tab :: attempts per step (verdict/gap/cost/model/strike)';
  const auditKey = 'Audit :: raw rows (step, attempt, class, verdict, gap, usd, spendComplete, wallMs, model, modelMatch, strike)';

  console.log('--- PLANT: removed "usd" from audit.jsonl row 0 (step "resume-text", attempt 1) ---');
  console.log(`${attemptsKey} => ${results[attemptsKey].status}: ${results[attemptsKey].why ?? ''}`);
  console.log(`${auditKey} => ${results[auditKey].status}`);

  rmSync(plantRoot, { recursive: true, force: true });

  const caught = results[attemptsKey].status === 'GAP';
  if (!caught) {
    console.error('PLANT FAILED: removing a real book field did NOT produce a GAP — the harness cannot fail, so its green results are not trustworthy.');
    process.exit(1);
  }
  console.log('\nPLANT PASSED (red line, on purpose): the harness caught the missing field and reported GAP, not an invented value.');
  console.log(`RED LINE: ${attemptsKey} :: GAP :: ${results[attemptsKey].why}`);

  // Second plant: forbidInvented() itself must fire on a deliberately
  // invented 0. Prove the guard, not just the field logic above it.
  try {
    forbidInvented('plant-test-field', 0);
    console.error('PLANT FAILED: forbidInvented(0) did not throw.');
    process.exit(1);
  } catch (err) {
    console.log(`RED LINE (guard): forbidInvented threw as designed: ${err.message}`);
  }

  process.exit(0);
}

const args = process.argv.slice(2);
if (args.includes('--plant')) {
  runPlant();
} else {
  runReal();
}
