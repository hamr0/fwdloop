// M4a piece 2 (docs/wiki/the-module-ladder.md, "M4a — read-only panel —
// SIGNED", scope item 2): the panel's data layer. Every function here is a
// pure reader — it takes `--root` plus a flow/run identity, reads fwdloop's
// own books through the readers `src/` already owns (`readFlow`, `readAudit`,
// `readHistory`, `readAsk`, `readRunState`, `readLog`, `readSpendRows`,
// `readAskEvidence`, `loadCatalogue`), and returns plain JSON-able data. No
// function here ever writes anything, and none reaches into `process.env`
// for a key/secret.
//
// Field derivations (the glyph rules, the cost-floor display) are ported
// from the M4a POC (poc/m4/panel-data.mjs, proven at F47 to hit the POC bar:
// 114 FILLED, 11 EMPTY-WITH-WHY, 0 GAP across every real run on disk) —
// never re-derived ad hoc, and the POC itself is never shipped (project
// rule: "never ship the POC" — this is the clean rebuild in `src/`).
//
// PATH SAFETY: every flow name is checked with `checkFlowName` and every
// runId is resolved with `resolveRunDir` (both `src/flow.js`) before this
// module touches a filesystem path for it — `src/panel/server.js` checks the
// same things at the route level, but this module refuses on its own too
// (negative scenario v: nothing outside `--root` is ever read).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  readFlow, listFlowNames, listRunIds, resolveRunDir, checkFlowName,
} from '../flow.js';
import {
  readAudit, readHistory, auditRowTokens, auditRowAt,
} from '../books.js';
import { readAsk, readRunState, readLog } from '../runner.js';
import { readSpendRows } from '../provider.js';
import { readAskEvidence, listArchivedAsks } from '../ask.js';

/** `{ ok:false, red }` result shape every exported function here can return
 *  instead of throwing — the server maps this to a 4xx, never a crash.
 *  @param {string} red
 *  @returns {{ok:false, red:string}} */
function refuse(red) {
  return { ok: false, red };
}

/**
 * Resolve `<root>/<flowName>` safely — `checkFlowName` first (never a raw
 * string joined into a path). Returns the flow directory, or a refusal.
 * @param {string} root
 * @param {string} flowName
 * @returns {{ok:true, flowDir:string}|{ok:false, red:string}}
 */
function resolveFlowDir(root, flowName) {
  const check = checkFlowName(flowName);
  if (!check.ok) return refuse(check.red);
  return { ok: true, flowDir: join(root, flowName) };
}

/**
 * Resolve `<root>/<flowName>/runs/<runId>` safely — `resolveFlowDir` then
 * `resolveRunDir` (character allow-list plus a lexical-containment re-check,
 * same posture `src/flow.js` already applies everywhere else a runId
 * reaches a path). Neither check trusts the URL beyond what it verifies.
 * @param {string} root
 * @param {string} flowName
 * @param {string} runId
 * @returns {{ok:true, flowDir:string, runDir:string}|{ok:false, red:string}}
 */
function resolveRunPath(root, flowName, runId) {
  const flow = resolveFlowDir(root, flowName);
  if (!flow.ok) return flow;
  const run = resolveRunDir(flow.flowDir, runId);
  if (!run.ok) return run;
  return { ok: true, flowDir: flow.flowDir, runDir: run.runDir };
}

/**
 * A consumed-answer marker exists for this run — `answerAsk`'s own write
 * (`src/ask.js`) renames to `answer.<askId>.consumed.json` on accept, and
 * `resumeRun` (`src/runner.js`) does the same when it consumes an in-place
 * `answer.json`. A directory-naming-convention check, not a "book" with its
 * own single-row shape, so it lives here rather than growing a one-off
 * reader in either writer's module.
 * @param {string} runDir
 * @returns {boolean}
 */
function hasConsumedAnswer(runDir) {
  if (!existsSync(runDir)) return false;
  let names;
  try { names = readdirSync(runDir); } catch { return false; }
  return names.some((n) => /^answer\..*\.consumed\.json$/.test(n));
}

/**
 * The glyph + human-words label for one run — ported verbatim (in spirit,
 * from real derivation, not a shortcut) from `poc/m4/panel-data.mjs`'s
 * `computeGlyph`, the derivation the M4a POC proved against every real run
 * on disk. Ladder wording (M4a scope item 4):
 *  - `[✓]` passed — a history row with `outcome:'complete'`.
 *  - `[✗]` failed — a history row with any other outcome (never `[?]`).
 *  - `[·]` waiting on you — parked (`ask.json` present), no consumed answer.
 *  - `[·]` answered, not resumed yet — parked, a consumed answer exists, but
 *    no history row yet (resume hasn't finished) — always in words, never
 *    the same line as "waiting on you", never `[?]`.
 *  - `[?]` died / unknown — no history row, no open ask, no consumed answer:
 *    `resume.lock` carries no pid and nothing checks liveness (M4a's own
 *    open POC question), so a crashed resumer and a live one look the same
 *    on disk. Never guessed into `[✗]` or `[✓]`.
 * @param {{historyRow: any, askJson: any, consumedAnswerExists: boolean, hasStateJson: boolean}} ctx
 * @returns {{glyph: '[✓]'|'[✗]'|'[·]'|'[?]', label: string}}
 */
export function computeGlyph({
  historyRow, askJson, consumedAnswerExists, hasStateJson,
}) {
  if (historyRow) {
    if (historyRow.outcome === 'complete') return { glyph: '[✓]', label: 'passed' };
    return { glyph: '[✗]', label: `failed (${historyRow.outcome ?? 'unknown outcome'})` };
  }
  // No history row. A park never writes one, and a consumed answer file
  // stays on disk until resume writes its own history row — "no history
  // row" alone never means died.
  if (askJson && !consumedAnswerExists) {
    return { glyph: '[·]', label: 'waiting on you (parked, unanswered)' };
  }
  if (askJson && consumedAnswerExists) {
    return { glyph: '[·]', label: 'answered, not resumed yet' };
  }
  if (hasStateJson && !askJson) {
    return { glyph: '[?]', label: 'running or died: unknown (parked state with no open ask and no history row)' };
  }
  return { glyph: '[?]', label: 'running or died: unknown (resume.lock has no pid, no liveness check)' };
}

/**
 * "$X.XXXX" or, when the book itself says the number is a floor
 * (`spendComplete:false`), "at least $X.XXXX" — never a bare total presented
 * as complete when it isn't (negative scenario iv), and never `$0` standing
 * in for a missing/unknown number (project rule).
 * @param {number|null|undefined} spentUsd
 * @param {boolean|undefined} spendComplete
 * @returns {{ok:true, display:string}|{ok:false, why:string}}
 */
export function costDisplay(spentUsd, spendComplete) {
  if (typeof spentUsd !== 'number') {
    return { ok: false, why: 'spentUsd is not a number' };
  }
  if (spendComplete === false) {
    return { ok: true, display: `at least $${spentUsd.toFixed(4)}` };
  }
  return { ok: true, display: `$${spentUsd.toFixed(4)}` };
}

/**
 * A floor summed from whatever priced rows a run's own `spend.jsonl`
 * already recorded — used ONLY when there is no history row yet (died or
 * still parked) to show "at least $X" rather than nothing/zero. `null`
 * (never `$0`) when zero rows are priced yet.
 * @param {any[]} spendRows
 * @returns {string|null}
 */
function spendFloorDisplay(spendRows) {
  const priced = spendRows.filter((r) => typeof r.costUsd === 'number' && Number.isFinite(r.costUsd));
  if (priced.length === 0) return null;
  const sum = priced.reduce((acc, r) => acc + r.costUsd, 0);
  return `at least $${sum.toFixed(4)}`;
}

/**
 * The model this run's own book rows actually name — hamr's review #1/#7:
 * no `declaration.json`/`signature.json` field records a model at all (the
 * flow's steps carry primitives and a close class, never a model choice),
 * so `audit.jsonl`'s own per-attempt `model` field (`src/books.js`'s
 * `appendAudit` row shape) is the ONLY book that can answer "what model did
 * this run use" — never invented, never defaulted to a catalogue/provider
 * default the run may not have actually hit. Reads book order BACKWARDS and
 * returns the LAST row that names a model (the most recent attempt's own
 * choice), so a run that changed model slot mid-run (would show as a
 * `modelMatch:"substituted"` row) still reports what actually ran last,
 * never a stale first-attempt value. `null` (never a guess) when no row in
 * this run ever named one (e.g. every step is `hitl`, no model step ran).
 * No provider/API-kind field exists in ANY book (`src/provider.js`'s
 * `PROVIDER_SLOTS` maps a slot name to a model, but nothing writes which
 * slot served a given run back to `audit.jsonl`/`spend.jsonl`) — provider is
 * never shown alongside it (hamr's own instruction: "if the provider isn't
 * in any book, show model only").
 * @param {any[]} auditRows
 * @returns {string|null}
 */
export function deriveRunModel(auditRows) {
  for (let i = auditRows.length - 1; i >= 0; i -= 1) {
    const m = auditRows[i]?.model;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return null;
}

/**
 * The Audit tab's "Action" column (hamr's review #6): derived STRICTLY from
 * a row's own fields, never guessed and never "unknown action" — every
 * shape `src/runner.js`/`src/books.js` can actually write resolves to a
 * named action:
 *  - a `paused` verdict is the run handing off to a human ask right now —
 *    "paused for you", regardless of close class (a pause carries no model).
 *  - a row with a non-empty `model` field is a real model call — "model
 *    call (<model>)" (the exact model the row itself named, never a
 *    catalogue default).
 *  - a `hitl`-classed row with NO model (an ask step's own resolution —
 *    accept/reject/hitl/refused/an expiry) is a human's own action —
 *    "human".
 *  - anything else with no model and no hitl class (a mechanical
 *    green/not-done/red close with no model call recorded, or a crash-like
 *    stop) falls back to the row's own verdict word — never invented, and
 *    never the disallowed "unknown action" string.
 * @param {any} row one `audit.jsonl` row
 * @returns {string}
 */
export function deriveAuditAction(row) {
  if (row?.verdict === 'paused') return 'paused for you';
  if (typeof row?.model === 'string' && row.model.length > 0) return `model call (${row.model})`;
  if (row?.class === 'hitl') return 'human';
  if (typeof row?.verdict === 'string' && row.verdict.length > 0) return row.verdict;
  return 'no action recorded';
}

/**
 * The Audit tab's Cost cell token phrase (hamr's 2026-09-27 review item c):
 * a per-ROW token total, read through `auditRowTokens` (`src/books.js`) so
 * this module never re-derives "was this row written before M4a-2" itself.
 * Three honest outcomes, never folded into one another:
 *  - `{kind:'total', total}` — a real (post-M4a-2) model-call row: `total`
 *    sums ALL three fields the row's own `tokens` object carries
 *    (`inputTokens + outputTokens + cacheReadTokens`) — every token this
 *    row's call actually touched, cache-read included (labelled plainly as
 *    "N tokens", never split out here; a cache-read token is still a token
 *    the call processed, so folding it into the total is the honest sum,
 *    not a hidden discount).
 *  - `{kind:'not-recorded'}` — a row written before Amendment M4a-2 (no
 *    `tokens` key at all) — shown as "tokens not recorded", never a 0 or a
 *    blank.
 *  - `{kind:'no-model'}` — a post-M4a-2 row that genuinely carries no model
 *    call (`tokens:null`, `model:null` — an ask/hitl row) — the tokens
 *    phrase is omitted entirely rather than shown as "0 tokens" or "not
 *    recorded" (there was never anything to record).
 * @param {any} row one `audit.jsonl` row
 * @returns {{kind:'total', total:number}|{kind:'not-recorded'}|{kind:'no-model'}}
 */
export function deriveAuditTokensDisplay(row) {
  const result = auditRowTokens(row);
  if (result.tokens === null) {
    return result.why ? { kind: 'not-recorded' } : { kind: 'no-model' };
  }
  const { inputTokens, outputTokens, cacheReadTokens } = result.tokens;
  return { kind: 'total', total: inputTokens + outputTokens + cacheReadTokens };
}

/**
 * The Audit tab's new Time column (hamr's 2026-09-27 review item d): this
 * row's own `why` when `at` predates Amendment M4a-2, else `null` (the row
 * DOES carry a real `at` — the client formats it with `readableDateTime`,
 * the same local-time formatter every other timestamp on this page already
 * uses; formatting to the viewer's own locale belongs in the browser, not
 * here). Read through `auditRowAt` (`src/books.js`) — never re-derived.
 * @param {any} row one `audit.jsonl` row
 * @returns {string|null}
 */
export function deriveAuditAtWhy(row) {
  return auditRowAt(row).why ?? null;
}

/**
 * Run-level totals from `spend.jsonl` (hamr's review #1): rounds, input/
 * output/cache-read tokens — shown ONLY as a run-wide sum, never attributed
 * to a step (a spend row carries no `step` field at all — `src/model-step.js`
 * appends it before any step identity is threaded through, so per-step
 * attribution would be invented, not read). Honest about partial data: a
 * field this run's rows never populated (e.g. no row ever carried
 * `tokens.cacheReadTokens`) is `null` with its own `*Why`, never folded into
 * a 0. `null` `rows`/`empty:true` (with a why) when spend.jsonl has no rows
 * at all yet.
 * @param {any[]} spendRows
 * @returns {{empty:true, why:string}|{empty:false, rounds:number, tokensIn:number|null, tokensInWhy:string|null, tokensOut:number|null, tokensOutWhy:string|null, cacheReadTokens:number|null, cacheReadTokensWhy:string|null}}
 */
export function summarizeSpendRows(spendRows) {
  if (!Array.isArray(spendRows) || spendRows.length === 0) {
    return { empty: true, why: 'spend.jsonl has no rows yet (no model round has been priced)' };
  }
  const rounds = spendRows.reduce((acc, r) => acc + (typeof r.rounds === 'number' ? r.rounds : 0), 0);
  const sumTokenField = (field) => {
    let any = false;
    let total = 0;
    for (const r of spendRows) {
      const v = r?.tokens?.[field];
      if (typeof v === 'number' && Number.isFinite(v)) { any = true; total += v; }
    }
    return any ? total : null;
  };
  const tokensIn = sumTokenField('inputTokens');
  const tokensOut = sumTokenField('outputTokens');
  const cacheReadTokens = sumTokenField('cacheReadTokens');
  return {
    empty: false,
    rounds,
    tokensIn,
    tokensInWhy: tokensIn === null ? 'no spend.jsonl row recorded input tokens' : null,
    tokensOut,
    tokensOutWhy: tokensOut === null ? 'no spend.jsonl row recorded output tokens' : null,
    cacheReadTokens,
    cacheReadTokensWhy: cacheReadTokens === null ? 'no spend.jsonl row recorded cache-read tokens' : null,
  };
}

/**
 * Read every book fwdloop can hold for one run, once. The shared context
 * every deriver below (and the POC before it) builds its fields from.
 * @param {string} root
 * @param {string} flowDir
 * @param {string} runDir
 * @param {string} flowName
 * @param {string} runId
 * @param {any} catalogue
 * @returns {any}
 */
function loadRunContext(root, flowDir, runDir, flowName, runId, catalogue) {
  const flowRead = readFlow({ root, name: flowName, catalogue });
  const historyRows = readHistory(flowDir);
  const historyRow = historyRows.find((r) => r && r.runId === runId) ?? null;
  const auditRows = readAudit(runDir);
  const spendRows = readSpendRows(join(runDir, 'spend.jsonl'));
  const logJson = readLog(runDir);
  const askJson = readAsk(runDir);
  const stateJson = readRunState(runDir);
  const consumedAnswerExists = hasConsumedAnswer(runDir);

  return {
    flowName,
    runId,
    flowDir,
    runDir,
    flowRead,
    historyRow,
    auditRows,
    spendRows,
    logJson,
    askJson,
    stateJson,
    consumedAnswerExists,
    hasStateJson: stateJson !== null,
  };
}

/**
 * `GET /api/runs` — every flow under `root`, every run under each flow
 * (M4a scope item 2). A flow with zero runs still gets one row (`runId:
 * null`, an explicit `why`) — no flow is silently missing from the list.
 * Newest-first by history `at` where known; a row with no history row (died
 * or still parked) sorts after every row that has one, in flow/run order
 * (a real ordering, never `Date.now()` guessed in for a missing `at`).
 * @param {{root: string, catalogue: any}} opts
 * @returns {any[]}
 */
export function listRuns({ root, catalogue }) {
  const rows = [];
  for (const flowName of listFlowNames(root)) {
    const flowDir = join(root, flowName);
    const runIds = listRunIds(flowDir);
    if (runIds.length === 0) {
      rows.push({
        flow: flowName, runId: null, glyph: null, label: null, spend: null, at: null,
        why: 'this flow has no runs yet',
      });
      continue;
    }
    for (const runId of runIds) {
      const run = resolveRunPath(root, flowName, runId);
      if (!run.ok) {
        rows.push({
          flow: flowName, runId, glyph: null, label: null, spend: null, at: null, why: run.red,
        });
        continue;
      }
      const ctx = loadRunContext(root, run.flowDir, run.runDir, flowName, runId, catalogue);
      const { glyph, label } = computeGlyph(ctx);
      let spend;
      if (ctx.historyRow) {
        const cd = costDisplay(ctx.historyRow.spentUsd, ctx.historyRow.spendComplete);
        spend = cd.ok ? cd.display : null;
      } else {
        spend = spendFloorDisplay(ctx.spendRows);
      }
      // browser re-walk bug #4: a parked run's ask.json holds a real,
      // book-held timestamp (`askedAt`) — a run with an open ask is never
      // "unknown", even with no history row yet. `atWhy`'s generic "no
      // history row" text is reserved for the case that's ACTUALLY true of
      // it: no history row AND no ask either (e.g. died before ever
      // parking) — never rendered when the books do hold a date.
      const askedAt = (!ctx.historyRow && ctx.askJson && typeof ctx.askJson.askedAt === 'string')
        ? ctx.askJson.askedAt
        : null;
      rows.push({
        flow: flowName,
        runId,
        glyph,
        label,
        spend,
        spendWhy: (!ctx.historyRow && spend === null) ? 'no history row yet and no priced spend.jsonl rows — nothing to floor' : null,
        at: ctx.historyRow ? ctx.historyRow.at : null,
        askedAt,
        atWhy: (ctx.historyRow || askedAt) ? null : 'no history row yet (parked or died before one was written)',
      });
    }
  }
  // Newest first by `at` where present; rows with no `at` keep flow/run
  // order (already alphabetical from listFlowNames/listRunIds) at the end.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const am = typeof a.row.at === 'string' ? Date.parse(a.row.at) : NaN;
      const bm = typeof b.row.at === 'string' ? Date.parse(b.row.at) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown) return bm - am;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/**
 * "try N" (map node / step-card badge) counts different things for
 * different close classes, and must never just be `attempts.length` (browser
 * re-walk bug #2): an ask (`hitl`-classed) step's audit rows are
 * paused/answer PAIRS — a `paused` row starts one ask shown to the human,
 * and its very next resolution row (the reject or the accept) is that SAME
 * try, never a second one. So a paused, reject, paused, accept shape (4
 * rows) is 2 tries, not 4. A model-classed step has no pause/answer
 * pairing at all — each row IS one model attempt, so try N stays
 * `list.length` there, unchanged from before this fix.
 * @param {string|null} closeClass
 * @param {Array<{verdict:string}>} list
 * @returns {number}
 */
function computeTryCount(closeClass, list) {
  if (!list || !list.length) return 0;
  if (closeClass === 'hitl') {
    const pausedCount = list.filter((a) => a.verdict === 'paused').length;
    // No paused row at all is not a shape this step ever produces in
    // practice, but falls back to the row count rather than 0 — a missing
    // pause is never grounds to hide that a try happened.
    return pausedCount > 0 ? pausedCount : list.length;
  }
  return list.length;
}

/**
 * `GET /api/runs/:flow/:runId` — the Run tab (M4a scope item 2): the step
 * map from `declaration.steps`, step cards -> attempts from `audit.jsonl`
 * (verdict, gap, cost, model, strike), and what the model wrote from
 * `log.json`. `null` when the flow/runId doesn't resolve to a real run
 * directory at all (caller renders 404); a `red` field names why a
 * sub-derivation couldn't fill (never invented).
 * @param {{root: string, flow: string, runId: string, catalogue: any}} opts
 * @returns {any|null}
 */
export function getRunDetail({
  root, flow, runId, catalogue,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;

  const ctx = loadRunContext(root, run.flowDir, run.runDir, flow, runId, catalogue);
  const { glyph, label } = computeGlyph(ctx);

  let steps = null;
  let stepsWhy = null;
  if (!ctx.flowRead.ok) {
    stepsWhy = `readFlow refused: ${ctx.flowRead.reds.join('; ')}`;
  } else {
    const declSteps = ctx.flowRead.declaration.steps;
    if (!Array.isArray(declSteps) || declSteps.length === 0) {
      stepsWhy = 'declaration.json has no steps array';
    } else {
      const byStep = {};
      const byStepAuditIdx = {}; // step -> this row's index in ctx.auditRows, parallel to byStep[step]
      ctx.auditRows.forEach((row, auditIdx) => {
        (byStep[row.step] ??= []).push({
          attempt: row.attempt,
          verdict: row.verdict,
          gap: row.gap,
          cost: row.usd,
          spendComplete: row.spendComplete,
          model: row.model,
          modelMatch: row.modelMatch,
          strike: row.strike,
          afterReject: null,
        });
        (byStepAuditIdx[row.step] ??= []).push(auditIdx);
      });
      // A step's own attempt numbers can repeat/restart in book order after
      // a human reject (src/runner.js's redo path numbers a redo from the
      // reject count, not the previous attempt counter — M4a piece 3 fix
      // #6). Never renumber or hide a row; instead name the boundary, but
      // ONLY on a non-ask step: an ask (`hitl`-classed) step's OWN rows
      // legitimately repeat the same attempt number for a paused row
      // followed by its own resolution (paused N, then red/green N) — that
      // pairing is the normal shape, never a restart, and must never be
      // mislabelled (coordinator's re-walk: labelling both rows of an ask
      // step's pause+reject pair was the exact bug this guards against). A
      // restart whose interleaved reject can't be found gets NO label at
      // all — a missing hint beats a wrong one.
      for (const s of declSteps) {
        if (s.close?.class === 'hitl') continue;
        const list = byStep[s.emits];
        const idxs = byStepAuditIdx[s.emits];
        if (!list) continue;
        for (let i = 1; i < list.length; i += 1) {
          if (list[i].attempt > list[i - 1].attempt) continue;
          let rejectRow = null;
          for (let j = idxs[i - 1] + 1; j < idxs[i]; j += 1) {
            const r = ctx.auditRows[j];
            if (r.class === 'hitl' && r.verdict === 'red') rejectRow = r;
          }
          if (rejectRow) list[i].afterReject = rejectRow.gap;
        }
      }
      steps = declSteps.map((s) => ({
        emits: s.emits,
        goal: s.goal,
        primitives: s.primitives ?? null,
        closeClass: s.close?.class ?? null,
        attempts: byStep[s.emits] ?? [],
        attemptsWhy: byStep[s.emits] ? null : 'no audit.jsonl rows yet for this step',
        tryCount: computeTryCount(s.close?.class ?? null, byStep[s.emits] ?? []),
      }));
    }
  }

  let modelWrote = null;
  let modelWroteWhy = null;
  if (!ctx.logJson) {
    modelWroteWhy = ctx.historyRow
      ? `run "${runId}" completed (history row present) but log.json is missing`
      : 'log.json has not been written yet (parked before any close, or still running)';
  } else {
    modelWrote = { artifacts: ctx.logJson.artifacts ?? null, attempts: ctx.logJson.attempts ?? null };
  }

  // A run that completed clean never shows a stop reason, full stop — an
  // earlier attempt on some step can carry a superseded not-done/red row
  // (a human rejected a draft, or a first pass missed the shape, and a
  // later attempt on the SAME step went on to pass) even though the run as
  // a whole finished clean. Checking `historyRow.outcome === 'complete'`
  // FIRST, before ever looking at `auditRows`, is what keeps a passed run
  // from reporting a stale, superseded failure as its own "why" (found live
  // against `flows/`, M4a piece 3 fix #1 — a real run, not a synthetic
  // fixture, is what caught this).
  let stopReason = null;
  let stopReasonWhy = null;
  if (ctx.historyRow && ctx.historyRow.outcome === 'complete') {
    stopReasonWhy = 'run completed clean — there is no stop reason to show';
  } else if (ctx.logJson && typeof ctx.logJson.red === 'string' && ctx.logJson.red.length > 0) {
    stopReason = ctx.logJson.red;
  } else {
    // The LAST matching row, not the first — a step can fail, then redo and
    // fail again differently (or fail on a later step entirely); the most
    // recent stop is the one that actually describes where the run sits now.
    let redRow = null;
    for (const r of ctx.auditRows) {
      if (r.verdict === 'not-done' || r.verdict === 'red') redRow = r;
    }
    if (redRow) {
      stopReason = `${redRow.step}: ${redRow.gap}`;
    } else {
      stopReasonWhy = 'run has not stopped on a red/not-done step (still parked, waiting, or clean so far)';
    }
  }

  // "took Xs" for a finished run (M4a piece 3 fix #5) — straight off the
  // history row's own `wallMs` (never derived/guessed); a died/parked run
  // (no history row) or a history row predating this field both say why
  // rather than showing nothing.
  const wallMs = ctx.historyRow && typeof ctx.historyRow.wallMs === 'number' ? ctx.historyRow.wallMs : null;
  const wallMsWhy = wallMs !== null
    ? null
    : (ctx.historyRow ? 'history row has no wallMs recorded' : 'no history row yet (parked or died before completion)');

  let spend;
  if (ctx.historyRow) {
    const cd = costDisplay(ctx.historyRow.spentUsd, ctx.historyRow.spendComplete);
    spend = cd.ok ? cd.display : null;
  } else {
    spend = spendFloorDisplay(ctx.spendRows);
  }

  // hamr's review #1 (Summary tab): model + spend.jsonl totals — read here
  // ONCE, off the same auditRows/spendRows this function already loaded, so
  // the Run tab's summary box and the step cards can never disagree about
  // what model ran or what spend.jsonl actually holds.
  const model = deriveRunModel(ctx.auditRows);
  const modelWhy = model === null ? 'no audit.jsonl row in this run has ever named a model (no model step has run yet)' : null;
  const spendSummary = summarizeSpendRows(ctx.spendRows);

  return {
    flow,
    runId,
    glyph,
    label,
    outcome: ctx.historyRow ? ctx.historyRow.outcome : null,
    outcomeWhy: ctx.historyRow ? null : 'no history row (parked or died before completion)',
    capUsd: ctx.historyRow ? ctx.historyRow.capUsd : (ctx.flowRead.ok ? ctx.flowRead.arbiter.capUsd : null),
    spend,
    model,
    modelWhy,
    spendSummary,
    wallMs,
    wallMsWhy,
    steps,
    stepsWhy,
    modelWrote,
    modelWroteWhy,
    stopReason,
    stopReasonWhy,
    at: ctx.historyRow ? ctx.historyRow.at : null,
    // browser re-walk bug #4: same "the books hold a date, so never say
    // unknown" rule as listRuns above — a parked run's own ask.json
    // `askedAt` is a real timestamp, shown ahead of the generic `atWhy`.
    askedAt: (!ctx.historyRow && ctx.askJson && typeof ctx.askJson.askedAt === 'string')
      ? ctx.askJson.askedAt
      : null,
    atWhy: (ctx.historyRow || (ctx.askJson && typeof ctx.askJson.askedAt === 'string'))
      ? null
      : 'no history row yet (parked or died before completion)',
  };
}

/**
 * `GET /api/runs/:flow/:runId/audit` — the Audit/logs tab (M4a scope item
 * 2): the raw `audit.jsonl` rows, scoped strictly to this run (each run's
 * own `audit.jsonl` file already carries only its own rows — there is no
 * shared-sidecar contamination risk here the way bareloop's gate-audit
 * sidecar had). `null` when the flow/runId doesn't resolve (404).
 * @param {{root: string, flow: string, runId: string}} opts
 * @returns {{flow:string, runId:string, rows:any[], empty:boolean, why:string|null}|null}
 */
export function getRunAudit({ root, flow, runId }) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;
  const rawRows = readAudit(run.runDir);
  // hamr's review #6: the Audit tab's "Action" column is derived server-side
  // (never guessed client-side from partial data) — `action` is added to
  // each row here, off that SAME row's own fields, book order preserved.
  // hamr's 2026-09-27 review items (c)/(d): the Cost cell's token phrase
  // (`tokensDisplay`) and the new Time column's old-row "why" (`atWhy`) are
  // likewise derived here, off this same row, never client-side.
  const rows = rawRows.map((row) => ({
    ...row,
    action: deriveAuditAction(row),
    tokensDisplay: deriveAuditTokensDisplay(row),
    atWhy: deriveAuditAtWhy(row),
  }));
  return {
    flow,
    runId,
    rows,
    empty: rows.length === 0,
    why: rows.length === 0 ? 'audit.jsonl is empty or missing — no attempt has been made yet' : null,
  };
}

/**
 * `GET /api/runs/:flow/:runId/job` — the Job tab (M4a scope item 2): the
 * signed prose, the arbiter block (cap, asks with TTL, redo cap, sends,
 * sources), and the signature (who, when, hash). Derived purely from the
 * flow's own signed files (`readFlow`) — fwdloop always has exactly one
 * signed `declaration.json` + `signature.json` per flow, so there is no
 * multi-source provenance chain to resolve (unlike bareloop's `getRunJob` —
 * DROPPED per the fit-check). `runId` is only used to confirm the run
 * exists at all; `null` when it doesn't (404).
 * @param {{root: string, flow: string, runId: string, catalogue: any}} opts
 * @returns {any|null}
 */
export function getRunJob({
  root, flow, runId, catalogue,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;

  const flowRead = readFlow({ root, name: flow, catalogue });
  if (!flowRead.ok) {
    return {
      flow, runId, resolved: false, why: `readFlow refused: ${flowRead.reds.join('; ')}`,
    };
  }
  const sig = flowRead.signature;
  // hamr's review #7: the Job tab is missing the model name entirely — the
  // signed declaration/signature never record one (checked: no module in
  // `src/` writes a `model` field into either), so this reads the SAME
  // per-attempt `audit.jsonl` field the Run tab's summary uses
  // (`deriveRunModel`) and says so plainly when it does, rather than
  // pretending the signed prose named it.
  const auditRows = readAudit(run.runDir);
  const model = deriveRunModel(auditRows);
  return {
    flow,
    runId,
    resolved: true,
    model,
    // `model` is read from this run's own audit.jsonl rows, never the signed
    // prose/declaration (neither records one) — the page says so in words
    // ("model used: X (from this run's rows)") rather than implying it came
    // from the signed job itself.
    modelWhy: model === null ? 'no audit.jsonl row for this run has ever named a model' : null,
    lines: flowRead.lines,
    arbiter: {
      capUsd: flowRead.arbiter.capUsd,
      asks: flowRead.arbiter.asks ?? [],
      redoCap: flowRead.arbiter.redoCap,
      sends: flowRead.arbiter.sends ?? [],
      sources: flowRead.arbiter.sources ?? [],
    },
    signature: (sig && typeof sig.signedBy === 'string' && typeof sig.signedAt === 'string' && typeof sig.flow === 'string')
      ? { signedBy: sig.signedBy, signedAt: sig.signedAt, hash: sig.flow }
      : null,
    signatureWhy: (sig && typeof sig.signedBy === 'string' && typeof sig.signedAt === 'string' && typeof sig.flow === 'string')
      ? null
      : 'signature.json is missing signedBy/signedAt/flow (hash)',
  };
}

// ---------------------------------------------------------------------------
// M4a Amendment M4a-1 — the panel's Inbox/Ask surface (docs/wiki/the-module-
// ladder.md, "M4a" section, signed 2026-09-27). Every stop (parked ask) this
// panel can name is read through ONE reader per run —
// `listArchivedAsks(runDir)` (`src/ask.js`) for a run that has an `asks/`
// archive, or `legacyRunAsks` (below, THIS module's own reader) for a run
// that predates M4a-1 (no `asks/` directory at all) — never a third,
// ad-hoc reconstruction. Status vocabulary, used everywhere in the panel
// (Inbox list, Ask tab, both API responses), is exactly the words
// `listArchivedAsks` itself already returns from the books' own decision
// field: `accepted` / `rejected` / `reran` / `expired` / `unanswered` (a
// parked, not-yet-expired ask with no consumed answer — this IS "open" in
// the UI) / `open` (the rare case `listArchivedAsks` falls back to when an
// archived ask.json itself fails to parse — no question/evidence can be
// read for it either). Nothing here invents a question, a draft, or a
// decision that no book actually recorded.
// ---------------------------------------------------------------------------

/**
 * An ask row is "open" (still waiting on a human, right now) exactly when
 * its book-derived status is `unanswered` (parked, not yet answered, not
 * expired — `listArchivedAsks` already applies the expiry check at read
 * time) or the rare unparseable-archive fallback `open`. Every other status
 * (`accepted`/`rejected`/`reran`/`expired`, or an `unrecognised: X` decision
 * value) is a PAST stop.
 * @param {string} status
 * @returns {boolean}
 */
function isOpenStatus(status) {
  return status === 'unanswered' || status === 'open';
}

/**
 * `readAskEvidence`'s own return shape (`src/ask.js`) carries the draft as
 * `{ text: string } | null` (never a bare string) so a caller can tell "no
 * draft" apart from "a draft with an empty string" — this panel's UI wants
 * a flat, renderable string instead. The ONE place that unwraps `.text`, so
 * every row this module produces (archived or legacy) carries the same
 * flat `{ draft: string|null, unjudged, why }` shape.
 * @param {ReturnType<typeof readAskEvidence>} evidence
 * @returns {{draft: string|null, unjudged: any[], why?: string}}
 */
function flattenEvidence(evidence) {
  return {
    draft: evidence.draft ? evidence.draft.text : null,
    unjudged: evidence.unjudged,
    why: evidence.why,
  };
}

/**
 * Flattens one `listArchivedAsks` entry (its nested `answer` object) into
 * this module's own flat row shape, shared by both the archived and
 * pre-M4a-1 legacy paths so callers (the Inbox list, the Ask tab, both
 * routes) never have to branch on which reader produced a row.
 * @param {any} a one entry of `listArchivedAsks(runDir).asks`
 * @returns {any}
 */
function normalizeArchivedRow(a) {
  return {
    askId: a.askId,
    question: a.question ?? null,
    askedAt: a.askedAt ?? null,
    expiresAt: a.expiresAt ?? null,
    status: a.answer.status,
    reason: a.answer.reason ?? null,
    answeredAt: a.answer.answeredAt ?? null,
    archived: true,
    evidence: flattenEvidence(a.evidence),
  };
}

/** `^answer\.<askId>\.consumed\.json$` — deliberately excludes
 *  `answer.stale.<n>.json` (no capture group would match "stale" as a real
 *  askId; the stale-quarantine writer in `src/ask.js` uses that different
 *  name specifically so this convention-based scan never mistakes a
 *  quarantined stale answer for a real consumed one). */
const CONSUMED_ANSWER_RE = /^answer\.(.+)\.consumed\.json$/;

/**
 * The pre-M4a-1 fallback reader (M4a-1 scope item 1): for a run with no
 * `asks/` archive directory at all, reconstructs what the books STILL hold —
 * the current (single-slot, mutable) `ask.json`, if any, plus every
 * `answer.<askId>.consumed.json` marker still on disk. A past askId's own
 * question/draft can never be recovered (the single ask.json slot was
 * overwritten by the next park) — those fields come back `null` with the
 * fixed `why` the brief specifies, never guessed from the CURRENT ask.json
 * (which may name a completely different, later question).
 * @param {string} runDir
 * @returns {any[]}
 */
function legacyRunAsks(runDir) {
  const rows = [];
  let names = [];
  try { names = readdirSync(runDir); } catch { names = []; }

  const askJson = readAsk(runDir);
  const currentAskId = askJson && typeof askJson.askId === 'string' ? askJson.askId : null;

  const consumedFiles = names.filter((n) => CONSUMED_ANSWER_RE.test(n)).sort();
  const decisionToStatus = { accept: 'accepted', reject: 'rejected', rerun: 'reran' };

  for (const file of consumedFiles) {
    const match = CONSUMED_ANSWER_RE.exec(file);
    if (!match) continue; // eslint-disable-line no-continue -- filtered by the same regex above; never actually null
    const askId = match[1];
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(runDir, file), 'utf8'));
    } catch {
      continue; // eslint-disable-line no-continue -- a torn write is skipped, never invented
    }
    // A consumed legacy row never recovers question/askedAt/expiresAt from
    // the CURRENT ask.json, even when its askId happens to still match it —
    // the single mutable slot is not a reliable append log for a past ask
    // (a later park would silently overwrite it), so this deliberately
    // shows only what a consumed-answer marker itself can prove: askId,
    // decision, reason, answeredAt (brief, M4a-1 scope item 1).
    rows.push({
      askId,
      question: null,
      questionWhy: 'question not kept (before M4a-1)',
      askedAt: null,
      expiresAt: null,
      status: decisionToStatus[parsed.decision] ?? `unrecognised: ${parsed.decision}`,
      reason: typeof parsed.reason === 'string' ? parsed.reason : null,
      answeredAt: typeof parsed.answeredAt === 'string' ? parsed.answeredAt : null,
      archived: false,
      evidence: { draft: null, unjudged: [], why: 'draft not kept (before M4a-1)' },
    });
  }

  // The currently open ask, when its own askId has no consumed marker yet.
  if (askJson) {
    const hasConsumed = currentAskId !== null
      && consumedFiles.includes(`answer.${currentAskId}.consumed.json`);
    if (!hasConsumed) {
      if (currentAskId === null) {
        // A genuine pre-M3 ask.json: no askId/expiresAt at all — cannot be
        // paired with a future answer or timed, shown for visibility only.
        rows.push({
          askId: null,
          question: askJson.question ?? null,
          askedAt: askJson.askedAt ?? null,
          expiresAt: null,
          status: 'unanswered',
          reason: null,
          answeredAt: null,
          archived: false,
          evidence: flattenEvidence(readAskEvidence(askJson)),
          why: 'pre-M3 ask.json (no askId/expiresAt) — not answerable, shown for visibility only',
        });
      } else {
        const expiresMs = typeof askJson.expiresAt === 'string' ? Date.parse(askJson.expiresAt) : NaN;
        const expired = !Number.isNaN(expiresMs) && Date.now() > expiresMs;
        rows.push({
          askId: currentAskId,
          question: askJson.question ?? null,
          askedAt: askJson.askedAt ?? null,
          expiresAt: askJson.expiresAt ?? null,
          status: expired ? 'expired' : 'unanswered',
          reason: null,
          answeredAt: null,
          archived: false,
          evidence: flattenEvidence(readAskEvidence(askJson)),
        });
      }
    }
  }

  return rows;
}

/**
 * Every ask (open or past) this run's own books can name, oldest first —
 * archived (`asks/<askId>.json`, M4a-1) when the run has that directory,
 * else the pre-M4a-1 fallback (`legacyRunAsks`). `listArchivedAsks` orders
 * its own entries by askId (a UUID, not chronological) — re-sorted here by
 * `askedAt` so the Ask tab reads as a real timeline; a row with no readable
 * `askedAt` (a legacy past entry — the field was never recoverable) sorts
 * after every row that has one, in the order `listArchivedAsks`/
 * `legacyRunAsks` themselves returned it.
 * @param {string} runDir
 * @returns {any[]}
 */
function runAsksInOrder(runDir) {
  const archivedResult = listArchivedAsks(runDir);
  const rows = archivedResult.archived
    ? archivedResult.asks.map(normalizeArchivedRow)
    : legacyRunAsks(runDir);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const am = typeof a.row.askedAt === 'string' ? Date.parse(a.row.askedAt) : NaN;
      const bm = typeof b.row.askedAt === 'string' ? Date.parse(b.row.askedAt) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown) return am - bm;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/**
 * `GET /api/runs/:flow/:runId/asks` — the Ask tab (M4a-1 scope item 1):
 * every ask this run's books can name, in order, each carrying full
 * evidence (`readAskEvidence`'s draft + unjudged, or the pre-M4a-1 `why`).
 * `null` when the flow/runId doesn't resolve (caller renders 404).
 * @param {{root: string, flow: string, runId: string}} opts
 * @returns {{flow:string, runId:string, asks:any[]}|null}
 */
export function getRunAsks({ root, flow, runId }) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;
  return { flow, runId, asks: runAsksInOrder(run.runDir) };
}

/**
 * `GET /api/inbox` — every stop (parked ask, open or past) across every
 * flow under `root` (M4a-1 scope item 1), read-only, no answer controls
 * (those are M4b). Sorted open-first (soonest-expiring first — the most
 * urgent), then every past stop newest-answered-first; a row with neither a
 * known time-left nor a known answeredAt sorts last within its group rather
 * than being guessed into either end.
 * @param {{root: string}} opts
 * @returns {any[]}
 */
export function listStops({ root }) {
  const rows = [];
  for (const flowName of listFlowNames(root)) {
    const flowDir = join(root, flowName);
    for (const runId of listRunIds(flowDir)) {
      const run = resolveRunPath(root, flowName, runId);
      if (!run.ok) continue;
      for (const ask of runAsksInOrder(run.runDir)) {
        const open = isOpenStatus(ask.status);
        const expiresMs = open && typeof ask.expiresAt === 'string' ? Date.parse(ask.expiresAt) : NaN;
        rows.push({
          flow: flowName,
          runId,
          ...ask,
          open,
          timeLeftMs: open && Number.isFinite(expiresMs) ? Math.max(0, expiresMs - Date.now()) : null,
        });
      }
    }
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.open !== b.row.open) return a.row.open ? -1 : 1;
      if (a.row.open && b.row.open) {
        const at = typeof a.row.timeLeftMs === 'number' ? a.row.timeLeftMs : Infinity;
        const bt = typeof b.row.timeLeftMs === 'number' ? b.row.timeLeftMs : Infinity;
        if (at !== bt) return at - bt;
        return a.index - b.index;
      }
      const am = typeof a.row.answeredAt === 'string' ? Date.parse(a.row.answeredAt) : NaN;
      const bm = typeof b.row.answeredAt === 'string' ? Date.parse(b.row.answeredAt) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown) return bm - am;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
