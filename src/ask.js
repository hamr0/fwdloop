// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope item 6): the file-checkpoint ask, in-process. Writes
// `ask.json` (question + evidence + askedAt + attempt) into the run dir and
// polls for `answer.json` (`{ decision: accept|redo|rerun, reason?,
// answeredAt }`). Consumed exactly once (renamed away on read); a stale
// answer — `answeredAt` older than THIS ask's `askedAt` — is quarantined
// (renamed to `answer.stale.<n>.json`, audited `stale-answer-ignored`) and
// never applied; a timeout returns `{ decision: 'timeout' }`, which
// `src/runner.js` must treat as a halt (a pause spends nothing).
//
// borrowed-from: fwdloop poc/m0/runner.mjs@76a3607 (`checkpointAsk`'s file
// protocol: `ask.json` out / poll `answer.json`, and the "ASK OPEN" stderr
// line so a human watching knows a run is waiting on them) and
// fwdloop poc/m0/answer.mjs@76a3607 (the answer file's own shape). Rewritten
// off bare-agent's `Checkpoint` (M0's dependency) onto a plain poll loop —
// M2's signed scope (item 6) calls for "M0's file checkpoint, in-process",
// not a second Checkpoint instance layered on top of the same file protocol.

import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { appendAudit } from './books.js';
import { readFileInside, resolveInside, readdirInside } from './flow.js';

/**
 * M4b amendment 3 (SIGNED by hamr 2026-09-30): the ONE translation of a
 * decision. The answer that was spelled `reject` is `redo`; `reject` is still
 * understood (from the CLI, the library, or a file an older version wrote) and
 * means `redo`. `accept`, `redo` and `rerun` pass. Anything else comes back
 * unchanged, so each caller's existing "unrecognised decision" refusal still
 * quotes what it was given. Every decision from outside, and every one read
 * from disk, goes through here; nothing else may compare against the old word.
 * @param {string} decision
 * @returns {string}
 */
export function normalizeDecision(decision) {
  return decision === 'reject' ? 'redo' : decision;
}

/** The one decision -> status table, used by `listArchivedAsks` here and by the panel's legacy-ask rows.
 *  Look it up with `normalizeDecision(decision)`. */
export const DECISION_STATUS = { accept: 'accepted', redo: 'redo', rerun: 'reran' };

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function safeStamp(iso) {
  return String(iso).replace(/[^0-9A-Za-z]/g, '-');
}

/**
 * @param {{ timeoutMs?: number, pollMs?: number, clock?: () => string, writeLine?: (line:string) => void }} [opts]
 * @returns {(opts:{question:string, evidence:unknown, runDir:string, ttlMs?: number}) => Promise<{decision:string, reason?:string}>}
 */
export function makeFileAskStep({
  timeoutMs = 120_000,
  pollMs = 500,
  clock = () => new Date().toISOString(),
  writeLine = (line) => { process.stderr.write(`${line}\n`); },
} = {}) {
  let attemptCounter = 0;

  return async function fileAskStep({
    question, evidence, runDir, ttlMs,
  }) {
    attemptCounter += 1;
    const attempt = attemptCounter;

    // M3 scope item 1 (fixes F43): a signed `ttlMs` threaded in by the
    // runner always governs — this constructor's own `timeoutMs` is only
    // ever the fallback for a DIRECT call that carries no signed ttl (e.g.
    // this module's own unit tests). No code default overrides a signed
    // value.
    const effectiveTimeoutMs = typeof ttlMs === 'number' ? ttlMs : timeoutMs;

    mkdirSync(runDir, { recursive: true });
    const askPath = join(runDir, 'ask.json');
    const answerPath = join(runDir, 'answer.json');
    const askedAt = clock();
    const askId = randomUUID();
    const expiresAt = new Date(Date.parse(askedAt) + effectiveTimeoutMs).toISOString();

    writeFileSync(askPath, JSON.stringify({
      askId, question, evidence, askedAt, expiresAt, attempt,
    }, null, 2));
    writeLine(`ASK OPEN (expires in ${Math.round(effectiveTimeoutMs / 1000)}s): ${question} — answer by writing ${answerPath}`);

    const deadline = Date.now() + effectiveTimeoutMs;
    let staleCount = 0;

    for (;;) {
      // F48 round 3: `answer.json` is checked with `resolveInside`
      // (`src/flow.js`) before it is ever read — a symlinked answer file (or
      // a symlinked run-dir ancestor) is treated exactly like "no answer
      // yet" (kept polling), never read through to an outside file's
      // content standing in for the human's real decision.
      const answerResolved = resolveInside(runDir, 'answer.json');
      if (answerResolved.ok) {
        let raw = null;
        try { raw = readFileSync(answerPath, 'utf8'); } catch { raw = null; }
        let parsed = null;
        if (raw !== null) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }

        if (parsed) {
          const { answeredAt } = parsed;
          const isStale = typeof answeredAt === 'string' && typeof askedAt === 'string' && answeredAt < askedAt;
          if (isStale) {
            staleCount += 1;
            let staleName = join(runDir, `answer.stale.${staleCount}.json`);
            while (existsSync(staleName)) { staleCount += 1; staleName = join(runDir, `answer.stale.${staleCount}.json`); }
            renameSync(answerPath, staleName);
            appendAudit(runDir, {
              step: 'ask', attempt, class: null, verdict: 'stale-answer-ignored', gap: `answeredAt ${answeredAt} predates this ask's askedAt ${askedAt}`, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: clock(), tokens: null, tools: null, refused: [],
            });
            // Keep polling — a stale file quarantined does not mean THIS
            // ask has been answered.
          } else {
            renameSync(answerPath, join(runDir, `answer.${safeStamp(askedAt)}.consumed.json`));
            return { decision: normalizeDecision(parsed.decision), reason: parsed.reason, artifactSha256: parsed.artifactSha256 };
          }
        }
      }

      if (Date.now() >= deadline) {
        return { decision: 'timeout' };
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollMs);
    }
  };
}

// ---------------------------------------------------------------------------
// F47 fix (docs/logs/FINDINGS.md F47, M4a ladder item 1): the ONE shared
// reader for ask.json's `evidence` field, across every real shape on disk —
// M3 (`evidence.artifact.text` + `evidence.unjudged[].artifact.text`), M2
// (`evidence.text`/`evidence.lines`, no unjudged concept), and none (parked
// before F45 finding 2 landed the evidence-carry fix, so no `evidence` key
// at all). `bin/fwdloop`'s `artifactText()`/`cmdShow` and `poc/m4/panel-
// data.mjs` both read ask.json evidence ad hoc today; this is the one
// place, per "one writer/one reader" (AGENT_RULES.md), that normalises it.
// Never returns "undefined"/""/0 standing in for missing data — an
// unparseable shape is a named `why`, never a crash, never silently empty.
// ---------------------------------------------------------------------------

/**
 * @param {any} ask the parsed ask.json object (or its `evidence` field's
 *   container — pass the whole ask so a missing `evidence` key is itself a
 *   handled case, not the caller's problem).
 * @returns {{ draft: {step?: string, text: string} | null, unjudged: Array<{step: string, emits?: string, text: string}>, why?: string }}
 */
export function readAskEvidence(ask) {
  const evidence = ask && typeof ask === 'object' ? ask.evidence : undefined;

  if (evidence === undefined || evidence === null) {
    return {
      draft: null,
      unjudged: [],
      why: 'this ask was parked before evidence was recorded (pre-F45 finding 2)',
    };
  }

  if (typeof evidence !== 'object') {
    return {
      draft: null,
      unjudged: [],
      why: `ask.json "evidence" is neither an object nor absent — unrecognised shape: ${typeof evidence}`,
    };
  }

  // M3 shape: evidence.artifact.text (+ evidence.unjudged[]).
  if (evidence.artifact && typeof evidence.artifact === 'object' && typeof evidence.artifact.text === 'string') {
    const rawUnjudged = Array.isArray(evidence.unjudged) ? evidence.unjudged : [];
    const unjudged = [];
    for (const item of rawUnjudged) {
      // `step` (an ask.json unjudged entry's own field name) actually
      // carries the step's GOAL text, not its id — `emits` (when present) is
      // the real step id (e.g. "resume-text"), dropped by the ONLY earlier
      // version of this reader (hamr's review #9, 2026-09-27: the panel's
      // Inbox was labelling by goal text because this function never
      // returned `emits` at all). Both are kept honestly: `step` falls back
      // to `emits` only when the entry names no goal text of its own,
      // `emits` is included ONLY when the entry actually names one — a
      // caller must never assume `emits` is present (an M2/no-`emits`
      // fixture omits it, never a guessed value).
      const step = item && (item.step ?? item.emits);
      const emits = item && typeof item.emits === 'string' ? item.emits : undefined;
      const text = item && item.artifact && typeof item.artifact.text === 'string' ? item.artifact.text : undefined;
      if (typeof step === 'string' && typeof text === 'string') {
        unjudged.push(emits ? { step, emits, text } : { step, text });
      }
      // An unjudged entry with neither a nameable step nor readable text is
      // dropped rather than shown as a blank row — the draft itself is
      // never lost by a malformed sibling entry.
    }
    return { draft: { text: evidence.artifact.text }, unjudged };
  }

  // M2 shape: evidence.text (+ evidence.lines) — no unjudged concept.
  if (typeof evidence.text === 'string') {
    return { draft: { text: evidence.text }, unjudged: [] };
  }

  // Present but neither recognised shape — never fall through to
  // `undefined`/`JSON.stringify(undefined)` ("undefined" the string).
  return {
    draft: null,
    unjudged: [],
    why: `ask.json "evidence" has neither ".artifact.text" (M3) nor ".text" (M2) — unrecognised shape: keys ${JSON.stringify(Object.keys(evidence))}`,
  };
}

// ---------------------------------------------------------------------------
// M3 piece 1 (docs/wiki/the-module-ladder.md, "M3 — scope, exit, negative —
// SIGNED", scope item 3, the function only — the CLI is piece 2): a separate
// process's half of the park protocol. Writes `answer.json` exactly once,
// refusing (never throwing) a blank reason on redo/rerun, an unknown
// askId, an expired askId, or a second answer to an already-answered ask —
// each by name, so an answer for ask A can never be consumed by ask B.
// ---------------------------------------------------------------------------

/**
 * M4b piece 3: the ONE serialisation of an artifact's bytes — what
 * `writeArtifact` (`src/runner.js`) puts on disk and what `sendViaPrimitive`
 * (`src/send.js`) ships. The accept hash and the send-time re-hash are both
 * over exactly this string, so they can only differ if the content does.
 * @param {unknown} artifact
 * @returns {string}
 */
export function serializeArtifact(artifact) {
  return JSON.stringify(artifact, null, 2);
}

/**
 * sha256 (hex) of the bytes `serializeArtifact` yields.
 * @param {string} serialised
 * @returns {string}
 */
export function sha256Hex(serialised) {
  return createHash('sha256').update(Buffer.from(serialised, 'utf8')).digest('hex');
}

/**
 * @param {{ runDir: string, askId: string, decision: 'accept'|'redo'|'reject'|'rerun', reason?: string, clock?: () => string }} opts
 * @returns {{ ok: true } | { ok: false, red: string }}
 */
export function answerAsk({
  runDir, askId, decision: givenDecision, reason, clock,
}) {
  const decision = normalizeDecision(givenDecision);
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();

  if (typeof runDir !== 'string' || runDir.length === 0) {
    return { ok: false, red: 'answerAsk: "runDir" must be a non-empty string' };
  }
  if (typeof askId !== 'string' || askId.length === 0) {
    return { ok: false, red: 'answerAsk: "askId" must be a non-empty string' };
  }
  if (decision !== 'accept' && decision !== 'redo' && decision !== 'rerun') {
    return { ok: false, red: `answerAsk: unrecognised decision "${givenDecision}"` };
  }

  // F48 round 3: routed through `readFileInside` — a symlinked `ask.json`
  // (or a symlinked run-dir ancestor) reads as "no open ask", never as some
  // outside file's content.
  const askRead = readFileInside(runDir, 'ask.json');
  if (!askRead.ok) {
    if (askRead.missing) {
      return { ok: false, red: `answerAsk: no open ask for run ${runDir}` };
    }
    return { ok: false, red: `answerAsk: ask.json for run ${runDir} — ${askRead.red}` };
  }
  let ask;
  try {
    ask = JSON.parse(askRead.text);
  } catch (err) {
    return { ok: false, red: `answerAsk: ask.json for run ${runDir} is not valid JSON — ${err.message}` };
  }
  if (ask.askId !== askId) {
    return { ok: false, red: `answerAsk: askId "${askId}" is unknown for run ${runDir}` };
  }

  const nowIso = now();
  // A present-but-unparseable expiresAt (Date.parse -> NaN) must never read
  // as "not expired" — `NaN > x`/`x > NaN` are both false, so the comparison
  // below would silently treat garbage as "still open forever". Refuse by
  // name instead, naming the askId and the bad value.
  if (Number.isNaN(Date.parse(ask.expiresAt))) {
    return { ok: false, red: `answerAsk: askId "${askId}" has an unparseable expiresAt "${ask.expiresAt}" for run ${runDir} — refusing rather than treating it as not-expired` };
  }
  if (Date.parse(nowIso) > Date.parse(ask.expiresAt)) {
    return { ok: false, red: `answerAsk: askId "${askId}" expired at ${ask.expiresAt} for run ${runDir}` };
  }

  const answerPath = join(runDir, 'answer.json');
  // A consumed marker survives long after the run has moved on (or ended) —
  // it must still refuse a second answer naming the SAME askId, never only
  // while answer.json happens to still be sitting there.
  if (existsSync(join(runDir, `answer.${askId}.consumed.json`))) {
    return { ok: false, red: `answerAsk: askId "${askId}" already answered for run ${runDir}` };
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if ((decision === 'redo' || decision === 'rerun') && trimmedReason.length === 0) {
    return { ok: false, red: `answerAsk: askId "${askId}" needs a non-blank reason to ${decision}` };
  }

  const payload = { askId, decision, answeredAt: nowIso };
  if (trimmedReason.length > 0) payload.reason = trimmedReason;
  // M4b scope item 4 (F48 finding C): an accept records the sha256 of the
  // artifact the human was shown — `ask.json`'s `evidence.artifact`, the one
  // draft this ask is about — so `send` can prove the bytes it ships are the
  // bytes that were accepted. An accept whose artifact cannot be read from
  // the ask is refused by name and nothing is written. redo/rerun record
  // none (nothing is shipped on them).
  if (decision === 'accept') {
    const artifact = ask.evidence && typeof ask.evidence === 'object' ? ask.evidence.artifact : undefined;
    if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
      return { ok: false, red: `answerAsk: askId "${askId}" cannot be accepted — ask.json carries no readable artifact (evidence.artifact) to hash for run ${runDir}` };
    }
    payload.artifactSha256 = sha256Hex(serializeArtifact(artifact));
  }
  // Orchestrator review fix (5): a plain `existsSync` check followed by a
  // separate `writeFileSync` is a check-then-act race — two concurrent
  // answers can both pass the check before either writes, and the second
  // silently overwrites the first. `{ flag: 'wx' }` makes the write itself
  // the exclusive gate (fails EEXIST if the file already exists), so there
  // is no window between "is it answered" and "answer it" for a second
  // caller to land in.
  try {
    writeFileSync(answerPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { ok: false, red: `answerAsk: askId "${askId}" already answered for run ${runDir}` };
    }
    return { ok: false, red: `answerAsk: could not write ${answerPath} — ${err.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// M4a Amendment M4a-1 — SIGNED by hamr 2026-09-27 ("sign m4a1")
// (docs/wiki/the-module-ladder.md, "M4a" section): every park writes a
// PERMANENT copy of that ask into `asks/<askId>.json` alongside the
// (mutable, single-slot) `ask.json`. `ask.json` keeps its current role
// unchanged — this is a second, append-only record, one file per askId,
// never overwritten, never deleted (not by resume, not by answer
// consumption, not by rerun — a rerun always gets a fresh run dir, so it
// never revisits an old askId). Write-once is a MECHANISM (exclusive
// create, `{ flag: 'wx' }'), not a check-then-write race: a second write
// for the same askId is refused, by name, and the first file on disk is
// left byte-identical.
// ---------------------------------------------------------------------------

/**
 * Writes `asks/<askId>.json` in `runDir`, creating the `asks/` directory if
 * needed. Called by `src/runner.js` right after it writes `ask.json` for a
 * fresh park (same `askId`/`question`/`askedAt`/`expiresAt`/`evidence` — the
 * archive is a permanent copy of the SAME content, not a second source of
 * truth). Exclusive-create: a second call for an already-archived `askId`
 * is refused (a red naming the file) rather than silently overwriting it —
 * proven by the write itself failing (`EEXIST`), not by a separate
 * existence check that a concurrent writer could race past.
 *
 * Crash-order note: this is called AFTER `ask.json` is written, so a crash
 * between the two writes leaves `ask.json` present and `asks/<askId>.json`
 * missing — the run is still correctly parked and resumable (ask.json/
 * state.json govern resume, unchanged), just without its archive entry for
 * that one askId. `listArchivedAsks` below tolerates this (it only reports
 * what is actually on disk); it is never treated as "before M4a-1" (that
 * `why` is reserved for a run with NO `asks/` directory at all).
 *
 * M4b amendment 2 (SIGNED by hamr 2026-09-30, F52): the record also carries
 * `emits`, the step output this ask is about, so a later process can join
 * the ask to its consumed answer's recorded hash (`readAcceptedHashesByEmits`).
 * Written once with the rest of the record; an existing archive is never
 * rewritten to add it (the `wx` create refuses).
 *
 * @param {{ runDir: string, askId: string, question: string, askedAt: string, expiresAt: string, evidence: unknown, emits?: string }} opts
 * @returns {{ ok: true } | { ok: false, red: string }}
 */
export function writeAskArchive({
  runDir, askId, question, askedAt, expiresAt, evidence, emits,
}) {
  if (typeof runDir !== 'string' || runDir.length === 0) {
    return { ok: false, red: 'writeAskArchive: "runDir" must be a non-empty string' };
  }
  if (typeof askId !== 'string' || askId.length === 0) {
    return { ok: false, red: 'writeAskArchive: "askId" must be a non-empty string' };
  }
  const asksDir = join(runDir, 'asks');
  mkdirSync(asksDir, { recursive: true });
  const archivePath = join(asksDir, `${askId}.json`);
  const payload = {
    askId, question, askedAt, expiresAt, evidence,
  };
  if (typeof emits === 'string' && emits.length > 0) payload.emits = emits;
  try {
    writeFileSync(archivePath, JSON.stringify(payload, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { ok: false, red: `writeAskArchive: "${archivePath}" already exists — refusing to overwrite an archived ask` };
    }
    return { ok: false, red: `writeAskArchive: could not write ${archivePath} — ${err.message}` };
  }
  return { ok: true };
}

/**
 * M4b amendment 2: for each archived ask that carries `emits`, joins it BY
 * askId to its consumed answer and returns the recorded `artifactSha256` of
 * an ACCEPT. Only `decision: accept` with a string hash counts; never
 * recomputed from any file. No `emits` (old run), no marker, bad JSON, a
 * redo/rerun, or a symlinked/unreadable entry contributes nothing, so the
 * emits stays unrecorded and send refuses by name. Two accepts for one
 * `emits` should be impossible; if seen, the result is a red, never a guess.
 *
 * @param {string} runDir
 * @returns {{ ok: true, byEmits: Map<string, string> } | { ok: false, red: string }}
 */
export function readAcceptedHashesByEmits(runDir) {
  const byEmits = new Map();
  if (!resolveInside(runDir, 'asks').ok) return { ok: true, byEmits };
  const accepted = new Map(); // emits -> [askId]
  for (const entry of readdirInside(runDir, 'asks').sort()) {
    if (!entry.endsWith('.json')) continue; // eslint-disable-line no-continue
    const askId = entry.slice(0, -'.json'.length);
    const archiveRead = readFileInside(runDir, join('asks', entry));
    if (!archiveRead.ok) continue; // eslint-disable-line no-continue
    let emits;
    try { emits = JSON.parse(archiveRead.text)?.emits; } catch { continue; } // eslint-disable-line no-continue
    if (typeof emits !== 'string' || emits.length === 0) continue; // eslint-disable-line no-continue
    const markerRead = readFileInside(runDir, `answer.${askId}.consumed.json`);
    if (!markerRead.ok) continue; // eslint-disable-line no-continue
    let marker;
    try { marker = JSON.parse(markerRead.text); } catch { continue; } // eslint-disable-line no-continue
    if (marker?.decision !== 'accept' || typeof marker.artifactSha256 !== 'string' || marker.artifactSha256.length === 0) continue; // eslint-disable-line no-continue
    if (accepted.has(emits)) {
      return { ok: false, red: `resume: more than one accepted ask (${accepted.get(emits)}, ${askId}) for step output "${emits}" — refusing to guess which hash applies` };
    }
    accepted.set(emits, askId);
    byEmits.set(emits, marker.artifactSha256);
  }
  return { ok: true, byEmits };
}

// ---------------------------------------------------------------------------
// M4a Amendment M4a-1 reader: pairs each archived ask (`asks/<askId>.json`)
// with its consumed answer (`answer.<askId>.consumed.json`), by askId only —
// never by position/order, so the reader is correct even if archives and
// consumed-answer files land out of step with each other. A run with no
// `asks/` directory at all predates M4a-1: its asks are not lost, they were
// simply never kept — reported with a named `why`, never an invented entry.
// ---------------------------------------------------------------------------

/**
 * @param {string} runDir
 * @returns {{ archived: true, asks: Array<{ askId: string, question?: string, askedAt?: string, expiresAt?: string,
 *   evidence: ReturnType<typeof readAskEvidence>,
 *   answer: { status: string, reason?: string, answeredAt?: string, why?: string } }> } | { archived: false, why: string }}
 */
export function listArchivedAsks(runDir) {
  // F48 round 3: the `asks/` directory itself — and every entry inside it —
  // is checked with `resolveInside`/`readFileInside` (`src/flow.js`), so a
  // symlinked `asks/` (the exact shape F48's live plant used one level up,
  // for `runs/`) is refused here rather than followed to list an outside
  // directory, and any individual entry that is itself a symlink is skipped
  // before this loop ever sees its name.
  const asksDirResolved = resolveInside(runDir, 'asks');
  if (!asksDirResolved.ok) {
    if (asksDirResolved.missing) {
      return { archived: false, why: 'draft not kept (before M4a-1)' };
    }
    return { archived: false, why: `listArchivedAsks: ${asksDirResolved.red}` };
  }

  const entries = readdirInside(runDir, 'asks');

  const asks = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue; // eslint-disable-line no-continue
    const askId = entry.slice(0, -'.json'.length);
    const archivePath = join(runDir, 'asks', entry);
    const archiveRead = readFileInside(runDir, join('asks', entry));
    let ask;
    if (!archiveRead.ok) {
      asks.push({
        askId, question: undefined, askedAt: undefined, expiresAt: undefined,
        evidence: {
          draft: null,
          unjudged: [],
          why: archiveRead.missing
            ? `${archivePath} is missing`
            : `${archivePath} — ${archiveRead.red}`,
        },
        answer: { status: 'open' },
      });
      continue; // eslint-disable-line no-continue
    }
    try {
      ask = JSON.parse(archiveRead.text);
    } catch (err) {
      asks.push({
        askId, question: undefined, askedAt: undefined, expiresAt: undefined,
        evidence: { draft: null, unjudged: [], why: `${archivePath} is not valid JSON — ${err.message}` },
        answer: { status: 'open' },
      });
      continue; // eslint-disable-line no-continue
    }

    const consumedRelPath = `answer.${askId}.consumed.json`;
    const consumedRead = readFileInside(runDir, consumedRelPath);
    let answer = { status: 'open' };
    if (consumedRead.ok) {
      let parsed;
      try {
        parsed = JSON.parse(consumedRead.text);
        answer = {
          status: DECISION_STATUS[normalizeDecision(parsed.decision)] ?? `unrecognised: ${parsed.decision}`,
          answeredAt: parsed.answeredAt,
        };
        if (typeof parsed.reason === 'string') answer.reason = parsed.reason;
      } catch (err) {
        answer = { status: 'open', why: `${join(runDir, consumedRelPath)} is not valid JSON — ${err.message}` };
      }
    } else if (typeof ask.expiresAt === 'string' && !Number.isNaN(Date.parse(ask.expiresAt))
      && Date.now() > Date.parse(ask.expiresAt)) {
      answer = { status: 'expired' };
    } else {
      answer = { status: 'unanswered' };
    }

    asks.push({
      askId,
      question: ask.question,
      askedAt: ask.askedAt,
      expiresAt: ask.expiresAt,
      evidence: readAskEvidence(ask),
      answer,
    });
  }

  return { archived: true, asks };
}
