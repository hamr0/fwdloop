// borrowed-from: bareloop src/learnstore.js@v0.46.0 (8b3d815)
// Adaptations: M8 item 3: the ledger home is fwdloop's configHome() (src/config.js) in place of bareloop's keysHome, so the file is <configHome>/learn/ledger.json (mode 600, as bareloop); with no explicit home under a test process and no FWDLOOP_CONFIG_HOME, ledgerPath throws, so a test can never reach the real ~/.config/fwdloop; hintsForRun is copied at the bottom (M8 item 5a) with a ledger problem THROWN (the caller records why and hands nothing), and with `path.resolve` for the place in place of bareloop's realpathSync (the F48 guard keeps realpathSync out of this file), the same place learnAtRunEnd records; stageQuestionsByName is not copied (see learnAtRunEnd: a card's `meaning` is the failing check's own text from the run's checks.jsonl); learnAtRunEnd reads fwdloop's run folder through eventsOfRun (adapted from fwdloop poc/learn/adapter.mjs, F79) because fwdloop has no bareloop spine; imports trimmed to match. Nothing else changed. Known gap, kept on purpose (M8 item 7): foldRunIntoLedger and releaseRun read, change and replace the file, so two runs ending together can lose a note.
// The thin reader/writer around src/learn.js (cross-run learnings, ITEM33-BUILD.md rev 2). All file IO lives here and
// the pure rules live in learn.js; nothing in either file can reach a model.
//
// ONE ledger per user: `<config home>/learn/ledger.json` (~/.config/fwdloop/learn/ledger.json in production; tests inject a
// scratch home and never create the real directory). It lives outside every person's repo, is written atomically
// (temp file + rename) and mode 600, and every string in it passes the one secret inventory before it is written.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { configHome, configDoorHome, readConfig } from './config.js';
import { emptyLedger, redactDeep, countLedger, holdPending, releasePending, recordHealth, buildCards, placeOf, renderHints } from './learn.js';
import { readAudit, readHistory } from './books.js';
import { readChecks } from './diary.js';
import { readFileInside, readdirInside, listFlowNames, listRunIds } from './flow.js';

/**
 * M8 item 5a (loose end): the ONE function that turns a source as written into a place. The run-end notes (`learnAtRunEnd`: a path the panel/CLI gave the run) and
 * the drafter's hints (`hintsForRun`: the path as typed in the prose) both pass through it, so the same file cannot be two places. A leading `~` or `~/` is the
 * home folder (`path.resolve` alone would make it `<cwd>/~/...`); then `path.resolve` (lexical, no fs: the F48 guard keeps realpathSync out of this file).
 * A web address stays its host (placeOf). Not copied from bareloop: this is the fwdloop-only part of the place.
 * @param {string} p @returns {string}
 */
export function resolvePlace(p) {
  return resolve(p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);
}

/**
 * `<configHome>/learn/ledger.json`. Under a test process (NODE_ENV=test or node --test) the home is the explicit one or
 * FWDLOOP_CONFIG_HOME; with neither it THROWS rather than fall back to the real ~/.config/fwdloop.
 * @param {string} [home] test seam; production never passes it
 * @returns {string}
 */
export function ledgerPath(home) {
  if (home === undefined) {
    const door = configDoorHome();
    if (door.skip) throw new Error('learnings ledger: a test process has no config home (set FWDLOOP_CONFIG_HOME or pass one)');
    home = door.home;
  }
  return join(configHome(home), 'learn', 'ledger.json');
}

/**
 * Read the ledger. A missing file is an empty ledger; an unreadable or wrong-shaped one is reported as `problem` (and the
 * writer then refuses to replace it: an append-only record is never silently reset).
 * @param {string} [home]
 * @returns {{ledger: import('./learn.js').Ledger, exists: boolean, problem: string|null}}
 */
export function readLedger(home) {
  const file = ledgerPath(home);
  if (!existsSync(file)) return { ledger: emptyLedger(), exists: false, problem: null };
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    if (!d || typeof d !== 'object' || d.version !== 1 || !Array.isArray(d.rows) || !Array.isArray(d.pending)) {
      return { ledger: emptyLedger(), exists: true, problem: `${file} is not a version-1 learnings ledger — fix or remove it` };
    }
    return { ledger: { ...emptyLedger(), ...d }, exists: true, problem: null };
  } catch (/** @type {any} */ e) {
    return { ledger: emptyLedger(), exists: true, problem: `${file} is not readable JSON (${e?.code ?? 'parse error'}) — fix or remove it` };
  }
}

/**
 * Write the ledger atomically (temp + rename, mode 600), every string masked through the one secret inventory.
 * @param {import('./learn.js').Ledger} ledger @param {string} [home]
 * @returns {string} the file written
 */
export function writeLedger(ledger, home) {
  const file = ledgerPath(home);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(redactDeep(ledger), null, 1)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}

/**
 * Fold ONE finished run into the ledger on disk: a deterministic job's cards COUNT now; a rubric job's cards are HELD
 * until a human Accept (they are written to `pending`, never counted, never readable). The run's health line is recorded
 * either way. Never throws on a bad ledger file: it reports `problem` and writes nothing.
 * @param {{home?: string, runid: string, build: import('./learn.js').CardBuild, workflow: string, place: string|null, specHash: string|null, trust: 'deterministic'|'rubric', at: string, now?: Date}} o
 * @returns {{wrote: boolean, counted: number, held: number, problem: string|null}}
 */
export function foldRunIntoLedger({ home, runid, build, workflow, place, specHash, trust, at, now = new Date() }) {
  const cur = readLedger(home);
  if (cur.problem) return { wrote: false, counted: 0, held: 0, problem: cur.problem };
  let L = cur.ledger;
  let counted = 0;
  let held = 0;
  if (trust === 'rubric') {
    L = holdPending(L, { runid, cards: build.cards, workflow, place, specHash, at }, now);
    held = build.cards.length;
  } else {
    const before = L.rows.reduce((n, r) => n + r.runIds.filter((x) => x === runid).length, 0);
    L = countLedger(L, { runid, cards: build.cards, workflow, place, specHash, trust, now });
    counted = L.rows.reduce((n, r) => n + r.runIds.filter((x) => x === runid).length, 0) - before;
  }
  L = recordHealth(L, runid, build, at, now);
  writeLedger(L, home);
  return { wrote: true, counted, held, problem: null };
}

/**
 * The human Accept at the review door: release the run's held rubric cards so they count (only forward, only here).
 * @param {{home?: string, runid: string, now?: Date}} o
 * @returns {{released: number, problem: string|null}}
 */
export function releaseRun({ home, runid, now = new Date() }) {
  const cur = readLedger(home);
  if (cur.problem) return { released: 0, problem: cur.problem };
  const r = releasePending(cur.ledger, runid, now);
  if (r.ledger !== cur.ledger) writeLedger(r.ledger, home);
  return { released: r.released, problem: null };
}

/**
 * M8 am1: the ONE setting, `learningHints` in config.json. Ships OFF (absent = off). OFF still writes the tally ($0); the drafter
 * is simply handed nothing. Copied from bareloop learnstore.js@v0.46.0:104 (borrowed-from header above). Difference: bareloop's
 * `readConfig` returns a problem, fwdloop's THROWS ConfigError on an unreadable / non-JSON / invalid file. The safe reading is kept:
 * a bad or unreadable config reads as OFF (never ON). Under a test process with no explicit home and no FWDLOOP_CONFIG_HOME it
 * reads nothing (OFF), so a test can never reach the real ~/.config/fwdloop.
 * @param {string} [home]
 * @returns {boolean}
 */
export function learningHintsOn(home) {
  let h = home;
  if (h === undefined) {
    const door = configDoorHome();
    if (door.skip) return false;
    h = door.home;
  }
  try {
    return readConfig({ home: h }).learningHints === true;
  } catch {
    return false;
  }
}

// ── the run-end tally (M8 items 2 and 4) ─────────────────────────────────────────────────────────

/** Unified -U1 line diff (LCS), as the F79 adapter made it; '' when identical. Borrowed-from: fwdloop poc/learn/adapter.mjs (F79, 2026-10-23). @param {string} a @param {string} b @param {number} [ctx] */
function unifiedDiff(a, b, ctx = 1) {
  const A = a === '' ? [] : a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {Array<[string, string]>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push([' ', A[i]]); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i]]); i += 1; } else { ops.push(['+', B[j]]); j += 1; }
  }
  while (i < n) { ops.push(['-', A[i]]); i += 1; }
  while (j < m) { ops.push(['+', B[j]]); j += 1; }
  const keep = ops.map(() => false);
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -ctx; d <= ctx; d += 1) if (ops[k + d]) keep[k + d] = true; });
  /** @type {string[]} */
  const out = [];
  let ai = 1;
  let bi = 1;
  const pos = ops.map((o) => { const p = [ai, bi]; if (o[0] !== '+') ai += 1; if (o[0] !== '-') bi += 1; return p; });
  let k = 0;
  while (k < ops.length) {
    if (!keep[k]) { k += 1; continue; }
    let e = k;
    while (e < ops.length && keep[e]) e += 1;
    const seg = ops.slice(k, e);
    out.push(`@@ -${pos[k][0]},${seg.filter((o) => o[0] !== '+').length} +${pos[k][1]},${seg.filter((o) => o[0] !== '-').length} @@`);
    for (const [c, t] of seg) out.push(c + t);
    k = e;
  }
  return out.join('\n');
}

/** @param {string} runDir @param {string} rel @returns {any} the parsed JSON file inside the run folder, or null when absent / unreadable */
function jsonIn(runDir, rel) {
  const r = readFileInside(runDir, rel);
  if (!r.ok) return null;
  try { return JSON.parse(r.text); } catch { return null; }
}

/** audit.jsonl rows that are a step's TRY with a verdict on its output; a human redo (class hitl + red), a pause, a stop and a funding halt are not one. */
const isTry = (/** @type {any} */ r) => Number.isInteger(r.attempt) && ['green', 'hitl', 'softgreen', 'red', 'not-done'].includes(r.verdict) && !(r.class === 'hitl' && r.verdict === 'red');

/**
 * One finished run's folder -> the event list buildCards reads, plus the check texts and the model. ONE adapter, map never invent
 * (F79). Check name = `<step> (line <job line>, <close class>)`; a try with verdict red or not-done and a gap = a red moment (the gap
 * verbatim = B1's flagged line); a later try of the same check that is not red = the pass; Fix touched = `artifacts/<step>.json`;
 * What changed = a -U1 line diff of the try's modelOutput (log.json) against the step's previous try. Reads only the run's own books.
 * Refused drafts make no run folder, and a human redo is not a try (isTry), so neither makes a note.
 * @param {string} runDir @param {string} workflow
 * @returns {{events: any[], questions: Map<string, string|null>, model: string|null, source: string|null}|null} null when the run has no try
 */
export function eventsOfRun(runDir, workflow) {
  const audit = readAudit(runDir);
  const rows = audit.filter(isTry);
  if (!rows.length) return null;
  const log = jsonIn(runDir, 'log.json') ?? {};
  const decl = jsonIn(runDir, 'job/declaration.json') ?? { steps: [] };
  const inputs = jsonIn(runDir, 'inputs.json');
  const prose = (() => { const r = readFileInside(runDir, 'job/prose.txt'); return r.ok ? r.text : ''; })();
  const checks = readChecks(runDir);
  const made = new Set(readdirInside(runDir, 'artifacts'));
  const outBy = new Map((log.attempts || []).map((/** @type {any} */ a) => [`${a.step}#${a.attempt}`, a.modelOutput]));
  const lastAt = audit.at(-1)?.at ?? '1970-01-01T00:00:00.000Z';
  const model = audit.find((r) => typeof r.model === 'string')?.model ?? null;
  const stepMeta = new Map((decl.steps || []).map((/** @type {any} */ s) => [s.emits, s]));
  /** @type {Map<string, string|null>} */
  const questions = new Map();
  /** @type {any[]} */
  const events = [];
  let seq = 0;
  let ts = audit[0]?.at ?? lastAt;
  const push = (/** @type {any} */ e) => events.push({ seq: (seq += 1), ts, ...e });
  push({ type: 'job-start', job: workflow, goal: prose.split(/\n\s*\n/)[0].trim(), model });
  push({ type: 'plan-accepted', plan: { steps: (decl.steps || []).map((/** @type {any} */ s) => ({ id: s.emits, action: s.goal })) } });
  /** @type {Map<string, string>} */
  const prevOut = new Map();
  for (const a of rows) {
    ts = a.at ?? ts;
    const meta = /** @type {any} */ (stepMeta.get(a.step));
    const name = `${a.step} (line ${meta?.fromLine ?? '?'}, ${a.class})`;
    push({ type: 'step-start', step: a.step });
    push({ type: 'iteration-start' });
    const mo = outBy.get(`${a.step}#${a.attempt}`);
    let diff = '';
    if (mo !== undefined) { const after = JSON.stringify(mo, null, 2); diff = unifiedDiff(prevOut.has(a.step) ? /** @type {string} */ (prevOut.get(a.step)) : '', after); prevOut.set(a.step, after); }
    if (made.has(`${a.step}.json`)) push({ type: 'attempt-diff', files: [{ path: `artifacts/${a.step}.json`, diff: diff.slice(0, 4096), truncated: diff.length > 4096 }], binary: [], truncated: false });
    if ((a.verdict === 'red' || a.verdict === 'not-done') && typeof a.gap === 'string' && a.gap !== '') {
      const f = checks.find((c) => c.step === a.step && c.try === a.attempt)?.checks?.find((/** @type {any} */ x) => !x.ok);
      if (f && !questions.has(name)) questions.set(name, String(f.text));
      push({ type: 'exit-eval', step: a.step, results: [{ type: name, pass: false, detail: a.gap }] });
    } else {
      push({ type: 'exit-eval', step: a.step, results: [{ type: name, pass: true }] });
    }
  }
  ts = lastAt;
  // M8 am4 item 3: the two noise categories bareloop's buildCards reads off an `escalation` event, seen here in the audit: a provider red
  // (verdict 'provider-red', the transport fault twice) and a closer that crashed or was unparseable (verdict 'close-casualty'). Both end
  // the run, so a row of either is the run's last word. Neither is a try (isTry), so it never makes a red moment of its own.
  const noiseRow = audit.findLast((r) => r.verdict === 'provider-red' || r.verdict === 'close-casualty');
  if (noiseRow) push({ type: 'escalation', category: noiseRow.verdict === 'provider-red' ? 'provider-red' : 'close-crashed' });
  push({ type: 'job-end', outcome: log.outcome === 'complete' ? 'green' : String(log.outcome) });
  return { events, questions, model, source: typeof inputs?.[0]?.source === 'string' ? inputs[0].source : null };
}

/**
 * THE RUN-END TALLY ($0, code only, no model; M8 item 2): turn a finished run's folder into cards and fold them into the ledger.
 * The place is the first input's source made absolute lexically (`path.resolve`, no fs: the F48 guard keeps realpathSync out of this file, so a symlinked source is not followed). The ledger run id is `<workflow>/<runId>` (fwdloop's run ids repeat across workflows, bareloop's do not). M8 am4: every run's notes COUNT at once (trust 'deterministic'), a run
 * with a signed ask included; there is no hold. It runs whether `learningHints` is on or off. `questions` (bareloop's stageQuestionsByName) is, here, the failing check's own text from
 * the run's checks.jsonl, so a check with no checks.jsonl row (a run from before am29) has no `meaning`.
 * Borrowed-from: bareloop src/learnstore.js@v0.46.0:132 (learnAtRunEnd).
 * @param {{home?: string, workflow: string, runId: string, runDir: string, specHash: string|null, now?: Date}} o
 * @returns {{wrote: boolean, counted: number, held: number, problem: string|null, noise: string|null, cards: number}}
 */
export function learnAtRunEnd({ home, workflow, runId, runDir, specHash, now = new Date() }) {
  const rec = eventsOfRun(runDir, workflow);
  if (!rec) return { wrote: false, counted: 0, held: 0, problem: null, noise: 'no-tries', cards: 0 };
  const runid = `${workflow}/${runId}`;
  const build = buildCards({ runid, events: rec.events, spec: { job: workflow }, model: rec.model, questions: rec.questions });
  const at = rec.events.findLast((e) => e.type === 'job-end')?.ts ?? now.toISOString();
  const r = foldRunIntoLedger({ home, runid, build, workflow, place: placeOf({ inputs: rec.source ? [{ value: rec.source }] : [] }, resolvePlace), specHash, trust: 'deterministic', at, now });
  return { ...r, noise: build.noise, cards: build.cards.length };
}

/** M8 am4 item 2: a run waiting at an ask has not ended ('paused', or a Stop whose set-aside failed). ONE decider: the runner's run-end tally and the seed both read it. */
export const NOT_A_RUN_END = new Set(['paused', 'stop-failed']);

/**
 * M8 am6: seed the ledger from every run already recorded under `root` (every job, every ended run), oldest first by the run's own end time
 * (the last history row that is a run end). Each run goes through `learnAtRunEnd` (the one note builder) with `now` = its own end time, so
 * ages, decay and lastSeen come from the run. A run already in the ledger (its `<workflow>/<runId>` has a health line) is skipped, so a second seed adds nothing.
 * Code only, $0. A run it cannot read is counted and the seed goes on; a bad ledger file stops it at once (nothing is rewritten).
 * Under a test process with no door nothing is read or written (`skippedNoDoor`).
 * @param {{root: string, home?: string}} o `home` is a test seam; production leaves it out
 * @returns {{read: number, added: number, skipped: Record<'already-in'|'still-waiting'|'no-end'|'unreadable'|'noise', number>, problem: string|null, skippedNoDoor: boolean}}
 */
export function seedLedger({ root, home }) {
  /** @type {{read: number, added: number, skipped: Record<'already-in'|'still-waiting'|'no-end'|'unreadable'|'noise', number>, problem: string|null, skippedNoDoor: boolean}} */
  const out = { read: 0, added: 0, skipped: { 'already-in': 0, 'still-waiting': 0, 'no-end': 0, unreadable: 0, noise: 0 }, problem: null, skippedNoDoor: false };
  if (home === undefined) {
    const door = configDoorHome();
    if (door.skip) return { ...out, skippedNoDoor: true };
    home = door.home;
  }
  /** @type {{workflow: string, runId: string, runDir: string, end: Date, specHash: string|null}[]} */
  const todo = [];
  for (const workflow of listFlowNames(root)) {
    const flowDir = join(root, workflow);
    /** @type {any[]|null} */
    let history = null;
    try { history = readHistory(flowDir); } catch { history = null; }
    for (const runId of listRunIds(flowDir)) {
      out.read += 1;
      const runDir = join(flowDir, 'runs', runId);
      try {
        const log = jsonIn(runDir, 'log.json');
        if (log && NOT_A_RUN_END.has(log.outcome)) { out.skipped['still-waiting'] += 1; continue; }
        if (history === null) { out.skipped.unreadable += 1; continue; }
        const endRow = history.findLast((r) => r?.runId === runId && !NOT_A_RUN_END.has(r.outcome) && Number.isFinite(Date.parse(r.at)));
        if (!endRow) { out.skipped['no-end'] += 1; continue; }
        if (!log) { out.skipped.unreadable += 1; continue; }
        todo.push({ workflow, runId, runDir, end: new Date(endRow.at), specHash: typeof endRow.signatureHash === 'string' ? endRow.signatureHash : null });
      } catch { out.skipped.unreadable += 1; }
    }
  }
  todo.sort((a, b) => a.end.getTime() - b.end.getTime() || `${a.workflow}/${a.runId}`.localeCompare(`${b.workflow}/${b.runId}`));
  for (const t of todo) {
    const cur = readLedger(home);
    if (cur.problem) { out.problem = cur.problem; return out; }
    if (Object.hasOwn(cur.ledger.health, `${t.workflow}/${t.runId}`)) { out.skipped['already-in'] += 1; continue; }
    try {
      const r = learnAtRunEnd({ home, workflow: t.workflow, runId: t.runId, runDir: t.runDir, specHash: t.specHash, now: t.end });
      if (r.problem) { out.problem = r.problem; return out; }
      if (r.noise) out.skipped.noise += 1;
      else out.added += r.counted;
    } catch { out.skipped.unreadable += 1; }
  }
  return out;
}

/**
 * M8 item 5a: the block the DRAFTER is handed for this job, made from the ledger as it stood: null when `learningHints` is off,
 * when there is no ledger, or when nothing is readable; an unreadable ledger THROWS (the caller hands nothing and records why). The one `renderHints` render (2,000 characters at most),
 * never a second. Age (56 days), job version and level are worked out here, at read time, by renderHints.
 * Borrowed-from: bareloop src/learnstore.js@v0.46.0:148 (hintsForRun). `spec` is `{job, inputs: [{value}]}` (job = the workflow name).
 * @param {{home?: string, spec: any, specHash: string|null, now?: Date}} o
 * @returns {{text: string, ids: string[]}|null}
 */
export function hintsForRun({ home, spec, specHash, now = new Date() }) {
  if (!learningHintsOn(home)) return null;
  const cur = readLedger(home);
  if (cur.problem) throw new Error(cur.problem); // adapted: bareloop returns null here; the caller (authoring.js) hands nothing AND records why (item 4)
  const r = renderHints(cur.ledger, { workflow: String(spec.job), place: placeOf(spec, resolvePlace), specHash, now });
  return r.text ? r : null;
}
