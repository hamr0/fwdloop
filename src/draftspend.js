// borrowed-from: bareloop src/draftspend.js@524a244 (writeDraftSpend: one file per draft folder, rewritten atomically
// after EVERY metered call; the money readers count it).
// M4e piece 2a, item 7 (docs/wiki/the-module-ladder.md, "M4e", scope 13): drafting spend that is booked per call.
//
// Before this, `draftToDir` booked ONE `spend.jsonl` row after the whole draft returned, so a draft killed
// mid-way (Abandon, a SIGKILL, a panel host reboot) booked nothing for the rounds already paid for. Now the
// drafter reports every call (`onBook`, src/drafter.js) and `draftToDir` rewrites `<draft dir>/draft-spend.json`
// from it: written BEFORE each provider call as "one call in flight" (unknown cost = one ceiling, never $0),
// rewritten AFTER it with the metered floor.
//
// ONE rule for what a draft dir costs (`readDirSpendRows`, the only reader, called by src/monthly.js): the final
// `spend.jsonl` row, once the draft finished, is the whole truth and SUPERSEDES this file; before that, this file
// is the dir's one spend row. So a finished draft is counted once, never as both. The run that follows a sign has
// its own dir and its own books — it never carries this spend (counted once, as scope 13 says).
//
// The record is shaped like a spend row, so `spendRowCost` (src/provider.js, the one cost rule) prices it:
//   { kind:'draft-live', provider, model, price, tokens, costUsd (metered floor, null when unpriced), rounds, calls,
//     spendComplete (false while a call is in flight or any call is unmetered/unpriced), inFlight, at, startedAt, updatedAt }
import { renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { readdirInside, readFileInside } from './flow.js';
import { draftStepList, DRAFT_LOG_RE } from './draft-steps.js';
import { readSpendRows, rowCeilingUsd, spendRowCost, unmeteredCalls } from './provider.js';
import { parseSignedText } from './signed-text.js';

export const DRAFT_SPEND_FILE = 'draft-spend.json';

/**
 * (Re)write `<dir>/draft-spend.json` atomically (tmp + rename), so a reader never sees a torn file.
 * @param {string} dir the draft dir
 * @param {Record<string, any>} rec
 */
export function writeDraftSpend(dir, rec) {
  const file = join(dir, DRAFT_SPEND_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * The draft dir's live spend record as a spend row, or null when the file is not there. A file that is there but
 * cannot be read is unknown spend: one unmetered call (priced at the ceiling), never $0 and never skipped.
 * @param {string} dir
 * @returns {Record<string, any>|null}
 */
export function readDraftSpend(dir) {
  const r = readFileInside(dir, DRAFT_SPEND_FILE);
  if (!r.ok) return r.missing ? null : unknownRow();
  try {
    const j = JSON.parse(r.text);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return unknownRow();
    return j;
  } catch { return unknownRow(); }
}

const unknownRow = () => ({
  kind: 'draft-live', model: null, costUsd: null, rounds: 0, calls: 1, spendComplete: false, inFlight: false,
});

/**
 * Every spend row of one run/draft dir: its `spend.jsonl` rows; and, only when there are none, the draft dir's
 * `draft-spend.json` record (see the file header: a finished draft's spend.jsonl supersedes it).
 * @param {string} dir
 * @returns {Record<string, any>[]}
 */
export function readDirSpendRows(dir) {
  const rows = readSpendRows(join(dir, 'spend.jsonl'));
  if (rows.length > 0) return rows;
  const live = readDraftSpend(dir);
  return live ? [live] : [];
}

const PLAN_DIR_RE = /^draft(?:-\d+)?$/;
/** M4d am21 item 2: the one sentence for a Start over (or revise, or sign) whose chain names an earlier draft that is gone. */
export const EARLIER_MISSING_SAY = "An earlier draft of this job is missing, so its spend can't be counted.";

/** The file a Start over's session folder carries to name the session it started over from (written once by src/panel/author.js). */
export const STARTED_OVER_FILE = 'started-over-from.json';
const SESSION_ID_RE = /^d-[0-9a-z]{10}-[0-9a-f]{4}$/;

/**
 * M20 am3 item 12: the ONE reader of a session folder's `started-over-from.json`: the `startedOverFrom` value it holds, or null when
 * there is no file, it is unreadable, or it holds none. (A value that is not a session id is the caller's to judge.)
 * @param {string} sessionDir @returns {unknown}
 */
export function readStartedOverFrom(sessionDir) {
  const so = readFileInside(sessionDir, STARTED_OVER_FILE);
  if (!so.ok) return null;
  try { return JSON.parse(so.text)?.startedOverFrom ?? null; } catch { return null; }
}

/**
 * M4d amendment 16 item 1: what ALL of a job's drafting spent — the one writer of that total. A panel draft's session folder holds one plan
 * folder per draft (`draft/`, `draft-<n>/` for each revise and the redraft after answers); each is read by `readDirSpendRows` and priced by
 * `spendRowCost`, the one cost rule. A round whose cost is not known counts at its WORST CASE (item 5): its own booked price's ceiling, else
 * `ceilingUsd` (Settings prices x the fixed token limits), never $0; `notPriced` counts those rounds and `complete` is false.
 * @param {string} sessionDir the panel's draft folder
 * @param {{ ceilingUsd?: number, exclude?: string }} [o] `exclude` = a plan folder name to leave out (the one being written now)
 * @returns {{ usd: number, notPriced: number, complete: boolean, missingEarlier: boolean }}
 */
export function draftingSpent(sessionDir, { ceilingUsd = 0, exclude } = {}, seen = new Set()) {
  seen.add(resolve(sessionDir));
  let usd = 0;
  let notPriced = 0;
  let missingEarlier = false;
  for (const name of readdirInside(sessionDir, '.')) {
    if (!PLAN_DIR_RE.test(name) || name === exclude) continue;
    for (const row of readDirSpendRows(join(sessionDir, name))) {
      if (row.spendComplete === false) {
        const n = unmeteredCalls(row);
        const per = rowCeilingUsd(row) > 0 ? rowCeilingUsd(row) : ceilingUsd;
        usd += (row.costUsd ?? 0) + n * per;
        notPriced += n;
      } else if (row.costUsd === null || row.costUsd === undefined) {
        usd += rowCeilingUsd(row) > 0 ? rowCeilingUsd(row) : ceilingUsd;
        notPriced += 1;
      } else usd += spendRowCost(row).usd;
    }
  }
  // M4d am19 item 3: a Start over opens a new session folder that names the one it started over from (`started-over-from.json`, written once by the panel):
  // what the earlier session spent is still this job's drafting, so the chain is followed (a name that points back at a folder already counted is not).
  const from = readStartedOverFrom(sessionDir);
  if (typeof from === 'string' && SESSION_ID_RE.test(from) && !seen.has(resolve(dirname(sessionDir), from))) {
    const prev = join(dirname(sessionDir), from);
    // M4d am21 item 2: a link naming a folder that is gone is NOT $0: what it spent cannot be counted (`missingEarlier`, never a clean figure)
    if (!readFileInside(prev, 'card.json').ok) missingEarlier = true;
    else {
      const before = draftingSpent(prev, { ceilingUsd }, seen);
      usd += before.usd;
      notPriced += before.notPriced;
      missingEarlier = before.missingEarlier;
    }
  } else if (typeof from === 'string' && !SESSION_ID_RE.test(from)) missingEarlier = true;
  return { usd, notPriced, complete: notPriced === 0 && !missingEarlier, missingEarlier };
}

/** Money to 4 places, trailing zeros kept to 2 (`0.05`, `0.0016`). @param {number} n */
export const usdText = (n) => `$${String(Math.round(n * 1e4) / 1e4).replace(/^(\d+)$/, '$1.00').replace(/^(\d+\.\d)$/, '$10')}`;

/**
 * M4d amendment 16 items 1, 3, 5: the split of the card's Cap $ at Sign & run. `leftUsd` is what the first run may spend, rounded DOWN to 4 places (never
 * more than is left). `line` is the sentence the page shows.
 * @param {number} capUsd @param {{ usd: number, notPriced: number }} spent
 */
export function potSplit(capUsd, spent) {
  const leftUsd = Math.max(0, Math.floor((capUsd - spent.usd) * 1e4 + 1e-6) / 1e4);
  const drafting = spent.notPriced > 0
    ? `drafting spent at most ${usdText(spent.usd)} (${spent.notPriced} round${spent.notPriced === 1 ? '' : 's'} not priced)`
    : `drafting spent ${usdText(spent.usd)}`;
  return { capUsd, spentUsd: spent.usd, notPriced: spent.notPriced, leftUsd, line: `Cap ${usdText(capUsd)} · ${drafting} · this run up to ${usdText(leftUsd)}` };
}

/**
 * The drafter's `priorSpend` for the plan folder `dir`: when it sits in a panel session folder (a `card.json` beside it), what the session's earlier plans spent;
 * null for a plain CLI draft (no session, nothing earlier). The folder being written is left out.
 * @param {string} dir @returns {((ceilingUsd: number) => number)|null}
 */
export function sessionPriorSpend(dir) {
  const sessionDir = dirname(resolve(dir));
  if (!readFileInside(sessionDir, 'card.json').ok) return null;
  return (ceilingUsd) => draftingSpent(sessionDir, { ceilingUsd, exclude: basename(dir) }).usd;
}

/**
 * M4d amendment 19 item 1: what a draft reserves against the monthly limit: what is LEFT of the cap in its prose (cap minus what this job's drafting already
 * spent, `sessionPriorSpend`), not one round. A prose that does not parse falls back to one round: the draft itself refuses it at $0.
 * @param {string} proseText @param {string} outDir the plan folder the draft will write @param {number} ceilingUsd one round at its worst case
 */
export function draftHoldUsd(proseText, outDir, ceilingUsd) {
  const parsed = parseSignedText(proseText);
  if (!parsed.ok) return ceilingUsd;
  const prior = sessionPriorSpend(outDir);
  return Math.max(0, parsed.arbiter.capUsd - (prior === null ? 0 : prior(ceilingUsd)));
}

/**
 * M4d amendment 19 item 5 / amendment 20: the ONE sentence for a cap that cannot pay for one round. `kind` is "drafting" (the Chat card, the drafter) or "run"
 * (Run a signed flow, Resume); nothing else differs. `modelId` is the model the minimum was computed for, `minUsd` its worst-case round.
 * @param {'drafting'|'run'} kind @param {number} capUsd @param {number} minUsd @param {string} modelId
 */
export function capTooSmallText(kind, capUsd, minUsd, modelId) {
  return `Cap ${usdText(capUsd)} is below one ${kind} round's worst case for ${modelId}, $${minUsd.toFixed(4)}. Raise Cap $ or pick another model.`;
}

// M20 am1 items 5-6 + am2: the drafting step lines. The `fwdloop draft` child writes them into the draft's existing child.log (as `fwdloop: refusal-record`, M19 am14b):
//   `fwdloop: step-start {no, id, label, at}` and `fwdloop: step-end {no, status, label, at}`.
// `id` and `label` are `draftStepList`'s own (src/draft-steps.js) for the step; the `thinking` line and a `Fix:` note get no line (they have no time).
// Throws away: the model's replies and every per-round figure but what the label carries. Third outcomes: a torn or unparseable line is skipped; no lines = no times.
export const STEP_LINE_RE = /^fwdloop: (step-start|step-end) (\{.*\})$/;
export const STEP_LINE_PREFIXES = ['fwdloop: step-start ', 'fwdloop: step-end '];

/**
 * The ONE writer of the step lines. `emit(kind, record)` prints one line (the CLI passes stderr). Each call is given the result so far
 * (`log`, as log.json will hold it) and writes a start for every step not yet started, and an end for every step but the last (the running one);
 * `final` ends them all. A step is keyed by its `id`: written once.
 * @param {(kind: 'step-start'|'step-end', rec: Record<string, any>) => void} emit
 */
export function makeStepWriter(emit) {
  /** @type {string[]} */
  const started = [];
  const ended = new Set();
  return (/** @type {any} */ log, /** @type {any} */ declaration, final) => {
    const list = draftStepList({ log, declaration, questionOpen: !final });
    const items = (list ?? []).filter((st) => st.note !== true && st.id !== 'thinking');
    items.forEach((st, i) => {
      const at = new Date().toISOString();
      if (!started.includes(st.id)) { started.push(st.id); emit('step-start', { no: started.length - 1, id: st.id, label: st.label, at }); }
      if ((final || i < items.length - 1) && !ended.has(st.id)) {
        ended.add(st.id);
        emit('step-end', { no: started.indexOf(st.id), status: st.status === 'failed' ? 'failed' : 'done', label: st.label, at });
      }
    });
  };
}

/**
 * Fold the step lines of `<dir>/child.log` into one record per step, oldest first. A line that cannot be parsed is skipped.
 * @param {string} dir the draft folder @param {string} [file] the child's log: `child.log` (the first draft), `revise-<n>.log` or `redraft-<n>.log`
 * @returns {{no: number, id: string, label: string, status: 'running'|'done'|'failed', startedAt: string, endedAt: string|null, wallMs: number|null}[]}
 */
export function readDraftSteps(dir, file = 'child.log') {
  const r = readFileInside(dir, file);
  if (!r.ok) return [];
  /** @type {Map<number, any>} */
  const byNo = new Map();
  for (const line of r.text.split('\n')) {
    const m = STEP_LINE_RE.exec(line);
    if (!m) continue;
    let ev;
    try { ev = JSON.parse(m[2]); } catch { continue; }
    if (!ev || typeof ev !== 'object' || !Number.isInteger(ev.no)) continue;
    if (m[1] === 'step-start') {
      byNo.set(ev.no, { no: ev.no, id: String(ev.id), label: String(ev.label), status: 'running', startedAt: ev.at, endedAt: null, wallMs: null });
    } else if (byNo.has(ev.no)) {
      const x = byNo.get(ev.no);
      x.status = ev.status === 'failed' ? 'failed' : 'done';
      x.endedAt = ev.at;
      if (typeof ev.label === 'string') x.label = ev.label;
    }
  }
  const steps = [...byNo.values()].sort((a, b) => a.no - b.no);
  for (const x of steps) {
    const a = Date.parse(x.startedAt);
    const b = x.endedAt === null ? NaN : Date.parse(x.endedAt);
    x.wallMs = Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
  }
  return steps;
}

// borrowed-from: bareloop src/draftspend.js@v0.63.0 (7bc2719b): TIME_STEP_MS, mmss, stepped, draftWallMs, withDraftTimes, draftedLine
/** a running time moves in 30 s steps, never a ticking clock (the page polls often; the words change every 30 s) */
export const TIME_STEP_MS = 30_000;

/** M:SS, the ONE spelling of a drafting time ("took 0:42", "Drafting so far: 2:00"). @param {number} ms @returns {string} */
export function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** a running time floored to its 30 s step @param {number} ms @returns {number} */
export const stepped = (ms) => Math.floor(Math.max(0, ms) / TIME_STEP_MS) * TIME_STEP_MS;

/**
 * The drafting's whole time: the first step's start to the last step's end; `null` when no step has both times.
 * @param {{startedAt: string, endedAt: string|null}[]} steps `readDraftSteps`' records
 * @returns {number|null}
 */
export function draftWallMs(steps) {
  const starts = steps.map((x) => Date.parse(x.startedAt)).filter(Number.isFinite);
  const ends = steps.map((x) => (x.endedAt === null ? NaN : Date.parse(x.endedAt))).filter(Number.isFinite);
  return starts.length && ends.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : null;
}

/**
 * The ONE owner of the times on the chat's drafting list. While the draft runs the list is the started steps (`no` order, latest label), each `time` "M:SS so far"
 * (a finished one "took M:SS") and `draftSoFar` is "Drafting so far: M:SS". After it ends `list` is `draftStepList`'s list unchanged, each line taking the times of the
 * step line with the same `id` (the first unused, in order); a line no step line matches (thinking, a Fix note) has no time. No lines = no times, `draftSoFar` null.
 * A revise or answer redraft is read from its own log (`file`); its one `plan` line (`reviseStepList`) takes the draft's whole time (`wholeId`).
 * @param {{dir: string, running: boolean, list: any[]|null, nowMs?: number, file?: string, wholeId?: string}} p `dir` = the draft folder, `file` = the child's log in it, `list` = draftStepList's (or reviseStepList's) list or null
 * @returns {{list: any[]|null, draftSoFar: string|null}}
 */
export function withDraftTimes({ dir, running, list, nowMs = Date.now(), file = 'child.log', wholeId }) {
  const logged = readDraftSteps(dir, file);
  const timeOf = (/** @type {any} */ x) => {
    const a = Date.parse(x.startedAt);
    if (!Number.isFinite(a)) return null;
    if (x.status === 'running') return `${mmss(stepped(nowMs - a))} so far`;
    return x.wallMs !== null ? `took ${mmss(x.wallMs)}` : null;
  };
  const starts = logged.map((x) => Date.parse(x.startedAt)).filter(Number.isFinite);
  const draftSoFar = running && logged.some((x) => x.status === 'running') && starts.length ? `Drafting so far: ${mmss(stepped(nowMs - Math.min(...starts)))}` : null;
  if (running) {
    return { list: logged.length ? logged.map((x) => ({ id: x.id, label: x.label, status: x.status === 'failed' ? 'failed' : (x.status === 'running' ? 'running' : 'done'), details: [], time: timeOf(x) })) : list, draftSoFar };
  }
  if (list === null) return { list, draftSoFar: null };
  const used = new Set();
  const whole = wholeId !== undefined ? draftWallMs(logged) : null;
  return {
    list: list.map((st) => {
      if (st.id === wholeId) return { ...st, time: whole === null ? null : `took ${mmss(whole)}` };
      const x = logged.find((l) => l.id === st.id && !used.has(l.no));
      if (x) used.add(x.no);
      return { ...st, time: x ? timeOf(x) : null };
    }),
    draftSoFar: null,
  };
}

/** the logs of every draft of a session folder: the first draft's `child.log`, then each revise's and answer redraft's own */
const draftLogFiles = (/** @type {string} */ dir) => ['child.log', ...readdirInside(dir, '.').filter((n) => DRAFT_LOG_RE.test(n))];

/**
 * The plan card's one line: "Drafted in M:SS · $X". The time is the session's first step start to its last step end across ALL its drafts (the first, each revise,
 * each answer redraft); the money is the session's drafting spend (`draftingSpent`, handed in as `spentUsd`; "at least" when `complete` is false). `null` when no
 * step line has a time or the spend is not a number (a Reuse, an old draft, a session that never knew its cost): nothing is made up.
 * @param {{dir: string, spentUsd: number|null, complete: boolean}} p `dir` = the session's draft folder
 * @returns {string|null}
 */
export function draftedLine({ dir, spentUsd, complete }) {
  const ms = draftWallMs(draftLogFiles(dir).flatMap((f) => readDraftSteps(dir, f)));
  if (ms === null || typeof spentUsd !== 'number') return null;
  return `Drafted in ${mmss(ms)} \u00B7 ${complete ? '' : 'at least '}${usdText(spentUsd)}`;
}
